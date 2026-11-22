// The packages' own Components inside the boxes of a graph (DEC-078,
// DEC-081): one Element per box, made, configured, bound and fitted from its
// component's manifest. Studio and exported components do it the same way;
// nothing here branches on which component it is.
//
// Ownership: the caller owns the element and the release function returned
// by a bind call. Analysers, note ports, upstream modules, buffers and the
// module context lent to a player or desk are borrowed from the runtime; an
// element never disposes them. The bind call owns the context provider on the
// box and the channel leases it takes from the Element's module.

import {clipOfBuffer, type SharedBuffers} from '@webmusic/audio/play/headless';
import {defineAudioClipViewElement} from '@webmusic/audio/view/element';
import {createAudioClipEditor, renderAudioClipEditor, type AudioClipEditor} from '@webmusic/audio/view/headless';
import {AUDIO_PLAYER_OWNER, type AudioClip} from '@webmusic/audio';
import {computeSpectrogram} from '@webmusic/audio/analyze';
import {notifyModuleContext, provideModuleContext} from '@webmusic/kernel/element';
import type {AudioOutputPort, ConnectionLease, ModuleContext, ModuleHandle, NoteEvent, NoteOutputPort, ProjectJsonObject} from '@webmusic/kernel/module';
import {OFFICIAL_COMPONENTS, parameterValue, type ComponentFit, type ComponentManifest} from './manifest';
import {componentSettings, type ComponentSettings} from './settings';
import type {SurfaceSlot} from './surfaces';

type ClipElement = HTMLElement & {editor: AudioClipEditor | undefined; editable: boolean};
/** A module that takes channels: a Rack, or a desk's module (DEC-084). */
type Admitting = ModuleHandle & {admit(module: ModuleHandle, port: AudioOutputPort): ConnectionLease};
type Bound = HTMLElement & {analyser?: AnalyserNode; inputModule?: ModuleHandle | null; module?: ModuleHandle; editor?: unknown} & Record<string, unknown>;
/** An explicit link to no player: a companion bound to it waits, and never plays by itself. */
const UNLINKED = Object.freeze({player: undefined});
// An Element announces a new `module` with either event: a new module, or a new scope that makes one.
const MODULE_EVENTS = ['webmusic:modulechange', 'webmusic:contextchange'] as const;
const listen = (element: HTMLElement, listener: () => void): (() => void) => {
  for (const name of MODULE_EVENTS) element.addEventListener(name, listener);
  return () => { for (const name of MODULE_EVENTS) element.removeEventListener(name, listener); };
};
const admitting = (module: ModuleHandle | undefined): module is Admitting => typeof (module as Partial<Admitting> | undefined)?.admit === 'function';

/** Register the custom element of every official component; safe to call again. */
export function defineComponentElements(): void {
  for (const manifest of OFFICIAL_COMPONENTS) manifest.define();
}

/** A component's Element, configured from its module's config. */
export function createComponentElement(manifest: ComponentManifest, config: ProjectJsonObject, document: Document = globalThis.document): HTMLElement {
  manifest.define();
  const element = document.createElement(manifest.tag);
  for (const [name, value] of Object.entries(manifest.attributes ?? {})) element.setAttribute(name, value);
  configureComponentElement(element, manifest, config);
  const container = manifest.container;
  if (!container) return element;
  // A declaration works inside its owner: the box holds the owner, and the owner holds the declaration.
  container.define();
  const outer = document.createElement(container.tag);
  for (const [name, value] of Object.entries(container.attributes ?? {})) outer.setAttribute(name, value);
  outer.append(element);
  return outer;
}

/** The Element a manifest describes, inside the one a host placed: itself, or the declaration inside its container. */
export function componentTarget(element: HTMLElement, manifest: ComponentManifest): HTMLElement {
  return manifest.container && element.localName === manifest.container.tag
    ? element.querySelector<HTMLElement>(`:scope > ${manifest.tag}`) ?? element : element;
}

/** The settings last applied to each Element, so a removed one gives its attribute or property back. */
const applied = new WeakMap<HTMLElement, ComponentSettings>();
/** What a fit writes on an Element while its box is resized: a setting for it waits until the fit lets go. */
const held = new WeakMap<HTMLElement, {readonly attribute?: string; readonly property?: string}>();

/**
 * Apply a config to a component's Element in place: its settings (DEC-085),
 * each attribute over the manifest's own and each custom property on the
 * Element, then each parameter to its attribute. A setting that is gone gives
 * the attribute back to the manifest, or removes it.
 */
