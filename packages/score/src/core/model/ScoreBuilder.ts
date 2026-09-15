import {Rational} from '../primitives/Rational';
import {
  normalizeMeterEntriesByPosition,
  normalizeTempoEntriesByPosition,
  setTimeMapExplicitEntries,
  TimeMap,
  type MeterEntry,
  type TempoEntry,
} from '../time/TimeMap';
import {MeasureId, NoteId, PartId, ScoreId, VoiceId} from '../types/ids';
import type {ScoreMetadata} from '../types/meta';
import {makeId} from '../utils/id';
import {Measure, type MeasureData} from './Measure';
import {Note, type NoteData} from './Note';
import {Part, type PartData} from './Part';
import {Score} from './Score';
import {snapshotClefChange, snapshotDirection, type PartClefChange, type PartDirection} from './notation';

/**
 * Copy JSON-like metadata at the Builder boundary without imposing JSON
 * semantics on caller-owned class instances, Dates, Maps, and similar values.
 * The immutable Score performs its own final frozen snapshot at build time.
 */
function snapshotMetadataValue(value: unknown, seen: WeakMap<object, unknown>): unknown {
  if (Array.isArray(value)) {
    const cached = seen.get(value);
    if (cached) return cached;
    const copy: unknown[] = [];
    seen.set(value, copy);
    for (const item of value) copy.push(snapshotMetadataValue(item, seen));
    return copy;
  }
  if (value && typeof value === 'object') {
    const proto = Object.getPrototypeOf(value);
    // `custom` and runtime-extended `encoding` values are open-ended. Clone
    // JSON-like records (including null-prototype records), but preserve
    // non-plain objects rather than changing their semantics.
    if (proto !== Object.prototype && proto !== null) return value;
    const cached = seen.get(value);
    if (cached) return cached;
    const copy = Object.create(proto) as Record<string, unknown>;
    seen.set(value, copy);
    for (const [key, item] of Object.entries(value)) {
      Object.defineProperty(copy, key, {
        value: snapshotMetadataValue(item, seen), enumerable: true, writable: true, configurable: true,
      });
    }
    return copy;
  }
  return value;
}

function snapshotMetadataInput(metadata: Partial<ScoreMetadata>): Partial<ScoreMetadata> {
  const snapshot: Partial<ScoreMetadata> = {...metadata};
  const seen = new WeakMap<object, unknown>();
  if (metadata.encoding !== undefined) {
    snapshot.encoding = snapshotMetadataValue(metadata.encoding, seen) as ScoreMetadata['encoding'];
  }
  if (metadata.custom !== undefined) {
    snapshot.custom = snapshotMetadataValue(metadata.custom, seen) as Record<string, unknown>;
  }
  return snapshot;
}

/**
 * Choose the display-measure label for the synthetic q=0 4/4 anchor without
 * depending on importer insertion order. Prefer a measure that begins at q=0;
 * otherwise use the chronologically earliest measure. Invalid same-onset grids
 * still receive a deterministic (lowest-number) choice for diagnostics.
 */
function defaultMeterMeasureNumber(measures: ReadonlyArray<Measure>): number {
  let earliest: Measure | undefined;
  let atOrigin: Measure | undefined;
  for (const measure of measures) {
    if (
      !earliest ||
      measure.onsetQuarters.lt(earliest.onsetQuarters) ||
      (measure.onsetQuarters.eq(earliest.onsetQuarters) && measure.number < earliest.number)
    ) {
      earliest = measure;
    }
    if (
      measure.onsetQuarters.eq(Rational.ZERO) &&
      (!atOrigin || measure.number < atOrigin.number)
    ) {
      atOrigin = measure;
    }
  }
  return (atOrigin ?? earliest)?.number ?? 1;
}

/**
 * Mutable builder. The immutable Score model is friendly for consumers but
 * awkward for importers, which need to accumulate state as they parse.
 * Call `.build()` once parsing is done.
 */
export class ScoreBuilder {
  metadata: ScoreMetadata = {};
  private readonly parts = new Map<PartId, {data: Omit<PartData, 'notes'>; notes: Note[]}>();
  private readonly noteIds = new Set<NoteId>();
  private readonly measures: Measure[] = [];
  private readonly measureIds = new Set<MeasureId>();
  private readonly measureNumbers = new Set<number>();
  private readonly tempi: TempoEntry[] = [];
  private readonly meters: MeterEntry[] = [];

  setMetadata(m: Partial<ScoreMetadata>): this {
    // Snapshot nested JSON-like input now, rather than retaining a caller's
    // mutable custom/encoding graph until build().
    this.metadata = {...this.metadata, ...snapshotMetadataInput(m)};
    return this;
  }

  addPart(data: Omit<PartData, 'notes'>): PartId {
    // Validate and snapshot at the mutation boundary, not only in build().
    // Keeping the caller's object here would let a later `data.id = …` bypass
    // duplicate checks while changing the Part ultimately constructed.
    const part = new Part({...data, notes: []});
    if (this.parts.has(part.id)) throw new Error(`Duplicate part id: ${part.id}`);
    this.parts.set(part.id, {
      data: {
        id: part.id,
        name: part.name,
        abbreviation: part.abbreviation,
        midiProgram: part.midiProgram,
        midiChannel: part.midiChannel,
        staves: part.staves,
        transpose: part.transpose,
        clefChanges: part.clefChanges,
        directions: part.directions,
      },
      notes: [],
    });
    return part.id;
  }

