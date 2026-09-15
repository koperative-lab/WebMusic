// ============================================================================
// Live input drivers for the PULL engine (InteractivePlayer.advance()).
//
// Where `./drivers` binds scroll / pointer / orientation / value to a
// ScorePlayer's continuous timeline, these drive the discrete beat signal:
//   • Metronome / bindClock — advance one beat at a steady BPM
//   • bindMidiInput          — a MIDI keyboard or MIDI clock advances beats
// ============================================================================

import {createTickSource, type TickSource} from '@webmusic/kernel/tick';
import type {InteractivePlayer} from './interactive-player';

export interface ClockOptions {
  /** Beats per minute. Default 120. */
  bpm?: number;
  /** Tick source factory; defaults to the kernel worker-backed tick source. */
  createTickSource?: (intervalMs: number) => TickSource;
}

/** Beat period as the integer millisecond cadence a tick source accepts. */
function beatIntervalMs(bpm: number): number {
  return Math.max(1, Math.round(60_000 / bpm));
}

/**
 * A simple steady clock that fires a callback once per beat.
 *
 * The cadence comes from the kernel tick source rather than a bare
 * `setInterval`. This clock is the musical time base for {@link bindClock}
 * and for AbPlayer's playback, and main-thread timers are throttled to >=1s
 * in background tabs (to once a minute under intensive throttling) — which
 * would audibly drag a performance the moment the tab is hidden. The source's
 * interval IS the beat period, so beat placement keeps the fidelity of the
 * timer it replaces; a tempo change rebuilds it, exactly as this class
 * previously restarted its interval.
 */
export class Metronome {
  private source?: TickSource;
  private bpmValue: number;
  private readonly makeSource: (intervalMs: number) => TickSource;

  constructor(private readonly onTick: (secondsPerBeat: number) => void, options: ClockOptions = {}) {
    this.bpmValue = Math.max(1, options.bpm ?? 120);
    this.makeSource = options.createTickSource ?? ((intervalMs) => createTickSource({intervalMs}));
  }

  get bpm(): number {
    return this.bpmValue;
  }

  get running(): boolean {
    return this.source !== undefined;
  }

  setBpm(bpm: number): this {
    this.bpmValue = Math.max(1, bpm);
    if (this.running) {
      this.stop();
      this.start();
    }
    return this;
  }

  start(): this {
    if (this.running) return this;
    const secondsPerBeat = 60 / this.bpmValue;
    const source = this.makeSource(beatIntervalMs(this.bpmValue));
    this.source = source;
    source.start(() => this.onTick(secondsPerBeat));
    return this;
  }

  /** Stop the beat and release the tick source; `start()` builds a new one. */
  stop(): this {
    const source = this.source;
    this.source = undefined;
    source?.dispose();
    return this;
  }
}

/** Drive a player's `advance()` at a steady BPM. Returns an unbind function. */
export function bindClock(player: InteractivePlayer, options: ClockOptions = {}): () => void {
  const metronome = new Metronome((secondsPerBeat) => player.advance({secondsPerBeat}), options).start();
  return () => metronome.stop();
}

/** Structural shape of a Web MIDI input (avoids depending on lib.dom WebMIDI types). */
export interface MidiInputLike {
  onmidimessage: ((event: {data: Uint8Array | number[]}) => void) | null;
}

export interface MidiInputOptions {
  /** A specific MIDI input. If omitted, the first available input is requested. */
  input?: MidiInputLike;
  /** `note`: each note-on advances a beat. `clock`: MIDI clock pulses advance beats. Default `note`. */
  mode?: 'note' | 'clock';
  /** Clock pulses per beat (MIDI clock is 24). Default 24. */
  pulsesPerBeat?: number;
  /** Custom note-on handler. When set (note mode), it runs instead of `advance()`. */
  onNote?: (midi: number, velocity: number) => void;
}

/**
 * Let a MIDI keyboard or MIDI clock drive a player's `advance()`. Returns an
 * unbind function. On browsers without Web MIDI (and no explicit `input`), it
 * warns and the unbind is a no-op.
 */
export function bindMidiInput(player: InteractivePlayer, options: MidiInputOptions = {}): () => void {
  const mode = options.mode ?? 'note';
  const pulsesPerBeat = options.pulsesPerBeat ?? 24;
  let pulses = 0;
  let cancelled = false;
  let attached: MidiInputLike | undefined;
  let previousHandler: MidiInputLike['onmidimessage'] = null;

  const handle = (event: {data: Uint8Array | number[]}) => {
    if (cancelled || attached?.onmidimessage !== handle) return;
    const data = event.data;
    const status = data[0];
    if (mode === 'clock') {
      if (status === 0xf8) {
        pulses += 1;
        if (pulses >= pulsesPerBeat) {
          pulses = 0;
          player.advance();
        }
      } else if (status === 0xfa || status === 0xfc) {
        pulses = 0; // start / stop
      }
      return;
    }
    // note mode — a note-on (status 0x90–0x9F) with non-zero velocity
    if ((status & 0xf0) === 0x90 && data[2] > 0) {
      if (options.onNote) options.onNote(data[1], data[2]);
      else player.advance();
    }
  };

  const attach = (input: MidiInputLike) => {
    if (cancelled) return;
    attached = input;
    previousHandler = input.onmidimessage;
    input.onmidimessage = handle;
  };

  if (options.input) {
    attach(options.input);
  } else {
    const nav =
      typeof navigator !== 'undefined'
        ? (navigator as Navigator & {requestMIDIAccess?: () => Promise<{inputs: Map<string, MidiInputLike>}>})
        : undefined;
    if (nav?.requestMIDIAccess) {
      nav
        .requestMIDIAccess()
        .then((access) => {
          const input = access.inputs.values().next().value as MidiInputLike | undefined;
          if (input) attach(input);
        })
        .catch(() => undefined);
    } else if (typeof console !== 'undefined') {
      console.warn('bindMidiInput: Web MIDI is not available; pass { input }.');
    }
  }

  return () => {
    if (cancelled) return;
    cancelled = true;
    const input = attached;
    attached = undefined;
    if (input?.onmidimessage === handle) input.onmidimessage = previousHandler;
    previousHandler = null;
  };
}
