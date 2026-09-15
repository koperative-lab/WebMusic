import {
  mountEnvelope,
  type EnvelopeBinding,
  type EnvelopeOptions,
  type EnvelopeRanges,
  type EnvelopeState,
} from '@webmusic/ui/envelope';
import {
  mountEq,
  type EqBandState,
  type EqBinding,
  type EqOptions,
  type EqResponsePoint,
} from '@webmusic/ui/eq';
import {
  mountLfo,
  type LfoBinding,
  type LfoOptions,
  type LfoState,
} from '@webmusic/ui/lfo';
import {
  mountMacroRack,
  type MacroBinding,
  type MacroRackOptions,
  type MacroState,
  type MacroTargetState,
} from '@webmusic/ui/macro';
import {
  mountSectionPanel,
  type SectionPanelOptions,
} from '@webmusic/ui/panel';
import {
  mountParameterRack,
  type ParameterRackBinding,
  type ParameterRackItem,
  type ParameterRackOptions,
  type ParameterRackState,
} from '@webmusic/ui/parameter';
import type {
  UiPresenterDemoHandle,
  UiPresenterDemoMountResult,
} from './types';

interface DemoNotifier {
  notify(): void;
  subscribe(notify: () => void): () => void;
  clear(): void;
}

interface DestroyablePresenter {
  destroy(): void;
}

