// ============================================================================
// detectOnsets — spectral-flux onset detection with an adaptive threshold.
//
//   1. STFT (reuses computeSpectrogram).
//   2. Spectral flux: per frame, sum of positive bin-to-bin magnitude
//      increases (half-wave rectified), giving an onset-detection function.
//   3. Adaptive threshold: a local mean over a sliding window plus a delta;
//      peaks of the flux above the threshold and locally maximal are onsets.
//
// ~80 lines, no dependencies beyond the shared STFT.
// ============================================================================

import {computeSpectrogram} from './spectrogram';

export interface OnsetOptions {
  fftSize?: number;
  hopSize?: number;
  /** Sliding-window radius (frames) for the adaptive threshold. Default 6. */
  windowFrames?: number;
  /** Multiplier on the local mean flux. Default 1.5. */
  thresholdFactor?: number;
  /** Absolute floor added to the local mean. Default 0 (auto-scaled). */
  delta?: number;
  /** Minimum gap between onsets in seconds. Default 0.03 (30 ms). */
  minIntervalSeconds?: number;
}

/** One populated onset-spacing bucket; an open end denotes the overflow bucket. */
export interface OnsetIntervalBin {
  startSeconds: number;
  endSeconds?: number;
  count: number;
}

export interface OnsetIntervalHistogramOptions {
  /** Bucket width in seconds. Default 0.05. */
  bucketSeconds?: number;
  /** Start of the final overflow bucket in seconds. Default 2. */
  overflowSeconds?: number;
}

/**
 * Count positive gaps between consecutive ascending onset times. This is
 * report data, not a playback follower or a UI chart.
 */
export function histogramOnsetIntervals(
  onsets: readonly number[],
  options: OnsetIntervalHistogramOptions = {},
): OnsetIntervalBin[] {
  const bucketSeconds = options.bucketSeconds ?? 0.05;
  const overflowSeconds = options.overflowSeconds ?? 2;
  if (!Number.isFinite(bucketSeconds) || bucketSeconds <= 0) {
    throw new RangeError('bucketSeconds must be a positive finite number');
  }
  if (!Number.isFinite(overflowSeconds) || overflowSeconds <= 0) {
    throw new RangeError('overflowSeconds must be a positive finite number');
  }
  const bucketCount = Math.ceil(overflowSeconds / bucketSeconds);
  if (bucketCount > 100_000) {
    throw new RangeError('onset interval histogram exceeds 100000 buckets');
  }
  const counts = new Array<number>(bucketCount + 1).fill(0);
  for (let index = 1; index < onsets.length; index += 1) {
    const gap = onsets[index]! - onsets[index - 1]!;
    if (Number.isFinite(gap) && gap > 0) {
      const bucket = gap >= overflowSeconds ? bucketCount : Math.floor(gap / bucketSeconds);
      counts[bucket]! += 1;
    }
  }
  return counts.flatMap((count, index) => {
    if (count === 0) return [];
    const startSeconds = index * bucketSeconds;
    return index === bucketCount
      ? [{startSeconds: overflowSeconds, count}]
      : [{startSeconds, endSeconds: Math.min(startSeconds + bucketSeconds, overflowSeconds), count}];
  });
}

/**
 * Detect note/percussion onsets in a single channel, returned as ascending
 * times in seconds.
 *
 * ```ts
 * const onsets = detectOnsets(clip.channelData(0)!, clip.sampleRate);
 * ```
 */
export function detectOnsets(
  channel: Float32Array,
  sampleRate: number,
  options: OnsetOptions = {},
): number[] {
  const fftSize = Math.max(2, Math.floor(options.fftSize ?? 1024));
  const hopSize = Math.max(1, Math.floor(options.hopSize ?? fftSize / 2));
  const windowFrames = Math.max(1, Math.floor(options.windowFrames ?? 6));
  const thresholdFactor = options.thresholdFactor ?? 1.5;
  const minInterval = options.minIntervalSeconds ?? 0.03;

  const spec = computeSpectrogram(channel, sampleRate, {fftSize, hopSize});
  const {times, magnitudes, binsPerFrame} = spec;
  const frames = times.length;
  if (frames < 2) return [];

  // --- Spectral flux (half-wave rectified) + per-frame spectral magnitude ---
  const flux = new Float32Array(frames);
  let fluxMax = 0;
  let totalMagnitude = 0;
  for (let f = 1; f < frames; f++) {
    let sum = 0;
    let frameMag = 0;
    const cur = f * binsPerFrame;
    const prev = (f - 1) * binsPerFrame;
    for (let b = 0; b < binsPerFrame; b++) {
      const m = magnitudes[cur + b];
      frameMag += m;
      const diff = m - magnitudes[prev + b];
      if (diff > 0) sum += diff;
    }
    flux[f] = sum;
    totalMagnitude += frameMag;
    if (sum > fluxMax) fluxMax = sum;
  }
  if (fluxMax <= 0) return [];

  // Onset gating combines two floors:
  //  - a flux-relative floor (scales with the loudest transient), and
  //  - an *energy-relative* floor: a true onset's flux is a meaningful fraction
  //    of the average spectral magnitude, whereas a steady tone's frame-to-frame
  //    spectral-leakage flux is a tiny fraction. The energy floor suppresses the
  //    leakage "onsets" a sustained tone would otherwise trigger.
  const meanMagnitude = totalMagnitude / Math.max(1, frames - 1);
  const energyFloor = meanMagnitude * 0.04;
  const delta = options.delta ?? fluxMax * 0.02;

  // --- Adaptive threshold + peak picking ---
  const onsets: number[] = [];
  let lastOnsetTime = -Infinity;
  for (let f = 1; f < frames; f++) {
    let mean = 0;
    let count = 0;
    const lo = Math.max(0, f - windowFrames);
    const hi = Math.min(frames - 1, f + windowFrames);
    for (let j = lo; j <= hi; j++) {
      mean += flux[j];
      count++;
    }
    mean = count > 0 ? mean / count : 0;
    const threshold = Math.max(mean * thresholdFactor + delta, energyFloor);

    const isPeak =
      flux[f] > threshold &&
      flux[f] >= flux[f - 1] &&
      (f + 1 >= frames || flux[f] >= flux[f + 1]);
    if (isPeak && times[f] - lastOnsetTime >= minInterval) {
      onsets.push(times[f]);
      lastOnsetTime = times[f];
    }
  }
  return onsets;
}
