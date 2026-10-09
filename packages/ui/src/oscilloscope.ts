import {mountStatus, statusStyle, type StatusState} from './status';
import {claimHost, createErrorSink} from './internal/lifecycle';
import {installStyle} from './internal/style';

export type OscilloscopeTriggerEdge = 'off' | 'rising' | 'falling';

/** A sampled, trigger-aligned time-domain window. The caller owns its signal. */
export interface OscilloscopeTrace {
  samples: ArrayLike<number>;
  timebaseMs: number;
  triggered: boolean;
  silent: boolean;
}

export interface OscilloscopeState {
  trace?: OscilloscopeTrace;
  availableTimeMs: number;
  timebaseMs: number;
  triggerLevel: number;
  triggerEdge: OscilloscopeTriggerEdge;
  frozen: boolean;
  status: 'loading' | 'waiting' | 'live' | 'paused' | 'unavailable' | 'frozen';
}

export interface OscilloscopeBinding {
  snapshot(): OscilloscopeState;
  setFrozen(value: boolean): void;
  setTimebaseMs(value: number): void;
  setTriggerLevel(value: number): void;
  setTriggerEdge(value: OscilloscopeTriggerEdge): void;
  probe?(timeMs: number, amplitude: number | undefined): void;
  subscribe?(notify: () => void): () => void;
}

export interface OscilloscopeOptions {
  label?: string;
  onError?: (error: unknown) => void;
  stylesheet?: boolean;
}

export interface OscilloscopeHandle {
  element: HTMLElement;
  readonly selectedTimeMs: number;
  update(): void;
  destroy(): void;
}

type OscilloscopeHost = HTMLElement | ShadowRoot;
const mounted = new WeakMap<OscilloscopeHost, OscilloscopeHandle>();

export const oscilloscopeStyle = String.raw`${statusStyle}
.wui-oscilloscope, .wui-oscilloscope * { box-sizing: border-box; }
.wui-oscilloscope { display: grid; gap: .55rem; width: 100%; min-width: 0;
  color: var(--wm-oscilloscope-foreground, var(--wm-foreground, #263138));
  font: 400 .78rem/1.4 var(--wm-font-family, system-ui, sans-serif); }
.wui-oscilloscope__head, .wui-oscilloscope__controls { display: flex; align-items: center; flex-wrap: wrap; gap: .45rem .8rem; min-width: 0; }
.wui-oscilloscope__title { font-size: .8rem; font-weight: 700; text-transform: uppercase; }
.wui-oscilloscope__readout { margin-inline-start: auto; color: var(--wm-oscilloscope-muted, #536167);
  font: 600 .75rem/1.4 var(--wm-font-mono, ui-monospace, monospace); font-variant-numeric: tabular-nums; }
.wui-oscilloscope__plot { display: block; width: 100%; height: var(--wm-oscilloscope-height, 11rem); min-height: 7rem;
  border: 0; background: var(--wm-oscilloscope-plot-background, #17252a); cursor: crosshair; touch-action: none; }
.wui-oscilloscope__control { display: inline-flex; align-items: center; gap: .35rem; min-width: 0; }
.wui-oscilloscope__range { width: clamp(5rem, 16vw, 8rem); accent-color: var(--wm-oscilloscope-accent, #258a80); }
.wui-oscilloscope__value { min-width: 4.5ch; text-align: right; font: 600 .74rem/1.4 var(--wm-font-mono, ui-monospace, monospace); }
.wui-oscilloscope__select, .wui-oscilloscope__button { min-height: 2rem; color: inherit;
  border: 1px solid var(--wm-oscilloscope-border, var(--wm-border, #a8b4b8)); border-radius: var(--wm-control-radius, 0);
  background: var(--wm-oscilloscope-control-background, var(--wm-surface, #fff)); font: inherit; }
.wui-oscilloscope__select { padding: .2rem .35rem; }
.wui-oscilloscope__button { padding: .25rem .6rem; cursor: pointer; }
.wui-oscilloscope__button[aria-pressed='true'] { background: var(--wm-oscilloscope-selected-background, #d9eeeb);
  border-color: var(--wm-oscilloscope-selected-border, #258e83); }
.wui-oscilloscope__button:disabled { opacity: .5; cursor: default; }
.wui-oscilloscope__status { min-height: 1.1rem; color: var(--wm-oscilloscope-muted, #536167); }
.wui-oscilloscope__plot:focus-visible, .wui-oscilloscope__select:focus-visible,
.wui-oscilloscope__range:focus-visible, .wui-oscilloscope__button:focus-visible {
  outline: 2px solid var(--wm-focus, Highlight); outline-offset: 2px; }
@media (max-width: 440px) { .wui-oscilloscope__readout { margin-inline-start: 0; width: 100%; } }
@media (forced-colors: active) { .wui-oscilloscope__plot { border: 1px solid CanvasText; background: Canvas; }
  .wui-oscilloscope__button[aria-pressed='true'] { border-color: Highlight; } }
`;

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

