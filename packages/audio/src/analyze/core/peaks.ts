// ============================================================================
// computePeaks — build a multi-resolution min/max peaks pyramid from decoded
// samples. One pass over the audio yields the finest level; each coarser level
// is a 2:1 min/max reduction of the level below it, so any zoom is an O(1)
// read. Quantized to 8-bit (Int8Array) for compactness; the byte layout is
// exactly what `@webmusic/audio`'s `readPeak` expects:
//
//   data[(peak * channels + channel) * 2 + (0|1)]   // 0 = min, 1 = max
//
// each value in [-128, 127] encoding a normalized sample in [-1, 1) as
// `round(sample * 128)` clamped. No external dependencies (~100 lines).
// ============================================================================

import type {AudioPeaks, PeaksLevel} from '../../core';

export interface ComputePeaksOptions {
  /**
   * Samples summarized by one min/max pair at the finest (base) level.
   * Smaller = finer detail + larger output. Default 256.
   */
  baseSamplesPerPeak?: number;
  /**
   * Stop building coarser levels once a level has fewer than this many peaks.
   * Default 1 (build all the way down to a single peak).
   */
  minPeaksPerLevel?: number;
}

/** Quantize a float sample in [-1, 1] to an Int8 in [-128, 127]. */
function quantize(sample: number): number {
  const v = Math.round(sample * 128);
  return v < -128 ? -128 : v > 127 ? 127 : v;
}

/**
 * Build the base (finest) level directly from the float channels. For each
 * block of `samplesPerPeak` source samples, store its (min, max) per channel,
 * quantized to Int8, in peak-major / channel / [min,max] order.
 */
function buildBaseLevel(channels: Float32Array[], samplesPerPeak: number): PeaksLevel {
  const numChannels = channels.length;
  const length = channels[0]?.length ?? 0;
  const peaks = Math.max(1, Math.ceil(length / samplesPerPeak));
  const data = new Int8Array(peaks * numChannels * 2);

  for (let p = 0; p < peaks; p++) {
    const start = p * samplesPerPeak;
    const end = Math.min(start + samplesPerPeak, length);
    for (let c = 0; c < numChannels; c++) {
      const ch = channels[c];
      let min = Infinity;
      let max = -Infinity;
      for (let i = start; i < end; i++) {
        const s = ch[i];
        if (s < min) min = s;
        if (s > max) max = s;
      }
      if (min === Infinity) {
        // Empty trailing block (length not a multiple of samplesPerPeak, or a
        // zero-length clip): a flat silent peak.
        min = 0;
        max = 0;
      }
      const base = (p * numChannels + c) * 2;
      data[base] = quantize(min);
      data[base + 1] = quantize(max);
    }
  }
  return {samplesPerPeak, data};
}

/**
 * Reduce a level 2:1: each output peak spans two input peaks, taking the
 * elementwise min of the mins and max of the maxes. Operating on the already
 * quantized Int8 data keeps coarse levels exactly consistent with the finer
 * level they summarize (no re-quantization drift).
 */
function reduceLevel(level: PeaksLevel, numChannels: number): PeaksLevel {
  const inPeaks = Math.floor(level.data.length / (numChannels * 2));
  const outPeaks = Math.ceil(inPeaks / 2);
  const data = new Int8Array(outPeaks * numChannels * 2);

  for (let p = 0; p < outPeaks; p++) {
    const a = p * 2;
    const b = a + 1;
    for (let c = 0; c < numChannels; c++) {
      const baseA = (a * numChannels + c) * 2;
      let min = level.data[baseA];
      let max = level.data[baseA + 1];
      if (b < inPeaks) {
        const baseB = (b * numChannels + c) * 2;
        if (level.data[baseB] < min) min = level.data[baseB];
        if (level.data[baseB + 1] > max) max = level.data[baseB + 1];
      }
      const out = (p * numChannels + c) * 2;
      data[out] = min;
      data[out + 1] = max;
    }
  }
  return {samplesPerPeak: level.samplesPerPeak * 2, data};
}

/**
 * Compute a multi-resolution {@link AudioPeaks} pyramid from decoded channels.
 *
 * ```ts
 * const peaks = computePeaks(clip.channels()!, clip.sampleRate, {baseSamplesPerPeak: 256});
 * ```
 *
 * The result is structured-clone / transferable friendly (only typed arrays
 * and numbers) and ready for `renderWaveformVisualizer` in `@webmusic/audio/view`.
 */
export function computePeaks(
  channels: Float32Array[],
  sampleRate: number,
  options: ComputePeaksOptions = {},
): AudioPeaks {
  if (channels.length === 0) {
    throw new Error('computePeaks requires at least one channel');
  }
  const baseSamplesPerPeak = Math.max(1, Math.floor(options.baseSamplesPerPeak ?? 256));
  const minPeaksPerLevel = Math.max(1, Math.floor(options.minPeaksPerLevel ?? 1));
  const numChannels = channels.length;

  const levels: PeaksLevel[] = [buildBaseLevel(channels, baseSamplesPerPeak)];
  // Coarsen until a level has fewer than minPeaksPerLevel peaks (or 1 peak).
  while (true) {
    const last = levels[levels.length - 1];
    const peaks = Math.floor(last.data.length / (numChannels * 2));
    if (peaks <= Math.max(1, minPeaksPerLevel)) break;
    levels.push(reduceLevel(last, numChannels));
  }

  return {
    sampleRate,
    channels: numChannels,
    baseSamplesPerPeak,
    levels,
  };
}
