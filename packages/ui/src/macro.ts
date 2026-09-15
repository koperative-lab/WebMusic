import {claimHost} from "./internal/lifecycle";
import {installStyle} from "./internal/style";
import {markEmptyState, addClassNames, clamp01, finite, setParts} from "./internal/dom";
import {componentSurfaceCss} from "./internal/surface";
import {mountParameterRack, type ParameterRackHandle} from "./parameter";

export interface MacroTargetState { label: string; value: number; unit?: string; }
export interface MacroState { label: string; value: number; targets: readonly MacroTargetState[]; disabled?: boolean; }
export interface MacroBinding {
  snapshot(): MacroState;
  setValue(value: number): Promise<void> | void;
  subscribe?(notify: () => void): () => void;
}
export interface MacroOptions {
  onError?: (error: unknown) => void;
  /** Install the exported stylesheet into the host. Defaults to true. */
  stylesheet?: boolean;
}
export interface MacroHandle { element: HTMLElement; update(): void; destroy(): void; }

export interface MacroRackClassNames {
  root?: string;
  item?: string;
}

export interface MacroRackParts {
  root?: string;
  item?: string;
}

export interface MacroRackOptions extends MacroOptions {
  classNames?: MacroRackClassNames;
  parts?: MacroRackParts;
}

export interface MacroRackHandle extends MacroHandle {
  readonly items: readonly MacroHandle[];
  item(index: number): MacroHandle | undefined;
}

type MacroHost = HTMLElement | ShadowRoot;
const mounted = new WeakMap<MacroHost, MacroHandle>();
const mountedRacks = new WeakMap<MacroHost, MacroRackHandle>();

export const macroStyle = `
.wui-macro, .wui-macro * { box-sizing:border-box; }
.wui-macro {
${componentSurfaceCss('macro', {
  padding: 'var(--wm-macro-padding, .6rem)',
  border: '1px solid var(--wm-macro-border, var(--wm-border, #d8d8d8))',
  radius: 'var(--wm-macro-radius, var(--wm-control-radius, 0))',
  background: 'var(--wm-macro-background, var(--wm-surface, #fff))',
})}
display:flex; flex-wrap:wrap; min-width:0; max-width:100%; gap:.8rem; align-items:center; font:.8rem var(--wm-font-family,var(--wm-font,system-ui,sans-serif)); }
.wui-macro__control { flex:0 1 auto; min-width:0; max-width:100%; }
.wui-macro__control .wui-parameter-rack { border:0; padding:0; background:transparent; }
.wui-macro__targets { flex:1 1 12rem; display:flex; flex-direction:column; gap:.2rem; min-width:0; max-width:100%; }
.wui-macro__target { display:flex; flex-wrap:wrap; justify-content:space-between; gap:.2rem .6rem; min-width:0; }
.wui-macro__target-label { min-width:0; overflow-wrap:anywhere; color:var(--wm-macro-label,var(--wm-foreground-muted, var(--wm-foreground, #666))); font-size:.72rem; }
.wui-macro__target-value { min-width:0; overflow-wrap:anywhere; color:var(--wm-macro-foreground,var(--wm-foreground,#444)); font-size:.72rem; font-variant-numeric:tabular-nums; }
.wui-macro__empty { color:var(--wm-foreground-muted, var(--wm-foreground, #999)); font-size:.72rem; }
`;

export const macroRackStyle = `
.wui-macro-rack {
${componentSurfaceCss('macro-rack')}
display:flex; flex-direction:column; gap:var(--wm-macro-rack-gap,.55rem); min-width:0; }
.wui-macro-rack__item { display:block; min-width:0; }
.wui-macro-rack__item > .wui-macro { box-sizing:border-box; padding:0; border:0; border-radius:0; background:transparent; }
`;

function format(value: number, unit?: string): string {
  const text = Math.abs(value) >= 100 ? String(Math.round(value)) : value.toFixed(Math.abs(value) >= 10 ? 1 : 2);
  return `${text}${unit ?? ""}`;
}

