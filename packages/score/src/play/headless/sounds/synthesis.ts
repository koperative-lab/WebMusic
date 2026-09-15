import type {HeadlessSynth} from '../audio-contracts';
import {midiToFrequency} from '../audio-utils';
import type {FmOptions, NoiseOptions, WavetableOptions} from './contracts';

interface ExactSynthesisVoice {
  midi: number;
  sources: AudioScheduledSourceNode[];
  envelope: GainNode;
  startTime: number;
  logicalEndTime: number;
  level: number;
  attackSeconds: number;
  releaseSeconds: number;
}

/** Exact per-attack ownership shared by the built-in synthesis backends. */
class ExactSynthesisVoices {
  private readonly byId = new Map<number, ExactSynthesisVoice>();
  private readonly byMidi = new Map<number, Set<number>>();
  private nextId = 1;

  constructor(private readonly context: AudioContext) {}

  register(voice: ExactSynthesisVoice): number {
    const id = this.nextId++;
    this.byId.set(id, voice);
    const ids = this.byMidi.get(voice.midi) ?? new Set<number>();
    ids.add(id);
    this.byMidi.set(voice.midi, ids);
    let remaining = voice.sources.length;
    for (const source of voice.sources) {
      source.onended = () => {
        remaining -= 1;
        if (remaining === 0) this.forget(id, voice);
      };
    }
    return id;
  }

  releaseMidi(midi: number, time: number): void {
    this.releaseIds([...(this.byMidi.get(midi) ?? [])], time);
  }

  releaseById(handle: unknown, time: number): void {
    const id = typeof handle === 'number' ? handle : undefined;
    const voice = id == null ? undefined : this.byId.get(id);
    if (id == null || !voice) return;
    this.forget(id, voice);
    this.releaseVoice(voice, time);
  }

  retime(handle: unknown, logicalEndTime: number): void {
    const voice = typeof handle === 'number' ? this.byId.get(handle) : undefined;
    if (!voice) return;
    voice.logicalEndTime = logicalEndTime;
    const now = this.context.currentTime;
    const param = voice.envelope.gain;
    try {
      if (now <= voice.startTime) {
        param.cancelScheduledValues(now);
        param.setValueAtTime(0.0001, voice.startTime);
        param.exponentialRampToValueAtTime(
          voice.level,
          voice.startTime + voice.attackSeconds,
        );
      } else if (typeof param.cancelAndHoldAtTime === 'function') {
        param.cancelAndHoldAtTime(now);
      } else {
        param.cancelScheduledValues(now);
        param.setValueAtTime(Math.max(param.value, 0.0001), now);
      }
      if (logicalEndTime <= now) {
        param.exponentialRampToValueAtTime(0.0001, now + voice.releaseSeconds);
      } else {
        param.setTargetAtTime(
          0.0001,
          logicalEndTime,
          Math.max(0.0001, voice.releaseSeconds / 3),
        );
      }
    } catch {
      // The hard source stop below remains the authoritative safety bound.
    }
    for (const source of voice.sources) {
      try {
        source.stop(Math.max(now, logicalEndTime) + voice.releaseSeconds);
      } catch {
        // An already-ended voice is already safe.
      }
    }
  }

  releaseAll(time = this.context.currentTime): void {
    this.releaseIds([...this.byId.keys()], time);
  }

  private releaseIds(ids: readonly number[], time: number): void {
    let firstError: unknown;
    for (const id of ids) {
      try {
        this.releaseById(id, time);
      } catch (error) {
        firstError ??= error;
      }
    }
    if (firstError !== undefined) throw firstError;
  }

  private forget(id: number, voice: ExactSynthesisVoice): void {
    if (!this.byId.delete(id)) return;
    const ids = this.byMidi.get(voice.midi);
    ids?.delete(id);
    if (ids?.size === 0) this.byMidi.delete(voice.midi);
  }

  private releaseVoice(voice: ExactSynthesisVoice, time: number): void {
    const param = voice.envelope.gain;
    if (time <= voice.startTime) {
      try {
        param.cancelScheduledValues(time);
        param.setValueAtTime(0, time);
      } finally {
        for (const source of voice.sources) {
          try {
            source.stop(time);
          } catch {
            // An ended source is already silent.
          }
        }
      }
      return;
    }
    try {
      if (typeof param.cancelAndHoldAtTime === 'function') {
        param.cancelAndHoldAtTime(time);
      } else {
        param.cancelScheduledValues(time);
        param.setValueAtTime(Math.max(param.value, 0.0001), time);
      }
      param.exponentialRampToValueAtTime(0.0001, time + voice.releaseSeconds);
    } finally {
      for (const source of voice.sources) {
        try {
          // A later stop() replaces the original hard end, while an earlier
          // one reliably shortens pause/seek/stop and live note-off.
          source.stop(time + voice.releaseSeconds);
        } catch {
          // An ended source is already silent.
        }
      }
    }
  }
}