export function configureComponentElement(placed: HTMLElement, manifest: ComponentManifest, config: ProjectJsonObject): void {
  const element = componentTarget(placed, manifest);
  const settings = componentSettings(manifest, config, element.ownerDocument.defaultView?.customElements);
  const before = applied.get(element);
  const hold = held.get(element);
  for (const name of Object.keys(before?.attributes ?? {})) {
    if (name in settings.attributes || name === hold?.attribute) continue;
    const own = manifest.attributes?.[name];
    if (own === undefined) element.removeAttribute(name); else element.setAttribute(name, own);
  }
  for (const [name, value] of Object.entries(settings.attributes)) {
    if (name !== hold?.attribute && element.getAttribute(name) !== value) element.setAttribute(name, value);
  }
  for (const name of Object.keys(before?.style ?? {})) {
    if (!(name in settings.style) && name !== hold?.property) element.style.removeProperty(name);
  }
  for (const [name, value] of Object.entries(settings.style)) {
    if (name !== hold?.property && element.style.getPropertyValue(name) !== value) element.style.setProperty(name, value);
  }
  applied.set(element, settings);
  for (const parameter of manifest.parameters) {
    if (!parameter.attribute) continue;
    const value = String(parameterValue(parameter, config));
    if (element.getAttribute(parameter.attribute) !== value) element.setAttribute(parameter.attribute, value);
  }
  if (manifest.configure) {
    const values: Record<string, unknown> = {...config};
    for (const parameter of manifest.parameters) values[parameter.name] = parameterValue(parameter, config);
    manifest.configure(element, values);
  }
}

/** True when a changed config needs a new binding, not only new attributes: a parameter the host binds. */
export function rebindsOnConfig(manifest: ComponentManifest): boolean {
  return manifest.parameters.some(parameter => parameter.buffer);
}

export interface ComponentBindOptions {
  /** Runs inside a pointer or key gesture on the Element, so the caller can resume audio there. */
  readonly onGesture?: () => void;
  /** The shared buffers a buffer parameter names. */
  readonly buffers?: {readonly store: SharedBuffers; readonly context: BaseAudioContext};
  /** Let a shown buffer be edited and written back. */
  readonly editableBuffers?: boolean;
  readonly onError?: (error: unknown) => void;
}

/**
 * Bind a component's Element to its slot through the members its manifest
 * names: `analyser`, `inputModule` and the note output of `module`, and a
 * shared buffer for a buffer parameter. A player or desk is lent the graph's
 * module context on its box — the Element's parent, which must be there and
 * should be bound before the Element connects — its desk inputs are admitted
 * through `module`, its own `module` is what a source cord carries, and its
 * asset is assigned to the property the manifest names. Returns the release
 * function; take a player or desk off the page before calling it, so that
 * losing the lent context does not make it start a Session of its own.
 */
