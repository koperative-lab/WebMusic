import {createTickSource, type TickSourceOptions} from './tick';
import {createConnectionLease, type ConnectionLease} from './module/lease';
import {ParamHandle} from './module/parameter';
import type {ControlSignal, ParamAutomationEvent} from './module/param-audio';
import type {SessionScheduleSegment, SessionSchedulingBinding} from './session-scheduling';

export interface SessionAutomationPoint {
  readonly type: 'set' | 'linear' | 'exponential';
  readonly value: number;
  /** Position in the scheduling binding's named seconds axis. */
  readonly timeSeconds: number;
}

export interface SessionModulationOptions {
  /** Repeat follows wrapped positions; once follows the unwrapped shared axis. */
  readonly loop?: 'repeat' | 'once';
  /** Native work is submitted this far ahead; default 0.25 reference seconds. */
  readonly lookaheadSeconds?: number;
  readonly tick?: TickSourceOptions;
  readonly onError?: (error: unknown) => void;
}

export interface SessionAutomationOptions extends SessionModulationOptions {
  /** Baseline at axis zero before the first point; defaults to the parameter base at attachment. */
  readonly initialValue?: number;
  /** Called synchronously once after ownership ends and cleanup completes, including manual overrides. Observer failures are contained. */
  readonly onRelease?: () => void;
}

export interface SessionAutomationLease extends ConnectionLease { readonly error: unknown; readonly initialValue: number; }
const automationOwners = new WeakMap<ParamHandle, SessionAutomationLease>();

/** Own a relative automation track; bindings/parameters/context remain borrowed. */
export function attachSessionAutomation(binding: SessionSchedulingBinding, context: BaseAudioContext,
  parameter: ParamHandle, points: readonly SessionAutomationPoint[], options: SessionAutomationOptions = {}): SessionAutomationLease {
  const lookahead = validateOptions(options);
  if (parameter.snapshot.disposed) throw new Error('Automation parameter is disposed.');
  if (parameter.descriptor.updateTiming !== 'scheduled' || !parameter.descriptor.modulation || parameter.descriptor.modulation === 'none') {
    throw new Error('Session automation requires a native scheduled parameter.');
  }
  if (automationOwners.get(parameter)?.active) throw new Error('Parameter already has a Session automation owner.');
  const baseline = options.initialValue ?? parameter.snapshot.baseValue;
  if (!Number.isFinite(baseline) || baseline < parameter.descriptor.range.min || baseline > parameter.descriptor.range.max) throw new RangeError('Automation initialValue must fit the target legal range.');
  const trajectory = validatePoints(points, baseline, parameter.descriptor.range);
  const ticker = createTickSource(options.tick);
  let unbind = () => {}, unwatch = () => {};
  let lastTime = NaN, error: unknown;
  let ownedBaseRevision: number | undefined;
  let attaching = true, releaseNotified = false;
  let baseRevision = parameter.snapshot.baseRevision;
  const writeBase = (write: () => void) => {
    const previous = ownedBaseRevision;
    // Only this exact committed write belongs to the scheduler. A subscriber's
    // nested write gets a later revision and must take ownership immediately.
    ownedBaseRevision = parameter.snapshot.baseRevision + 1;
    try { write(); } finally { ownedBaseRevision = previous; }
  };
  const notifyRelease = () => {
    if (attaching || releaseNotified || lease.active) return;
    releaseNotified = true;
    try {
      const result: unknown = options.onRelease?.();
      if (result && typeof (result as PromiseLike<unknown>).then === 'function') void Promise.resolve(result).catch(() => {});
    } catch { /* Ownership observers cannot undo release. */ }
  };
  const lease = createConnectionLease(() => {
    try {
      let failure: unknown;
      const attempt = (action: () => void) => { try { action(); } catch (error) { failure ??= error; } };
      attempt(unbind); attempt(unwatch); attempt(() => ticker.dispose());
      if (automationOwners.get(parameter) === result) {
        automationOwners.delete(parameter);
        if (!parameter.snapshot.disposed) attempt(() => writeBase(() => parameter.cancelAutomation()));
      }
      if (failure !== undefined) throw failure;
    } finally { notifyRelease(); }
  });
  const result: SessionAutomationLease = Object.freeze({get active() { return lease.active; }, get error() { return error; }, initialValue: baseline, release: () => lease.release()});
  const cancel = () => {
    ticker.stop(); lastTime = NaN;
    if (!parameter.snapshot.disposed) writeBase(() => parameter.cancelAutomation());
  };
  const fill = () => {
    if (!lease.active || binding.snapshot.phase !== 'ready' || binding.snapshot.paused) return;
    const now = context.currentTime;
    if (now === lastTime) return;
    const windows = windowsFor(binding, now, Math.max(now, binding.snapshot.originTime) + lookahead, options.loop);
    const events = planAutomation(windows, trajectory, baseline);
    if (!events.length) return;
    parameter.scheduleAutomation(context, events, now);
    lastTime = now;
  };
  const tick = () => {
    try { fill(); } catch (failure) {
      error = failure;
      try { lease.release(); } finally { try { options.onError?.(failure); } catch { /* Error observers own no resources. */ } }
    }
  };
  automationOwners.set(parameter, result);
  try {
    unwatch = parameter.subscribe(snapshot => {
      const baseChanged = snapshot.baseRevision !== baseRevision;
      baseRevision = snapshot.baseRevision;
      if (snapshot.disposed) lease.release();
      // A manual base write explicitly overrides the track; it must not be
      // silently overwritten by the next scheduler tick.
      else if (baseChanged && snapshot.baseRevision !== ownedBaseRevision) lease.release();
    });
    unbind = binding.subscribe(event => {
      if (!lease.active) return;
      if (event.type === 'dispose') { lease.release(); return; }
      if (event.type === 'invalidate') { cancel(); return; }
      if (event.snapshot.paused) {
        cancel();
        if (!lease.active) return;
        const position = options.loop === 'once' ? binding.clock.positionAt(context.currentTime) : binding.positionAt(context.currentTime);
        writeBase(() => parameter.setBaseValue(valueAt(trajectory, baseline, position)));
        return;
      }
      lastTime = NaN;
      fill();
      // Scheduling notifies parameter observers synchronously. They may pause,
      // stop or replace this anchor before its initial fill returns.
      const current = binding.snapshot;
      if (lease.active && current.epoch === event.snapshot.epoch && current.phase === 'ready' && !current.paused) ticker.start(tick);
    });
    // subscribe delivers its first anchor synchronously. If that callback lost
    // ownership, retire the subscription that became available only on return.
    if (!lease.active) unbind();
  } catch (failure) { error = failure; lease.release(); throw failure; }
  finally { attaching = false; notifyRelease(); }
  return result;
}

