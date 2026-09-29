import {claimHost, createErrorSink} from './internal/lifecycle';
import {installStyle} from './internal/style';

/** A frequency-domain snapshot. Values are the analyser's bins in dB. */
export interface SpectrumAnalyzerFrame {
  bins: ArrayLike<number>;
  sampleRate: number;
  fftSize: number;
  minDb: number;
  maxDb: number;
}

export interface SpectrumAnalyzerState {
  frame?: SpectrumAnalyzerFrame;
  /** The number of source changes; a new source invalidates held peaks. */
  sourceRevision: number;
  frozen: boolean;
  peakHold: boolean;
  minFrequency: number;
  maxFrequency: number;
  status: 'waiting' | 'live' | 'paused' | 'unavailable' | 'frozen';
}

export interface SpectrumAnalyzerBinding {
  snapshot(): SpectrumAnalyzerState;
  setFrozen(value: boolean): void;
  setPeakHold(value: boolean): void;
  /** Called only for a user-selected frequency, not on every audio frame. */
  probe?(frequency: number, db: number | undefined): void;
  subscribe?(notify: () => void): () => void;
}

export interface SpectrumAnalyzerOptions {
  label?: string;
  onError?: (error: unknown) => void;
  stylesheet?: boolean;
}

export interface SpectrumAnalyzerHandle {
  element: HTMLElement;
  readonly selectedFrequency: number;
  update(): void;
  resetPeaks(): void;
  destroy(): void;
}

type SpectrumHost = HTMLElement | ShadowRoot;
const mounted = new WeakMap<SpectrumHost, SpectrumAnalyzerHandle>();

export const spectrumAnalyzerStyle = String.raw`
.wui-spectrum-analyzer, .wui-spectrum-analyzer * { box-sizing: border-box; }
.wui-spectrum-analyzer {
  display: grid;
  gap: .5rem;
  width: 100%;
  min-width: 0;
  color: var(--wm-spectrum-foreground, var(--wm-foreground, #28343a));
  font: 400 .78rem/1.4 var(--wm-font-family, system-ui, sans-serif);
}
.wui-spectrum-analyzer__toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: .35rem; min-width: 0; }
.wui-spectrum-analyzer__button {
  min-height: 2rem;
  padding: .25rem .55rem;
  border: 1px solid var(--wm-spectrum-border, var(--wm-border, #a8b4b8));
  border-radius: var(--wm-control-radius, 0);
  background: var(--wm-spectrum-control-background, var(--wm-surface, #fff));
  color: inherit;
  font: inherit;
  cursor: pointer;
}
.wui-spectrum-analyzer__button[aria-pressed="true"] {
  background: var(--wm-spectrum-selected-background, #d9eeeb);
  border-color: var(--wm-spectrum-selected-border, #258e83);
}
.wui-spectrum-analyzer__button:disabled { opacity: .5; cursor: default; }
.wui-spectrum-analyzer__button:focus-visible, .wui-spectrum-analyzer__plot:focus-visible {
  outline: 2px solid var(--wm-focus, Highlight);
  outline-offset: 2px;
}
.wui-spectrum-analyzer__readout {
  min-width: 0;
  margin-inline-start: auto;
  color: var(--wm-spectrum-muted, var(--wm-foreground-muted, #506067));
  font: 600 .75rem/1.4 var(--wm-font-mono, ui-monospace, monospace);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.wui-spectrum-analyzer__plot {
  display: block;
  width: 100%;
  height: var(--wm-spectrum-height, 11rem);
  min-height: 7rem;
  border: 0;
  background: var(--wm-spectrum-plot-background, #152126);
  touch-action: none;
  cursor: crosshair;
}
.wui-spectrum-analyzer__status { min-height: 1.1rem; color: var(--wm-spectrum-muted, var(--wm-foreground-muted, #506067)); }
@media (forced-colors: active) {
  .wui-spectrum-analyzer__plot { border: 1px solid CanvasText; background: Canvas; }
  .wui-spectrum-analyzer__button[aria-pressed="true"] { border-color: Highlight; }
}
`;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function frequencyLabel(frequency: number): string {
  if (frequency >= 1_000) return `${(frequency / 1_000).toFixed(frequency < 10_000 ? 1 : 0)} kHz`;
  return `${Math.round(frequency)} Hz`;
}

