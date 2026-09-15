// ============================================================================
// Offline render — turn a `<score · sound · effect>` into a finished AudioBuffer
// (and a downloadable WAV) without real-time playback. It reuses the same synth
// (Sound / HeadlessSynth) and Effect chain the live engines use, but schedules
// every note directly onto an OfflineAudioContext, which renders deterministically
// and faster than real time. This closes the loop: load/build → play → export.
// ============================================================================

import {
  type Score,
} from '../../core';

import type {HeadlessSynth, ReverbOptions, SynthOwnership} from './audio-contracts';
import {OscillatorSynth} from './oscillator-synth';
import {ScoreTimeline} from './score-timeline';
import {Effect, insertEffect, resolveEffect} from './effects';

type GlobalWithLegacyOfflineAudio = typeof globalThis & {
  webkitOfflineAudioContext?: typeof OfflineAudioContext;
};

export interface RenderOptions {
  /** Timbre — a `Sound` or any `HeadlessSynth`. Defaults to the oscillator synth. */
  synth?: HeadlessSynth;
  /**
   * Whether this renderer owns a caller-supplied synth. Supplied synths are
   * borrowed by default. The renderer calls only a route cleanup returned by
   * `connect()`, never the synth's global `disconnect()` or `dispose()`.
   */
  synthOwnership?: SynthOwnership;
  /** Post-processing effect chain. */
  effect?: Effect;
  /** Legacy sugar for `effect: Effect.reverb(...)`. */
  reverb?: false | ReverbOptions;
  /** Override playback tempo (BPM). */
  tempo?: number;
  /** Output sample rate. Default 44100. */
  sampleRate?: number;
  /** Output channel count. Default 2. */
  channels?: number;
  /** Extra silence (seconds) appended for effect tails. Default 1.5 with an effect, else 0.15. */
  tailSeconds?: number;
}

/**
 * Render a score to an `AudioBuffer` offline. Self-routing synths (Tone/Spessa)
 * route to their own destination and won't be captured — use a `Sound` or a
 * `HeadlessSynth` that implements `connect()` (oscillator / soundfont / sfz).
 */
export async function renderScoreToBuffer(score: Score, options: RenderOptions = {}): Promise<AudioBuffer> {
  const sampleRate = options.sampleRate ?? 44100;
  const channels = options.channels ?? 2;
  const baseTempo = score.timeMap.tempi[0]?.bpm ?? 120;
  const tempoScale = options.tempo ? options.tempo / baseTempo : 1;
  const timeline = new ScoreTimeline(score);
  const duration = timeline.duration / tempoScale;
  const effect = resolveEffect(options.effect, options.reverb);
  const tail = options.tailSeconds ?? (effect ? 1.5 : 0.15);
  const length = Math.max(1, Math.ceil((duration + tail) * sampleRate));

  const OfflineCtor =
    globalThis.OfflineAudioContext ?? (globalThis as GlobalWithLegacyOfflineAudio).webkitOfflineAudioContext;
  if (!OfflineCtor) {
    throw new Error('OfflineAudioContext is not available in this environment.');
  }
  const context = new OfflineCtor(channels, length, sampleRate);

  const output = context.createGain();
  const suppliedSynth = options.synth;
  const ownsSynth = suppliedSynth ? options.synthOwnership === 'owned' : true;
  let synth: HeadlessSynth | undefined;
  let effectHandle: ReturnType<typeof insertEffect> | undefined;
  let routeCleanup: (() => void) | undefined;
  let failed = false;
  let failure: unknown;
  let buffer: AudioBuffer | undefined;
  try {
    effectHandle = insertEffect(context as unknown as AudioContext, output, context.destination, effect);
    synth = suppliedSynth ?? new OscillatorSynth(context as unknown as AudioContext);
    const route = synth.connect?.(output);
    routeCleanup = typeof route === 'function' ? route : undefined;
    // Resolve any async timbre loading (samples / .sfz / .sf2) before scheduling.
    const loadable = synth as {preload?: (notes?: ReadonlyArray<unknown>) => Promise<void>; ready?: Promise<void>};
    await loadable.preload?.(timeline.preloadNotes);
    await loadable.ready;

    // Keep offline output semantically identical to ScorePlayer: ties merge,
    // grace notes are skipped, transposition is applied, and performed timing
    // may extend beyond the final notated measure.
    for (const entry of timeline.prepare()) {
      const start = entry.start / tempoScale;
      const end = entry.end / tempoScale;
      const handle = synth.noteOn(
        entry.midi,
        entry.velocity,
        start,
        Math.max(0, end - start),
      );
      if (handle != null && synth.noteOffById) synth.noteOffById(handle, end);
      else synth.noteOff?.(entry.midi, end);
    }

    buffer = await context.startRendering();
  } catch (error) {
    failed = true;
    failure = error;
  }
  {
    // Every acquired resource gets a release attempt, even when a custom
    // connect/dispose hook throws. Preserve a rendering/preparation failure
    // over a secondary cleanup failure; on success report the first cleanup
    // failure after the remaining resources have been released.
    let cleanupFailed = false;
    let cleanupError: unknown;
    const release = (cleanup: () => void): void => {
      try {
        cleanup();
      } catch (error) {
        if (!cleanupFailed) cleanupError = error;
        cleanupFailed = true;
      }
    };
    release(() => {
      if (ownsSynth) {
        if (synth?.dispose) synth.dispose();
        else synth?.disconnect?.();
      } else {
        routeCleanup?.();
      }
    });
    release(() => effectHandle?.dispose?.());
    release(() => output.disconnect());
    if (failed) throw failure;
    if (cleanupFailed) throw cleanupError;
  }
  return buffer!;
}

/** Render straight to a downloadable WAV blob. */
export async function renderScoreToWav(score: Score, options: RenderOptions = {}): Promise<Blob> {
  return bufferToWav(await renderScoreToBuffer(score, options));
}

/** Encode an `AudioBuffer` as a 16-bit PCM WAV `Blob`. */
export function bufferToWav(buffer: AudioBuffer): Blob {
  const channels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const frames = buffer.length;
  const bytesPerSample = 2;
  const blockAlign = channels * bytesPerSample;
  const dataSize = frames * blockAlign;
  const out = new ArrayBuffer(44 + dataSize);
  const view = new DataView(out);

  const writeString = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 8 * bytesPerSample, true);
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);

  const channelData: Float32Array[] = [];
  for (let c = 0; c < channels; c += 1) channelData.push(buffer.getChannelData(c));

  let offset = 44;
  for (let i = 0; i < frames; i += 1) {
    for (let c = 0; c < channels; c += 1) {
      const sample = Math.max(-1, Math.min(1, channelData[c][i]));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += 2;
    }
  }

  return new Blob([out], {type: 'audio/wav'});
}
