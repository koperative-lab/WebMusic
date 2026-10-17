import type {ParamSurface} from '@webmusic/kernel/module';
import {createEnvelopeParameters, readEnvelopeParameters} from '../internal/envelope-parameters';
import {VoiceEnvelope} from '../internal/voice-envelope';
import type {HeadlessSynth} from '../audio-contracts';
import {midiToFrequency} from '../audio-utils';
import type {FmOptions, NoiseOptions, WavetableOptions} from './contracts';

interface ExactSynthesisVoice {
  midi: number;
  sources: AudioScheduledSourceNode[];
  envelope: GainNode;
  contour: VoiceEnvelope;
  startTime: number;
}

/** Exact per-attack ownership, retaining release tails until all sources end. */
class ExactSynthesisVoices {
  private readonly byId = new Map<number, ExactSynthesisVoice>();
  private readonly sources = new Set<ExactSynthesisVoice>();
  private nextId = 1;
  constructor(private readonly context: AudioContext) {}

  register(voice: ExactSynthesisVoice): number {
    const id = this.nextId++;
    this.byId.set(id, voice);
    this.sources.add(voice);
    let remaining = voice.sources.length;
    for (const source of voice.sources) source.onended = () => {
      if (--remaining !== 0) return;
      this.byId.delete(id);
      this.sources.delete(voice);
      for (const owned of voice.sources) owned.disconnect();
      voice.envelope.disconnect();
    };
    return id;
  }

  releaseMidi(midi: number, time: number): void {
    let firstError: unknown;
    for (const [id, voice] of [...this.byId]) {
      if (voice.midi !== midi) continue;
      try { this.releaseById(id, time); } catch (error) { firstError ??= error; }
    }
    if (firstError !== undefined) throw firstError;
  }

  releaseById(handle: unknown, time: number): void {
    const voice = typeof handle === 'number' ? this.byId.get(handle) : undefined;
    if (!voice) return;
    this.byId.delete(handle as number);
    const cancel = time <= voice.startTime;
    try { this.releaseVoice(voice, time, cancel); } finally {
      if (cancel) {
        this.sources.delete(voice);
        for (const source of voice.sources) source.disconnect();
        voice.envelope.disconnect();
      }
    }
  }

  retime(handle: unknown, end: number): void {
    const voice = typeof handle === 'number' ? this.byId.get(handle) : undefined;
    if (!voice) return;
    const stop = voice.contour.retime(end, this.context.currentTime);
    if (stop !== undefined) for (const source of voice.sources) {
      try { source.stop(stop); } catch { /* Already ended. */ }
    }
  }

  releaseAll(time = this.context.currentTime): void {
    let firstError: unknown;
    for (const voice of this.sources) {
      try { this.releaseVoice(voice, time, true); } catch (error) { firstError ??= error; }
    }
    this.byId.clear();
    this.sources.clear();
    if (firstError !== undefined) throw firstError;
  }

  private releaseVoice(voice: ExactSynthesisVoice, time: number, cancel: boolean): void {
    let stop = cancel ? time : time + voice.contour.settings.releaseSeconds;
    try {
      if (cancel) voice.contour.cancel(time);
      else stop = voice.contour.release(time);
    } finally {
      for (const source of voice.sources) {
        try { source.stop(stop); } catch { /* Already ended. */ }
      }
    }
  }
}

/** Two-operator FM: a modulator oscillator drives the carrier frequency. */
export class FmBackend implements HeadlessSynth {
  readonly supportsScheduledCancellation = true;
  readonly supportsScheduledDuration = true;
  readonly supportsScheduledRetiming = true;
  readonly supportsNoteOccurrences = true;
  private readonly output: GainNode;
  private readonly voices: ExactSynthesisVoices;
  private readonly options: Required<Pick<
    FmOptions,
    'ratio' | 'index' | 'carrierType' | 'modulatorType'
  >>;

  readonly params: ParamSurface;
  private readonly ownsParams: boolean;

