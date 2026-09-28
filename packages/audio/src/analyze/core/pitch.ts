// ============================================================================
// trackPitch — per-frame monophonic fundamental-frequency tracking.
//
// Default engine: `pitchy` (McLeod Pitch Method, pure TS). The signal is cut
// into overlapping windows; each window yields one (frequency, clarity) pair.
// Optional engines ('pitchfinder' / 'aubio') dynamically import their peer,
// guarded so the build/typecheck pass without them (graceful fallback to the
// default engine on a missing peer).
// ============================================================================

import {PitchDetector} from 'pitchy';
import type {PitchTrackResult} from './types';

export type PitchEngine = 'pitchy' | 'pitchfinder' | 'aubio';

export interface PitchOptions {
  engine?: PitchEngine;
  /** Analysis window length in samples (power of two). Default 2048. */
  frameSize?: number;
  /** Samples between successive frames. Default `frameSize / 4`. */
  hopSize?: number;
  /** Discard detections below this clarity (0..1). Default 0.6. */
  clarityThreshold?: number;
}

/**
 * Track the monophonic pitch of a single channel over time.
 *
 * ```ts
 * const {times, frequencies, confidences} = await trackPitch(clip.channelData(0)!, clip.sampleRate);
 * ```
 *
 * `frequencies[f]` is 0 for unvoiced / sub-threshold frames.
 */
export async function trackPitch(
  channel: Float32Array,
  sampleRate: number,
  options: PitchOptions = {},
): Promise<PitchTrackResult> {
  const engine = options.engine ?? 'pitchy';
  const frameSize = Math.max(2, Math.floor(options.frameSize ?? 2048));
  const hopSize = Math.max(1, Math.floor(options.hopSize ?? frameSize / 4));
  const clarityThreshold = options.clarityThreshold ?? 0.6;

  const frameCount =
    channel.length >= frameSize ? 1 + Math.floor((channel.length - frameSize) / hopSize) : 1;
  const times = new Float32Array(frameCount);
  const frequencies = new Float32Array(frameCount);
  const confidences = new Float32Array(frameCount);

  // Optional engines fall back to pitchy if their peer is not installed.
  let perFrame: ((frame: Float32Array) => [number, number]) | null = null;
  if (engine !== 'pitchy') {
    perFrame = await tryAdvancedEngine(engine, sampleRate, frameSize);
  }

  const detector = perFrame ? null : PitchDetector.forFloat32Array(frameSize);
  const frame = new Float32Array(frameSize);

  for (let f = 0; f < frameCount; f++) {
    const start = f * hopSize;
    for (let i = 0; i < frameSize; i++) {
      const idx = start + i;
      frame[i] = idx < channel.length ? channel[idx] : 0;
    }
    times[f] = (start + frameSize / 2) / sampleRate;

    let pitch = 0;
    let clarity = 0;
    if (perFrame) {
      [pitch, clarity] = perFrame(frame);
    } else if (detector) {
      [pitch, clarity] = detector.findPitch(frame, sampleRate);
    }
    if (clarity >= clarityThreshold && pitch > 0) {
      frequencies[f] = pitch;
      confidences[f] = clarity;
    } else {
      frequencies[f] = 0;
      confidences[f] = clarity;
    }
  }

  return {times, frequencies, confidences};
}

/**
 * Per-frame pitch function from an optional peer, or null when unavailable.
 * Loosely typed (`any`) so the build never needs the peer's types.
 */
async function tryAdvancedEngine(
  engine: PitchEngine,
  sampleRate: number,
  frameSize: number,
): Promise<((frame: Float32Array) => [number, number]) | null> {
  try {
    if (engine === 'pitchfinder') {
      const mod: any = await import('pitchfinder' as string);
      const factory = mod.YIN ?? mod.default?.YIN ?? mod.default;
      const detect = factory({sampleRate});
      return (frame: Float32Array) => {
        const hz = detect(frame);
        return [hz ?? 0, hz ? 1 : 0];
      };
    }
    if (engine === 'aubio') {
      const mod: any = await import('aubiojs' as string);
      const aubio = await (mod.default ?? mod)();
      const pitch = new aubio.Pitch('default', frameSize, frameSize, sampleRate);
      return (frame: Float32Array) => {
        const hz = pitch.do(frame);
        const conf = pitch.getConfidence ? pitch.getConfidence() : hz ? 1 : 0;
        return [hz ?? 0, conf];
      };
    }
  } catch (error) {
    console.warn(`[WebAudio] pitch engine "${engine}" unavailable, falling back to pitchy`, error);
  }
  return null;
}
