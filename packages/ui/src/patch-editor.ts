import {claimHost, createErrorSink, createUpdateLoop} from './internal/lifecycle';
import {addClassNames, setParts} from './internal/dom';
import {installStyle} from './internal/style';
import {componentSurfaceCss, controlBorderFallback} from './internal/surface';

export type PatchEditorMode = 'connect' | 'replace' | 'send' | 'tap';
export interface PatchEditorEndpoint { readonly moduleId: string; readonly port: string; }
export interface PatchEditorPosition { readonly x: number; readonly y: number; }
export interface PatchEditorPort {
  readonly id: string;
  readonly label?: string;
  readonly direction: 'input' | 'output';
  readonly kind: string;
  /** Modes offered by this output. Defaults to audio replace/send/tap, otherwise connect. */
  readonly modes?: readonly PatchEditorMode[];
}
export interface PatchEditorModule {
  readonly id: string;
  readonly label: string;
  readonly ports: readonly PatchEditorPort[];
  readonly position?: PatchEditorPosition;
  readonly status?: 'ready' | 'unresolved';
  readonly diagnostic?: string;
}
export interface PatchEditorConnection {
  readonly id: string;
  readonly from: PatchEditorEndpoint;
  readonly to: PatchEditorEndpoint;
  readonly mode?: PatchEditorMode | 'default';
  readonly status?: 'connected' | 'unresolved' | 'error';
  readonly diagnostic?: string;
  /** Defaults to true, except default routes which are always read-only. */
  readonly editable?: boolean;
}
export interface PatchEditorState {
  readonly modules: readonly PatchEditorModule[];
  readonly connections: readonly PatchEditorConnection[];
  readonly disabled?: boolean;
}
export interface PatchEditorConnectRequest {
  readonly from: PatchEditorEndpoint;
  readonly to: PatchEditorEndpoint;
  readonly mode: PatchEditorMode;
}
/** Structural port: the application owns validation, persistence and all graph resources. */
export interface PatchEditorBinding {
  snapshot(): PatchEditorState;
  connect(connection: PatchEditorConnectRequest): Promise<void> | void;
  disconnect(id: string): Promise<void> | void;
  /** Presentation only. Moving a module must not change its routing or stable id. */
  moveModule?(id: string, position: PatchEditorPosition): Promise<void> | void;
  subscribe?(notify: () => void): () => void;
}
export interface PatchEditorClassNames {
  root?: string;
  instructions?: string;
  form?: string;
  viewport?: string;
  canvas?: string;
  module?: string;
  moduleHeader?: string;
  port?: string;
  wire?: string;
  connections?: string;
  connection?: string;
  diagnostic?: string;
  status?: string;
}
export type PatchEditorParts = PatchEditorClassNames;
export interface PatchEditorOptions {
  label?: string;
  classNames?: PatchEditorClassNames;
  parts?: PatchEditorParts;
  onError?: (error: unknown) => void;
  stylesheet?: boolean;
}
export interface PatchEditorHandle {
  readonly element: HTMLElement;
  readonly controls: {
    readonly source: HTMLSelectElement;
    readonly destination: HTMLSelectElement;
    readonly mode: HTMLSelectElement;
    readonly connect: HTMLButtonElement;
    readonly cancel: HTMLButtonElement;
    readonly viewport: HTMLElement;
    readonly status: HTMLElement;
  };
  moduleElement(id: string): HTMLElement | undefined;
  portElement(endpoint: PatchEditorEndpoint): HTMLButtonElement | undefined;
  connectionElement(id: string): HTMLElement | undefined;
  update(): void;
  destroy(): void;
}

type PatchEditorHost = HTMLElement | ShadowRoot;
type PortEntry = {module: PatchEditorModule; port: PatchEditorPort; endpoint: PatchEditorEndpoint};
type ModuleNodes = {element: HTMLElement; header: HTMLButtonElement; label: HTMLElement; diagnostic: HTMLElement; inputs: HTMLElement; outputs: HTMLElement; ports: Map<string, HTMLButtonElement>; cleanups: Array<() => void>};
type ConnectionNodes = {element: HTMLElement; label: HTMLElement; diagnostic: HTMLElement; button: HTMLButtonElement; path: SVGPathElement; cleanups: Array<() => void>};
const mounted = new WeakMap<PatchEditorHost, PatchEditorHandle>();
let sequence = 0;
const SVG_NS = 'http://www.w3.org/2000/svg';
const CARD_WIDTH = 224;
const MARGIN = 24;
const modeLabels = {connect: 'Connect', replace: 'Replace default', send: 'Send', tap: 'Tap', default: 'Default route'};
const endpointKey = (endpoint: PatchEditorEndpoint): string => JSON.stringify([endpoint.moduleId, endpoint.port]);
const sameEndpoint = (first: PatchEditorEndpoint, second: PatchEditorEndpoint): boolean => first.moduleId === second.moduleId && first.port === second.port;