/** Two-operator FM: a modulator oscillator drives the carrier frequency. */
export class FmBackend implements HeadlessSynth {
  readonly supportsScheduledCancellation = true;
  private readonly output: GainNode;
  private readonly voices: ExactSynthesisVoices;
  private readonly options: Required<Pick<
    FmOptions,
    'ratio' | 'index' | 'carrierType' | 'modulatorType' | 'attackSeconds' | 'releaseSeconds'
  >>;

  constructor(private readonly context: AudioContext, options: FmOptions = {}) {
    this.output = context.createGain();
    this.voices = new ExactSynthesisVoices(context);
    this.options = {
      ratio: options.ratio ?? 2,
      index: options.index ?? 200,
      carrierType: options.carrierType ?? 'sine',
      modulatorType: options.modulatorType ?? 'sine',
      attackSeconds: options.attackSeconds ?? 0.005,
      releaseSeconds: options.releaseSeconds ?? 0.12,
    };
  }

  connect(destination: AudioNode): () => void {
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
    const frequency = midiToFrequency(midi);
    const carrier = this.context.createOscillator();
    carrier.type = this.options.carrierType;
    carrier.frequency.value = frequency;
    const modulator = this.context.createOscillator();
    modulator.type = this.options.modulatorType;
    modulator.frequency.value = frequency * this.options.ratio;
    const modulation = this.context.createGain();
    modulation.gain.value = this.options.index;
    modulator.connect(modulation).connect(carrier.frequency);

    const envelope = this.context.createGain();
    const level = Math.max(0.0001, (velocity / 127) * 0.9);
    envelope.gain.setValueAtTime(0.0001, time);
    envelope.gain.exponentialRampToValueAtTime(level, time + this.options.attackSeconds);
    envelope.gain.setTargetAtTime(
      0.0001,
      time + durationSeconds,
      this.options.releaseSeconds / 3,
    );
    carrier.connect(envelope).connect(this.output);

    const stopAt = time + durationSeconds + this.options.releaseSeconds;
    carrier.start(time);
    modulator.start(time);
    carrier.stop(stopAt);
    modulator.stop(stopAt);
    return this.voices.register({
      midi,
      sources: [carrier, modulator],
      envelope,
      startTime: time,
      logicalEndTime: time + durationSeconds,
      level,
      attackSeconds: this.options.attackSeconds,
      releaseSeconds: this.options.releaseSeconds,
    });
  }

  noteOff(midi: number, time: number): void {
    this.voices.releaseMidi(midi, time);
  }

  noteOffById(handle: unknown, time: number): void {
    this.voices.releaseById(handle, time);
  }

  cancelScheduledNote(handle: unknown, time: number): void {
    this.voices.releaseById(handle, time);
  }

  retimeScheduledNote(handle: unknown, time: number): void {
    this.voices.retime(handle, time);
  }

  dispose(): void {
    disposeSynthesisBackend(this.voices, () => this.disconnect());
  }
}

/** Wavetable oscillator backed by a PeriodicWave. */
export class WavetableBackend implements HeadlessSynth {
  readonly supportsScheduledCancellation = true;
  private readonly output: GainNode;
  private readonly voices: ExactSynthesisVoices;
  private readonly wave: PeriodicWave;
  private readonly attackSeconds: number;
  private readonly releaseSeconds: number;

  constructor(private readonly context: AudioContext, options: WavetableOptions = {}) {
    this.output = context.createGain();
    this.voices = new ExactSynthesisVoices(context);
    const real = Float32Array.from(options.real ?? [0, 1, 0.5, 0.25, 0.12]);
    const imag = Float32Array.from(options.imag ?? new Array(real.length).fill(0));
    this.wave = context.createPeriodicWave(real, imag);
    this.attackSeconds = options.attackSeconds ?? 0.008;
    this.releaseSeconds = options.releaseSeconds ?? 0.1;
  }