function createNotifier(): DemoNotifier {
  const listeners = new Set<() => void>();
  return {
    notify(): void {
      for (const listener of [...listeners]) listener();
    },
    subscribe(notify: () => void): () => void {
      listeners.add(notify);
      return () => listeners.delete(notify);
    },
    clear(): void {
      listeners.clear();
    },
  };
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function reportToDataset(host: HTMLElement, error: unknown): void {
  host.dataset.presenterDemoError = error instanceof Error ? error.message : String(error);
}

type ParameterPreset = 'standard' | 'single' | 'empty';

function parameterItems(preset: ParameterPreset): ParameterRackItem[] {
  if (preset === 'empty') return [];
  if (preset === 'single') {
    return [{id: 'amount', label: 'Amount', value: 0.64, min: 0, max: 1, step: 0.01}];
  }
  return [
    {
      id: 'cutoff',
      label: 'Cutoff',
      value: 2400,
      min: 30,
      max: 18000,
      step: 10,
      unit: 'Hz',
      group: 'Filter',
    },
    {
      id: 'resonance',
      label: 'Resonance',
      value: 0.38,
      min: 0,
      max: 1,
      step: 0.01,
      group: 'Filter',
    },
    {
      id: 'drive',
      label: 'Drive',
      value: 4.5,
      min: 0,
      max: 18,
      step: 0.1,
      unit: 'dB',
      group: 'Output',
    },
    {
      id: 'character',
      label: 'Character',
      value: 1,
      min: 0,
      max: 2,
      options: ['Clean', 'Warm', 'Bright'],
      group: 'Output',
    },
  ];
}

function parameterOptions(
  host: HTMLElement,
  values: Readonly<Record<string, unknown>>,
): ParameterRackOptions {
  const options: ParameterRackOptions = {};
  if (values.layout === 'flat' || values.layout === 'grouped') options.layout = values.layout;
  if (typeof values.emptyLabel === 'string') options.emptyLabel = values.emptyLabel;
  if (values.formatValue === 'compact') {
    options.formatValue = (parameter, value) => {
      if (parameter.options?.length) return parameter.options[Math.round(value)] ?? String(value);
      if (parameter.unit?.trim() === 'Hz' && value >= 1000) return `${(value / 1000).toFixed(1)} kHz`;
      return `${Number(value.toFixed(2))}${parameter.unit ?? ''}`;
    };
  }
  if (values.classNames === 'demo') {
    options.classNames = {
      root: 'demo-transport',
      group: 'demo-parameter-group',
      groupLabel: 'demo-parameter-group-label',
      items: 'demo-parameter-items',
      item: 'demo-parameter-item',
      label: 'demo-parameter-label',
      control: 'demo-parameter-control',
      track: 'demo-parameter-track',
      fill: 'demo-parameter-fill',
      pointer: 'demo-parameter-pointer',
      input: 'demo-parameter-input',
      value: 'demo-parameter-value',
      empty: 'demo-parameter-empty',
    };
  }
  if (values.parts === 'demo') {
    options.parts = {
      root: 'demo-root',
      group: 'demo-group',
      groupLabel: 'demo-group-label',
      items: 'demo-items',
      item: 'demo-item',
      label: 'demo-label',
      control: 'demo-control',
      track: 'demo-track',
      fill: 'demo-fill',
      pointer: 'demo-pointer',
      input: 'demo-input',
      value: 'demo-value',
      empty: 'demo-empty',
    };
  }
  if (values.onError === 'report') options.onError = (error) => reportToDataset(host, error);
  return options;
}

function mountParameterDemo(host: HTMLElement): UiPresenterDemoHandle {
  const notifier = createNotifier();
  let preset: ParameterPreset = 'standard';
  let state: ParameterRackState = {parameters: parameterItems(preset), disabled: false};
  let optionValues: Record<string, unknown> = {};
  let presenter: DestroyablePresenter | undefined;
  let destroyed = false;

  const binding: ParameterRackBinding = {
    snapshot: () => state,
    setValue(id, value) {
      state = {
        ...state,
        parameters: state.parameters.map((parameter) =>
          parameter.id === id ? {...parameter, value} : parameter,
        ),
      };
      notifier.notify();
    },
    subscribe: notifier.subscribe,
  };
  const remount = (): void => {
    presenter?.destroy();
    presenter = mountParameterRack(host, binding, parameterOptions(host, optionValues));
  };
  remount();

  return {
    setState(name, value) {
      if (destroyed) return;
      if (name === 'parameters' && (value === 'standard' || value === 'single' || value === 'empty')) {
        preset = value;
        state = {...state, parameters: parameterItems(preset)};
      } else if (name === 'disabled') {
        const next = {...state};
        if (value === undefined) delete next.disabled;
        else next.disabled = value === true;
        state = next;
      } else return;
      notifier.notify();
    },
    setOption(name, value) {
      if (destroyed) return;
      if (value === undefined) delete optionValues[name];
      else optionValues[name] = value;
      remount();
    },
    reset() {
      if (destroyed) return;
      preset = 'standard';
      state = {parameters: parameterItems(preset), disabled: false};
      optionValues = {};
      remount();
      notifier.notify();
    },
    snapshot: () => ({parameters: preset, disabled: state.disabled}),
    subscribe: notifier.subscribe,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      presenter?.destroy();
      presenter = undefined;
      notifier.clear();
      delete host.dataset.presenterDemoError;
    },
  };
}

type MacroTargetPreset = 'assigned' | 'alternate' | 'empty';

function macroTargets(preset: MacroTargetPreset, value: number): MacroTargetState[] {
  if (preset === 'empty') return [];
  if (preset === 'alternate') {
    return [
      {label: 'Delay', value: value * 70, unit: '%'},
      {label: 'Width', value: 50 + value * 50, unit: '%'},
    ];
  }
  return [
    {label: 'Cutoff', value: 180 + value * 7200, unit: ' Hz'},
    {label: 'Resonance', value: value * 100, unit: '%'},
    {label: 'Drive', value: value * 12, unit: ' dB'},
  ];
}

function macroOptions(
  host: HTMLElement,
  values: Readonly<Record<string, unknown>>,
): MacroRackOptions {
  const options: MacroRackOptions = {};
  if (values.classNames === 'demo') {
    options.classNames = {root: 'demo-macro-rack', item: 'demo-macro-item'};
  }
  if (values.parts === 'demo') {
    options.parts = {root: 'demo-root', item: 'demo-item'};
  }
  if (values.onError === 'report') {
    options.onError = (error) => reportToDataset(host, error);
  }
  return options;
}

