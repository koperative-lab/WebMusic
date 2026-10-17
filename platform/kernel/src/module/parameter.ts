import {createConnectionLease, type ConnectionLease} from './lease';
import {ParamAudioBus, type ControlSignal, type ParamAutomationEvent, type ParamMapping, type ParamMappingOptions} from './param-audio';

/** Metadata for one numeric base value; modulation mappings are separate. */
export interface ParamDescriptor {
  readonly id: string;
  readonly label?: string;
  readonly unit: string;
  readonly range: Readonly<{min: number; max: number}>;
  /** Optional UI viewport within the legal range; it never restricts writes. */
  readonly displayRange?: Readonly<{min: number; max: number}>;
  readonly defaultValue: number;
  /** Suggested UI increment, not an implicit quantization command. */
  readonly step?: number;
  readonly scale?: 'linear' | 'logarithmic';
  readonly updateTiming?: 'synchronous' | 'scheduled';
  readonly modulation?: 'none' | 'audio-rate' | 'control-rate';
}

export interface ParamSnapshot {
  readonly baseValue: number;
  readonly revision: number;
  /** Advances only for committed base writes, not CV graph/automation notifications. */
  readonly baseRevision: number;
  readonly disposed: boolean;
  /** AudioParam.value is intrinsic state, not total effective readback. */
  readonly effectiveReadback: Readonly<{status: 'unavailable'}>;
  /** Predicted bounds from declared sources, never sampled effective state. */
  readonly modulationRange?: Readonly<{min: number; max: number}>;
  readonly automation?: readonly ParamAutomationEvent[];
}

export interface ParamHandleOptions {
  readonly baseValue?: number;
  /** Synchronous backend write. A thrown failure leaves the snapshot unchanged. */
  readonly apply?: (value: number) => void;
}

const nativeOwners = new WeakMap<AudioParam, ParamHandle>();

const unavailable = Object.freeze({status: 'unavailable' as const});

/** One authoritative numeric parameter, shared by any number of controls. */
export class ParamHandle {
  readonly descriptor: ParamDescriptor;
  private value: ParamSnapshot;
  private readonly apply?: (value: number) => void;
  private applying = false;
  private bus?: ParamAudioBus;
  private audioContext?: BaseAudioContext;
  private releasingAudio = false;
  private preparingAudio = false;
  private bindingAudio = false;
  private readonly audioTargets = new Set<{param: AudioParam; lease: ConnectionLease; binding?: ConnectionLease}>();
  private readonly listeners = new Set<{listener: (snapshot: ParamSnapshot) => void}>();

  constructor(descriptor: ParamDescriptor, options: ParamHandleOptions = {}) {
    const {min, max} = descriptor.range;
    if (!descriptor.id || !descriptor.unit || !Number.isFinite(min) || !Number.isFinite(max) || min > max) {
      throw new TypeError('A parameter requires an id, unit and finite ordered range.');
    }
    if (descriptor.step !== undefined && (!Number.isFinite(descriptor.step) || descriptor.step <= 0)) {
      throw new RangeError('Parameter step must be finite and positive.');
    }
    if (descriptor.scale === 'logarithmic' && min <= 0) {
      throw new RangeError('A logarithmic parameter requires a positive range.');
    }
    const displayRange = descriptor.displayRange;
    if (displayRange && (!Number.isFinite(displayRange.min) || !Number.isFinite(displayRange.max) ||
      displayRange.min > displayRange.max || displayRange.min < min || displayRange.max > max)) {
      throw new RangeError('Parameter displayRange must be a finite ordered subset of its legal range.');
    }
    this.descriptor = Object.freeze({
      ...descriptor, range: Object.freeze({min, max}),
      ...(displayRange && {displayRange: Object.freeze({...displayRange})}),
    });
    this.validate(descriptor.defaultValue);
    const baseValue = options.baseValue ?? descriptor.defaultValue;
    this.validate(baseValue);
    this.apply = options.apply;
    this.value = Object.freeze({baseValue, revision: 0, baseRevision: 0, disposed: false, effectiveReadback: unavailable});
  }

  get snapshot(): ParamSnapshot {
    if (!this.bus?.active) return this.value;
    return Object.freeze({...this.value, baseValue: this.bus.baseValueAt(this.bus.context.currentTime),
      modulationRange: this.bus.estimatedRange, automation: this.bus.automation});
  }

