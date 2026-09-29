import {mountLevelAnalyzer, type LevelAnalyzerHandle, type LevelAnalyzerSample, type LevelAnalyzerState} from '@webmusic/ui/level-analyzer';
import {mountOscilloscope, type OscilloscopeHandle, type OscilloscopeOptions, type OscilloscopeState, type OscilloscopeTrace, type OscilloscopeTriggerEdge} from '@webmusic/ui/oscilloscope';
import {mountSpectrumAnalyzer, type SpectrumAnalyzerHandle, type SpectrumAnalyzerOptions, type SpectrumAnalyzerState} from '@webmusic/ui/spectrum-analyzer';
import {mountTransientAnalyzer, type TransientAnalyzerHandle, type TransientAnalyzerSample, type TransientAnalyzerState} from '@webmusic/ui/transient-analyzer';
import type {UiPresenterDemoHandle, UiPresenterDemoMountResult} from './types';

function clamp(value: unknown, minimum: number, maximum: number, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(maximum, Math.max(minimum, value)) : fallback;
}

function notifier() {
  const listeners = new Set<() => void>();
  return {
    notify: () => { for (const listener of [...listeners]) listener(); },
    subscribe: (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener); },
    clear: () => listeners.clear(),
  };
}

function report(host: HTMLElement, error: unknown): void {
  host.dataset.presenterDemoError = error instanceof Error ? error.message : String(error);
}

function mountLevelDemo(host: HTMLElement): UiPresenterDemoHandle {
  const initial = {rmsDbfs: -24, peakDbfs: -10, thresholdDbfs: -6, frozen: false};
  let controls = {...initial};
  let phase = 0;
  let heldPeakDbfs: number | undefined;
  let sample: LevelAnalyzerSample | undefined;
  let history: LevelAnalyzerSample[] = [];
  let destroyed = false;
  const published = notifier();
  const view = host.ownerDocument.defaultView;

  const state = (): LevelAnalyzerState => ({
    sample,
    heldPeakDbfs,
    history,
    thresholdDbfs: controls.thresholdDbfs,
    frozen: controls.frozen,
    status: controls.frozen ? 'Frozen' : 'Live demo signal',
  });
  const presenter: LevelAnalyzerHandle = mountLevelAnalyzer(host, {
    onThresholdChange(value) {
      controls.thresholdDbfs = clamp(value, -60, 0, initial.thresholdDbfs);
      presenter.update(state());
      published.notify();
    },
    onFreezeChange(value) {
      controls.frozen = value;
      presenter.update(state());
      published.notify();
    },
    onResetHold() {
      heldPeakDbfs = undefined;
      presenter.update(state());
    },
  });
  const tick = (): void => {
    if (destroyed || controls.frozen) return;
    phase += .21;
    const rmsDbfs = clamp(controls.rmsDbfs + Math.sin(phase) * 2.6, -60, 0, -24);
    const peakDbfs = clamp(Math.max(rmsDbfs, controls.peakDbfs + Math.sin(phase * 1.7) * 2), -60, 0, -10);
    sample = {rmsDbfs, peakDbfs};
    heldPeakDbfs = heldPeakDbfs === undefined ? peakDbfs : Math.max(heldPeakDbfs, peakDbfs);
    history = [...history.slice(-63), sample];
    presenter.update(state());
  };
  tick();
  const timer = view?.setInterval(tick, 90);
  return {
    setState(name, value) {
      if (destroyed) return;
      if (name === 'rmsDbfs') controls.rmsDbfs = clamp(value, -60, 0, initial.rmsDbfs);
      else if (name === 'peakDbfs') controls.peakDbfs = clamp(value, -60, 0, initial.peakDbfs);
      else if (name === 'thresholdDbfs') controls.thresholdDbfs = clamp(value, -60, 0, initial.thresholdDbfs);
      else if (name === 'frozen') controls.frozen = value === true;
      else return;
      tick();
      presenter.update(state());
      published.notify();
    },
    reset() {
      if (destroyed) return;
      controls = {...initial};
      phase = 0;
      heldPeakDbfs = undefined;
      sample = undefined;
      history = [];
      delete host.dataset.presenterDemoError;
      tick();
      published.notify();
    },
    snapshot: () => ({...controls}),
    subscribe: published.subscribe,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      if (timer !== undefined) view?.clearInterval(timer);
      presenter.destroy();
      published.clear();
      delete host.dataset.presenterDemoError;
    },
  };
}

const SPECTRUM_FFT_SIZE = 2048;
const SPECTRUM_SAMPLE_RATE = 48000;