function mountMacroDemo(host: HTMLElement): UiPresenterDemoHandle {
  const notifier = createNotifier();
  let targetPreset: MacroTargetPreset = 'assigned';
  let state: MacroState = {
    label: 'MORPH',
    value: 0.38,
    targets: macroTargets(targetPreset, 0.38),
    disabled: false,
  };
  let secondaryState: MacroState = {
    label: 'SPACE',
    value: 0.56,
    targets: macroTargets('alternate', 0.56),
    disabled: false,
  };
  let optionValues: Record<string, unknown> = {};
  let presenter: DestroyablePresenter | undefined;
  let destroyed = false;

  const setValue = (value: number): void => {
    const normalized = clamp(value, 0, 1);
    state = {...state, value: normalized, targets: macroTargets(targetPreset, normalized)};
    notifier.notify();
  };
  const binding: MacroBinding = {
    snapshot: () => state,
    setValue,
    subscribe: notifier.subscribe,
  };
  const secondaryBinding: MacroBinding = {
    snapshot: () => secondaryState,
    setValue(value) {
      const normalized = clamp(value, 0, 1);
      secondaryState = {
        ...secondaryState,
        value: normalized,
        targets: macroTargets('alternate', normalized),
      };
      notifier.notify();
    },
    subscribe: notifier.subscribe,
  };
  const remount = (): void => {
    presenter?.destroy();
    presenter = mountMacroRack(
      host,
      [binding, secondaryBinding],
      macroOptions(host, optionValues),
    );
  };
  remount();

  return {
    setState(name, value) {
      if (destroyed) return;
      if (name === 'label') state = {...state, label: String(value ?? '')};
      else if (name === 'value') {
        setValue(Number(value) || 0);
        return;
      }
      else if (name === 'targets' && (value === 'assigned' || value === 'alternate' || value === 'empty')) {
        targetPreset = value;
        state = {...state, targets: macroTargets(targetPreset, state.value)};
      } else if (name === 'disabled') {
        const next = {...state};
        if (value === undefined) delete next.disabled;
        else next.disabled = value === true;
        state = next;
      } else return;
      notifier.notify();
    },
    setOption(name, value) {
      if (destroyed) return;
      if (value === undefined) delete optionValues[name];
      else optionValues[name] = value;
      remount();
    },
    reset() {
      if (destroyed) return;
      targetPreset = 'assigned';
      state = {
        label: 'MORPH',
        value: 0.38,
        targets: macroTargets(targetPreset, 0.38),
        disabled: false,
      };
      secondaryState = {
        label: 'SPACE',
        value: 0.56,
        targets: macroTargets('alternate', 0.56),
        disabled: false,
      };
      optionValues = {};
      remount();
      notifier.notify();
    },
    snapshot: () => ({
      label: state.label,
      value: state.value,
      targets: targetPreset,
      disabled: state.disabled,
    }),
    subscribe: notifier.subscribe,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      presenter?.destroy();
      presenter = undefined;
      notifier.clear();
      delete host.dataset.presenterDemoError;
    },
  };
}

function panelOptions(values: Readonly<Record<string, unknown>>): SectionPanelOptions {
  const options: SectionPanelOptions = {};
  if (typeof values.label === 'string') options.label = values.label;
  if (values.classNames === 'demo') {
    options.classNames = {
      root: 'demo-transport',
      section: 'demo-panel-section',
      slot: 'demo-panel-slot',
    };
  }
  if (values.parts === 'demo') {
    options.parts = {root: 'demo-root', section: 'demo-section', slot: 'demo-slot'};
  }
  if (values.styleText === 'demo') {
    options.styleText = '.wui-section-panel__section { border-left: 3px solid currentColor; padding-left: .55rem; }';
  }
  return options;
}

