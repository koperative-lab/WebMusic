import {isPitchedNote, noteDurationTicks, noteMidi, scoreNotes, type Score} from '../../core';
import {NOTE_NAMES, pitchClass} from './pitch-class';
import type {KeyResult} from './types';

const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

/**
 * Krumhansl–Schmuckler key detection over the duration-weighted pitch-class
 * histogram of the score.
 *
 * For an EMPTY score (no notes) there is nothing to detect: the result keeps
 * the non-null shape for backward compatibility but reports `confidence: 0`
 * and an empty `scores` list — callers should treat that as "unknown key".
 *
 * `confidence` measures how far the best candidate stands out from the
 * runner-up: `(best - second) / (1 - second)`, clamped to [0, 1], where the
 * scores are Pearson correlations against the key profiles. Identical
 * best/second correlations give 0; a clear winner approaches 1.
 */
export function detectKey(score: Score): KeyResult {
  const histogram = Array.from({length: 12}, () => 0);
  let total = 0;

  for (const note of scoreNotes(score)) {
    if (!isPitchedNote(note)) continue;
    const weight = noteDurationTicks(note);
    histogram[pitchClass(noteMidi(note))] += weight;
    total += weight;
  }

  return keyFromHistogram(histogram, total);
}

/**
 * @internal Rank the 24 Krumhansl–Schmuckler profiles against a precomputed
 * duration-weighted pitch-class histogram. Exported for the incremental
 * analyzer, which maintains the histogram under edits and re-ranks in O(1).
 * The histogram weights are integer tick counts, so incremental adds and
 * subtracts are exact and this yields bit-identical results to `detectKey`.
 */
export function keyFromHistogram(histogram: readonly number[], total: number): KeyResult {
  if (total <= 0) {
    // No notes: unknown key. Tonic/mode are placeholders only.
    return {tonic: 'C', mode: 'major', confidence: 0, scores: []};
  }

  const scores = NOTE_NAMES.flatMap((tonic, index) => [
    {tonic, mode: 'major' as const, score: correlation(histogram, rotate(MAJOR_PROFILE, index))},
    {tonic, mode: 'minor' as const, score: correlation(histogram, rotate(MINOR_PROFILE, index))},
  ]).sort((a, b) => b.score - a.score);

  const best = scores[0];
  const second = scores[1]?.score ?? -1;
  const spread = second >= 1 ? 0 : (best.score - second) / (1 - second);

  return {
    tonic: best.tonic,
    mode: best.mode,
    confidence: best.score <= 0 ? 0 : Math.max(0, Math.min(1, spread)),
    scores,
  };
}

function rotate(values: number[], tonic: number): number[] {
  return values.map((_, index) => values[(index - tonic + 12) % 12]);
}

function correlation(a: readonly number[], b: readonly number[]): number {
  const meanA = mean(a);
  const meanB = mean(b);
  let numerator = 0;
  let denomA = 0;
  let denomB = 0;

  for (let index = 0; index < a.length; index += 1) {
    const da = a[index] - meanA;
    const db = b[index] - meanB;
    numerator += da * db;
    denomA += da * da;
    denomB += db * db;
  }

  return denomA === 0 || denomB === 0 ? 0 : numerator / Math.sqrt(denomA * denomB);
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