export const patchEditorStyle = String.raw`
.wui-patch-editor, .wui-patch-editor * { box-sizing: border-box; }
.wui-patch-editor {
${componentSurfaceCss('patch-editor')}
  display: flex; flex-direction: column; gap: .75rem; min-width: 0; width: 100%; max-width: 100%;
  color: var(--wm-patch-editor-foreground, var(--wm-foreground, #222));
  font: .8rem/1.4 var(--wm-font-family, system-ui, sans-serif);
}
.wui-patch-editor__instructions, .wui-patch-editor__status { margin: 0; overflow-wrap: anywhere; }
.wui-patch-editor__instructions { color: var(--wm-foreground-muted, #666); }
.wui-patch-editor__form { display: flex; flex-wrap: wrap; align-items: end; gap: .5rem; min-width: 0; }
.wui-patch-editor__field { display: flex; flex: 1 1 10rem; flex-direction: column; gap: .2rem; min-width: 0; }
.wui-patch-editor select, .wui-patch-editor button { font: inherit; color: inherit; }
.wui-patch-editor select { width: 100%; min-width: 0; }
.wui-patch-editor select, .wui-patch-editor__command {
  min-height: 2.25rem; padding: .35rem .5rem; border: 1px solid ${controlBorderFallback};
  border-radius: var(--wm-control-radius, 0); background: var(--wm-control-background, var(--wm-surface, #fff));
}
.wui-patch-editor__command { cursor: pointer; overflow-wrap: anywhere; }
.wui-patch-editor .wui-patch-editor__command--primary { background: var(--wm-accent, #222); color: var(--wm-accent-foreground, #fff); }
.wui-patch-editor :disabled { opacity: .5; cursor: default; }
.wui-patch-editor :focus-visible { outline: 2px solid var(--wm-focus, var(--wm-focus-ring, #486ce6)); outline-offset: 2px; }
.wui-patch-editor__viewport {
  position: relative; min-width: 0; width: 100%; max-width: 100%; height: var(--wm-patch-editor-height, 25rem); overflow: auto;
  border: 1px solid ${controlBorderFallback}; background: var(--wm-patch-editor-canvas, var(--wm-surface-subtle, #f6f6f6));
  overscroll-behavior: contain;
}
.wui-patch-editor__canvas { position: relative; min-width: 100%; min-height: 100%; }
.wui-patch-editor__wires { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; pointer-events: none; }
.wui-patch-editor__wire { fill: none; stroke: var(--wm-patch-editor-wire, var(--wm-accent, #555)); stroke-width: 2; }
.wui-patch-editor__wire[data-mode='default'] { stroke: var(--wm-foreground-muted, #888); stroke-dasharray: 4 4; }
.wui-patch-editor__wire[data-status='unresolved'], .wui-patch-editor__wire[data-status='error'] { stroke: var(--wm-danger, #b42318); stroke-dasharray: 3 3; }
.wui-patch-editor__module {
  position: absolute; width: ${CARD_WIDTH}px; padding: .55rem; border: 1px solid ${controlBorderFallback};
  border-radius: var(--wm-patch-editor-module-radius, var(--wm-control-radius, 0));
  background: var(--wm-patch-editor-module-background, var(--wm-surface, #fff));
}
.wui-patch-editor__module[data-status='unresolved'] { border-style: dashed; }
.wui-patch-editor__header {
  display: block; width: 100%; border: 0; padding: .2rem 0 .55rem; background: transparent;
  text-align: left; font-weight: 650 !important; overflow-wrap: anywhere; cursor: grab; touch-action: none;
}
.wui-patch-editor__header:disabled { opacity: 1; cursor: default; }
.wui-patch-editor__ports { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: .5rem; }
.wui-patch-editor__port-column { display: flex; flex-direction: column; gap: .35rem; min-width: 0; }
.wui-patch-editor__port-column--outputs { align-items: end; }
.wui-patch-editor__port {
  display: inline-flex; align-items: center; gap: .35rem; max-width: 100%; min-height: 2rem;
  border: 1px solid transparent; padding: .25rem .2rem; background: transparent; text-align: left; cursor: crosshair;
}
.wui-patch-editor__port[data-direction='output'] { flex-direction: row-reverse; text-align: right; }
.wui-patch-editor__port::before { content: ''; flex: 0 0 .6rem; width: .6rem; height: .6rem; border: 2px solid currentColor; border-radius: 50%; }
.wui-patch-editor__port span { overflow-wrap: anywhere; }
.wui-patch-editor__port[aria-pressed='true'] { color: var(--wm-patch-editor-selected, var(--wm-accent, #486ce6)); border-color: currentColor; }
.wui-patch-editor__connections { min-width: 0; }
.wui-patch-editor__connections h3 { margin: 0 0 .4rem; font: inherit; font-weight: 650; }
.wui-patch-editor__list { display: flex; flex-direction: column; gap: .4rem; margin: 0; padding: 0; list-style: none; }
.wui-patch-editor__connection { display: flex; flex-wrap: wrap; align-items: center; gap: .35rem .75rem; padding: .5rem; border: 1px solid ${controlBorderFallback}; }
.wui-patch-editor__connection-info { flex: 1 1 15rem; min-width: 0; overflow-wrap: anywhere; }
.wui-patch-editor__diagnostic { margin: .2rem 0; color: var(--wm-danger, #b42318); overflow-wrap: anywhere; }
.wui-patch-editor__diagnostic:empty { display: none; }
.wui-patch-editor__status[data-error='true'] { color: var(--wm-danger, #b42318); }
@media (forced-colors: active) {
  .wui-patch-editor__wire { stroke: CanvasText; }
  .wui-patch-editor__port[aria-pressed='true'] { color: Highlight; }
}
`;