function mountPanelDemo(host: HTMLElement): UiPresenterDemoHandle {
  let optionValues: Record<string, unknown> = {};
  let panel: ReturnType<typeof mountSectionPanel> | undefined;
  const children: UiPresenterDemoHandle[] = [];
  let destroyed = false;

  const unmount = (): void => {
    for (const child of children.splice(0).reverse()) child.destroy();
    panel?.destroy();
    panel = undefined;
  };
  const remount = (): void => {
    unmount();
    panel = mountSectionPanel(
      host,
      [
        {id: 'voice', label: 'Voice parameters'},
        {id: 'envelope', label: 'Amplitude envelope'},
        {id: 'motion', label: 'Filter modulation'},
      ],
      panelOptions(optionValues),
    );
    const voice = panel.slot('voice');
    const envelope = panel.slot('envelope');
    const motion = panel.slot('motion');
    if (!voice || !envelope || !motion) {
      unmount();
      throw new Error('The demo panel did not create every requested slot');
    }
    try {
      children.push(mountParameterDemo(voice), mountEnvelopeDemo(envelope), mountLfoDemo(motion));
    } catch (error) {
      unmount();
      throw error;
    }
  };
  remount();

  return {
    setOption(name, value) {
      if (destroyed) return;
      if (value === undefined) delete optionValues[name];
      else optionValues[name] = value;
      remount();
    },
    reset() {
      if (destroyed) return;
      optionValues = {};
      remount();
    },
    snapshot: () => ({}),
    destroy() {
      if (destroyed) return;
      destroyed = true;
      unmount();
    },
  };
}

const INITIAL_ENVELOPE: EnvelopeState = {
  attack: 0.08,
  decay: 0.32,
  sustain: 0.62,
  release: 0.7,
};
const INITIAL_ENVELOPE_RANGES: EnvelopeRanges = {
  attackMax: 2,
  decayMax: 2,
  releaseMax: 4,
};

function envelopeOptions(
  host: HTMLElement,
  values: Readonly<Record<string, unknown>>,
): EnvelopeOptions {
  const options: EnvelopeOptions = {};
  if (typeof values.label === 'string') options.label = values.label;
  if (values.classNames === 'demo') {
    options.classNames = {
      root: 'demo-transport',
      svg: 'demo-envelope-svg',
      grid: 'demo-envelope-grid',
      area: 'demo-envelope-area',
      curve: 'demo-envelope-curve',
      handle: 'demo-envelope-handle',
      readout: 'demo-envelope-readout',
      inputs: 'demo-envelope-inputs',
      input: 'demo-envelope-input',
    };
  }
  if (values.parts === 'demo') {
    options.parts = {
      root: 'demo-root', svg: 'demo-svg', grid: 'demo-grid', area: 'demo-area',
      curve: 'demo-curve', handle: 'demo-handle', readout: 'demo-readout',
      inputs: 'demo-inputs', input: 'demo-input',
    };
  }
  if (values.onError === 'report') options.onError = (error) => reportToDataset(host, error);
  return options;
}

function mountEnvelopeDemo(host: HTMLElement): UiPresenterDemoHandle {
  const notifier = createNotifier();
  let envelope: EnvelopeState = {...INITIAL_ENVELOPE};
  let ranges: EnvelopeRanges = {...INITIAL_ENVELOPE_RANGES};
  let disabled: boolean | undefined = false;
  let optionValues: Record<string, unknown> = {};
  let presenter: DestroyablePresenter | undefined;
  let destroyed = false;

  const binding: EnvelopeBinding = {
    snapshot: () => ({envelope, ranges, disabled}),
    setEnvelope(next) {
      envelope = {...next};
      notifier.notify();
    },
    subscribe: notifier.subscribe,
  };
  const remount = (): void => {
    presenter?.destroy();
    presenter = mountEnvelope(host, binding, envelopeOptions(host, optionValues));
  };
  remount();

  return {
    setState(name, value) {
      if (destroyed) return;
      if (name in envelope) {
        envelope = {...envelope, [name]: Math.max(0, Number(value) || 0)};
        if (name === 'sustain') envelope.sustain = clamp(envelope.sustain, 0, 1);
      } else if (name in ranges) {
        ranges = {...ranges, [name]: Math.max(0.01, Number(value) || 0.01)};
      } else if (name === 'disabled') disabled = value === undefined ? undefined : value === true;
      else return;
      notifier.notify();
    },
    setOption(name, value) {
      if (destroyed) return;
      if (value === undefined) delete optionValues[name];
      else optionValues[name] = value;
      remount();
    },
    reset() {
      if (destroyed) return;
      envelope = {...INITIAL_ENVELOPE};
      ranges = {...INITIAL_ENVELOPE_RANGES};
      disabled = false;
      optionValues = {};
      remount();
      notifier.notify();
    },
    snapshot: () => ({...envelope, ...ranges, disabled}),
    subscribe: notifier.subscribe,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      presenter?.destroy();
      presenter = undefined;
      notifier.clear();
      delete host.dataset.presenterDemoError;
    },
  };
}

