import {createConnectionLease, type ConnectionLease} from './lease';

/** A normalized, domain-neutral control output. The range is its declared bound. */
export interface ControlSignal {
  readonly output: AudioNode;
  readonly rate: 'a-rate' | 'k-rate';
  readonly range: Readonly<{min: number; max: number}>;
}

/** Additive depth is expressed in the destination parameter's native unit. */
export interface ParamMappingOptions {
  readonly depth: number;
  /** Bipolar normalizes the source to [-1, 1]; unipolar to [0, 1]. */
  readonly polarity?: 'bipolar' | 'unipolar';
}

export interface ParamMapping extends ConnectionLease {
  readonly depth: number;
  readonly polarity: 'bipolar' | 'unipolar';
  setDepth(depth: number): void;
}

export interface ParamAutomationEvent {
  readonly type: 'set' | 'linear' | 'exponential';
  readonly value: number;
  /** Absolute seconds on this AudioContext's clock. */
  readonly time: number;
}

const targetBuses = new WeakMap<AudioParam, ParamAudioBus>();

function valueAt(events: readonly ParamAutomationEvent[], baseline: number, startTime: number, time: number): number {
  let previous = baseline, previousTime = startTime;
  for (const event of events) {
    if (time < event.time) {
      if (event.type === 'set' || time <= previousTime) return previous;
      const ratio = (time - previousTime) / (event.time - previousTime);
      return event.type === 'linear' ? previous + (event.value - previous) * ratio : previous * Math.pow(event.value / previous, ratio);
    }
    previous = event.value;
    previousTime = event.time;
  }
  return previous;
}

/** One full-value CV bus: base lives here and every target has intrinsic zero. */
export class ParamAudioBus {
  readonly context: BaseAudioContext;
  readonly rate: 'a-rate' | 'k-rate';
  private readonly source: ConstantSourceNode;
  private readonly bindings = new Map<AudioParam, {leases: Set<ConnectionLease>; compensation?: ConstantSourceNode}>();
  private readonly connections = new Set<ParamMapping>();
  private events: readonly ParamAutomationEvent[] = Object.freeze([]);
  private baseline: number;
  private startTime = 0;
  private disposed = false;
  private changing = false;

  constructor(context: BaseAudioContext, baseValue: number, rate: 'a-rate' | 'k-rate', private readonly changed: () => void = () => {}) {
    this.context = context;
    this.rate = rate;
    this.baseline = baseValue;
    this.source = context.createConstantSource();
    this.validateOffset(baseValue);
    this.source.offset.value = baseValue;
    if ('automationRate' in this.source.offset) this.source.offset.automationRate = rate;
    try { this.source.start(); } catch (error) { this.source.disconnect(); throw error; }
  }

  get active(): boolean { return !this.disposed; }
  get automation(): readonly ParamAutomationEvent[] { return this.events; }
  get mappings(): readonly ParamMapping[] { return Object.freeze([...this.connections]); }
  get estimatedRange(): Readonly<{min: number; max: number}> {
    let min = this.baseValueAt(this.context.currentTime), max = min;
    for (const mapping of this.connections) {
      const low = mapping.polarity === 'bipolar' ? -mapping.depth : 0;
      min += Math.min(low, mapping.depth);
      max += Math.max(low, mapping.depth);
    }
    return Object.freeze({min, max});
  }

  /** Exact model of this bus's scheduled base; not a sample of effective CV. */
  baseValueAt(time: number): number {
    return valueAt(this.events, this.baseline, this.startTime, time);
  }

