// A component as a page element (DEC-078, Max's standalone): a project made
// of objects runs in a ModuleProjectRuntime over the standard plugins and
// shows its presentation — the interface objects and the components placed
// where the author put them — under a UI Kit transport.
//
// Ownership: `mountComponent` creates and disposes the runtime, its audio
// environment (unless one is lent), the view slots, the elements and their
// bindings. `destroy()` releases everything it made. A player or desk placed
// in the project borrows the runtime's Session (DEC-084); the transport here
// and the player's own command the same Session, which this host preloads as
// members join (DEC-069).

import {sharedBuffersFor} from '@webmusic/audio/play/headless';
import {ModuleAudioEnvironment, ModuleProjectRuntime, ProjectPluginRegistry, parseModuleProject,
  type ModuleProject, type ProjectAssetReference, type ProjectModuleRecord, type ProjectPluginFactory} from '@webmusic/kernel/module';
import {COMPONENT_PLUGIN, POLY_PLUGIN, objectInterfaceOf, OBJECT_PLUGIN_PREFIX} from '@webmusic/kernel/objects';
import {mountTransport, type TransportHandle} from '@webmusic/ui/transport';
import {CONTROL_OBJECTS, controlSize, mountObjectControl, type ObjectControl} from './controls';
import {createComponentPlugins, resolveComponentAsset, type ComponentPluginOptions} from './plugins';
import {componentManifestOf, migrateBufferViews} from './manifest';
import {ComponentSurfaces} from './surfaces';
import type {StyleSource} from './settings';
import {applyComponentStyle, ownStyle, styleDeclarations} from './theme';
import {bindComponentElement, configureComponentElement, createComponentElement, defineComponentElements, fitComponentElement} from './views';

export interface MountComponentOptions extends Omit<ComponentPluginOptions, 'surfaces'> {
  /** Replace the standard plugins entirely; `extra`, `midi`, `wam` and `objects` are then ignored. */
  readonly plugins?: readonly ProjectPluginFactory[];
  /** Load an asset; defaults to `resolveComponentAsset` relative to `base`. */
  readonly resolveAsset?: (asset: ProjectAssetReference, signal: AbortSignal) => unknown | Promise<unknown>;
  /** Base URL for asset URIs. Defaults to the page. */
  readonly base?: string | URL;
  /** Lend an audio environment; by default the component owns one. */
  readonly audio?: ModuleAudioEnvironment;
  /** Let buffers shown by `clip` components be edited and written back. Default false. */
  readonly editableBuffers?: boolean;
  /** Label of the transport and the region. Defaults to the project ID. */
  readonly label?: string;
  /**
   * Whose style the component shows (DEC-090): its `own` theme and its boxes'
   * own styles, the default, or with `inherit` neither, so it takes the style
   * of the page or app that holds it. `ComponentHandle.setStyling` changes it.
   */
  readonly styling?: StyleSource;
  /**
   * Where each shown box goes in a page the host lays out itself (DEC-092):
   * given, the component draws no frame, transport or stage of its own, and
   * each box's Element is put in the element this returns for its record. A
   * box given none is not shown. An official component fills the width of
   * its place; an interface object keeps its own size. The theme is written
   * on `host`.
   */
  readonly place?: (record: ProjectModuleRecord) => HTMLElement | null | undefined;
  readonly onError?: (error: unknown) => void;
}

export interface ComponentHandle {
  readonly runtime: ModuleProjectRuntime;
  /** Settles when the project is restored; rejects with the restore failure. */
  readonly ready: Promise<void>;
  /**
   * The project as it stands: live parameter values and, in the config of
   * each box that plays one, the score as its views edited it (DEC-087).
   * Mounting what it resolves to gives the same component again.
   */
  save(): Promise<ModuleProject>;
  /** Choose whose style the component shows (DEC-090), in place: nothing is rebuilt. */
  setStyling(source: StyleSource): void;
  /** Start the transport; call it from a user gesture so audio may start. */
  play(): Promise<void>;
  pause(): Promise<void>;
  destroy(): void;
}

