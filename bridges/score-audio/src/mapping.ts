// ============================================================================
// Timeline conversions between the two families' musical time models.
// TimeMap → BeatGrid is lossless sampling (evaluate the exact map at each
// beat); BeatGrid → TimeMap is approximate (each inter-beat interval becomes
// one tempo segment). Both project onto the same seconds ruler, which is what
// makes score↔audio alignment composable.
// ============================================================================

import {Rational, TimeMap, type TempoEntry} from '@webmusic/score';
import {BeatGrid} from '@webmusic/audio';

export interface BeatGridFromTimeMapOptions {
  /** How many quarters of the score timeline to sample. */
  durationQuarters: number;
  /** Beat subdivisions per quarter note (default 1: beat = quarter). */
  beatsPerQuarter?: number;
  /** Maximum number of beat samples to allocate. Default 1,000,000. */
  maxBeats?: number;
}

export const DEFAULT_MAX_MAPPED_BEATS = 1_000_000;

/**
 * Sample a {@link TimeMap} into a {@link BeatGrid}: one beat per
 * `1/beatsPerQuarter` quarter from 0 through `durationQuarters`. Lossless up
 * to the sampling density — tempo changes between sampled beats interpolate
 * linearly on the grid.
 */
export function beatGridFromTimeMap(map: TimeMap, options: BeatGridFromTimeMapOptions): BeatGrid {
  const {durationQuarters, beatsPerQuarter = 1, maxBeats = DEFAULT_MAX_MAPPED_BEATS} = options;
  if (!Number.isFinite(durationQuarters) || durationQuarters <= 0) {
    throw new RangeError('durationQuarters must be finite and > 0');
  }
  if (!Number.isSafeInteger(beatsPerQuarter) || beatsPerQuarter < 1) {
    throw new RangeError('beatsPerQuarter must be a positive safe integer');
  }
  if (!Number.isSafeInteger(maxBeats) || maxBeats < 2) {
    throw new RangeError('maxBeats must be a safe integer >= 2');
  }
  const scaledDuration = durationQuarters * beatsPerQuarter;
  const nearestInteger = Math.round(scaledDuration);
  const ulpTolerance = Number.EPSILON * Math.max(1, Math.abs(scaledDuration)) * 4;
  const normalizedDuration =
    Math.abs(scaledDuration - nearestInteger) <= ulpTolerance
      ? nearestInteger
      : scaledDuration;
  const total = Math.ceil(normalizedDuration);
  if (!Number.isSafeInteger(total) || total >= maxBeats) {
    throw new RangeError(
      `Beat-grid mapping would allocate more than maxBeats (${maxBeats.toLocaleString()}) samples.`,
    );
  }
  const beats: number[] = [];
  for (let index = 0; index <= total; index++) {
    beats.push(map.quartersToSeconds(new Rational(index, beatsPerQuarter)));
  }
  // The sampled positions come from quartersToSeconds, which integrates tempo
  // as 60 / (bpm * unit) seconds per quarter — so the effective quarters per
  // minute is `bpm * unit`, not the raw bpm. Folding `unit` in here keeps the
  // grid's nominal tempo consistent with its own beat spacing; without it a
  // metronome mark like "half note = 60" produced 0.5 s beats under a grid
  // claiming 60 bpm, and BeatGrid's extrapolation before beat 0 disagreed with
  // every sampled beat after it.
  const tempo = map.tempoAt(Rational.ZERO);
  const bpm = tempo.bpm * (tempo.unit ?? 1) * beatsPerQuarter;
  return new BeatGrid({bpm, beats});
}

/**
 * Approximate a {@link TimeMap} from a {@link BeatGrid}: beat index becomes
 * the quarter axis and every inter-beat interval one tempo segment. The
 * grid's absolute offset is NOT representable (a TimeMap always maps quarter
 * 0 to second 0) — align `grid.beats[0]` on the consumer side. Zero-length
 * intervals are rejected: they would demand an infinite tempo.
 */
export function timeMapFromBeatGrid(grid: BeatGrid): TimeMap {
  const beats = grid.beats;
  const tempi: TempoEntry[] = [];
  if (beats.length < 2) {
    tempi.push({atQuarters: Rational.ZERO, bpm: grid.bpm});
  } else {
    for (let index = 0; index < beats.length - 1; index++) {
      const interval = beats[index + 1] - beats[index];
      if (!(interval > 0)) {
        throw new RangeError(`BeatGrid interval at beat ${index} is not positive (${interval}).`);
      }
      tempi.push({atQuarters: new Rational(index, 1), bpm: 60 / interval});
    }
  }
  return new TimeMap(tempi, [
    {atQuarters: Rational.ZERO, measureNumber: 1, timeSignature: {numerator: 4, denominator: 4}},
  ]);
}
