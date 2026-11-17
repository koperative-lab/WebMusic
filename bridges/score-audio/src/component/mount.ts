// A component as a page element (DEC-078, Max's standalone): a project made
// of objects runs in a ModuleProjectRuntime over the standard plugins and
// shows its presentation — the interface objects, views and buffers placed
// where the author put them — under a UI Kit transport.
//
// Ownership: `mountComponent` creates and disposes the runtime, its audio
// environment (unless one is lent), the view slots, the elements and their
// bindings. `destroy()` releases everything it made.

import {sharedBuffersFor} from '@webmusic/audio/play/headless';
import {ModuleAudioEnvironment, ModuleProjectRuntime, ProjectPluginRegistry, parseModuleProject,
  type ModuleProject, type ProjectAssetReference, type ProjectModuleRecord, type ProjectPluginFactory} from '@webmusic/kernel/module';
import {objectInterfaceOf, parseArgs, OBJECT_PLUGIN_PREFIX} from '@webmusic/kernel/objects';
import {mountTransport, type TransportHandle} from '@webmusic/ui/transport';
import {CONTROL_OBJECTS, mountObjectControl, type ObjectControl} from './controls';
import {createComponentPlugins, resolveComponentAsset, type ComponentPluginOptions} from './plugins';
import {ComponentSurfaces, surfaceKindOf} from './surfaces';
import {bindBufferView, bindViewElement, createViewElement, defineViewElements} from './views';

export interface MountComponentOptions extends Omit<ComponentPluginOptions, 'surfaces'> {
  /** Replace the standard plugins entirely; `extra`, `midi`, `wam` and `objects` are then ignored. */
  readonly plugins?: readonly ProjectPluginFactory[];
  /** Load an asset; defaults to `resolveComponentAsset` relative to `base`. */
  readonly resolveAsset?: (asset: ProjectAssetReference, signal: AbortSignal) => unknown | Promise<unknown>;
  /** Base URL for asset URIs. Defaults to the page. */
  readonly base?: string | URL;
  /** Lend an audio environment; by default the component owns one. */
  readonly audio?: ModuleAudioEnvironment;
  /** Let buffers shown in the presentation be edited and written back. Default false. */
  readonly editableBuffers?: boolean;
  /** Label of the transport and the region. Defaults to the project ID. */
  readonly label?: string;
  readonly onError?: (error: unknown) => void;
}

export interface ComponentHandle {
  readonly runtime: ModuleProjectRuntime;
  /** Settles when the project is restored; rejects with the restore failure. */
  readonly ready: Promise<void>;
  /** Start the transport; call it from a user gesture so audio may start. */
  play(): Promise<void>;
  pause(): Promise<void>;
  destroy(): void;
}

const STYLE = `
.wmc { display: flex; flex-direction: column; color: var(--wm-foreground, light-dark(#111, #eee)); background: var(--wm-background, light-dark(#fff, #111)); border: 1px solid var(--wm-border, light-dark(#111, #eee)); font: 12px/1.4 var(--wm-font-family, ui-monospace, monospace); }
.wmc__bar { display: flex; height: 32px; border-bottom: 1px solid var(--wm-border, light-dark(#111, #eee)); }
.wmc__bar > * { flex: 1; min-width: 0; }
.wmc__stage { position: relative; overflow: auto; scrollbar-width: none; }
.wmc__stage::-webkit-scrollbar { display: none; }
.wmc__item { position: absolute; min-width: 32px; }
`;

const BUFFER_PLUGIN = `${OBJECT_PLUGIN_PREFIX}buffer`;
type Shown = {record: ProjectModuleRecord; x: number; y: number};

/** The modules the presentation shows: placed ones, or every visible one at its editing position. */
function shownModules(project: ModuleProject, visible: (record: ProjectModuleRecord) => boolean): Shown[] {
  const byId = new Map(project.modules.map(record => [record.id, record]));
  const placed = (project.layout.presentation ?? []).map(item => ({record: byId.get(item.moduleId), x: item.x, y: item.y}))
    .filter((item): item is Shown => item.record !== undefined && visible(item.record));
  if (placed.length) return placed;
  const positions = new Map(project.layout.modules.map(item => [item.moduleId, item]));
  // Copies of a poly's voices repeat the first voice; show none of them.
  return project.modules.filter(record => visible(record) && !record.id.includes('~v'))
    .map(record => ({record, x: positions.get(record.id)?.x ?? 0, y: positions.get(record.id)?.y ?? 0}));
}

