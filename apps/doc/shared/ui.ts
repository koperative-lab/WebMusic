/**
 * WebMusic docs UI kit — behaviour for the controls that need markup and
 * wiring, not just a class. Pairs with ./ui.css.
 *
 * The knob geometry mirrors
 * packages/score/src/play/element/internal/knob.ts. That module is package
 * internal, so the documentation layer keeps the same public geometry here
 * until the primitives move into the publishable UI package. Keep the values
 * in sync when either implementation changes.
 */

const KNOB_CX = 20;
const KNOB_CY = 20;
const KNOB_R = 16;
const KNOB_STROKE = 5;
/** The pointer reaches the outer edge of the arc band. */
const KNOB_PTR_R = KNOB_R + KNOB_STROKE / 2;
const KNOB_A0 = -135;
const KNOB_A1 = 135;

export const KNOB_GEOMETRY = Object.freeze({
  cx: KNOB_CX,
  cy: KNOB_CY,
  r: KNOB_R,
  stroke: KNOB_STROKE,
  pointerR: KNOB_PTR_R,
  a0: KNOB_A0,
  a1: KNOB_A1,
});

function polar(r: number, deg: number): [number, number] {
  const a = (deg * Math.PI) / 180;
  return [KNOB_CX + r * Math.sin(a), KNOB_CY - r * Math.cos(a)];
}

