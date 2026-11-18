import {installStyle} from './internal/style';
import {claimHost, createErrorSink} from './internal/lifecycle';
import {addClassNames, finite, setParts} from './internal/dom';
import {controlHeight} from './internal/control';
import {neutralColor} from './internal/palette';
import {iconMarkup, visuallyHiddenDeclarations} from './internal/icons';
import {createFader, faderStyle} from './fader';
import {createKnob, knobStyle} from './knob';

// ============================================================================
// Single-value controls (DEC-075): button, toggle, number, slider, dial,
// message, menu, tabs, multislider and matrix. Each draws one caller-owned
// value through a structural binding and issues commands; none imports a
// domain or Kernel type. All follow Visual design: square, monochrome, one
// control height, pressed states inverted, a visible focus ring, no prose.
// ============================================================================

/** Options every control accepts. */
export interface ControlOptions {
  /** Accessible name. Each control has a default. */
  label?: string;
  /** Compatibility classes added to the root beside its canonical `wui-*` class. */
  className?: string;
  /** CSS part tokens added to the root beside its canonical part name. */
  part?: string;
  /** Install the controls stylesheet into the host. Defaults to true. */
  stylesheet?: boolean;
  /**
   * Fill the host instead of keeping the control's natural size: the control
   * takes the host's whole width and height and has no size of its own, so
   * the host must have one, as a resizable box does.
   */
  fill?: boolean;
  /** Receives binding, command and subscription failures. */
  onError?: (error: unknown) => void;
}

export interface ControlHandle {
  readonly element: HTMLElement;
  /** Repaint from the binding's snapshot. */
  update(): void;
  destroy(): void;
}

interface Subscribable { subscribe?(notify: () => void): () => void }

const INK = `var(--wm-foreground, ${neutralColor('foreground')})`;
const ON_INK = 'var(--wm-accent-foreground, light-dark(#fff, #111))';
const LINE = `var(--wm-control-border, var(--wm-border, ${neutralColor('border')}))`;
const SURFACE = 'var(--wm-surface, light-dark(#fff, #111))';
const RAISED = 'var(--wm-surface-muted, light-dark(#f3f3f3, #1c1c1c))';
const MUTED = 'var(--wm-foreground-muted, light-dark(#777, #aaa))';
const MONO = 'var(--wm-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)';
const SIZE = controlHeight('control');
const FOCUS = `var(--wm-focus-ring, 2px solid ${INK})`;
const hidden = Object.entries(visuallyHiddenDeclarations).map(([property, value]) => `${property}: ${value};`).join(' ');

