import {mountStatus, statusStyle, type StatusState} from './status';
import {claimHost, createErrorSink} from './internal/lifecycle';
import {installStyle} from './internal/style';
import {
  analysisControlStyle, analysisLine, analysisMono, analysisMuted, createAnalysisFader, setAnalysisStatusRegion,
} from './internal/analysis-controls';
import {ICON_PATHS, setIconButton} from './internal/icons';
import {neutralColor} from './internal/palette';
import {canvasInk} from './internal/canvas-ink';

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
${analysisControlStyle}
:where(.wui-oscilloscope, .wui-oscilloscope *) { box-sizing: border-box; }
:where(.wui-oscilloscope) { display: grid; gap: .4rem; width: 100%; min-width: 0;
  --wui-oscilloscope-fader-fill: var(--wm-fader-fill, var(--wm-accent, ${neutralColor('muted')}));
  color: var(--wm-oscilloscope-foreground, var(--wm-foreground, ${neutralColor('foreground')}));
  font: 400 .78rem/1.4 var(--wm-font-family, system-ui, sans-serif); }
:where(.wui-oscilloscope__head) { min-width: 0; }
:where(.wui-oscilloscope__readout) { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: .65rem; margin: 0;
  color: var(--wm-oscilloscope-muted, ${analysisMuted}); font-variant-numeric: tabular-nums; }
:where(.wui-oscilloscope__readout > div) { display: flex; gap: .4rem; align-items: baseline; min-width: 0; }
:where(.wui-oscilloscope__readout dt) { font: 400 .625rem/1.4 ${analysisMono}; text-transform: uppercase; letter-spacing: .06em; }
:where(.wui-oscilloscope__readout dd) { margin: 0; min-width: 0; color: var(--wm-oscilloscope-foreground, var(--wm-foreground, ${neutralColor('foreground')}));
  font: 400 .75rem/1.4 ${analysisMono}; }