const STYLE = `
:host { display: block; max-width: 100%; }
.wmc { box-sizing: border-box; display: flex; flex-direction: column; width: max-content; min-width: min(100%, 320px); max-width: 100%; color: var(--wm-foreground, light-dark(#111, #eee)); background: var(--wm-background, var(--wm-surface, light-dark(#fff, #111))); border: var(--wm-component-border, 1px solid var(--wm-border, light-dark(#111, #eee))); border-radius: var(--wm-component-radius, var(--wm-control-radius, 0)); font: 12px/1.4 var(--wm-font-family, ui-monospace, monospace); }
.wmc__bar { display: flex; height: 32px; border-bottom: 1px solid var(--wm-border, light-dark(#111, #eee)); }
.wmc__bar > * { flex: 1; min-width: 0; }
.wmc__stage { position: relative; overflow: auto; scrollbar-width: none; }
.wmc__extent { pointer-events: none; }
.wmc__stage::-webkit-scrollbar { display: none; }
.wmc__item { position: absolute; box-sizing: border-box; }
/* A nested component's contents sit inside its cell, framed as Studio frames them. */
.wmc__nested { border: 1px solid var(--wm-border, light-dark(#111, #eee)); }
/* Each Element is a block, as in Studio's boxes, so the width it is given holds. */
.wmc__item > :not(style) { display: block; }
/* The box carries the width, natural or resized, and the Element fills it: an Element may own its inline width. */
.wmc__item > :not(style) { box-sizing: border-box; width: 100%; }
.wmc__item[data-sized] { overflow: hidden; }
/* Placed by the host in a page of its own (DEC-092): in the flow, a component as wide as its place. */
.wmc__placed { position: relative; box-sizing: border-box; max-width: 100%; }
.wmc__placed > :not(style) { display: block; box-sizing: border-box; width: 100%; }
.wmc__placed[data-kind="component"] { width: 100% !important; }
/* A drawing in a resized box may be shorter than it would choose to be. */
.wmc__item[data-sized] [part~="plot"] { min-height: 32px; }
`;

/** Room around the presentation, so a control's edge never touches the transport. */
const GUTTER = 8;
/** One thing a level of a component shows, where its presentation puts it. */
export interface ComponentContent {
  readonly record: ProjectModuleRecord;
  readonly x: number;
  readonly y: number;
  readonly width?: number;
  readonly height?: number;
  /** An interface object, an official component, or a nested component set to show what it holds. */
  readonly kind: 'control' | 'component' | 'nested';
}

const nameOf = (record: ProjectModuleRecord) => record.plugin.id.startsWith(OBJECT_PLUGIN_PREFIX) ? record.plugin.id.slice(OBJECT_PLUGIN_PREFIX.length) : '';
const isShell = (record: ProjectModuleRecord | undefined) => record?.plugin.id === COMPONENT_PLUGIN || record?.plugin.id === POLY_PLUGIN;

/** What a module shows in a presentation, if anything. */
function contentKind(record: ProjectModuleRecord): ComponentContent['kind'] | undefined {
  if (componentManifestOf(record.plugin.id)) return 'component';
  if (CONTROL_OBJECTS.includes(nameOf(record))) return 'control';
  return isShell(record) && record.config.embed === true ? 'nested' : undefined;
}

/**
 * What one level of a component shows (DEC-089): its interface objects, its
 * official components and the nested components set to show what they hold,
 * each where the presentation puts it — or, when nothing of that level is
 * placed, where it sits on the canvas. `shell` names a nested component; by
 * default the level is the component itself, everything not inside a nested
 * one. Studio's boxes and `mountComponent` show the same things.
 */