export const controlsStyle = String.raw`
:where(.wui-control) { box-sizing: border-box; display: inline-flex; align-items: stretch; vertical-align: top; color: ${INK}; font: 500 .75rem/1 ${MONO}; }
:where(.wui-control *, .wui-control *::before, .wui-control *::after) { box-sizing: border-box; }
:where(.wui-control [hidden]) { display: none !important; }
:where(.wui-control__hidden) { ${hidden} }
:where(.wui-control__cell) {
  display: inline-flex; align-items: center; justify-content: center; min-width: ${SIZE}; height: ${SIZE}; margin: 0; padding: 0 .5rem;
  border: 1px solid ${LINE}; border-radius: var(--wm-control-radius, 0); background: ${SURFACE}; color: ${INK}; font: inherit; cursor: pointer;
}
:where(.wui-control__cell:hover:not(:disabled)) { background: ${RAISED}; }
:where(.wui-control__cell[aria-pressed="true"], .wui-control__cell[aria-checked="true"], .wui-control__cell[aria-selected="true"], .wui-control__cell[data-flash="true"]) {
  background: ${INK}; color: ${ON_INK}; border-color: ${INK};
}
:where(.wui-control__cell:disabled, .wui-control[data-disabled="true"]) { opacity: .3; cursor: default; }
:where(.wui-control :focus-visible) { outline: ${FOCUS}; outline-offset: -2px; }
:where(.wui-control__cell svg) { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 1.5; stroke-linecap: square; stroke-linejoin: miter; }
:where(.wui-control--button .wui-control__cell, .wui-control--toggle .wui-control__cell) { width: ${SIZE}; padding: 0; }
:where(.wui-control__field) {
  width: 100%; min-width: 4.5rem; height: ${SIZE}; margin: 0; padding: 0 .5rem; border: 1px solid ${LINE}; border-radius: var(--wm-control-radius, 0);
  background: ${SURFACE}; color: ${INK}; font: inherit; font-variant-numeric: tabular-nums; cursor: ns-resize;
}
:where(.wui-control__field:focus) { cursor: text; }
:where(.wui-control--number) { width: 100%; }
:where(.wui-control--slider) { align-items: center; width: 100%; min-width: 6rem; }
:where(.wui-control--slider .wui-fader) { flex: 1 1 auto; }
:where(.wui-control--dial) { flex-direction: column; align-items: center; gap: .25rem; }
:where(.wui-control__readout) { color: ${MUTED}; font-size: .6875rem; font-variant-numeric: tabular-nums; white-space: nowrap; }
:where(.wui-control--message .wui-control__cell) { justify-content: flex-start; max-width: 100%; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
:where(.wui-control--menu) { width: 100%; }
:where(.wui-control--menu .wui-control__cell) { flex: 1 1 auto; justify-content: space-between; gap: .5rem; min-width: 0; }
:where(.wui-control--menu .wui-control__value) { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
:where(.wui-control--tabs) { flex-wrap: nowrap; }
:where(.wui-control--tabs .wui-control__cell + .wui-control__cell) { border-left-width: 0; }
:where(.wui-control--multislider) {
  gap: 1px; width: 100%; min-width: 6rem; height: calc(${SIZE} * 3); padding: 1px; border: 1px solid ${LINE}; background: ${LINE}; touch-action: none; cursor: crosshair;
}
:where(.wui-control__bar) { position: relative; flex: 1 1 0; min-width: 0; background: ${SURFACE}; }
:where(.wui-control__bar-fill) { position: absolute; left: 0; right: 0; bottom: 0; background: ${INK}; pointer-events: none; }
:where(.wui-control--matrix) { display: inline-grid; gap: 0; }
:where(.wui-control--matrix .wui-control__cell) { width: ${SIZE}; padding: 0; margin: -1px 0 0 -1px; }
:where(.wui-control__scrim) { display: block; position: absolute; inset: 0; z-index: 20; background: var(--wm-control-scrim, rgb(0 0 0 / 45%)); }
:where(.wui-control__card) {
  position: absolute; display: block; z-index: 21; top: 0; left: 50%; transform: translateX(-50%); width: min(20rem, 100%); max-height: 100%; overflow: auto;
  border: 1px solid ${LINE}; background: ${SURFACE}; box-shadow: 0 8px 24px rgb(0 0 0 / 18%); color: ${INK}; font: 500 .75rem/1 ${MONO}; scrollbar-width: none;
}
:where(.wui-control__card)::-webkit-scrollbar { display: none; }
:where(.wui-control__card-head) { display: flex; align-items: center; justify-content: space-between; height: ${SIZE}; padding-left: .5rem; border-bottom: 1px solid ${LINE}; color: ${MUTED}; letter-spacing: .08em; text-transform: uppercase; font-size: .6875rem; }
:where(.wui-control__card-head button) { width: ${SIZE}; height: ${SIZE}; border: 0; background: transparent; color: ${MUTED}; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; }
:where(.wui-control__card-head button svg) { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 1.5; }
:where(.wui-control__choices) { display: grid; grid-template-columns: 1fr; }
:where(.wui-control__choices .wui-control__cell) { justify-content: flex-start; border-width: 0 0 1px; }
:where(.wui-control--preset) { display: inline-grid; grid-template-columns: repeat(8, auto); }
:where(.wui-control--preset .wui-control__cell) { width: ${SIZE}; padding: 0; margin: -1px 0 0 -1px; color: ${MUTED}; font-size: .625rem; }
:where(.wui-control--preset .wui-control__cell[data-stored="true"]) { color: ${INK}; box-shadow: inset 0 -3px 0 ${INK}; }
:where(.wui-control--preset .wui-control__cell[aria-pressed="true"]) { color: ${ON_INK}; box-shadow: none; }
:where(.wui-control--nodes) { width: 100%; }
:where(.wui-control__pad) { position: relative; width: 100%; min-width: 8rem; aspect-ratio: 1; border: 1px solid ${LINE}; background: ${SURFACE}; touch-action: none; cursor: crosshair; }
:where(.wui-control__pad svg) { display: block; width: 100%; height: 100%; overflow: hidden; }
:where(.wui-control__pad circle) { fill: ${INK}; stroke: ${INK}; stroke-width: .5; vector-effect: non-scaling-stroke; }
:where(.wui-control__cursor line) { stroke: ${INK}; stroke-width: 1; vector-effect: non-scaling-stroke; }
:where(.wui-control--mapping) { position: absolute; inset: 0; z-index: 15; display: block; pointer-events: none; }
:where(.wui-control__target) {
  position: absolute; min-width: 0; padding: 0 .25rem; border: 1px dashed ${INK}; background: transparent; color: ${INK};
  font-size: .625rem; align-items: flex-start; justify-content: flex-end; pointer-events: auto;
}
:where(.wui-control__target[data-mapped="true"]) { border-style: solid; }
:where(.wui-control__target[aria-pressed="true"]) { border-width: 2px; }
/* Fill: the control takes its host's whole size; the host decides what that is. */
:where(.wui-control[data-fill="true"]) {
  display: flex; width: 100%; height: 100%; min-width: 0; min-height: 0;
  --wm-fader-length: 100%; --wm-fader-thickness: 100%; --wm-fader-width: 100%; --wm-fader-height: 100%;
}
:where(.wui-control[data-fill="true"] > .wui-control__cell) { position: relative; flex: 1 1 0; width: auto; min-width: 0; height: auto; overflow: hidden; }
:where(.wui-control--button[data-fill="true"] svg, .wui-control--toggle[data-fill="true"] svg) { position: absolute; inset: 15%; width: 70%; height: 70%; }
:where(.wui-control[data-fill="true"] .wui-control__field) { min-width: 0; height: auto; }
:where(.wui-control--slider[data-fill="true"]) { align-items: stretch; }
:where(.wui-control--dial[data-fill="true"]) { align-items: stretch; gap: 0; }
:where(.wui-control--dial[data-fill="true"] .wui-control__readout) { flex: none; padding: .125rem 0; overflow: hidden; text-align: center; text-overflow: ellipsis; }
:where(.wui-control--tabs[data-fill="true"] .wui-control__cell) { padding: 0 .25rem; white-space: nowrap; }
:where(.wui-control--multislider[data-fill="true"]) { height: 100%; }
:where(.wui-control--matrix[data-fill="true"], .wui-control--preset[data-fill="true"]) { display: grid; grid-auto-rows: minmax(0, 1fr); padding: 1px 0 0 1px; }
:where(.wui-control--preset[data-fill="true"]) { grid-template-columns: repeat(var(--wui-preset-columns, 8), minmax(0, 1fr)); }
:where(.wui-control--matrix[data-fill="true"] .wui-control__cell, .wui-control--preset[data-fill="true"] .wui-control__cell) { width: auto; min-width: 0; height: auto; }
:where(.wui-control--nodes[data-fill="true"] .wui-control__pad) { min-width: 0; height: 100%; aspect-ratio: auto; }
${faderStyle}
${knobStyle}
`;

const ICONS = {
  bang: '<path d="M12 5a7 7 0 1 0 0 14a7 7 0 1 0 0-14z"/>',
  cross: '<path d="M6 6l12 12M18 6L6 18"/>',
  chevron: '<path d="M7 10l5 5 5-5"/>',
};

const hosts = new WeakMap<object, ControlHandle>();