const INITIAL_LFO_STATE: LfoState = {
  shape: 'sine',
  rate: 0.8,
  depth: 0.64,
  phase: 0.12,
  running: false,
  disabled: false,
};

function lfoOptions(
  host: HTMLElement,
  values: Readonly<Record<string, unknown>>,
): LfoOptions {
  const options: LfoOptions = {};
  if (typeof values.label === 'string') options.label = values.label;
  if (typeof values.runLabel === 'string') options.runLabel = values.runLabel;
  if (typeof values.stopLabel === 'string') options.stopLabel = values.stopLabel;
  if (values.classNames === 'demo') {
    options.classNames = {
      root: 'demo-transport', row: 'demo-lfo-row', run: 'demo-lfo-run',
      shapes: 'demo-lfo-shapes', shape: 'demo-lfo-shape', control: 'demo-lfo-control',
      rateControl: 'demo-lfo-rate-control', depthControl: 'demo-lfo-depth-control',
      label: 'demo-lfo-label', input: 'demo-lfo-input', rateInput: 'demo-lfo-rate',
      depthInput: 'demo-lfo-depth', value: 'demo-lfo-value', rateValue: 'demo-lfo-rate-value',
      depthValue: 'demo-lfo-depth-value', wave: 'demo-lfo-wave', curve: 'demo-lfo-curve',
      head: 'demo-lfo-head',
    };
  }
  if (values.parts === 'demo') {
    options.parts = {
      root: 'demo-root', row: 'demo-row', run: 'demo-run', shapes: 'demo-shapes',
      shape: 'demo-shape', control: 'demo-control', rateControl: 'demo-rate-control',
      depthControl: 'demo-depth-control', label: 'demo-label', input: 'demo-input',
      rateInput: 'demo-rate', depthInput: 'demo-depth', value: 'demo-value',
      rateValue: 'demo-rate-value', depthValue: 'demo-depth-value', wave: 'demo-wave',
      curve: 'demo-curve', head: 'demo-head',
    };
  }
  if (values.formatRate === 'musical') options.formatRate = (rate) => `${rate.toFixed(1)} cycles/s`;
  if (values.formatDepth === 'decimal') options.formatDepth = (depth) => depth.toFixed(2);
  if (values.onError === 'report') options.onError = (error) => reportToDataset(host, error);
  return options;
}

