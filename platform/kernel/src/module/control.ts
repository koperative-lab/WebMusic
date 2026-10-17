import {ParamHandle} from './parameter';
import type {ControlSignal} from './param-audio';

export interface ControlLFOOptions {
  readonly frequency?: number;
  readonly waveform?: Exclude<OscillatorType, 'custom'>;
}

/** Native audio-thread oscillator. Its owner, never its panel, controls lifetime. */
export class ControlLFO {
  readonly signal: ControlSignal;
  readonly frequency: ParamHandle;
  private readonly oscillator: OscillatorNode;
  private disposed = false;

  constructor(context: BaseAudioContext, options: ControlLFOOptions = {}) {
    const frequency = options.frequency ?? 1;
    if (!Number.isFinite(frequency) || frequency < 0 || frequency > context.sampleRate / 2) throw new RangeError('LFO frequency must be between zero and Nyquist.');
    const waveform = options.waveform ?? 'sine';
    validateWaveform(waveform);
    this.oscillator = context.createOscillator();
    this.oscillator.type = waveform;
    this.oscillator.frequency.value = frequency;
    this.frequency = new ParamHandle({id: 'frequency', label: 'Rate', unit: 'Hz', range: {min: 0, max: context.sampleRate / 2},
      displayRange: {min: 0, max: Math.min(20, context.sampleRate / 2)}, defaultValue: 1,
      updateTiming: 'scheduled', modulation: 'audio-rate'}, {baseValue: frequency});
    this.frequency.bindAudioParam(context, this.oscillator.frequency, {lazy: true});
    this.signal = Object.freeze({output: this.oscillator, rate: 'a-rate', range: Object.freeze({min: -1, max: 1})});
    try { this.oscillator.start(); } catch (error) { this.frequency.dispose(); this.oscillator.disconnect(); throw error; }
  }

  get waveform(): Exclude<OscillatorType, 'custom'> { return this.oscillator.type as Exclude<OscillatorType, 'custom'>; }

  setWaveform(waveform: Exclude<OscillatorType, 'custom'>): void {
    if (this.disposed) throw new Error('LFO is disposed.');
    validateWaveform(waveform);
    this.oscillator.type = waveform;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    let failure: unknown;
    try { this.frequency.dispose(); } catch (error) { failure = error; }
    try { this.oscillator.stop(); } catch (error) { failure ??= error; }
    try { this.oscillator.disconnect(); } catch (error) { failure ??= error; }
    if (failure) throw failure;
  }
}

function validateWaveform(waveform: string): void {
  if (!['sine', 'square', 'sawtooth', 'triangle'].includes(waveform)) throw new TypeError('Unsupported LFO waveform.');
}

export interface ControlEnvelopeOptions {
  readonly attack?: number;
  readonly decay?: number;
  readonly sustain?: number;
  readonly release?: number;
}

/** Global retriggerable ADSR control generator, independent of instrument voices. */
export class ControlEnvelope {
  readonly signal: ControlSignal;
  private readonly source: ConstantSourceNode;
  private readonly options: Required<ControlEnvelopeOptions>;
  private points: Array<{time: number; value: number; linear: boolean}> = [{time: 0, value: 0, linear: false}];
  private disposed = false;

  constructor(readonly context: BaseAudioContext, options: ControlEnvelopeOptions = {}) {
    this.options = {attack: options.attack ?? 0.01, decay: options.decay ?? 0.1, sustain: options.sustain ?? 0.7, release: options.release ?? 0.2};
    for (const [name, value] of Object.entries(this.options)) {
      if (!Number.isFinite(value) || value < 0 || (name === 'sustain' && value > 1)) throw new RangeError('Envelope times must be nonnegative and sustain must be in [0, 1].');
    }
    this.source = context.createConstantSource();
    this.source.offset.value = 0;
    this.signal = Object.freeze({output: this.source, rate: 'a-rate', range: Object.freeze({min: 0, max: 1})});
    try { this.source.start(); } catch (error) { this.source.disconnect(); throw error; }
  }

  trigger(time?: number, velocity = 1): void {
    const now = this.context.currentTime;
    time = time === undefined ? now : time;
    this.validateTime(time, now);
    if (!Number.isFinite(velocity) || velocity < 0 || velocity > 1) throw new RangeError('Envelope velocity must be in [0, 1].');
    const held = this.valueAt(time);
    const peak = time + this.options.attack;
    const sustain = peak + this.options.decay;
    this.replace(time, [
      {time, value: held, linear: false},
      {time: peak, value: velocity, linear: this.options.attack > 0},
      {time: sustain, value: velocity * this.options.sustain, linear: this.options.decay > 0},
    ], now);
  }

