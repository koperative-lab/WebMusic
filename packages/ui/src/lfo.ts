import {installStyle} from './internal/style';
import {claimHost, createUpdateLoop} from "./internal/lifecycle";
import {addClassNames, clamp, setParts} from './internal/dom';
import {componentSurfaceCss, controlBorderFallback} from './internal/surface';
import {controlHeight, controlRadius, controlThumbRadius, surfaceHeight} from './internal/control';
// ============================================================================
// Domain-neutral low-frequency oscillator presenter.
//
// The presenter owns accessible controls, waveform markup and listener
// cleanup. The structural binding owns oscillator state, scheduling and every
// target or domain resource affected by the oscillator.
// ============================================================================

export type LfoShape = "sine" | "triangle" | "square" | "saw";

export interface LfoState {
  shape: LfoShape;
  /** Oscillator frequency in hertz. */
  rate: number;
  /** Modulation depth normalized to 0…1. */
  depth: number;
  /** Current cycle position normalized to 0…1. */
  phase: number;
  running: boolean;
  disabled?: boolean;
}

/** Structural presenter port; it owns no clock, target or domain resource. */
export interface LfoBinding {
  snapshot(): LfoState;
  setRunning(running: boolean): Promise<void> | void;
  setShape(shape: LfoShape): Promise<void> | void;
  setRate(rate: number): Promise<void> | void;
  setDepth(depth: number): Promise<void> | void;
  subscribe?(notify: () => void): () => void;
}

export interface LfoClassNames {
  root?: string;
  row?: string;
  run?: string;
  shapes?: string;
  shape?: string;
  control?: string;
  rateControl?: string;
  depthControl?: string;
  label?: string;
  input?: string;
  rateInput?: string;
  depthInput?: string;
  value?: string;
  rateValue?: string;
  depthValue?: string;
  wave?: string;
  curve?: string;
  head?: string;
}

export interface LfoParts {
  root?: string;
  row?: string;
  run?: string;
  shapes?: string;
  shape?: string;
  control?: string;
  rateControl?: string;
  depthControl?: string;
  label?: string;
  input?: string;
  rateInput?: string;
  depthInput?: string;
  value?: string;
  rateValue?: string;
  depthValue?: string;
  wave?: string;
  curve?: string;
  head?: string;
}

export interface LfoOptions {
  label?: string;
  runLabel?: string;
  stopLabel?: string;
  classNames?: LfoClassNames;
  parts?: LfoParts;
  formatRate?: (rate: number) => string;
  formatDepth?: (depth: number) => string;
  onError?: (error: unknown) => void;
  /** Install the exported stylesheet into the host. Defaults to true. */
  stylesheet?: boolean;
}

export interface LfoHandle {
  element: HTMLElement;
  update(): void;
  destroy(): void;
}

/**
 * Named presenter nodes. Callers that decorate LFO DOM go through these
 * instead of depending on the presenter's internal markup or class names.
 */
export interface LfoControls {
  run: HTMLButtonElement;
  shapes: HTMLElement;
  rateInput: HTMLInputElement;
  rateValue: HTMLElement;
  depthInput: HTMLInputElement;
  depthValue: HTMLElement;
  wave: HTMLElement;
  curve: SVGPolylineElement;
  head: SVGLineElement;
}

export interface MountedLfoHandle extends LfoHandle {
  controls: LfoControls;
}

type LfoHost = HTMLElement | ShadowRoot;
type LfoCommand =
  | { kind: "running"; value: boolean }
  | { kind: "shape"; value: LfoShape }
  | { kind: "rate"; value: number }
  | { kind: "depth"; value: number };
type LfoCommandKind = LfoCommand["kind"];

interface ActiveLfoCommand {
  revision: number;
  command: LfoCommand;
}

const SVG_NS = "http://www.w3.org/2000/svg";
const SHAPES: readonly LfoShape[] = ["sine", "triangle", "square", "saw"];
const mountedLfos = new WeakMap<LfoHost, LfoHandle>();

