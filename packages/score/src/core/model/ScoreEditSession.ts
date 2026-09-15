import type {NoteId, PartId, MeasureId} from '../types/ids';
import {
  hasTimeMapExplicitEntryOrigins,
  isExplicitMeterEntry,
  isExplicitTempoEntry,
  setTimeMapExplicitEntries,
  TimeMap,
  type MeterEntry,
  type TempoEntry,
} from '../time/TimeMap';
import {Rational} from '../primitives/Rational';
import {Measure, type MeasureData} from './Measure';
import {Note, type NoteData} from './Note';
import {
  Part,
  getPartNoteLookup,
  getPartQueryIndex,
  makePartFromSorted,
  seedPartNoteLookup,
  type PartQueryIndex,
} from './Part';
import type {Score, ScoreData} from './Score';

/** Buffered operations for one part. */
interface PartOps {
  /** id → replacement Note (same id, possibly different onset). */
  updates: Map<NoteId, Note>;
  removes: Set<NoteId>;
  /** id → added Note (insertion order preserved). */
  adds: Map<NoteId, Note>;
}

/** Relative epsilon matching the query fast path (see query/queries.ts). */
const FLOAT_EPS = 1e-9;

/** Strict onset order with float fast path and exact Rational fallback. */
function onsetBefore(a: Note, aF: number, b: Note, bF: number): boolean {
  const eps = FLOAT_EPS * Math.max(1, Math.abs(aF), Math.abs(bF));
  const d = aF - bF;
  if (d < -eps) return true;
  if (d > eps) return false;
  return a.onsetQuarters.cmp(b.onsetQuarters) < 0;
}

function samePosition(a: Rational, b: Rational): boolean {
  return a.eq(b);
}

function sameTempo(entry: TempoEntry, measure: Measure): boolean {
  return (
    measure.tempo !== undefined &&
    entry.bpm === measure.tempo.bpm &&
    (entry.unit ?? 1) === (measure.tempo.unit ?? 1)
  );
}

function sameMeter(entry: MeterEntry, measure: Measure): boolean {
  return (
    measure.timeSignature !== undefined &&
    entry.timeSignature.numerator === measure.timeSignature.numerator &&
    entry.timeSignature.denominator === measure.timeSignature.denominator
  );
}

function hasTempoAt(entries: ReadonlyArray<TempoEntry>, atQuarters: Rational): boolean {
  return entries.some((entry) => samePosition(entry.atQuarters, atQuarters));
}

function hasMeterAt(entries: ReadonlyArray<MeterEntry>, atQuarters: Rational): boolean {
  return entries.some((entry) => samePosition(entry.atQuarters, atQuarters));
}

/** Stable onset sort shared by Score and TimeMap construction. */
function sortMeasures(measures: ReadonlyArray<Measure>): Measure[] {
  return [...measures].sort((a, b) => a.onsetQuarters.cmp(b.onsetQuarters));
}

/**
 * Measure:Beat:Subbeat addresses use the display measure number as their
 * measure coordinate. A duplicate therefore makes TimeMap.mbsToQuarters
 * inherently ambiguous, even when the measure ids and onsets differ.
 */
function assertUniqueMeasureNumbers(measures: ReadonlyArray<Measure>): void {
  const seen = new Map<number, MeasureId>();
  for (const measure of measures) {
    const first = seen.get(measure.number);
    if (first !== undefined) {
      throw new Error(
        `Duplicate measure number ${measure.number}: measures ${first} and ${measure.id} make Measure:Beat:Subbeat ambiguous`,
      );
    }
    seen.set(measure.number, measure.id);
  }
}

/**
 * Reconcile a score's timeline after measure edits.
 *
 * Measure tempo/time-signature fields are a source of TimeMap entries, but a
 * builder may also carry explicit entries at the same position. We preserve
 * those explicit overrides (tracked privately by ScoreBuilder), remove stale
 * inferred entries, then re-derive the current measure metadata. A directly
 * constructed TimeMap has no provenance at all; in that case every existing
 * timeline entry is conservatively preserved as independently authored.
 */