/** The shared mount: style, root, subscription, host claim and teardown. */
function mountControl<B extends Subscribable>(
  name: string,
  host: HTMLElement | ShadowRoot,
  binding: B,
  options: ControlOptions,
  build: (root: HTMLElement, report: (error: unknown) => void) => {paint(): void; destroy?(): void},
): ControlHandle {
  const document = host.ownerDocument;
  const report = createErrorSink(options.onError);
  const root = document.createElement('div');
  root.className = `wui-control wui-control--${name}`;
  addClassNames(root, options.className);
  setParts(root, name, options.part);
  if (options.fill) root.dataset.fill = 'true';
  let destroyed = false;
  let unsubscribe: (() => void) | undefined;
  // Assigned once the host is claimed; closures above read it through the holder.
  const mounted: {built?: {paint(): void; destroy?(): void}} = {};
  const update = () => {
    if (destroyed || !mounted.built) return;
    try { mounted.built.paint(); } catch (error) { report(error); }
  };
  const handle: ControlHandle = {
    element: root,
    update,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      claim.release();
      try { unsubscribe?.(); } catch (error) { report(error); }
      try { mounted.built?.destroy?.(); } catch (error) { report(error); }
      style?.remove();
      root.remove();
    },
  };
  const claim = claimHost(hosts, host, handle);
  claim.destroyPrevious();
  const style = installStyle(document, 'controls', controlsStyle, options.stylesheet);
  if (!claim.isCurrent()) return handle;
  mounted.built = build(root, report);
  if (style) host.append(style);
  host.append(root);
  update();
  try { unsubscribe = binding.subscribe?.(update); } catch (error) { report(error); }
  return handle;
}

/** Run a command, reporting a thrown or rejected failure. */
function command(report: (error: unknown) => void, run: () => unknown): void {
  try {
    const result = run();
    if (result && typeof (result as PromiseLike<unknown>).then === 'function') void Promise.resolve(result).catch(report);
  } catch (error) { report(error); }
}

const cell = (document: Document, label: string): HTMLButtonElement => {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'wui-control__cell';
  button.setAttribute('aria-label', label);
  button.title = label;
  return button;
};

// --- button ---------------------------------------------------------------------

export interface ButtonState { active?: boolean; disabled?: boolean }
export interface ButtonBinding extends Subscribable { snapshot(): ButtonState; press(): unknown }
export interface ButtonOptions extends ControlOptions {
  /** How long a press or {@link ButtonHandle.flash} shows inverted, in ms. Defaults to 120. */
  flashMs?: number;
}
export interface ButtonHandle extends ControlHandle {
  /** Show the inverted state briefly, as when the button receives a bang. */
  flash(): void;
}

/** A square bang button: pressing it issues `press()` and flashes. */
export function mountButton(host: HTMLElement | ShadowRoot, binding: ButtonBinding, options: ButtonOptions = {}): ButtonHandle {
  let button!: HTMLButtonElement;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const flash = () => {
    if (!button) return;
    button.dataset.flash = 'true';
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { timer = undefined; delete button.dataset.flash; }, options.flashMs ?? 120);
  };
  const handle = mountControl('button', host, binding, options, (root, report) => {
    button = cell(root.ownerDocument, options.label ?? 'Bang');
    button.innerHTML = iconMarkup(ICONS.bang);
    button.addEventListener('click', () => { flash(); command(report, () => binding.press()); });
    root.append(button);
    return {
      paint: () => {
        const state = binding.snapshot();
        button.disabled = state.disabled === true;
        button.setAttribute('aria-pressed', String(state.active === true));
      },
      destroy: () => { if (timer) clearTimeout(timer); },
    };
  });
  return Object.assign(handle, {flash});
}

// --- toggle ---------------------------------------------------------------------

export interface ToggleState { on: boolean; disabled?: boolean }
export interface ToggleBinding extends Subscribable { snapshot(): ToggleState; setOn(on: boolean): unknown }

/** A square on/off switch drawn with a cross when on. */
export function mountToggle(host: HTMLElement | ShadowRoot, binding: ToggleBinding, options: ControlOptions = {}): ControlHandle {
  return mountControl('toggle', host, binding, options, (root, report) => {
    const button = cell(root.ownerDocument, options.label ?? 'Toggle');
    button.addEventListener('click', () => command(report, () => binding.setOn(!binding.snapshot().on)));
    root.append(button);
    let shown: boolean | undefined;
    return {
      paint: () => {
        const state = binding.snapshot();
        button.disabled = state.disabled === true;
        button.setAttribute('aria-pressed', String(state.on));
        if (shown !== state.on) { shown = state.on; button.innerHTML = state.on ? iconMarkup(ICONS.cross) : ''; }
      },
    };
  });
}

// --- number -----------------------------------------------------------------------

export interface NumberState { value: number; min?: number; max?: number; step?: number; float?: boolean; disabled?: boolean }
export interface NumberBinding extends Subscribable { snapshot(): NumberState; setValue(value: number): unknown }

/** Format a number box value: ints plain, floats with up to three decimals. */
export function formatControlNumber(value: number, float: boolean | undefined): string {
  if (!Number.isFinite(value)) return '0';
  if (!float) return String(Math.round(value));
  const fixed = value.toFixed(3).replace(/0+$/, '');
  return fixed.endsWith('.') ? `${fixed}0` : fixed;
}