export interface SessionLFOOptions extends SessionModulationOptions {
  /** Cycles per binding-axis second, scaled by Session playback rate. */
  readonly frequency?: number;
  readonly waveform?: 'sine' | 'square' | 'triangle' | 'sawtooth';
  /** Initial phase in cycles, [0, 1]. */
  readonly phase?: number;
}

/** Native waveform segments whose phase is derived from the shared Session axis. */
export class SessionLFO {
  readonly signal: ControlSignal;
  readonly frequency: ParamHandle;
  readonly phase: ParamHandle;
  private readonly output: GainNode;
  private readonly ticker;
  private readonly sources = new Map<AudioBufferSourceNode, number>();
  private readonly lookahead: number;
  private buffer: AudioBuffer;
  private shape: NonNullable<SessionLFOOptions['waveform']>;
  private cycles: number;
  private phaseOffset: number;
  private scheduledUntil = -Infinity;
  private stopped = false;
  private unbind = () => {};
  private failure: unknown;

  constructor(private readonly context: BaseAudioContext, private readonly binding: SessionSchedulingBinding, private readonly options: SessionLFOOptions = {}) {
    this.lookahead = validateOptions(options);
    this.shape = options.waveform ?? 'sine';
    validateWaveform(this.shape);
    this.cycles = options.frequency ?? 1;
    this.phaseOffset = options.phase ?? 0;
    if (!Number.isFinite(this.cycles) || this.cycles < 0.001 || this.cycles > 1000) throw new RangeError('Session LFO frequency must be in [0.001, 1000] cycles per axis second.');
    if (!Number.isFinite(this.phaseOffset) || this.phaseOffset < 0 || this.phaseOffset > 1) throw new RangeError('Session LFO phase must be in [0, 1] cycles.');
    this.output = context.createGain();
    this.signal = Object.freeze({output: this.output, rate: 'a-rate', range: Object.freeze({min: -1, max: 1})});
    this.buffer = this.makeBuffer();
    this.ticker = createTickSource(options.tick);
    this.frequency = new ParamHandle({id: 'frequency', label: 'Rate', unit: 'cycles/axis-second', range: {min: 0.001, max: 1000}, displayRange: {min: 0.001, max: 20}, defaultValue: 1,
      updateTiming: 'synchronous', modulation: 'none'}, {baseValue: this.cycles, apply: value => { this.cycles = value; this.rearm(); }});
    this.phase = new ParamHandle({id: 'phase', label: 'Phase', unit: 'cycles', range: {min: 0, max: 1}, defaultValue: 0,
      updateTiming: 'synchronous', modulation: 'none'}, {baseValue: this.phaseOffset, apply: value => { this.phaseOffset = value; this.rearm(); }});
    try {
      this.unbind = binding.subscribe(event => {
        if (event.type === 'dispose') { this.dispose(); return; }
        if (event.type === 'invalidate' || event.snapshot.paused) this.cancel();
        else this.rearm();
      });
    } catch (error) { this.dispose(); throw error; }
  }