function rebuildMeasureTimeMap(
  base: TimeMap,
  previousMeasures: ReadonlyArray<Measure>,
  nextMeasures: ReadonlyArray<Measure>,
): TimeMap {
  const currentMeasures = sortMeasures(nextMeasures);
  const hasOrigins = hasTimeMapExplicitEntryOrigins(base);
  const retainsTempo = (entry: TempoEntry): boolean => !hasOrigins || isExplicitTempoEntry(base, entry);
  const retainsMeter = (entry: MeterEntry): boolean => !hasOrigins || isExplicitMeterEntry(base, entry);
  const tempi = base.tempi.filter((entry) => {
    if (retainsTempo(entry)) return true;
    return !previousMeasures.some(
      (measure) => samePosition(entry.atQuarters, measure.onsetQuarters) && sameTempo(entry, measure),
    );
  });
  const meters = base.meters.filter((entry) => {
    if (retainsMeter(entry)) return true;
    return !previousMeasures.some(
      (measure) => samePosition(entry.atQuarters, measure.onsetQuarters) && sameMeter(entry, measure),
    );
  });

  // An unmarked default at quarter zero was synthesized by ScoreBuilder, not
  // explicitly requested. Let a newly added measure-level event replace it.
  const firstMeasure = currentMeasures.find((measure) => measure.onsetQuarters.eq(Rational.ZERO));
  if (firstMeasure?.tempo && !retainsTempo(base.tempi[0])) {
    for (let index = tempi.length - 1; index >= 0; index -= 1) {
      const entry = tempi[index];
      if (entry.atQuarters.eq(Rational.ZERO) && entry.bpm === 120 && (entry.unit ?? 1) === 1) {
        tempi.splice(index, 1);
      }
    }
  }
  if (firstMeasure?.timeSignature && !retainsMeter(base.meters[0])) {
    for (let index = meters.length - 1; index >= 0; index -= 1) {
      const entry = meters[index];
      if (
        entry.atQuarters.eq(Rational.ZERO) &&
        entry.timeSignature.numerator === 4 &&
        entry.timeSignature.denominator === 4
      ) {
        meters.splice(index, 1);
      }
    }
  }

  for (const measure of currentMeasures) {
    if (measure.tempo && !hasTempoAt(tempi, measure.onsetQuarters)) {
      tempi.push({
        atQuarters: measure.onsetQuarters,
        bpm: measure.tempo.bpm,
        unit: measure.tempo.unit,
      });
    }
    if (measure.timeSignature && !hasMeterAt(meters, measure.onsetQuarters)) {
      meters.push({
        atQuarters: measure.onsetQuarters,
        timeSignature: measure.timeSignature,
        measureNumber: measure.number,
      });
    }
  }

  if (!hasTempoAt(tempi, Rational.ZERO)) tempi.push({atQuarters: Rational.ZERO, bpm: 120});
  if (!hasMeterAt(meters, Rational.ZERO)) {
    meters.push({
      atQuarters: Rational.ZERO,
      measureNumber: currentMeasures[0]?.number ?? 1,
      timeSignature: {numerator: 4, denominator: 4},
    });
  }

  const timeMap = new TimeMap(tempi, meters, currentMeasures);
  setTimeMapExplicitEntries(
    timeMap,
    base.tempi.filter(retainsTempo),
    base.meters.filter(retainsMeter),
  );
  return timeMap;
}

/**
 * Buffered batch-edit transaction for a Score, obtained via `score.edit(fn)`.
 *
 * Every method is O(1)-ish: operations are buffered, validated against the
 * base score, and applied in ONE incremental rebuild when `score.edit`
 * commits. Only the touched parts are rebuilt (and the rebuild reuses the
 * previous part's sorted order and query index, so it is a merge, not a
 * re-sort); untouched parts — and all their caches — are shared by reference.
 *
 * The base score is never modified; commit produces a new immutable Score.
 */
