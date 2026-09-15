import {installStyle} from './internal/style';
import {claimHost, createUpdateLoop} from "./internal/lifecycle";
import {markEmptyState, addClassNames, clamp, finite, setParts} from './internal/dom';
import {componentSurfaceCss, controlBorderFallback} from './internal/surface';
// ============================================================================
// Domain-neutral parameter-rack presenter.
//
// It owns accessible knob markup, styling and listener cleanup. The caller
// owns parameter state and every command behind the structural binding.
// ============================================================================

export interface ParameterRackItem {
  /** Stable and unique for the lifetime of one mounted rack. */
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  options?: readonly string[];
  group?: string;
  disabled?: boolean;
}

export interface ParameterRackState {
  parameters: readonly ParameterRackItem[];
  disabled?: boolean;
}

/** Structural presenter port; it owns no DOM or domain resource. */
export interface ParameterRackBinding {
  snapshot(): ParameterRackState;
  setValue(id: string, value: number): Promise<void> | void;
  /** Optional because callback-only parameter lists have no external updates. */
  subscribe?(notify: () => void): () => void;
}

export interface ParameterRackClassNames {
  root?: string;
  group?: string;
  groupLabel?: string;
  items?: string;
  item?: string;
  label?: string;
  control?: string;
  track?: string;
  fill?: string;
  pointer?: string;
  input?: string;
  value?: string;
  empty?: string;
}

export interface ParameterRackParts {
  root?: string;
  group?: string;
  groupLabel?: string;
  items?: string;
  item?: string;
  label?: string;
  control?: string;
  track?: string;
  fill?: string;
  pointer?: string;
  input?: string;
  value?: string;
  empty?: string;
}

export interface ParameterRackOptions {
  /** Flat racks border each item; grouped racks border each named group. */
  layout?: "flat" | "grouped";
  emptyLabel?: string;
  formatValue?: (parameter: ParameterRackItem, value: number) => string;
  classNames?: ParameterRackClassNames;
  parts?: ParameterRackParts;
  onError?: (error: unknown) => void;
  /** Install the exported stylesheet into the host. Defaults to true. */
  stylesheet?: boolean;
}

export interface ParameterRackHandle {
  element: HTMLElement;
  update(): void;
  destroy(): void;
}

/**
 * The handle `mountParameterRack` returns: the base lifecycle plus stable
 * accessors for presenter-rendered nodes. Consumers that decorate rack DOM
 * must go through these accessors — the markup between them (wrapper
 * structure, `wui-*` class names, node order) is not public contract.
 */
export interface MountedParameterRackHandle extends ParameterRackHandle {
  /** The rendered container for the parameter with this id, if present. */
  itemElement(id: string): HTMLElement | undefined;
  /** The rendered range input for the parameter with this id, if present. */
  inputElement(id: string): HTMLInputElement | undefined;
  /** The placeholder rendered while the snapshot has no parameters. */
  emptyElement(): HTMLElement | undefined;
}

type ParameterHost = HTMLElement | ShadowRoot;

interface NormalizedParameter extends ParameterRackItem {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  options?: readonly string[];
}

interface ParameterNodes {
  id: string;
  item: HTMLElement;
  input: HTMLInputElement;
  fill: SVGPathElement;
  pointer: SVGLineElement;
  value: HTMLElement;
}

const mountedParameterRacks = new WeakMap<ParameterHost, ParameterRackHandle>();
const SVG_NS = "http://www.w3.org/2000/svg";
const KNOB_CX = 20;
const KNOB_CY = 20;
const KNOB_RADIUS = 16;
const KNOB_POINTER_RADIUS = 18.5;
const KNOB_START = -135;
const KNOB_END = 135;
let parameterRackSequence = 0;

