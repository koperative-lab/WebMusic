import type {HeadlessSynth, OscillatorSynthOptions} from './audio-contracts';
import {midiToFrequency} from './audio-utils';
import type {ConnectionLease, ParamSurface} from '@webmusic/kernel/module';
import {createOscillatorParameters, OSCILLATOR_PARAMETER_KEYS} from './internal/oscillator-parameters';
import {VoiceEnvelope, envelopeSettings} from './internal/voice-envelope';

interface ActiveOscillator {
  oscillator: OscillatorNode;
  gain: GainNode;
  filter: BiquadFilterNode;
  amplitude: GainNode;
  envelope: VoiceEnvelope;
  bindings: ConnectionLease[];
  startTime: number;
}

export function createOscillatorSynth(context: AudioContext, options: OscillatorSynthOptions = {}): OscillatorSynth {
  return new OscillatorSynth(context, options);
}

/** Polyphonic oscillator backend with per-occurrence ADSR and shared parameter CV. */
export class OscillatorSynth implements HeadlessSynth {
  readonly supportsScheduledCancellation = true;
  readonly supportsScheduledDuration = true;
  readonly supportsScheduledRetiming = true;
  readonly supportsNoteOccurrences = true;
  readonly params: ParamSurface;
  private readonly ownsParams: boolean;
  private readonly output: GainNode;
  private readonly active = new Map<number, Set<ActiveOscillator>>();
  private readonly sources = new Set<ActiveOscillator>();
  private readonly byId = new Map<number, {midi: number; voice: ActiveOscillator}>();
  private nextId = 1;
  private type: OscillatorType;
  private disposed = false;

  constructor(private readonly context: AudioContext, options: OscillatorSynthOptions = {}, sharedParams?: ParamSurface) {
    this.params = sharedParams ?? createOscillatorParameters(options);
    this.ownsParams = !sharedParams;
    for (const key of OSCILLATOR_PARAMETER_KEYS) {
      if (!this.params.get(key)) throw new Error(`Oscillator parameter surface is missing ${key}.`);
    }
    this.type = options.type ?? 'triangle';
    this.output = context.createGain();
  }

  setParam<K extends keyof OscillatorSynthOptions>(key: K, value: Required<OscillatorSynthOptions>[K]): void {
    if (this.disposed) throw new Error('OscillatorSynth has been disposed.');
    if (key === 'type') this.type = value as OscillatorType;
    else this.params.get(key)?.setBaseValue(value as number);
  }

  connect(destination: AudioNode): () => void {
    if (this.disposed) throw new Error('OscillatorSynth has been disposed.');
    this.output.connect(destination);
    return () => {
      try { this.output.disconnect(destination); } catch { /* Already detached. */ }
    };
  }

  disconnect(): void { this.output.disconnect(); }

