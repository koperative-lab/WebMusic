import {isPitchedNote, noteDurationTicks, noteMidi, type Note, type Part, type Score} from '../../core';
import {
  EPSILON,
  mergeAdjacent,
  resolveChordWindowQuarters,
  segmentChords,
  sweepChordPieces,
  type SweepCandidate,
} from '../core/chords';
import {keyFromHistogram} from '../core/key';
import {motifsFromEntries, partMotifEntries, resolveMotifOptions, type MotifEntry} from '../core/motif';
import {pitchClass} from '../core/pitch-class';
import {romanNumeralForChord} from '../core/roman';
import {buildVoiceLanes, laneLeapIssues, pairIssues, type VoiceLane} from '../core/voice-leading';
import type {ChordSegment, KeyResult, Motif, RNAResult, VoiceLeadingIssue} from '../core/types';

/**
 * Everything `createAnalysisSession` computes for a score. Field names match
 * the return shape of `useScoreAnalysis` in `@webmusic/score/react`.
 */
export interface AnalysisResult {
  /** Krumhansl–Schmuckler key estimate (same as `detectKey`). */
  readonly key: KeyResult;
  /** Harmonic segmentation (same as `segmentChords`). */
  readonly chords: ReadonlyArray<ChordSegment>;
  /** Roman-numeral analysis of `chords` in `key` (same as `romanNumerals`). */
  readonly roman: ReadonlyArray<RNAResult>;
  /** Repeated melodic motifs (same as `findMotifs`). */
  readonly motifs: ReadonlyArray<Motif>;
  /** Voice-leading issues (same as `voiceLeading`). */
  readonly issues: ReadonlyArray<VoiceLeadingIssue>;
}

/**
 * Make a complete analysis snapshot transitively immutable in place.
 *
 * Session results intentionally reuse chord, motif, and voice-leading objects
 * from identity-keyed caches. Freezing every reachable public value preserves
 * that reuse without allowing one consumer to corrupt a later update, another
 * session, or the in-process Worker fallback. Worker clients also apply this
 * helper after structured-clone delivery so both execution modes expose the
 * same ownership contract.
 *
 * @internal
 */
export function freezeAnalysisResult(result: AnalysisResult): AnalysisResult {
  for (const score of result.key.scores) Object.freeze(score);
  Object.freeze(result.key.scores);
  Object.freeze(result.key);

  for (const segment of result.chords) {
    Object.freeze(segment.pitchClasses);
    Object.freeze(segment);
  }
  Object.freeze(result.chords);

  for (const entry of result.roman) Object.freeze(entry);
  Object.freeze(result.roman);

  for (const motif of result.motifs) {
    Object.freeze(motif.intervals);
    Object.freeze(motif.rhythm);
    for (const occurrence of motif.occurrences) {
      Object.freeze(occurrence.noteIndexes);
      Object.freeze(occurrence);
    }
    Object.freeze(motif.occurrences);
    Object.freeze(motif);
  }
  Object.freeze(result.motifs);

  for (const issue of result.issues) {
    Object.freeze(issue.voices);
    if (issue.voiceParts) Object.freeze(issue.voiceParts);
    Object.freeze(issue);
  }
  Object.freeze(result.issues);

  return Object.freeze(result);
}

/** Options for {@link createAnalysisSession}. Fixed for the session's lifetime. */
export interface AnalysisSessionOptions {
  /** Chord window length in quarter notes (see `ChordWindowOptions`). Default `2`. */
  windowQuarters?: number;
  /** Notes per motif (see `MotifOptions.length`). Default `4`. */
  motifLength?: number;
  /** Minimum motif repeats (see `MotifOptions.minOccurrences`). Default `2`. */
  minOccurrences?: number;
}

/**
 * A live analysis over an evolving score. `update(next)` recomputes only what
 * the edit touched (see {@link createAnalysisSession}) and is guaranteed to
 * return a result deep-equal to a from-scratch analysis of `next`.
 */