  get waveform(): NonNullable<SessionLFOOptions['waveform']> { return this.shape; }
  get error(): unknown { return this.failure; }

  setWaveform(waveform: NonNullable<SessionLFOOptions['waveform']>): void {
    if (this.stopped) throw new Error('Session LFO is disposed.');
    validateWaveform(waveform);
    this.shape = waveform;
    this.buffer = this.makeBuffer();
    this.rearm();
  }

  dispose(): void {
    if (this.stopped) return;
    this.stopped = true;
    let failure: unknown;
    for (const action of [() => this.unbind(), () => this.cancel(), () => this.ticker.dispose(),
      () => this.frequency.dispose(), () => this.phase.dispose(), () => this.output.disconnect()]) {
      try { action(); } catch (error) { failure ??= error; }
    }
    if (failure) throw failure;
  }

  private rearm(): void {
    if (this.stopped) return;
    this.cancel();
    if (this.binding.snapshot.phase !== 'ready' || this.binding.snapshot.paused) return;
    this.fill();
    this.ticker.start(() => {
      try { this.fill(); } catch (error) {
        this.failure = error;
        try { this.dispose(); } finally { try { this.options.onError?.(error); } catch { /* Observer only. */ } }
      }
    });
  }

  private cancel(): void {
    this.ticker.stop();
    this.scheduledUntil = -Infinity;
    let failure: unknown;
    for (const source of this.sources.keys()) {
      source.onended = null;
      try { source.stop(); } catch (error) { failure ??= error; }
      try { source.disconnect(); } catch (error) { failure ??= error; }
    }
    this.sources.clear();
    if (failure) throw failure;
  }

  private fill(): void {
    if (this.stopped || this.binding.snapshot.phase !== 'ready' || this.binding.snapshot.paused) return;
    const now = this.context.currentTime;
    for (const [source, end] of this.sources) if (end <= now) { source.onended = null; source.disconnect(); this.sources.delete(source); }
    if (this.scheduledUntil > now + this.lookahead / 2) return;
    const from = Math.max(now, this.scheduledUntil);
    const to = Math.max(now, this.binding.snapshot.originTime) + this.lookahead;
    const segments = windowsFor(this.binding, from, to, this.options.loop);
    const epoch = this.binding.epoch;
    for (const segment of segments) {
      if (this.stopped || epoch !== this.binding.epoch) return;
      const source = this.context.createBufferSource();
      source.buffer = this.buffer;
      source.loop = true;
      source.loopStart = 0; source.loopEnd = this.buffer.duration;
      source.playbackRate.value = this.cycles * segment.rate * this.buffer.duration;
      const phase = modulo(segment.positionStart * this.cycles + this.phaseOffset);
      try {
        source.connect(this.output);
        source.start(segment.referenceStart, phase * this.buffer.duration);
        source.stop(segment.referenceEnd);
        if (this.stopped || epoch !== this.binding.epoch) { source.stop(); source.disconnect(); return; }
        this.sources.set(source, segment.referenceEnd);
        source.onended = () => { this.sources.delete(source); source.disconnect(); };
      } catch (error) {
        try { source.stop(); } catch { /* Candidate may not have started. */ }
        source.disconnect();
        throw error;
      }
    }
    if (segments.length) this.scheduledUntil = segments[segments.length - 1].referenceEnd;
  }

