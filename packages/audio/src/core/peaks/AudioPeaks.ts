// ============================================================================
// AudioPeaks — multi-resolution min/max pyramid for waveform rendering.
//
// One computation, O(1) read at any zoom level. 8-bit (Int8Array) quantization
// keeps an hour of stereo peaks well under ~5MB. The on-disk byte layout is
// compatible with BBC `audiowaveform` / `waveform-data` (peak-major, channel
// then [min, max]); `peaksFromWaveformData` / `peaksToWaveformData` adapt
// between the two without ever depending on the LGPL `waveform-data` package.
//
// The peaks *type* lives in core; the *computation* (`computePeaks`) lives in
// @webmusic/audio/analyze (it is an analysis task), mirroring how the score-note
// sequence type vs. its builder are split in WebScore.
// ============================================================================

/** One resolution level of the pyramid. */
export interface PeaksLevel {
  /** Source samples summarized by each min/max pair at this level. */
  samplesPerPeak: number;
  /**
   * Interleaved 8-bit peaks, peak-major then channel then [min, max]:
   * `data[(peak * channels + channel) * 2 + (0|1)]`, each in [-128, 127]
   * representing a normalized sample in [-1, 1).
   */
  data: Int8Array;
}

/** A multi-resolution peaks pyramid for one clip. */
export interface AudioPeaks {
  sampleRate: number;
  channels: number;
  /** Samples summarized by one peak at the base (finest) level. */
  baseSamplesPerPeak: number;
  /** Levels from finest to coarsest; `levels[i].samplesPerPeak = base * 2^i`. */
  levels: PeaksLevel[];
}

/** Number of min/max peak pairs (per channel) stored in a level. */
export function peakCount(level: PeaksLevel, channels: number): number {
  return Math.floor(level.data.length / (channels * 2));
}

/** Read one quantized peak as floats in [-1, 1). */
export function readPeak(
  level: PeaksLevel,
  channels: number,
  channel: number,
  peakIndex: number,
): {min: number; max: number} {
  const base = (peakIndex * channels + channel) * 2;
  return {min: level.data[base] / 128, max: level.data[base + 1] / 128};
}

/**
 * Pick the pyramid level whose peaks are closest to (but not finer than)
 * `targetSamplesPerPeak` — i.e. the coarsest level that still has at least one
 * peak per rendered pixel column. Falls back to the finest level.
 */
export function peaksLevelForResolution(peaks: AudioPeaks, targetSamplesPerPeak: number): PeaksLevel {
  let chosen = peaks.levels[0];
  for (const level of peaks.levels) {
    if (level.samplesPerPeak <= targetSamplesPerPeak) chosen = level;
    else break;
  }
  return chosen ?? peaks.levels[0];
}

// ---------------------------------------------------------------------------
// BBC waveform-data interop (format only — no dependency on `waveform-data`).
// ---------------------------------------------------------------------------

/** Minimal shape of a BBC `audiowaveform` JSON export (version 2). */
export interface WaveformDataJSON {
  version: 2;
  channels: number;
  sample_rate: number;
  samples_per_pixel: number;
  bits: 8 | 16;
  length: number;
  /** Interleaved min/max per channel; 8-bit when `bits === 8`. */
  data: number[];
}

/** Build a single-level {@link AudioPeaks} from a BBC waveform-data export. */
export function peaksFromWaveformData(wd: WaveformDataJSON): AudioPeaks {
  const scale = wd.bits === 16 ? 1 / 256 : 1; // 16-bit → fold to 8-bit range
  const data = new Int8Array(wd.data.length);
  for (let i = 0; i < wd.data.length; i++) {
    const v = Math.round(wd.data[i] * scale);
    data[i] = v < -128 ? -128 : v > 127 ? 127 : v;
  }
  return {
    sampleRate: wd.sample_rate,
    channels: wd.channels,
    baseSamplesPerPeak: wd.samples_per_pixel,
    levels: [{samplesPerPeak: wd.samples_per_pixel, data}],
  };
}

/** Export the finest level of an {@link AudioPeaks} as BBC waveform-data JSON. */
export function peaksToWaveformData(peaks: AudioPeaks): WaveformDataJSON {
  const level = peaks.levels[0];
  return {
    version: 2,
    channels: peaks.channels,
    sample_rate: peaks.sampleRate,
    samples_per_pixel: level.samplesPerPeak,
    bits: 8,
    length: peakCount(level, peaks.channels),
    data: Array.from(level.data),
  };
}