export interface AnalysisSession {
  /** The score the current `result` describes. */
  readonly score: Score;
  /** Analysis of `score`. Stable reference until the next `update`. */
  readonly result: AnalysisResult;
  /**
   * Re-analyze after an edit. Parts that kept identity (`===`) across the
   * edit — which `Score.withPart` / `Score.edit` guarantee for untouched
   * parts — are not rescanned. Calling with the current score is a no-op
   * that returns the cached result.
   */
  update(score: Score): AnalysisResult;
}

// ---------------------------------------------------------------------------
// Pure per-part / per-lane caches. All results below are pure functions of
// the (immutable, frozen) Part or VoiceLane they are keyed on, so module-level
// WeakMaps are safe to share across sessions and never go stale: an edited
// part is a NEW object with empty caches, an untouched part keeps identity
// and therefore its cached analysis.
// ---------------------------------------------------------------------------

interface PartHistogram {
  hist: Float64Array; // 12 duration-weighted pitch-class bins (integer ticks)
  total: number;
}

interface PartSounding {
  notes: readonly Note[];
  onsets: Float64Array;
  offsets: Float64Array;
}

const histogramCache = new WeakMap<Part, PartHistogram>();
const soundingCache = new WeakMap<Part, PartSounding>();
const lanesCache = new WeakMap<Part, VoiceLane[]>();
const leapCache = new WeakMap<VoiceLane, VoiceLeadingIssue[]>();
const pairCache = new WeakMap<VoiceLane, WeakMap<VoiceLane, VoiceLeadingIssue[]>>();
const motifEntryCache = new WeakMap<Part, Map<number, MotifEntry[]>>();

/** Tonal pitched notes of a part with float onsets/offsets, cached. */
function partSounding(part: Part): PartSounding {
  let cached = soundingCache.get(part);
  if (!cached) {
    let hasNonPitched = false;
    for (const note of part.notes) {
      if (!isPitchedNote(note)) {
        hasNonPitched = true;
        break;
      }
    }
    const notes = hasNonPitched ? part.notes.filter(isPitchedNote) : part.notes;
    const onsets = new Float64Array(notes.length);
    const offsets = new Float64Array(notes.length);
    for (let index = 0; index < notes.length; index += 1) {
      onsets[index] = notes[index].onsetQuarters.toFloat();
      offsets[index] = notes[index].offsetQuarters.toFloat();
    }
    cached = {notes, onsets, offsets};
    soundingCache.set(part, cached);
  }
  return cached;
}

/**
 * Duration-weighted pitch-class histogram of one part's sounding notes.
 * Weights are integer tick counts (`noteDurationTicks` rounds), so summing
 * per-part histograms is exact and bit-identical to the global accumulation
 * `detectKey` performs.
 */
function partHistogram(part: Part): PartHistogram {
  let cached = histogramCache.get(part);
  if (!cached) {
    const hist = new Float64Array(12);
    let total = 0;
    for (const note of partSounding(part).notes) {
      const weight = noteDurationTicks(note);
      hist[pitchClass(noteMidi(note))] += weight;
      total += weight;
    }
    cached = {hist, total};
    histogramCache.set(part, cached);
  }
  return cached;
}

function partLanes(part: Part): VoiceLane[] {
  let lanes = lanesCache.get(part);
  if (!lanes) {
    lanes = buildVoiceLanes(part);
    lanesCache.set(part, lanes);
  }
  return lanes;
}

function laneLeaps(lane: VoiceLane): VoiceLeadingIssue[] {
  let issues = leapCache.get(lane);
  if (!issues) {
    issues = laneLeapIssues(lane);
    leapCache.set(lane, issues);
  }
  return issues;
}

function lanePair(a: VoiceLane, b: VoiceLane): VoiceLeadingIssue[] {
  let inner = pairCache.get(a);
  if (!inner) {
    inner = new WeakMap();
    pairCache.set(a, inner);
  }
  let issues = inner.get(b);
  if (!issues) {
    issues = pairIssues(a, b);
    inner.set(b, issues);
  }
  return issues;
}