export function bindComponentElement(element: HTMLElement, manifest: ComponentManifest, slot: SurfaceSlot, config: ProjectJsonObject, options: ComponentBindOptions = {}): () => void {
  // The box holds what the host placed; bindings reach the Element the manifest describes.
  const placed = element;
  element = componentTarget(placed, manifest);
  const view = element as Bound;
  const releases: (() => void)[] = [];
  const report = (error: unknown) => { if (options.onError) options.onError(error); else queueMicrotask(() => { throw error; }); };
  const follows = manifest.ports.some(port => port.bind === 'owner');
  if (manifest.scope || follows || manifest.ports.some(port => port.bind === 'context')) {
    const box = placed.parentElement;
    if (!box) throw new Error(`The ${manifest.name} component must be inside its box before it is bound.`);
    // A view cabled from a track finds that track as its player by containment: the lent scope lends it as the owner.
    let lent: {base: ModuleContext; owner: object; scope: ModuleContext} | undefined;
    const read = (): ModuleContext | undefined => {
      const base = slot.context.current, owner = follows ? slot.sourceOwner.current : undefined;
      if (!base || !owner) return base;
      if (lent?.base !== base || lent.owner !== owner) {
        lent = {base, owner, scope: base.derive({id: base.id, capabilities: base.capabilities.with(AUDIO_PLAYER_OWNER, owner as never)})};
      }
      return lent.scope;
    };
    // The Element finds its context through the box, as a player nested in another finds its.
    releases.push(provideModuleContext(box, read));
    releases.push(slot.context.subscribe(() => notifyModuleContext(box)));
    if (follows) releases.push(slot.sourceOwner.subscribe(() => notifyModuleContext(box)));
  }
  if (manifest.ports.some(port => port.bind === 'insert')) releases.push(bindInsert(view, slot, report));
  // Refreshed by the buffer binding below when it changes the view's clip.
  let refreshSpectrogram = () => {};
  if (manifest.spectrogram) {
    const spectrogram = bindSpectrogram(view, slot, report);
    refreshSpectrogram = spectrogram.refresh;
    releases.push(spectrogram.release);
  }
  if (manifest.ports.some(port => port.bind === 'admit')) {
    let admittedTo: ModuleHandle | undefined, admitted: readonly unknown[] | undefined;
    const leases: ConnectionLease[] = [];
    const retire = () => {
      for (const lease of leases.splice(0)) { try { lease.release(); } catch (error) { report(error); } }
      admittedTo = admitted = undefined;
    };
    // Admitting and releasing notify the desk, which re-enters here: run once more afterwards instead.
    let busy = false, again = false;
    const admit = () => {
      if (busy) { again = true; return; }
      busy = true;
      try {
        do {
          again = false;
          const module = view.module, channels = slot.channels.current;
          if (module === admittedTo && channels === admitted) continue;
          retire();
          if (!admitting(module) || !channels) continue;
          admittedTo = module; admitted = channels;
          for (const channel of channels) {
            try { leases.push(module.admit(channel.module, channel.port)); } catch (error) { report(error); }
          }
        } while (again);
      } finally { busy = false; }
    };
    admit();
    releases.push(slot.channels.subscribe(admit));
    const unlisten = listen(element, admit);
    releases.push(() => { unlisten(); retire(); });
  }
  if (slot.forwardsElement || manifest.ports.some(port => port.family === 'source' && port.direction === 'output')) {
    let provided: {module: ModuleHandle; release: () => void} | undefined;
    const forward = () => {
      const module = view.module;
      if (module === provided?.module) return;
      provided?.release();
      provided = module ? {module, release: slot.element.provide(module)} : undefined;
    };
    forward();
    const unlisten = listen(element, forward);
    const releaseOwner = slot.elementOwner.provide(element);
    releases.push(() => { unlisten(); releaseOwner(); provided?.release(); provided = undefined; });
  }
  if (manifest.asset) {
    const property = manifest.asset.property;
    const plays = manifest.asset.kind;
    const assign = () => {
      // Once a view edits its score (DEC-086) a player plays the document: it is never given a score and an editor at once.
      const document = plays === 'score' ? slot.document.current : undefined;
      if (document) {
        if (view.editor === document) return;
        try {
          if (view[property] !== undefined) view[property] = undefined;
          view.editor = document;
        } catch (error) { report(error); }
        return;
      }
      // A document let go (a reverted score) gives the asset back.
      if (plays === 'score' && view.editor !== undefined) { try { view.editor = undefined; } catch (error) { report(error); } }
      const value = slot.asset.current;
      if (value !== undefined && view[property] !== value) view[property] = value;
    };
    assign();
    releases.push(slot.asset.subscribe(assign));
    if (plays === 'score') releases.push(slot.document.subscribe(assign));
  }
  if (manifest.edits === 'score') {
    // `editable` is the author's switch (DEC-086): while it is on, the view borrows the document of the box its cord
    // comes from; off, it borrows none and follows that box as any view does.
    const lend = () => {
      const on = element.hasAttribute('editable') && element.getAttribute('editable') !== 'false';
      const editor = on ? slot.lender.current?.() : undefined;
      if (view.editor === editor) return;
      try { view.editor = editor; } catch (error) { report(error); }
    };
    lend();
    releases.push(slot.lender.subscribe(lend));
    const Observer = element.ownerDocument.defaultView?.MutationObserver;
    const observer = Observer ? new Observer(lend) : undefined;
    observer?.observe(element, {attributes: true, attributeFilter: ['editable']});
    releases.push(() => { observer?.disconnect(); if (view.editor !== undefined) { try { view.editor = undefined; } catch (error) { report(error); } } });
  }
  for (const port of manifest.ports) {
    if (port.bind === 'context' || port.bind === 'admit' || port.bind === 'owner' || port.bind === 'insert' || (port.family === 'source' && port.direction === 'output')) continue;
    if (port.bind === 'player') {
      const apply = () => { view.player = slot.sourceOwner.current ?? UNLINKED; };
      apply();
      releases.push(slot.sourceOwner.subscribe(apply));
    } else if (port.bind === 'analyser') {
      const apply = () => { view.analyser = slot.analyser.current; };
      apply();
      releases.push(slot.analyser.subscribe(apply));
    } else if (port.bind === 'inputModule' || port.bind === 'moduleTarget') {
      // Explicit null while nothing is cabled: the Element then borrows nothing by containment.
      const provided = port.family === 'note' ? slot.noteSource : slot.source;
      const member = port.bind;
      const apply = () => { view[member] = provided.current ?? null; };
      apply();
      releases.push(provided.subscribe(apply));
    } else {
      const output = view.module?.ports?.().find(item => item.family === 'note' && item.direction === 'output') as NoteOutputPort | undefined;
      const unsubscribe = output?.subscribe((event: NoteEvent) => {
        try { slot.notes.current?.(event); } catch (error) { queueMicrotask(() => { throw error; }); }
      });
      if (unsubscribe) releases.push(unsubscribe);
    }
  }
  for (const parameter of manifest.parameters) {
    if (!parameter.buffer || !options.buffers) continue;
    const name = String(parameterValue(parameter, config));
    if (!name) continue;
    const {store, context} = options.buffers;
    if (parameter.buffer === 'clip') {
      // Read-only: the buffer's samples are the Element's clip, and follow the buffer.
      const show = () => { const buffer = store.get(name); view.clip = buffer ? clipOfBuffer(buffer) : undefined; refreshSpectrogram(); };
      show();
      const unsubscribe = store.subscribe(name, show);
      releases.push(() => { unsubscribe(); view.clip = undefined; });
      continue;
    }
    if (parameter.buffer === 'take') {
      // Each finished take replaces the buffer, so whatever plays or shows it has the recording.
      const keep = (event: Event) => {
        const clip = (event as CustomEvent<{clip?: {toAudioBuffer(context: BaseAudioContext): AudioBuffer}}>).detail?.clip;
        if (!clip) return;
        try { store.set(name, clip.toAudioBuffer(context)); } catch (error) { report(error); }
      };
      element.addEventListener('webaudio:recorded', keep);
      releases.push(() => element.removeEventListener('webaudio:recorded', keep));
      continue;
    }
    // A setting can turn editing off; it never lends an editor the host does not.
    const editable = options.editableBuffers && componentSettings(manifest, config, element.ownerDocument.defaultView?.customElements).attributes.editable !== 'false';
    if (name) releases.push(bindBufferView(element, name, options.buffers.store, options.buffers.context, {editable, onError: options.onError}));
  }
  const gesture = () => options.onGesture?.();
  placed.addEventListener('pointerdown', gesture);
  placed.addEventListener('keydown', gesture);
  return () => {
    placed.removeEventListener('pointerdown', gesture);
    placed.removeEventListener('keydown', gesture);
    for (const release of releases.reverse()) release();
  };
}