function harmonicBins(fundamentalHz: number, phase: number): Float32Array {
  const bins = new Float32Array(SPECTRUM_FFT_SIZE / 2);
  bins.fill(-100);
  const binHz = SPECTRUM_SAMPLE_RATE / SPECTRUM_FFT_SIZE;
  for (let harmonic = 1; harmonic <= 12; harmonic += 1) {
    const center = Math.round(fundamentalHz * harmonic / binHz);
    const level = -27 - harmonic * 4 + Math.sin(phase + harmonic * .7) * 2;
    for (let offset = -2; offset <= 2; offset += 1) {
      const index = center + offset;
      if (index >= 0 && index < bins.length) bins[index] = Math.max(bins[index]!, level - Math.abs(offset) * 9);
    }
  }
  return bins;
}

function spectrumOptions(host: HTMLElement, options: Readonly<Record<string, unknown>>): SpectrumAnalyzerOptions {
  return {
    ...(typeof options.label === 'string' ? {label: options.label} : {}),
    ...(typeof options.stylesheet === 'boolean' ? {stylesheet: options.stylesheet} : {}),
    ...(options.onError === 'report' ? {onError: (error: unknown) => report(host, error)} : {}),
  };
}

function mountSpectrumDemo(host: HTMLElement): UiPresenterDemoHandle {
  const initial = {fundamentalHz: 440, frozen: false, peakHold: false, minFrequency: 20, maxFrequency: 20000};
  let controls = {...initial};
  let frame: SpectrumAnalyzerState['frame'];
  let phase = 0;
  let sourceRevision = 0;
  let options: Record<string, unknown> = {};
  let presenter: SpectrumAnalyzerHandle | undefined;
  let destroyed = false;
  const published = notifier();
  const view = host.ownerDocument.defaultView;

  const snapshot = (): SpectrumAnalyzerState => ({
    frame, sourceRevision,
    frozen: controls.frozen,
    peakHold: controls.peakHold,
    minFrequency: controls.minFrequency,
    maxFrequency: controls.maxFrequency,
    status: controls.frozen ? 'frozen' : 'live',
  });
  const binding = {
    snapshot,
    setFrozen(value: boolean) { controls.frozen = value; published.notify(); },
    setPeakHold(value: boolean) { controls.peakHold = value; published.notify(); },
    probe(frequency: number, db: number | undefined) {
      host.dataset.presenterProbe = `${Math.round(frequency)} Hz${db === undefined ? '' : `, ${db.toFixed(1)} dB`}`;
    },
    subscribe: published.subscribe,
  };
  const remount = (): void => {
    presenter?.destroy();
    presenter = mountSpectrumAnalyzer(host, binding, spectrumOptions(host, options));
  };
  const tick = (): void => {
    if (destroyed || controls.frozen) return;
    phase += .13;
    frame = {
      bins: harmonicBins(controls.fundamentalHz, phase),
      sampleRate: SPECTRUM_SAMPLE_RATE,
      fftSize: SPECTRUM_FFT_SIZE,
      minDb: -100,
      maxDb: -20,
    };
    published.notify();
  };
  tick();
  remount();
  const timer = view?.setInterval(tick, 100);
  return {
    setState(name, value) {
      if (destroyed) return;
      if (name === 'fundamentalHz') controls.fundamentalHz = clamp(value, 55, 2000, initial.fundamentalHz);
      else if (name === 'frozen') controls.frozen = value === true;
      else if (name === 'peakHold') controls.peakHold = value === true;
      else if (name === 'minFrequency') controls.minFrequency = clamp(value, 20, 5000, initial.minFrequency);
      else if (name === 'maxFrequency') controls.maxFrequency = clamp(value, 200, 24000, initial.maxFrequency);
      else return;
      tick();
      published.notify();
    },
    setOption(name, value) {
      if (destroyed) return;
      if (value === undefined) delete options[name];
      else options[name] = value;
      remount();
    },
    reset() {
      if (destroyed) return;
      controls = {...initial};
      frame = undefined;
      phase = 0;
      sourceRevision += 1;
      options = {};
      delete host.dataset.presenterProbe;
      delete host.dataset.presenterDemoError;
      tick();
      remount();
      published.notify();
    },
    snapshot: () => ({...controls}),
    subscribe: published.subscribe,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      if (timer !== undefined) view?.clearInterval(timer);
      presenter?.destroy();
      published.clear();
      delete host.dataset.presenterProbe;
      delete host.dataset.presenterDemoError;
    },
  };
}

const SCOPE_SAMPLE_RATE = 48_000;
const SCOPE_SAMPLE_COUNT = 4_096;
const SCOPE_AVAILABLE_MS = (SCOPE_SAMPLE_COUNT - 1) / SCOPE_SAMPLE_RATE * 1_000;