export function componentContents(input: unknown, shell?: string): readonly ComponentContent[] {
  const project = parseModuleProject(input);
  const byId = new Map(project.modules.map(record => [record.id, record]));
  const contexts = new Map(project.contexts.map(context => [context.id, context]));
  // A context belongs to the nearest nested component that owns it or one of its parents.
  const owner = (contextId: string): string | undefined => {
    for (let context = contexts.get(contextId); context; context = context.parentId ? contexts.get(context.parentId) : undefined) {
      if (context.ownerModuleId && isShell(byId.get(context.ownerModuleId))) return context.ownerModuleId;
    }
    return undefined;
  };
  // Copies of a poly's voices repeat the first voice; show none of them.
  const members = project.modules.filter(record => owner(record.contextId) === shell && !record.id.includes('~v'));
  const shown = new Map(members.flatMap(record => { const kind = contentKind(record); return kind ? [[record.id, kind] as const] : []; }));
  const placed = (project.layout.presentation ?? []).filter(item => shown.has(item.moduleId));
  if (placed.length) {
    return placed.map(item => ({record: byId.get(item.moduleId)!, x: item.x, y: item.y, kind: shown.get(item.moduleId)!,
      ...(item.width !== undefined ? {width: item.width} : {}), ...(item.height !== undefined ? {height: item.height} : {})}));
  }
  const positions = new Map(project.layout.modules.map(item => [item.moduleId, item]));
  return members.filter(record => shown.has(record.id)).map(record => {
    const at = positions.get(record.id);
    return {record, x: at?.x ?? 0, y: at?.y ?? 0, kind: shown.get(record.id)!,
      ...(at?.width !== undefined ? {width: at.width} : {}), ...(at?.height !== undefined ? {height: at.height} : {})};
  });
}

/**
 * Preload a runtime's Session as members join it (DEC-069): the host owns that
 * Session, so a placed player's sound, parameters and inserts are real before
 * the first play, as they are for a player that owns its Session on a page.
 * It creates no AudioContext of its own and resumes none. Returns the release
 * function.
 */
export function keepComponentSessionPreloaded(runtime: ModuleProjectRuntime, onError: (error: unknown) => void = () => {}): () => void {
  let released = false, scheduled = false;
  let session = runtime.session;
  let unwatch: (() => void) | undefined;
  // A member whose score is a document still being applied (DEC-086) cannot prepare yet. That is a moment, not a
  // failure: the preload is asked again shortly, a bounded number of times, and only then reported.
  let waits = 0;
  let waiting: ReturnType<typeof setTimeout> | undefined;
  const notReady = (error: unknown) => (error as {name?: unknown; code?: unknown} | null)?.name === 'ScoreDocumentApplicationError'
    && (error as {code?: unknown}).code === 'not-ready';
  const failed = (error: unknown, current: unknown) => {
    if (released || runtime.session !== current) return;
    if (!notReady(error) || waits >= 20) { onError(error); return; }
    waits += 1;
    waiting = setTimeout(() => { waiting = undefined; schedule(); }, 100);
  };
  const run = () => {
    scheduled = false;
    const current = runtime.session;
    if (released || !current) return;
    let pending: Promise<void>;
    try { pending = current.preload(); } catch (error) { failed(error, current); return; }
    void pending.then(() => { waits = 0; }, error => failed(error, current));
  };
  const schedule = () => { if (!scheduled && !released) { scheduled = true; queueMicrotask(run); } };
  const watch = () => {
    unwatch?.();
    session = runtime.session;
    unwatch = session?.subscribe(event => { if (event.type === 'participants') schedule(); });
    if (session) schedule();
  };
  watch();
  // A rebuild replaces the Session; follow the new one.
  const stop = runtime.subscribe(() => { if (runtime.session !== session) watch(); });
  return () => { released = true; if (waiting !== undefined) clearTimeout(waiting); stop(); unwatch?.(); unwatch = undefined; };
}