export const lfoStyle = String.raw`
.wui-lfo,
.wui-lfo * { box-sizing: border-box; }
.wui-lfo {
${componentSurfaceCss('lfo', {
  padding: 'var(--wm-lfo-padding, .6rem)',
  border: '1px solid var(--wm-lfo-border, var(--wm-border, #d8d8d8))',
  radius: 'var(--wm-lfo-radius, var(--wm-control-radius, 0))',
  background: 'var(--wm-lfo-background, var(--wm-surface, #fff))',
})}
  display: block;
  min-width: 0;
  max-width: 100%;
  color: var(--wm-lfo-foreground, var(--wm-foreground, #111));
  font: var(--wm-lfo-font, .8rem var(--wm-font-family, system-ui, sans-serif));
}
.wui-lfo__row {
  display: flex;
  align-items: center;
  gap: var(--wm-lfo-gap, .5rem);
  flex-wrap: wrap;
  min-width: 0;
}
.wui-lfo__run,
.wui-lfo__shape {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: ${controlHeight('lfo')};
  padding: 0;
  border-radius: var(--wm-lfo-radius, var(--wm-control-radius, 0));
  cursor: pointer;
}
.wui-lfo__run {
  width: ${controlHeight('lfo')};
  border: 1px solid var(--wm-lfo-button-background, var(--wm-accent, var(--wm-foreground, #111)));
  background: var(--wm-lfo-button-background, var(--wm-accent, var(--wm-foreground, #111)));
  color: var(--wm-lfo-button-foreground, var(--wm-accent-foreground, #fff));
}
.wui-lfo__run svg { width: 1.1rem; height: 1.1rem; }
.wui-lfo__shapes { display: flex; flex-wrap: wrap; min-width: 0; max-width: 100%; gap: var(--wm-lfo-shape-gap, .25rem); }
.wui-lfo__shape {
  width: 1.9rem;
  border: 1px solid var(--wm-lfo-chip-border, ${controlBorderFallback});
  background: var(--wm-lfo-chip-background, var(--wm-surface, #fff));
  color: var(--wm-lfo-chip-foreground, var(--wm-foreground, #333));
}
.wui-lfo__shape[aria-pressed='true'] {
  background: var(--wm-lfo-chip-active-background, var(--wm-accent, var(--wm-foreground, #111)));
  color: var(--wm-lfo-chip-active-foreground, var(--wm-accent-foreground, #fff));
}
.wui-lfo__shape svg { width: 1.1rem; height: 1rem; }
.wui-lfo__control {
  display: flex;
  flex-wrap: wrap;
  min-width: 0;
  max-width: 100%;
  align-items: center;
  gap: .35rem;
  color: var(--wm-lfo-label, var(--wm-foreground-muted, var(--wm-foreground, #666)));
  font-size: .72rem;
}
.wui-lfo__input {
  appearance: none;
  -webkit-appearance: none;
  box-sizing: border-box;
  width: var(--wm-lfo-input-width, 5.5rem);
  min-width: 0;
  max-width: 100%;
  flex: 0 1 var(--wm-lfo-input-width, 5.5rem);
  height: ${controlHeight('lfo')};
  margin: 0;
  border: 0;
  border-radius: ${controlRadius('lfo')};
  background: var(--wm-lfo-track, var(--wm-control-track, #f3f3f3));
  cursor: pointer;
}
/* The runnable track carries the UA's own height; without these the rail keeps
   its native thickness however tall the input is. */
.wui-lfo__input::-webkit-slider-runnable-track { height: 100%; border: 0; background: transparent; }
.wui-lfo__input::-moz-range-track { height: 100%; border: 0; background: transparent; }
.wui-lfo__input::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: var(--wm-lfo-handle-size, .7rem);
  height: ${controlHeight('lfo')};
  margin: 0;
  border: 0;
  border-radius: ${controlThumbRadius('lfo')};
  background: var(--wm-lfo-thumb, var(--wm-control-thumb, #111));
}
.wui-lfo__input::-moz-range-thumb {
  width: var(--wm-lfo-handle-size, .7rem);
  height: ${controlHeight('lfo')};
  border: 0;
  border-radius: ${controlThumbRadius('lfo')};
  background: var(--wm-lfo-thumb, var(--wm-control-thumb, #111));
}
.wui-lfo__value {
  min-width: 3.2ch;
  max-width: 100%;
  overflow-wrap: anywhere;
  color: var(--wm-lfo-value, currentColor);
  font-variant-numeric: tabular-nums;
}
.wui-lfo__wave {
  position: relative;
  height: ${surfaceHeight('lfo-wave', 'sm')};
  margin-top: .6rem;
  overflow: hidden;
  background: var(--wm-lfo-wave-background, var(--wm-surface-inverse, #111));
}
.wui-lfo__wave svg { display: block; width: 100%; height: 100%; }
.wui-lfo__curve {
  fill: none;
  stroke: var(--wm-lfo-wave, var(--wm-foreground-on-inverse, #fff));
  stroke-width: 1.5;
  vector-effect: non-scaling-stroke;
}
.wui-lfo__head {
  stroke: var(--wm-lfo-head, var(--wm-accent, #c0392b));
  stroke-width: 1.5;
  vector-effect: non-scaling-stroke;
}
.wui-lfo.is-disabled { opacity: .55; }
.wui-lfo.is-disabled button,
.wui-lfo.is-disabled input { cursor: default; }
.wui-lfo button:focus-visible,
.wui-lfo input:focus-visible {
  outline: 2px solid var(--wm-focus, var(--wm-focus-ring, currentColor));
  outline-offset: 2px;
}
@media (forced-colors: active) {
  .wui-lfo { border-color: CanvasText; }
  .wui-lfo__run,
  .wui-lfo__shape { border-color: ButtonText; }
  .wui-lfo__curve,
  .wui-lfo__head { stroke: CanvasText; }
}
`;

