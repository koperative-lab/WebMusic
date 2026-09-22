import {readText, textValue, type UITextValue, formatNumber, type UIValueFormatters, formatPercent} from './text';
import {installStyle} from './internal/style';
import {claimHost, createUpdateLoop} from "./internal/lifecycle";
import {addClassNames, clamp01, finite, setParts} from './internal/dom';
import {componentSurfaceCss, controlBorderFallback} from './internal/surface';
import {surfaceHeight} from './internal/control';
import {
  keepSvgCirclesRound,
  type RoundSvgCirclesHandle,
} from './internal/svg';
// ============================================================================
// Domain-neutral ADSR envelope presenter.
//
// It owns accessible markup, pointer/keyboard interaction and listener
// cleanup. The structural binding owns state, commands and every domain
// resource behind those commands.
// ============================================================================

export interface EnvelopeState {
  attack: number;
  decay: number;
  sustain: number;
  release: number;
}

export interface EnvelopeRanges {
  attackMax: number;
  decayMax: number;
  releaseMax: number;
}

export interface EnvelopeSnapshot {
  envelope: EnvelopeState;
  ranges: EnvelopeRanges;
  disabled?: boolean;
}

/** Structural presenter port; it owns no DOM or audio resource. */
export interface EnvelopeBinding {
  snapshot(): EnvelopeSnapshot;
  setEnvelope(envelope: EnvelopeState): Promise<void> | void;
  subscribe?(notify: () => void): () => void;
}

export interface EnvelopeClassNames {
  root?: string;
  svg?: string;
  grid?: string;
  area?: string;
  curve?: string;
  handle?: string;
  readout?: string;
  inputs?: string;
  input?: string;
}

export interface EnvelopeParts {
  root?: string;
  svg?: string;
  grid?: string;
  area?: string;
  curve?: string;
  handle?: string;
  readout?: string;
  inputs?: string;
  input?: string;
}

export interface EnvelopeText {
  label?: UITextValue;
  attack?: UITextValue;
  decay?: UITextValue;
  sustain?: UITextValue;
  release?: UITextValue;
  seconds?: UITextValue<{value: string; seconds: number}>;
  secondsShort?: UITextValue<{value: string; seconds: number}>;
  readout?: UITextValue<{attack: string; decay: string; sustain: string; release: string}>;
}

export interface EnvelopeOptions {
  /** Read application-resolved text once per paint; call update() after external changes. */
  getText?: () => EnvelopeText;
  formatters?: UIValueFormatters;
  label?: string;
  classNames?: EnvelopeClassNames;
  parts?: EnvelopeParts;
  onError?: (error: unknown) => void;
  /** Install the exported stylesheet into the host. Defaults to true. */
  stylesheet?: boolean;
}

export interface EnvelopeHandle {
  element: HTMLElement;
  update(): void;
  destroy(): void;
}

type EnvelopeHost = HTMLElement | ShadowRoot;
type EnvelopeHandleName = "a" | "ds" | "r";
type EnvelopeStage = keyof EnvelopeState;

interface NormalizedSnapshot {
  envelope: EnvelopeState;
  ranges: EnvelopeRanges;
  disabled: boolean;
}

const SVG_NS = "http://www.w3.org/2000/svg";
const SEGMENT = 25;
const HEIGHT = 100;
const DEFAULT_RANGES: EnvelopeRanges = {
  attackMax: 2,
  decayMax: 2,
  releaseMax: 2,
};
const mountedEnvelopes = new WeakMap<EnvelopeHost, EnvelopeHandle>();

