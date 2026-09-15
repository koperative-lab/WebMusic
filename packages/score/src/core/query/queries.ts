import type {Note} from '../model/Note';
import {getPartQueryIndex} from '../model/Part';
import type {Score} from '../model/Score';
import type {Rational} from '../primitives/Rational';

/** Options shared by the note queries. All flags are additive and optional. */
export interface NoteQueryOptions {
  /**
   * Include explicit rest notes (`note.rest === true`).
   * Default false — preserving the historical behaviour of returning only
   * sounding notes.
   */
  includeRests?: boolean;
  /**
   * Include grace notes. Default true.
   *
   * Grace notes typically have a zero notated duration, which the plain
   * "onset <= q < offset" test can never satisfy — historically `notesAt`
   * silently lost them. With this flag on (the default), `notesAt` returns
   * grace notes whose onset is exactly `q`, and `notesOverlapping` returns
   * grace notes whose onset lies in `[from, to)`. Set false to exclude
   * grace notes entirely.
   */
  includeGrace?: boolean;
}

/**
 * First index in `notes` (sorted by onset) whose onsetQuarters >= q;
 * notes.length if none.
 */
function lowerBoundByOnset(notes: ReadonlyArray<Note>, q: Rational): number {
  let lo = 0;
  let hi = notes.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (notes[mid].onsetQuarters.lt(q)) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Relative epsilon for the float fast path. Doubles carry ~2.2e-16 relative
 * error; 1e-9 leaves a huge safety margin while keeping the exact-Rational
 * fallback rare (floats for power-of-two and x/480-style denominators are
 * exact, so most boundary comparisons resolve in floats too).
 */
const FLOAT_EPS = 1e-9;

/**
 * Float fast-path three-way comparison. Returns -1/1 when the float values
 * are unambiguously ordered, or `undefined` when they are within epsilon of
 * each other and the caller must fall back to exact Rational comparison.
 */
function floatCmp(aF: number, bF: number): -1 | 1 | undefined {
  const eps = FLOAT_EPS * Math.max(1, Math.abs(aF), Math.abs(bF));
  const d = aF - bF;
  if (d > eps) return 1;
  if (d < -eps) return -1;
  return undefined;
}

/**
 * First index in `onsets` (sorted ascending) with onsets[i] >= x;
 * onsets.length if none. Used only for conservative scan-start bounds, so
 * pure float comparison is fine (callers subtract an epsilon from `x`).
 */
function lowerBoundFloat(onsets: Float64Array, x: number): number {
  let lo = 0;
  let hi = onsets.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (onsets[mid] < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Conservative scan-start index for window queries: the first note whose
 * onset could be >= `fromF - maxDurF`. Any note overlapping [from, …) has
 * onset >= from - maxDuration, so starting here never skips a match; the
 * epsilon absorbs float rounding of the bound itself.
 */
function scanStart(onsets: Float64Array, fromF: number, maxDurF: number): number {
  const bound = fromF - maxDurF;
  return lowerBoundFloat(onsets, bound - FLOAT_EPS * Math.max(1, Math.abs(bound)));
}

/**
 * Notes sounding exactly at quarter position `q`
 * (inclusive of onset, exclusive of offset).
 *
 * Rests are excluded unless `options.includeRests`. Grace notes (zero
 * duration) are included when their onset equals `q` exactly, unless
 * `options.includeGrace` is false.
 */
export function notesAt(score: Score, q: Rational, options?: NoteQueryOptions): Note[] {
  const includeRests = options?.includeRests ?? false;
  const includeGrace = options?.includeGrace ?? true;
  const out: Note[] = [];
  const qF = q.toFloat();
  for (const part of score.parts) {
    // Per-part notes are sorted by onset. Notes sounding at q must have
    // onset >= q - maxDuration, so binary-search the scan start, then stop
    // once onsets pass q. Floats are a fast pre-filter; comparisons within
    // epsilon of a boundary fall back to exact Rational comparison.
    const notes = part.notes;
    const {onsetFloats, offsetFloats, maxDurationFloat} = getPartQueryIndex(part);
    const start = scanStart(onsetFloats, qF, maxDurationFloat);
    for (let i = start; i < notes.length; i++) {
      const n = notes[i];
      const cOnset = floatCmp(onsetFloats[i], qF) ?? n.onsetQuarters.cmp(q);
      if (cOnset > 0) break;
      if (n.rest && !includeRests) continue;
      if (n.grace) {
        // Grace notes are usually zero-length; match on exact onset instead.
        if (
          includeGrace &&
          (cOnset === 0 || (floatCmp(offsetFloats[i], qF) ?? n.offsetQuarters.cmp(q)) > 0)
        ) {
          out.push(n);
        }
        continue;
      }
      if ((floatCmp(offsetFloats[i], qF) ?? n.offsetQuarters.cmp(q)) > 0) out.push(n);
    }
  }
  return out;
}

/**
 * Notes whose onset is in [from, to).
 *
 * Rests are excluded unless `options.includeRests`; grace notes are included
 * by default (their onset is well-defined even with zero duration).
 */
export function notesIn(
  score: Score,
  from: Rational,
  to: Rational,
  options?: NoteQueryOptions,
): Note[] {
  const includeRests = options?.includeRests ?? false;
  const includeGrace = options?.includeGrace ?? true;
  const out: Note[] = [];
  for (const part of score.parts) {
    // Per-part notes are sorted by onset: binary-search the window start,
    // then scan until onsets reach `to`.
    const notes = part.notes;
    for (let i = lowerBoundByOnset(notes, from); i < notes.length; i++) {
      const n = notes[i];
      if (n.onsetQuarters.gte(to)) break;
      if (n.rest && !includeRests) continue;
      if (n.grace && !includeGrace) continue;
      out.push(n);
    }
  }
  return out;
}

/**
 * Notes that overlap the half-open interval [from, to) in any way.
 * Empty or reversed intervals (to <= from) return no notes.
 *
 * Rests are excluded unless `options.includeRests`. Zero-duration grace
 * notes "overlap" when their onset lies in [from, to), unless
 * `options.includeGrace` is false. Other zero-duration notes have an empty
 * sounding interval and do not overlap.
 */
export function notesOverlapping(
  score: Score,
  from: Rational,
  to: Rational,
  options?: NoteQueryOptions,
): Note[] {
  if (to.lte(from)) return [];
  const includeRests = options?.includeRests ?? false;
  const includeGrace = options?.includeGrace ?? true;
  const out: Note[] = [];
  const fromF = from.toFloat();
  const toF = to.toFloat();
  for (const part of score.parts) {
    // Onsets are sorted (offsets are not). Overlapping notes have onset >=
    // from - maxDuration: binary-search the scan start, then stop once onsets
    // reach `to`. Floats are a fast pre-filter; comparisons within epsilon of
    // a boundary fall back to exact Rational comparison.
    const notes = part.notes;
    const {onsetFloats, offsetFloats, maxDurationFloat} = getPartQueryIndex(part);
    const start = scanStart(onsetFloats, fromF, maxDurationFloat);
    for (let i = start; i < notes.length; i++) {
      const n = notes[i];
      if ((floatCmp(onsetFloats[i], toF) ?? n.onsetQuarters.cmp(to)) >= 0) break;
      if (n.rest && !includeRests) continue;
      if (n.grace) {
        // A zero-length grace overlaps when its onset is inside the window.
        if (
          includeGrace &&
          ((floatCmp(onsetFloats[i], fromF) ?? n.onsetQuarters.cmp(from)) >= 0 ||
            (floatCmp(offsetFloats[i], fromF) ?? n.offsetQuarters.cmp(from)) > 0)
        ) {
          out.push(n);
        }
        continue;
      }
      if (n.duration.quarters.isZero()) continue;
      if ((floatCmp(offsetFloats[i], fromF) ?? n.offsetQuarters.cmp(from)) <= 0) continue;
      out.push(n);
    }
  }
  return out;
}

/** Explicit rest notes whose onset is in [from, to). */
export function restsIn(score: Score, from: Rational, to: Rational): Note[] {
  return notesIn(score, from, to, {includeRests: true}).filter((n) => n.rest === true);
}