/** A number box: drag vertically or use the arrow keys to change it, or type a value and press Enter. */
export function mountNumber(host: HTMLElement | ShadowRoot, binding: NumberBinding, options: ControlOptions = {}): ControlHandle {
  return mountControl('number', host, binding, options, (root, report) => {
    const field = root.ownerDocument.createElement('input');
    field.type = 'text';
    field.inputMode = 'decimal';
    field.className = 'wui-control__field';
    field.spellcheck = false;
    field.autocomplete = 'off';
    field.setAttribute('role', 'spinbutton');
    field.setAttribute('aria-label', options.label ?? 'Number');
    root.append(field);
    let editing = false;
    let drag: {pointerId: number; startY: number; startValue: number; moved: boolean} | undefined;
    const state = () => binding.snapshot();
    const clampValue = (value: number) => {
      const current = state();
      const bounded = Math.min(current.max ?? Infinity, Math.max(current.min ?? -Infinity, value));
      return current.float ? bounded : Math.round(bounded);
    };
    const step = () => { const current = state(); return current.step ?? (current.float ? 0.01 : 1); };
    const set = (value: number) => command(report, () => binding.setValue(clampValue(value)));
    const commitText = () => {
      const parsed = Number(field.value.trim());
      if (field.value.trim() && Number.isFinite(parsed)) set(parsed);
      editing = false;
      paint();
    };
    field.addEventListener('pointerdown', event => {
      if (event.button !== 0 || field.disabled || editing) return;
      drag = {pointerId: event.pointerId, startY: event.clientY, startValue: state().value, moved: false};
      field.setPointerCapture?.(event.pointerId);
      event.preventDefault();
    });
    field.addEventListener('pointermove', event => {
      if (!drag || drag.pointerId !== event.pointerId) return;
      const pixels = drag.startY - event.clientY;
      if (!drag.moved && Math.abs(pixels) < 3) return;
      drag.moved = true;
      set(drag.startValue + pixels * step() * (event.shiftKey ? 0.1 : 1));
    });
    const endDrag = (event: PointerEvent) => {
      if (!drag || drag.pointerId !== event.pointerId) return;
      const moved = drag.moved;
      drag = undefined;
      // A click without dragging starts typing.
      if (!moved) { editing = true; field.focus(); field.select(); }
    };
    field.addEventListener('pointerup', endDrag);
    field.addEventListener('pointercancel', () => { drag = undefined; });
    field.addEventListener('keydown', event => {
      const delta = {ArrowUp: 1, ArrowDown: -1, PageUp: 10, PageDown: -10}[event.key];
      if (delta !== undefined) { event.preventDefault(); editing = false; set(state().value + delta * step() * (event.shiftKey ? 0.1 : 1)); return; }
      if (event.key === 'Enter') { event.preventDefault(); commitText(); return; }
      if (event.key === 'Escape') { editing = false; paint(); return; }
      if (event.key.length === 1 && !event.metaKey && !event.ctrlKey) editing = true;
    });
    field.addEventListener('blur', () => { if (editing) commitText(); });
    const paint = () => {
      const current = state();
      field.disabled = current.disabled === true;
      const text = formatControlNumber(current.value, current.float);
      if (!editing) field.value = text;
      field.setAttribute('aria-valuenow', String(current.value));
      field.setAttribute('aria-valuetext', text);
      if (Number.isFinite(current.min)) field.setAttribute('aria-valuemin', String(current.min)); else field.removeAttribute('aria-valuemin');
      if (Number.isFinite(current.max)) field.setAttribute('aria-valuemax', String(current.max)); else field.removeAttribute('aria-valuemax');
    };
    return {paint};
  });
}

// --- slider and dial ---------------------------------------------------------------

export interface RangeState { value: number; min: number; max: number; step?: number; float?: boolean; disabled?: boolean }
export interface RangeBinding extends Subscribable { snapshot(): RangeState; setValue(value: number): unknown }
export interface SliderOptions extends ControlOptions {
  /**
   * Track direction. `'auto'` follows the control's own shape: upright when it
   * is taller than it is wide, level otherwise, and again whenever its size
   * changes. Meant for use with `fill`.
   */
  orientation?: 'horizontal' | 'vertical' | 'auto';
}

const fraction = (state: RangeState) => state.max === state.min ? 0 : (finite(state.value) - state.min) / (state.max - state.min);
const fromFraction = (state: RangeState, level: number) => {
  const raw = state.min + level * (state.max - state.min);
  const step = state.step ?? (state.float ? 0 : 1);
  const snapped = step > 0 ? state.min + Math.round((raw - state.min) / step) * step : raw;
  return state.float ? snapped : Math.round(snapped);
};

/** A fader over a value range, horizontal by default. */
export function mountSlider(host: HTMLElement | ShadowRoot, binding: RangeBinding, options: SliderOptions = {}): ControlHandle {
  return mountControl('slider', host, binding, options, (root, report) => {
    const make = (orientation: 'horizontal' | 'vertical') => {
      const made = createFader(root.ownerDocument, {
        label: options.label ?? 'Slider',
        orientation,
        formatValue: level => formatControlNumber(fromFraction(binding.snapshot(), level), binding.snapshot().float),
        onInput: level => command(report, () => binding.setValue(fromFraction(binding.snapshot(), level))),
        onError: report,
      });
      if (orientation === 'vertical') root.dataset.orientation = 'vertical'; else delete root.dataset.orientation;
      root.replaceChildren(made.element);
      return made;
    };
    const paint = () => { const state = binding.snapshot(); fader.paint(fraction(state), state.disabled === true); };
    let upright = options.orientation === 'vertical';
    let fader = make(upright ? 'vertical' : 'horizontal');
    // An automatic slider turns to follow its shape; the fader is rebuilt, the value is the binding's.
    const view = root.ownerDocument.defaultView;
    const observer = options.orientation === 'auto' && view && typeof view.ResizeObserver === 'function'
      ? new view.ResizeObserver(() => {
        const next = root.clientHeight > root.clientWidth;
        if (next === upright || !root.clientWidth || !root.clientHeight) return;
        upright = next;
        const focused = root.contains(root.ownerDocument.activeElement);
        fader.destroy();
        fader = make(upright ? 'vertical' : 'horizontal');
        paint();
        if (focused) fader.element.focus();
      }) : undefined;
    observer?.observe(root);
    return {
      paint,
      destroy: () => { observer?.disconnect(); fader.destroy(); },
    };
  });
}

/**
 * A rotary knob with its value under it. A drag turns it: up or right raises
 * the value, down or left lowers it.
 */
export function mountDial(host: HTMLElement | ShadowRoot, binding: RangeBinding, options: ControlOptions = {}): ControlHandle {
  return mountControl('dial', host, binding, options, (root, report) => {
    const knob = createKnob(root.ownerDocument, {
      label: options.label ?? 'Dial',
      gesture: 'drag',
      formatValue: level => formatControlNumber(fromFraction(binding.snapshot(), level), binding.snapshot().float),
      onInput: level => command(report, () => binding.setValue(fromFraction(binding.snapshot(), level))),
      onError: report,
    });
    if (options.fill) {
      // The knob takes the room its readout leaves; its drawing keeps its shape inside it.
      knob.element.style.flex = '1 1 0';
      knob.element.style.width = '100%';
      knob.element.style.height = 'auto';
      knob.element.style.minHeight = '0';
    }
    const readout = root.ownerDocument.createElement('span');
    readout.className = 'wui-control__readout';
    readout.setAttribute('aria-hidden', 'true');
    root.append(knob.element, readout);
    return {
      paint: () => {
        const state = binding.snapshot();
        knob.paint(fraction(state), state.disabled === true);
        readout.textContent = formatControlNumber(state.value, state.float);
      },
      destroy: () => knob.destroy(),
    };
  });
}

// --- message box --------------------------------------------------------------------

export interface MessageBoxState { text: string; disabled?: boolean }
export interface MessageBoxBinding extends Subscribable { snapshot(): MessageBoxState; press(): unknown }