export function knobArcPath(r: number, startDeg: number, endDeg: number): string {
  const [x1, y1] = polar(r, startDeg);
  const [x2, y2] = polar(r, endDeg);
  const large = Math.abs(endDeg - startDeg) > 180 ? 1 : 0;
  return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

function svgEl<K extends keyof SVGElementTagNameMap>(
  name: K,
  attrs: Record<string, string>,
): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

/** Paint a knob's active arc and pointer for a fraction 0..1. */
export function drawKnob(arc: SVGPathElement, ptr: SVGLineElement, fraction: number): void {
  const f = Math.max(0, Math.min(1, fraction));
  const angle = KNOB_A0 + f * (KNOB_A1 - KNOB_A0);
  arc.setAttribute('d', f > 0 ? knobArcPath(KNOB_R, KNOB_A0, angle) : '');
  const [px, py] = polar(KNOB_PTR_R, angle);
  ptr.setAttribute('x2', px.toFixed(2));
  ptr.setAttribute('y2', py.toFixed(2));
}

export interface ControlSpec {
  name: string;
  min: number;
  max: number;
  step?: number;
  value: number;
  unit?: string;
  disabled?: boolean;
  options?: readonly string[];
  /** Renders the readout. Defaults to two decimals. */
  format?: (value: number) => string;
  onInput?: (value: number) => void;
}

export interface MountedControl<T extends HTMLInputElement = HTMLInputElement> {
  element: HTMLElement;
  input: T;
  setValue(value: number): void;
  update(patch: Partial<ControlSpec>): void;
  destroy(): void;
}

const fixed2 = (v: number) => v.toFixed(2);

export function valueToFraction(value: number, min = 0, max = 1): number {
  if (!Number.isFinite(value) || !Number.isFinite(min) || !Number.isFinite(max) || max === min) return 0;
  return Math.max(0, Math.min(1, (value - min) / (max - min)));
}

const fraction = (input: HTMLInputElement): number =>
  valueToFraction(Number(input.value), Number(input.min), Number(input.max));

/**
 * Build a rotary knob into `host` and return its input. The range input is the
 * real control — it is only visually hidden — so the knob stays keyboard
 * operable and announces itself to assistive tech.
 */
export function mountKnobControl(host: HTMLElement, spec: ControlSpec): MountedControl {
  let current = {...spec};
  let format = current.format ?? fixed2;
  host.replaceChildren();
  host.classList.add('doc-knob');
  host.dataset.wuiMounted = 'knob';

  const name = document.createElement('span');
  name.className = 'doc-knob__name';
  name.textContent = current.name;

  const dial = document.createElement('span');
  dial.className = 'doc-knob__dial';

  const svg = svgEl('svg', { viewBox: '0 0 40 40', 'aria-hidden': 'true' });
  const track = svgEl('path', { class: 'track', fill: 'none', d: knobArcPath(KNOB_R, KNOB_A0, KNOB_A1) });
  const arc = svgEl('path', { class: 'arc', fill: 'none' });
  const ptr = svgEl('line', { class: 'ptr', x1: String(KNOB_CX), y1: String(KNOB_CY), x2: String(KNOB_CX), y2: String(KNOB_CY) });
  svg.append(track, arc, ptr);

  const input = document.createElement('input');
  input.type = 'range';
  input.min = String(current.options?.length ? 0 : current.min);
  input.max = String(current.options?.length ? current.options.length - 1 : current.max);
  input.step = String(current.options?.length ? 1 : current.step ?? 0.01);
  input.value = String(current.value);
  input.disabled = current.disabled ?? false;
  input.setAttribute('aria-label', current.name);

  dial.append(svg, input);

  const val = document.createElement('span');
  val.className = 'doc-knob__val';
  val.textContent = format(current.value);

  host.append(name, dial, val);

  const paint = () => {
    drawKnob(arc, ptr, fraction(input));
    const value = Number(input.value);
    const option = current.options?.[Math.round(value)];
    const valueText = option ?? `${format(value)}${current.unit ?? ''}`;
    val.textContent = valueText;
    input.setAttribute('aria-valuetext', valueText);
  };
  const onInput = () => {
    paint();
    current.onInput?.(Number(input.value));
  };
  input.addEventListener('input', onInput);
  paint();

  return {
    element: host,
    input,
    setValue(value) {
      input.value = String(value);
      paint();
    },
    update(patch) {
      current = {...current, ...patch};
      format = current.format ?? fixed2;
      name.textContent = current.name;
      input.min = String(current.options?.length ? 0 : current.min);
      input.max = String(current.options?.length ? current.options.length - 1 : current.max);
      input.step = String(current.options?.length ? 1 : current.step ?? 0.01);
      input.disabled = current.disabled ?? false;
      input.setAttribute('aria-label', current.name);
      if (patch.value !== undefined) input.value = String(patch.value);
      paint();
    },
    destroy() {
      input.removeEventListener('input', onInput);
      host.replaceChildren();
      host.classList.remove('doc-knob');
      delete host.dataset.wuiMounted;
    },
  };
}

/** Back-compatible convenience returning the native range input. */
export function mountKnob(host: HTMLElement, spec: ControlSpec): HTMLInputElement {
  return mountKnobControl(host, spec).input;
}

/**
 * Paint one slider's fill. The gradient stop is a custom property rather than a
 * child element so the same declaration serves both orientations.
 */
function paintRange(input: HTMLInputElement): void {
  input.style.setProperty('--wui-range-pct', `${(fraction(input) * 100).toFixed(1)}%`);
}

/**
 * Keep every `.wui-range` under `root` filled to its value.
 *
 * Called once for the document on load, and again by the mount helpers for
 * sliders that appear later. Updates are delegated from the document so a
 * slider added after the initial pass still tracks — it only needs its first
 * paint, which `enhanceRanges` supplies.
 */
export function enhanceRanges(root: ParentNode = document): void {
  root.querySelectorAll<HTMLInputElement>('input.wui-range').forEach(paintRange);
}

/** Initialize every progressively enhanced UI primitive under a page/fragment. */
export function enhanceUi(root: ParentNode = document): void {
  enhanceRanges(root);
  root.querySelectorAll<HTMLElement>('.wui-btn[aria-pressed]').forEach((button) => {
    button.dataset.on = String(button.getAttribute('aria-pressed') === 'true');
  });
}

if (typeof document !== 'undefined') {
  document.addEventListener('input', (event) => {
    const target = event.target as HTMLElement | null;
    if (target instanceof HTMLInputElement && target.classList.contains('wui-range')) {
      paintRange(target);
    }
  });
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => enhanceUi());
  } else {
    enhanceUi();
  }
  document.addEventListener('astro:page-load', () => enhanceUi());
}

