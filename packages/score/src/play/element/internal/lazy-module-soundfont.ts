import type {ModuleContext} from '@webmusic/kernel/module';
import type {PreloadableHeadlessSynth} from '../../headless/audio-contracts';
import {createSoundfontSynth, type SoundfontSynth} from '../../headless/soundfont-synth';

/**
 * Player-owned URL-template sampler; the module environment remains borrowed.
 * Unlike Sound.custom(), preload forwards the score's sounding pitches. No
 * audio is allocated by construction, capability reads, or cleanup commands.
 */
export function createModuleSoundfont(context: ModuleContext, template: string): PreloadableHeadlessSynth {
  if (!template.includes('{midi}')) throw new TypeError('A module sound-font template requires {midi}.');
  let backend: SoundfontSynth | undefined;
  let disposed = false;
  let preparing = false;
  let connecting = false;
  let route: {release: () => void} | undefined;

  const prepare = (): SoundfontSynth => {
    if (disposed) throw new Error('Module soundfont has been disposed.');
    if (backend) return backend;
    if (preparing) throw new Error('Module soundfont preparation cannot re-enter.');
    preparing = true;
    try {
      // SoundfontSynth only uses BaseAudioContext operations. Its existing
      // public constructor retains the AudioContext type for compatibility.
      const audio = context.audio.prepare() as AudioContext;
      if (disposed) throw new Error('Module soundfont was disposed during preparation.');
      const candidate = createSoundfontSynth(audio, {
        resolveSample: (midi) => template.replace('{midi}', String(midi)),
      });
      if (disposed) {
        candidate.dispose();
        throw new Error('Module soundfont was disposed during preparation.');
      }
      backend = candidate;
      return candidate;
    } finally {
      preparing = false;
    }
  };

  return {
    // This helper always uses SoundfontSynth's default oscillator fallback;
    // both implementations support exact future-voice cancellation.
    get supportsScheduledCancellation() { return !disposed && (backend?.supportsScheduledCancellation ?? true); },
    connect(destination) {
      if (route || connecting) throw new Error('Module soundfont already has an active route.');
      connecting = true;
      try {
        const synth = prepare();
        if (destination.context !== context.audio.peek()) {
          throw new Error('Module soundfont destination belongs to a different AudioContext.');
        }
        const cleanup = synth.connect(destination);
        let active = true;
        const next = {
          release: (): void => {
            if (!active) return;
            active = false;
            if (route === next) route = undefined;
            cleanup();
          },
        };
        if (disposed) {
          next.release();
          throw new Error('Module soundfont was disposed during connection.');
        }
        route = next;
        return next.release;
      } finally {
        connecting = false;
      }
    },
    disconnect() { route?.release(); },
    async preload(notes) {
      const synth = prepare();
      await synth.preload(notes);
      if (disposed || backend !== synth) throw new Error('Module soundfont was disposed during preload.');
    },
    noteOn(midi, velocity, time, duration) { return prepare().noteOn(midi, velocity, time, duration); },
    noteOff(midi, time) { backend?.noteOff(midi, time); },
    noteOffById(handle, time) { backend?.noteOffById(handle, time); },
    cancelScheduledNote(handle, time) { backend?.cancelScheduledNote(handle, time); },
    retimeScheduledNote(handle, time) { backend?.retimeScheduledNote(handle, time); },
    dispose() {
      if (disposed) return;
      disposed = true;
      const synth = backend;
      backend = undefined;
      let failure: unknown;
      try { route?.release(); } catch (error) { failure = error; }
      try { synth?.dispose(); } catch (error) { failure ??= error; }
      if (failure !== undefined) throw failure;
    },
  };
}