/** A clickable message box showing its text; pressing it issues `press()` and flashes. */
export function mountMessage(host: HTMLElement | ShadowRoot, binding: MessageBoxBinding, options: ButtonOptions = {}): ButtonHandle {
  let button!: HTMLButtonElement;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const flash = () => {
    if (!button) return;
    button.dataset.flash = 'true';
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { timer = undefined; delete button.dataset.flash; }, options.flashMs ?? 120);
  };
  const handle = mountControl('message', host, binding, options, (root, report) => {
    button = cell(root.ownerDocument, options.label ?? 'Message');
    button.addEventListener('click', () => { flash(); command(report, () => binding.press()); });
    root.append(button);
    return {
      paint: () => {
        const state = binding.snapshot();
        button.disabled = state.disabled === true;
        button.textContent = state.text;
        button.setAttribute('aria-label', `${options.label ?? 'Message'} ${state.text}`.trim());
        button.title = state.text;
      },
      destroy: () => { if (timer) clearTimeout(timer); },
    };
  });
  return Object.assign(handle, {flash});
}

// --- menu and tabs ------------------------------------------------------------------

export interface ChoiceState { items: readonly string[]; index: number; disabled?: boolean }
export interface ChoiceBinding extends Subscribable { snapshot(): ChoiceState; select(index: number): unknown }
export interface MenuOptions extends ControlOptions {
  /**
   * The component window the choices open over, as an adjustment card behind
   * a scrim. Without it the menu steps through its items in place: a click
   * moves to the next one, and the arrow keys move either way.
   */
  cardHost?: HTMLElement;
}

/** A menu: the current item, opening its choices as an adjustment card. */
export function mountMenu(host: HTMLElement | ShadowRoot, binding: ChoiceBinding, options: MenuOptions = {}): ControlHandle {
  return mountControl('menu', host, binding, options, (root, report) => {
    const document = root.ownerDocument;
    const label = options.label ?? 'Menu';
    const trigger = cell(document, label);
    const value = document.createElement('span');
    value.className = 'wui-control__value';
    const chevron = document.createElement('span');
    chevron.setAttribute('aria-hidden', 'true');
    chevron.innerHTML = iconMarkup(ICONS.chevron);
    trigger.append(value, chevron);
    root.append(trigger);
    let card: {close(): void} | undefined;
    const choose = (index: number) => command(report, () => binding.select(index));
    const step = (delta: number) => {
      const state = binding.snapshot();
      if (!state.items.length) return;
      choose((state.index + delta + state.items.length) % state.items.length);
    };
    const open = () => {
      const cardHost = options.cardHost;
      if (!cardHost) { step(1); return; }
      card?.close();
      const state = binding.snapshot();
      if (getComputedStyle(cardHost).position === 'static') cardHost.style.position = 'relative';
      const scrim = document.createElement('div');
      scrim.className = 'wui-control wui-control__scrim';
      const dialog = document.createElement('div');
      dialog.className = 'wui-control wui-control__card';
      dialog.setAttribute('role', 'dialog');
      dialog.setAttribute('aria-modal', 'true');
      dialog.setAttribute('aria-label', label);
      const head = document.createElement('div');
      head.className = 'wui-control__card-head';
      const caption = document.createElement('span');
      caption.textContent = label;
      const close = document.createElement('button');
      close.type = 'button';
      close.setAttribute('aria-label', 'Close');
      close.title = 'Close';
      close.innerHTML = iconMarkup(ICONS.cross);
      head.append(caption, close);
      const list = document.createElement('div');
      list.className = 'wui-control__choices';
      list.setAttribute('role', 'listbox');
      list.setAttribute('aria-label', label);
      const options_ = state.items.map((item, index) => {
        const choice = cell(document, item);
        choice.textContent = item;
        choice.setAttribute('role', 'option');
        choice.setAttribute('aria-selected', String(index === state.index));
        choice.addEventListener('click', () => { finish(); choose(index); });
        return choice;
      });
      list.append(...options_);
      dialog.append(head, list);
      const finish = () => {
        scrim.remove(); dialog.remove(); dialog.removeEventListener('keydown', keys); card = undefined;
        trigger.setAttribute('aria-expanded', 'false');
        trigger.focus();
      };
      const keys = (event: KeyboardEvent) => {
        if (event.key === 'Escape') { event.preventDefault(); finish(); return; }
        const focusables = [close, ...options_];
        const at = focusables.indexOf(document.activeElement as HTMLButtonElement);
        if (event.key === 'Tab') {
          event.preventDefault();
          focusables[(at + (event.shiftKey ? -1 : 1) + focusables.length) % focusables.length]!.focus();
        } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          const current = options_.indexOf(document.activeElement as HTMLButtonElement);
          options_[(current + (event.key === 'ArrowDown' ? 1 : -1) + options_.length) % options_.length]?.focus();
        }
      };
      close.addEventListener('click', finish);
      scrim.addEventListener('pointerdown', finish);
      dialog.addEventListener('keydown', keys);
      cardHost.append(scrim, dialog);
      trigger.setAttribute('aria-expanded', 'true');
      (options_[state.index] ?? close).focus();
      card = {close: finish};
    };
    trigger.setAttribute('aria-haspopup', options.cardHost ? 'dialog' : 'false');
    trigger.addEventListener('click', open);
    trigger.addEventListener('keydown', event => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowRight') { event.preventDefault(); step(1); }
      else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') { event.preventDefault(); step(-1); }
    });
    return {
      paint: () => {
        const state = binding.snapshot();
        trigger.disabled = state.disabled === true;
        const item = state.items[state.index] ?? '';
        value.textContent = item;
        trigger.setAttribute('aria-label', `${label}: ${item}`);
        trigger.title = item;
      },
      destroy: () => card?.close(),
    };
  });
}