export const envelopeStyle = String.raw`
.wui-envelope,
.wui-envelope * { box-sizing: border-box; }
.wui-envelope {
${componentSurfaceCss('envelope')}
  position: relative;
  display: block;
  overflow: hidden;
  min-width: 0;
  max-width: 100%;
  color: var(--wm-envelope-foreground, var(--wm-foreground-on-inverse, #fff));
  user-select: none;
}
.wui-envelope__svg {
  display: block;
  width: 100%;
  height: ${surfaceHeight('envelope', 'md')};
  overflow: visible;
  border: 1px solid var(--wm-envelope-border, ${controlBorderFallback});
  border-radius: var(--wm-envelope-radius, var(--wm-control-radius, 0));
  background: var(--wm-envelope-background, var(--wm-surface-inverse, #111));
  touch-action: none;
}
.wui-envelope__grid {
  stroke: var(--wm-envelope-grid, rgba(255, 255, 255, .12));
  stroke-width: .5;
}
.wui-envelope__area {
  fill: var(--wm-envelope-fill, rgba(255, 255, 255, .12));
  stroke: none;
}
.wui-envelope__curve {
  fill: none;
  stroke: var(--wm-envelope-curve, currentColor);
  stroke-width: 1.5;
  vector-effect: non-scaling-stroke;
}
.wui-envelope__handle {
  fill: var(--wm-envelope-handle, currentColor);
  stroke: var(--wm-envelope-handle-border, ${controlBorderFallback});
  stroke-width: 1;
  cursor: grab;
}
.wui-envelope__handle.is-dragging { cursor: grabbing; }
.wui-envelope__handle.is-focused {
  stroke: var(--wm-focus, var(--wm-focus-ring, Highlight));
  stroke-width: 2.5;
  vector-effect: non-scaling-stroke;
}
.wui-envelope__readout {
  display: block;
  min-width: 0;
  padding: .4rem .5rem;
  overflow-wrap: anywhere;
  color: var(--wm-envelope-text, var(--wm-foreground-muted, var(--wm-foreground, #666)));
  font: 600 .68rem/1.4 var(--wm-font-mono, ui-monospace, monospace);
  font-variant-numeric: tabular-nums;
  text-align: start;
}
.wui-envelope__inputs {
  position: absolute;
  top: 0;
  left: 0;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
}
.wui-envelope__input {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: 0;
  opacity: 0;
}
.wui-envelope.is-disabled { opacity: .55; }
.wui-envelope.is-disabled .wui-envelope__handle { cursor: default; }
@media (forced-colors: active) {
  .wui-envelope { border-color: CanvasText; background: Canvas; color: CanvasText; }
  .wui-envelope__svg { border-color: CanvasText; background: Canvas; }
  .wui-envelope__grid { stroke: GrayText; }
  .wui-envelope__area { fill: Canvas; }
  .wui-envelope__curve { stroke: CanvasText; }
  .wui-envelope__handle { fill: ButtonFace; stroke: ButtonText; }
  .wui-envelope__handle.is-focused { stroke: Highlight; }
}
`;

function positive(value: unknown, fallback: number): number {
  const number = finite(value, fallback);
  return number > 0 ? number : fallback;
}

function normalizeSnapshot(snapshot: EnvelopeSnapshot): NormalizedSnapshot {
  const sourceEnvelope = snapshot?.envelope;
  const sourceRanges = snapshot?.ranges;
  return {
    envelope: {
      attack: finite(sourceEnvelope?.attack, 0),
      decay: finite(sourceEnvelope?.decay, 0),
      sustain: finite(sourceEnvelope?.sustain, 0),
      release: finite(sourceEnvelope?.release, 0),
    },
    ranges: {
      attackMax: positive(sourceRanges?.attackMax, DEFAULT_RANGES.attackMax),
      decayMax: positive(sourceRanges?.decayMax, DEFAULT_RANGES.decayMax),
      releaseMax: positive(sourceRanges?.releaseMax, DEFAULT_RANGES.releaseMax),
    },
    disabled: snapshot?.disabled === true,
  };
}

function envelopePoints(
  envelope: EnvelopeState,
  ranges: EnvelopeRanges,
): Record<EnvelopeHandleName, [number, number]> {
  const attackX = clamp01(envelope.attack / ranges.attackMax) * SEGMENT;
  const decayX = attackX + clamp01(envelope.decay / ranges.decayMax) * SEGMENT;
  const sustainY = (1 - clamp01(envelope.sustain)) * HEIGHT;
  const releaseX =
    decayX + SEGMENT + clamp01(envelope.release / ranges.releaseMax) * SEGMENT;
  return {
    a: [attackX, 0],
    ds: [decayX, sustainY],
    r: [releaseX, HEIGHT],
  };
}

function readout(envelope: EnvelopeState, text: EnvelopeText | undefined, options: EnvelopeOptions): string {
  const seconds = (raw: number): string => {
    const value = formatNumber(options.formatters, raw, raw.toFixed(2), options.onError);
    return textValue(text?.secondsShort, `${value}s`, {value, seconds: raw}, options.onError);
  };
  const values = {
    attack: seconds(envelope.attack), decay: seconds(envelope.decay),
    sustain: formatPercent(options.formatters, envelope.sustain, undefined, options.onError), release: seconds(envelope.release),
  };
  return textValue(text?.readout, `A ${values.attack} · D ${values.decay} · S ${values.sustain} · R ${values.release}`, values, options.onError);
}