  constructor(private readonly context: AudioContext, options: FmOptions = {}, sharedParams?: ParamSurface) {
    this.params = sharedParams ?? createEnvelopeParameters(options, 0.005, 0.12);
    this.ownsParams = !sharedParams;
    this.output = context.createGain();
    this.voices = new ExactSynthesisVoices(context);
    this.options = {
      ratio: options.ratio ?? 2,
      index: options.index ?? 200,
      carrierType: options.carrierType ?? 'sine',
      modulatorType: options.modulatorType ?? 'sine',
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

    const settings = readEnvelopeParameters(this.params);
    const envelope = this.context.createGain();
    const level = Math.max(0, (velocity / 127) * 0.9);
    const contour = new VoiceEnvelope(envelope.gain, time, level, settings, durationSeconds);
    carrier.connect(envelope).connect(this.output);

    const stopAt = time + durationSeconds + settings.releaseSeconds;
    carrier.start(time);
    modulator.start(time);
    if (Number.isFinite(stopAt)) { carrier.stop(stopAt); modulator.stop(stopAt); }
    return this.voices.register({
      midi,
      sources: [carrier, modulator],
      envelope,
      startTime: time,
      contour,
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
    try { disposeSynthesisBackend(this.voices, () => this.disconnect()); } finally {
      if (this.ownsParams) for (const handle of this.params) handle.dispose();
    }
  }
}

/** Wavetable oscillator backed by a PeriodicWave. */
export class WavetableBackend implements HeadlessSynth {
  readonly supportsScheduledCancellation = true;
  readonly supportsScheduledDuration = true;
  readonly supportsScheduledRetiming = true;
  readonly supportsNoteOccurrences = true;
  private readonly output: GainNode;
  private readonly voices: ExactSynthesisVoices;
  private readonly wave: PeriodicWave;
  readonly params: ParamSurface;
  private readonly ownsParams: boolean;

  constructor(private readonly context: AudioContext, options: WavetableOptions = {}, sharedParams?: ParamSurface) {
    this.output = context.createGain();
    this.voices = new ExactSynthesisVoices(context);
    const real = Float32Array.from(options.real ?? [0, 1, 0.5, 0.25, 0.12]);
    const imag = Float32Array.from(options.imag ?? new Array(real.length).fill(0));
    this.wave = context.createPeriodicWave(real, imag);
    this.params = sharedParams ?? createEnvelopeParameters(options, 0.008, 0.1);
    this.ownsParams = !sharedParams;
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
    const settings = readEnvelopeParameters(this.params);
    const envelope = this.context.createGain();
    const level = Math.max(0, (velocity / 127) * 0.22);
    const contour = new VoiceEnvelope(envelope.gain, time, level, settings, durationSeconds);
    oscillator.connect(envelope).connect(this.output);
    oscillator.start(time);
    if (Number.isFinite(durationSeconds)) oscillator.stop(time + durationSeconds + settings.releaseSeconds);
    return this.voices.register({
      midi,
      sources: [oscillator],
      envelope,
      startTime: time,
      contour,
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
    try { disposeSynthesisBackend(this.voices, () => this.disconnect()); } finally {
      if (this.ownsParams) for (const handle of this.params) handle.dispose();
    }
  }
}

/** Filtered white noise for percussion, wind and effects. */
export class NoiseBackend implements HeadlessSynth {
  readonly supportsScheduledCancellation = true;
  readonly supportsScheduledDuration = true;
  readonly supportsScheduledRetiming = true;
  readonly supportsNoteOccurrences = true;
  private readonly output: GainNode;
  private readonly voices: ExactSynthesisVoices;
  private readonly buffer: AudioBuffer;
  private readonly pitched: boolean;
  private readonly q: number;
  readonly params: ParamSurface;
  private readonly ownsParams: boolean;

  constructor(private readonly context: AudioContext, options: NoiseOptions = {}, sharedParams?: ParamSurface) {
    this.output = context.createGain();
    this.voices = new ExactSynthesisVoices(context);
    this.pitched = options.pitched ?? true;
    this.q = options.Q ?? 8;
    this.params = sharedParams ?? createEnvelopeParameters(options, 0.001, 0.12);
    this.ownsParams = !sharedParams;
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
    const settings = readEnvelopeParameters(this.params);
    const envelope = this.context.createGain();
    const level = Math.max(0, (velocity / 127) * 0.5);
    const contour = new VoiceEnvelope(envelope.gain, time, level, settings, durationSeconds);
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
    if (Number.isFinite(durationSeconds)) source.stop(time + durationSeconds + settings.releaseSeconds);
    return this.voices.register({
      midi,
      sources: [source],
      envelope,
      startTime: time,
      contour,
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
    try { disposeSynthesisBackend(this.voices, () => this.disconnect()); } finally {
      if (this.ownsParams) for (const handle of this.params) handle.dispose();
    }
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