type Insert = HTMLElement & {context?: BaseAudioContext; readonly input?: AudioNode; readonly output?: AudioNode};

/**
 * Put an insert Element between its box's ends: give it the graph's
 * AudioContext, then connect the box's input to its `input` and its `output`
 * to the box's output. The Element builds its chain when it connects, so the
 * ends are joined once it has one; its boundary nodes stay the same while its
 * context does. Returns the release function, which disconnects only those
 * two edges.
 */
function bindInsert(view: Bound, slot: SurfaceSlot, report: (error: unknown) => void): () => void {
  const element = view as unknown as Insert;
  const window = element.ownerDocument.defaultView;
  let joined: {from: AudioNode; into: AudioNode; out: AudioNode; to: AudioNode} | undefined;
  let frame = 0, tries = 0, released = false;
  const part = () => {
    if (!joined) return;
    const {from, into, out, to} = joined;
    joined = undefined;
    try { from.disconnect(into); } catch { /* Already apart. */ }
    try { out.disconnect(to); } catch { /* Already apart. */ }
  };
  const join = () => {
    frame = 0;
    if (released) return;
    const ends = slot.insert.current;
    if (!ends) { part(); return; }
    if (element.context !== ends.context) {
      try { element.context = ends.context; } catch (error) { report(error); return; }
    }
    const into = element.input, out = element.output;
    if (!into || !out) {
      // Not built yet: it builds when it connects.
      if (tries++ < 120 && window) frame = window.requestAnimationFrame(join);
      return;
    }
    if (joined?.from === ends.input && joined.into === into && joined.out === out && joined.to === ends.output) return;
    part();
    try {
      ends.input.connect(into);
      out.connect(ends.output);
      joined = {from: ends.input, into, out, to: ends.output};
    } catch (error) { report(error); }
  };
  queueMicrotask(join);
  const unsubscribe = slot.insert.subscribe(() => { tries = 0; join(); });
  return () => {
    released = true;
    unsubscribe();
    if (frame && window) window.cancelAnimationFrame(frame);
    part();
  };
}