function scopeSamples(frequencyHz: number, amplitude: number, phase: number): Float32Array {
  const samples = new Float32Array(SCOPE_SAMPLE_COUNT);
  for (let index = 0; index < samples.length; index += 1) {
    const cycle = 2 * Math.PI * frequencyHz * index / SCOPE_SAMPLE_RATE + phase;
    samples[index] = amplitude * (Math.sin(cycle) * .85 + Math.sin(cycle * 2) * .15);
  }
  return samples;
}

function scopeTrace(
  samples: Float32Array,
  timebaseMs: number,
  triggerLevel: number,
  triggerEdge: OscilloscopeTriggerEdge,
): OscilloscopeTrace {
  const count = Math.min(samples.length, Math.max(2, Math.round(timebaseMs * SCOPE_SAMPLE_RATE / 1_000) + 1));
  let start = samples.length - count;
  let triggered = false;
  if (triggerEdge !== 'off') {
    for (let index = start; index >= 1; index -= 1) {
      const previous = samples[index - 1]!;
      const current = samples[index]!;
      if (triggerEdge === 'rising' ? previous < triggerLevel && current >= triggerLevel
        : previous > triggerLevel && current <= triggerLevel) {
        start = index;
        triggered = true;
        break;
      }
    }
  }
  const visible = samples.slice(start, start + count);
  return {
    samples: visible,
    timebaseMs: (count - 1) / SCOPE_SAMPLE_RATE * 1_000,
    triggered,
    silent: visible.every((sample) => Math.abs(sample) < 1e-5),
  };
}

function scopeOptions(host: HTMLElement, options: Readonly<Record<string, unknown>>): OscilloscopeOptions {
  return {
    ...(typeof options.label === 'string' ? {label: options.label} : {}),
    ...(typeof options.stylesheet === 'boolean' ? {stylesheet: options.stylesheet} : {}),
    ...(options.onError === 'report' ? {onError: (error: unknown) => report(host, error)} : {}),
  };
}

function mountOscilloscopeDemo(host: HTMLElement): UiPresenterDemoHandle {
  const initial = {
    frequencyHz: 440, amplitude: .75, timebaseMs: 10, triggerLevel: 0,
    triggerEdge: 'rising' as OscilloscopeTriggerEdge, frozen: false,
  };
  let controls = {...initial};
  let options: Record<string, unknown> = {};
  let presenter: OscilloscopeHandle | undefined;
  let raw: Float32Array | undefined;
  let trace: OscilloscopeTrace | undefined;
  let phase = 0;
  let destroyed = false;
  const published = notifier();
  const view = host.ownerDocument.defaultView;

  const project = (): void => {
    trace = raw ? scopeTrace(raw, controls.timebaseMs, controls.triggerLevel, controls.triggerEdge) : undefined;
    published.notify();
  };
  const snapshot = (): OscilloscopeState => ({
    trace, availableTimeMs: SCOPE_AVAILABLE_MS, timebaseMs: controls.timebaseMs,
    triggerLevel: controls.triggerLevel, triggerEdge: controls.triggerEdge,
    frozen: controls.frozen, status: controls.frozen ? 'frozen' : 'live',
  });
  const binding = {
    snapshot,
    setFrozen(value: boolean) { controls.frozen = value; if (!value) tick(); else published.notify(); },
    setTimebaseMs(value: number) { controls.timebaseMs = clamp(value, 1, SCOPE_AVAILABLE_MS, initial.timebaseMs); project(); },
    setTriggerLevel(value: number) { controls.triggerLevel = clamp(value, -1, 1, initial.triggerLevel); project(); },
    setTriggerEdge(value: OscilloscopeTriggerEdge) { controls.triggerEdge = value; project(); },
    probe(timeMs: number, amplitude: number | undefined) {
      host.dataset.presenterProbe = `${timeMs.toFixed(2)} ms${amplitude === undefined ? '' : `, ${amplitude.toFixed(2)} amplitude`}`;
    },
    subscribe: published.subscribe,
  };
  const remount = (): void => {
    presenter?.destroy();
    presenter = mountOscilloscope(host, binding, scopeOptions(host, options));
  };
  const tick = (): void => {
    if (destroyed || controls.frozen) return;
    phase += .19;
    raw = scopeSamples(controls.frequencyHz, controls.amplitude, phase);
    project();
  };
  tick();
  remount();
  const timer = view?.setInterval(tick, 90);
  return {
    setState(name, value) {
      if (destroyed) return;
      if (name === 'frequencyHz') controls.frequencyHz = clamp(value, 60, 1800, initial.frequencyHz);
      else if (name === 'amplitude') controls.amplitude = clamp(value, 0, 1, initial.amplitude);
      else if (name === 'timebaseMs') controls.timebaseMs = clamp(value, 1, SCOPE_AVAILABLE_MS, initial.timebaseMs);
      else if (name === 'triggerLevel') controls.triggerLevel = clamp(value, -1, 1, initial.triggerLevel);
      else if (name === 'triggerEdge') controls.triggerEdge = value === 'falling' || value === 'off' ? value : 'rising';
      else if (name === 'frozen') controls.frozen = value === true;
      else return;
      if (!controls.frozen && (name === 'frequencyHz' || name === 'amplitude' || name === 'frozen')) tick();
      else project();
    },
    setOption(name, value) {
      if (destroyed) return;
      if (value === undefined) delete options[name];
      else options[name] = value;
      remount();
    },
    reset() {
      if (destroyed) return;
      controls = {...initial};
      options = {};
      raw = undefined;
      trace = undefined;
      phase = 0;
      delete host.dataset.presenterProbe;
      delete host.dataset.presenterDemoError;
      tick();
      remount();
      published.notify();
    },
    snapshot: () => ({...controls}),
    subscribe: published.subscribe,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      if (timer !== undefined) view?.clearInterval(timer);
      presenter?.destroy();
      published.clear();
      delete host.dataset.presenterProbe;
      delete host.dataset.presenterDemoError;
    },
  };
}