function stageLabel(stage: EnvelopeStage): string {
  return stage[0]!.toUpperCase() + stage.slice(1);
}

function stageValueText(stage: EnvelopeStage, raw: number, text: EnvelopeText | undefined, options: EnvelopeOptions): string {
  if (stage === 'sustain') return formatPercent(options.formatters, raw, undefined, options.onError);
  const value = formatNumber(options.formatters, raw, raw.toFixed(2), options.onError);
  return textValue(text?.seconds, `${value} seconds`, {value, seconds: raw}, options.onError);
}

function handleForStage(stage: EnvelopeStage): EnvelopeHandleName {
  if (stage === "attack") return "a";
  if (stage === "release") return "r";
  return "ds";
}

function createSvgElement<K extends keyof SVGElementTagNameMap>(
  document: Document,
  tag: K,
): SVGElementTagNameMap[K] {
  return document.createElementNS(SVG_NS, tag);
}

/** Mount an accessible ADSR editor into an element or open shadow root. */
export function mountEnvelope(
  host: EnvelopeHost,
  binding: EnvelopeBinding,
  options: EnvelopeOptions = {},
): EnvelopeHandle {
  const document = host.ownerDocument;
  const style = installStyle(document, 'envelope', envelopeStyle, options.stylesheet);

  const root = document.createElement("div");
  root.className = "wui-envelope";
  root.setAttribute("role", "group");
  root.setAttribute("aria-label", options.label ?? "Envelope");
  addClassNames(root, options.classNames?.root);
  setParts(root, "root", options.parts?.root);

  const svg = createSvgElement(document, "svg");
  svg.classList.add("wui-envelope__svg");
  svg.setAttribute("viewBox", "0 0 100 100");
  svg.setAttribute("preserveAspectRatio", "none");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  addClassNames(svg, options.classNames?.svg);
  setParts(svg, "svg", options.parts?.svg);

  for (const x of [25, 50, 75]) {
    const line = createSvgElement(document, "line");
    line.classList.add("wui-envelope__grid");
    line.setAttribute("x1", String(x));
    line.setAttribute("y1", "0");
    line.setAttribute("x2", String(x));
    line.setAttribute("y2", "100");
    addClassNames(line, options.classNames?.grid);
    setParts(line, "grid", options.parts?.grid);
    svg.append(line);
  }

  const area = createSvgElement(document, "polygon");
  area.classList.add("wui-envelope__area");
  area.setAttribute("fill", "none");
  area.setAttribute("points", "");
  addClassNames(area, options.classNames?.area);
  setParts(area, "area", options.parts?.area);
  svg.append(area);

  const curve = createSvgElement(document, "polyline");
  curve.classList.add("wui-envelope__curve");
  curve.setAttribute("fill", "none");
  curve.setAttribute("points", "");
  addClassNames(curve, options.classNames?.curve);
  setParts(curve, "curve", options.parts?.curve);
  svg.append(curve);

  const handles = new Map<EnvelopeHandleName, SVGCircleElement>();
  for (const name of ["a", "ds", "r"] as const) {
    const circle = createSvgElement(document, "circle");
    circle.classList.add("wui-envelope__handle");
    circle.dataset.h = name;
    circle.setAttribute("r", "3.4");
    circle.setAttribute("aria-hidden", "true");
    addClassNames(circle, options.classNames?.handle);
    setParts(circle, "handle", options.parts?.handle);
    handles.set(name, circle);
    svg.append(circle);
  }

  const output = document.createElement("div");
  output.className = "wui-envelope__readout";
  output.setAttribute("aria-hidden", "true");
  addClassNames(output, options.classNames?.readout);
  setParts(output, "readout", options.parts?.readout);

  const inputs = document.createElement("div");
  inputs.className = "wui-envelope__inputs";
  addClassNames(inputs, options.classNames?.inputs);
  setParts(inputs, "inputs", options.parts?.inputs);
  const inputByStage = new Map<EnvelopeStage, HTMLInputElement>();
  for (const stage of ["attack", "decay", "sustain", "release"] as const) {
    const input = document.createElement("input");
    input.type = "range";
    input.className = "wui-envelope__input";
    input.dataset.stage = stage;
    input.setAttribute("aria-label", stageLabel(stage));
    addClassNames(input, options.classNames?.input);
    setParts(input, "input", options.parts?.input);
    inputByStage.set(stage, input);
    inputs.append(input);
  }
  root.append(svg, output, inputs);

  let destroyed = false;
  let current: NormalizedSnapshot | undefined;
  let drag: EnvelopeHandleName | null = null;
  let pointerId: number | null = null;
  let unsubscribe: (() => void) | undefined;
  let roundHandles: RoundSvgCirclesHandle | undefined;
  let commandRevision = 0;
  const cleanups: Array<() => void> = [];
  const isCurrent = (): boolean =>
    !destroyed && mountedEnvelopes.get(host) === handle;
  const reportError = (error: unknown): void => options.onError?.(error);
  const reportAsyncError = (error: unknown): void => {
    if (!isCurrent()) return;
    try {
      reportError(error);
    } catch {
      // Reporting a rejected command must not create another rejection.
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

  const paint = (snapshot: NormalizedSnapshot): void => {
    if (!isCurrent()) return;
    const text = readText(options.getText, options.onError);
    if (!isCurrent()) return;
    current = snapshot;
    const points = envelopePoints(snapshot.envelope, snapshot.ranges);
    const line = `0,${HEIGHT} ${points.a[0]},${points.a[1]} ${points.ds[0]},${points.ds[1]} ${points.ds[0] + SEGMENT},${points.ds[1]} ${points.r[0]},${points.r[1]}`;
    curve.setAttribute("points", line);
    area.setAttribute("points", `0,100 ${line} ${points.r[0]},100`);
    for (const name of ["a", "ds", "r"] as const) {
      handles.get(name)!.setAttribute("cx", String(points[name][0]));
      handles.get(name)!.setAttribute("cy", String(points[name][1]));
    }
    roundHandles?.update();
    root.setAttribute('aria-label', options.label ?? textValue(text?.label, 'Envelope', {}, options.onError));
    output.textContent = readout(snapshot.envelope, text, options);
    root.classList.toggle("is-disabled", snapshot.disabled);
    for (const [stage, input] of inputByStage) {
      const maximum =
        stage === "attack"
          ? snapshot.ranges.attackMax
          : stage === "decay"
            ? snapshot.ranges.decayMax
            : stage === "release"
              ? snapshot.ranges.releaseMax
              : 1;
      const value = clamp01(snapshot.envelope[stage] / maximum) * maximum;
      input.min = "0";
      input.max = String(maximum);
      input.step = stage === "sustain" ? "0.01" : "0.01";
      input.value = String(value);
      input.defaultValue = String(value);
      input.disabled = snapshot.disabled;
      input.setAttribute('aria-label', textValue(text?.[stage], stageLabel(stage), {}, options.onError));
      input.setAttribute("aria-valuetext", stageValueText(stage, value, text, options));
    }
  };

  const performUpdate = (): void => {
    if (!isCurrent()) return;
    try {
      paint(normalizeSnapshot(binding.snapshot()));
    } catch (error) {
      if (isCurrent()) reportError(error);
    }
  };

  const updateLoop = createUpdateLoop({
    name: "Envelope",
    pass: () => performUpdate(),
    isCurrent,
    report: reportAsyncError,
  });
  const update = (): void => updateLoop.run();

  const commit = (next: EnvelopeState): void => {
    if (!isCurrent() || current?.disabled) return;
    const optimistic = normalizeSnapshot({
      envelope: next,
      ranges: current?.ranges ?? DEFAULT_RANGES,
    });
    paint(optimistic);
    const revision = ++commandRevision;
    const isLatest = (): boolean =>
      isCurrent() && revision === commandRevision;
    const repaintLatest = (): void => {
      if (!isLatest()) return;
      update();
    };
    const repaintLatestSafely = (): void => {
      try {
        repaintLatest();
      } catch (error) {
        reportAsyncError(error);
      }
    };
    try {
      const pending = binding.setEnvelope({ ...next });
      void Promise.resolve(pending).then(
        repaintLatestSafely,
        (error: unknown) => {
          if (!isLatest()) return;
          repaintLatestSafely();
          if (isLatest()) reportAsyncError(error);
        },
      );
    } catch (error) {
      if (!isLatest()) return;
      repaintLatestSafely();
      if (isLatest()) reportAsyncError(error);
    }
  };

  const coords = (event: PointerEvent): { x: number; y: number } => {
    const bounds = svg.getBoundingClientRect();
    return {
      x: ((event.clientX - bounds.left) / Math.max(1, bounds.width)) * 100,
      y: ((event.clientY - bounds.top) / Math.max(1, bounds.height)) * 100,
    };
  };

  const endDrag = (event?: PointerEvent): void => {
    if (event && pointerId !== null && event.pointerId !== pointerId) return;
    const captured = pointerId;
    pointerId = null;
    handles.get(drag ?? "a")?.classList.remove("is-dragging");
    drag = null;
    if (captured !== null) {
      try {
        svg.releasePointerCapture?.(captured);
      } catch {
        // Synthetic events and detached SVG elements need no release.
      }
    }
  };

  listen(svg, "pointerdown", ((event: PointerEvent) => {
    if (!isCurrent() || current?.disabled || pointerId !== null) return;
    const candidate = (event.target as SVGElement).getAttribute?.("data-h");
    if (candidate !== "a" && candidate !== "ds" && candidate !== "r") return;
    drag = candidate;
    pointerId = event.pointerId;
    handles.get(candidate)?.classList.add("is-dragging");
    event.preventDefault();
    try {
      svg.setPointerCapture?.(event.pointerId);
    } catch {
      // Synthetic pointer events can still exercise the drag contract.
    }
  }) as EventListener);
  listen(svg, "pointermove", ((event: PointerEvent) => {
    if (
      !isCurrent() ||
      current?.disabled ||
      !drag ||
      pointerId !== event.pointerId ||
      !current
    )
      return;
    const { x, y } = coords(event);
    const next = { ...current.envelope };
    if (drag === "a") {
      next.attack = clamp01(x / SEGMENT) * current.ranges.attackMax;
    } else if (drag === "ds") {
      const attackX = clamp01(next.attack / current.ranges.attackMax) * SEGMENT;
      next.decay = clamp01((x - attackX) / SEGMENT) * current.ranges.decayMax;
      next.sustain = clamp01(1 - y / HEIGHT);
    } else {
      const decayX =
        clamp01(next.attack / current.ranges.attackMax) * SEGMENT +
        clamp01(next.decay / current.ranges.decayMax) * SEGMENT +
        SEGMENT;
      next.release =
        clamp01((x - decayX) / SEGMENT) * current.ranges.releaseMax;
    }
    commit(next);
  }) as EventListener);
  listen(svg, "pointerup", ((event: PointerEvent) =>
    endDrag(event)) as EventListener);
  listen(svg, "pointercancel", ((event: PointerEvent) =>
    endDrag(event)) as EventListener);
  listen(svg, "lostpointercapture", ((event: PointerEvent) =>
    endDrag(event)) as EventListener);

  for (const [stage, input] of inputByStage) {
    listen(input, "focus", (() =>
      handles
        .get(handleForStage(stage))
        ?.classList.add("is-focused")) as EventListener);
    listen(input, "blur", (() =>
      handles
        .get(handleForStage(stage))
        ?.classList.remove("is-focused")) as EventListener);
    listen(input, "input", (() => {
      if (!isCurrent() || !current || input.disabled) return;
      const next = { ...current.envelope };
      const maximum = Number(input.max);
      next[stage] = clamp01(finite(Number(input.value), 0) / maximum) * maximum;
      commit(next);
    }) as EventListener);
  }

  const rollback = (): void => {
    destroyed = true;
    updateLoop.cancel();
    endDrag();
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
    roundHandles?.destroy();
    roundHandles = undefined;
    root.remove();
    style?.remove();
    claim.release();
  };

  const handle: EnvelopeHandle = {
    element: root,
    update,
    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      updateLoop.cancel();
      commandRevision += 1;
      let cleanupError: unknown;
      try {
        endDrag();
      } catch (error) {
        cleanupError ??= error;
      }
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
        roundHandles?.destroy();
      } catch (error) {
        cleanupError ??= error;
      }
      roundHandles = undefined;
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

  // Claim ownership first: cleanup/onError callbacks from the prior presenter
  // may themselves remount this host.
  const claim = claimHost(mountedEnvelopes, host, handle);
  try {
    claim.destroyPrevious();
    if (!isCurrent()) return handle;
    host.append(...(style ? [style] : []), root);
    if (!isCurrent()) return handle;
    const nextRoundHandles = keepSvgCirclesRound(
      svg,
      () => handles.values(),
      {onError: reportAsyncError},
    );
    if (!isCurrent()) {
      nextRoundHandles.destroy();
      return handle;
    }
    roundHandles = nextRoundHandles;
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