  /** Lazily prepares one context's full-value CV bus. */
  audio(context: BaseAudioContext): ParamAudioBus {
    this.assertAudio(context);
    if (this.bus?.active) return this.bus;
    const previousContext = this.audioContext;
    let bus: ParamAudioBus | undefined;
    this.preparingAudio = true;
    try {
      bus = new ParamAudioBus(context, this.value.baseValue,
        this.descriptor.modulation === 'control-rate' ? 'k-rate' : 'a-rate', () => this.audioChanged());
      if (this.value.disposed) throw new Error('Parameter was disposed while preparing audio.');
      this.bus = bus;
      this.audioContext = context;
      for (const target of this.audioTargets) target.binding = bus.bind(target.param);
      if (this.value.disposed || !bus.active) throw new Error('Parameter was disposed while preparing audio.');
      return bus;
    } catch (error) {
      this.bus = undefined;
      this.audioContext = this.value.disposed ? undefined : previousContext;
      try { bus?.dispose(); } catch { /* Preserve preparation failure. */ }
      throw error;
    } finally { this.preparingAudio = false; }
  }

  /** Borrow a native target; lazy bindings need no nodes until modulation starts. */
  bindAudioParam(context: BaseAudioContext, param: AudioParam, options: {lazy?: boolean} = {}): ConnectionLease {
    this.assertAudio(context);
    const owner = nativeOwners.get(param);
    if (owner && owner !== this) throw new Error('AudioParam already belongs to another parameter handle.');
    const rate = this.descriptor.modulation === 'control-rate' ? 'k-rate' : 'a-rate';
    if ('automationRate' in param && param.automationRate !== rate) throw new Error(`Parameter requires ${rate}; native AudioParam declares ${param.automationRate}.`);
    const target: {param: AudioParam; lease: ConnectionLease; binding?: ConnectionLease} = {
      param,
      lease: createConnectionLease(() => {
        this.audioTargets.delete(target);
        if (![...this.audioTargets].some(candidate => candidate.param === param) && nativeOwners.get(param) === this) nativeOwners.delete(param);
        target.binding?.release();
      }),
    };
    const bus = !options.lazy || this.bus?.active ? this.audio(context) : undefined;
    this.bindingAudio = true;
    try {
      if (bus) target.binding = bus.bind(param);
      else param.value = this.value.baseValue;
      if (this.value.disposed || (bus && !bus.active)) throw new Error('Parameter was disposed while binding audio.');
      this.audioContext = context;
      this.audioTargets.add(target);
      nativeOwners.set(param, this);
      return target.lease;
    } catch (error) {
      try { target.binding?.release(); } catch { /* Preserve binding failure. */ }
      throw error;
    } finally { this.bindingAudio = false; }
  }

  connectModulation(signal: ControlSignal, options: ParamMappingOptions): ParamMapping {
    return this.audio(signal.output.context).connect(signal, options);
  }

  /**
   * Replaces base automation using a clock captured before planning the events.
   * referenceTime is absolute AudioContext seconds and defaults to call entry;
   * it must be finite, nonnegative and no
   * later than context.currentTime. Events must be ordered at or after it.
   * Clock advance during submission evaluates elapsed ramps and retains their
   * future endpoints. An empty schedule holds the current modeled base.
   * Native clock crossings receive bounded repair; prolonged stalls can underrun.
   */
  scheduleAutomation(context: BaseAudioContext, events: readonly ParamAutomationEvent[], referenceTime = context.currentTime): void {
    if (this.descriptor.updateTiming !== 'scheduled') throw new Error('Parameter does not support scheduled automation.');
    this.assertAudio(context);
    if (!Number.isFinite(referenceTime) || referenceTime < 0 || referenceTime > context.currentTime) {
      throw new RangeError('Automation reference time must be finite, nonnegative and no later than the current audio time.');
    }
    let time = referenceTime;
    let value = this.bus?.baseValueAt(referenceTime) ?? this.value.baseValue;
    for (const event of events) {
      this.validate(event.value);
      if (!['set', 'linear', 'exponential'].includes(event.type)) throw new TypeError('Unknown automation event type.');
      if (!Number.isFinite(event.time) || event.time < time) throw new RangeError('Automation events require nondecreasing finite future times.');
      if (event.type === 'exponential' && (value <= 0 || event.value <= 0)) throw new RangeError('Exponential automation requires positive endpoints.');
      time = event.time; value = event.value;
    }
    this.audio(context).schedule(events, referenceTime);
  }

  /** Cancels the future trajectory and holds its current modeled base. */
  cancelAutomation(): void {
    if (this.value.disposed) throw new Error('Parameter is disposed.');
    if (!this.bus?.active || !this.bus.automation.length) return;
    this.setBaseValue(this.bus.baseValueAt(this.bus.context.currentTime));
  }