/** Render borrowed module/port state; no graph, resource or project is owned by this presenter. */
export function mountPatchEditor(host: PatchEditorHost, binding: PatchEditorBinding, options: PatchEditorOptions = {}): PatchEditorHandle {
  const document = host.ownerDocument;
  const view = document.defaultView;
  const report = createErrorSink(options.onError);
  const style = installStyle(document, 'patch-editor', patchEditorStyle, options.stylesheet);
  const prefix = `wui-patch-editor-${++sequence}`;
  const make = <K extends keyof HTMLElementTagNameMap>(tag: K, part: keyof PatchEditorParts): HTMLElementTagNameMap[K] => {
    const node = document.createElement(tag);
    node.className = `wui-patch-editor__${part.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`;
    addClassNames(node, options.classNames?.[part]);
    setParts(node, part.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`), options.parts?.[part]);
    return node;
  };
  const root = make('section', 'root'); root.classList.add('wui-patch-editor');
  root.setAttribute('aria-label', options.label ?? 'Patch editor');
  const instructions = make('p', 'instructions'); instructions.id = `${prefix}-instructions`;
  instructions.textContent = 'Choose an output, then an input to connect. Use the form for the same commands. Move a focused module header with arrow keys (Shift: larger steps), or drag it. Escape clears the selection.';
  const form = make('form', 'form'); form.setAttribute('aria-label', 'Connect modules');
  const field = (name: string): HTMLSelectElement => {
    const label = document.createElement('label'); label.className = 'wui-patch-editor__field';
    const text = document.createElement('span'); text.textContent = name;
    const select = document.createElement('select'); select.setAttribute('aria-label', name);
    label.append(text, select); form.append(label); return select;
  };
  const source = field('Source output');
  const destination = field('Destination input');
  const mode = field('Connection mode');
  const command = (label: string): HTMLButtonElement => {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'wui-patch-editor__command'; button.textContent = label; return button;
  };
  const connect = command('Connect'); connect.type = 'submit'; connect.classList.add('wui-patch-editor__command--primary');
  const cancel = command('Clear selection'); form.append(connect, cancel);
  const viewport = make('div', 'viewport'); viewport.tabIndex = 0; viewport.setAttribute('role', 'region'); viewport.setAttribute('aria-label', 'Module canvas');
  const canvas = make('div', 'canvas');
  const svg = document.createElementNS(SVG_NS, 'svg'); svg.classList.add('wui-patch-editor__wires'); svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('focusable', 'false');
  canvas.append(svg); viewport.append(canvas);
  const connections = make('section', 'connections'); connections.setAttribute('aria-label', 'Connections');
  const heading = document.createElement('h3'); heading.textContent = 'Connections';
  const list = document.createElement('ol'); list.className = 'wui-patch-editor__list';
  const empty = document.createElement('p'); empty.textContent = 'No connections.'; empty.setAttribute('part', 'empty');
  connections.append(heading, list, empty);
  const status = make('p', 'status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite'); status.setAttribute('aria-atomic', 'true');
  root.append(instructions, form, viewport, connections, status);

  let destroyed = false;
  let busy = false;
  let snapshotFailure: {error: unknown} | undefined;
  let commandFocus: {original: HTMLElement | null; restore: boolean; moved: boolean; settling: boolean} | undefined;
  let state: PatchEditorState = {modules: [], connections: []};
  let ports = new Map<string, PortEntry>();
  let selectedSource = '';
  let selectedTarget = '';
  let selectedMode: PatchEditorMode = 'connect';
  let unsubscribe: (() => void) | undefined;
  let frame: number | undefined;
  let drag: {id: string; pointerId: number; startX: number; startY: number; origin: PatchEditorPosition; next: PatchEditorPosition; header: HTMLButtonElement} | undefined;
  const modules = new Map<string, ModuleNodes>();
  const rows = new Map<string, ConnectionNodes>();
  const cleanups: Array<() => void> = [];
  let resize: ResizeObserver | undefined;
  const current = (): boolean => !destroyed && mounted.get(host) === handle;
  const listen = (node: EventTarget, type: string, listener: EventListener, releases = cleanups): void => {
    node.addEventListener(type, listener); releases.push(() => node.removeEventListener(type, listener));
  };
  const announce = (message: string, error = false): void => {
    if (!current()) return;
    status.textContent = message; status.dataset.error = String(error);
  };
  const errorMessage = (error: unknown): string => error instanceof Error ? error.message : error === undefined ? 'The change could not be applied.' : String(error);
  const fail = (error: unknown): void => {
    if (!current()) return;
    announce(errorMessage(error), true); report(error);
  };
  const activeElement = (): Element | null => (root.getRootNode() as Document | ShadowRoot).activeElement ?? document.activeElement;
  const orderChildren = (parent: Element, children: readonly Element[]): void => {
    const focused = activeElement() as HTMLElement | null;
    let anchor: ChildNode | null = parent.firstChild;
    for (const child of children) {
      if (anchor !== child) parent.insertBefore(child, anchor);
      anchor = child.nextSibling;
    }
    if (focused && parent.contains(focused) && activeElement() !== focused) focused.focus({preventScroll: true});
  };
  const modulePosition = (module: PatchEditorModule): PatchEditorPosition => {
    const index = state.modules.findIndex((entry) => entry.id === module.id);
    return module.position ?? {x: MARGIN + index % 3 * (CARD_WIDTH + 64), y: MARGIN + Math.floor(index / 3) * 240};
  };
  const canvasOffset = (): PatchEditorPosition => {
    let x = 0, y = 0;
    for (const module of state.modules) {
      const position = drag?.id === module.id ? drag.next : modulePosition(module);
      x = Math.min(x, position.x); y = Math.min(y, position.y);
    }
    return {x: x < 0 ? MARGIN - x : 0, y: y < 0 ? MARGIN - y : 0};
  };
  const modesFor = (entry: PortEntry | undefined): readonly PatchEditorMode[] => entry?.port.modes ?? (entry?.port.kind === 'audio' ? ['replace', 'send', 'tap'] : ['connect']);
  const ready = (entry: PortEntry | undefined): entry is PortEntry => !!entry && entry.module.status !== 'unresolved';
  const canStart = (entry: PortEntry | undefined): entry is PortEntry => ready(entry) && entry.port.direction === 'output' && modesFor(entry).length > 0;
  const compatible = (from: PortEntry | undefined, to: PortEntry | undefined): boolean => ready(from) && ready(to) &&
    from.port.direction === 'output' && to.port.direction === 'input' && from.port.kind === to.port.kind && !sameEndpoint(from.endpoint, to.endpoint);
  const endpointLabel = (endpoint: PatchEditorEndpoint): string => {
    const entry = ports.get(endpointKey(endpoint));
    return entry ? `${entry.module.label} · ${entry.port.label ?? entry.port.id}` : `${endpoint.moduleId} · ${endpoint.port} (unavailable)`;
  };
  const selectOptions = (select: HTMLSelectElement, entries: readonly {value: string; label: string; disabled?: boolean}[], value: string): void => {
    const signature = JSON.stringify(entries);
    if (select.dataset.options !== signature) {
      select.replaceChildren(...entries.map((entry) => {
        const option = document.createElement('option'); option.value = entry.value; option.textContent = entry.label; option.disabled = entry.disabled ?? false; return option;
      }));
      select.dataset.options = signature;
    }
    select.value = value;
  };
  const selection = (): void => {
    if (!ports.has(selectedSource)) selectedSource = '';
    if (!ports.has(selectedTarget)) selectedTarget = '';
    const from = ports.get(selectedSource);
    const choices = modesFor(from);
    if (!choices.includes(selectedMode)) selectedMode = choices[0] ?? 'connect';
    selectOptions(source, [{value: '', label: 'Choose an output'}, ...[...ports].filter(([, entry]) => entry.port.direction === 'output').map(([value, entry]) => ({
      value, label: `${endpointLabel(entry.endpoint)} · ${entry.port.kind}${canStart(entry) ? '' : ' · unavailable'}`, disabled: !canStart(entry),
    }))], selectedSource);
    selectOptions(destination, [{value: '', label: 'Choose an input'}, ...[...ports].filter(([, entry]) => entry.port.direction === 'input').map(([value, entry]) => ({
      value, label: `${endpointLabel(entry.endpoint)} · ${entry.port.kind}${from && !compatible(from, entry) ? ' · incompatible' : ''}`, disabled: !ready(entry) || (!!from && !compatible(from, entry)),
    }))], selectedTarget);
    selectOptions(mode, choices.map((value) => ({value, label: modeLabels[value]})), selectedMode);
    source.disabled = destination.disabled = busy || state.disabled === true;
    mode.disabled = busy || state.disabled === true || !choices.length;
    connect.disabled = busy || state.disabled === true || !choices.length || !compatible(from, ports.get(selectedTarget));
    cancel.disabled = busy || (!selectedSource && !selectedTarget);
    for (const [id, node] of modules) {
      const module = state.modules.find((entry) => entry.id === id)!;
      node.header.disabled = busy || state.disabled === true || !binding.moveModule;
      for (const [key, button] of node.ports) {
        const entry = ports.get(key)!;
        button.disabled = busy || state.disabled === true || module.status === 'unresolved' || (entry.port.direction === 'output' && !canStart(entry)) || (entry.port.direction === 'input' && !!from && (!choices.length || !compatible(from, entry)));
        button.setAttribute('aria-pressed', String(key === selectedSource || key === selectedTarget));
      }
    }
    for (const [id, row] of rows) {
      const connection = state.connections.find((entry) => entry.id === id)!;
      row.button.disabled = busy || state.disabled === true || connection.mode === 'default' || connection.editable === false;
    }
    root.setAttribute('aria-busy', String(busy));
  };
  const draw = (): void => {
    if (!current()) return;
    let width = viewport.clientWidth, height = viewport.clientHeight;
    const offset = canvasOffset();
    for (const module of state.modules) {
      const position = drag?.id === module.id ? drag.next : modulePosition(module);
      const element = modules.get(module.id)?.element;
      if (element) {element.style.left = `${position.x + offset.x}px`; element.style.top = `${position.y + offset.y}px`;}
      width = Math.max(width, position.x + offset.x + CARD_WIDTH + MARGIN);
      height = Math.max(height, position.y + offset.y + (element?.offsetHeight || 180) + MARGIN);
    }
    canvas.style.width = `${width}px`; canvas.style.height = `${height}px`;
    const board = canvas.getBoundingClientRect();
    for (const connection of state.connections) {
      const row = rows.get(connection.id)!;
      const from = modules.get(connection.from.moduleId)?.ports.get(endpointKey(connection.from));
      const to = modules.get(connection.to.moduleId)?.ports.get(endpointKey(connection.to));
      if (!from || !to) { row.path.setAttribute('d', ''); continue; }
      const a = from.getBoundingClientRect(), b = to.getBoundingClientRect();
      const x1 = a.right - board.left - 8, y1 = a.top + a.height / 2 - board.top;
      const x2 = b.left - board.left + 8, y2 = b.top + b.height / 2 - board.top;
      const bend = Math.max(36, Math.abs(x2 - x1) / 2);
      row.path.setAttribute('d', `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`);
    }
  };
  const scheduleDraw = (): void => {
    if (!current() || frame !== undefined) return;
    if (view?.requestAnimationFrame) frame = view.requestAnimationFrame(() => {frame = undefined; draw();});
    else draw();
  };
  const perform = (operation: () => Promise<void> | void, message: string, after?: () => HTMLElement | undefined): void => {
    if (!current() || busy || state.disabled) return;
    const active = activeElement();
    const previous = commandFocus?.settling ? commandFocus : undefined;
    const mayRestore = !previous || (previous.restore && !previous.moved);
    // Native disabled controls lose focus before an error callback can retry.
    // Transfer that settling command's recovery target, never a later user
    // focus choice (even if that choice has since blurred back to the body).
    const inherited = (!active || active === document.body) && mayRestore && previous?.original && root.contains(previous.original) ? previous.original : null;
    const focus = {original: active && root.contains(active) ? active as HTMLElement : inherited,
      restore: mayRestore && (!active || active === document.body || root.contains(active)), moved: false, settling: false};
    commandFocus = focus;
    busy = true; selection(); announce('Applying change…');
    const finish = (failed: boolean, error?: unknown): void => {
      if (!current()) return;
      focus.settling = true;
      try {
        busy = false; update();
        if (!current()) return;
        // Snapshot/error callbacks may already have started or settled another
        // command. Its selection, status and focus now own the presenter. Still
        // report this command's rejection without announcing over the newer one.
        if (commandFocus !== focus) {
          if (failed) report(error);
          return;
        }
        // A synchronous retry can settle inside an existing repaint, where
        // update() is coalesced. Release native disabled controls before focus.
        selection();
        let target = focus.original && root.contains(focus.original) ? focus.original : undefined;
        if (failed) fail(error);
        else target = after?.() ?? target;
        if (!current() || commandFocus !== focus) return;
        // A committed command and a failed read are separate outcomes. Keep the
        // read failure visible even when the command itself completed normally.
        if (snapshotFailure) {
          announce(`${failed ? `Change failed: ${errorMessage(error)}.` : message} View refresh failed: ${errorMessage(snapshotFailure.error)}`, true);
          if (!failed) target = source;
        }
        else if (!failed) announce(message);
        commandFocus = undefined;
        // Disabling a focused native control blurs it in browsers. Restore that
        // position, but never replace focus the user chose while awaiting a command.
        if (focus.restore && !focus.moved && target && root.contains(target)) target.focus();
      } finally { focus.settling = false; }
    };
    try { void Promise.resolve(operation()).then(() => finish(false), (error: unknown) => finish(true, error)); }
    catch (error) { finish(true, error); }
  };
  const connectSelected = (): void => {
    const from = ports.get(selectedSource), to = ports.get(selectedTarget);
    if (!compatible(from, to) || !from || !to || !modesFor(from).includes(selectedMode)) { announce('Choose a compatible output, input and connection mode.', true); return; }
    const request: PatchEditorConnectRequest = {from: {...from.endpoint}, to: {...to.endpoint}, mode: selectedMode};
    perform(() => binding.connect(request), `Connected ${endpointLabel(request.from)} to ${endpointLabel(request.to)}.`, () => {
      selectedSource = selectedTarget = ''; selection(); return source;
    });
  };
  const cancelSelection = (): void => {
    if (busy) return;
    selectedSource = selectedTarget = ''; selection(); announce('Connection selection cleared.');
  };
  const move = (id: string, position: PatchEditorPosition): void => {
    if (!binding.moveModule) return;
    const label = state.modules.find((entry) => entry.id === id)?.label ?? id;
    perform(() => binding.moveModule!(id, position), `${label} moved to ${Math.round(position.x)}, ${Math.round(position.y)}.`, () => modules.get(id)?.header);
  };
  const stopDrag = (commit: boolean): void => {
    const previous = drag; drag = undefined;
    if (!previous) return;
    try { previous.header.releasePointerCapture?.(previous.pointerId); } catch { /* Capture may already be lost. */ }
    if (commit && (previous.next.x !== previous.origin.x || previous.next.y !== previous.origin.y)) move(previous.id, previous.next);
    else update();
  };
  const makeModule = (id: string): ModuleNodes => {
    const element = make('article', 'module'); element.dataset.moduleId = id;
    const header = make('button', 'moduleHeader'); header.type = 'button'; header.classList.add('wui-patch-editor__header'); header.setAttribute('aria-describedby', instructions.id);
    const label = document.createElement('span'); header.append(label);
    const diagnostic = make('p', 'diagnostic');
    const columns = document.createElement('div'); columns.className = 'wui-patch-editor__ports';
    const inputs = document.createElement('div'); inputs.className = 'wui-patch-editor__port-column';
    const outputs = document.createElement('div'); outputs.className = 'wui-patch-editor__port-column wui-patch-editor__port-column--outputs';
    columns.append(inputs, outputs); element.append(header, diagnostic, columns); canvas.append(element);
    const releases: Array<() => void> = [];
    listen(columns, 'click', ((event: MouseEvent) => {
      const button = (event.target as Element | null)?.closest<HTMLButtonElement>('button[data-port-id]');
      if (!button || !columns.contains(button)) return;
      const key = endpointKey({moduleId: id, port: button.dataset.portId!});
      const entry = ports.get(key); if (!ready(entry) || busy || state.disabled || button.disabled) return;
      if (entry.port.direction === 'output') {
        selectedSource = key;
        if (!compatible(entry, ports.get(selectedTarget))) selectedTarget = '';
        selection();
        announce(`${endpointLabel(entry.endpoint)} selected. Choose a compatible input or use the connection form.`);
      } else {
        selectedTarget = key; selection();
        if (selectedSource) connectSelected(); else announce('Input selected. Choose a source output in the form.');
      }
    }) as EventListener, releases);
    listen(header, 'keydown', ((event: KeyboardEvent) => {
      const delta = {ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1]}[event.key];
      if (!delta || header.disabled || event.altKey || event.ctrlKey || event.metaKey) return;
      event.preventDefault();
      const module = state.modules.find((entry) => entry.id === id); if (!module) return;
      const position = modulePosition(module), step = event.shiftKey ? 64 : 16;
      move(id, {x: position.x + delta[0] * step, y: position.y + delta[1] * step});
    }) as EventListener, releases);
    listen(header, 'pointerdown', ((event: PointerEvent) => {
      if (event.button !== 0 || header.disabled || drag) return;
      const module = state.modules.find((entry) => entry.id === id); if (!module) return;
      header.focus();
      if (!current()) return;
      const origin = modulePosition(module);
      drag = {id, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, origin, next: origin, header};
      try { header.setPointerCapture?.(event.pointerId); } catch { /* Global listeners keep drag usable without capture. */ }
    }) as EventListener, releases);
    resize?.observe(element);
    return {element, header, label, diagnostic, inputs, outputs, ports: new Map(), cleanups: releases};
  };
  const validate = (snapshot: PatchEditorState): Map<string, PortEntry> => {
    const ids = new Set<string>(), connections = new Set<string>(), entries = new Map<string, PortEntry>();
    for (const module of snapshot.modules) {
      if (!module.id || ids.has(module.id)) throw new Error('Patch editor module ids must be nonempty and unique.');
      ids.add(module.id);
      if (module.position && (!Number.isFinite(module.position.x) || !Number.isFinite(module.position.y))) throw new Error('Module positions must be finite.');
      for (const port of module.ports) {
        const endpoint = {moduleId: module.id, port: port.id}, key = endpointKey(endpoint);
        if (!port.id || !port.kind || !['input', 'output'].includes(port.direction) || entries.has(key)) throw new Error('Module ports require unique ids, a direction and signal kind.');
        if (port.modes?.some((value) => !['connect', 'replace', 'send', 'tap'].includes(value))) throw new Error('Unknown connection mode.');
        entries.set(key, {module, port, endpoint});
      }
    }
    for (const connection of snapshot.connections) {
      if (!connection.id || connections.has(connection.id)) throw new Error('Connection ids must be nonempty and unique.');
      if (connection.mode && !['connect', 'replace', 'send', 'tap', 'default'].includes(connection.mode)) throw new Error('Unknown connection mode.');
      connections.add(connection.id);
    }
    return entries;
  };
  const paint = (): void => {
    if (!current()) return;
    let next: PatchEditorState, entries: Map<string, PortEntry>;
    try { next = binding.snapshot(); entries = validate(next); } catch (error) {
      if (!current()) return;
      snapshotFailure = {error};
      // The last valid graph still supplies the controls when a read fails.
      // In particular, settlement must release the DOM's busy/disabled state.
      selection(); fail(error); return;
    }
    if (!current()) return;
    snapshotFailure = undefined;
    state = next; ports = entries;
    if (state.disabled && drag) stopDrag(false);
    const moduleIds = new Set(state.modules.map((module) => module.id));
    for (const [id, node] of modules) if (!moduleIds.has(id)) {
      if (drag?.id === id) stopDrag(false);
      resize?.unobserve(node.element); for (const release of node.cleanups) release(); node.element.remove(); modules.delete(id);
    }
    let width = viewport.clientWidth, height = viewport.clientHeight;
    const offset = canvasOffset();
    for (const module of state.modules) {
      let node = modules.get(module.id); if (!node) {node = makeModule(module.id); modules.set(module.id, node);}
      node.label.textContent = module.label;
      node.header.setAttribute('aria-label', `Move ${module.label}`);
      node.element.setAttribute('aria-label', module.label); node.element.dataset.status = module.status ?? 'ready';
      node.diagnostic.textContent = module.diagnostic ?? (module.status === 'unresolved' ? 'Module unavailable. Its identity and saved connections are retained.' : '');
      const position = drag?.id === module.id ? drag.next : modulePosition(module);
      node.element.style.left = `${position.x + offset.x}px`; node.element.style.top = `${position.y + offset.y}px`;
      const portKeys = new Set(module.ports.map((port) => endpointKey({moduleId: module.id, port: port.id})));
      for (const [key, button] of node.ports) if (!portKeys.has(key)) {button.remove(); node.ports.delete(key);}
      for (const port of module.ports) {
        const key = endpointKey({moduleId: module.id, port: port.id});
        let button = node.ports.get(key);
        if (!button) {
          button = make('button', 'port'); button.type = 'button'; button.dataset.portId = port.id;
          const text = document.createElement('span'); button.append(text);
          node.ports.set(key, button);
        }
        button.firstElementChild!.textContent = port.label ?? port.id;
        button.dataset.direction = port.direction; button.dataset.kind = port.kind;
        button.setAttribute('aria-label', `${module.label}, ${port.label ?? port.id}, ${port.direction}, ${port.kind}`);
        const container = port.direction === 'input' ? node.inputs : node.outputs;
        if (button.parentElement !== container) container.append(button);
      }
      for (const direction of ['input', 'output'] as const) orderChildren(direction === 'input' ? node.inputs : node.outputs, module.ports.filter((port) => port.direction === direction).map((port) => node!.ports.get(endpointKey({moduleId: module.id, port: port.id}))!));
      if (!current()) return;
      width = Math.max(width, position.x + offset.x + CARD_WIDTH + MARGIN);
      height = Math.max(height, position.y + offset.y + (node.element.offsetHeight || 180) + MARGIN);
    }
    canvas.style.width = `${width}px`; canvas.style.height = `${height}px`;
    orderChildren(canvas, [svg, ...state.modules.map((module) => modules.get(module.id)!.element)]);
    if (!current()) return;
    const connectionIds = new Set(state.connections.map((connection) => connection.id));
    for (const [id, row] of rows) if (!connectionIds.has(id)) {for (const release of row.cleanups) release(); row.element.remove(); row.path.remove(); rows.delete(id);}
    for (const connection of state.connections) {
      let row = rows.get(connection.id);
      if (!row) {
        const element = make('li', 'connection'); element.dataset.connectionId = connection.id;
        const info = document.createElement('div'); info.className = 'wui-patch-editor__connection-info';
        const label = document.createElement('span'); const diagnostic = make('p', 'diagnostic'); info.append(label, diagnostic);
        const button = command('Disconnect'); element.append(info, button); list.append(element);
        const path = document.createElementNS(SVG_NS, 'path'); path.classList.add('wui-patch-editor__wire'); addClassNames(path, options.classNames?.wire); setParts(path, 'wire', options.parts?.wire); svg.append(path);
        const releases: Array<() => void> = [];
        listen(button, 'click', (() => {
          const item = state.connections.find((entry) => entry.id === connection.id);
          if (!item || item.mode === 'default' || item.editable === false) return;
          const focusIndex = state.connections.findIndex((entry) => entry.id === item.id);
          perform(() => binding.disconnect(item.id), 'Connection removed.', () => {
            const remaining = state.connections.filter((entry) => entry.mode !== 'default' && entry.editable !== false);
            return rows.get(remaining[Math.min(focusIndex, remaining.length - 1)]?.id)?.button ?? source;
          });
        }) as EventListener, releases);
        row = {element, label, diagnostic, button, path, cleanups: releases}; rows.set(connection.id, row);
      }
      const label = `${endpointLabel(connection.from)} → ${endpointLabel(connection.to)} · ${modeLabels[connection.mode ?? 'connect']}`;
      row.label.textContent = label;
      row.button.setAttribute('aria-label', `Disconnect ${endpointLabel(connection.from)} from ${endpointLabel(connection.to)}`);
      row.button.hidden = connection.mode === 'default' || connection.editable === false;
      row.diagnostic.textContent = connection.diagnostic ?? (connection.status && connection.status !== 'connected' ? `Connection ${connection.status}.` : '');
      row.element.dataset.status = row.path.dataset.status = connection.status ?? 'connected';
      row.path.dataset.mode = connection.mode ?? 'connect';
    }
    orderChildren(list, state.connections.map((connection) => rows.get(connection.id)!.element));
    if (!current()) return;
    empty.hidden = state.connections.length !== 0;
    selection(); scheduleDraw();
  };
  const updateLoop = createUpdateLoop({name: 'Patch editor', pass: paint, isCurrent: current, report: fail});
  const update = (): void => updateLoop.run();
  listen(source, 'change', (() => {selectedSource = source.value; selectedTarget = ''; selection();}) as EventListener);
  listen(destination, 'change', (() => {selectedTarget = destination.value; selection();}) as EventListener);
  listen(mode, 'change', (() => {selectedMode = mode.value as PatchEditorMode; selection();}) as EventListener);
  listen(form, 'submit', ((event: SubmitEvent) => {event.preventDefault(); connectSelected();}) as EventListener);
  listen(cancel, 'click', cancelSelection);
  listen(root, 'keydown', ((event: KeyboardEvent) => {
    if (event.key !== 'Escape') return;
    event.preventDefault(); if (drag) stopDrag(false); else cancelSelection();
  }) as EventListener);
  if (view) {
    listen(view, 'resize', scheduleDraw);
    listen(view, 'pointermove', ((event: PointerEvent) => {
      if (!drag || event.pointerId !== drag.pointerId || !current()) return;
      drag.next = {x: drag.origin.x + event.clientX - drag.startX, y: drag.origin.y + event.clientY - drag.startY};
      const offset = canvasOffset();
      const node = modules.get(drag.id); if (node) {node.element.style.left = `${drag.next.x + offset.x}px`; node.element.style.top = `${drag.next.y + offset.y}px`;}
      scheduleDraw();
    }) as EventListener);
    listen(view, 'pointerup', ((event: PointerEvent) => {if (drag?.pointerId === event.pointerId) stopDrag(true);}) as EventListener);
    listen(view, 'pointercancel', ((event: PointerEvent) => {if (drag?.pointerId === event.pointerId) stopDrag(false);}) as EventListener);
  }
  const Resize = view?.ResizeObserver ?? globalThis.ResizeObserver;
  if (Resize) resize = new Resize(scheduleDraw);
  const handle: PatchEditorHandle = {
    element: root, controls: {source, destination, mode, connect, cancel, viewport, status},
    moduleElement: (id) => current() ? modules.get(id)?.element : undefined,
    portElement: (endpoint) => current() ? modules.get(endpoint.moduleId)?.ports.get(endpointKey(endpoint)) : undefined,
    connectionElement: (id) => current() ? rows.get(id)?.element : undefined,
    update,
    destroy(): void {
      if (destroyed) return;
      destroyed = true; commandFocus = undefined; updateLoop.cancel();
      if (frame !== undefined) view?.cancelAnimationFrame(frame); frame = undefined;
      if (drag) {try {drag.header.releasePointerCapture?.(drag.pointerId);} catch { /* Lost capture is already released. */ } drag = undefined;}
      resize?.disconnect();
      for (const release of cleanups.splice(0)) {try {release();} catch (error) {report(error);}}
      for (const node of modules.values()) for (const release of node.cleanups) {try {release();} catch (error) {report(error);}}
      for (const row of rows.values()) for (const release of row.cleanups) {try {release();} catch (error) {report(error);}}
      try {unsubscribe?.();} catch (error) {report(error);} unsubscribe = undefined;
      modules.clear(); rows.clear(); root.remove(); style?.remove(); claim.release();
    },
  };
  const claim = claimHost(mounted, host, handle);
  try {
    claim.destroyPrevious(); if (!current()) return handle;
    host.append(...(style ? [style] : []), root);
    const movedFocus = (): void => { if (commandFocus) commandFocus.moved = true; };
    listen(document, 'focusin', movedFocus);
    const tree = root.getRootNode();
    if (tree !== document) listen(tree, 'focusin', movedFocus);
    resize?.observe(viewport);
    update();
    if (current() && binding.subscribe) {
      const release = binding.subscribe(update);
      if (current()) unsubscribe = release; else release();
    }
  } catch (error) {handle.destroy(); throw error;}
  return handle;
}