export class ScoreEditSession {
  private readonly base: Score;
  private closed = false;
  private readonly partOps = new Map<PartId, PartOps>();
  /** Which part each note added in this session belongs to. */
  private readonly addedNoteToPart = new Map<NoteId, PartId>();
  private measureUpdates: Map<MeasureId, Measure> | null = null;
  private measureRemoves: Set<MeasureId> | null = null;
  private measureAdds: Map<MeasureId, Measure> | null = null;

  /** @internal Constructed by `Score.edit`; not part of the public API. */
  constructor(base: Score) {
    this.base = base;
  }

  // --- Note operations ---

  /**
   * Replace fields of an existing note (including one added earlier in this
   * session). The patch may move the note in time; it may not change its id.
   * Throws on unknown ids and on notes already removed in this session.
   */
  updateNote(id: NoteId, patch: Partial<NoteData>): void {
    this.assertOpen();
    if (patch.id !== undefined && patch.id !== id) {
      throw new Error(`updateNote cannot change a note's id (${id} → ${patch.id})`);
    }
    // Note added earlier in this session?
    const addedPart = this.addedNoteToPart.get(id);
    if (addedPart !== undefined) {
      const ops = this.opsFor(addedPart);
      ops.adds.set(id, ops.adds.get(id)!.with(patch));
      return;
    }
    const owner = this.findOwner(id);
    if (!owner) throw new Error(`Unknown note id: ${id}`);
    const ops = this.opsFor(owner.part.id);
    if (ops.removes.has(id)) {
      throw new Error(`Note ${id} was already removed in this edit session`);
    }
    const current = ops.updates.get(id) ?? owner.note;
    ops.updates.set(id, current.with(patch));
  }

  /**
   * Remove a note (existing, or added earlier in this session).
   * Throws on unknown ids and on double removal.
   */
  removeNote(id: NoteId): void {
    this.assertOpen();
    const addedPart = this.addedNoteToPart.get(id);
    if (addedPart !== undefined) {
      this.opsFor(addedPart).adds.delete(id);
      this.addedNoteToPart.delete(id);
      return;
    }
    const owner = this.findOwner(id);
    if (!owner) throw new Error(`Unknown note id: ${id}`);
    const ops = this.opsFor(owner.part.id);
    if (ops.removes.has(id)) {
      throw new Error(`Note ${id} was already removed in this edit session`);
    }
    ops.updates.delete(id);
    ops.removes.add(id);
  }

  /**
   * Add a note to an existing part. Accepts a Note or plain NoteData.
   * Throws on unknown parts and duplicate note ids. Returns the note's id.
   */
  addNote(partId: PartId, note: Note | NoteData): NoteId {
    this.assertOpen();
    const part = this.base.getPart(partId);
    if (!part) throw new Error(`Unknown part: ${partId}`);
    const n = note instanceof Note ? note : new Note(note);
    if (this.addedNoteToPart.has(n.id)) throw new Error(`Duplicate note id: ${n.id}`);
    const owner = this.findOwner(n.id);
    if (owner && !this.partOps.get(owner.part.id)?.removes.has(n.id)) {
      throw new Error(`Duplicate note id: ${n.id}`);
    }
    this.opsFor(partId).adds.set(n.id, n);
    this.addedNoteToPart.set(n.id, partId);
    return n.id;
  }

  // --- Measure operations ---

  /** Replace fields of a measure (existing, or added in this session). */
  updateMeasure(id: MeasureId, patch: Partial<MeasureData>): void {
    this.assertOpen();
    if (patch.id !== undefined && patch.id !== id) {
      throw new Error(`updateMeasure cannot change a measure's id (${id} → ${patch.id})`);
    }
    const added = this.measureAdds?.get(id);
    if (added) {
      this.measureAdds!.set(id, new Measure({...(added as MeasureData), ...patch}));
      return;
    }
    if (this.measureRemoves?.has(id)) {
      throw new Error(`Measure ${id} was already removed in this edit session`);
    }
    const current = this.measureUpdates?.get(id) ?? this.base.getMeasure(id);
    if (!current) throw new Error(`Unknown measure id: ${id}`);
    (this.measureUpdates ??= new Map()).set(id, new Measure({...(current as MeasureData), ...patch}));
  }