function createSvg<K extends keyof SVGElementTagNameMap>(
  document: Document,
  tag: K,
): SVGElementTagNameMap[K] {
  return document.createElementNS(SVG_NS, tag);
}

function normalizeShape(shape: unknown): LfoShape {
  return SHAPES.includes(shape as LfoShape) ? (shape as LfoShape) : "sine";
}

function normalizeState(state: LfoState | null | undefined): LfoState {
  return {
    shape: normalizeShape(state?.shape),
    rate: clamp(state?.rate, 0.05, 12),
    depth: clamp(state?.depth, 0, 1),
    phase: clamp(state?.phase, 0, 1),
    running: state?.running === true,
    disabled: state?.disabled === true,
  };
}

function waveValue(shape: LfoShape, phase: number): number {
  switch (shape) {
    case "triangle":
      return 4 * Math.abs(phase - 0.5) - 1;
    case "square":
      return phase < 0.5 ? 1 : -1;
    case "saw":
      return 2 * phase - 1;
    default:
      return Math.sin(phase * Math.PI * 2);
  }
}

function wavePoints(shape: LfoShape, depth: number): string {
  const points: string[] = [];
  for (let x = 0; x <= 100; x += 2) {
    const y = 50 - waveValue(shape, x / 100) * depth * 48;
    points.push(`${x},${y.toFixed(1)}`);
  }
  return points.join(" ");
}

function shapePath(shape: LfoShape): string {
  switch (shape) {
    case "triangle":
      return "M2 12 L7 3 L12 12 L17 3";
    case "square":
      return "M2 12 L2 4 L8 4 L8 12 L14 12 L14 4 L18 4";
    case "saw":
      return "M2 12 L9 3 L9 12 L16 3 L16 12";
    default:
      return "M2 8 Q6 1 10 8 T18 8";
  }
}

function createShapeGlyph(document: Document, shape: LfoShape): SVGSVGElement {
  const svg = createSvg(document, "svg");
  svg.setAttribute("viewBox", "0 0 20 16");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.6");
  svg.setAttribute("aria-hidden", "true");
  const path = createSvg(document, "path");
  path.setAttribute("d", shapePath(shape));
  svg.append(path);
  return svg;
}