function partEntries(part: Part, length: number): MotifEntry[] {
  let byLength = motifEntryCache.get(part);
  if (!byLength) {
    byLength = new Map();
    motifEntryCache.set(part, byLength);
  }
  let entries = byLength.get(length);
  if (!entries) {
    entries = partMotifEntries(part, length);
    byLength.set(length, entries);
  }
  return entries;
}

// ---------------------------------------------------------------------------
// Incremental algorithms over the per-part caches.
// ---------------------------------------------------------------------------

/** detectKey via cached per-part histograms: O(changed parts) + O(1) ranking. */
function incrementalKey(score: Score): KeyResult {
  const hist = Array.from({length: 12}, () => 0);
  let total = 0;
  for (const part of score.parts) {
    const partial = partHistogram(part);
    for (let pc = 0; pc < 12; pc += 1) hist[pc] += partial.hist[pc];
    total += partial.total;
  }
  return keyFromHistogram(hist, total);
}

/** voiceLeading via cached lanes / lane pairs: unchanged-part pairs are free. */
function incrementalVoiceLeading(score: Score): VoiceLeadingIssue[] {
  const lanes: VoiceLane[] = [];
  for (const part of score.parts) {
    for (const lane of partLanes(part)) lanes.push(lane);
  }
  const issues: VoiceLeadingIssue[] = [];
  for (const lane of lanes) {
    for (const issue of laneLeaps(lane)) issues.push(issue);
  }
  for (let a = 0; a < lanes.length; a += 1) {
    for (let b = a + 1; b < lanes.length; b += 1) {
      for (const issue of lanePair(lanes[a], lanes[b])) issues.push(issue);
    }
  }
  return issues;
}

/** findMotifs via cached per-part window scans + cheap global merge. */
function incrementalMotifs(score: Score, length: number, minOccurrences: number): Motif[] {
  return motifsFromEntries(
    score.parts.map((part) => partEntries(part, length)),
    minOccurrences,
  );
}

/** Dirty time window of an edit, in float quarters. */
interface DirtyWindow {
  start: number;
  end: number;
}

/**
 * Compare an old and new version of a part (same id, different identity) and
 * return the time window containing every added/removed/replaced note's full
 * sounding interval, or null when the note lists are identical. Notes are
 * sorted by onset, so the common prefix/suffix (by Note identity, which
 * `Score.edit` preserves for untouched notes) brackets the changed range.
 */
function partDirtyWindow(oldPart: Part, newPart: Part): DirtyWindow | null {
  const a = oldPart.notes;
  const b = newPart.notes;
  if (a === b) return null;
  const minLength = Math.min(a.length, b.length);
  let prefix = 0;
  while (prefix < minLength && a[prefix] === b[prefix]) prefix += 1;
  let suffix = 0;
  while (suffix < minLength - prefix && a[a.length - 1 - suffix] === b[b.length - 1 - suffix]) {
    suffix += 1;
  }

  let start = Infinity;
  let end = -Infinity;
  const scan = (notes: readonly Note[], from: number, to: number): void => {
    for (let index = from; index < to; index += 1) {
      const onset = notes[index].onsetQuarters.toFloat();
      const offset = notes[index].offsetQuarters.toFloat();
      if (onset < start) start = onset;
      if (offset > end) end = offset;
    }
  };
  scan(a, prefix, a.length - suffix);
  scan(b, prefix, b.length - suffix);
  if (!(end >= start)) return null; // element-wise identical (new array, same notes)
  return {start, end};
}

/**
 * Collect the sweep candidates of `score` overlapping the half-open window
 * `[t0, t1)`, in `scoreNotes` order with the exact global `pos` the full
 * `segmentChords` would assign (so tie-breaks reproduce the full sweep).
 */
function collectCandidates(score: Score, t0: number, t1: number): SweepCandidate[] {
  const candidates: SweepCandidate[] = [];
  let pos = 0;
  for (const part of score.parts) {
    const {notes, onsets, offsets} = partSounding(part);
    for (let index = 0; index < notes.length; index += 1) {
      pos += 1;
      const onset = onsets[index];
      const offset = offsets[index];
      if (offset - onset < EPSILON) continue; // zero-length: never sounds
      if (offset <= t0 || onset >= t1) continue; // outside the window
      candidates.push({note: notes[index], onset, offset, pos});
    }
  }
  return candidates;
}