/** Tabs: one square cell per item, edge to edge, the current one inverted. */
export function mountTabs(host: HTMLElement | ShadowRoot, binding: ChoiceBinding, options: ControlOptions = {}): ControlHandle {
  return mountControl('tabs', host, binding, options, (root, report) => {
    root.setAttribute('role', 'radiogroup');
    root.setAttribute('aria-label', options.label ?? 'Tabs');
    let cells: HTMLButtonElement[] = [];
    let shown = '';
    const choose = (index: number) => command(report, () => binding.select(index));
    const paint = () => {
      const state = binding.snapshot();
      const key = JSON.stringify(state.items);
      if (key !== shown) {
        shown = key;
        cells = state.items.map((item, index) => {
          const button = cell(root.ownerDocument, item);
          button.textContent = item;
          button.setAttribute('role', 'radio');
          button.addEventListener('click', () => choose(index));
          button.addEventListener('keydown', event => {
            const delta = {ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1}[event.key];
            if (delta === undefined) return;
            event.preventDefault();
            const next = (index + delta + cells.length) % cells.length;
            choose(next);
            cells[next]?.focus();
          });
          return button;
        });
        root.replaceChildren(...cells);
      }
      cells.forEach((button, index) => {
        const current = index === state.index;
        button.setAttribute('aria-checked', String(current));
        button.tabIndex = current || (state.index < 0 && index === 0) ? 0 : -1;
        button.disabled = state.disabled === true;
      });
    };
    return {paint};
  });
}

// --- multislider --------------------------------------------------------------------

export interface MultisliderState { values: readonly number[]; min: number; max: number; float?: boolean; disabled?: boolean }
export interface MultisliderBinding extends Subscribable { snapshot(): MultisliderState; setValues(values: readonly number[]): unknown }

/** A row of bars, one per value: draw across them with the pointer, or step through them with the keyboard. */
export function mountMultislider(host: HTMLElement | ShadowRoot, binding: MultisliderBinding, options: ControlOptions = {}): ControlHandle {
  return mountControl('multislider', host, binding, options, (root, report) => {
    root.setAttribute('role', 'group');
    root.setAttribute('aria-label', options.label ?? 'Multislider');
    let bars: {bar: HTMLElement; fill: HTMLElement}[] = [];
    let focus = 0;
    let drawing: number | undefined;
    const snap = (state: MultisliderState, value: number) => {
      const bounded = Math.min(Math.max(state.min, state.max), Math.max(Math.min(state.min, state.max), value));
      return state.float ? bounded : Math.round(bounded);
    };
    const setAt = (index: number, value: number) => {
      const state = binding.snapshot();
      if (index < 0 || index >= state.values.length) return;
      const values = [...state.values];
      values[index] = snap(state, value);
      command(report, () => binding.setValues(values));
    };
    const fromPointer = (event: PointerEvent) => {
      const state = binding.snapshot();
      const rect = root.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const index = Math.floor(((event.clientX - rect.left) / rect.width) * state.values.length);
      const level = 1 - (event.clientY - rect.top) / rect.height;
      setAt(Math.max(0, Math.min(state.values.length - 1, index)), state.min + Math.max(0, Math.min(1, level)) * (state.max - state.min));
    };
    root.addEventListener('pointerdown', event => {
      if (event.button !== 0 || binding.snapshot().disabled) return;
      drawing = event.pointerId;
      root.setPointerCapture?.(event.pointerId);
      fromPointer(event);
    });
    root.addEventListener('pointermove', event => { if (drawing === event.pointerId) fromPointer(event); });
    root.addEventListener('pointerup', () => { drawing = undefined; });
    root.addEventListener('pointercancel', () => { drawing = undefined; });
    const paint = () => {
      const state = binding.snapshot();
      if (bars.length !== state.values.length) {
        bars = state.values.map((_, index) => {
          const bar = root.ownerDocument.createElement('div');
          bar.className = 'wui-control__bar';
          bar.setAttribute('role', 'slider');
          bar.setAttribute('aria-label', `${options.label ?? 'Multislider'} ${index + 1}`);
          bar.addEventListener('focus', () => { focus = index; });
          bar.addEventListener('keydown', event => {
            const current = binding.snapshot();
            const span = current.max - current.min;
            const unit = current.float ? span / 100 : 1;
            const delta = {ArrowUp: unit, ArrowDown: -unit, PageUp: unit * 10, PageDown: -unit * 10}[event.key];
            if (delta !== undefined) { event.preventDefault(); setAt(index, (current.values[index] ?? 0) + delta); return; }
            const move = {ArrowRight: 1, ArrowLeft: -1}[event.key];
            if (move !== undefined) { event.preventDefault(); bars[Math.max(0, Math.min(bars.length - 1, index + move))]?.bar.focus(); }
          });
          const fill = root.ownerDocument.createElement('span');
          fill.className = 'wui-control__bar-fill';
          bar.append(fill);
          return {bar, fill};
        });
        root.replaceChildren(...bars.map(item => item.bar));
        focus = Math.min(focus, bars.length - 1);
      }
      root.dataset.disabled = String(state.disabled === true);
      bars.forEach(({bar, fill}, index) => {
        const value = state.values[index] ?? state.min;
        const level = state.max === state.min ? 0 : (value - state.min) / (state.max - state.min);
        fill.style.height = `${Math.max(0, Math.min(1, level)) * 100}%`;
        bar.tabIndex = index === focus ? 0 : -1;
        bar.setAttribute('aria-valuenow', String(value));
        bar.setAttribute('aria-valuemin', String(state.min));
        bar.setAttribute('aria-valuemax', String(state.max));
        bar.setAttribute('aria-valuetext', formatControlNumber(value, state.float));
        bar.setAttribute('aria-disabled', String(state.disabled === true));
      });
    };
    return {paint};
  });
}

// --- matrix -------------------------------------------------------------------------

export interface MatrixState { columns: number; rows: number; cells: readonly number[]; disabled?: boolean }
export interface MatrixBinding extends Subscribable { snapshot(): MatrixState; setCell(column: number, row: number, on: boolean): unknown }