function mountLfoDemo(host: HTMLElement): UiPresenterDemoHandle {
  const notifier = createNotifier();
  let state: LfoState = {...INITIAL_LFO_STATE};
  let optionValues: Record<string, unknown> = {};
  let presenter: DestroyablePresenter | undefined;
  let destroyed = false;
  const view = host.ownerDocument.defaultView;
  let animationFrame: number | undefined;
  let previousTime: number | undefined;

  const stopClock = (): void => {
    if (animationFrame !== undefined) view?.cancelAnimationFrame(animationFrame);
    animationFrame = undefined;
    previousTime = undefined;
  };
  const tick = (time: number): void => {
    animationFrame = undefined;
    if (destroyed || !state.running) return;
    if (previousTime !== undefined) {
      const elapsed = Math.min(0.1, Math.max(0, time - previousTime) / 1000);
      state = {...state, phase: (state.phase + elapsed * state.rate) % 1};
      notifier.notify();
    }
    previousTime = time;
    animationFrame = view?.requestAnimationFrame(tick);
  };
  const startClock = (): void => {
    if (animationFrame === undefined) animationFrame = view?.requestAnimationFrame(tick);
  };
  const setRunning = (running: boolean): void => {
    state = {...state, running};
    if (running) startClock();
    else stopClock();
    notifier.notify();
  };
  const binding: LfoBinding = {
    snapshot: () => state,
    setRunning,
    setShape(shape) {
      state = {...state, shape};
      notifier.notify();
    },
    setRate(rate) {
      state = {...state, rate};
      notifier.notify();
    },
    setDepth(depth) {
      state = {...state, depth};
      notifier.notify();
    },
    subscribe: notifier.subscribe,
  };
  const remount = (): void => {
    presenter?.destroy();
    presenter = mountLfo(host, binding, lfoOptions(host, optionValues));
  };
  remount();

  return {
    setState(name, value) {
      if (destroyed) return;
      if (name === 'shape' && (value === 'sine' || value === 'triangle' || value === 'square' || value === 'saw')) {
        state = {...state, shape: value};
      } else if (name === 'rate') state = {...state, rate: clamp(Number(value) || 0, 0.05, 12)};
      else if (name === 'depth' || name === 'phase') state = {...state, [name]: clamp(Number(value) || 0, 0, 1)};
      else if (name === 'running') {
        setRunning(value === true);
        return;
      } else if (name === 'disabled') {
        const next = {...state};
        if (value === undefined) delete next.disabled;
        else next.disabled = value === true;
        state = next;
      } else return;
      notifier.notify();
    },
    setOption(name, value) {
      if (destroyed) return;
      if (value === undefined) delete optionValues[name];
      else optionValues[name] = value;
      remount();
    },
    reset() {
      if (destroyed) return;
      stopClock();
      state = {...INITIAL_LFO_STATE};
      optionValues = {};
      remount();
      notifier.notify();
    },
    snapshot: () => ({...state}),
    subscribe: notifier.subscribe,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      stopClock();
      presenter?.destroy();
      presenter = undefined;
      notifier.clear();
      delete host.dataset.presenterDemoError;
    },
  };
}

type EqBandPreset = 'three-band' | 'single-band' | 'empty';
type EqResponseMode = 'computed' | 'flat';

function eqBands(preset: EqBandPreset): EqBandState[] {
  if (preset === 'empty') return [];
  if (preset === 'single-band') return [{frequency: 1200, gain: 4, q: 1}];
  return [
    {frequency: 120, gain: 3.5, q: 0.75},
    {frequency: 1200, gain: -2.5, q: 1.1},
    {frequency: 7200, gain: 4, q: 0.9},
  ];
}

function buildEqResponse(bands: readonly EqBandState[]): EqResponsePoint[] {
  const minimumFrequency = 30;
  const maximumFrequency = 18000;
  const ratio = maximumFrequency / minimumFrequency;
  return Array.from({length: 65}, (_, index) => {
    const x = index / 64;
    const frequency = minimumFrequency * ratio ** x;
    const gain = bands.reduce((sum, band) => {
      const center = clamp(band.frequency, minimumFrequency, maximumFrequency);
      const distance = Math.log2(frequency / center);
      const width = 1.2 / Math.max(0.2, band.q ?? 1);
      return sum + (band.gain ?? 0) * Math.exp(-0.5 * (distance / width) ** 2);
    }, 0);
    return {x, gain: clamp(gain, -18, 18)};
  });
}

