import {Rational} from '../primitives/Rational';
import type {NoteId, PartId} from '../types/ids';
import {Note} from './Note';
import {snapshotClefChange, snapshotDirection, snapshotNotationList, type PartClefChange, type PartDirection} from './notation';

/**
 * Transposing-instrument information, MusicXML semantics:
 * sounding MIDI = written MIDI + chromatic + 12 * octaveChange.
 * E.g. Bb clarinet = `{chromatic: -2, diatonic: -1}`.
 */
export interface Transpose {
  /** Chromatic transposition in semitones (sounding relative to written). */
  chromatic: number;
  /** Diatonic step transposition (spelling hint; informational). */
  diatonic?: number;
  /** Additional whole-octave displacement. */
  octaveChange?: number;
}

/**
 * Internal per-part query acceleration data, precomputed once at Part
 * construction. Kept off the Part instance (module-level WeakMap) so it never
 * appears in the public API or JSON output.
 *
 * Float onsets/offsets are exact for the common power-of-two and x/480-style
 * denominators; query code treats them as a fast pre-filter and falls back to
 * exact Rational comparison near boundaries.
 *
 * @internal
 */
export interface PartQueryIndex {
  /** Note onsets in quarters, as floats, in part.notes order (sorted). */
  readonly onsetFloats: Float64Array;
  /** Note offsets (onset + duration) in quarters, as floats, same order. */
  readonly offsetFloats: Float64Array;
  /** Maximum note duration in quarters, as a float (0 for an empty part). */
  readonly maxDurationFloat: number;
}

const queryIndexCache = new WeakMap<Part, PartQueryIndex>();

/**
 * Internal accessor for the precomputed query index of a Part.
 * Not re-exported from the package entry point.
 * @internal
 */
export function getPartQueryIndex(part: Part): PartQueryIndex {
  let idx = queryIndexCache.get(part);
  if (!idx) {
    // Parts constructed through the constructor always populate the cache;
    // this fallback only covers exotic instances (e.g. structuredClone).
    idx = buildQueryIndex(part);
    queryIndexCache.set(part, idx);
  }
  return idx;
}

function buildQueryIndex(part: Part): PartQueryIndex {
  const notes = part.notes;
  const n = notes.length;
  const onsetFloats = new Float64Array(n);
  const offsetFloats = new Float64Array(n);
  let maxDurationFloat = 0;
  for (let i = 0; i < n; i++) {
    const onset = notes[i].onsetQuarters.toFloat();
    const offset = notes[i].offsetQuarters.toFloat();
    onsetFloats[i] = onset;
    offsetFloats[i] = offset;
    const dur = offset - onset;
    if (dur > maxDurationFloat) maxDurationFloat = dur;
  }
  return {onsetFloats, offsetFloats, maxDurationFloat};
}

// ---------------------------------------------------------------------------
// Lazy derived caches (internal). All are keyed by Part object identity in
// module-level WeakMaps, so a freshly constructed Part automatically starts
// with empty caches and an unchanged Part shared between two Scores keeps its
// caches — there is no stale-cache hazard because Parts and Notes are frozen.
// ---------------------------------------------------------------------------

/**
 * Id → Note lookup for one part. Either a flat Map or a thin overlay over the
 * previous part-version's lookup (used by the incremental edit path so a
 * single-note edit does not pay an O(part) Map rebuild).
 * @internal
 */
export interface PartNoteLookup {
  lookup(id: NoteId): Note | undefined;
  /** Overlay chain depth; 0 for a flat Map. */
  readonly depth: number;
}

class FlatNoteLookup implements PartNoteLookup {
  readonly depth = 0;
  constructor(private readonly map: ReadonlyMap<NoteId, Note>) {}
  lookup(id: NoteId): Note | undefined {
    return this.map.get(id);
  }
}

class OverlayNoteLookup implements PartNoteLookup {
  readonly depth: number;
  constructor(
    private readonly parent: PartNoteLookup,
    private readonly added: ReadonlyMap<NoteId, Note>,
    private readonly removed: ReadonlySet<NoteId>,
  ) {
    this.depth = parent.depth + 1;
  }
  lookup(id: NoteId): Note | undefined {
    const n = this.added.get(id);
    if (n) return n;
    if (this.removed.has(id)) return undefined;
    return this.parent.lookup(id);
  }
}

/** Keep overlay chains short so lookups stay O(1)-ish across long edit runs. */
const MAX_LOOKUP_DEPTH = 12;