/** A routing grid of square cells; a pressed cell is on. Arrow keys move between cells. */
export function mountMatrix(host: HTMLElement | ShadowRoot, binding: MatrixBinding, options: ControlOptions = {}): ControlHandle {
  return mountControl('matrix', host, binding, options, (root, report) => {
    root.setAttribute('role', 'group');
    root.setAttribute('aria-label', options.label ?? 'Matrix');
    let buttons: HTMLButtonElement[] = [];
    let shape = '';
    let focus = 0;
    const paint = () => {
      const state = binding.snapshot();
      const columns = Math.max(1, Math.trunc(state.columns)), rows = Math.max(1, Math.trunc(state.rows));
      if (shape !== `${columns}x${rows}`) {
        shape = `${columns}x${rows}`;
        root.style.gridTemplateColumns = options.fill ? `repeat(${columns}, minmax(0, 1fr))` : `repeat(${columns}, auto)`;
        buttons = Array.from({length: columns * rows}, (_, index) => {
          const column = index % columns, row = Math.floor(index / columns);
          const button = cell(root.ownerDocument, `Column ${column + 1}, row ${row + 1}`);
          button.addEventListener('click', () => command(report, () => binding.setCell(column, row, binding.snapshot().cells[index] !== 1)));
          button.addEventListener('focus', () => { focus = index; });
          button.addEventListener('keydown', event => {
            const move = {ArrowRight: [1, 0], ArrowLeft: [-1, 0], ArrowDown: [0, 1], ArrowUp: [0, -1]}[event.key];
            if (!move) return;
            event.preventDefault();
            const nextColumn = Math.max(0, Math.min(columns - 1, column + move[0]!)), nextRow = Math.max(0, Math.min(rows - 1, row + move[1]!));
            buttons[nextRow * columns + nextColumn]?.focus();
          });
          return button;
        });
        root.replaceChildren(...buttons);
        focus = Math.min(focus, buttons.length - 1);
      }
      buttons.forEach((button, index) => {
        button.setAttribute('aria-pressed', String(state.cells[index] === 1));
        button.disabled = state.disabled === true;
        button.tabIndex = index === focus ? 0 : -1;
      });
    };
    return {paint};
  });
}

// --- preset grid -----------------------------------------------------------------

export interface PresetGridState { count: number; stored: readonly number[]; current: number; disabled?: boolean }
export interface PresetGridBinding extends Subscribable {
  snapshot(): PresetGridState;
  /** Recall a stored slot (1-based). */
  recall(slot: number): unknown;
  /** Store the current values in a slot. */
  store(slot: number): unknown;
  /** Optional: empty a slot. */
  clear?(slot: number): unknown;
}

/**
 * A grid of preset slots. Click recalls a stored slot; Shift-click (or
 * Shift+Enter) stores into any slot; Alt-click (or Delete) clears one. A
 * stored slot shows a filled mark; the current one is inverted.
 */
export function mountPresetGrid(host: HTMLElement | ShadowRoot, binding: PresetGridBinding, options: ControlOptions = {}): ControlHandle {
  return mountControl('preset', host, binding, options, (root, report) => {
    root.setAttribute('role', 'group');
    root.setAttribute('aria-label', options.label ?? 'Presets');
    let cells: HTMLButtonElement[] = [];
    let focus = 0;
    const act = (slot: number, event: {shiftKey: boolean; altKey: boolean}) => {
      if (event.altKey) { if (binding.clear) command(report, () => binding.clear!(slot)); return; }
      if (event.shiftKey || !binding.snapshot().stored.includes(slot)) command(report, () => binding.store(slot));
      else command(report, () => binding.recall(slot));
    };
    const paint = () => {
      const state = binding.snapshot();
      const count = Math.max(1, Math.min(64, Math.trunc(state.count)));
      if (cells.length !== count) {
        cells = Array.from({length: count}, (_, index) => {
          const slot = index + 1;
          const button = cell(root.ownerDocument, `Preset ${slot}`);
          button.textContent = String(slot);
          button.addEventListener('click', event => act(slot, event));
          button.addEventListener('focus', () => { focus = index; });
          button.addEventListener('keydown', event => {
            if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); act(slot, {shiftKey: false, altKey: true}); return; }
            if (event.key === 'Enter' && event.shiftKey) { event.preventDefault(); act(slot, {shiftKey: true, altKey: false}); return; }
            const move = {ArrowRight: 1, ArrowLeft: -1, ArrowDown: 8, ArrowUp: -8}[event.key];
            if (move !== undefined) { event.preventDefault(); cells[Math.max(0, Math.min(cells.length - 1, index + move))]?.focus(); }
          });
          return button;
        });
        // Fewer than eight slots share the width between them when the grid fills its host.
        root.style.setProperty('--wui-preset-columns', String(Math.min(8, count)));
        root.replaceChildren(...cells);
      }
      cells.forEach((button, index) => {
        const slot = index + 1;
        const stored = state.stored.includes(slot);
        button.dataset.stored = String(stored);
        button.setAttribute('aria-pressed', String(state.current === slot));
        button.setAttribute('aria-label', `Preset ${slot}${stored ? ', stored' : ', empty'}`);
        button.disabled = state.disabled === true;
        button.tabIndex = index === focus ? 0 : -1;
      });
    };
    return {paint};
  });
}

// --- nodes (interpolation pad) ---------------------------------------------------

