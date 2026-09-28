// ============================================================================
// Export — turn an AudioClip back into bytes. `clipToWav` reuses the pure-JS
// serializer (works in Node / workers); `clipToBlob` wraps it for download;
// `renderClipWithEffect` runs the clip through an Effect chain offline via an
// `OfflineAudioContext` (browser-only, guarded) and returns a fresh, effected
// clip — the bounce/print step.
// ============================================================================

import {createAudioClip, type AudioClip} from '../../core';
import {type Effect, insertEffect} from '../core/effect';
import {serializeWav, type WavBitDepth} from '../core/wav';

export interface ClipToWavOptions {
  bitDepth?: WavBitDepth;
  /** Emit 32-bit IEEE float (requires bitDepth 32). */
  float?: boolean;
}

/** Serialize a decoded clip to a WAV ArrayBuffer. Throws for a streaming clip. */
export function clipToWav(clip: AudioClip, options: ClipToWavOptions = {}): ArrayBuffer {
  const channels = clip.channels();
  if (!channels) throw new Error('clipToWav: clip has no samples (streaming clip cannot be serialized)');
  return serializeWav(channels, clip.sampleRate, options.bitDepth ?? 16, {float: options.float ?? false});
}

/** Serialize a clip to a `Blob` for download / object-URL playback. */
export function clipToBlob(clip: AudioClip, options: ClipToWavOptions = {}): Blob {
  const wav = clipToWav(clip, options);
  return new Blob([wav], {type: 'audio/wav'});
}

/**
 * Render `clip` through `effect` offline and return a new, effected clip. Needs
 * `OfflineAudioContext` (browser), so it is guarded — callers get a clear error
 * in Node. Tail seconds extend the render so reverb/delay tails aren't clipped.
 */
export async function renderClipWithEffect(
  clip: AudioClip,
  effect: Effect | undefined,
  options: {tailSeconds?: number} = {},
): Promise<AudioClip> {
  const channels = clip.channels();
  if (!channels) throw new Error('renderClipWithEffect: clip has no samples');

  const Ctor = (globalThis as {OfflineAudioContext?: typeof OfflineAudioContext}).OfflineAudioContext ??
    (globalThis as {webkitOfflineAudioContext?: typeof OfflineAudioContext}).webkitOfflineAudioContext;
  if (!Ctor) throw new Error('renderClipWithEffect requires OfflineAudioContext (browser only)');

  const tail = Math.max(0, options.tailSeconds ?? 0);
  const renderFrames = clip.length + Math.ceil(tail * clip.sampleRate);
  const context = new Ctor(clip.numberOfChannels, Math.max(1, renderFrames), clip.sampleRate);

  const buffer = clip.toAudioBuffer(context);
  const source = context.createBufferSource();
  source.buffer = buffer;
  insertEffect(context, source, context.destination, effect);
  source.start();

  const rendered = await context.startRendering();
  const out: Float32Array[] = [];
  for (let c = 0; c < rendered.numberOfChannels; c++) {
    out.push(Float32Array.from(rendered.getChannelData(c)));
  }
  return createAudioClip({
    sampleRate: rendered.sampleRate,
    channelData: out,
    metadata: clip.metadata,
    regions: clip.regions,
    ...(clip.beatGrid ? {beatGrid: clip.beatGrid} : {}),
  });
}