  bind(param: AudioParam): ConnectionLease {
    this.assertLive();
    if (this.changing) throw new Error('CV bus changes cannot re-enter.');
    const existing = targetBuses.get(param);
    if (existing && existing !== this) throw new Error('AudioParam already belongs to another CV bus.');
    if ('automationRate' in param && param.automationRate !== this.rate) {
      throw new Error(`Parameter requires ${this.rate}; native AudioParam declares ${param.automationRate}.`);
    }
    let entry = this.bindings.get(param);
    if (!entry) {
      this.changing = true;
      const original = param.value;
      let compensation: ConstantSourceNode | undefined;
      try {
        // Let native Web Audio reject foreign-context AudioParams before touching
        // their intrinsic value. No context can be introspected from AudioParam.
        this.source.connect(param);
        if (this.disposed) throw new Error('CV bus disposed while binding.');
        param.cancelScheduledValues(this.context.currentTime);
        param.value = 0;
        // AudioParams such as compressor ratio clamp intrinsic zero to their
        // positive minimum. Subtract that intrinsic floor, preserving one base.
        if (param.value !== 0) {
          compensation = this.context.createConstantSource();
          compensation.offset.value = -param.value;
          compensation.connect(param);
          compensation.start();
        }
        if (this.disposed) throw new Error('CV bus disposed while binding.');
        entry = {leases: new Set(), compensation};
        this.bindings.set(param, entry);
        targetBuses.set(param, this);
      } catch (error) {
        if (compensation) {
          try { compensation.disconnect(); } catch { /* Candidate only. */ }
          try { compensation.stop(); } catch { /* May not have started. */ }
        }
        try { this.source.disconnect(param); } catch { /* Candidate edge only. */ }
        try { param.value = original; } catch { /* Preserve original failure. */ }
        throw error;
      } finally { this.changing = false; }
    }
    const owned = entry;
    const lease = createConnectionLease(() => {
      owned.leases.delete(lease);
      if (owned.leases.size || this.bindings.get(param) !== owned) return;
      this.bindings.delete(param);
      if (targetBuses.get(param) === this) targetBuses.delete(param);
      let failure: unknown;
      try { this.source.disconnect(param); } catch (error) { failure = error; }
      if (owned.compensation) {
        try { owned.compensation.disconnect(); } catch (error) { failure ??= error; }
        try { owned.compensation.stop(); } catch (error) { failure ??= error; }
      }
      try {
        // Leave a detached live voice at the current base, without copying CV.
        param.value = this.baseValueAt(this.context.currentTime);
      } catch (error) { failure ??= error; }
      if (failure) throw failure;
    });
    owned.leases.add(lease);
    return lease;
  }

  connect(signal: ControlSignal, options: ParamMappingOptions): ParamMapping {
    this.assertLive();
    if (this.changing) throw new Error('CV bus changes cannot re-enter.');
    const {min, max} = signal.range;
    if (!Number.isFinite(min) || !Number.isFinite(max) || min >= max) throw new RangeError('Control signal requires a finite nonempty range.');
    if (signal.output.context !== this.context) throw new Error('Control signal and parameter must share an AudioContext.');
    if (signal.rate !== 'a-rate' && signal.rate !== 'k-rate') throw new TypeError('Unknown control signal rate.');
    if (this.rate === 'a-rate' && signal.rate !== 'a-rate') throw new Error('An a-rate parameter requires an a-rate control signal.');
    if (!Number.isFinite(options.depth)) throw new RangeError('Modulation depth must be finite.');
    const polarity = options.polarity ?? 'bipolar';
    if (polarity !== 'bipolar' && polarity !== 'unipolar') throw new TypeError('Unknown modulation polarity.');
    let depth = options.depth;
    let scale: GainNode | undefined;
    let offset: ConstantSourceNode | undefined;
    const factor = polarity === 'bipolar' ? 2 : 1;
    const zero = polarity === 'bipolar' ? -(max + min) / (max - min) : -min / (max - min);
    this.changing = true;
    try {
      scale = this.context.createGain();
      offset = this.context.createConstantSource();
      this.assertLive();
      scale.gain.value = depth * factor / (max - min);
      offset.offset.value = depth * zero;
      signal.output.connect(scale);
      scale.connect(this.source.offset);
      offset.connect(this.source.offset);
      offset.start();
      if (this.disposed) throw new Error('CV bus disposed during modulation connection.');
    } catch (error) {
      if (scale) { try { signal.output.disconnect(scale); } catch { /* Own edge only. */ } }
      try { scale?.disconnect(); } catch { /* Candidate only. */ }
      try { offset?.disconnect(); } catch { /* Candidate only. */ }
      try { offset?.stop(); } catch { /* Candidate may not have started. */ }
      throw error;
    } finally { this.changing = false; }
    const scaleNode = scale;
    const offsetNode = offset;
    const lease = createConnectionLease(() => {
      this.connections.delete(mapping);
      try { signal.output.disconnect(scaleNode); } catch { /* Upstream may be disposed. */ }
      let failure: unknown;
      try { scaleNode.disconnect(); } catch (error) { failure = error; }
      try { offsetNode.disconnect(); } catch (error) { failure ??= error; }
      try { offsetNode.stop(); } catch (error) { failure ??= error; }
      this.changed();
      if (failure) throw failure;
    });
    const mapping: ParamMapping = Object.freeze({
      get active() { return lease.active; },
      get depth() { return depth; },
      polarity,
      setDepth: (value: number) => {
        this.assertLive();
        if (!lease.active) throw new Error('Modulation mapping is released.');
        if (!Number.isFinite(value)) throw new RangeError('Modulation depth must be finite.');
        if (this.changing) throw new Error('CV bus changes cannot re-enter.');
        this.changing = true;
        try {
          scaleNode.gain.value = value * factor / (max - min);
          offsetNode.offset.value = value * zero;
          this.assertLive();
          if (!lease.active) throw new Error('Modulation mapping was released during update.');
        } finally { this.changing = false; }
        depth = value;
        this.changed();
      },
      release: () => lease.release(),
    });
    this.connections.add(mapping);
    this.changed();
    return mapping;
  }

