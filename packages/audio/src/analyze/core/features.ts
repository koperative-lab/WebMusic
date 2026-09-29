// ============================================================================
// extractFeatures — offline frame-level audio features via Meyda.
//
// Meyda's `extract(featureNames, signal)` runs on one fixed-size buffer at a
// time. We do the framing/hopping here (Meyda has no built-in offline
// streaming) and collect the per-frame results into typed arrays. Scalar
// features (e.g. `rms`, `spectralCentroid`) become one `Float32Array` of length
// `frames`; vector features (e.g. `mfcc`, `chroma`) become an array of
// per-frame `Float32Array`s.
//
// Meyda is configured by mutating fields on its default export (its documented,
// if dated, API): `bufferSize`, `sampleRate`. We restore them after each call
// so concurrent callers don't clobber each other within a single sync run.
// ============================================================================

import Meyda from 'meyda';
import type {AudioFeatureFrames} from './types';

/** Default feature set: a compact, broadly useful timbral fingerprint. */
export const DEFAULT_FEATURES: readonly string[] = [
  'rms',
  'spectralCentroid',
  'spectralRolloff',
  'spectralFlatness',
  'zcr',
  'mfcc',
];

export interface ExtractFeaturesOptions {
  /** Analysis window length in samples (power of two). Default 512. */
  bufferSize?: number;
  /** Samples between successive frames. Default `bufferSize` (no overlap). */
  hopSize?: number;
}

/** Meyda feature values are either a scalar, a vector, or a structured object. */
type MeydaValue = number | number[] | {total?: number} | null | undefined;

/** Coerce one Meyda feature value to a scalar (for non-vector features). */
function toScalar(value: MeydaValue): number {
  if (typeof value === 'number') return value;
  if (Array.isArray(value)) return value[0] ?? 0;
  if (value && typeof value === 'object' && typeof value.total === 'number') return value.total;
  return 0;
}

/**
 * Extract per-frame Meyda features from one channel of decoded audio.
 *
 * ```ts
 * const f = extractFeatures(clip.channelData(0)!, clip.sampleRate, ['rms', 'mfcc']);
 * f.features.rms;     // Float32Array, one value per frame
 * f.features.mfcc;    // Float32Array[], one MFCC vector per frame
 * ```
 *
 * Pure (no DOM / audio globals) so it runs in a worker or Node.
 */
export function extractFeatures(
  channel: Float32Array,
  sampleRate: number,
  featureNames: readonly string[] = DEFAULT_FEATURES,
  options: ExtractFeaturesOptions = {},
): AudioFeatureFrames {
  const bufferSize = Math.max(2, Math.floor(options.bufferSize ?? 512));
  const hopSize = Math.max(1, Math.floor(options.hopSize ?? bufferSize));
  const names = featureNames.length > 0 ? [...featureNames] : [...DEFAULT_FEATURES];

  const frameCount =
    channel.length >= bufferSize ? 1 + Math.floor((channel.length - bufferSize) / hopSize) : 1;

  const times = new Float32Array(frameCount);
  // Each feature accumulates either into a scalar Float32Array or a vector list.
  const scalar: Record<string, Float32Array> = {};
  const vector: Record<string, Float32Array[]> = {};
  const isVector: Record<string, boolean | undefined> = {};

  // Meyda is configured through fields on its default export. Save + restore so
  // we don't permanently mutate global Meyda state.
  const meyda = Meyda as unknown as {bufferSize: number; sampleRate: number};
  const prevBuffer = meyda.bufferSize;
  const prevRate = meyda.sampleRate;
  meyda.bufferSize = bufferSize;
  meyda.sampleRate = sampleRate;

  const frame = new Float32Array(bufferSize);
  try {
    for (let f = 0; f < frameCount; f++) {
      const start = f * hopSize;
      for (let i = 0; i < bufferSize; i++) {
        const idx = start + i;
        frame[i] = idx < channel.length ? channel[idx] : 0;
      }
      times[f] = (start + bufferSize / 2) / sampleRate;

      const extracted = (Meyda.extract(names as never, frame) ?? {}) as Record<string, MeydaValue>;
      for (const name of names) {
        const value = extracted[name];
        const valueIsVector = Array.isArray(value) && name !== 'spectralCentroid';
        if (isVector[name] === undefined) isVector[name] = valueIsVector;
        if (isVector[name]) {
          (vector[name] ??= []).push(Float32Array.from((value as number[]) ?? []));
        } else {
          (scalar[name] ??= new Float32Array(frameCount))[f] = toScalar(value);
        }
      }
    }
  } finally {
    meyda.bufferSize = prevBuffer;
    meyda.sampleRate = prevRate;
  }

  const features: Record<string, Float32Array | Float32Array[]> = {};
  for (const name of names) {
    if (isVector[name]) features[name] = vector[name] ?? [];
    else features[name] = scalar[name] ?? new Float32Array(frameCount);
  }

  return {times, featureNames: names, features};
}
