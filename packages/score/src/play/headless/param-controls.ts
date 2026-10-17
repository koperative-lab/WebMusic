import {ControlLFO, ParamMacro, type ParamHandle, type ParamMapping, type ParamSurface} from '@webmusic/kernel/module';
import type {LfoControllerState, LfoShape} from './lfo';

export interface ParamLfoConfig {
  shape?: LfoShape;
  rate?: number;
  depth?: number;
  /** Maximum additive excursion in the target parameter's native units. */
  amount?: number;
  running?: boolean;
}

export interface ParamLfoState extends LfoControllerState {
  amount: number;
  readonly rateCapability: 'audio-rate';
}

function finiteRange(value: number, min: number, max: number, label: string): number {
  if (!Number.isFinite(value) || value < min || value > max) throw new RangeError(`${label} requires a finite value in ${min}…${max}.`);
  return value;
}

/**
 * A parameter-owned LFO. Views borrow it; target disposal releases its DSP.
 * The oscillator runs in audio time and never depends on animation frames.
 */
export class ParamLfoController {
  readonly target: ParamHandle;
  readonly context: BaseAudioContext;
  private state: ParamLfoState;
  private oscillator?: ControlLFO;
  private mapping?: ParamMapping;
  private readonly listeners = new Set<() => void>();
  private releaseTarget?: () => void;
  private disposed = false;
  private editing = false;
  get isDisposed(): boolean { return this.disposed; }

  constructor(target: ParamHandle, context: BaseAudioContext, config: ParamLfoConfig = {}) {
    if (target.snapshot.disposed) throw new Error('LFO target is disposed.');
    if (target.descriptor.modulation !== 'audio-rate') throw new Error('LFO requires an audio-rate parameter.');
    this.target = target;
    this.context = context;
    this.state = {shape: 'sine', rate: 1, depth: 0.6, amount: 1, running: false, phase: 0, rateCapability: 'audio-rate'};
    this.releaseTarget = target.subscribe((snapshot) => {
      if (snapshot.disposed) this.dispose();
      else if (!this.editing && this.state.running && !this.mapping?.active) {
        this.phase = this.snapshot().phase;
        this.state = {...this.state, running: false};
        this.stopAudio();
        this.notify();
      }
    });
    try { this.configure(config); } catch (error) { this.dispose(); throw error; }
  }

  private startedAt = 0;
  private phase = 0;
  snapshot(): ParamLfoState {
    return {...this.state, phase: this.state.running ? (this.phase + (this.context.currentTime - this.startedAt) * this.state.rate) % 1 : this.phase};
  }
  subscribe(notify: () => void): () => void {
    if (this.disposed) return () => {};
    this.listeners.add(notify);
    return () => { this.listeners.delete(notify); };
  }

  configure(config: ParamLfoConfig): void {
    if (this.disposed) throw new Error('LFO controller is disposed.');
    if (this.editing) throw new Error('LFO changes cannot re-enter.');
    const shape = config.shape ?? this.state.shape;
    if (!['sine', 'triangle', 'square', 'saw'].includes(shape)) throw new TypeError('Unsupported LFO shape.');
    const next = {...this.state, shape,
      rate: finiteRange(config.rate ?? this.state.rate, 0.05, 12, 'LFO rate'),
      depth: finiteRange(config.depth ?? this.state.depth, 0, 1, 'LFO depth'),
      amount: finiteRange(config.amount ?? this.state.amount, 0, Number.MAX_VALUE, 'LFO amount'),
      running: config.running ?? this.state.running,
    };
    const previous = this.state;
    // Allocate/validate before committing so failure leaves the current run intact.
    let oscillator = this.oscillator;
    let mapping: ParamMapping | undefined;
    const replace = next.running && (!oscillator || !this.mapping?.active);
    this.editing = true;
    try {
      if (next.running && !oscillator) oscillator = new ControlLFO(this.context, {frequency: next.rate, waveform: shape === 'saw' ? 'sawtooth' : shape});
      if (replace) mapping = this.target.connectModulation(oscillator!.signal, {depth: next.depth * next.amount});
      if (next.running) {
        oscillator!.frequency.setBaseValue(next.rate);
        oscillator!.setWaveform(shape === 'saw' ? 'sawtooth' : shape);
        if (!replace) this.mapping!.setDepth(next.depth * next.amount);
      }
      if (this.disposed || this.target.snapshot.disposed || (next.running && !(mapping ?? this.mapping)?.active)) {
        throw new Error('LFO target was released while configuring.');
      }
      if (replace) { this.mapping?.release(); this.mapping = mapping; }
      this.phase = previous.running ? this.snapshot().phase : 0;
      this.startedAt = this.context.currentTime;
      this.oscillator = oscillator;
      if (!next.running) this.stopAudio();
      this.state = next;
    } catch (error) {
      mapping?.release();
      if (oscillator !== this.oscillator) oscillator?.dispose();
      if (this.mapping && !this.mapping.active) {
        this.state = {...this.state, running: false};
        this.stopAudio();
        this.notify();
      }
      throw error;
    } finally { this.editing = false; }
    this.notify();
  }