function createRunGlyph(document: Document, running: boolean): SVGSVGElement {
  const svg = createSvg(document, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  if (running) {
    const first = createSvg(document, "rect");
    first.setAttribute("x", "7");
    first.setAttribute("y", "5");
    first.setAttribute("width", "3.5");
    first.setAttribute("height", "14");
    first.setAttribute("fill", "currentColor");
    const second = createSvg(document, "rect");
    second.setAttribute("x", "13.5");
    second.setAttribute("y", "5");
    second.setAttribute("width", "3.5");
    second.setAttribute("height", "14");
    second.setAttribute("fill", "currentColor");
    svg.append(first, second);
  } else {
    const polygon = createSvg(document, "polygon");
    polygon.setAttribute("points", "8 5 19 12 8 19 8 5");
    polygon.setAttribute("fill", "currentColor");
    svg.append(polygon);
  }
  return svg;
}

/** Mount an accessible LFO control surface into an element or open shadow root. */
export function mountLfo(
  host: LfoHost,
  binding: LfoBinding,
  options: LfoOptions = {},
): MountedLfoHandle {
  const document = host.ownerDocument;
  const style = installStyle(document, 'lfo', lfoStyle, options.stylesheet);

  const root = document.createElement("div");
  root.className = "wui-lfo";
  root.setAttribute("role", "group");
  root.setAttribute("aria-label", options.label ?? "LFO");
  addClassNames(root, options.classNames?.root);
  setParts(root, ["root"], options.parts?.root);

  const row = document.createElement("div");
  row.className = "wui-lfo__row";
  addClassNames(row, options.classNames?.row);
  setParts(row, ["row"], options.parts?.row);

  const run = document.createElement("button");
  run.type = "button";
  run.className = "wui-lfo__run";
  addClassNames(run, options.classNames?.run);
  setParts(run, ["run"], options.parts?.run);

  const shapes = document.createElement("div");
  shapes.className = "wui-lfo__shapes";
  shapes.setAttribute("role", "group");
  shapes.setAttribute("aria-label", "Shape");
  addClassNames(shapes, options.classNames?.shapes);
  setParts(shapes, ["shapes"], options.parts?.shapes);
  const shapeButtons = new Map<LfoShape, HTMLButtonElement>();
  for (const shape of SHAPES) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "wui-lfo__shape";
    button.dataset.s = shape;
    button.title = shape;
    button.setAttribute("aria-label", shape);
    addClassNames(button, options.classNames?.shape);
    setParts(button, ["shape"], options.parts?.shape);
    button.append(createShapeGlyph(document, shape));
    shapeButtons.set(shape, button);
    shapes.append(button);
  }

  const makeControl = (
    name: "rate" | "depth",
    labelText: string,
    minimum: string,
    maximum: string,
    step: string,
  ): {
    label: HTMLLabelElement;
    input: HTMLInputElement;
    value: HTMLSpanElement;
  } => {
    const label = document.createElement("label");
    label.className = `wui-lfo__control wui-lfo__${name}-control`;
    addClassNames(label, options.classNames?.control);
    addClassNames(
      label,
      name === "rate"
        ? options.classNames?.rateControl
        : options.classNames?.depthControl,
    );
    addClassNames(label, options.classNames?.label);
    setParts(
      label,
      ["control", "label", `${name}-control`],
      [
        options.parts?.control,
        options.parts?.label,
        name === "rate" ? options.parts?.rateControl : options.parts?.depthControl,
      ].filter(Boolean).join(" "),
    );
    label.append(document.createTextNode(`${labelText} `));

    const input = document.createElement("input");
    input.type = "range";
    input.className = `wui-lfo__input wui-lfo__${name}`;
    input.min = minimum;
    input.max = maximum;
    input.step = step;
    input.setAttribute("aria-label", labelText);
    addClassNames(input, options.classNames?.input);
    addClassNames(
      input,
      name === "rate"
        ? options.classNames?.rateInput
        : options.classNames?.depthInput,
    );
    setParts(
      input,
      ["input", name],
      [
        options.parts?.input,
        name === "rate" ? options.parts?.rateInput : options.parts?.depthInput,
      ].filter(Boolean).join(" "),
    );

    const value = document.createElement("span");
    value.className = `wui-lfo__value wui-lfo__${name}-value`;
    value.setAttribute("aria-hidden", "true");
    addClassNames(value, options.classNames?.value);
    addClassNames(
      value,
      name === "rate"
        ? options.classNames?.rateValue
        : options.classNames?.depthValue,
    );
    setParts(
      value,
      ["value", `${name}-value`],
      [
        options.parts?.value,
        name === "rate" ? options.parts?.rateValue : options.parts?.depthValue,
      ].filter(Boolean).join(" "),
    );
    label.append(input, value);
    return { label, input, value };
  };

  const rateControl = makeControl("rate", "rate", "0.05", "12", "0.05");
  const depthControl = makeControl("depth", "depth", "0", "1", "0.01");
  row.append(run, shapes, rateControl.label, depthControl.label);

  const wave = document.createElement("div");
  wave.className = "wui-lfo__wave";
  addClassNames(wave, options.classNames?.wave);
  setParts(wave, ["wave"], options.parts?.wave);
  const svg = createSvg(document, "svg");
  svg.setAttribute("viewBox", "0 0 100 100");
  svg.setAttribute("preserveAspectRatio", "none");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  const curve = createSvg(document, "polyline");
  curve.classList.add("wui-lfo__curve");
  curve.setAttribute("fill", "none");
  curve.setAttribute("points", "");
  addClassNames(curve, options.classNames?.curve);
  setParts(curve, ["curve"], options.parts?.curve);
  const head = createSvg(document, "line");
  head.classList.add("wui-lfo__head");
  head.setAttribute("x1", "0");
  head.setAttribute("y1", "0");
  head.setAttribute("x2", "0");
  head.setAttribute("y2", "100");
  addClassNames(head, options.classNames?.head);
  setParts(head, ["head"], options.parts?.head);
  svg.append(curve, head);
  wave.append(svg);
  root.append(row, wave);

  let destroyed = false;
  let current: LfoState | undefined;
  let currentRateText = "";
  let currentDepthText = "";
  let unsubscribe: (() => void) | undefined;
  let paintRevision = 0;
  const commandRevisions: Record<LfoCommandKind, number> = {
    running: 0,
    shape: 0,
    rate: 0,
    depth: 0,
  };
  const activeCommands = new Map<LfoCommandKind, ActiveLfoCommand>();
  const cleanups: Array<() => void> = [];
  const isCurrent = (): boolean =>
    !destroyed && mountedLfos.get(host) === handle;
  const reportError = (error: unknown): void => {
    const pending = options.onError?.(error) as unknown;
    // Contextual-void callbacks may still be async at runtime. Consume a
    // rejected reporter without replacing the original presenter failure.
    void Promise.resolve(pending).catch(() => {});
  };
  const reportAsyncError = (error: unknown): void => {
    if (!isCurrent()) return;
    try {
      reportError(error);
    } catch {
      // Reporting an asynchronous command failure must not reject again.
    }
  };
  const listen = (
    target: EventTarget,
    type: string,
    listener: EventListener,
  ): void => {
    target.addEventListener(type, listener);
    cleanups.push(() => target.removeEventListener(type, listener));
  };

  const commitFrame = (
    snapshot: LfoState,
    rateText: string,
    depthText: string,
  ): void => {
    if (!isCurrent()) return;
    const firstFrame = current === undefined;
    const points = wavePoints(snapshot.shape, snapshot.depth);
    const headX = (snapshot.phase * 100).toFixed(1);
    current = snapshot;
    currentRateText = rateText;
    currentDepthText = depthText;

    root.classList.toggle("is-disabled", snapshot.disabled === true);
    run.disabled = snapshot.disabled === true;
    run.setAttribute(
      "aria-label",
      snapshot.running
        ? (options.stopLabel ?? "Stop")
        : (options.runLabel ?? "Run"),
    );
    run.replaceChildren(createRunGlyph(document, snapshot.running));
    for (const [shape, button] of shapeButtons) {
      const active = shape === snapshot.shape;
      button.disabled = snapshot.disabled === true;
      button.classList.toggle("is-active", active);
      button.classList.toggle("on", active);
      button.setAttribute("aria-pressed", String(active));
    }
    rateControl.input.disabled = snapshot.disabled === true;
    rateControl.input.value = String(snapshot.rate);
    if (firstFrame) rateControl.input.defaultValue = String(snapshot.rate);
    rateControl.input.setAttribute("aria-valuetext", rateText);
    rateControl.value.textContent = rateText;
    depthControl.input.disabled = snapshot.disabled === true;
    depthControl.input.value = String(snapshot.depth);
    if (firstFrame) depthControl.input.defaultValue = String(snapshot.depth);
    depthControl.input.setAttribute("aria-valuetext", depthText);
    depthControl.value.textContent = depthText;
    curve.setAttribute("points", points);
    head.setAttribute("x1", headX);
    head.setAttribute("x2", headX);
  };

  const paint = (snapshot: LfoState, useCustomFormatters = true): void => {
    if (!isCurrent()) return;
    const revision = ++paintRevision;
    const canCommit = (): boolean => isCurrent() && revision === paintRevision;
    const rateText = useCustomFormatters
      ? (options.formatRate ?? ((rate) => `${rate.toFixed(2)}Hz`))(
          snapshot.rate,
        )
      : `${snapshot.rate.toFixed(2)}Hz`;
    if (!canCommit()) return;
    const depthText = useCustomFormatters
      ? (options.formatDepth ?? ((depth) => `${Math.round(depth * 100)}%`))(
          snapshot.depth,
        )
      : `${Math.round(snapshot.depth * 100)}%`;
    if (!canCommit()) return;
    commitFrame(snapshot, rateText, depthText);
  };

  const restoreCurrentFrame = (): void => {
    if (!current) return;
    commitFrame(current, currentRateText, currentDepthText);
  };

  const fallback: LfoState = {
    shape: "sine",
    rate: 1,
    depth: 0.6,
    phase: 0,
    running: false,
    disabled: true,
  };

  const withOptimisticCommands = (snapshot: LfoState): LfoState => {
    let next = snapshot;
    for (const { command } of activeCommands.values()) {
      next = normalizeState({ ...next, ...commandPatch(command) });
    }
    return next;
  };

  const performUpdate = (): void => {
    if (!isCurrent()) return;
    try {
      paint(withOptimisticCommands(normalizeState(binding.snapshot())));
    } catch (error) {
      if (!isCurrent()) return;
      if (!current) paint(fallback, false);
      if (isCurrent()) reportError(error);
    }
  };

  const updateLoop = createUpdateLoop({
    name: "LFO",
    pass: () => performUpdate(),
    isCurrent,
    report: reportAsyncError,
  });
  const update = (): void => updateLoop.run();

  const commandPatch = (command: LfoCommand): Partial<LfoState> => {
    switch (command.kind) {
      case "running":
        return { running: command.value };
      case "shape":
        return { shape: command.value };
      case "rate":
        return { rate: clamp(command.value, 0.05, 12) };
      case "depth":
        return { depth: clamp(command.value, 0, 1) };
    }
  };

  const invokeCommand = (command: LfoCommand): Promise<void> | void => {
    switch (command.kind) {
      case "running":
        return binding.setRunning(command.value);
      case "shape":
        return binding.setShape(command.value);
      case "rate":
        return binding.setRate(command.value);
      case "depth":
        return binding.setDepth(command.value);
    }
  };

  const submit = (command: LfoCommand): void => {
    if (!isCurrent() || !current || current.disabled) return;
    const kind = command.kind;
    const revision = ++commandRevisions[kind];
    activeCommands.set(kind, { revision, command });
    const isLatest = (): boolean =>
      isCurrent() && revision === commandRevisions[kind];
    const clearIfLatest = (): boolean => {
      if (!isLatest()) return false;
      if (activeCommands.get(kind)?.revision === revision) {
        activeCommands.delete(kind);
      }
      return true;
    };
    const finish = (failed: boolean, error?: unknown): void => {
      if (!clearIfLatest()) return;
      try {
        update();
      } catch (updateError) {
        if (isLatest()) reportAsyncError(updateError);
      }
      if (failed && isLatest()) reportAsyncError(error);
    };
    try {
      paint(withOptimisticCommands(current));
    } catch (error) {
      if (clearIfLatest()) {
        restoreCurrentFrame();
        if (isLatest()) reportAsyncError(error);
      }
      return;
    }
    if (!isLatest()) return;
    try {
      const pending = invokeCommand(command);
      void Promise.resolve(pending).then(
        () => finish(false),
        (error: unknown) => finish(true, error),
      );
    } catch (error) {
      finish(true, error);
    }
  };

  listen(run, "click", (() => {
    if (!current) return;
    submit({ kind: "running", value: !current.running });
  }) as EventListener);
  for (const [shape, button] of shapeButtons) {
    listen(button, "click", (() =>
      submit({ kind: "shape", value: shape })) as EventListener);
  }
  listen(rateControl.input, "input", (() =>
    submit({
      kind: "rate",
      value: Number(rateControl.input.value),
    })) as EventListener);
  listen(depthControl.input, "input", (() =>
    submit({
      kind: "depth",
      value: Number(depthControl.input.value),
    })) as EventListener);

  const rollback = (): void => {
    destroyed = true;
    updateLoop.cancel();
    paintRevision += 1;
    for (const kind of Object.keys(commandRevisions) as LfoCommandKind[]) {
      commandRevisions[kind] += 1;
    }
    activeCommands.clear();
    for (const cleanup of cleanups.splice(0)) {
      try {
        cleanup();
      } catch {
        // Preserve the mount failure after best-effort rollback.
      }
    }
    try {
      unsubscribe?.();
    } catch {
      // Preserve the mount failure after best-effort rollback.
    }
    unsubscribe = undefined;
    try {
      root.remove();
    } catch {
      // Preserve the mount failure after best-effort rollback.
    }
    try {
      style?.remove();
    } catch {
      // Preserve the mount failure after best-effort rollback.
    }
    claim.release();
  };

  const handle: MountedLfoHandle = {
    element: root,
    controls: {
      run,
      shapes,
      rateInput: rateControl.input,
      rateValue: rateControl.value,
      depthInput: depthControl.input,
      depthValue: depthControl.value,
      wave,
      curve,
      head,
    },
    update,
    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      updateLoop.cancel();
      paintRevision += 1;
      for (const kind of Object.keys(commandRevisions) as LfoCommandKind[]) {
        commandRevisions[kind] += 1;
      }
      activeCommands.clear();
      let cleanupError: unknown;
      for (const cleanup of cleanups.splice(0)) {
        try {
          cleanup();
        } catch (error) {
          cleanupError ??= error;
        }
      }
      try {
        unsubscribe?.();
      } catch (error) {
        cleanupError ??= error;
      }
      unsubscribe = undefined;
      try {
        root.remove();
      } catch (error) {
        cleanupError ??= error;
      }
      try {
        style?.remove();
      } catch (error) {
        cleanupError ??= error;
      }
      current = undefined;
      claim.release();
      if (cleanupError !== undefined) reportError(cleanupError);
    },
  };

  // Claim ownership before any user callback. A previous presenter's cleanup
  // may re-enter and mount this host again.
  const claim = claimHost(mountedLfos, host, handle);
  try {
    claim.destroyPrevious();
    if (!isCurrent()) return handle;
    host.append(...(style ? [style] : []), root);
    if (!isCurrent()) return handle;
    try {
      const nextUnsubscribe = binding.subscribe?.(update);
      if (nextUnsubscribe) {
        if (isCurrent()) unsubscribe = nextUnsubscribe;
        else nextUnsubscribe();
      }
    } catch (error) {
      if (isCurrent()) reportError(error);
    }
    if (isCurrent()) update();
  } catch (error) {
    rollback();
    throw error;
  }
  return handle;
}