function amplitudeAt(trace: OscilloscopeTrace | undefined, timeMs: number): number | undefined {
  if (!trace || trace.samples.length === 0 || trace.timebaseMs <= 0) return undefined;
  const index = clamp(Math.round(timeMs / trace.timebaseMs * (trace.samples.length - 1)), 0, trace.samples.length - 1);
  const value = trace.samples[index];
  return Number.isFinite(value) ? value : undefined;
}

/** Mount an inspectable current-signal scope. Signal acquisition stays with the caller. */
export function mountOscilloscope(
  host: OscilloscopeHost,
  binding: OscilloscopeBinding,
  options: OscilloscopeOptions = {},
): OscilloscopeHandle {
  const document = host.ownerDocument;
  const view = document.defaultView;
  const report = createErrorSink(options.onError);
  const style = installStyle(document, 'oscilloscope', oscilloscopeStyle, options.stylesheet);
  const root = document.createElement('div');
  root.className = 'wui-oscilloscope';
  root.setAttribute('role', 'group');
  root.setAttribute('aria-label', options.label ?? 'Oscilloscope');
  root.setAttribute('part', 'root surface');

  const head = document.createElement('div');
  head.className = 'wui-oscilloscope__head';
  head.setAttribute('part', 'header');
  const title = document.createElement('strong');
  title.className = 'wui-oscilloscope__title';
  title.textContent = 'Oscilloscope';
  const readout = document.createElement('output');
  readout.className = 'wui-oscilloscope__readout';
  readout.setAttribute('part', 'readout');
  head.append(title, readout);

  const canvas = document.createElement('canvas');
  canvas.className = 'wui-oscilloscope__plot';
  canvas.setAttribute('part', 'plot');
  canvas.setAttribute('role', 'slider');
  canvas.setAttribute('aria-label', 'Inspect waveform time');
  canvas.tabIndex = 0;

  const controls = document.createElement('div');
  controls.className = 'wui-oscilloscope__controls';
  controls.setAttribute('part', 'controls');
  const freeze = document.createElement('button');
  freeze.className = 'wui-oscilloscope__button';
  freeze.type = 'button';
  freeze.textContent = 'Freeze';
  freeze.setAttribute('part', 'freeze');

  function rangeControl(label: string, part: string): {container: HTMLLabelElement; input: HTMLInputElement; value: HTMLOutputElement} {
    const container = document.createElement('label');
    container.className = 'wui-oscilloscope__control';
    container.textContent = label;
    const input = document.createElement('input');
    input.className = 'wui-oscilloscope__range';
    input.type = 'range';
    input.setAttribute('part', part);
    const value = document.createElement('output');
    value.className = 'wui-oscilloscope__value';
    container.append(input, value);
    return {container, input, value};
  }
  const timebase = rangeControl('Timebase', 'timebase');
  const trigger = rangeControl('Trigger', 'trigger-level');
  trigger.input.min = '-1';
  trigger.input.max = '1';
  trigger.input.step = '0.05';
  const edgeLabel = document.createElement('label');
  edgeLabel.className = 'wui-oscilloscope__control';
  edgeLabel.textContent = 'Edge';
  const edge = document.createElement('select');
  edge.className = 'wui-oscilloscope__select';
  edge.setAttribute('part', 'trigger-edge');
  for (const [value, label] of [['rising', 'Rising'], ['falling', 'Falling'], ['off', 'Off']] as const) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    edge.append(option);
  }
  edgeLabel.append(edge);
  controls.append(freeze, timebase.container, trigger.container, edgeLabel);
  const status = document.createElement('div');
  status.className = 'wui-oscilloscope__status';
  status.setAttribute('part', 'status');
  const statusMessage = document.createElement('span');
  statusMessage.setAttribute('role', 'status');
  const waitingHost = document.createElement('div');
  let feedback: StatusState = {kind: 'ready'};
  const waiting = mountStatus(waitingHost, {snapshot: () => feedback}, {
    stylesheet: false, classNames: {root: 'wui-status--embedded'},
  });
  status.append(statusMessage, waitingHost);
  root.append(head, canvas, controls, status);

  let destroyed = false;
  let unsubscribe: (() => void) | undefined;
  let observer: ResizeObserver | undefined;
  let selectedTimeMs = 0;
  const isCurrent = (): boolean => !destroyed && claim.isCurrent();

  const draw = (state: OscilloscopeState, windowMs: number): void => {
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
    context.fillStyle = '#17252a';
    context.fillRect(0, 0, width, height);
    const left = 38;
    const top = 12;
    const plotWidth = Math.max(1, width - left - 12);
    const plotHeight = Math.max(1, height - top - 26);
    const xAt = (fraction: number) => left + fraction * plotWidth;
    const yAt = (amplitude: number) => top + (1 - clamp(amplitude, -1, 1)) * plotHeight / 2;
    context.lineWidth = 1;
    context.strokeStyle = '#40565c';
    context.fillStyle = '#bbcccb';
    context.font = '10px ui-monospace, monospace';
    for (const amplitude of [1, .5, 0, -.5, -1]) {
      const y = yAt(amplitude);
      context.beginPath();
      context.moveTo(left, y + .5);
      context.lineTo(left + plotWidth, y + .5);
      context.stroke();
      if (amplitude === 1 || amplitude === 0 || amplitude === -1) {
        context.fillText(amplitude > 0 ? `+${amplitude}` : String(amplitude), 8, y + 3);
      }
    }
    for (let division = 0; division <= 4; division += 1) {
      const x = xAt(division / 4);
      context.beginPath();
      context.moveTo(x + .5, top);
      context.lineTo(x + .5, top + plotHeight);
      context.stroke();
      if (division % 2 === 0) context.fillText(`${(windowMs * division / 4).toFixed(1)}`, x + 2, height - 7);
    }
    if (state.triggerEdge !== 'off') {
      const y = yAt(state.triggerLevel);
      context.strokeStyle = '#edb45e';
      context.setLineDash([4, 3]);
      context.beginPath();
      context.moveTo(left, y);
      context.lineTo(left + plotWidth, y);
      context.stroke();
      context.setLineDash([]);
    }
    const samples = state.trace?.samples;
    if (samples && samples.length > 0) {
      context.strokeStyle = '#63d9c2';
      context.lineWidth = 1.5;
      context.beginPath();
      for (let index = 0; index < samples.length; index += 1) {
        const x = xAt(index / Math.max(1, samples.length - 1));
        const y = yAt(samples[index]!);
        if (index === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      }
      context.stroke();
    }
    context.strokeStyle = '#f1f6ed';
    context.setLineDash([3, 3]);
    context.beginPath();
    const cursorX = xAt(selectedTimeMs / Math.max(0.001, windowMs));
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
      const available = Number.isFinite(state.availableTimeMs) && state.availableTimeMs > 0 ? state.availableTimeMs : 100;
      const windowMs = state.trace?.timebaseMs ?? clamp(state.timebaseMs, Math.min(1, available), available);
      selectedTimeMs = clamp(selectedTimeMs, 0, windowMs);
      freeze.setAttribute('aria-pressed', String(state.frozen));
      freeze.textContent = state.frozen ? 'Unfreeze' : 'Freeze';
      freeze.disabled = !state.frozen && !state.trace;
      timebase.input.min = String(Math.min(1, available));
      timebase.input.max = String(available);
      timebase.input.step = '0.5';
      timebase.input.value = String(windowMs);
      timebase.value.textContent = `${windowMs.toFixed(1)} ms`;
      trigger.input.value = String(state.triggerLevel);
      trigger.value.textContent = state.triggerLevel.toFixed(2);
      edge.value = state.triggerEdge;
      canvas.setAttribute('aria-valuemin', '0');
      canvas.setAttribute('aria-valuemax', windowMs.toFixed(2));
      canvas.setAttribute('aria-valuenow', selectedTimeMs.toFixed(2));
      const amplitude = amplitudeAt(state.trace, selectedTimeMs);
      const valueText = `${selectedTimeMs.toFixed(2)} ms${amplitude === undefined ? '' : `, ${amplitude >= 0 ? '+' : ''}${amplitude.toFixed(2)} amplitude`}`;
      canvas.setAttribute('aria-valuetext', valueText);
      readout.textContent = valueText;
      const statusText = state.status === 'live'
        ? state.trace?.silent ? 'No signal' : state.triggerEdge === 'off' ? 'Live, free run' : state.trace?.triggered ? 'Live, triggered' : 'Live, no matching edge'
        : ({loading: 'Loading audio', waiting: 'Waiting for playback', paused: 'Playback paused', unavailable: 'Analyser unavailable', frozen: 'Waveform frozen'} as const)[state.status];
      const isWaiting = state.status === 'waiting' || state.status === 'loading';
      statusMessage.textContent = isWaiting ? '' : statusText;
      statusMessage.hidden = isWaiting;
      feedback = {kind: state.status === 'loading' ? 'loading' : isWaiting ? 'waiting' : 'ready', message: isWaiting ? statusText : ''};
      waiting.update();
      root.dataset.state = state.status;
      draw(state, windowMs);
    } catch (error) { report(error); }
  };

  const setProbe = (timeMs: number): void => {
    if (!isCurrent()) return;
    try {
      const state = binding.snapshot();
      if (!isCurrent()) return;
      const windowMs = state.trace?.timebaseMs ?? Math.max(.001, state.timebaseMs);
      const next = clamp(timeMs, 0, windowMs);
      if (next === selectedTimeMs) return;
      selectedTimeMs = next;
      update();
      if (isCurrent()) binding.probe?.(next, amplitudeAt(state.trace, next));
    } catch (error) { report(error); }
  };
  const onPointer = (event: PointerEvent): void => {
    if (!isCurrent()) return;
    try {
      const state = binding.snapshot();
      if (!isCurrent()) return;
      const windowMs = state.trace?.timebaseMs ?? Math.max(.001, state.timebaseMs);
      const rect = canvas.getBoundingClientRect();
      setProbe(clamp((event.clientX - rect.left - 38) / Math.max(1, rect.width - 50), 0, 1) * windowMs);
    } catch (error) { report(error); }
  };
  const onKey = (event: KeyboardEvent): void => {
    if (!isCurrent()) return;
    try {
      const state = binding.snapshot();
      if (!isCurrent()) return;
      const windowMs = state.trace?.timebaseMs ?? Math.max(.001, state.timebaseMs);
      const step = windowMs / (event.shiftKey ? 10 : 100);
      let next: number | undefined;
      if (event.key === 'ArrowRight' || event.key === 'ArrowUp') next = selectedTimeMs + step;
      else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') next = selectedTimeMs - step;
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = windowMs;
      if (next === undefined) return;
      event.preventDefault();
      setProbe(next);
    } catch (error) { report(error); }
  };
  const onFreeze = (): void => {
    try { binding.setFrozen(!binding.snapshot().frozen); update(); } catch (error) { report(error); }
  };
  const onTimebase = (): void => {
    try { binding.setTimebaseMs(Number(timebase.input.value)); update(); } catch (error) { report(error); }
  };
  const onTrigger = (): void => {
    try { binding.setTriggerLevel(Number(trigger.input.value)); update(); } catch (error) { report(error); }
  };
  const onEdge = (): void => {
    try { binding.setTriggerEdge(edge.value as OscilloscopeTriggerEdge); update(); } catch (error) { report(error); }
  };
  freeze.addEventListener('click', onFreeze);
  timebase.input.addEventListener('input', onTimebase);
  trigger.input.addEventListener('input', onTrigger);
  edge.addEventListener('change', onEdge);
  canvas.addEventListener('pointerdown', onPointer);
  canvas.addEventListener('pointermove', onPointer);
  canvas.addEventListener('keydown', onKey);

  const handle: OscilloscopeHandle = {
    element: root,
    get selectedTimeMs() { return selectedTimeMs; },
    update,
    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      try { unsubscribe?.(); } catch (error) { report(error); }
      observer?.disconnect();
      freeze.removeEventListener('click', onFreeze);
      timebase.input.removeEventListener('input', onTimebase);
      trigger.input.removeEventListener('input', onTrigger);
      edge.removeEventListener('change', onEdge);
      canvas.removeEventListener('pointerdown', onPointer);
      canvas.removeEventListener('pointermove', onPointer);
      canvas.removeEventListener('keydown', onKey);
      claim.release();
      waiting.destroy();
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