  connect(destination: AudioNode): () => void {
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
    const oscillator = this.context.createOscillator();
    oscillator.setPeriodicWave(this.wave);
    oscillator.frequency.value = midiToFrequency(midi);
    const envelope = this.context.createGain();
    const level = Math.max(0.0001, (velocity / 127) * 0.22);
    envelope.gain.setValueAtTime(0.0001, time);
    envelope.gain.exponentialRampToValueAtTime(level, time + this.attackSeconds);
    envelope.gain.setTargetAtTime(0.0001, time + durationSeconds, this.releaseSeconds / 3);
    oscillator.connect(envelope).connect(this.output);
    oscillator.start(time);
    oscillator.stop(time + durationSeconds + this.releaseSeconds);
    return this.voices.register({
      midi,
      sources: [oscillator],
      envelope,
      startTime: time,
      logicalEndTime: time + durationSeconds,
      level,
      attackSeconds: this.attackSeconds,
      releaseSeconds: this.releaseSeconds,
    });
  }

  noteOff(midi: number, time: number): void {
    this.voices.releaseMidi(midi, time);
  }

  noteOffById(handle: unknown, time: number): void {
    this.voices.releaseById(handle, time);
  }

  cancelScheduledNote(handle: unknown, time: number): void {
    this.voices.releaseById(handle, time);
  }

  retimeScheduledNote(handle: unknown, time: number): void {
    this.voices.retime(handle, time);
  }

  dispose(): void {
    disposeSynthesisBackend(this.voices, () => this.disconnect());
  }
}

/** Filtered white noise for percussion, wind and effects. */
export class NoiseBackend implements HeadlessSynth {
  readonly supportsScheduledCancellation = true;
  private readonly output: GainNode;
  private readonly voices: ExactSynthesisVoices;
  private readonly buffer: AudioBuffer;
  private readonly pitched: boolean;
  private readonly q: number;
  private readonly attackSeconds: number;
  private readonly releaseSeconds: number;

  constructor(private readonly context: AudioContext, options: NoiseOptions = {}) {
    this.output = context.createGain();
    this.voices = new ExactSynthesisVoices(context);
    this.pitched = options.pitched ?? true;
    this.q = options.Q ?? 8;
    this.attackSeconds = options.attackSeconds ?? 0.001;
    this.releaseSeconds = options.releaseSeconds ?? 0.12;
    const frames = Math.max(1, Math.floor(context.sampleRate));
    this.buffer = context.createBuffer(1, frames, context.sampleRate);
    const data = this.buffer.getChannelData(0);
    for (let index = 0; index < frames; index += 1) {
      data[index] = Math.random() * 2 - 1;
    }
  }

  connect(destination: AudioNode): () => void {
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
    const source = this.context.createBufferSource();
    source.buffer = this.buffer;
    source.loop = true;
    const envelope = this.context.createGain();
    const level = Math.max(0.0001, (velocity / 127) * 0.5);
    envelope.gain.setValueAtTime(0.0001, time);
    envelope.gain.exponentialRampToValueAtTime(level, time + this.attackSeconds);
    envelope.gain.setTargetAtTime(0.0001, time + durationSeconds, this.releaseSeconds / 3);

    let tail: AudioNode = source;
    if (this.pitched) {
      const band = this.context.createBiquadFilter();
      band.type = 'bandpass';
      band.frequency.value = midiToFrequency(midi);
      band.Q.value = this.q;
      source.connect(band);
      tail = band;
    }
    tail.connect(envelope).connect(this.output);
    source.start(time);
    source.stop(time + durationSeconds + this.releaseSeconds);
    return this.voices.register({
      midi,
      sources: [source],
      envelope,
      startTime: time,
      logicalEndTime: time + durationSeconds,
      level,
      attackSeconds: this.attackSeconds,
      releaseSeconds: this.releaseSeconds,
    });
  }

  noteOff(midi: number, time: number): void {
    this.voices.releaseMidi(midi, time);
  }

  noteOffById(handle: unknown, time: number): void {
    this.voices.releaseById(handle, time);
  }

  cancelScheduledNote(handle: unknown, time: number): void {
    this.voices.releaseById(handle, time);
  }

  retimeScheduledNote(handle: unknown, time: number): void {
    this.voices.retime(handle, time);
  }

  dispose(): void {
    disposeSynthesisBackend(this.voices, () => this.disconnect());
  }
}

function disposeSynthesisBackend(
  voices: ExactSynthesisVoices,
  disconnect: () => void,
): void {
  let firstError: unknown;
  try {
    voices.releaseAll();
  } catch (error) {
    firstError = error;
  }
  try {
    disconnect();
  } catch (error) {
    firstError ??= error;
  }
  if (firstError !== undefined) throw firstError;
}