function mountTransientDemo(host: HTMLElement): UiPresenterDemoHandle {
  const initial = {attackStrength: .32, sensitivity: .55, frozen: false};
  let controls = {...initial};
  let sample: TransientAnalyzerSample | undefined;
  let history: TransientAnalyzerSample[] = [];
  let hitCount = 0;
  let lastIntervalMs: number | undefined;
  let lastHitAt: number | undefined;
  let frameIndex = -1;
  let destroyed = false;
  const published = notifier();
  const view = host.ownerDocument.defaultView;
  const threshold = (): number => .08 + (1 - controls.sensitivity) * .28;
  const state = (): TransientAnalyzerState => ({
    sample, history, sensitivity: controls.sensitivity, threshold: threshold(),
    frozen: controls.frozen, hitCount, lastIntervalMs,
    status: controls.frozen ? 'Frozen' : 'Live demo signal',
  });
  const clear = (): void => {
    sample = undefined;
    history = [];
    hitCount = 0;
    lastIntervalMs = undefined;
    lastHitAt = undefined;
    presenter.update(state());
    published.notify();
  };
  const presenter: TransientAnalyzerHandle = mountTransientAnalyzer(host, {
    onSensitivityChange(value) {
      controls.sensitivity = clamp(value, 0, 1, initial.sensitivity);
      presenter.update(state());
      published.notify();
    },
    onFreezeChange(value) {
      controls.frozen = value;
      presenter.update(state());
      published.notify();
    },
    onClear: clear,
  });
  const tick = (): void => {
    if (destroyed || controls.frozen) return;
    frameIndex += 1;
    const cycle = Math.floor(frameIndex / 12);
    const attack = frameIndex % 12 === 0;
    const strength = attack
      ? clamp(controls.attackStrength + Math.sin(cycle * 1.4) * .13, 0, 1, controls.attackStrength)
      : .035 + Math.max(0, Math.sin(frameIndex * .8)) * .045;
    const hit = attack && strength >= threshold();
    sample = {strength, hit};
    history = [...history.slice(-63), sample];
    if (hit) {
      const at = frameIndex * 100;
      lastIntervalMs = lastHitAt === undefined ? undefined : at - lastHitAt;
      lastHitAt = at;
      hitCount += 1;
    }
    presenter.update(state());
  };
  tick();
  const timer = view?.setInterval(tick, 100);
  return {
    setState(name, value) {
      if (destroyed) return;
      if (name === 'attackStrength') controls.attackStrength = clamp(value, 0, 1, initial.attackStrength);
      else if (name === 'sensitivity') controls.sensitivity = clamp(value, 0, 1, initial.sensitivity);
      else if (name === 'frozen') controls.frozen = value === true;
      else return;
      presenter.update(state());
      published.notify();
    },
    reset() {
      if (destroyed) return;
      controls = {...initial};
      frameIndex = -1;
      clear();
      delete host.dataset.presenterDemoError;
      tick();
      published.notify();
    },
    snapshot: () => ({...controls}),
    subscribe: published.subscribe,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      if (timer !== undefined) view?.clearInterval(timer);
      presenter.destroy();
      published.clear();
      delete host.dataset.presenterDemoError;
    },
  };
}

export function mountAnalyzerToolsDemo(presenter: string, host: HTMLElement): UiPresenterDemoMountResult {
  if (presenter === 'level-analyzer') return mountLevelDemo(host);
  if (presenter === 'oscilloscope') return mountOscilloscopeDemo(host);
  if (presenter === 'spectrum-analyzer') return mountSpectrumDemo(host);
  if (presenter === 'transient-analyzer') return mountTransientDemo(host);
  return undefined;
}