const nameOf = (record: ProjectModuleRecord) => record.plugin.id.startsWith(OBJECT_PLUGIN_PREFIX) ? record.plugin.id.slice(OBJECT_PLUGIN_PREFIX.length) : '';

/** Run `project` in `host` and show its presentation. */
export function mountComponent(host: HTMLElement | ShadowRoot, input: unknown, options: MountComponentOptions = {}): ComponentHandle {
  const project = parseModuleProject(input);
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
  defineViewElements();

  const root = document.createElement('div');
  root.className = 'wmc';
  root.setAttribute('role', 'region');
  root.setAttribute('aria-label', options.label ?? project.id);
  const style = document.createElement('style');
  style.textContent = STYLE;
  const bar = document.createElement('div');
  bar.className = 'wmc__bar';
  const stage = document.createElement('div');
  stage.className = 'wmc__stage';
  root.append(bar, stage);
  host.append(style, root);

  const resume = () => {
    const context = audio.peek() as AudioContext | undefined;
    if (context?.state === 'suspended' && typeof context.resume === 'function') void context.resume();
  };
  root.addEventListener('pointerdown', resume);
  root.addEventListener('keydown', resume);

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
  const isBuffer = (record: ProjectModuleRecord) => record.plugin.id === BUFFER_PLUGIN;
  const visible = (record: ProjectModuleRecord) => surfaceKindOf(record.plugin.id) !== undefined || CONTROL_OBJECTS.includes(nameOf(record)) || isBuffer(record);
  const shown = shownModules(project, visible);
  const minX = Math.min(0, ...shown.map(item => item.x)), minY = Math.min(0, ...shown.map(item => item.y));
  let width = 0, height = 0;
  for (const {record, x, y} of shown) {
    const cell = document.createElement('div');
    cell.className = 'wmc__item';
    cell.style.left = `${x - minX}px`;
    cell.style.top = `${y - minY}px`;
    stage.append(cell);
    width = Math.max(width, x - minX + 240);
    height = Math.max(height, y - minY + 200);
    const kind = surfaceKindOf(record.plugin.id);
    if (kind) {
      const element = createViewElement(kind, record.config, document);
      element.style.width = '320px';
      cell.append(element);
      releases.push(bindViewElement(element, kind, surfaces.slot(record.id), resume));
    } else if (isBuffer(record)) {
      const element = document.createElement('audio-clip-view');
      element.setAttribute('height', '120');
      element.style.width = '320px';
      cell.append(element);
      const name = parseArgs(record.config)[0];
      if (name?.type === 'symbol') releases.push(bindBufferView(element, name.value, sharedBuffersFor(audio.prepare()), audio.prepare(), {editable: options.editableBuffers, onError: report}));
    } else {
      const label = record.label ?? nameOf(record);
      // A control fills a cell of the size Studio gives it.
      cell.style.width = '160px';
      cell.style.minHeight = '60px';
      controls.set(record.id, mountObjectControl(cell, nameOf(record), {label, cardHost: root, onError: report}));
    }
  }
  stage.style.height = `${Math.min(height, 640)}px`;
  stage.style.minWidth = `${Math.min(width, 960)}px`;

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
      stopRuntime();
      watchSession?.();
      for (const control of controls.values()) control.destroy();
      for (const release of releases) { try { release(); } catch (error) { report(error); } }
      transport.destroy();
      runtime.dispose();
      for (const registration of registrations) registration.release();
      if (!options.audio) audio.dispose();
      root.removeEventListener('pointerdown', resume);
      root.removeEventListener('keydown', resume);
      root.remove();
      style.remove();
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
  class WebMusicComponentElement extends HTMLElement {
    #handle?: ComponentHandle;
    /** The running component, while connected. */
    get component(): ComponentHandle | undefined { return this.#handle; }
    connectedCallback(): void {
      if (this.#handle) return;
      const root = this.shadowRoot ?? this.attachShadow({mode: 'open'});
      this.#handle = mountComponent(root, document, {...options, label: this.getAttribute("aria-label") ?? options.label});
    }
    disconnectedCallback(): void { this.#handle?.destroy(); this.#handle = undefined; }
  }
  customElements.define(tag, WebMusicComponentElement);
  return WebMusicComponentElement;
}