  private makeBuffer(): AudioBuffer {
    const buffer = this.context.createBuffer(1, 4096, this.context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let index = 0; index < data.length; index++) {
      const phase = index / data.length;
      data[index] = this.shape === 'sine' ? Math.sin(2 * Math.PI * phase)
        : this.shape === 'square' ? (phase < 0.5 ? 1 : -1)
          : this.shape === 'sawtooth' ? 2 * phase - 1 : 1 - 4 * Math.abs(phase - 0.5);
    }
    return buffer;
  }
}

function windowsFor(binding: SessionSchedulingBinding, from: number, to: number, loop: SessionModulationOptions['loop']): readonly SessionScheduleSegment[] {
  if (loop !== 'once') return binding.segments(from, to);
  const state = binding.snapshot;
  const start = Math.max(from, state.holding ? state.originTime : from);
  if (state.phase !== 'ready' || state.paused || start >= to) return [];
  return [{epoch: state.epoch, iteration: 0, referenceStart: start, referenceEnd: to,
    positionStart: binding.clock.positionAt(start), positionEnd: binding.clock.positionAt(to), rate: state.rate}];
}

function validateOptions(options: SessionModulationOptions): number {
  const lookahead = options.lookaheadSeconds ?? 0.25;
  if (!Number.isFinite(lookahead) || lookahead <= 0 || lookahead > 60) throw new RangeError('Lookahead must be in (0, 60] reference seconds.');
  if (options.loop !== undefined && options.loop !== 'repeat' && options.loop !== 'once') throw new TypeError('Unknown Session modulation loop policy.');
  return lookahead;
}

function validatePoints(points: readonly SessionAutomationPoint[], baseline: number, range: {min: number; max: number}): readonly SessionAutomationPoint[] {
  if (!points.length) throw new RangeError('Session automation requires at least one point.');
  let time = 0, previous = baseline;
  return Object.freeze(points.map(point => {
    if (!['set', 'linear', 'exponential'].includes(point.type)) throw new TypeError('Unknown automation event type.');
    if (!Number.isFinite(point.timeSeconds) || point.timeSeconds < time || !Number.isFinite(point.value) || point.value < range.min || point.value > range.max) throw new RangeError('Automation points require ordered nonnegative positions and values within the target range.');
    if (point.type === 'exponential' && (point.value <= 0 || previous <= 0)) throw new RangeError('Exponential automation requires positive endpoints.');
    time = point.timeSeconds; previous = point.value;
    return Object.freeze({...point});
  }));
}

function planAutomation(windows: readonly SessionScheduleSegment[], points: readonly SessionAutomationPoint[], baseline: number): ParamAutomationEvent[] {
  const result: ParamAutomationEvent[] = [];
  for (const window of windows) {
    result.push({type: 'set', value: valueAt(points, baseline, window.positionStart), time: window.referenceStart});
    for (const point of points) {
      if (point.timeSeconds <= window.positionStart || point.timeSeconds > window.positionEnd) continue;
      result.push({type: point.type, value: point.value, time: Math.min(window.referenceEnd, window.referenceStart + (point.timeSeconds - window.positionStart) / window.rate)});
    }
    const next = points.find(point => point.timeSeconds > window.positionEnd);
    if (next && next.type !== 'set') result.push({type: next.type, value: valueAt(points, baseline, window.positionEnd), time: window.referenceEnd});
  }
  return result;
}

function valueAt(points: readonly SessionAutomationPoint[], baseline: number, position: number): number {
  let time = 0, value = baseline;
  for (const point of points) {
    if (position < point.timeSeconds) {
      if (point.type === 'set' || position <= time) return value;
      const ratio = (position - time) / (point.timeSeconds - time);
      return point.type === 'linear' ? value + (point.value - value) * ratio : value * Math.pow(point.value / value, ratio);
    }
    value = point.value; time = point.timeSeconds;
  }
  return value;
}

function validateWaveform(waveform: string): void {
  if (!['sine', 'square', 'triangle', 'sawtooth'].includes(waveform)) throw new TypeError('Unsupported Session LFO waveform.');
}
function modulo(value: number): number { return ((value % 1) + 1) % 1; }
