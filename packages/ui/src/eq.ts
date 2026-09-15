import {installStyle} from './internal/style';
import {createErrorSink, claimHost, createUpdateLoop} from "./internal/lifecycle";
import {markEmptyState, addClassNames, clamp, finite, setParts} from './internal/dom';
import {componentSurfaceCss, controlBorderFallback} from './internal/surface';
import {surfaceHeight} from './internal/control';
import {keepSvgCirclesRound, type RoundSvgCirclesHandle} from './internal/svg';
// Domain-neutral graphic equalizer presenter. It owns only DOM and interaction;
// the binding owns filters, response calculation and audio-resource lifetime.

export interface EqBandState {
  frequency: number;
  gain?: number;
  q?: number;
  disabled?: boolean;
}

export interface EqResponsePoint {
  /** Normalized logarithmic frequency position. */
  x: number;
  /** Response gain in dB. */
  gain: number;
}

export interface EqState {
  bands: EqBandState[];
  response?: EqResponsePoint[];
  ready?: boolean;
  disabled?: boolean;
}

/** Structural presenter port. It owns no DOM or audio resource. */
export interface EqBinding {
  snapshot(): EqState;
  setBand(
    index: number,
    band: {frequency: number; gain: number},
  ): Promise<void> | void;
  subscribe?(notify: () => void): () => void;
}

export interface EqClassNames {
  root?: string;
  svg?: string;
  grid?: string;
  zero?: string;
  area?: string;
  curve?: string;
  points?: string;
  point?: string;
  readout?: string;
  empty?: string;
  input?: string;
}

export type EqParts = EqClassNames;

export interface EqOptions {
  label?: string;
  emptyLabel?: string;
  classNames?: EqClassNames;
  parts?: EqParts;
  formatFrequency?: (frequency: number) => string;
  onError?: (error: unknown) => void;
  /** Install the exported stylesheet into the host. Defaults to true. */
  stylesheet?: boolean;
}

export interface EqHandle {
  element: HTMLElement;
  svg: SVGSVGElement;
  update(): void;
  destroy(): void;
}

export interface MountedEqHandle extends EqHandle {
  /**
   * The presenter-owned empty-state node. Callers that replace its content go
   * through this accessor instead of depending on the internal markup.
   */
  emptyElement(): HTMLElement;
}

type EqHost = HTMLElement | ShadowRoot;

const mountedEq = new WeakMap<EqHost, EqHandle>();
const SVG_NS = "http://www.w3.org/2000/svg";
const MIN_FREQUENCY = 30;
const MAX_FREQUENCY = 18_000;
const MAX_GAIN = 18;

export const eqStyle = String.raw`
.wui-eq,
.wui-eq * { box-sizing: border-box; }
.wui-eq {
${componentSurfaceCss('eq')}
  position: relative;
  display: block;
  min-width: 0;
  max-width: 100%;
  overflow: hidden;
  color: var(--wm-eq-text, var(--wm-foreground-muted, var(--wm-foreground, #666)));
  user-select: none;
}
.wui-eq__svg {
  display: block;
  width: 100%;
  height: ${surfaceHeight('eq', 'md')};
  overflow: visible;
  touch-action: none;
  border: 1px solid var(--wm-eq-border, ${controlBorderFallback});
  border-radius: var(--wm-eq-radius, var(--wm-control-radius, 0));
  background: var(--wm-eq-background, var(--wm-surface-inverse, #111));
}
.wui-eq__grid { stroke: var(--wm-eq-grid, rgba(255,255,255,.12)); stroke-width: .5; }
.wui-eq__zero { stroke: var(--wm-eq-zero, rgba(255,255,255,.3)); stroke-width: .6; stroke-dasharray: 2 2; }
.wui-eq__area { fill: var(--wm-eq-fill, rgba(255,255,255,.1)); stroke: none; }
.wui-eq__curve { fill: none; stroke: var(--wm-eq-curve, var(--wm-foreground-on-inverse, #fff)); stroke-width: 1.5; vector-effect: non-scaling-stroke; }
.wui-eq__point { fill: var(--wm-eq-point, var(--wm-foreground-on-inverse, #fff)); stroke: var(--wm-eq-point-border, ${controlBorderFallback}); stroke-width: 1; cursor: grab; }
.wui-eq__point.is-focused { stroke: var(--wm-focus, var(--wm-focus-ring, Highlight)); stroke-width: 2.5; vector-effect: non-scaling-stroke; }
.wui-eq[aria-disabled='true'] .wui-eq__point { cursor: default; opacity: .55; }
.wui-eq__readout { padding: .4rem .5rem; min-width: 0; overflow-wrap: anywhere; color: inherit; font: 600 .68rem/1.5 var(--wm-font-mono, ui-monospace, monospace); font-variant-numeric: tabular-nums; }
.wui-eq__readout:empty { display: none; }
.wui-eq__empty { padding: .4rem .5rem; overflow-wrap: anywhere; color: inherit; font: .78rem/1.4 var(--wm-font-family, var(--wm-font, system-ui, sans-serif)); }
.wui-eq__inputs { position: absolute; top: 0; left: 0; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
.wui-eq__empty[hidden] { display: none; }
.wui-eq__input { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
.wui-eq:focus-within { outline: 2px solid var(--wm-focus, var(--wm-focus-ring, currentColor)); outline-offset: 2px; }
@media (forced-colors: active) {
  .wui-eq { border-color: CanvasText; }
  .wui-eq__svg { border-color: CanvasText; background: Canvas; }
  .wui-eq__point { fill: CanvasText; stroke: Canvas; }
  .wui-eq__point.is-focused { stroke: Highlight; }
}
`;