export const parameterRackStyle = String.raw`
.wui-parameter-rack,
.wui-parameter-rack * { box-sizing: border-box; }
.wui-parameter-rack {
${componentSurfaceCss('parameter', {
  padding: 'var(--wm-parameter-padding, .6rem)',
  border: '1px solid var(--wm-parameter-border, var(--wm-border, #d8d8d8))',
  radius: 'var(--wm-parameter-radius, var(--wm-control-radius, 0))',
  background: 'var(--wm-parameter-background, var(--wm-surface, #fff))',
})}
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: var(--wm-parameter-gap, .6rem);
  min-width: 0;
  max-width: 100%;
  color: var(--wm-parameter-foreground, var(--wm-foreground, #444));
  font: .8rem/1.3 var(--wm-font-family, system-ui, sans-serif);
}
.wui-parameter-rack__group {
  display: flex;
  flex-direction: column;
  min-width: 0;
  max-width: 100%;
  gap: var(--wm-parameter-group-gap, .4rem);
  padding: .45rem .5rem .55rem;
  border: 1px solid var(--wm-parameter-item-border, var(--wm-parameter-border, ${controlBorderFallback}));
  border-radius: var(--wm-parameter-item-radius, var(--wm-parameter-radius, var(--wm-control-radius, 0)));
  background: var(--wm-parameter-item-background, var(--wm-parameter-background, var(--wm-surface, #fff)));
}
.wui-parameter-rack__group-label {
  min-width: 0;
  overflow-wrap: anywhere;
  color: var(--wm-parameter-heading, var(--wm-parameter-foreground, var(--wm-foreground, #444)));
  font-size: .66rem;
  font-weight: 600;
  letter-spacing: .03em;
  text-transform: uppercase;
}
.wui-parameter-rack__items {
  display: flex;
  flex-wrap: wrap;
  min-width: 0;
  max-width: 100%;
  align-items: flex-start;
  gap: var(--wm-parameter-item-gap, .5rem);
}
.wui-parameter-rack__item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: .25rem;
  min-width: 0;
  max-width: 100%;
}
.wui-parameter-rack[data-layout='flat'] > .wui-parameter-rack__item {
  padding: .4rem .35rem;
  border: 1px solid var(--wm-parameter-item-border, var(--wm-parameter-border, ${controlBorderFallback}));
  border-radius: var(--wm-parameter-item-radius, var(--wm-parameter-radius, var(--wm-control-radius, 0)));
  background: var(--wm-parameter-item-background, var(--wm-parameter-background, var(--wm-surface, #fff)));
}
.wui-parameter-rack__label {
  max-width: min(100%, var(--wm-parameter-label-width, 5rem));
  overflow-wrap: anywhere;
  color: var(--wm-parameter-label, var(--wm-foreground-muted, var(--wm-foreground, #666)));
  font-size: .68rem;
  text-align: center;
}
.wui-parameter-rack__control {
  position: relative;
  display: block;
  width: var(--wm-parameter-size, 46px);
  height: var(--wm-parameter-size, 46px);
  border-radius: 50%;
}
.wui-parameter-rack__control svg { display: block; width: 100%; height: 100%; }
.wui-parameter-rack__track {
  fill: none;
  stroke: var(--wm-parameter-track, #dcdcdc);
  stroke-width: var(--wm-parameter-stroke, 5);
  stroke-linecap: butt;
}
.wui-parameter-rack__fill {
  fill: none;
  stroke: var(--wm-parameter-fill, var(--wm-accent, #999));
  stroke-width: var(--wm-parameter-stroke, 5);
  stroke-linecap: butt;
}
.wui-parameter-rack__pointer {
  stroke: var(--wm-parameter-pointer, var(--wm-foreground, #111));
  stroke-width: 3;
  stroke-linecap: butt;
}
.wui-parameter-rack__input {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  margin: 0;
  opacity: 0;
  cursor: ns-resize;
  appearance: none;
  writing-mode: vertical-lr;
  direction: rtl;
}
.wui-parameter-rack__control:focus-within {
  outline: 2px solid var(--wm-focus, var(--wm-focus-ring, currentColor));
  outline-offset: 2px;
}
.wui-parameter-rack__input:disabled { cursor: default; }
.wui-parameter-rack__item.is-disabled { opacity: .45; }
.wui-parameter-rack__value {
  max-width: min(100%, var(--wm-parameter-label-width, 5rem));
  overflow-wrap: anywhere;
  color: var(--wm-parameter-value, var(--wm-parameter-foreground, var(--wm-foreground, #444)));
  font-size: .7rem;
  font-variant-numeric: tabular-nums;
  text-align: center;
}
.wui-parameter-rack__empty {
  color: var(--wm-parameter-label, var(--wm-foreground-muted, var(--wm-foreground, #777)));
  font-size: .72rem;
}
@media (forced-colors: active) {
  .wui-parameter-rack,
  .wui-parameter-rack__group,
  .wui-parameter-rack[data-layout='flat'] > .wui-parameter-rack__item { border-color: CanvasText; }
  .wui-parameter-rack__track { stroke: GrayText; }
  .wui-parameter-rack__fill { stroke: Highlight; }
  .wui-parameter-rack__pointer { stroke: CanvasText; }
}
`;

