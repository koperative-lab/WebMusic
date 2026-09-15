import {Rational} from '../primitives/Rational';
import {SCORE_JSON_SCHEMA_ID} from '../serialize/schema';
import {TimeMap} from '../time/TimeMap';
import type {MeasureId, NoteId, PartId, ScoreId} from '../types/ids';
import type {ScoreMetadata} from '../types/meta';
import {Measure} from './Measure';
import {Note} from './Note';
import {Part, getPartMaxOffset, getPartNoteLookup, getPartSoundingNotes} from './Part';
import {ScoreEditSession} from './ScoreEditSession';

export interface ScoreData {
  id: ScoreId;
  metadata: ScoreMetadata;
  parts: ReadonlyArray<Part>;
  measures: ReadonlyArray<Measure>;
  timeMap: TimeMap;
}

// ---------------------------------------------------------------------------
// Lazy score-level caches. Keyed by object identity in module-level WeakMaps
// (Score instances are frozen), so values are computed at most once per
// instance and there is no stale-cache hazard: a "modified" Score is always a
// new object with empty caches, while shared sub-objects (Parts, the measures
// array) legitimately keep theirs.
// ---------------------------------------------------------------------------

const notesViewCache = new WeakMap<Score, ReadonlyArray<Note>>();
const durationCache = new WeakMap<Score, Rational>();
// Keyed by the frozen measures ARRAY, which functional updates share by
// reference — withPart/edit reuse the previous result for free.
const measuresMaxOffsetCache = new WeakMap<ReadonlyArray<Measure>, Rational>();

/** Clone JSON-like metadata values before freezing the score's public view. */
function snapshotMetadataValue(value: unknown, seen = new WeakMap<object, unknown>()): unknown {
  if (Array.isArray(value)) {
    const cached = seen.get(value);
    if (cached) return cached;
    const copy: unknown[] = [];
    seen.set(value, copy);
    for (const item of value) copy.push(snapshotMetadataValue(item, seen));
    return Object.freeze(copy);
  }
  if (value && typeof value === 'object') {
    const proto = Object.getPrototypeOf(value);
    // Metadata extension values are intentionally open-ended. Preserve
    // non-plain objects rather than changing their semantics, while safely
    // snapshotting the JSON-like records and arrays they normally contain.
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
    return Object.freeze(copy);
  }
  return value;
}

function snapshotMetadata(metadata: ScoreMetadata): ScoreMetadata {
  return Object.freeze({
    ...metadata,
    ...(metadata.encoding
      ? {encoding: snapshotMetadataValue(metadata.encoding) as ScoreMetadata['encoding']}
      : {}),
    ...(metadata.custom
      ? {custom: snapshotMetadataValue(metadata.custom) as Record<string, unknown>}
      : {}),
  });
}

function measuresMaxOffset(measures: ReadonlyArray<Measure>): Rational {
  let max = measuresMaxOffsetCache.get(measures);
  if (!max) {
    max = Rational.ZERO;
    for (const m of measures) {
      const off = m.offsetQuarters;
      if (off.gt(max)) max = off;
    }
    measuresMaxOffsetCache.set(measures, max);
  }
  return max;
}

// Incremental-construction context: when a functional update derives a new
// Score from an existing one, the constructor reuses every precompute whose
// inputs are shared by reference (measures array, timeMap) instead of
// rebuilding them. Set only by buildScoreFrom below.
let inheritBase: Score | null = null;

/**
 * Construct a Score derived from `base`, reusing base precomputes whose
 * inputs (measures array, timeMap) are identical by reference.
 * @internal
 */
export function buildScoreFrom(base: Score, data: ScoreData): Score {
  inheritBase = base;
  try {
    return new Score(data);
  } finally {
    inheritBase = null;
  }
}

/**
 * Immutable top-level container.
 * All "mutations" return a new Score; views and analyses share references.
 */
export class Score implements Readonly<ScoreData> {
  readonly id: ScoreId;
  readonly metadata: ScoreMetadata;
  readonly parts: ReadonlyArray<Part>;
  readonly measures: ReadonlyArray<Measure>;
  readonly timeMap: TimeMap;