const noteLookupCache = new WeakMap<Part, PartNoteLookup>();
const soundingNotesCache = new WeakMap<Part, ReadonlyArray<Note>>();
const maxOffsetCache = new WeakMap<Part, Rational>();

/**
 * Id → Note lookup for a part, built lazily on first use (O(part) once) and
 * cached for the lifetime of the Part object.
 * @internal
 */
export function getPartNoteLookup(part: Part): PartNoteLookup {
  let lk = noteLookupCache.get(part);
  if (!lk) {
    const map = new Map<NoteId, Note>();
    for (const n of part.notes) map.set(n.id, n);
    lk = new FlatNoteLookup(map);
    noteLookupCache.set(part, lk);
  }
  return lk;
}

/**
 * Seed `newPart`'s id-lookup as a thin overlay over `oldPart`'s, when the old
 * part already materialized one (i.e. someone is actually calling getNote).
 * Falls back to staying lazy when the chain gets deep or the patch is large,
 * in which case the next lookup rebuilds a flat Map and resets the depth.
 * @internal
 */
export function seedPartNoteLookup(
  newPart: Part,
  oldPart: Part,
  added: ReadonlyMap<NoteId, Note>,
  removed: ReadonlySet<NoteId>,
): void {
  const parent = noteLookupCache.get(oldPart);
  if (!parent) return; // nobody asked for lookups yet — stay lazy
  if (parent.depth >= MAX_LOOKUP_DEPTH) return; // flatten lazily on next use
  if ((added.size + removed.size) * 4 > newPart.notes.length) return; // big patch
  noteLookupCache.set(newPart, new OverlayNoteLookup(parent, added, removed));
}

/**
 * The part's *sounding* notes (rests filtered out), lazily computed and
 * cached. Returns `part.notes` itself when the part has no rests.
 * @internal
 */
export function getPartSoundingNotes(part: Part): ReadonlyArray<Note> {
  let sounding = soundingNotesCache.get(part);
  if (!sounding) {
    const notes = part.notes;
    let hasRest = false;
    for (let i = 0; i < notes.length; i++) {
      if (notes[i].rest) {
        hasRest = true;
        break;
      }
    }
    sounding = hasRest ? Object.freeze(notes.filter((n) => !n.rest)) : notes;
    soundingNotesCache.set(part, sounding);
  }
  return sounding;
}

/** Relative epsilon matching the query fast path (see query/queries.ts). */
const FLOAT_EPS = 1e-9;

/**
 * Maximum note offset (onset + duration) of the part, in quarters, exact.
 * Computed lazily with a float scan over the precomputed query index plus an
 * exact Rational tie-break among near-maximal candidates, then cached.
 * Returns Rational.ZERO for an empty part.
 * @internal
 */
export function getPartMaxOffset(part: Part): Rational {
  let max = maxOffsetCache.get(part);
  if (!max) {
    const notes = part.notes;
    const {offsetFloats} = getPartQueryIndex(part);
    let maxF = -Infinity;
    for (let i = 0; i < offsetFloats.length; i++) {
      if (offsetFloats[i] > maxF) maxF = offsetFloats[i];
    }
    max = Rational.ZERO;
    if (notes.length > 0) {
      const eps = FLOAT_EPS * Math.max(1, Math.abs(maxF));
      let best: Rational | null = null;
      for (let i = 0; i < offsetFloats.length; i++) {
        if (offsetFloats[i] >= maxF - eps) {
          const off = notes[i].offsetQuarters;
          if (best === null || off.gt(best)) best = off;
        }
      }
      if (best && best.gt(max)) max = best;
    }
    maxOffsetCache.set(part, max);
  }
  return max;
}

// ---------------------------------------------------------------------------
// Trusted-presorted construction fast path (internal). Used by the edit
// session, which produces note arrays that are already sorted by onset and a
// query index patched from the previous part version, so the constructor can
// skip its O(n log n) sort and O(n) index build.
// ---------------------------------------------------------------------------

let trustedSortedNotes: ReadonlyArray<Note> | null = null;
let pendingQueryIndex: PartQueryIndex | null = null;

/**
 * Construct a Part from notes that are GUARANTEED sorted by onset, optionally
 * seeding its query index. The notes array is frozen and used as-is.
 * @internal
 */
export function makePartFromSorted(data: PartData, queryIndex?: PartQueryIndex): Part {
  trustedSortedNotes = data.notes;
  pendingQueryIndex = queryIndex ?? null;
  try {
    return new Part(data);
  } finally {
    trustedSortedNotes = null;
    pendingQueryIndex = null;
  }
}