  /** Add a measure. Accepts a Measure or plain MeasureData. Returns its id. */
  addMeasure(measure: Measure | MeasureData): MeasureId {
    this.assertOpen();
    const m = measure instanceof Measure ? measure : new Measure(measure);
    const existing = this.base.getMeasure(m.id);
    if ((existing && !this.measureRemoves?.has(m.id)) || this.measureAdds?.has(m.id)) {
      throw new Error(`Duplicate measure id: ${m.id}`);
    }
    (this.measureAdds ??= new Map()).set(m.id, m);
    return m.id;
  }

  /** Remove a measure (existing, or added in this session). */
  removeMeasure(id: MeasureId): void {
    this.assertOpen();
    if (this.measureAdds?.delete(id)) return;
    if (this.measureRemoves?.has(id)) {
      throw new Error(`Measure ${id} was already removed in this edit session`);
    }
    if (!this.base.getMeasure(id)) throw new Error(`Unknown measure id: ${id}`);
    this.measureUpdates?.delete(id);
    (this.measureRemoves ??= new Set()).add(id);
  }

  // --- Internals ---

  private assertOpen(): void {
    if (this.closed) {
      throw new Error('Edit session already committed or aborted; perform edits inside score.edit(fn)');
    }
  }

  private opsFor(partId: PartId): PartOps {
    let ops = this.partOps.get(partId);
    if (!ops) {
      ops = {updates: new Map(), removes: new Set(), adds: new Map()};
      this.partOps.set(partId, ops);
    }
    return ops;
  }

  /** Find the part owning `id` in the base score (later parts win on dup ids). */
  private findOwner(id: NoteId): {part: Part; note: Note} | undefined {
    const parts = this.base.parts;
    for (let i = parts.length - 1; i >= 0; i--) {
      const note = getPartNoteLookup(parts[i]).lookup(id);
      if (note) return {part: parts[i], note};
    }
    return undefined;
  }

  private hasEdits(): boolean {
    for (const ops of this.partOps.values()) {
      if (ops.updates.size > 0 || ops.removes.size > 0 || ops.adds.size > 0) return true;
    }
    return (
      (this.measureUpdates?.size ?? 0) > 0 ||
      (this.measureRemoves?.size ?? 0) > 0 ||
      (this.measureAdds?.size ?? 0) > 0
    );
  }

  /** @internal Close the transaction even when its callback or commit failed. */
  _close(): void {
    this.closed = true;
  }

  /** @internal Called once by `Score.edit`. Returns derived data, or null for a no-op. */
  _commit(): ScoreData | null {
    this.assertOpen();
    this.closed = true;
    if (!this.hasEdits()) return null;

    const base = this.base;
    let parts: ReadonlyArray<Part> = base.parts;
    if (this.partOps.size > 0) {
      parts = base.parts.map((p) => {
        const ops = this.partOps.get(p.id);
        if (!ops || (ops.updates.size === 0 && ops.removes.size === 0 && ops.adds.size === 0)) {
          return p;
        }
        return this.rebuildPart(p, ops);
      });
    }

    let measures: ReadonlyArray<Measure> = base.measures;
    let timeMap = base.timeMap;
    if (this.measureUpdates || this.measureRemoves || this.measureAdds) {
      const out: Measure[] = [];
      for (const m of base.measures) {
        if (this.measureRemoves?.has(m.id)) continue;
        out.push(this.measureUpdates?.get(m.id) ?? m);
      }
      if (this.measureAdds) out.push(...this.measureAdds.values());
      measures = sortMeasures(out);
      assertUniqueMeasureNumbers(measures);
      timeMap = rebuildMeasureTimeMap(base.timeMap, base.measures, measures);
    }

    return {
      id: base.id,
      metadata: base.metadata,
      parts,
      measures,
      timeMap,
    };
  }