function range(state: SpectrumAnalyzerState): {min: number; max: number} {
  const nyquist = state.frame ? state.frame.sampleRate / 2 : 20_000;
  const min = clamp(Number.isFinite(state.minFrequency) ? state.minFrequency : 20, 1, Math.max(1, nyquist));
  const max = clamp(Number.isFinite(state.maxFrequency) ? state.maxFrequency : nyquist, min + 1, Math.max(min + 1, nyquist));
  return {min, max};
}

function frequencyAt(x: number, width: number, min: number, max: number): number {
  return min * Math.pow(max / min, clamp(x / Math.max(1, width), 0, 1));
}

function xAt(frequency: number, width: number, min: number, max: number): number {
  return width * Math.log(frequency / min) / Math.log(max / min);
}

function probeDb(frame: SpectrumAnalyzerFrame | undefined, frequency: number): number | undefined {
  if (!frame || frame.fftSize <= 0 || frame.sampleRate <= 0 || frame.bins.length === 0) return undefined;
  const index = clamp(Math.round(frequency * frame.fftSize / frame.sampleRate), 0, frame.bins.length - 1);
  const db = frame.bins[index];
  return Number.isFinite(db) ? db : undefined;
}

/** Mount an inspectable log-frequency spectrum. The caller owns audio and sampling. */
export function mountSpectrumAnalyzer(
  host: SpectrumHost,
  binding: SpectrumAnalyzerBinding,
  options: SpectrumAnalyzerOptions = {},
): SpectrumAnalyzerHandle {
  const document = host.ownerDocument;
  const view = document.defaultView;
  const report = createErrorSink(options.onError);
  const style = installStyle(document, 'spectrum-analyzer', spectrumAnalyzerStyle, options.stylesheet);
  const root = document.createElement('div');
  root.className = 'wui-spectrum-analyzer';
  root.setAttribute('role', 'group');
  root.setAttribute('aria-label', options.label ?? 'Spectrum analyzer');
  root.setAttribute('part', 'root surface');

  const toolbar = document.createElement('div');
  toolbar.className = 'wui-spectrum-analyzer__toolbar';
  toolbar.setAttribute('part', 'toolbar');
  const freeze = document.createElement('button');
  freeze.className = 'wui-spectrum-analyzer__button';
  freeze.type = 'button';
  freeze.textContent = 'Freeze';
  freeze.setAttribute('part', 'freeze');
  const peak = document.createElement('button');
  peak.className = 'wui-spectrum-analyzer__button';
  peak.type = 'button';
  peak.textContent = 'Peak hold';
  peak.setAttribute('part', 'peak-hold');
  const reset = document.createElement('button');
  reset.className = 'wui-spectrum-analyzer__button';
  reset.type = 'button';
  reset.textContent = 'Reset peaks';
  reset.setAttribute('part', 'reset-peaks');
  const readout = document.createElement('output');
  readout.className = 'wui-spectrum-analyzer__readout';
  readout.setAttribute('part', 'readout');
  toolbar.append(freeze, peak, reset, readout);

  const canvas = document.createElement('canvas');
  canvas.className = 'wui-spectrum-analyzer__plot';
  canvas.setAttribute('part', 'plot');
  canvas.setAttribute('role', 'slider');
  canvas.setAttribute('aria-label', 'Inspect frequency');
  canvas.tabIndex = 0;
  const status = document.createElement('div');
  status.className = 'wui-spectrum-analyzer__status';
  status.setAttribute('part', 'status');
  root.append(toolbar, canvas, status);

  let destroyed = false;
  let unsubscribe: (() => void) | undefined;
  let observer: ResizeObserver | undefined;
  let selectedFrequency = 1_000;
  let sourceRevision = Number.NaN;
  let held: Float32Array | undefined;
  let heldFrame: SpectrumAnalyzerFrame | undefined;
  const isCurrent = (): boolean => !destroyed && claim.isCurrent();

  const resetPeaks = (): void => {
    if (destroyed) return;
    held = undefined;
    heldFrame = undefined;
    update();
  };

  const draw = (state: SpectrumAnalyzerState, min: number, max: number): void => {
    const context = canvas.getContext('2d');
    if (!context) return;
    const width = Math.max(1, Math.round(canvas.clientWidth || root.clientWidth || 360));
    const height = Math.max(1, Math.round(canvas.clientHeight || 176));
    const ratio = Math.max(1, view?.devicePixelRatio || 1);
    const pixelWidth = Math.max(1, Math.round(width * ratio));
    const pixelHeight = Math.max(1, Math.round(height * ratio));
    if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
    if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);
    context.fillStyle = '#152126';
    context.fillRect(0, 0, width, height);

    const left = 38;
    const right = 10;
    const top = 10;
    const bottom = 24;
    const plotWidth = Math.max(1, width - left - right);
    const plotHeight = Math.max(1, height - top - bottom);
    const frame = state.frame;
    const axisFrame = frame ?? heldFrame;
    const minDb = axisFrame?.minDb ?? -100;
    const maxDb = axisFrame?.maxDb ?? -30;
    const dbRange = Math.max(1, maxDb - minDb);
    const yAt = (db: number) => top + (maxDb - clamp(db, minDb, maxDb)) / dbRange * plotHeight;

    context.strokeStyle = '#3f5359';
    context.fillStyle = '#b8c7c8';
    context.font = '10px ui-monospace, monospace';
    context.lineWidth = 1;
    for (const fraction of [0, .25, .5, .75, 1]) {
      const y = top + fraction * plotHeight;
      context.beginPath();
      context.moveTo(left, y + .5);
      context.lineTo(left + plotWidth, y + .5);
      context.stroke();
      context.fillText(String(Math.round(maxDb - fraction * dbRange)), 4, y + 3);
    }
    for (const hz of [20, 50, 100, 200, 500, 1_000, 2_000, 5_000, 10_000, 20_000]) {
      if (hz < min || hz > max) continue;
      const x = left + xAt(hz, plotWidth, min, max);
      context.beginPath();
      context.moveTo(x + .5, top);
      context.lineTo(x + .5, top + plotHeight);
      context.stroke();
      if ([20, 100, 1_000, 10_000].includes(hz)) {
        context.fillText(hz >= 1_000 ? `${hz / 1_000}k` : String(hz), x + 2, height - 7);
      }
    }

    const paintBins = (bins: ArrayLike<number>, source: SpectrumAnalyzerFrame, color: string, lineWidth: number) => {
      const columns = new Float32Array(Math.ceil(plotWidth) + 1);
      columns.fill(-Infinity);
      const binHz = source.sampleRate / source.fftSize;
      const from = Math.max(1, Math.ceil(min / binHz));
      const to = Math.min(bins.length - 1, Math.floor(max / binHz));
      for (let index = from; index <= to; index += 1) {
        const db = bins[index];
        if (!Number.isFinite(db)) continue;
        const x = clamp(Math.round(xAt(index * binHz, plotWidth, min, max)), 0, columns.length - 1);
        columns[x] = Math.max(columns[x], db);
      }
      context.strokeStyle = color;
      context.lineWidth = lineWidth;
      context.beginPath();
      let started = false;
      for (let x = 0; x < columns.length; x += 1) {
        if (!Number.isFinite(columns[x])) continue;
        const y = yAt(columns[x]);
        if (!started) { context.moveTo(left + x, y); started = true; }
        else context.lineTo(left + x, y);
      }
      if (started) context.stroke();
    };
    if (state.peakHold && held && heldFrame) paintBins(held, heldFrame, '#f1b65f', 1);
    if (frame) paintBins(frame.bins, frame, '#5bd3c1', 1.5);

    const cursorX = left + xAt(selectedFrequency, plotWidth, min, max);
    context.strokeStyle = '#eff4ef';
    context.setLineDash([3, 3]);
    context.beginPath();
    context.moveTo(cursorX, top);
    context.lineTo(cursorX, top + plotHeight);
    context.stroke();
    context.setLineDash([]);
  };

  const update = (): void => {
    if (!isCurrent()) return;
    try {
      const state = binding.snapshot();
      if (!isCurrent()) return;
      if (state.sourceRevision !== sourceRevision) {
        sourceRevision = state.sourceRevision;
        held = undefined;
        heldFrame = undefined;
      }
      const {min, max} = range(state);
      selectedFrequency = clamp(selectedFrequency, min, max);
      const frame = state.frame;
      if (!state.peakHold) {
        held = undefined;
        heldFrame = undefined;
      } else if (frame) {
        if (!held || held.length !== frame.bins.length || heldFrame?.fftSize !== frame.fftSize || heldFrame.sampleRate !== frame.sampleRate) {
          held = Float32Array.from(frame.bins);
        } else {
          for (let index = 0; index < held.length; index += 1) {
            const db = frame.bins[index];
            if (Number.isFinite(db)) held[index] = Math.max(held[index], db);
          }
        }
        heldFrame = frame;
      }
      freeze.setAttribute('aria-pressed', String(state.frozen));
      freeze.disabled = !state.frozen && !frame;
      peak.setAttribute('aria-pressed', String(state.peakHold));
      reset.disabled = !state.peakHold || !held;
      canvas.setAttribute('aria-valuemin', String(Math.round(min)));
      canvas.setAttribute('aria-valuemax', String(Math.round(max)));
      canvas.setAttribute('aria-valuenow', String(Math.round(selectedFrequency)));
      const db = probeDb(frame, selectedFrequency);
      const valueText = `${frequencyLabel(selectedFrequency)}${db === undefined ? '' : `, ${db.toFixed(1)} dB`}`;
      canvas.setAttribute('aria-valuetext', valueText);
      readout.textContent = valueText;
      status.textContent = ({
        waiting: 'Waiting for playback',
        live: 'Live spectrum',
        paused: 'Playback paused',
        unavailable: 'Analyser unavailable',
        frozen: 'Spectrum frozen',
      } as const)[state.status];
      root.dataset.state = state.status;
      draw(state, min, max);
    } catch (error) {
      report(error);
    }
  };

  const setProbe = (frequency: number): void => {
    if (!isCurrent()) return;
    try {
      const state = binding.snapshot();
      if (!isCurrent()) return;
      const {min, max} = range(state);
      const next = clamp(frequency, min, max);
      if (next === selectedFrequency) return;
      selectedFrequency = next;
      update();
      if (isCurrent()) binding.probe?.(next, probeDb(state.frame, next));
    } catch (error) { report(error); }
  };

  const onPointer = (event: PointerEvent): void => {
    if (!isCurrent()) return;
    try {
      const state = binding.snapshot();
      if (!isCurrent()) return;
      const {min, max} = range(state);
      const rect = canvas.getBoundingClientRect();
      const plotLeft = 38;
      const plotWidth = Math.max(1, rect.width - plotLeft - 10);
      setProbe(frequencyAt(event.clientX - rect.left - plotLeft, plotWidth, min, max));
    } catch (error) { report(error); }
  };
  const onKey = (event: KeyboardEvent): void => {
    if (!isCurrent()) return;
    try {
      const {min, max} = range(binding.snapshot());
      if (!isCurrent()) return;
      const step = event.shiftKey ? 2 : Math.pow(2, 1 / 12);
      let next: number | undefined;
      if (event.key === 'ArrowRight' || event.key === 'ArrowUp') next = selectedFrequency * step;
      else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') next = selectedFrequency / step;
      else if (event.key === 'Home') next = min;
      else if (event.key === 'End') next = max;
      if (next === undefined) return;
      event.preventDefault();
      setProbe(next);
    } catch (error) { report(error); }
  };
  const onFreeze = (): void => {
    try { binding.setFrozen(!binding.snapshot().frozen); update(); } catch (error) { report(error); }
  };
  const onPeak = (): void => {
    try { binding.setPeakHold(!binding.snapshot().peakHold); update(); } catch (error) { report(error); }
  };
  freeze.addEventListener('click', onFreeze);
  peak.addEventListener('click', onPeak);
  reset.addEventListener('click', resetPeaks);
  canvas.addEventListener('pointerdown', onPointer);
  canvas.addEventListener('pointermove', onPointer);
  canvas.addEventListener('keydown', onKey);

  const handle: SpectrumAnalyzerHandle = {
    element: root,
    get selectedFrequency() { return selectedFrequency; },
    update,
    resetPeaks,
    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      try { unsubscribe?.(); } catch (error) { report(error); }
      observer?.disconnect();
      freeze.removeEventListener('click', onFreeze);
      peak.removeEventListener('click', onPeak);
      reset.removeEventListener('click', resetPeaks);
      canvas.removeEventListener('pointerdown', onPointer);
      canvas.removeEventListener('pointermove', onPointer);
      canvas.removeEventListener('keydown', onKey);
      claim.release();
      root.remove();
      style?.remove();
    },
  };
  const claim = claimHost(mounted, host, handle);
  claim.destroyPrevious();
  if (!isCurrent()) return handle;
  host.append(...(style ? [style] : []), root);
  if (!isCurrent()) return handle;
  update();
  if (!isCurrent()) return handle;
  if (view?.ResizeObserver) {
    try {
      const nextObserver = new view.ResizeObserver(update);
      if (!isCurrent()) nextObserver.disconnect();
      else {
        observer = nextObserver;
        nextObserver.observe(root);
      }
    }
    catch (error) { report(error); }
  }
  if (isCurrent() && binding.subscribe) {
    try {
      const cleanup = binding.subscribe(update);
      if (isCurrent()) unsubscribe = cleanup;
      else cleanup();
    }
    catch (error) { report(error); }
  }
  return handle;
}
