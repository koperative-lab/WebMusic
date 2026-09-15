import type {HeadlessSynth} from '../audio-contracts';
import type {SoundBackend, ToneInstrumentLike} from './contracts';

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export function isHeadlessSynth(value: unknown): value is HeadlessSynth {
  const candidate = value as Record<string, unknown>;
  return !!candidate &&
    typeof candidate.noteOn === 'function' &&
    typeof candidate.triggerAttack !== 'function';
}

/** Wrap a Tone.js instrument as a HeadlessSynth routed through the Sound bus. */
export function toneAdapter(instrument: ToneInstrumentLike): SoundBackend {
  return {
    connect: (destination) => {
      instrument.connect?.(destination);
    },
    disconnect: () => {
      instrument.disconnect?.();
    },
    noteOn: (midi, velocity, time) => {
      instrument.triggerAttack?.(midiToNoteName(midi), time, velocity / 127);
    },
    noteOff: (midi, time) => {
      instrument.triggerRelease?.(midiToNoteName(midi), time);
    },
    dispose: () => {
      instrument.dispose?.();
    },
  };
}

export function midiToNoteName(midi: number): string {
  return `${NOTE_NAMES[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
}