  setRunning(running: boolean): void { this.configure({running}); }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.releaseTarget?.();
    this.releaseTarget = undefined;
    try { this.stopAudio(); } finally {
      this.state = {...this.state, running: false};
      this.notify();
      this.listeners.clear();
    }
  }

  private stopAudio(): void {
    const mapping = this.mapping;
    const oscillator = this.oscillator;
    this.mapping = undefined;
    this.oscillator = undefined;
    try { mapping?.release(); } finally { oscillator?.dispose(); }
  }
  private notify(): void {
    for (const listener of [...this.listeners]) { try { listener(); } catch { /* Views do not own the controller. */ } }
  }
}

const lfos = new WeakMap<ParamHandle, WeakMap<BaseAudioContext, ParamLfoController>>();
/** Obtain the shared LFO without allocating DSP until an explicit run command. */
export function getParamLfoController(target: ParamHandle, context: BaseAudioContext): ParamLfoController {
  let byContext = lfos.get(target);
  if (!byContext) { byContext = new WeakMap(); lfos.set(target, byContext); }
  let controller = byContext.get(context);
  if (!controller || controller.isDisposed) { controller = new ParamLfoController(target, context); byContext.set(context, controller); }
  return controller;
}

export interface ParameterMacroTarget {
  parameter: string;
  min: number;
  max: number;
}
export interface ParameterMacroConfig {
  id: string;
  label?: string;
  value?: number;
  targets: readonly ParameterMacroTarget[];
}
export interface ParameterMacroState {
  id: string;
  label: string;
  value: number;
  targets: readonly {parameter: string; label: string; value: number; unit?: string}[];
  disabled: boolean;
}

/** A shared normalized macro writes the same base handles as individual knobs. */
export class ParameterMacroController {
  readonly id: string;
  private readonly surface: ParamSurface;
  private config: ParameterMacroConfig;
  private macro: ParamMacro;
  private value = 0;
  private disposed = false;
  private releases: Array<() => void> = [];
  private readonly listeners = new Set<() => void>();

  constructor(surface: ParamSurface, config: ParameterMacroConfig) {
    if (!config.id.trim()) throw new TypeError('A parameter macro requires an id.');
    this.surface = surface;
    this.id = config.id;
    this.config = {...config, targets: config.targets.map((target) => ({...target}))};
    this.macro = this.createMacro(this.config);
    try {
    for (const item of config.targets) {
      const target = surface.get(item.parameter)!;
      this.releases.push(target.subscribe((snapshot) => { if (snapshot.disposed) this.dispose(); else this.notify(); }));
    }
    if (config.value !== undefined) this.setValue(config.value);
    } catch (error) { this.dispose(); throw error; }
  }

  private createMacro(config: ParameterMacroConfig): ParamMacro {
    return new ParamMacro(config.targets.map(({parameter, min, max}) => {
      const target = this.surface.get(parameter);
      if (!target || target.snapshot.disposed) throw new Error(`Macro parameter unavailable: ${parameter}`);
      return {target, min, max};
    }));
  }

  matches(config: ParameterMacroConfig): boolean {
    return (config.label ?? config.id) === (this.config.label ?? this.config.id) &&
      config.targets.length === this.config.targets.length && config.targets.every((target, index) => {
        const existing = this.config.targets[index];
        return target.parameter === existing.parameter && target.min === existing.min && target.max === existing.max;
      });
  }

  snapshot(): ParameterMacroState {
    return {id: this.id, label: this.config.label ?? this.id, value: this.value, disabled: this.disposed,
      targets: this.config.targets.map(({parameter}) => {
        const target = this.surface.get(parameter)!;
        return {parameter, label: target.descriptor.label ?? parameter, value: target.snapshot.baseValue,
          unit: target.descriptor.unit === 'native' ? undefined : target.descriptor.unit};
      })};
  }
  setValue(value: number): void {
    if (this.disposed) throw new Error('Parameter macro is disposed.');
    finiteRange(value, 0, 1, 'Macro value');
    this.macro.setValue(value);
    this.value = value;
    this.notify();
  }
  subscribe(notify: () => void): () => void {
    if (this.disposed) return () => {};
    this.listeners.add(notify);
    return () => { this.listeners.delete(notify); };
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const release of this.releases.splice(0)) release();
    this.macro.dispose();
    this.notify();
    this.listeners.clear();
  }
  private notify(): void {
    for (const listener of [...this.listeners]) { try { listener(); } catch { /* Observers cannot undo writes. */ } }
  }
}

const macros = new WeakMap<ParamSurface, Map<string, ParameterMacroController>>();
/** The first definition establishes a macro id. Later panels borrow its state. */
export function getParameterMacroController(surface: ParamSurface, config: ParameterMacroConfig): ParameterMacroController {
  let entries = macros.get(surface);
  if (!entries) { entries = new Map(); macros.set(surface, entries); }
  let controller = entries.get(config.id);
  if (!controller) { controller = new ParameterMacroController(surface, config); entries.set(config.id, controller); }
  else if (!controller.matches(config)) throw new Error(`Macro id already has a different mapping: ${config.id}`);
  return controller;
}