  private readonly _partById: ReadonlyMap<PartId, Part>;
  private readonly _measureById: ReadonlyMap<MeasureId, Measure>;
  // Precomputed legacy views: cheap (O(measures + tempo entries)) and reused
  // by reference across functional updates that keep measures/timeMap.
  private readonly _tempos: ReadonlyArray<{tick: number; bpm: number}>;
  private readonly _timeSignatures: ReadonlyArray<{
    tick: number;
    numerator: number;
    denominator: number;
  }>;
  private readonly _keySignatures: ReadonlyArray<{tick: number; fifths: number; mode?: string}>;

  constructor(data: ScoreData) {
    const base = inheritBase;
    inheritBase = null;

    this.id = data.id;
    this.metadata = snapshotMetadata(data.metadata);
    this.parts = Object.freeze([...data.parts]);
    this.timeMap = data.timeMap;

    if (base && data.measures === base.measures) {
      // Functional update sharing the measures array: reuse the sorted array,
      // the id map and the measure-derived key-signature view verbatim.
      this.measures = base.measures;
      this._measureById = base._measureById;
      this._keySignatures = base._keySignatures;
    } else {
      this.measures = Object.freeze(
        [...data.measures].sort((a, b) =>
          a.onsetQuarters.lt(b.onsetQuarters) ? -1 : a.onsetQuarters.gt(b.onsetQuarters) ? 1 : 0,
        ),
      );
      const measureMap = new Map<MeasureId, Measure>();
      for (const m of this.measures) measureMap.set(m.id, m);
      this._measureById = measureMap;

      const keySignatures: Array<{tick: number; fifths: number; mode?: string}> = [];
      for (const m of this.measures) {
        if (m.keySignature) {
          keySignatures.push(Object.freeze({
            tick: Math.round(m.onsetQuarters.toFloat() * 480),
            fifths: m.keySignature.fifths,
            mode: m.keySignature.mode,
          }));
        }
      }
      this._keySignatures = Object.freeze(keySignatures);
    }

    const partMap = new Map<PartId, Part>();
    for (const p of this.parts) partMap.set(p.id, p);
    this._partById = partMap;

    if (base && data.timeMap === base.timeMap) {
      this._tempos = base._tempos;
      this._timeSignatures = base._timeSignatures;
    } else {
      // Precompute legacy tick-shaped views once (the model is immutable), so
      // the getters below return stable references instead of allocating
      // fresh arrays on every access.
      this._tempos = Object.freeze(
        this.timeMap.tempi.map((t) => Object.freeze({
          tick: Math.round(t.atQuarters.toFloat() * 480),
          bpm: t.bpm * (t.unit ?? 1),
        })),
      );
      this._timeSignatures = Object.freeze(
        this.timeMap.meters.map((m) => Object.freeze({
          tick: Math.round(m.atQuarters.toFloat() * 480),
          numerator: m.timeSignature.numerator,
          denominator: m.timeSignature.denominator,
        })),
      );
    }

    Object.freeze(this);
  }

  getNote(id: NoteId): Note | undefined {
    // Per-part id lookups, lazily materialized and cached on the (immutable)
    // Part objects — unchanged parts keep their lookups across functional
    // updates. Reverse order so that, with pathological duplicate ids across
    // parts, the later part wins (matching the historical global-map build).
    const parts = this.parts;
    for (let i = parts.length - 1; i >= 0; i--) {
      const n = getPartNoteLookup(parts[i]).lookup(id);
      if (n) return n;
    }
    return undefined;
  }
  getPart(id: PartId): Part | undefined {
    return this._partById.get(id);
  }
  getMeasure(id: MeasureId): Measure | undefined {
    return this._measureById.get(id);
  }

  *allNotes(): IterableIterator<Note> {
    for (const part of this.parts) for (const n of part.notes) yield n;
  }

  /**
   * Last notated offset across all notes (including rests) and measure ends, in quarters.
   * Lazily computed from per-part cached maxima — O(parts) after a
   * single-part edit — then cached per instance.
   */
  get durationQuarters(): Rational {
    let dur = durationCache.get(this);
    if (!dur) {
      dur = measuresMaxOffset(this.measures);
      for (const p of this.parts) {
        const m = getPartMaxOffset(p);
        if (m.gt(dur)) dur = m;
      }
      durationCache.set(this, dur);
    }
    return dur;
  }