  release(time?: number): void {
    const now = this.context.currentTime;
    time = time === undefined ? now : time;
    this.validateTime(time, now);
    this.replace(time, [
      {time, value: this.valueAt(time), linear: false},
      {time: time + this.options.release, value: 0, linear: this.options.release > 0},
    ], now);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    try { this.source.stop(); } finally { this.source.disconnect(); }
  }

  private valueAt(time: number): number {
    let previous = this.points[0];
    for (let index = 1; index < this.points.length; index++) {
      const point = this.points[index];
      if (time < point.time) {
        return point.linear ? previous.value + (point.value - previous.value) * (time - previous.time) / (point.time - previous.time) : previous.value;
      }
      previous = point;
    }
    return previous.value;
  }

  private replace(time: number, points: typeof this.points, now: number): void {
    const prefix = this.points.filter(point => point.time < time);
    const anchors = [{...points[0], linear: false}];
    if (time > now) {
      const previous = prefix[prefix.length - 1];
      const next = this.points.find(point => point.time >= time);
      if (previous && next?.linear) {
        // A boundary can contain both a ramp endpoint and an instantaneous
        // step. Retain the incoming ramp's left limit before the new gate's
        // right-hand level, rather than ramping toward the post-step value.
        const incoming = previous.value + (next.value - previous.value) *
          (time - previous.time) / (next.time - previous.time);
        anchors[0] = {time, value: incoming, linear: true};
        if (incoming !== points[0].value) anchors.push({...points[0], linear: false});
      }
    }
    this.source.offset.cancelScheduledValues(time);
    const replacement = [...anchors, ...points.slice(1)];
    for (const point of replacement) {
      if (point.linear) this.source.offset.linearRampToValueAtTime(point.value, point.time);
      else this.source.offset.setValueAtTime(point.value, point.time);
    }
    const timeline = [...prefix, ...replacement];
    // Past commands are rejected, so only the last completed point can affect
    // another gate. Keep its original time as the next ramp's left anchor,
    // together with every future event, including earlier queued gates.
    let first = 0;
    while (first + 1 < timeline.length && timeline[first + 1].time <= now) first++;
    this.points = first > 0 ? timeline.slice(first) : timeline;
  }

  private validateTime(time: number, now: number): void {
    if (this.disposed) throw new Error('Envelope is disposed.');
    if (!Number.isFinite(time) || time < now) throw new RangeError('Envelope time must be a finite current or future context time.');
  }
}

export interface EnvelopeFollowerOptions {
  /** Low-pass corner in Hz. Larger values follow changes faster. */
  readonly smoothingHz?: number;
}

/** Audio-rate absolute-value envelope follower, normalized/clipped to [0, 1]. */
export class EnvelopeFollower {
  readonly input: GainNode;
  readonly signal: ControlSignal;
  private readonly rectifier: WaveShaperNode;
  private readonly smoother: IIRFilterNode;
  private readonly limiter: WaveShaperNode;
  private disposed = false;

  constructor(context: BaseAudioContext, options: EnvelopeFollowerOptions = {}) {
    const cutoff = options.smoothingHz ?? 20;
    if (!Number.isFinite(cutoff) || cutoff <= 0 || cutoff >= context.sampleRate / 2) throw new RangeError('Follower smoothing frequency must be positive and below Nyquist.');
    this.input = context.createGain();
    this.rectifier = context.createWaveShaper();
    const curve = new Float32Array(2049);
    for (let i = 0; i < curve.length; i++) curve[i] = Math.abs(i * 2 / (curve.length - 1) - 1);
    this.rectifier.curve = curve;
    const pole = Math.exp(-2 * Math.PI * cutoff / context.sampleRate);
    if (pole >= 1) throw new RangeError('Follower smoothing frequency is below native precision.');
    // One-pole IIR has unity DC gain and a monotone step response. A Biquad's
    // float coefficient precision can noticeably bias low-frequency envelopes.
    this.smoother = context.createIIRFilter([1 - pole], [1, -pole]);
    this.limiter = context.createWaveShaper();
    this.limiter.curve = new Float32Array([0, 0, 1]);
    try { this.input.connect(this.rectifier); this.rectifier.connect(this.smoother); this.smoother.connect(this.limiter); } catch (error) {
      for (const node of [this.input, this.rectifier, this.smoother, this.limiter]) {
        try { node.disconnect(); } catch { /* Candidate nodes only. */ }
      }
      throw error;
    }
    this.signal = Object.freeze({output: this.limiter, rate: 'a-rate', range: Object.freeze({min: 0, max: 1})});
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    let failure: unknown;
    for (const node of [this.input, this.rectifier, this.smoother, this.limiter]) {
      try { node.disconnect(); } catch (error) { failure ??= error; }
    }
    if (failure) throw failure;
  }
}
