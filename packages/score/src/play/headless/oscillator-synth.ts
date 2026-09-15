import type {HeadlessSynth, OscillatorSynthOptions} from './audio-contracts';
import {midiToFrequency} from './audio-utils';

interface ActiveOscillator {
  oscillator: OscillatorNode;
  gain: GainNode;
  startTime: number;
}

export function createOscillatorSynth(
  context: AudioContext,
  options: OscillatorSynthOptions = {},
): OscillatorSynth {
  return new OscillatorSynth(context, options);
}

/** Polyphonic oscillator backend with per-voice filtering and envelopes. */
export class OscillatorSynth implements HeadlessSynth {
  /** This backend can retract an attack queued at a future AudioContext time. */
  readonly supportsScheduledCancellation = true;
  private readonly output: GainNode;
  private readonly active = new Map<number, Set<ActiveOscillator>>();
  /** Sources remain owned until onended, including voices in their release tail. */
  private readonly sources = new Set<ActiveOscillator>();
  private readonly byId = new Map<number, {midi: number; voice: ActiveOscillator}>();
  private nextId = 1;
  private readonly options: Required<OscillatorSynthOptions>;
  private disposed = false;

  constructor(private readonly context: AudioContext, options: OscillatorSynthOptions = {}) {
    this.output = context.createGain();
    this.options = {
      type: options.type ?? 'triangle',
      attackSeconds: options.attackSeconds ?? 0.012,
      releaseSeconds: options.releaseSeconds ?? 0.08,
      gain: options.gain ?? 0.16,
      detune: options.detune ?? 0,
      cutoff: options.cutoff ?? 20000,
      resonance: options.resonance ?? 0.7,
    };
  }

  setParam<K extends keyof OscillatorSynthOptions>(key: K, value: Required<OscillatorSynthOptions>[K]): void {
    this.options[key] = value;
  }

  connect(destination: AudioNode): () => void {
    if (this.disposed) throw new Error('OscillatorSynth has been disposed.');
    this.output.connect(destination);
    return () => {
      try {
        this.output.disconnect(destination);
      } catch {
        // The route may already have been removed by an owning graph teardown.
      }
    };
  }

  disconnect(): void {
    this.output.disconnect();
  }

  noteOn(midi: number, velocity: number, time: number, durationSeconds: number): number {
    if (this.disposed) throw new Error('OscillatorSynth has been disposed.');
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    const voice = {oscillator, gain, startTime: time};
    const level = Math.max(0.01, Math.min(this.options.gain, (velocity / 127) * this.options.gain));

    oscillator.type = this.options.type;
    oscillator.frequency.setValueAtTime(midiToFrequency(midi), time);
    oscillator.detune.setValueAtTime(this.options.detune, time);
    const filter = this.context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(Math.max(20, this.options.cutoff), time);
    filter.Q.setValueAtTime(this.options.resonance, time);
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(level, time + this.options.attackSeconds);
    oscillator.connect(filter).connect(gain).connect(this.output);
    oscillator.start(time);
    oscillator.stop(time + durationSeconds + this.options.releaseSeconds);

    let voices = this.active.get(midi);
    if (!voices) {
      voices = new Set();
      this.active.set(midi, voices);
    }
    voices.add(voice);
    this.sources.add(voice);
    const id = this.nextId++;
    this.byId.set(id, {midi, voice});
    oscillator.onended = () => {
      voices?.delete(voice);
      this.sources.delete(voice);
      this.byId.delete(id);
    };
    return id;
  }

  noteOff(midi: number, time: number): void {
    const voices = this.active.get(midi);
    if (!voices) return;
    for (const voice of voices) this.releaseVoice(voice, time);
    voices.clear();
    for (const [id, record] of this.byId) if (record.midi === midi) this.byId.delete(id);
  }

  noteOffById(handle: unknown, time: number): void {
    this.releaseById(handle, time);
  }

  /**
   * Retract a voice that may not have reached its scheduled AudioContext
   * onset yet. This is intentionally stricter than an ordinary release: a
   * future oscillator is stopped and its queued envelope is silenced.
   */
  cancelScheduledNote(handle: unknown, time: number): void {
    this.releaseById(handle, time);
  }

  /** Move the source's hard stop while the scheduler retimes an active voice. */
  retimeScheduledNote(handle: unknown, time: number): void {
    const record = typeof handle === 'number' ? this.byId.get(handle) : undefined;
    if (!record) return;
    try {
      // The Web Audio contract replaces a prior stop() request with the most
      // recent one, so a slowdown can extend a note instead of leaving the
      // original duration as a hidden hard cutoff.
      record.voice.oscillator.stop(time + this.options.releaseSeconds);
    } catch {
      // An ended source cannot be retimed and is already silent.
    }
  }

  private releaseById(handle: unknown, time: number): void {
    const record = typeof handle === 'number' ? this.byId.get(handle) : undefined;
    if (!record) return;
    this.byId.delete(handle as number);
    this.active.get(record.midi)?.delete(record.voice);
    this.releaseVoice(record.voice, time);
  }

  private releaseVoice(voice: ActiveOscillator, time: number): void {
    if (time <= voice.startTime) {
      this.hardStopVoice(voice, time);
      return;
    }
    this.fadeOut(voice, time);
  }

  private fadeOut(voice: ActiveOscillator, time: number): void {
    voice.gain.gain.cancelScheduledValues(time);
    voice.gain.gain.setValueAtTime(Math.max(voice.gain.gain.value, 0.0001), time);
    const stopTime = time + this.options.releaseSeconds;
    voice.gain.gain.exponentialRampToValueAtTime(0.0001, stopTime);
    try {
      // Replace the original duration-based stop so an early note-off cannot
      // leave an inaudible oscillator running for the remainder of a long
      // scheduled note.
      voice.oscillator.stop(stopTime);
    } catch {
      // The source has already ended.
    }
  }

  private hardStopVoice(voice: ActiveOscillator, time: number): void {
    voice.gain.gain.cancelScheduledValues(time);
    voice.gain.gain.setValueAtTime(0, time);
    try {
      voice.oscillator.stop(time);
    } catch {
      // A source that already ended is harmless; zeroing the gain also keeps
      // any queued future envelope silent.
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const now = Number.isFinite(this.context.currentTime) ? this.context.currentTime : 0;
    for (const voice of this.sources) this.hardStopVoice(voice, now);
    this.active.clear();
    this.sources.clear();
    this.byId.clear();
    this.disconnect();
  }
}