function normalizeBand(band: EqBandState | undefined): EqBandState {
  return {
    frequency: clamp(band?.frequency, MIN_FREQUENCY, MAX_FREQUENCY, MIN_FREQUENCY),
    gain: clamp(band?.gain, -MAX_GAIN, MAX_GAIN, 0),
    q: Math.max(Number.EPSILON, finite(band?.q, 1)),
    disabled: band?.disabled === true,
  };
}

function normalizeState(state: EqState | null | undefined): EqState {
  return {
    bands: (state?.bands ?? []).map(normalizeBand),
    response: (state?.response ?? []).map((point) => ({
      x: clamp(point.x, 0, 1, 0),
      gain: finite(point.gain),
    })),
    ready: state?.ready === true,
    disabled: state?.disabled === true,
  };
}

function frequencyToX(frequency: number): number {
  return (
    Math.log2(clamp(frequency, MIN_FREQUENCY, MAX_FREQUENCY, MIN_FREQUENCY) / MIN_FREQUENCY) /
    Math.log2(MAX_FREQUENCY / MIN_FREQUENCY)
  );
}

function xToFrequency(x: number): number {
  return MIN_FREQUENCY * Math.pow(MAX_FREQUENCY / MIN_FREQUENCY, clamp(x, 0, 1, 0));
}

function gainToY(gain: number): number {
  return 0.5 - clamp(gain, -MAX_GAIN, MAX_GAIN, 0) / (MAX_GAIN * 2);
}

function yToGain(y: number): number {
  return -(clamp(y, 0, 1, 0.5) - 0.5) * MAX_GAIN * 2;
}

function defaultFormatFrequency(frequency: number): string {
  return frequency >= 1_000
    ? `${(frequency / 1_000).toFixed(frequency >= 10_000 ? 0 : 1)}k`
    : String(Math.round(frequency));
}