/** At most this many columns: a long recording is drawn coarser, not slower. */
const SPECTROGRAM_FRAMES = 2048;
const SPECTROGRAM_FFT = 1024;

/**
 * While the view's `type` is `spectrogram`, give it the spectrogram of the clip
 * it shows: its own `.clip`, or else its player's — the track its box follows.
 * Recomputed when that clip changes; released with the binding.
 */
function bindSpectrogram(view: Bound, slot: SurfaceSlot, report: (error: unknown) => void): {refresh(): void; release(): void} {
  const element = view as unknown as HTMLElement & {clip?: AudioClip; spectrogram?: unknown};
  let drawn: AudioClip | undefined;
  let watched: EventTarget | undefined;
  // A player announces a new clip with either event.
  const sourceEvents = ['webaudio:sourcechange', 'webaudio:loaded', 'webaudio:playerchange'];
  const update = () => {
    const owner = slot.sourceOwner.current as (EventTarget & {clip?: AudioClip}) | undefined;
    if (owner !== watched) {
      for (const name of sourceEvents) watched?.removeEventListener(name, update);
      watched = owner;
      for (const name of sourceEvents) watched?.addEventListener(name, update);
    }
    const clip = element.getAttribute('type') === 'spectrogram' ? element.clip ?? owner?.clip : undefined;
    if (clip === drawn) return;
    drawn = clip;
    try {
      const channel = clip?.channelData(0);
      if (!clip || !channel) { if (element.spectrogram !== undefined) element.spectrogram = undefined; return; }
      const hopSize = Math.max(SPECTROGRAM_FFT / 4, Math.ceil(Math.max(0, channel.length - SPECTROGRAM_FFT) / (SPECTROGRAM_FRAMES - 1)));
      element.spectrogram = computeSpectrogram(channel, clip.sampleRate, {fftSize: SPECTROGRAM_FFT, hopSize});
    } catch (error) { report(error); }
  };
  update();
  const unsubscribe = slot.sourceOwner.subscribe(update);
  const Observer = element.ownerDocument.defaultView?.MutationObserver;
  // `type` changes with the box's argument; `.clip` with the buffer, whose binding calls refresh.
  const observer = Observer ? new Observer(update) : undefined;
  observer?.observe(element, {attributes: true, attributeFilter: ['type']});
  return {refresh: update, release: () => {
    unsubscribe();
    observer?.disconnect();
    for (const name of sourceEvents) watched?.removeEventListener(name, update);
    if (drawn !== undefined) { try { element.spectrogram = undefined; } catch (error) { report(error); } }
  }};
}

/** How a fit is applied: which part is measured and what is written. */
interface Fitting {
  parts?(root: ParentNode): {content: HTMLElement | null; surface: HTMLElement | null};
  write(element: HTMLElement, pixels: number): void;
  /** Give the element its own height back. `initial` is its `height` attribute before fitting. */
  clear(element: HTMLElement, initial: string | null): void;
  readonly least: number;
}

function fittingOf(fit: ComponentFit): Fitting {
  if (fit.kind === 'token') return {
    parts: root => ({content: root.querySelector<HTMLElement>(fit.content), surface: root.querySelector<HTMLElement>(fit.surface)}),
    write: (element, pixels) => element.style.setProperty(fit.property, `${pixels}px`),
    // The height a setting gave the token comes back with the natural size.
    clear: element => {
      const own = applied.get(element)?.style[fit.property];
      if (own === undefined) element.style.removeProperty(fit.property); else element.style.setProperty(fit.property, own);
    },
    least: fit.least,
  };
  const content = fit.content;
  return {
    ...(content ? {parts: (root: ParentNode) => ({content: root.querySelector<HTMLElement>(content), surface: null})} : {}),
    write: (element, pixels) => { if (element.getAttribute('height') !== String(pixels)) element.setAttribute('height', String(pixels)); },
    clear: (element, initial) => { if (initial === null) element.removeAttribute('height'); else element.setAttribute('height', initial); },
    least: fit.least,
  };
}

/**
 * Make a component's Element as tall as its box (DEC-080): the part that
 * draws takes the height its tools and readouts leave, and follows the box
 * when it is resized. The element must already be inside the box, which sets
 * its width. A component without a fit keeps its own height. Returns the
 * release function, which gives the element its own height back.
 */