function eqOptions(
  host: HTMLElement,
  values: Readonly<Record<string, unknown>>,
): EqOptions {
  const options: EqOptions = {};
  if (typeof values.label === 'string') options.label = values.label;
  if (typeof values.emptyLabel === 'string') options.emptyLabel = values.emptyLabel;
  if (values.classNames === 'demo') {
    options.classNames = {
      root: 'demo-transport', svg: 'demo-eq-svg', grid: 'demo-eq-grid', zero: 'demo-eq-zero',
      area: 'demo-eq-area', curve: 'demo-eq-curve', points: 'demo-eq-points', point: 'demo-eq-point',
      readout: 'demo-eq-readout', empty: 'demo-eq-empty', input: 'demo-eq-input',
    };
  }
  if (values.parts === 'demo') {
    options.parts = {
      root: 'demo-root', svg: 'demo-svg', grid: 'demo-grid', zero: 'demo-zero',
      area: 'demo-area', curve: 'demo-curve', points: 'demo-points', point: 'demo-point',
      readout: 'demo-readout', empty: 'demo-empty', input: 'demo-input',
    };
  }
  if (values.formatFrequency === 'precise') options.formatFrequency = (frequency) => `${Math.round(frequency)} Hz`;
  if (values.onError === 'report') options.onError = (error) => reportToDataset(host, error);
  return options;
}

function mountEqDemo(host: HTMLElement): UiPresenterDemoHandle {
  const notifier = createNotifier();
  let bandPreset: EqBandPreset = 'three-band';
  let responseMode: EqResponseMode | undefined = 'computed';
  let bands = eqBands(bandPreset);
  let ready: boolean | undefined = true;
  let disabled: boolean | undefined = false;
  let optionValues: Record<string, unknown> = {};
  let presenter: DestroyablePresenter | undefined;
  let destroyed = false;

  const binding: EqBinding = {
    snapshot: () => ({
      bands,
      response: responseMode === undefined
        ? undefined
        : responseMode === 'flat'
          ? [{x: 0, gain: 0}, {x: 1, gain: 0}]
          : buildEqResponse(bands),
      ready,
      disabled,
    }),
    setBand(index, next) {
      const band = bands[index];
      if (!band) return;
      bands = bands.map((candidate, candidateIndex) =>
        candidateIndex === index
          ? {...candidate, frequency: next.frequency, gain: next.gain}
          : candidate,
      );
      notifier.notify();
    },
    subscribe: notifier.subscribe,
  };
  const remount = (): void => {
    presenter?.destroy();
    presenter = mountEq(host, binding, eqOptions(host, optionValues));
  };
  remount();

  return {
    setState(name, value) {
      if (destroyed) return;
      if (name === 'bands' && (value === 'three-band' || value === 'single-band' || value === 'empty')) {
        bandPreset = value;
        bands = eqBands(bandPreset);
      } else if (name === 'response' && (value === undefined || value === 'computed' || value === 'flat')) responseMode = value;
      else if (name === 'ready') ready = value === undefined ? undefined : value === true;
      else if (name === 'disabled') disabled = value === undefined ? undefined : value === true;
      else return;
      notifier.notify();
    },
    setOption(name, value) {
      if (destroyed) return;
      if (value === undefined) delete optionValues[name];
      else optionValues[name] = value;
      remount();
    },
    reset() {
      if (destroyed) return;
      bandPreset = 'three-band';
      responseMode = 'computed';
      bands = eqBands(bandPreset);
      ready = true;
      disabled = false;
      optionValues = {};
      remount();
      notifier.notify();
    },
    snapshot: () => ({bands: bandPreset, response: responseMode, ready, disabled}),
    subscribe: notifier.subscribe,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      presenter?.destroy();
      presenter = undefined;
      notifier.clear();
      delete host.dataset.presenterDemoError;
    },
  };
}

export function mountParametersGesturesDemo(
  presenter: string,
  host: HTMLElement,
): UiPresenterDemoMountResult {
  switch (presenter) {
    case 'parameter':
      return mountParameterDemo(host);
    case 'macro':
      return mountMacroDemo(host);
    case 'panel':
      return mountPanelDemo(host);
    case 'envelope':
      return mountEnvelopeDemo(host);
    case 'lfo':
      return mountLfoDemo(host);
    case 'eq':
      return mountEqDemo(host);
    default:
      return undefined;
  }
}