  noteOn(midi: number, velocity: number, time: number, durationSeconds: number): number {
    if (this.disposed) throw new Error('OscillatorSynth has been disposed.');
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    const amplitude = this.context.createGain();
    const filter = this.context.createBiquadFilter();
    const settings = envelopeSettings({
      attackSeconds: this.params.get('attackSeconds')!.snapshot.baseValue,
      decaySeconds: this.params.get('decaySeconds')!.snapshot.baseValue,
      sustainLevel: this.params.get('sustainLevel')!.snapshot.baseValue,
      releaseSeconds: this.params.get('releaseSeconds')!.snapshot.baseValue,
    }, 0.012, 0.08);
    const bindings: ConnectionLease[] = [];
    const voice: ActiveOscillator = {
      oscillator, gain, amplitude, filter, startTime: time, bindings,
      envelope: new VoiceEnvelope(gain.gain, time, Math.max(0, Math.min(1, velocity / 127)), settings, durationSeconds),
    };
    try {
      oscillator.type = this.type;
      oscillator.frequency.setValueAtTime(midiToFrequency(midi), time);
      filter.type = 'lowpass';
      for (const [id, param] of [
        ['gain', amplitude.gain], ['detune', oscillator.detune],
        ['cutoff', filter.frequency], ['resonance', filter.Q],
      ] as const) bindings.push(this.params.get(id)!.bindAudioParam(this.context, param, {lazy: true}));
      oscillator.connect(filter).connect(gain).connect(amplitude).connect(this.output);
      oscillator.start(time);
      if (Number.isFinite(durationSeconds)) oscillator.stop(time + durationSeconds + settings.releaseSeconds);
    } catch (error) {
      this.cleanupVoice(voice);
      try { oscillator.stop(); } catch { /* Source might not have started. */ }
      throw error;
    }
    const voices = this.active.get(midi) ?? new Set<ActiveOscillator>();
    this.active.set(midi, voices);
    voices.add(voice);
    this.sources.add(voice);
    const id = this.nextId++;
    this.byId.set(id, {midi, voice});
    oscillator.onended = () => {
      voices.delete(voice);
      if (voices.size === 0) this.active.delete(midi);
      this.sources.delete(voice);
      this.byId.delete(id);
      this.cleanupVoice(voice);
    };
    return id;
  }

  noteOff(midi: number, time: number): void {
    let firstError: unknown;
    for (const [id, record] of [...this.byId]) if (record.midi === midi) {
      try { this.releaseById(id, time); } catch (error) { firstError ??= error; }
    }
    if (firstError !== undefined) throw firstError;
  }

  noteOffById(handle: unknown, time: number): void { this.releaseById(handle, time); }
  cancelScheduledNote(handle: unknown, time: number): void { this.releaseById(handle, time); }

  retimeScheduledNote(handle: unknown, time: number): void {
    const record = typeof handle === 'number' ? this.byId.get(handle) : undefined;
    if (!record) return;
    const end = record.voice.envelope.retime(time, this.context.currentTime);
    if (end !== undefined) try { record.voice.oscillator.stop(end); } catch { /* Already ended. */ }
  }

  private releaseById(handle: unknown, time: number): void {
    const record = typeof handle === 'number' ? this.byId.get(handle) : undefined;
    if (!record) return;
    this.byId.delete(handle as number);
    this.active.get(record.midi)?.delete(record.voice);
    if (time <= record.voice.startTime) this.hardStopVoice(record.voice, time);
    else {
      try { record.voice.envelope.release(time); } finally {
        try { record.voice.oscillator.stop(time + record.voice.envelope.settings.releaseSeconds); } catch { /* Already ended. */ }
      }
    }
  }

  private hardStopVoice(voice: ActiveOscillator, time: number): void {
    try { voice.envelope.cancel(time); } finally {
      try { voice.oscillator.stop(time); } catch { /* Already ended. */ }
    }
  }

  private cleanupVoice(voice: ActiveOscillator): void {
    let firstError: unknown;
    for (const binding of voice.bindings.splice(0)) {
      try { binding.release(); } catch (error) { firstError ??= error; }
    }
    for (const node of [voice.oscillator, voice.filter, voice.gain, voice.amplitude]) {
      try { node.disconnect(); } catch (error) { firstError ??= error; }
    }
    if (firstError !== undefined) throw firstError;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const now = Number.isFinite(this.context.currentTime) ? this.context.currentTime : 0;
    let firstError: unknown;
    for (const voice of this.sources) {
      try { this.hardStopVoice(voice, now); } catch (error) { firstError ??= error; }
      try { this.cleanupVoice(voice); } catch (error) { firstError ??= error; }
    }
    this.active.clear(); this.sources.clear(); this.byId.clear();
    try { this.disconnect(); } catch (error) { firstError ??= error; }
    for (const handle of this.params) {
      try {
        if (this.ownsParams) handle.dispose();
        else handle.releaseAudio(this.context);
      } catch (error) { firstError ??= error; }
    }
    if (firstError !== undefined) throw firstError;
  }
}