/** Mount an accessible graphic-EQ editor over a structural binding. */
export function mountEq(host: EqHost, binding: EqBinding, options: EqOptions = {}): MountedEqHandle {
  const document = host.ownerDocument;
  const style = installStyle(document, 'eq', eqStyle, options.stylesheet);
  const root = document.createElement("div");
  root.className = "wui-eq";
  addClassNames(root, options.classNames?.root);
  setParts(root, "root", options.parts?.root);
  root.setAttribute("role", "group");
  root.setAttribute("aria-label", options.label ?? "Equalizer");

  const svg = document.createElementNS(SVG_NS, "svg");
  svg.classList.add("wui-eq__svg");
  addClassNames(svg, options.classNames?.svg);
  setParts(svg, "svg", options.parts?.svg);
  svg.setAttribute("viewBox", "0 0 100 100");
  svg.setAttribute("preserveAspectRatio", "none");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");

  const grid = document.createElementNS(SVG_NS, "g");
  grid.classList.add("wui-eq__grid");
  addClassNames(grid, options.classNames?.grid);
  setParts(grid, "grid", options.parts?.grid);
  for (const position of [25, 50, 75]) {
    const vertical = document.createElementNS(SVG_NS, "line");
    vertical.setAttribute("x1", String(position));
    vertical.setAttribute("y1", "0");
    vertical.setAttribute("x2", String(position));
    vertical.setAttribute("y2", "100");
    grid.append(vertical);
  }
  for (const position of [25, 75]) {
    const horizontal = document.createElementNS(SVG_NS, "line");
    horizontal.setAttribute("x1", "0");
    horizontal.setAttribute("y1", String(position));
    horizontal.setAttribute("x2", "100");
    horizontal.setAttribute("y2", String(position));
    grid.append(horizontal);
  }
  const zero = document.createElementNS(SVG_NS, "line");
  zero.classList.add("wui-eq__zero");
  addClassNames(zero, options.classNames?.zero);
  setParts(zero, "zero", options.parts?.zero);
  zero.setAttribute("x1", "0");
  zero.setAttribute("y1", "50");
  zero.setAttribute("x2", "100");
  zero.setAttribute("y2", "50");
  const area = document.createElementNS(SVG_NS, "polygon");
  area.classList.add("wui-eq__area");
  addClassNames(area, options.classNames?.area);
  setParts(area, "area", options.parts?.area);
  area.setAttribute("fill", "none");
  const curve = document.createElementNS(SVG_NS, "polyline");
  curve.classList.add("wui-eq__curve");
  addClassNames(curve, options.classNames?.curve);
  setParts(curve, "curve", options.parts?.curve);
  curve.setAttribute("fill", "none");
  const points = document.createElementNS(SVG_NS, "g");
  points.classList.add("wui-eq__points");
  addClassNames(points, options.classNames?.points);
  setParts(points, "points", options.parts?.points);
  svg.append(grid, zero, area, curve, points);

  const readout = document.createElement("div");
  readout.className = "wui-eq__readout";
  addClassNames(readout, options.classNames?.readout);
  setParts(readout, "readout", options.parts?.readout);
  const empty = document.createElement("div");
  empty.className = "wui-eq__empty";
  addClassNames(empty, options.classNames?.empty);
  setParts(empty, "empty", options.parts?.empty);
  markEmptyState(empty);
  empty.textContent = options.emptyLabel ?? "Connect an equalizer graph";
  const inputs = document.createElement("div");
  inputs.className = "wui-eq__inputs";
  root.append(svg, readout, empty, inputs);

  let destroyed = false;
  let current = normalizeState(undefined);
  let lastGood = current;
  let pointerId: number | undefined;
  let dragIndex = -1;
  let focusedInput: HTMLInputElement | undefined;
  const commandRevisions = new Map<number, number>();
  const cleanups: Array<() => void> = [];
  let roundPoints: RoundSvgCirclesHandle | undefined;

  const isCurrent = (): boolean => !destroyed && mountedEq.get(host) === handle;
  const report = createErrorSink(options.onError);

  const rebuildBands = (state: EqState): void => {
    const pointNodes = state.bands.map((band, index) => {
      const point = document.createElementNS(SVG_NS, "circle");
      point.classList.add("wui-eq__point");
      addClassNames(point, options.classNames?.point);
      setParts(point, "point", options.parts?.point);
      point.setAttribute("data-i", String(index));
      point.setAttribute("r", "3.6");
      return point;
    });
    points.replaceChildren(...pointNodes);
    const controls: HTMLElement[] = [];
    state.bands.forEach((band, index) => {
      const frequency = document.createElement("input");
      frequency.type = "range";
      frequency.min = "0";
      frequency.max = "1";
      frequency.step = "0.001";
      frequency.className = "wui-eq__input";
      frequency.dataset.i = String(index);
      frequency.dataset.axis = "frequency";
      frequency.setAttribute("aria-label", `Band ${index + 1} frequency`);
      addClassNames(frequency, options.classNames?.input);
      setParts(frequency, "input", options.parts?.input);
      const gain = frequency.cloneNode() as HTMLInputElement;
      gain.dataset.axis = "gain";
      gain.setAttribute("aria-label", `Band ${index + 1} gain`);
      frequency.addEventListener("input", () => {
        submit(index, Number(frequency.value), gainToY(current.bands[index]?.gain ?? 0));
      });
      gain.addEventListener("input", () => {
        submit(index, frequencyToX(current.bands[index]?.frequency ?? MIN_FREQUENCY), 1 - Number(gain.value));
      });
      controls.push(frequency, gain);
    });
    inputs.replaceChildren(...controls);
    focusedInput = undefined;
  };

  const paintFocusAndReadout = (state: EqState): void => {
    const focusedIndex = focusedInput && !focusedInput.disabled ? Number(focusedInput.dataset.i) : -1;
    for (let index = 0; index < points.children.length; index++) {
      points.children[index]?.classList.toggle("is-focused", index === focusedIndex);
    }
    const format = options.formatFrequency ?? defaultFormatFrequency;
    const bandText = (band: EqBandState): string => {
      const gain = band.gain ?? 0;
      return `${format(band.frequency)} ${gain >= 0 ? "+" : ""}${gain.toFixed(1)}dB`;
    };
    const focusedBand = state.bands[focusedIndex];
    readout.textContent = focusedBand
      ? `Band ${focusedIndex + 1} ${focusedInput?.dataset.axis}: ${bandText(focusedBand)}`
      : state.bands.map(bandText).join("  ·  ");
  };

  const paint = (state: EqState): void => {
    if (points.childElementCount !== state.bands.length) rebuildBands(state);
    root.setAttribute("aria-disabled", String(state.disabled === true));
    empty.hidden = state.ready === true;
    const response = state.response ?? [];
    const curvePoints = response
      .map((point) => `${point.x * 100},${gainToY(point.gain) * 100}`)
      .join(" ");
    curve.setAttribute("points", curvePoints);
    area.setAttribute("points", curvePoints ? `0,100 ${curvePoints} 100,100` : "");
    state.bands.forEach((band, index) => {
      const point = points.children[index] as SVGCircleElement | undefined;
      point?.setAttribute("cx", String(frequencyToX(band.frequency) * 100));
      point?.setAttribute("cy", String(gainToY(band.gain ?? 0) * 100));
      const frequencyInput = inputs.querySelector<HTMLInputElement>(`input[data-i="${index}"][data-axis="frequency"]`);
      const gainInput = inputs.querySelector<HTMLInputElement>(`input[data-i="${index}"][data-axis="gain"]`);
      if (frequencyInput) {
        frequencyInput.value = String(frequencyToX(band.frequency));
        frequencyInput.setAttribute("aria-valuetext", `${Math.round(band.frequency)} hertz`);
        frequencyInput.disabled = state.disabled === true || band.disabled === true;
      }
      if (gainInput) {
        gainInput.value = String(1 - gainToY(band.gain ?? 0));
        gainInput.setAttribute("aria-valuetext", `${(band.gain ?? 0).toFixed(1)} decibels`);
        gainInput.disabled = state.disabled === true || band.disabled === true;
      }
    });
    roundPoints?.update();
    paintFocusAndReadout(state);
  };

  const onFocus = (event: FocusEvent): void => {
    if (destroyed) return;
    const target = (event.type === "focusin" ? event.target : event.relatedTarget) as HTMLInputElement | null;
    focusedInput = target?.nodeType === 1 && inputs.contains(target) && target.matches("input[data-axis]") ? target : undefined;
    try {
      paintFocusAndReadout(current);
    } catch (error) {
      report(error);
    }
  };
  inputs.addEventListener("focusin", onFocus);
  inputs.addEventListener("focusout", onFocus);
  cleanups.push(
    () => inputs.removeEventListener("focusin", onFocus),
    () => inputs.removeEventListener("focusout", onFocus),
  );

  // The old loop reported "did not stabilize" whenever it had used all 32
  // passes, including the case where the last of them settled cleanly. The
  // shared loop reports only when it gave up with a pass still pending.
  const updateLoop = createUpdateLoop({
    name: "Equalizer",
    pass: () => {
      try {
        const next = normalizeState(binding.snapshot());
        paint(next);
        current = next;
        lastGood = next;
      } catch (error) {
        report(error);
        try {
          paint(lastGood);
          current = lastGood;
        } catch {
          // Keep the last committed DOM if its formatter is also failing.
        }
      }
    },
    isCurrent: () => !destroyed && isCurrent(),
    report,
  });
  const update = (): void => updateLoop.run();

  const submit = (index: number, x: number, y: number): void => {
    if (!isCurrent() || current.disabled || current.bands[index]?.disabled) return;
    const previous = current.bands[index];
    if (!previous) return;
    const revision = (commandRevisions.get(index) ?? 0) + 1;
    commandRevisions.set(index, revision);
    const band = normalizeBand({
      ...previous,
      frequency: Math.round(xToFrequency(x)),
      gain: yToGain(y),
    });
    const bands = current.bands.map((entry, entryIndex) => entryIndex === index ? band : entry);
    const optimistic = {...current, bands};
    try {
      paint(optimistic);
      current = optimistic;
    } catch (error) {
      report(error);
      update();
      return;
    }
    if (!isCurrent() || commandRevisions.get(index) !== revision) return;
    let pending: Promise<void> | void;
    try {
      pending = binding.setBand(index, {
        frequency: band.frequency,
        gain: band.gain ?? 0,
      });
    } catch (error) {
      if (isCurrent() && commandRevisions.get(index) === revision) {
        commandRevisions.delete(index);
        update();
        report(error);
      }
      return;
    }
    void Promise.resolve(pending).then(
      () => {
        if (!isCurrent() || commandRevisions.get(index) !== revision) return;
        commandRevisions.delete(index);
        update();
      },
      (error) => {
        if (!isCurrent() || commandRevisions.get(index) !== revision) return;
        commandRevisions.delete(index);
        update();
        if (isCurrent()) report(error);
      },
    );
  };

  const coordinates = (event: PointerEvent): {x: number; y: number} => {
    const rect = svg.getBoundingClientRect();
    return {
      x: clamp((event.clientX - rect.left) / Math.max(1, rect.width), 0, 1, 0),
      y: clamp((event.clientY - rect.top) / Math.max(1, rect.height), 0, 1, 0.5),
    };
  };

  const onPointerDown = (event: PointerEvent): void => {
    const rawIndex = (event.target as Element | null)?.getAttribute?.("data-i");
    if (rawIndex == null || pointerId !== undefined) return;
    const index = Number(rawIndex);
    if (!Number.isInteger(index) || current.disabled || current.bands[index]?.disabled) return;
    pointerId = event.pointerId;
    dragIndex = index;
    try {
      svg.setPointerCapture?.(event.pointerId);
    } catch {
      // Synthetic pointer.
    }
  };
  const onPointerMove = (event: PointerEvent): void => {
    if (event.pointerId !== pointerId || dragIndex < 0) return;
    const {x, y} = coordinates(event);
    submit(dragIndex, x, y);
  };
  const releasePointer = (event: PointerEvent): void => {
    if (event.pointerId !== pointerId) return;
    pointerId = undefined;
    dragIndex = -1;
    try {
      svg.releasePointerCapture?.(event.pointerId);
    } catch {
      // Synthetic pointer.
    }
  };
  svg.addEventListener("pointerdown", onPointerDown);
  svg.addEventListener("pointermove", onPointerMove);
  svg.addEventListener("pointerup", releasePointer);
  svg.addEventListener("pointercancel", releasePointer);
  svg.addEventListener("lostpointercapture", releasePointer);
  cleanups.push(
    () => svg.removeEventListener("pointerdown", onPointerDown),
    () => svg.removeEventListener("pointermove", onPointerMove),
    () => svg.removeEventListener("pointerup", releasePointer),
    () => svg.removeEventListener("pointercancel", releasePointer),
    () => svg.removeEventListener("lostpointercapture", releasePointer),
  );

  const handle: MountedEqHandle = {
    element: root,
    svg,
    emptyElement: () => empty,
    update,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      commandRevisions.clear();
      let firstError: unknown;
      let failed = false;
      try {
        roundPoints?.destroy();
      } catch (error) {
        failed = true;
        firstError = error;
      }
      roundPoints = undefined;
      for (const cleanup of cleanups.splice(0).reverse()) {
        try {
          cleanup();
        } catch (error) {
          if (!failed) {
            failed = true;
            firstError = error;
          }
        }
      }
      claim.release();
      root.remove();
      style?.remove();
      if (failed) report(firstError);
    },
  };
  // Claim the host before destroying the previous mount: its cleanup may mount
  // a replacement, and that replacement must win.
  const claim = claimHost(mountedEq, host, handle);
  claim.destroyPrevious();
  if (!claim.isCurrent()) return handle;

  host.append(...(style ? [style] : []), root);
  if (!claim.isCurrent()) {
    // A re-entrant mount took the host while this one was appending; leave it
    // exactly as that mount left it.
    root.remove();
    style?.remove();
    return handle;
  }
  const nextRoundPoints = keepSvgCirclesRound(
    svg,
    () => points.querySelectorAll<SVGCircleElement>('.wui-eq__point'),
    {onError: report},
  );
  if (!claim.isCurrent()) {
    nextRoundPoints.destroy();
    return handle;
  }
  roundPoints = nextRoundPoints;
  try {
    update();
    if (binding.subscribe) cleanups.push(binding.subscribe(update));
    return handle;
  } catch (error) {
    handle.destroy();
    throw error;
  }
}