function polar(radius: number, degrees: number): [number, number] {
  const angle = (degrees * Math.PI) / 180;
  return [
    KNOB_CX + radius * Math.sin(angle),
    KNOB_CY - radius * Math.cos(angle),
  ];
}

function arcPath(radius: number, start: number, end: number): string {
  const [x1, y1] = polar(radius, start);
  const [x2, y2] = polar(radius, end);
  const large = Math.abs(end - start) > 180 ? 1 : 0;
  return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${radius} ${radius} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
}

function normalize(parameter: ParameterRackItem): NormalizedParameter {
  const choices =
    Array.isArray(parameter.options) && parameter.options.length > 0
      ? parameter.options.map(String)
      : undefined;
  let min = choices ? 0 : finite(parameter.min);
  let max = choices ? choices.length - 1 : finite(parameter.max, 1);
  if (max < min) [min, max] = [max, min];
  const requestedStep = finite(parameter.step, 0.01);
  const step = choices ? 1 : requestedStep > 0 ? requestedStep : 0.01;
  const value = clamp(finite(parameter.value, min), min, max);
  return {
    ...parameter,
    id: String(parameter.id ?? ""),
    label: String(parameter.label ?? ""),
    value,
    min,
    max,
    step,
    options: choices,
  };
}

function formatNumber(value: number): string {
  if (Number.isInteger(value)) return String(value);
  if (Math.abs(value) >= 100) return value.toFixed(1).replace(/\.0$/, "");
  return value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

function defaultFormat(parameter: ParameterRackItem, value: number): string {
  const option = parameter.options?.[Math.round(value)];
  if (option !== undefined) return option;
  return `${formatNumber(value)}${parameter.unit ? ` ${parameter.unit}` : ""}`;
}

function structureSignature(
  parameters: readonly NormalizedParameter[],
  layout: string,
): string {
  return JSON.stringify([
    layout,
    ...parameters.map((parameter) => [
      parameter.id ?? "",
      parameter.label,
      parameter.min,
      parameter.max,
      parameter.step,
      parameter.unit ?? "",
      parameter.group ?? "",
      parameter.options ?? [],
    ]),
  ]);
}

function createSvg(
  document: Document,
  classes: ParameterRackClassNames | undefined,
  parts: ParameterRackParts | undefined,
) {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 40 40");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");

  const track = document.createElementNS(SVG_NS, "path");
  track.classList.add("wui-parameter-rack__track");
  addClassNames(track, classes?.track);
  setParts(track, "track", parts?.track);
  track.setAttribute("fill", "none");
  track.setAttribute("d", arcPath(KNOB_RADIUS, KNOB_START, KNOB_END));

  const fill = document.createElementNS(SVG_NS, "path");
  fill.classList.add("wui-parameter-rack__fill");
  addClassNames(fill, classes?.fill);
  setParts(fill, "fill", parts?.fill);
  fill.setAttribute("fill", "none");

  const pointer = document.createElementNS(SVG_NS, "line");
  pointer.classList.add("wui-parameter-rack__pointer");
  addClassNames(pointer, classes?.pointer);
  setParts(pointer, "pointer", parts?.pointer);
  pointer.setAttribute("x1", String(KNOB_CX));
  pointer.setAttribute("y1", String(KNOB_CY));
  pointer.setAttribute("x2", String(KNOB_CX));
  pointer.setAttribute("y2", String(KNOB_CY));
  svg.append(track, fill, pointer);
  return { svg, fill, pointer };
}

/**
 * Mount an accessible flat or grouped rotary-parameter rack. The returned
 * handle's `itemElement`/`inputElement`/`emptyElement` accessors are the
 * stable way to reach presenter-rendered nodes.
 */