  /**
   * Apply this session's ops to one part WITHOUT re-sorting it: notes whose
   * onset is unchanged are replaced in place; moved/added notes are merged
   * into the (already sorted) survivors. The query index is patched from the
   * old part's Float64Arrays in the same pass, so the new Part skips both its
   * O(n log n) sort and its O(n) Rational→float index build.
   */
  private rebuildPart(part: Part, ops: PartOps): Part {
    const old = part.notes;
    const oldIdx = getPartQueryIndex(part);
    const lk = getPartNoteLookup(part);

    // Split updates: unchanged-onset updates are replaced in place (preserving
    // order among equal onsets, which chord grouping relies on); moved ones
    // join the adds in the sorted merge.
    const inPlace = new Map<NoteId, Note>();
    const incoming: Note[] = [];
    for (const [id, n] of ops.updates) {
      const prev = lk.lookup(id);
      if (prev && prev.onsetQuarters.eq(n.onsetQuarters)) inPlace.set(id, n);
      else incoming.push(n);
    }
    const movedIds = new Set<NoteId>(incoming.map((n) => n.id));
    for (const n of ops.adds.values()) incoming.push(n);
    incoming.sort((a, b) =>
      a.onsetQuarters.lt(b.onsetQuarters) ? -1 : a.onsetQuarters.gt(b.onsetQuarters) ? 1 : 0,
    );

    const k = incoming.length;
    const incOn = new Float64Array(k);
    const incOff = new Float64Array(k);
    // maxDuration is only used as a conservative query scan bound, so keeping
    // the old maximum after a removal is safe (never under-estimates).
    let maxDur = oldIdx.maxDurationFloat;
    for (let j = 0; j < k; j++) {
      incOn[j] = incoming[j].onsetQuarters.toFloat();
      incOff[j] = incoming[j].offsetQuarters.toFloat();
      const d = incOff[j] - incOn[j];
      if (d > maxDur) maxDur = d;
    }

    const cap = old.length + k;
    const notes: Note[] = [];
    const onF = new Float64Array(cap);
    const offF = new Float64Array(cap);
    let w = 0;
    let j = 0;
    for (let i = 0; i < old.length; i++) {
      const n = old[i];
      if (ops.removes.has(n.id) || movedIds.has(n.id)) continue;
      const aF = oldIdx.onsetFloats[i];
      // Drain incoming notes that sort strictly before this survivor
      // (ties keep existing notes first — same as a stable re-sort).
      while (j < k && onsetBefore(incoming[j], incOn[j], n, aF)) {
        notes.push(incoming[j]);
        onF[w] = incOn[j];
        offF[w] = incOff[j];
        w++;
        j++;
      }
      const repl = inPlace.get(n.id);
      if (repl) {
        const offFloat = repl.offsetQuarters.toFloat();
        const d = offFloat - aF;
        if (d > maxDur) maxDur = d;
        notes.push(repl);
        onF[w] = aF;
        offF[w] = offFloat;
      } else {
        notes.push(n);
        onF[w] = aF;
        offF[w] = oldIdx.offsetFloats[i];
      }
      w++;
    }
    while (j < k) {
      notes.push(incoming[j]);
      onF[w] = incOn[j];
      offF[w] = incOff[j];
      w++;
      j++;
    }

    const queryIndex: PartQueryIndex = {
      onsetFloats: w === cap ? onF : onF.slice(0, w),
      offsetFloats: w === cap ? offF : offF.slice(0, w),
      maxDurationFloat: maxDur,
    };
    const next = makePartFromSorted({...(part as Part), notes}, queryIndex);

    // Seed the id-lookup of the new part as a thin overlay over the old one
    // (only when the old lookup was materialized — i.e. getNote is in use).
    const added = new Map<NoteId, Note>();
    for (const [id, n] of inPlace) added.set(id, n);
    for (const n of incoming) added.set(n.id, n);
    seedPartNoteLookup(next, part, added, ops.removes);
    return next;
  }
}