/** Build a labelled horizontal range with a live value readout. */
export function mountRange(host: HTMLElement, spec: ControlSpec): MountedControl {
  let current = {...spec};
  let format = current.format ?? fixed2;
  host.replaceChildren();
  host.classList.add('wui-field');
  host.dataset.wuiMounted = 'range';

  const name = document.createElement('span');
  name.className = 'wui-label';
  name.textContent = current.name;
  const input = document.createElement('input');
  input.className = 'wui-range';
  input.type = 'range';
  const output = document.createElement('output');
  output.className = 'wui-readout';
  host.append(name, input, output);

  const configure = () => {
    input.min = String(current.options?.length ? 0 : current.min);
    input.max = String(current.options?.length ? current.options.length - 1 : current.max);
    input.step = String(current.options?.length ? 1 : current.step ?? 0.01);
    input.disabled = current.disabled ?? false;
    input.setAttribute('aria-label', current.name);
  };
  const paint = () => {
    paintRange(input);
    const value = Number(input.value);
    const valueText = current.options?.[Math.round(value)] ?? `${format(value)}${current.unit ?? ''}`;
    output.textContent = valueText;
    input.setAttribute('aria-valuetext', valueText);
  };
  const onInput = () => {
    paint();
    current.onInput?.(Number(input.value));
  };
  configure();
  input.value = String(current.value);
  input.addEventListener('input', onInput);
  paint();

  return {
    element: host,
    input,
    setValue(value) {
      input.value = String(value);
      paint();
    },
    update(patch) {
      current = {...current, ...patch};
      format = current.format ?? fixed2;
      name.textContent = current.name;
      configure();
      if (patch.value !== undefined) input.value = String(patch.value);
      paint();
    },
    destroy() {
      input.removeEventListener('input', onInput);
      host.replaceChildren();
      host.classList.remove('wui-field');
      delete host.dataset.wuiMounted;
    },
  };
}

/**
 * Build a vertical fader into `host` and return its input.
 *
 * The fader is the shared slider rotated, not a control of its own: the input
 * carries `.wui-range`, and `.doc-fader .wui-range` only widens the well and
 * lengthens the travel.
 */
export function mountFaderControl(host: HTMLElement, spec: ControlSpec): MountedControl {
  let current = {...spec};
  let format = current.format ?? fixed2;
  host.replaceChildren();
  host.classList.add('doc-fader');
  host.dataset.wuiMounted = 'fader';

  const input = document.createElement('input');
  input.type = 'range';
  input.className = 'wui-range';
  input.dataset.orient = 'vertical';

  const name = document.createElement('span');
  name.className = 'doc-fader__name';
  name.textContent = current.name;

  const val = document.createElement('output');
  val.className = 'doc-fader__val';

  host.append(input, val, name);

  const configure = () => {
    input.min = String(current.options?.length ? 0 : current.min);
    input.max = String(current.options?.length ? current.options.length - 1 : current.max);
    input.step = String(current.options?.length ? 1 : current.step ?? 0.01);
    input.disabled = current.disabled ?? false;
    input.setAttribute('aria-label', current.name);
  };
  const paint = () => {
    paintRange(input);
    const value = Number(input.value);
    const valueText = current.options?.[Math.round(value)] ?? `${format(value)}${current.unit ?? ''}`;
    val.textContent = valueText;
    input.setAttribute('aria-valuetext', valueText);
  };
  const onInput = () => {
    paint();
    current.onInput?.(Number(input.value));
  };

  configure();
  input.value = String(current.value);
  input.addEventListener('input', onInput);
  paint();

  return {
    element: host,
    input,
    setValue(value) {
      input.value = String(value);
      paint();
    },
    update(patch) {
      current = {...current, ...patch};
      format = current.format ?? fixed2;
      name.textContent = current.name;
      configure();
      if (patch.value !== undefined) input.value = String(patch.value);
      paint();
    },
    destroy() {
      input.removeEventListener('input', onInput);
      host.replaceChildren();
      host.classList.remove('doc-fader');
      delete host.dataset.wuiMounted;
    },
  };
}

/** Back-compatible convenience returning the native range input. */
export function mountFader(host: HTMLElement, spec: ControlSpec): HTMLInputElement {
  return mountFaderControl(host, spec).input;
}

/** Paint a horizontal or vertical progress element from a 0..1 fraction. */
export function setProgress(fill: HTMLElement, value: number, axis: 'horizontal' | 'vertical' = 'horizontal'): void {
  const percent = `${valueToFraction(value) * 100}%`;
  if (axis === 'vertical') fill.style.height = percent;
  else fill.style.width = percent;
}

/** Back-compatible horizontal progress helper. */
export function setFill(fill: HTMLElement, value: number): void {
  setProgress(fill, value);
}