  get durationSeconds(): number {
    return this.timeMap.quartersToSeconds(this.durationQuarters);
  }

  // --- Legacy tick-based accessors (480 PPQ). ---

  /** Pulses per quarter for legacy tick math. Fixed at 480. */
  get ppq(): number {
    return 480;
  }

  /** Last notated position projected to ticks at 480 PPQ. */
  get durationTicks(): number {
    return Math.round(this.durationQuarters.toFloat() * 480);
  }

  /**
   * All *sounding* notes across all parts, in part order then onset.
   * Explicit rest notes are excluded; iterate `part.notes` or `allNotes()`
   * to see them. Lazily concatenated from per-part cached views (each part
   * is already sorted), then cached per instance — repeated access is O(1).
   */
  get notes(): ReadonlyArray<Note> {
    let view = notesViewCache.get(this);
    if (!view) {
      // Parts are pre-sorted and the flattened view is part-major, so this is
      // a plain concatenation — no re-sort needed.
      const notes: Note[] = [];
      for (const part of this.parts) {
        for (const note of getPartSoundingNotes(part)) notes.push(note);
      }
      view = Object.freeze(notes);
      notesViewCache.set(this, view);
    }
    return view;
  }

  get title(): string | undefined {
    return this.metadata.title;
  }

  get composer(): string | undefined {
    return this.metadata.composer;
  }

  /** Tempo changes as legacy {tick, bpm} entries; bpm is quarters per minute. */
  get tempos(): ReadonlyArray<{tick: number; bpm: number}> {
    return this._tempos;
  }

  /** Time-signature changes as legacy {tick, numerator, denominator} entries (precomputed). */
  get timeSignatures(): ReadonlyArray<{tick: number; numerator: number; denominator: number}> {
    return this._timeSignatures;
  }

  /** Key-signature changes scraped from measures, in legacy shape (precomputed). */
  get keySignatures(): ReadonlyArray<{tick: number; fifths: number; mode?: string}> {
    return this._keySignatures;
  }

  // --- Functional updates ---
  withMetadata(metadata: Partial<ScoreMetadata>): Score {
    return buildScoreFrom(this, {
      ...(this as ScoreData),
      metadata: {...this.metadata, ...metadata},
    });
  }

  withPart(part: Part): Score {
    // Replace in place to preserve part ordering (downstream code maps part
    // index → instrument/colour/staff); append only when the part is new.
    const index = this.parts.findIndex((p) => p.id === part.id);
    const parts =
      index === -1
        ? [...this.parts, part]
        : this.parts.map((p, i) => (i === index ? part : p));
    return buildScoreFrom(this, {...(this as ScoreData), parts});
  }

  withoutPart(partId: PartId): Score {
    return buildScoreFrom(this, {
      ...(this as ScoreData),
      parts: this.parts.filter((p) => p.id !== partId),
    });
  }

  /**
   * Batch edit: buffer note/measure operations on a transaction object, then
   * apply them in ONE incremental rebuild. Each operation is O(1)-ish; commit
   * cost is proportional to the touched parts, not the whole score. Returns a
   * new immutable Score; this one is untouched. If `fn` makes no changes the
   * same instance is returned. The callback must finish synchronously; the
   * transaction closes after success or failure and never changes this score.
   *
   * ```ts
   * const next = score.edit((tx) => {
   *   tx.updateNote(noteId, {onsetQuarters: new Rational(3, 2)});
   *   tx.removeNote(otherId);
   * });
   * ```
   */
  edit(fn: (tx: ScoreEditSession) => void): Score {
    const tx = new ScoreEditSession(this);
    try {
      fn(tx);
      const data = tx._commit();
      return data ? buildScoreFrom(this, data) : this;
    } finally {
      tx._close();
    }
  }

  toJSON() {
    return {
      $schema: SCORE_JSON_SCHEMA_ID,
      id: this.id,
      metadata: this.metadata,
      parts: this.parts.map((p) => p.toJSON()),
      measures: this.measures.map((m) => m.toJSON()),
      timeMap: this.timeMap.toJSON(),
    };
  }
}