  addNote(partId: PartId, note: NoteData): this {
    const p = this.parts.get(partId);
    if (!p) throw new Error(`Unknown part: ${partId}`);
    const snapshot = new Note(note);
    if (this.noteIds.has(snapshot.id)) throw new Error(`Duplicate note id: ${snapshot.id}`);
    p.notes.push(snapshot);
    this.noteIds.add(snapshot.id);
    return this;
  }

  addClefChange(partId: PartId, change: PartClefChange): this {
    const part = this.parts.get(partId);
    if (!part) throw new Error(`Unknown part: ${partId}`);
    const snapshot = snapshotClefChange(change);
    if (!part.data.clefChanges || Object.isFrozen(part.data.clefChanges)) part.data.clefChanges = [...(part.data.clefChanges ?? []), snapshot];
    else (part.data.clefChanges as PartClefChange[]).push(snapshot);
    return this;
  }

  addDirection(partId: PartId, direction: PartDirection): this {
    const part = this.parts.get(partId);
    if (!part) throw new Error(`Unknown part: ${partId}`);
    const snapshot = snapshotDirection(direction);
    if (!part.data.directions || Object.isFrozen(part.data.directions)) part.data.directions = [...(part.data.directions ?? []), snapshot];
    else (part.data.directions as PartDirection[]).push(snapshot);
    return this;
  }

  addMeasure(m: MeasureData): this {
    const snapshot = new Measure(m);
    if (this.measureIds.has(snapshot.id)) throw new Error(`Duplicate measure id: ${snapshot.id}`);
    if (this.measureNumbers.has(snapshot.number)) {
      throw new Error(`Duplicate measure number: ${snapshot.number}`);
    }
    this.measures.push(snapshot);
    this.measureIds.add(snapshot.id);
    this.measureNumbers.add(snapshot.number);
    return this;
  }

  addTempo(t: TempoEntry): this {
    // The normalizer validates and returns a frozen value snapshot. Do this
    // now so a caller cannot mutate bpm/unit before build() changes the map.
    this.tempi.push(normalizeTempoEntriesByPosition([t])[0]);
    return this;
  }

  addMeter(m: MeterEntry): this {
    this.meters.push(normalizeMeterEntriesByPosition([m])[0]);
    return this;
  }

  // Fresh-ID helpers.
  newScoreId(): ScoreId {
    return ScoreId(makeId('s'));
  }
  newPartId(): PartId {
    return PartId(makeId('p'));
  }
  newMeasureId(): MeasureId {
    return MeasureId(makeId('m'));
  }
  newNoteId(): NoteId {
    return NoteId(makeId('n'));
  }
  newVoiceId(): VoiceId {
    return VoiceId(makeId('v'));
  }

  build(): Score {
    // Derive tempo/meter entries from measures that carry `tempo` /
    // `timeSignature` fields, merging with explicitly added entries.
    // Explicit addTempo/addMeter entries win over inferred measure metadata at
    // the same position; among several explicit declarations, the last one
    // added wins. This is the same canonicalisation used by TimeMap itself.
    const explicitTempi = normalizeTempoEntriesByPosition(this.tempi);
    const explicitMeters = normalizeMeterEntriesByPosition(this.meters);
    // First normalize the declaration stream inferred from measures. This is
    // deliberately *last* measure at a shared onset wins, matching direct
    // TimeMap construction, JSON, MusicXML and MIDI. Then remove every
    // inferred event shadowed by an explicit Builder declaration, so explicit
    // calls retain their documented precedence regardless of add order.
    const inferredTempi = normalizeTempoEntriesByPosition(
      this.measures.flatMap((measure) => measure.tempo
        ? [{atQuarters: measure.onsetQuarters, bpm: measure.tempo.bpm, unit: measure.tempo.unit}]
        : []),
    );
    const inferredMeters = normalizeMeterEntriesByPosition(
      this.measures.flatMap((measure) => measure.timeSignature
        ? [{
            atQuarters: measure.onsetQuarters,
            measureNumber: measure.number,
            timeSignature: measure.timeSignature,
          }]
        : []),
    );
    // Rationals are canonical (lowest terms, positive denominator), so this
    // is a stable O(1) source-position key.
    const key = (q: Rational) => `${q.num}/${q.den}`;
    const explicitTempoPositions = new Set(explicitTempi.map((entry) => key(entry.atQuarters)));
    const explicitMeterPositions = new Set(explicitMeters.map((entry) => key(entry.atQuarters)));
    const tempi: TempoEntry[] = [
      ...inferredTempi.filter((entry) => !explicitTempoPositions.has(key(entry.atQuarters))),
      ...explicitTempi,
    ];
    const meters: MeterEntry[] = [
      ...inferredMeters.filter((entry) => !explicitMeterPositions.has(key(entry.atQuarters))),
      ...explicitMeters,
    ];
    if (!tempi.some((entry) => entry.atQuarters.eq(Rational.ZERO))) {
      tempi.push({atQuarters: Rational.ZERO, bpm: 120});
    }
    if (!meters.some((entry) => entry.atQuarters.eq(Rational.ZERO))) {
      meters.push({
        atQuarters: Rational.ZERO,
        measureNumber: defaultMeterMeasureNumber(this.measures),
        timeSignature: {numerator: 4, denominator: 4},
      });
    }

    const timeMap = new TimeMap(tempi, meters, this.measures.length > 0 ? this.measures : undefined);
    setTimeMapExplicitEntries(timeMap, explicitTempi, explicitMeters);
    const parts = [...this.parts.values()].map(({data, notes}) => new Part({...data, notes}));
    const measures = this.measures;

    return new Score({
      id: this.newScoreId(),
      metadata: this.metadata,
      parts,
      measures,
      timeMap,
    });
  }
}