/** Run `project` in `host` and show its presentation. */
export function mountComponent(host: HTMLElement | ShadowRoot, input: unknown, options: MountComponentOptions = {}): ComponentHandle {
  // A presented buffer showed its samples before DEC-081; a `clip` shows them now.
  const project = migrateBufferViews(parseModuleProject(input));
  const document = (host as Node).ownerDocument ?? globalThis.document;
  const report = options.onError ?? ((error: unknown) => console.error(error));
  const surfaces = new ComponentSurfaces();
  const audio = options.audio ?? new ModuleAudioEnvironment();
  const registry = new ProjectPluginRegistry();
  const registrations = (options.plugins ?? createComponentPlugins({...options, surfaces, objects: {onError: report, ...options.objects}}))
    .map(plugin => registry.register(plugin));
  const runtime = new ModuleProjectRuntime({
    audio, plugins: registry, connect: surfaces.connect, onCleanupError: report,
    resolveAsset: options.resolveAsset ?? ((asset, signal) => resolveComponentAsset(asset, signal, options.base)),
  });
  defineComponentElements();

  const root = document.createElement('div');
  root.className = 'wmc';
  root.setAttribute('role', 'region');
  root.setAttribute('aria-label', options.label ?? project.id);
  const style = document.createElement('style');
  // The component's theme (DEC-088) sits at its host from inside a shadow root, where a rule the page writes for the
  // element wins over it; mounted in a plain host, it is written on the root this function makes.
  const shadowed = typeof (host as ShadowRoot).host === 'object' && (host as ShadowRoot).host !== null;
  const themed = styleDeclarations(project.layout.style);
  // Whose style is shown (DEC-090): inheriting, neither the theme nor any box's own style is written.
  let styling: StyleSource = options.styling === 'inherit' ? 'inherit' : 'own';
  const configOf = (record: ProjectModuleRecord) => styling === 'own' ? record.config : {...record.config, styling: 'inherit'};
  const styled: (() => void)[] = [];
  // A host that places the boxes itself (DEC-092) is given no frame: the root stays off the page.
  const placing = typeof options.place === 'function';
  const themeHost = placing && typeof (host as HTMLElement).style === 'object' ? host as HTMLElement : root;
  const applyTheme = () => {
    style.textContent = shadowed && themed && styling === 'own' ? `${STYLE}:host { ${themed} }\n` : STYLE;
    if (!shadowed) applyComponentStyle(themeHost, styling === 'own' ? project.layout.style : undefined);
  };
  applyTheme();
  const bar = document.createElement('div');
  bar.className = 'wmc__bar';
  const stage = document.createElement('div');
  stage.className = 'wmc__stage';
  root.append(bar, stage);
  host.append(style);
  if (!placing) host.append(root);

  const resume = () => {
    const context = audio.peek() as AudioContext | undefined;
    if (context?.state === 'suspended' && typeof context.resume === 'function') void context.resume();
  };
  const gestures: EventTarget = placing ? host : root;
  gestures.addEventListener('pointerdown', resume);
  gestures.addEventListener('keydown', resume);

  const transportListeners = new Set<() => void>();
  const transport: TransportHandle = mountTransport(bar, {
    snapshot: () => {
      const session = runtime.session, snapshot = session?.snapshot;
      const duration = snapshot?.durationSeconds ?? undefined;
      const seconds = session ? session.position : 0;
      return {playing: !!snapshot && !snapshot.paused, seconds, duration: duration ?? undefined, progress: duration ? seconds / duration : 0, disabled: !session};
    },
    play: () => handle.play(),
    pause: () => { void handle.pause(); },
    seekFraction: fraction => { const duration = runtime.session?.snapshot.durationSeconds; if (duration) return runtime.session!.seek(fraction * duration).then(() => undefined); },
    subscribe: notify => { transportListeners.add(notify); return () => { transportListeners.delete(notify); }; },
  }, {label: options.label ?? project.id, onError: report});

  // One element per shown module, made once; a rebuild rebinds controls in place.
  const controls = new Map<string, ObjectControl>();
  const releases: (() => void)[] = [];
  const buffers = () => { const context = audio.prepare(); return {store: sharedBuffersFor(context), context}; };
  const shown = componentContents(project);
  const minX = Math.min(0, ...shown.map(item => item.x)) - GUTTER, minY = Math.min(0, ...shown.map(item => item.y)) - GUTTER;
  // The stage is as large as what it holds, up to its host's width and 640 px
  // high, and scrolls beyond that. Sizes start from each element's nominal
  // size and follow the rendered ones.
  const extent = document.createElement('div');
  extent.className = 'wmc__extent';
  stage.append(extent);
  const cells: {cell: HTMLElement; x: number; y: number; width: number; height: number}[] = [];
  const fit = () => {
    let width = 0, height = 0;
    for (const item of cells) {
      width = Math.max(width, item.x + (item.cell.offsetWidth || item.width));
      height = Math.max(height, item.y + (item.cell.offsetHeight || item.height));
    }
    extent.style.width = `${width + GUTTER}px`;
    extent.style.height = `${height + GUTTER}px`;
    stage.style.height = `${Math.min(height + GUTTER, 640)}px`;
  };
  /**
   * Show one level's contents in `container`, offset by `left` and `top`. A
   * nested component set to show what it holds is a cell of its own, as large
   * as its contents; only the top level's cells size the stage.
   */
  const placeLevel = (contents: readonly ComponentContent[], container: HTMLElement, left: number, top: number, topLevel: boolean) => {
  for (const {record, x, y, width: sizedWidth, height: sizedHeight, kind} of contents) {
    const cell = document.createElement('div');
    cell.className = 'wmc__item';
    cell.style.left = `${x - left}px`;
    cell.style.top = `${y - top}px`;
    // Placed by the host: in the element it gives, in its flow, or not shown at all.
    const place = topLevel && placing ? options.place!(record) : undefined;
    if (topLevel && placing && !place) continue;
    if (place) {
      cell.className = 'wmc__placed';
      cell.style.left = cell.style.top = '';
      cell.dataset.kind = componentManifestOf(record.plugin.id) ? 'component' : kind;
      releases.push(() => cell.remove());
    }
    const stage = place ?? container;
    const at = {x: x - left, y: y - top};
    const keep = (item: {cell: HTMLElement; x: number; y: number; width: number; height: number}) => { if (topLevel) cells.push(item); };
    if (kind === 'nested') {
      // What a nested component holds, laid out by its own presentation (DEC-089).
      const inner = componentContents(project, record.id);
      const innerLeft = Math.min(...inner.map(item => item.x), 0), innerTop = Math.min(...inner.map(item => item.y), 0);
      cell.classList.add('wmc__nested');
      cell.setAttribute('role', 'group');
      cell.setAttribute('aria-label', record.label ?? record.id);
      stage.append(cell);
      placeLevel(inner, cell, innerLeft, innerTop, false);
      const width = Math.max(0, ...inner.map(item => item.x - innerLeft + (item.width ?? 0)));
      const height = Math.max(0, ...inner.map(item => item.y - innerTop + (item.height ?? 0)));
      // The cell takes what its contents take once drawn; until then, what their sizes say.
      const measure = () => {
        let right = width, bottom = height;
        for (const child of cell.children) {
          const element = child as HTMLElement;
          right = Math.max(right, element.offsetLeft + element.offsetWidth);
          bottom = Math.max(bottom, element.offsetTop + element.offsetHeight);
        }
        cell.style.width = `${right}px`;
        cell.style.height = `${bottom}px`;
      };
      measure();
      const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : undefined;
      for (const child of cell.children) observer?.observe(child);
      releases.push(() => observer?.disconnect());
      keep({cell, ...at, width, height});
      continue;
    }
    // A box resized in Studio keeps its size here; its element fills it.
    const sized = sizedWidth !== undefined && sizedHeight !== undefined;
    if (sized) { cell.style.width = `${sizedWidth}px`; cell.style.height = `${sizedHeight}px`; cell.dataset.sized = 'true'; }
    const manifest = componentManifestOf(record.plugin.id);
    if (manifest) {
      const element = createComponentElement(manifest, configOf(record), document);
      styled.push(() => configureComponentElement(element, manifest, configOf(record)));
      if (!sized) cell.style.width = `${manifest.width}px`;
      cell.append(element);
      keep({cell, ...at, width: sizedWidth ?? manifest.width, height: sizedHeight ?? 180});
      const needsBuffers = manifest.parameters.some(parameter => parameter.buffer);
      releases.push(bindComponentElement(element, manifest, surfaces.slot(record.id), record.config, {
        onGesture: resume, onError: report, editableBuffers: options.editableBuffers, ...(needsBuffers ? {buffers: buffers()} : {}),
      }));
      // Bound before it connects, a player finds the graph's Session on its box at once (DEC-084).
      stage.append(cell);
      // In a resized box the component draws as tall as the box.
      if (sized) releases.push(fitComponentElement(element, manifest, cell));
    } else {
      const name = nameOf(record);
      const label = record.label ?? name;
      // A control fills its cell: the size Studio gave it, or its natural one.
      const natural = controlSize(name, label);
      stage.append(cell);
      if (!sized) { cell.style.width = `${natural.width}px`; cell.style.height = `${natural.height}px`; }
      keep({cell, ...at, width: sizedWidth ?? natural.width, height: sizedHeight ?? natural.height});
      // An interface object takes its own style as a component does (DEC-088).
      const restyle = () => applyComponentStyle(cell, ownStyle(configOf(record)));
      restyle();
      styled.push(restyle);
      controls.set(record.id, mountObjectControl(cell, name, {label, cardHost: place ? cell : root, onError: report}));
    }
  }
  };
  placeLevel(shown, stage, minX, minY, true);
  fit();
  const resized = typeof ResizeObserver === 'function' ? new ResizeObserver(fit) : undefined;
  for (const {cell} of cells) resized?.observe(cell);

  const refresh = () => {
    for (const [id, control] of controls) control.refresh(objectInterfaceOf(runtime.getModule(id)));
    for (const notify of [...transportListeners]) notify();
  };
  let watchSession: (() => void) | undefined;
  const stopRuntime = runtime.subscribe(() => {
    refresh();
    watchSession?.();
    watchSession = runtime.session?.subscribe(() => { for (const notify of [...transportListeners]) notify(); });
  });
  const stopPreload = keepComponentSessionPreloaded(runtime, report);
  let frame = 0;
  const tick = () => {
    if (runtime.session && !runtime.session.snapshot.paused) transport.update();
    frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);

  let destroyed = false;
  const ready = runtime.restore(project).then(() => refresh());
  ready.catch(report);
  const handle: ComponentHandle = {
    runtime, ready,
    setStyling(source) {
      const next: StyleSource = source === 'inherit' ? 'inherit' : 'own';
      if (destroyed || next === styling) return;
      styling = next;
      applyTheme();
      for (const restyle of styled) restyle();
    },
    async save() {
      await ready;
      // An edit is encoded off the call that made it.
      await surfaces.settled();
      return runtime.exportProject();
    },
    async play() {
      await ready;
      const context = audio.prepare() as AudioContext;
      if (context.state === 'suspended' && typeof context.resume === 'function') await context.resume();
      const session = runtime.session;
      if (!session) return;
      if (session.snapshot.ended) await session.seek(0);
      await session.play();
    },
    async pause() { await runtime.session?.pause(); },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      cancelAnimationFrame(frame);
      resized?.disconnect();
      stopRuntime();
      stopPreload();
      watchSession?.();
      for (const control of controls.values()) control.destroy();
      // Off the page first: a player that loses its lent Session then is
      // leaving, and does not start a Session of its own.
      root.remove();
      style.remove();
      for (const release of releases) { try { release(); } catch (error) { report(error); } }
      transport.destroy();
      runtime.dispose();
      for (const registration of registrations) registration.release();
      if (!options.audio) audio.dispose();
      root.removeEventListener('pointerdown', resume);
      root.removeEventListener('keydown', resume);
    },
  };
  return handle;
}