export interface NodesState {
  /** Node centres and reach on the unit square. */
  nodes: readonly {x: number; y: number; radius: number}[];
  cursor: {x: number; y: number};
  /** Each node's current weight, for the readout. */
  weights?: readonly number[];
  disabled?: boolean;
}
export interface NodesBinding extends Subscribable {
  snapshot(): NodesState;
  setCursor(x: number, y: number): unknown;
  /** Optional: move a node. Without it nodes stay put. */
  moveNode?(index: number, x: number, y: number): unknown;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * An interpolation pad: circles for nodes and a crosshair cursor. Drag the
 * cursor (or use the arrow keys) to blend; with `moveNode`, Shift-drag a node
 * to move it. Weights are read back from the binding.
 */
export function mountNodes(host: HTMLElement | ShadowRoot, binding: NodesBinding, options: ControlOptions = {}): ControlHandle {
  return mountControl('nodes', host, binding, options, (root, report) => {
    const document = root.ownerDocument;
    const pad = document.createElement('div');
    pad.className = 'wui-control__pad';
    pad.tabIndex = 0;
    pad.setAttribute('role', 'slider');
    pad.setAttribute('aria-label', options.label ?? 'Interpolation');
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 100 100');
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.setAttribute('aria-hidden', 'true');
    const nodeLayer = document.createElementNS(SVG_NS, 'g');
    const cursorLayer = document.createElementNS(SVG_NS, 'g');
    const horizontal = document.createElementNS(SVG_NS, 'line'), vertical = document.createElementNS(SVG_NS, 'line');
    cursorLayer.append(horizontal, vertical);
    cursorLayer.setAttribute('class', 'wui-control__cursor');
    svg.append(nodeLayer, cursorLayer);
    pad.append(svg);
    root.append(pad);
    let circles: SVGCircleElement[] = [];
    let drag: {pointerId: number; node?: number} | undefined;
    const point = (event: PointerEvent) => {
      const rect = pad.getBoundingClientRect();
      return {x: Math.min(1, Math.max(0, (event.clientX - rect.left) / (rect.width || 1))), y: Math.min(1, Math.max(0, (event.clientY - rect.top) / (rect.height || 1)))};
    };
    pad.addEventListener('pointerdown', event => {
      if (event.button !== 0 || binding.snapshot().disabled) return;
      const at = point(event);
      const nodes = binding.snapshot().nodes;
      const hit = event.shiftKey && binding.moveNode ? nodes.findIndex(node => Math.hypot(node.x - at.x, node.y - at.y) < 0.06) : -1;
      drag = {pointerId: event.pointerId, ...(hit >= 0 ? {node: hit} : {})};
      pad.setPointerCapture?.(event.pointerId);
      if (hit < 0) command(report, () => binding.setCursor(at.x, at.y));
    });
    pad.addEventListener('pointermove', event => {
      if (!drag || drag.pointerId !== event.pointerId) return;
      const at = point(event);
      if (drag.node !== undefined) command(report, () => binding.moveNode!(drag!.node!, at.x, at.y));
      else command(report, () => binding.setCursor(at.x, at.y));
    });
    pad.addEventListener('pointerup', () => { drag = undefined; });
    pad.addEventListener('pointercancel', () => { drag = undefined; });
    pad.addEventListener('keydown', event => {
      const step = event.shiftKey ? 0.1 : 0.02;
      const move = {ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step]}[event.key];
      if (!move) return;
      event.preventDefault();
      const {cursor} = binding.snapshot();
      command(report, () => binding.setCursor(Math.min(1, Math.max(0, cursor.x + move[0]!)), Math.min(1, Math.max(0, cursor.y + move[1]!))));
    });
    const paint = () => {
      const state = binding.snapshot();
      if (circles.length !== state.nodes.length) {
        circles = state.nodes.map(() => document.createElementNS(SVG_NS, 'circle'));
        nodeLayer.replaceChildren(...circles);
      }
      state.nodes.forEach((node, index) => {
        const circle = circles[index]!;
        circle.setAttribute('cx', String(node.x * 100));
        circle.setAttribute('cy', String(node.y * 100));
        circle.setAttribute('r', String(node.radius * 100));
        circle.style.fillOpacity = String(0.08 + 0.5 * (state.weights?.[index] ?? 0));
      });
      const x = state.cursor.x * 100, y = state.cursor.y * 100;
      horizontal.setAttribute('x1', '0'); horizontal.setAttribute('x2', '100'); horizontal.setAttribute('y1', String(y)); horizontal.setAttribute('y2', String(y));
      vertical.setAttribute('y1', '0'); vertical.setAttribute('y2', '100'); vertical.setAttribute('x1', String(x)); vertical.setAttribute('x2', String(x));
      const weights = (state.weights ?? []).map((weight, index) => `node ${index + 1} ${Math.round(weight * 100)}%`).join(', ');
      pad.setAttribute('aria-valuetext', `x ${Math.round(state.cursor.x * 100)}%, y ${Math.round(state.cursor.y * 100)}%${weights ? `; ${weights}` : ''}`);
      pad.setAttribute('aria-disabled', String(state.disabled === true));
    };
    return {paint};
  });
}

// --- mapping overlay ----------------------------------------------------------------

export interface MappingTarget {
  /** Stable identity of the mappable control. */
  id: string;
  label: string;
  /** The element the target outlines; its box is read relative to the host. */
  element: Element;
  /** The source mapped to it, as text (for example `CC 74`), if any. */
  mapped?: string;
}
export interface MappingOverlayState { active: boolean; targets: readonly MappingTarget[]; learning?: string }
export interface MappingOverlayBinding extends Subscribable {
  snapshot(): MappingOverlayState;
  /** Wait for the next control to map to this target. */
  learn(id: string): unknown;
  /** Remove this target's mapping. */
  unmap(id: string): unknown;
}

/**
 * Mapping mode: while active, an outline over each mappable control; click
 * one (or press Enter on it) to learn its control, Delete to remove its
 * mapping. A mapped target shows its source; the learning one is inverted.
 * The overlay covers `host`, which must be positioned; it follows layout on
 * `update()`.
 */
export function mountMappingOverlay(host: HTMLElement, binding: MappingOverlayBinding, options: ControlOptions = {}): ControlHandle {
  return mountControl('mapping', host, binding, options, (root, report) => {
    root.setAttribute('role', 'group');
    root.setAttribute('aria-label', options.label ?? 'Mappings');
    const paint = () => {
      const state = binding.snapshot();
      root.hidden = !state.active;
      if (!state.active) { root.replaceChildren(); return; }
      const origin = host.getBoundingClientRect();
      const focused = root.ownerDocument.activeElement instanceof HTMLElement ? root.ownerDocument.activeElement.dataset.target : undefined;
      root.replaceChildren(...state.targets.map(target => {
        const rect = target.element.getBoundingClientRect();
        const outline = cell(root.ownerDocument, `${target.label}${target.mapped ? `, mapped to ${target.mapped}` : ', not mapped'}`);
        outline.className = 'wui-control__cell wui-control__target';
        outline.dataset.target = target.id;
        outline.dataset.mapped = String(!!target.mapped);
        outline.setAttribute('aria-pressed', String(state.learning === target.id));
        outline.style.left = `${rect.left - origin.left + host.scrollLeft}px`;
        outline.style.top = `${rect.top - origin.top + host.scrollTop}px`;
        outline.style.width = `${Math.max(16, rect.width)}px`;
        outline.style.height = `${Math.max(16, rect.height)}px`;
        outline.textContent = state.learning === target.id ? '…' : target.mapped ?? '';
        outline.addEventListener('click', () => command(report, () => binding.learn(target.id)));
        outline.addEventListener('keydown', event => {
          if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); command(report, () => binding.unmap(target.id)); }
        });
        return outline;
      }));
      if (focused) root.querySelector<HTMLElement>(`[data-target="${CSS.escape(focused)}"]`)?.focus();
    };
    return {paint};
  });
}