export function mountParameterRack(
  host: ParameterHost,
  binding: ParameterRackBinding,
  options: ParameterRackOptions = {},
): MountedParameterRackHandle {
  const document = host.ownerDocument;
  const layout = options.layout === "grouped" ? "grouped" : "flat";
  const style = installStyle(document, 'parameter', parameterRackStyle, options.stylesheet);
  const root = document.createElement("div");
  root.className = "wui-parameter-rack";
  root.dataset.layout = layout;
  addClassNames(root, options.classNames?.root);
  setParts(root, "root", options.parts?.root);

  let destroyed = false;
  let signature = "";
  let nodes: ParameterNodes[] = [];
  let emptyNode: HTMLElement | undefined;
  let parameters: NormalizedParameter[] = [];
  const nodeCleanups: Array<() => void> = [];
  const commandRevisions = new Map<string, number>();
  const groupLabelIds = new Map<string, string>();
  const groupIdPrefix = `wui-parameter-rack-${++parameterRackSequence}-group`;
  let groupSequence = 0;
  let unsubscribe: (() => void) | undefined;
  const isCurrent = (): boolean =>
    !destroyed && mountedParameterRacks.get(host) === handle;
  const reportError = (error: unknown): void => options.onError?.(error);
  const reportAsyncError = (error: unknown): void => {
    if (!isCurrent()) return;
    try {
      reportError(error);
    } catch {
      // An async error boundary must not turn a reporting callback failure
      // into an unhandled rejection.
    }
  };
  const format = options.formatValue ?? defaultFormat;

  const paint = (
    record: ParameterNodes,
    parameter: NormalizedParameter,
    value: number,
  ): boolean => {
    if (!isCurrent()) return false;
    const current = clamp(
      finite(value, parameter.min),
      parameter.min,
      parameter.max,
    );
    const fraction =
      parameter.max > parameter.min
        ? (current - parameter.min) / (parameter.max - parameter.min)
        : 0;
    const angle = KNOB_START + fraction * (KNOB_END - KNOB_START);
    const fillPath =
      fraction > 0 ? arcPath(KNOB_RADIUS, KNOB_START, angle) : "";
    const [x, y] = polar(KNOB_POINTER_RADIUS, angle);
    let text: string;
    try {
      text = format(parameter, current);
    } catch (error) {
      if (!isCurrent()) return false;
      reportError(error);
      if (!isCurrent()) return false;
      text = defaultFormat(parameter, current);
    }
    if (!isCurrent()) return false;
    record.fill.setAttribute("d", fillPath);
    record.pointer.setAttribute("x2", x.toFixed(2));
    record.pointer.setAttribute("y2", y.toFixed(2));
    record.input.value = String(current);
    record.value.textContent = text;
    record.input.setAttribute("aria-valuetext", text);
    return true;
  };

  const listen = (
    target: EventTarget,
    type: string,
    listener: EventListener,
    cleanups: Array<() => void>,
  ): void => {
    target.addEventListener(type, listener);
    cleanups.push(() => target.removeEventListener(type, listener));
  };

  const createItem = (
    parameter: NormalizedParameter,
    targetNodes: ParameterNodes[],
    targetCleanups: Array<() => void>,
  ): HTMLElement => {
    const item = document.createElement("div");
    item.className = "wui-parameter-rack__item";
    item.dataset.parameterId = parameter.id;
    addClassNames(item, options.classNames?.item);
    setParts(item, "item", options.parts?.item);

    const label = document.createElement("span");
    label.className = "wui-parameter-rack__label";
    label.textContent = parameter.label;
    label.title = parameter.label;
    addClassNames(label, options.classNames?.label);
    setParts(label, "label", options.parts?.label);

    const control = document.createElement("span");
    control.className = "wui-parameter-rack__control";
    addClassNames(control, options.classNames?.control);
    setParts(control, "control", options.parts?.control);
    const { svg, fill, pointer } = createSvg(
      document,
      options.classNames,
      options.parts,
    );

    const input = document.createElement("input");
    input.type = "range";
    input.className = "wui-parameter-rack__input";
    input.dataset.parameterId = parameter.id;
    input.min = String(parameter.min);
    input.max = String(parameter.max);
    input.step = String(parameter.step);
    input.defaultValue = String(parameter.value);
    input.setAttribute("aria-label", parameter.label);
    addClassNames(input, options.classNames?.input);
    setParts(input, "input", options.parts?.input);
    control.append(svg, input);

    const value = document.createElement("span");
    value.className = "wui-parameter-rack__value";
    addClassNames(value, options.classNames?.value);
    setParts(value, "value", options.parts?.value);
    item.append(label, control, value);

    const record = { id: parameter.id, item, input, fill, pointer, value };
    targetNodes.push(record);
    listen(
      input,
      "input",
      (() => {
        if (destroyed || input.disabled) return;
        const currentParameter = parameters.find(({ id }) => id === record.id);
        if (!currentParameter) return;
        const next = clamp(
          finite(Number(input.value), currentParameter.min),
          currentParameter.min,
          currentParameter.max,
        );
        if (!paint(record, currentParameter, next)) return;
        const revision = (commandRevisions.get(record.id) ?? 0) + 1;
        commandRevisions.set(record.id, revision);
        const repaintLatest = (): void => {
          if (!isCurrent() || commandRevisions.get(record.id) !== revision)
            return;
          try {
            update();
          } catch (error) {
            reportAsyncError(error);
          }
        };
        try {
          const pending = binding.setValue(record.id, next);
          void Promise.resolve(pending).then(
            repaintLatest,
            (error: unknown) => {
              repaintLatest();
              reportAsyncError(error);
            },
          );
        } catch (error) {
          repaintLatest();
          reportAsyncError(error);
        }
      }) as EventListener,
      targetCleanups,
    );
    return item;
  };

  const buildStructure = (next: readonly NormalizedParameter[]) => {
    const fragment = document.createDocumentFragment();
    const nextNodes: ParameterNodes[] = [];
    const nextCleanups: Array<() => void> = [];
    let nextEmpty: HTMLElement | undefined;

    try {
      if (next.length === 0) {
        const empty = document.createElement("div");
        empty.className = "wui-parameter-rack__empty";
        empty.textContent = options.emptyLabel ?? "No parameters";
        addClassNames(empty, options.classNames?.empty);
        setParts(empty, "empty", options.parts?.empty);
        markEmptyState(empty);
        fragment.append(empty);
        nextEmpty = empty;
      } else if (layout === "flat") {
        next.forEach((parameter) =>
          fragment.append(createItem(parameter, nextNodes, nextCleanups)),
        );
      } else {
        const groups = new Map<string, NormalizedParameter[]>();
        next.forEach((parameter) => {
          const key = parameter.group ?? "";
          const entries = groups.get(key) ?? [];
          entries.push(parameter);
          groups.set(key, entries);
        });
        for (const [groupName, entries] of groups) {
          const group = document.createElement("div");
          group.className = "wui-parameter-rack__group";
          addClassNames(group, options.classNames?.group);
          setParts(group, "group", options.parts?.group);
          if (groupName) {
            group.setAttribute("role", "group");
            const groupLabel = document.createElement("div");
            groupLabel.className = "wui-parameter-rack__group-label";
            groupLabel.textContent = groupName;
            groupLabel.title = groupName;
            let groupLabelId = groupLabelIds.get(groupName);
            if (!groupLabelId) {
              groupLabelId = `${groupIdPrefix}-${++groupSequence}`;
              groupLabelIds.set(groupName, groupLabelId);
            }
            groupLabel.id = groupLabelId;
            group.setAttribute("aria-labelledby", groupLabelId);
            addClassNames(groupLabel, options.classNames?.groupLabel);
            setParts(groupLabel, "group-label", options.parts?.groupLabel);
            group.append(groupLabel);
          }
          const items = document.createElement("div");
          items.className = "wui-parameter-rack__items";
          addClassNames(items, options.classNames?.items);
          setParts(items, "items", options.parts?.items);
          entries.forEach((parameter) =>
            items.append(createItem(parameter, nextNodes, nextCleanups)),
          );
          group.append(items);
          fragment.append(group);
        }
      }
    } catch (error) {
      for (const cleanup of nextCleanups) {
        try {
          cleanup();
        } catch {
          // Preserve the build failure after best-effort cleanup.
        }
      }
      throw error;
    }

    return {
      fragment,
      nodes: nextNodes,
      cleanups: nextCleanups,
      empty: nextEmpty,
    };
  };

  const rebuild = (
    next: readonly NormalizedParameter[],
    nextSignature: string,
  ): unknown => {
    let built: ReturnType<typeof buildStructure> | undefined;
    try {
      built = buildStructure(next);
      root.replaceChildren(built.fragment);
    } catch (error) {
      for (const cleanup of built?.cleanups ?? []) {
        try {
          cleanup();
        } catch {
          // Preserve the build failure after best-effort cleanup.
        }
      }
      throw error;
    }

    let cleanupError: unknown;
    for (const cleanup of nodeCleanups.splice(0)) {
      try {
        cleanup();
      } catch (error) {
        cleanupError ??= error;
      }
    }
    nodes = built.nodes;
    emptyNode = built.empty;
    nodeCleanups.push(...built.cleanups);
    parameters = [...next];
    signature = nextSignature;
    return cleanupError;
  };

  const performUpdate = (): void => {
    if (!isCurrent()) return;
    let disabled = false;
    let next: NormalizedParameter[];
    let nextSignature: string;
    try {
      const state = binding.snapshot();
      disabled = state?.disabled === true;
      next = Array.from(state?.parameters ?? []).map(normalize);
      const ids = new Set<string>();
      for (const parameter of next) {
        if (ids.has(parameter.id)) {
          throw new TypeError(`Duplicate parameter id: ${parameter.id}`);
        }
        ids.add(parameter.id);
      }
      nextSignature = structureSignature(next, layout);
    } catch (error) {
      if (isCurrent()) reportError(error);
      return;
    }
    if (!isCurrent()) return;

    if (nextSignature !== signature) {
      let cleanupError: unknown;
      try {
        cleanupError = rebuild(next, nextSignature);
      } catch (error) {
        if (isCurrent()) reportError(error);
        return;
      }
      if (cleanupError !== undefined) reportError(cleanupError);
    } else {
      parameters = next;
    }
    if (!isCurrent()) return;
    const parameterById = new Map(
      parameters.map((parameter) => [parameter.id, parameter] as const),
    );
    for (const record of nodes) {
      if (!isCurrent()) return;
      const parameter = parameterById.get(record.id);
      if (!parameter) continue;
      record.input.disabled = disabled || parameter.disabled === true;
      record.item.classList.toggle("is-disabled", record.input.disabled);
      if (!paint(record, parameter, parameter.value)) return;
    }
  };

  const updateLoop = createUpdateLoop({
    name: "Parameter rack",
    pass: () => performUpdate(),
    isCurrent,
    report: reportAsyncError,
  });
  const update = (): void => updateLoop.run();

  const rollback = (): void => {
    destroyed = true;
    updateLoop.cancel();
    commandRevisions.clear();
    for (const cleanup of nodeCleanups.splice(0)) {
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
    nodes = [];
    emptyNode = undefined;
    parameters = [];
    claim.release();
  };

  const handle: MountedParameterRackHandle = {
    element: root,
    itemElement: (id) => nodes.find((record) => record.id === id)?.item,
    inputElement: (id) => nodes.find((record) => record.id === id)?.input,
    emptyElement: () => emptyNode,
    update,
    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      updateLoop.cancel();
      commandRevisions.clear();
      let cleanupError: unknown;
      for (const cleanup of nodeCleanups.splice(0)) {
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
      nodes = [];
      emptyNode = undefined;
      parameters = [];
      claim.release();
      if (cleanupError !== undefined) reportError(cleanupError);
    },
  };

  // Claim ownership before destroying the previous rack. Its cleanup and
  // reporting callbacks are allowed to mount a replacement; if they do, this
  // handle becomes an inert, already-destroyed handle and never appends a
  // second rack.
  const claim = claimHost(mountedParameterRacks, host, handle);
  try {
    claim.destroyPrevious();
    if (!isCurrent()) return handle;

    host.append(...(style ? [style] : []), root);
    if (!isCurrent()) return handle;

    try {
      const nextUnsubscribe = binding.subscribe?.(update);
      if (nextUnsubscribe) {
        if (isCurrent()) {
          unsubscribe = nextUnsubscribe;
        } else {
          try {
            nextUnsubscribe();
          } catch {
            // A superseded mount must not report stale cleanup failures.
          }
        }
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