export function mountMacro(host: MacroHost, binding: MacroBinding, options: MacroOptions = {}): MacroHandle {
  const document = host.ownerDocument;
  const style = installStyle(document, "macro", macroStyle, options.stylesheet);
  const root = document.createElement("div");
  root.className = "wui-macro";
  root.setAttribute("part", "root");
  const control = document.createElement("div");
  control.className = "wui-macro__control";
  control.setAttribute("part", "control");
  const targets = document.createElement("div");
  targets.className = "wui-macro__targets";
  targets.setAttribute("part", "targets");
  root.append(control, targets);
  let destroyed = false;
  let state: MacroState = {label: "MACRO", value: 0, targets: []};
  let unsubscribe: (() => void) | undefined;

  const read = (): MacroState => {
    const next = binding.snapshot();
    return {
      label: String(next.label ?? "MACRO"),
      value: clamp01(next.value),
      targets: (next.targets ?? []).map((target) => ({label: String(target.label), value: finite(target.value), unit: target.unit})),
      disabled: next.disabled === true,
    };
  };
  const renderTargets = (): void => {
    targets.replaceChildren(...(state.targets.length ? state.targets.map((target, index) => {
      const row = document.createElement("div");
      row.className = "wui-macro__target dest";
      const label = document.createElement("span");
      label.className = "wui-macro__target-label dn";
      label.textContent = target.label;
      const value = document.createElement("span");
      value.className = "wui-macro__target-value dv";
      value.dataset.i = String(index);
      value.textContent = format(target.value, target.unit);
      row.append(label, value);
      return row;
    }) : [emptyTargets()]));
  };
  function emptyTargets(): HTMLElement {
    const node = document.createElement("div");
    node.className = "wui-macro__empty empty";
    node.textContent = "Assign .targets";
    markEmptyState(node);
    return node;
  }
  const update = (): void => {
    if (destroyed) return;
    try {
      state = read();
      parameter?.update();
      renderTargets();
    } catch (error) { options.onError?.(error); }
  };
  // Declared before the handle, because claiming the host makes destroy() and
  // update() reachable from the previous mount's cleanup — while a `const`
  // declared further down is still in its temporal dead zone, and `?.` does not
  // save a TDZ reference.
  let parameter: ParameterRackHandle | undefined = undefined;
  const handle: MacroHandle = {
    element: root,
    update,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      unsubscribe?.();
      parameter?.destroy();
      claim.release();
      root.remove();
      style?.remove();
    },
  };
  // Claim the host before destroying the previous mount: its cleanup may mount
  // a replacement, and that replacement must win.
  const claim = claimHost(mounted, host, handle);
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
  state = read();
  parameter = mountParameterRack(control, {
    snapshot: () => ({parameters: [{id: "macro", label: state.label, value: state.value, min: 0, max: 1, step: .005}], disabled: state.disabled}),
    setValue: (_id, value) => binding.setValue(value),
  }, {
    layout: "flat",
    classNames: {item: "knobwrap", label: "name", control: "knob", track: "track", fill: "arc", pointer: "ptr", value: "pct"},
    formatValue: (_parameter, value) => `${Math.round(value * 100)}%`,
    onError: options.onError,
    stylesheet: options.stylesheet,
  });
  renderTargets();
  if (binding.subscribe) unsubscribe = binding.subscribe(update);
  return handle;
}

/**
 * Mount a list of macros as one compound presenter. The rack owns every item
 * host, so consumers never need to manufacture wrappers around `mountMacro`.
 */
export function mountMacroRack(
  host: MacroHost,
  bindings: readonly MacroBinding[],
  options: MacroRackOptions = {},
): MacroRackHandle {
  const document = host.ownerDocument;
  const style = installStyle(document, "macro-rack", macroRackStyle, options.stylesheet);
  const root = document.createElement("div");
  root.className = "wui-macro-rack";
  addClassNames(root, options.classNames?.root);
  setParts(root, "root", options.parts?.root);

  const items: MacroHandle[] = [];

  let destroyed = false;
  const handle: MacroRackHandle = {
    element: root,
    items,
    item: (index) => items[index],
    update() {
      if (destroyed) return;
      for (const item of items) item.update();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      for (const item of items) item.destroy();
      claim.release();
      root.remove();
      style?.remove();
    },
  };
  // Claim the host before destroying the previous mount: its cleanup may mount
  // a replacement, and that replacement must win.
  const claim = claimHost(mountedRacks, host, handle);
  claim.destroyPrevious();
  if (!claim.isCurrent()) return handle;

  host.append(...(style ? [style] : []), root);

  // Children are mounted only once this rack owns the host: building them
  // earlier would subscribe the new macros before the previous rack's children
  // had unsubscribed.
  for (const binding of bindings) {
    const itemHost = document.createElement("div");
    itemHost.className = "wui-macro-rack__item";
    addClassNames(itemHost, options.classNames?.item);
    setParts(itemHost, "item", options.parts?.item);
    root.append(itemHost);
    items.push(mountMacro(itemHost, binding, {
      onError: options.onError,
      stylesheet: options.stylesheet,
    }));
  }
  if (!claim.isCurrent()) return handle;
  return handle;
}