export function fitComponentElement(element: HTMLElement, manifest: ComponentManifest, box: HTMLElement | null = element.parentElement): () => void {
  if (!manifest.fit) return () => {};
  const fitting = fittingOf(manifest.fit);
  const view = element.ownerDocument.defaultView;
  if (!box || !view || typeof view.ResizeObserver !== 'function') return () => {};
  const initial = element.getAttribute('height');
  // While the box is resized the fit owns the height: a setting for it waits (DEC-085).
  const setAtStart = applied.get(element)?.attributes.height;
  held.set(element, manifest.fit.kind === 'token' ? {property: manifest.fit.property} : {attribute: 'height'});
  let written: number | undefined;
  let watched: HTMLElement | undefined;
  let frame = 0;
  let tries = 0;
  let released = false;
  const apply = () => {
    frame = 0;
    if (released) return;
    const available = box.clientHeight;
    if (available <= 0) return;
    let next = available;
    if (fitting.parts) {
      const {content, surface} = fitting.parts(element.shadowRoot ?? element);
      // The element draws itself after it is connected, a clip view only once it has samples.
      if (!content || (!surface && written === undefined)) {
        if (written === undefined) { written = Math.max(fitting.least, available); fitting.write(element, written); }
        if (tries++ < 120) schedule();
        return;
      }
      // A readout that wraps or a tool row that appears changes what is left for the drawing.
      if (content !== watched) {
        if (watched) observer.unobserve(watched);
        observer.observe(content);
        watched = content;
      }
      const drawn = surface ? surface.offsetHeight : written!;
      next = drawn + available - content.offsetHeight;
    }
    next = Math.max(fitting.least, Math.round(next));
    if (next === written) return;
    written = next;
    fitting.write(element, next);
    // What surrounds the drawing can change with its size: measure once more.
    if (fitting.parts && tries++ < 120) schedule();
  };
  const schedule = () => { if (!frame && !released) frame = view.requestAnimationFrame(apply); };
  const observer = new view.ResizeObserver(() => { tries = 0; schedule(); });
  observer.observe(box);
  schedule();
  return () => {
    released = true;
    observer.disconnect();
    if (frame) view.cancelAnimationFrame(frame);
    held.delete(element);
    // The height comes back to its setting as it is now, or to what the Element had before any setting.
    const setting = applied.get(element)?.attributes.height;
    const own = setting ?? (setAtStart === undefined ? initial : manifest.attributes?.height ?? null);
    if (written !== undefined || manifest.fit?.kind === 'token' || own !== element.getAttribute('height')) fitting.clear(element, own);
  };
}

export interface BufferViewOptions {
  /** Allow editing; each committed edit is rendered and written back to the buffer. */
  readonly editable?: boolean;
  readonly onError?: (error: unknown) => void;
}

/**
 * Show a named buffer in an `<audio-clip-view>`, following its changes. With
 * `editable`, a committed edit is rendered and written back, so everything
 * that plays the buffer hears it. Returns the release function.
 */
export function bindBufferView(element: HTMLElement, name: string, buffers: SharedBuffers, context: BaseAudioContext, options: BufferViewOptions = {}): () => void {
  defineAudioClipViewElement();
  const view = element as ClipElement;
  let editor: AudioClipEditor | undefined;
  let written: AudioBuffer | undefined;
  let job = 0;
  view.setAttribute('aria-label', `Buffer ${name}`);
  if (options.editable) {
    view.setAttribute('tools', 'delete trim silence gain fade zoom history');
    view.editable = true;
  }
  const show = () => {
    const buffer = buffers.get(name);
    if (buffer && buffer === written) return;
    editor?.dispose();
    editor = buffer ? createAudioClipEditor(clipOfBuffer(buffer)) : undefined;
    view.editor = editor;
  };
  const commit = () => {
    const current = editor;
    if (!current) return;
    const mine = ++job;
    void renderAudioClipEditor(current).then(clip => {
      if (mine !== job || current !== editor) return;
      written = clip.toAudioBuffer(context);
      buffers.set(name, written);
    }).catch(error => options.onError?.(error));
  };
  show();
  const unsubscribe = buffers.subscribe(name, show);
  view.addEventListener('webaudio:editcommit', commit);
  return () => {
    job++;
    unsubscribe();
    view.removeEventListener('webaudio:editcommit', commit);
    view.editor = undefined;
    editor?.dispose();
  };
}