  setBaseValue(value: number): void {
    this.assertLive();
    this.validateOffset(value);
    this.source.offset.cancelScheduledValues(this.context.currentTime);
    this.source.offset.setValueAtTime(value, this.context.currentTime);
    this.baseline = value;
    this.startTime = this.context.currentTime;
    this.events = Object.freeze([]);
  }

  /**
   * Replaces base automation anchored at the modeled base at referenceTime.
   * referenceTime is absolute seconds on this bus's AudioContext clock.
   * Capture referenceTime before planning; it defaults to this call's audio time.
   * Events must be ordered at or after that finite, nonnegative, nonfuture time.
   * Elapsed portions are evaluated at submission, preserving future ramp endpoints.
   * An empty schedule holds the current base instead.
   * Native clock crossings receive bounded repair; prolonged stalls can underrun.
   */
  schedule(events: readonly ParamAutomationEvent[], referenceTime = this.context.currentTime): void {
    this.assertLive();
    if (!Number.isFinite(referenceTime) || referenceTime < 0 || referenceTime > this.context.currentTime) {
      throw new RangeError('Automation reference time must be finite, nonnegative and no later than the current audio time.');
    }
    const referenceBase = this.baseValueAt(referenceTime);
    let time = referenceTime, value = referenceBase;
    for (const event of events) {
      if (!['set', 'linear', 'exponential'].includes(event.type)) throw new TypeError('Unknown automation event type.');
      this.validateOffset(event.value);
      if (!Number.isFinite(event.time) || event.time < time) throw new RangeError('Automation events require finite values and nondecreasing future times.');
      if (event.type === 'exponential' && (value <= 0 || event.value <= 0)) throw new RangeError('Exponential automation requires positive endpoints.');
      time = event.time;
      value = event.value;
    }
    const planned = Object.freeze(events.map(event => Object.freeze({...event})));
    // Validation and lazy native allocation can cross a render quantum. Use one
    // planning anchor throughout, then trim elapsed work without shifting ramps.
    let now = this.context.currentTime, base = referenceBase;
    let candidate: readonly ParamAutomationEvent[] = planned;
    for (let attempt = 0; attempt < 3; attempt++) {
      base = planned.length ? (now > referenceTime ? valueAt(planned, referenceBase, referenceTime, now) : referenceBase) : this.baseValueAt(now);
      candidate = planned.length && now > referenceTime
        ? Object.freeze([Object.freeze({type: 'set' as const, value: base, time: now}), ...planned.filter(event => event.time > now)])
        : planned;
      this.source.offset.cancelScheduledValues(now);
      this.source.offset.setValueAtTime(base, now);
      for (const event of candidate) {
        if (event.type === 'set') this.source.offset.setValueAtTime(event.value, event.time);
        else if (event.type === 'linear') this.source.offset.linearRampToValueAtTime(event.value, event.time);
        else this.source.offset.exponentialRampToValueAtTime(event.value, event.time);
      }
      // Native methods clamp past times. Repair a render quantum crossed during
      // submission using the original plan, not the already-trimmed candidate.
      // Repeated stalls are an underrun; never spin indefinitely on the UI thread.
      const submittedAt = this.context.currentTime;
      if (submittedAt === now || attempt === 2) break;
      now = submittedAt;
    }
    this.baseline = base;
    this.startTime = now;
    this.events = candidate;
    this.changed();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    let failure: unknown;
    const attempt = (action: () => void) => { try { action(); } catch (error) { failure ??= error; } };
    for (const mapping of [...this.connections]) attempt(() => mapping.release());
    for (const entry of [...this.bindings.values()]) for (const lease of [...entry.leases]) attempt(() => lease.release());
    attempt(() => this.source.disconnect());
    attempt(() => this.source.stop());
    this.events = Object.freeze([]);
    if (failure) throw failure;
  }

  private validateOffset(value: number): void {
    const {minValue, maxValue} = this.source.offset;
    if (!Number.isFinite(value) || value < minValue || value > maxValue) throw new RangeError('CV base exceeds the native ConstantSource range.');
  }

  private assertLive(): void { if (this.disposed) throw new Error('CV bus is disposed.'); }
}