  /** Dispose only this context's CV graph, keeping the shared parameter reusable. */
  releaseAudio(context: BaseAudioContext): void {
    if (this.audioContext !== context || this.releasingAudio) return;
    this.releasingAudio = true;
    const bus = this.bus;
    const baseValue = bus?.baseValueAt(context.currentTime) ?? this.value.baseValue;
    this.bus = undefined;
    this.audioContext = undefined;
    this.value = Object.freeze({...this.value, baseValue});
    let failure: unknown;
    for (const target of [...this.audioTargets]) {
      try { target.lease.release(); } catch (error) { failure ??= error; }
    }
    try { bus?.dispose(); } catch (error) { failure ??= error; }
    this.releasingAudio = false;
    this.audioChanged();
    if (failure) throw failure;
  }

  setBaseValue(value: number): void {
    if (this.value.disposed) throw new Error('Parameter is disposed.');
    if (this.applying) throw new Error('Parameter updates cannot re-enter a backend write.');
    this.validate(value);
    if (value === this.value.baseValue && !this.bus?.automation.length) return;
    this.applying = true;
    try {
      const result: unknown = this.apply?.(value);
      if (result != null && typeof (result as {then?: unknown}).then === 'function') {
        // Consume a mistaken async rejection without accepting an async write.
        void Promise.resolve(result).catch(() => {});
        throw new TypeError('Parameter apply must be synchronous.');
      }
      if (this.value.disposed) throw new Error('Parameter was disposed during its backend write.');
      if (this.bus?.active) this.bus.setBaseValue(value);
      else for (const target of this.audioTargets) target.param.value = value;
      if (this.value.disposed) throw new Error('Parameter was disposed during its backend write.');
      this.value = Object.freeze({...this.value, baseValue: value, revision: this.value.revision + 1,
        baseRevision: this.value.baseRevision + 1});
    } finally {
      this.applying = false;
    }
    this.notify();
  }

  subscribe(listener: (snapshot: ParamSnapshot) => void): () => void {
    if (this.value.disposed) return () => {};
    const subscription = {listener};
    this.listeners.add(subscription);
    return () => { this.listeners.delete(subscription); };
  }

  dispose(): void {
    if (this.value.disposed) return;
    this.value = Object.freeze({...this.value, disposed: true, revision: this.value.revision + 1});
    try {
      if (this.audioContext) this.releaseAudio(this.audioContext);
    } finally {
      this.notify();
      this.listeners.clear();
    }
  }

  private assertAudio(context: BaseAudioContext): void {
    if (this.value.disposed) throw new Error('Parameter is disposed.');
    if (this.applying || this.releasingAudio || this.preparingAudio || this.bindingAudio) throw new Error('Parameter audio cannot re-enter a backend write, preparation, binding or release.');
    if (!this.descriptor.modulation || this.descriptor.modulation === 'none') throw new Error('Parameter does not support native modulation.');
    if (this.audioContext && this.audioContext !== context) throw new Error('Parameter is already attached to another AudioContext; release it explicitly first.');
  }

  private audioChanged(): void {
    if (this.value.disposed || this.releasingAudio) return;
    this.value = Object.freeze({...this.value, revision: this.value.revision + 1});
    this.notify();
  }

  private validate(value: number): void {
    if (!Number.isFinite(value) || value < this.descriptor.range.min || value > this.descriptor.range.max) {
      throw new RangeError(`Parameter ${this.descriptor.id} requires a finite value in its declared range.`);
    }
  }

  private notify(): void {
    const value = this.value;
    const snapshot = this.snapshot;
    for (const subscription of [...this.listeners]) {
      // A listener may synchronously commit a newer value. Never send the old
      // snapshot to remaining controls after they have received that update.
      if (value !== this.value) break;
      if (!this.listeners.has(subscription)) continue;
      try {
        const result: unknown = subscription.listener(snapshot);
        if (result != null && typeof (result as {then?: unknown}).then === 'function') {
          void Promise.resolve(result).catch(() => {});
        }
      } catch { /* An observer cannot undo a committed value. */ }
    }
  }
}

/** A borrowed enumeration; creating a surface never transfers handle ownership. */
export class ParamSurface implements Iterable<ParamHandle> {
  readonly handles: readonly ParamHandle[];
  private readonly byId = new Map<string, ParamHandle>();

  constructor(handles: Iterable<ParamHandle>) {
    const entries = [...handles];
    for (const handle of entries) {
      if (this.byId.has(handle.descriptor.id)) throw new Error(`Duplicate parameter id: ${handle.descriptor.id}`);
      this.byId.set(handle.descriptor.id, handle);
    }
    this.handles = Object.freeze(entries);
  }

  get(id: string): ParamHandle | undefined { return this.byId.get(id); }

  [Symbol.iterator](): Iterator<ParamHandle> { return this.handles[Symbol.iterator](); }
}