/**
 * Re-run the chord sweep only over the dirty window and splice the pieces
 * between the cached prefix/suffix segments, re-merging at the seams.
 *
 * Window bounds are snapped OUTWARD to cached merged-segment boundaries
 * strictly outside the dirty window. Those boundaries are note onset/offset
 * times of notes untouched by the edit, hence flush boundaries of the new
 * score's full sweep too — which makes the splice reproduce the full sweep
 * exactly (active sets, subdivision phase and Set insertion order all match).
 */
function spliceChords(
  previous: readonly ChordSegment[],
  score: Score,
  dirty: DirtyWindow,
  windowQuarters: number,
): ChordSegment[] {
  // Prefix: cached segments ending strictly before the dirty window.
  let prefixEnd = 0;
  while (prefixEnd < previous.length && previous[prefixEnd].endQuarters < dirty.start - EPSILON) {
    prefixEnd += 1;
  }
  // Suffix: cached segments starting strictly after the dirty window.
  let suffixStart = previous.length;
  while (suffixStart > prefixEnd && previous[suffixStart - 1].startQuarters > dirty.end + EPSILON) {
    suffixStart -= 1;
  }

  const t0 = prefixEnd > 0 ? previous[prefixEnd - 1].endQuarters : 0;
  const t1 = suffixStart < previous.length ? previous[suffixStart].startQuarters : Infinity;
  const end = score.durationQuarters.toFloat();
  const pieces = sweepChordPieces(collectCandidates(score, t0, t1), windowQuarters, t0, t1, end);

  // Merge only at the seams: cached segments are already merged-maximal and
  // their values did not change, so a new merge can only join the LAST prefix
  // segment and/or the FIRST suffix segment with the re-swept pieces. All
  // other cached segments are reused by reference (mergeAdjacent copies
  // before mutating, so the reused objects are never written to).
  const seam: ChordSegment[] = [];
  if (prefixEnd > 0) seam.push(previous[prefixEnd - 1]);
  for (const piece of pieces) seam.push(piece);
  if (suffixStart < previous.length) seam.push(previous[suffixStart]);

  return [
    ...previous.slice(0, Math.max(0, prefixEnd - 1)),
    ...mergeAdjacent(seam),
    ...previous.slice(Math.min(previous.length, suffixStart + 1)),
  ];
}

const ROMAN_CACHE_LIMIT = 10000;

class AnalysisSessionImpl implements AnalysisSession {
  #score: Score;
  #result: AnalysisResult;
  readonly #windowQuarters: number;
  readonly #motifLength: number;
  readonly #minOccurrences: number;
  /** Memo for `romanNumeralForChord` keyed by chord symbol + key. */
  readonly #romanCache = new Map<string, string>();
  /**
   * RNAResult per chord-segment identity, valid for `#romanKeyId` only.
   * Unchanged segments are reused by reference across updates (the splice
   * keeps them), so their roman entries are reused too.
   */
  #romanBySegment = new WeakMap<ChordSegment, RNAResult>();
  #romanKeyId = '';

  constructor(score: Score, options: AnalysisSessionOptions) {
    this.#score = score;
    this.#windowQuarters = resolveChordWindowQuarters(options.windowQuarters);
    const motifOptions = resolveMotifOptions({
      length: options.motifLength,
      minOccurrences: options.minOccurrences,
    });
    this.#motifLength = motifOptions.length;
    this.#minOccurrences = motifOptions.minOccurrences;
    this.#result = this.#analyze(score, null);
  }

  get score(): Score {
    return this.#score;
  }

  get result(): AnalysisResult {
    return this.#result;
  }