/** Position a peak/playhead marker from a 0..1 fraction. */
export function setPeak(marker: HTMLElement, value: number, axis: 'horizontal' | 'vertical' = 'horizontal'): void {
  const fraction = valueToFraction(value);
  const percent = `${fraction * 100}%`;
  if (axis === 'vertical') {
    const edgeShift = fraction <= 0 ? '0%' : fraction >= 1 ? '100%' : '50%';
    marker.style.bottom = percent;
    marker.style.transform = `translateY(${edgeShift})`;
  } else {
    const edgeShift = fraction <= 0 ? '0%' : fraction >= 1 ? '-100%' : '-50%';
    marker.style.left = percent;
    marker.style.transform = `translateX(${edgeShift})`;
  }
}

/** `m:ss`, the transport readout format used by the shipped players. */
export function formatClock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

/** Back-compatible alias retained for existing demos. */
export const formatTime = formatClock;

/** Compact seconds readout for short controls and diagnostics. */
export function formatSeconds(seconds: number, precision = 1): string {
  const safe = Number.isFinite(seconds) && seconds >= 0 ? seconds : 0;
  return `${safe.toFixed(Math.max(0, precision))}s`;
}

/** Gain fraction to a bounded dBFS readout. */
export function formatDb(value: number, floor = -96): string {
  if (!Number.isFinite(value) || value <= 0) return '−∞ dBFS';
  return `${Math.max(floor, 20 * Math.log10(value)).toFixed(1)} dBFS`;
}

/**
 * Wire a range input to a readout and a coalesced handler.
 *
 * Coalescing runs on a timer rather than requestAnimationFrame: rAF is
 * throttled to nothing while the tab is hidden, which would drop the pending
 * update entirely instead of merely deferring it.
 */
export function bindRange(
  input: HTMLInputElement,
  output: HTMLElement | null,
  format: (value: number) => string,
  apply?: (value: number) => void,
  options: {signal?: AbortSignal} = {},
): () => void {
  let queued: ReturnType<typeof setTimeout> | undefined;
  const sync = () => {
    paintRange(input);
    if (output) output.textContent = format(Number(input.value));
  };
  const onInput = () => {
    sync();
    if (!apply) return;
    clearTimeout(queued);
    queued = setTimeout(() => apply(Number(input.value)), 16);
  };
  input.addEventListener('input', onInput, {signal: options.signal});
  sync();
  const destroy = () => {
    clearTimeout(queued);
    input.removeEventListener('input', onInput);
  };
  options.signal?.addEventListener('abort', destroy, {once: true});
  return destroy;
}

/** Toggle a `.wui-btn` between its on and off states, keeping ARIA in step. */
export function setToggle(button: HTMLElement, on: boolean, label?: (on: boolean) => string): void {
  button.dataset.on = String(on);
  button.setAttribute('aria-pressed', String(on));
  if (label) button.textContent = label(on);
}

export interface MeterState {
  level: number;
  peak?: number;
  label?: string;
}

/** Paint a standard `.doc-meter` composition. */
export function setMeter(root: HTMLElement, state: MeterState): void {
  const fill = root.querySelector<HTMLElement>('.doc-meter__fill');
  const peak = root.querySelector<HTMLElement>('.doc-meter__peak');
  const readout = root.querySelector<HTMLElement>('.doc-meter__db');
  if (fill) setProgress(fill, state.level);
  if (peak) setPeak(peak, state.peak ?? state.level);
  if (readout) readout.textContent = state.label ?? formatDb(state.level);
}

export interface MountedMeter {
  element: HTMLElement;
  set(state: MeterState): void;
  destroy(): void;
}

export function mountMeter(host: HTMLElement, initial: MeterState = {level: 0}): MountedMeter {
  host.replaceChildren();
  host.classList.add('doc-meter');
  host.dataset.wuiMounted = 'meter';
  const track = document.createElement('div');
  track.className = 'doc-meter__track';
  const fill = document.createElement('span');
  fill.className = 'doc-meter__fill';
  const peak = document.createElement('span');
  peak.className = 'doc-meter__peak';
  const readout = document.createElement('div');
  readout.className = 'doc-meter__db';
  track.append(fill, peak);
  host.append(track, readout);
  setMeter(host, initial);
  return {
    element: host,
    set: (state) => setMeter(host, state),
    destroy() {
      host.replaceChildren();
      host.classList.remove('doc-meter');
      delete host.dataset.wuiMounted;
    },
  };
}