:where(.wui-oscilloscope__plot) { display: block; width: 100%; height: var(--wm-oscilloscope-height, 11rem); min-height: 7rem;
  border: 0; background: var(--wm-oscilloscope-plot-background, var(--wm-surface-muted, light-dark(#f3f3f3, #1c1c1c))); cursor: crosshair; touch-action: none; }
:where(.wui-oscilloscope .wui-analysis-fader) { --wm-fader-fill: var(--wm-oscilloscope-accent, var(--wui-oscilloscope-fader-fill)); }
:where(.wui-oscilloscope__controls) { border-color: var(--wm-oscilloscope-border, ${analysisLine}); }
:where(.wui-oscilloscope__controls > * + *) { border-left-color: var(--wm-oscilloscope-border, ${analysisLine}); }
:where(.wui-oscilloscope__button[aria-pressed='true']) { background: var(--wm-oscilloscope-selected-background, var(--wm-foreground, ${neutralColor('foreground')})); }
:where(.wui-oscilloscope__edge > button + button) { border-left: 1px solid var(--wm-oscilloscope-border, ${analysisLine}); }
:where(.wui-oscilloscope__status) { color: var(--wm-oscilloscope-muted, ${analysisMuted}); }
:where(.wui-oscilloscope__plot:focus-visible) {
  outline: var(--wm-focus-ring, 2px solid var(--wm-foreground, ${neutralColor('foreground')})); outline-offset: -2px; }
@media (max-width: 440px) { :where(.wui-oscilloscope__readout > div) { flex-direction: column; gap: .1rem; } }
@media (forced-colors: active) { :where(.wui-oscilloscope__plot) { border: 1px solid CanvasText; background: Canvas; }
  :where(.wui-oscilloscope__button[aria-pressed='true']) { background: Highlight; color: HighlightText; } }
`;

/** Trigger choices in display order; `off` free-runs without an edge. */
const EDGES = [
  ['rising', 'Rising edge', ICON_PATHS.rising],
  ['falling', 'Falling edge', ICON_PATHS.falling],
  // Private shape: an untriggered, free-running wave.
  ['off', 'Trigger off', '<path d="M3 12c3-6 6-6 9 0s6 6 9 0"/>'],
] as const;

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
  const readout = document.createElement('dl');
  readout.className = 'wui-oscilloscope__readout';
  readout.setAttribute('part', 'readout');
  function readoutField(label: string): HTMLOutputElement {
    const field = document.createElement('div');
    const term = document.createElement('dt');
    term.textContent = label;
    const detail = document.createElement('dd');
    const value = document.createElement('output');
    value.setAttribute('aria-live', 'off');
    detail.append(value);
    field.append(term, detail);
    readout.append(field);
    return value;
  }
  const timeValue = readoutField('Time');
  const amplitudeValue = readoutField('Amplitude');
  head.append(readout);

  const canvas = document.createElement('canvas');
  canvas.className = 'wui-oscilloscope__plot';
  canvas.setAttribute('part', 'plot');
  canvas.setAttribute('role', 'slider');
  canvas.setAttribute('aria-label', 'Inspect waveform time');
  canvas.tabIndex = 0;

  const controls = document.createElement('div');
  controls.className = 'wui-oscilloscope__controls wui-analysis-row';
  controls.setAttribute('part', 'controls');
  const freezeGroup = document.createElement('div');
  freezeGroup.className = 'wui-analysis-group';
  const freeze = document.createElement('button');
  freeze.className = 'wui-oscilloscope__button wui-analysis-button';
  freeze.type = 'button';
  setIconButton(freeze, ICON_PATHS.freeze, 'Freeze');
  freeze.setAttribute('part', 'freeze');
  freezeGroup.append(freeze);

  const timebase = createAnalysisFader(document, {
    label: 'Timebase', part: 'timebase', min: 1, max: 100, step: .5, value: 10,
    formatValue: (value) => `${value.toFixed(1)} ms`,
    onInput: (value) => {
      if (!isCurrent()) return;
      try { binding.setTimebaseMs(value); update(); } catch (error) { report(error); }
    }, onError: report,
  });
  const trigger = createAnalysisFader(document, {
    label: 'Trigger', part: 'trigger-level', min: -1, max: 1, step: .05, value: 0,
    formatValue: (value) => value.toFixed(2),
    onInput: (value) => {
      if (!isCurrent()) return;
      try { binding.setTriggerLevel(value); update(); } catch (error) { report(error); }
    }, onError: report,
  });
  // A hairline segmented group of square cells; the current edge is inverted.
  const edge = document.createElement('div');
  edge.className = 'wui-oscilloscope__edge wui-analysis-group';
  edge.setAttribute('part', 'trigger-edge');
  edge.setAttribute('role', 'group');
  edge.setAttribute('aria-label', 'Trigger edge');
  const edgeButtons = EDGES.map(([value, label, icon]) => {
    const button = document.createElement('button');
    button.className = 'wui-oscilloscope__button wui-analysis-button';
    button.type = 'button';
    button.dataset.value = value;
    setIconButton(button, icon, label);
    button.setAttribute('aria-pressed', 'false');
    edge.append(button);
    return button;
  });
  controls.append(freezeGroup, timebase.element, trigger.element, edge);
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
  let scheme: MediaQueryList | undefined;
  let pointerFrame = 0;
  let pendingFraction: number | undefined;
  // Layout and resolved ink, read only on mount, resize or a colour-scheme
  // change and always before this frame's DOM writes, never after them.
  let metrics: {width: number; height: number; ink: string; muted: string} | undefined;
  const isCurrent = (): boolean => !destroyed && claim.isCurrent();
  const measure = (): NonNullable<typeof metrics> => metrics ??= {
    width: Math.max(1, Math.round(canvas.clientWidth || root.clientWidth || 360)),
    height: Math.max(1, Math.round(canvas.clientHeight || 176)),
    // Leave the CSS background visible, including caller-provided plot colors.
    ink: canvasInk(root, '#444'),
    muted: canvasInk(readout, '#666'),
  };

  const draw = (state: OscilloscopeState, windowMs: number, {width, height, ink, muted}: NonNullable<typeof metrics>): void => {
    const context = canvas.getContext('2d');
    if (!context) return;
    const ratio = Math.max(1, view?.devicePixelRatio || 1);
    const pixelWidth = Math.max(1, Math.round(width * ratio));
    const pixelHeight = Math.max(1, Math.round(height * ratio));
    if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
    if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);
    const left = 38;
    const top = 12;
    const plotWidth = Math.max(1, width - left - 12);
    const plotHeight = Math.max(1, height - top - 26);
    const xAt = (fraction: number) => left + fraction * plotWidth;
    const yAt = (amplitude: number) => top + (1 - clamp(amplitude, -1, 1)) * plotHeight / 2;
    context.lineWidth = 1;
    context.strokeStyle = muted;
    context.fillStyle = muted;
    context.font = '10px ui-monospace, monospace';
    for (const amplitude of [1, .5, 0, -.5, -1]) {
      const y = yAt(amplitude);
      context.beginPath();
      context.moveTo(left, y + .5);
      context.lineTo(left + plotWidth, y + .5);
      context.globalAlpha = .25;
      context.stroke();
      context.globalAlpha = 1;
      if (amplitude === 1 || amplitude === 0 || amplitude === -1) {
        context.fillText(amplitude > 0 ? `+${amplitude}` : String(amplitude), 8, y + 3);
      }
    }
    for (let division = 0; division <= 4; division += 1) {
      const x = xAt(division / 4);
      context.beginPath();
      context.moveTo(x + .5, top);
      context.lineTo(x + .5, top + plotHeight);
      context.globalAlpha = .25;
      context.stroke();
      context.globalAlpha = 1;
      if (division % 2 === 0) {
        context.textAlign = division === 4 ? 'right' : 'left';
        context.fillText(`${(windowMs * division / 4).toFixed(1)}`, x + (division === 4 ? -2 : 2), height - 7);
        context.textAlign = 'left';
      }
    }
    if (state.triggerEdge !== 'off') {
      const y = yAt(state.triggerLevel);
      context.strokeStyle = muted;
      context.setLineDash([4, 3]);
      context.beginPath();
      context.moveTo(left, y);
      context.lineTo(left + plotWidth, y);
      context.stroke();
      context.setLineDash([]);
    }
    const samples = state.trace?.samples;
    if (samples && samples.length > 0) {
      context.strokeStyle = ink;
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
    context.strokeStyle = ink;
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
      const size = measure();
      const available = Number.isFinite(state.availableTimeMs) && state.availableTimeMs > 0 ? state.availableTimeMs : 100;
      const windowMs = state.trace?.timebaseMs ?? clamp(state.timebaseMs, Math.min(1, available), available);
      selectedTimeMs = clamp(selectedTimeMs, 0, windowMs);
      freeze.setAttribute('aria-pressed', String(state.frozen));
      freeze.disabled = !state.frozen && !state.trace;
      timebase.paint(windowMs, {min: Math.min(1, available), max: available});
      trigger.paint(state.triggerLevel);
      edge.dataset.value = state.triggerEdge;
      for (const button of edgeButtons) button.setAttribute('aria-pressed', String(button.dataset.value === state.triggerEdge));
      canvas.setAttribute('aria-valuemin', '0');
      canvas.setAttribute('aria-valuemax', windowMs.toFixed(2));
      canvas.setAttribute('aria-valuenow', selectedTimeMs.toFixed(2));
      const amplitude = amplitudeAt(state.trace, selectedTimeMs);
      const valueText = `${selectedTimeMs.toFixed(2)} ms${amplitude === undefined ? '' : `, ${amplitude >= 0 ? '+' : ''}${amplitude.toFixed(2)} amplitude`}`;
      canvas.setAttribute('aria-valuetext', valueText);
      timeValue.textContent = `${selectedTimeMs.toFixed(2)} ms`;
      amplitudeValue.textContent = amplitude === undefined ? '—' : `${amplitude >= 0 ? '+' : ''}${amplitude.toFixed(2)}`;
      const statusText = state.status === 'live'
        ? state.trace?.silent ? 'No signal' : state.triggerEdge !== 'off' && !state.trace?.triggered ? 'No matching edge' : ''
        : ({loading: 'Loading audio', waiting: 'Waiting for playback', paused: '', unavailable: 'Analyser unavailable', frozen: ''} as const)[state.status];
      const pending = state.status === 'waiting' || state.status === 'loading';
      setAnalysisStatusRegion(status, statusMessage, statusText, pending);
      feedback = {kind: state.status === 'loading' ? 'loading' : pending ? 'waiting' : 'ready', message: pending ? statusText : ''};
      waiting.update();
      root.dataset.state = state.status;
      draw(state, windowMs, size);
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
  const pointerFraction = (event: PointerEvent): number => {
    const rect = canvas.getBoundingClientRect();
    return clamp((event.clientX - rect.left - 38) / Math.max(1, rect.width - 50), 0, 1);
  };
  const probeFraction = (fraction: number): void => {
    if (!isCurrent()) return;
    try {
      const state = binding.snapshot();
      if (!isCurrent()) return;
      const windowMs = state.trace?.timebaseMs ?? Math.max(.001, state.timebaseMs);
      setProbe(fraction * windowMs);
    } catch (error) { report(error); }
  };
  const cancelPointerFrame = (): void => {
    if (pointerFrame) view?.cancelAnimationFrame?.(pointerFrame);
    pointerFrame = 0;
    pendingFraction = undefined;
  };
  const flushPointer = (): void => {
    pointerFrame = 0;
    const fraction = pendingFraction;
    pendingFraction = undefined;
    if (fraction !== undefined) probeFraction(fraction);
  };
  const onPointerDown = (event: PointerEvent): void => {
    if (!isCurrent()) return;
    cancelPointerFrame();
    try { probeFraction(pointerFraction(event)); } catch (error) { report(error); }
  };
  // Hover can fire several times per frame; apply only the latest position, once per frame.
  const onPointerMove = (event: PointerEvent): void => {
    if (!isCurrent()) return;
    try { pendingFraction = pointerFraction(event); } catch (error) { report(error); return; }
    if (pointerFrame) return;
    if (view?.requestAnimationFrame) pointerFrame = view.requestAnimationFrame(flushPointer);
    else flushPointer();
  };
  const remeasure = (): void => {
    metrics = undefined;
    update();
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
  const onEdge = (event: MouseEvent): void => {
    const button = (event.target as Element | null)?.closest?.('button');
    const value = button && edge.contains(button) ? button.dataset.value as OscilloscopeTriggerEdge | undefined : undefined;
    if (!value || !isCurrent()) return;
    try { binding.setTriggerEdge(value); update(); } catch (error) { report(error); }
  };
  freeze.addEventListener('click', onFreeze);
  edge.addEventListener('click', onEdge);
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
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
      scheme?.removeEventListener?.('change', remeasure);
      cancelPointerFrame();
      freeze.removeEventListener('click', onFreeze);
      timebase.destroy();
      trigger.destroy();
      edge.removeEventListener('click', onEdge);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
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
      const nextObserver = new view.ResizeObserver(remeasure);
      if (!isCurrent()) nextObserver.disconnect();
      else {
        observer = nextObserver;
        nextObserver.observe(root);
      }
    }
    catch (error) { report(error); }
  }
  if (isCurrent() && view?.matchMedia) {
    try {
      scheme = view.matchMedia('(prefers-color-scheme: dark)');
      scheme.addEventListener?.('change', remeasure);
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