export interface PartData {
  id: PartId;
  name: string;
  abbreviation?: string;
  /** General MIDI program 0..127. */
  midiProgram?: number;
  midiChannel?: number;
  /** Number of staves (piano = 2, vocals = 1). */
  staves?: number;
  /** Transposing-instrument info; absent means concert pitch. */
  transpose?: Transpose;
  /** Authored clefs, scoped to this part and staff at exact musical positions. */
  clefChanges?: readonly PartClefChange[];
  /** Authored text, expression and span endpoints at exact musical positions. */
  directions?: readonly PartDirection[];
  /** Will be sorted by onset on construction. */
  notes: ReadonlyArray<Note>;
}

function assertOptionalInteger(value: number | undefined, label: string, min: number, max = Infinity): void {
  if (value === undefined) return;
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new RangeError(`${label} must be an integer from ${min} to ${max}`);
  }
}

function assertValidTranspose(transpose: Transpose | undefined): void {
  if (transpose === undefined) return;
  if (!transpose || typeof transpose !== 'object') throw new TypeError('part transpose must be an object');
  assertOptionalInteger(transpose.chromatic, 'part transpose chromatic', -Infinity, Infinity);
  assertOptionalInteger(transpose.diatonic, 'part transpose diatonic', -Infinity, Infinity);
  assertOptionalInteger(transpose.octaveChange, 'part transpose octaveChange', -Infinity, Infinity);
}

function assertValidPartData(data: PartData): void {
  if (!data || typeof data !== 'object') throw new TypeError('part data must be an object');
  if (!Array.isArray(data.notes)) throw new TypeError('part notes must be an array');
  for (const note of data.notes) {
    if (!(note instanceof Note)) throw new TypeError('part notes must contain Note instances');
  }
  assertOptionalInteger(data.midiProgram, 'part midiProgram', 0, 127);
  assertOptionalInteger(data.midiChannel, 'part midiChannel', 0, 15);
  assertOptionalInteger(data.staves, 'part staves', 1);
  assertValidTranspose(data.transpose);
}

export class Part implements Readonly<PartData> {
  readonly id: PartId;
  readonly name: string;
  readonly abbreviation?: string;
  readonly midiProgram?: number;
  readonly midiChannel?: number;
  readonly staves?: number;
  readonly transpose?: Transpose;
  readonly clefChanges?: readonly PartClefChange[];
  readonly directions?: readonly PartDirection[];
  readonly notes: ReadonlyArray<Note>;

  constructor(data: PartData) {
    assertValidPartData(data);
    this.id = data.id;
    this.name = data.name;
    this.abbreviation = data.abbreviation;
    this.midiProgram = data.midiProgram;
    this.midiChannel = data.midiChannel;
    this.staves = data.staves;
    this.transpose = data.transpose && Object.freeze({...data.transpose});
    this.clefChanges = snapshotNotationList(data.clefChanges, snapshotClefChange);
    this.directions = snapshotNotationList(data.directions, snapshotDirection);
    if (trustedSortedNotes === data.notes) {
      // Internal fast path (makePartFromSorted): notes are pre-sorted.
      this.notes = Object.freeze(data.notes as Note[]);
    } else {
      this.notes = Object.freeze(
        [...data.notes].sort((a, b) =>
          a.onsetQuarters.lt(b.onsetQuarters) ? -1 : a.onsetQuarters.gt(b.onsetQuarters) ? 1 : 0,
        ),
      );
    }
    Object.freeze(this);
    // Precompute the internal query-acceleration index (one O(n) pass), unless
    // the internal fast path supplied one patched from a previous version.
    queryIndexCache.set(this, pendingQueryIndex ?? buildQueryIndex(this));
  }

  toJSON() {
    return {
      id: this.id,
      name: this.name,
      abbreviation: this.abbreviation,
      midiProgram: this.midiProgram,
      midiChannel: this.midiChannel,
      staves: this.staves,
      transpose: this.transpose,
      clefChanges: this.clefChanges?.map((change) => ({...change, onsetQuarters: change.onsetQuarters.toJSON()})),
      directions: this.directions?.map((direction) => ({...direction, onsetQuarters: direction.onsetQuarters.toJSON(),
        ...(direction.kind === 'metronome' ? {beatUnit: direction.beatUnit.toJSON()} : {})})),
      notes: this.notes.map((n) => n.toJSON()),
    };
  }
}
