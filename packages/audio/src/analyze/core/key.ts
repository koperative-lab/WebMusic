// ============================================================================
// detectAudioKey — key detection for digital audio.
//
//   1. STFT → chromagram: fold every spectral bin onto its pitch class
//      (12-bin chroma), magnitude-weighted, summed across frames.
//   2. Krumhansl–Schmuckler: correlate the chroma histogram against all 24
//      rotated major/minor key profiles; the best correlation is the key.
//
// The algorithm is the same Krumhansl–Schmuckler relation `@webscore/analyze`
// uses for symbolic scores; the profiles are embedded here so this package has
// no cross-dependency on the symbolic analyzer.
// ============================================================================

import {computeSpectrogram} from './spectrogram';
import type {AudioKeyResult} from './types';

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

// Krumhansl–Kessler key profiles.
const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

export interface KeyOptions {
  fftSize?: number;
  hopSize?: number;
  /** Lowest frequency (Hz) folded into the chromagram. Default 55 (A1). */
  minFreq?: number;
  /** Highest frequency (Hz) folded into the chromagram. Default 5000. */
  maxFreq?: number;
}

/**
 * Detect the musical key of decoded audio (mono mix-down internally).
 *
 * ```ts
 * const {tonic, mode, confidence} = detectAudioKey(clip.channels()!, clip.sampleRate);
 * ```
 */
export function detectAudioKey(
  channels: Float32Array[],
  sampleRate: number,
  options: KeyOptions = {},
): AudioKeyResult {
  const chroma = computeChromagram(channels, sampleRate, options);
  return keyFromChroma(chroma);
}

/** Build a 12-bin pitch-class chromagram from decoded channels. */
export function computeChromagram(
  channels: Float32Array[],
  sampleRate: number,
  options: KeyOptions = {},
): Float64Array {
  const fftSize = Math.max(2, Math.floor(options.fftSize ?? 4096));
  const hopSize = Math.max(1, Math.floor(options.hopSize ?? fftSize / 2));
  const minFreq = options.minFreq ?? 55;
  const maxFreq = Math.min(options.maxFreq ?? 5000, sampleRate / 2);

  const mono = monoMix(channels);
  const spec = computeSpectrogram(mono, sampleRate, {fftSize, hopSize});
  const {magnitudes, frequencies, binsPerFrame, times} = spec;

  // Precompute pitch class per bin (or -1 if out of [minFreq, maxFreq]).
  const binPitchClass = new Int8Array(binsPerFrame);
  for (let b = 0; b < binsPerFrame; b++) {
    const f = frequencies[b];
    if (f < minFreq || f > maxFreq || f <= 0) {
      binPitchClass[b] = -1;
    } else {
      // MIDI pitch (float); pitch class mod 12. A4 = 440 Hz = MIDI 69.
      const midi = 69 + 12 * Math.log2(f / 440);
      let pc = Math.round(midi) % 12;
      if (pc < 0) pc += 12;
      binPitchClass[b] = pc;
    }
  }

  const chroma = new Float64Array(12);
  for (let frame = 0; frame < times.length; frame++) {
    const base = frame * binsPerFrame;
    for (let b = 0; b < binsPerFrame; b++) {
      const pc = binPitchClass[b];
      if (pc >= 0) chroma[pc] += magnitudes[base + b];
    }
  }
  return chroma;
}

/** Rank the 24 Krumhansl–Schmuckler profiles against a chroma histogram. */
export function keyFromChroma(chroma: Float64Array | readonly number[]): AudioKeyResult {
  let total = 0;
  for (let i = 0; i < 12; i++) total += chroma[i];
  if (total <= 0) {
    return {tonic: 'C', mode: 'major', confidence: 0, scores: []};
  }

  const scores = NOTE_NAMES.flatMap((tonic, index) => [
    {tonic, mode: 'major' as const, score: correlation(chroma, rotate(MAJOR_PROFILE, index))},
    {tonic, mode: 'minor' as const, score: correlation(chroma, rotate(MINOR_PROFILE, index))},
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

function monoMix(channels: Float32Array[]): Float32Array {
  if (channels.length === 1) return channels[0];
  const length = channels[0].length;
  const out = new Float32Array(length);
  for (let c = 0; c < channels.length; c++) {
    const ch = channels[c];
    for (let i = 0; i < length; i++) out[i] += ch[i];
  }
  const inv = 1 / channels.length;
  for (let i = 0; i < length; i++) out[i] *= inv;
  return out;
}

function rotate(values: number[], tonic: number): number[] {
  return values.map((_, index) => values[(index - tonic + 12) % 12]);
}

function correlation(a: Float64Array | readonly number[], b: readonly number[]): number {
  const meanA = mean(a);
  const meanB = mean(b);
  let numerator = 0;
  let denomA = 0;
  let denomB = 0;
  for (let i = 0; i < 12; i++) {
    const da = a[i] - meanA;
    const db = b[i] - meanB;
    numerator += da * db;
    denomA += da * da;
    denomB += db * db;
  }
  return denomA === 0 || denomB === 0 ? 0 : numerator / Math.sqrt(denomA * denomB);
}

function mean(values: Float64Array | readonly number[]): number {
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += values[i];
  return sum / 12;
}