  update(score: Score): AnalysisResult {
    if (score === this.#score) return this.#result;
    this.#result = this.#analyze(score, this.#score);
    this.#score = score;
    return this.#result;
  }

  #analyze(score: Score, previous: Score | null): AnalysisResult {
    const key = incrementalKey(score);
    const chords = this.#chords(score, previous);
    const keyId = `${key.tonic} ${key.mode}`;
    if (keyId !== this.#romanKeyId) {
      // The detected key changed: every roman numeral may change with it.
      this.#romanBySegment = new WeakMap();
      this.#romanKeyId = keyId;
    }
    const roman = chords.map((segment) => {
      let entry = this.#romanBySegment.get(segment);
      if (!entry) {
        entry = {
          startQuarters: segment.startQuarters,
          endQuarters: segment.endQuarters,
          chord: segment.chord,
          roman: this.#roman(segment.chord, key),
        };
        this.#romanBySegment.set(segment, entry);
      }
      return entry;
    });
    const motifs = incrementalMotifs(score, this.#motifLength, this.#minOccurrences);
    const issues = incrementalVoiceLeading(score);
    return freezeAnalysisResult({key, chords, roman, motifs, issues});
  }

  #chords(score: Score, previous: Score | null): ReadonlyArray<ChordSegment> {
    // The dirty-window splice assumes the part list itself is stable (same
    // ids in the same order): adding/removing/reordering parts changes the
    // global sweep order, so fall back to a full segmentation there.
    const sameStructure =
      previous != null &&
      previous.parts.length === score.parts.length &&
      previous.parts.every((part, index) => part.id === score.parts[index].id);
    if (!sameStructure) return segmentChords(score, {windowQuarters: this.#windowQuarters});

    let dirty: DirtyWindow | null = null;
    for (let index = 0; index < score.parts.length; index += 1) {
      const window = partDirtyWindow(previous.parts[index], score.parts[index]);
      if (!window) continue;
      dirty = dirty
        ? {start: Math.min(dirty.start, window.start), end: Math.max(dirty.end, window.end)}
        : window;
    }
    if (!dirty) return this.#result.chords; // notes unchanged → segments unchanged

    return spliceChords(this.#result.chords, score, dirty, this.#windowQuarters);
  }

  #roman(chord: string, key: KeyResult): string {
    const cacheKey = `${chord}\0${key.tonic}\0${key.mode}`;
    let roman = this.#romanCache.get(cacheKey);
    if (roman === undefined) {
      roman = romanNumeralForChord(chord, key);
      if (this.#romanCache.size >= ROMAN_CACHE_LIMIT) this.#romanCache.clear();
      this.#romanCache.set(cacheKey, roman);
    }
    return roman;
  }
}

/**
 * Create an incremental analysis session over a score.
 *
 * `session.result` is a full analysis (key, chords, roman numerals, motifs,
 * voice-leading issues — the same values `detectKey`, `segmentChords`,
 * `romanNumerals`, `findMotifs` and `voiceLeading` return). After an edit,
 * `session.update(nextScore)` recomputes only what changed, relying on the
 * core model's structural sharing: parts untouched by `Score.edit` /
 * `Score.withPart` keep object identity and skip re-analysis entirely.
 *
 * Per-algorithm strategy:
 * - key: per-part pitch-class histograms are cached; ranking is O(1).
 * - chords/roman: the sweep re-runs only over the edited time window and the
 *   result is spliced into the cached segment list (full re-segmentation only
 *   when parts are added/removed/reordered).
 * - voice leading: lanes and lane-pair issues are cached per part identity;
 *   only pairs involving an edited part are re-checked.
 * - motifs: per-part window scans are cached; an edit rescans only the edited
 *   part, plus a cheap global merge.
 *
 * Invariant: `update(s).result` deep-equals a from-scratch analysis of `s`
 * (array/object identities may differ).
 *
 * ```ts
 * const session = createAnalysisSession(score, {windowQuarters: 2});
 * render(session.result);
 * const next = score.edit((tx) => tx.updateNote(id, {pitch}));
 * render(session.update(next)); // O(edit), not O(score)
 * ```
 */
export function createAnalysisSession(
  score: Score,
  options: AnalysisSessionOptions = {},
): AnalysisSession {
  return new AnalysisSessionImpl(score, options);
}