/**
 * Define a custom element that runs `project`: each instance mounts it in its
 * shadow root when connected and releases it when disconnected. Returns the
 * element class; an already defined tag is left as it is.
 */
export function defineComponentElement(tag: string, project: unknown, options: MountComponentOptions = {}): CustomElementConstructor {
  const existing = customElements.get(tag);
  if (existing) return existing;
  const document = parseModuleProject(project);
  const source = (element: HTMLElement): StyleSource => element.getAttribute('styling') === 'inherit' ? 'inherit' : 'own';
  class WebMusicComponentElement extends HTMLElement {
    /** `styling="inherit"` sets the component's own theme and styles aside for those of what holds it (DEC-090). */
    static readonly observedAttributes = ['styling'];
    #handle?: ComponentHandle;
    attributeChangedCallback(): void { this.#handle?.setStyling(source(this)); }
    /** The running component, while connected. */
    get component(): ComponentHandle | undefined { return this.#handle; }
    connectedCallback(): void {
      if (this.#handle) return;
      const root = this.shadowRoot ?? this.attachShadow({mode: 'open'});
      this.#handle = mountComponent(root, document, {...options, label: this.getAttribute("aria-label") ?? options.label,
        styling: this.hasAttribute('styling') ? source(this) : options.styling});
    }
    disconnectedCallback(): void { this.#handle?.destroy(); this.#handle = undefined; }
  }
  customElements.define(tag, WebMusicComponentElement);
  return WebMusicComponentElement;
}
