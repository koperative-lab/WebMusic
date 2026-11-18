// The packages' own Components inside view-object boxes (DEC-078): one
// element per box, bound to what its slot provides. Studio and exported
// components create and bind them the same way.
//
// Ownership: the caller owns the element and the release function returned
// by a bind call. Analysers, note ports, score modules and buffers are
// borrowed from the runtime; an element never disposes them.

import {defineAudioMeterElement, defineAudioOscilloscopeElement, defineAudioSpectrumAnalyzerElement} from '@webmusic/audio/analyze/element';
import {clipOfBuffer, type SharedBuffers} from '@webmusic/audio/play/headless';
import {defineAudioClipViewElement} from '@webmusic/audio/view/element';
import {createAudioClipEditor, renderAudioClipEditor, type AudioClipEditor} from '@webmusic/audio/view/headless';
import type {ModuleHandle, NoteEvent, NoteOutputPort, ProjectJsonObject} from '@webmusic/kernel/module';
import {defineNoteInputElement} from '@webmusic/score/play/element';
import {defineScoreGridViewElement} from '@webmusic/score/view/element';
import type {SurfaceKind, SurfaceSlot} from './surfaces';

type AnalyserElement = HTMLElement & {analyser: AnalyserNode | undefined};
type ModuleElement = HTMLElement & {inputModule: ModuleHandle | null | undefined};
type NoteElement = HTMLElement & {module: ModuleHandle};
type ClipElement = HTMLElement & {editor: AudioClipEditor | undefined; editable: boolean};

const TAGS: Readonly<Record<SurfaceKind, string>> = Object.freeze({
  keys: 'score-note-input', scope: 'audio-oscilloscope', meter: 'audio-meter', spectrum: 'audio-spectrum-analyzer', roll: 'score-grid-view',
});

let defined = false;
/** Register the custom elements view objects use; safe to call again. */
export function defineViewElements(): void {
  if (defined) return;
  defined = true;
  defineNoteInputElement();
  defineAudioOscilloscopeElement();
  defineAudioMeterElement();
  defineAudioSpectrumAnalyzerElement();
  defineScoreGridViewElement();
  defineAudioClipViewElement();
}

/** The element of a view object, configured from its record's config. */
export function createViewElement(kind: SurfaceKind, config: ProjectJsonObject, document: Document = globalThis.document): HTMLElement {
  defineViewElements();
  const element = document.createElement(TAGS[kind]);
  configureViewElement(element, kind, config);
  return element;
}

/** Apply a changed config to a view element in place. */
export function configureViewElement(element: HTMLElement, kind: SurfaceKind, config: ProjectJsonObject): void {
  const number = (value: unknown, fallback: number) => typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  if (kind === 'keys') {
    element.setAttribute('layout', 'piano');
    element.setAttribute('routing', 'manual');
    element.setAttribute('start', String(number(config.low, 48)));
    element.setAttribute('end', String(number(config.high, 72)));
    element.setAttribute('aria-label', 'Keyboard');
  } else if (kind === 'roll') {
    element.setAttribute('height', '176');
    element.setAttribute('note-height', '6');
  } else if (kind === 'scope') {
    element.setAttribute('timebase-ms', String(number(config.timebaseMs, 10)));
  }
}

/**
 * Bind a view element to its slot. `onGesture` runs inside a keyboard's
 * pointer or key gesture, so the caller can resume audio there. Returns the
 * release function.
 */
export function bindViewElement(element: HTMLElement, kind: SurfaceKind, slot: SurfaceSlot, onGesture?: () => void): () => void {
  if (kind === 'keys') {
    const keys = element as NoteElement;
    const port = keys.module.ports?.().find(item => item.family === 'note' && item.direction === 'output') as NoteOutputPort | undefined;
    const unsubscribe = port?.subscribe((event: NoteEvent) => {
      try { slot.notes.current?.(event); } catch (error) { queueMicrotask(() => { throw error; }); }
    });
    const gesture = () => onGesture?.();
    element.addEventListener('pointerdown', gesture);
    element.addEventListener('keydown', gesture);
    return () => {
      unsubscribe?.();
      element.removeEventListener('pointerdown', gesture);
      element.removeEventListener('keydown', gesture);
    };
  }
  if (kind === 'roll') {
    const view = element as ModuleElement;
    const apply = () => { view.inputModule = slot.source.current ?? null; };
    apply();
    return slot.source.subscribe(apply);
  }
  const view = element as AnalyserElement;
  const apply = () => { view.analyser = slot.analyser.current; };
  apply();
  return slot.analyser.subscribe(apply);
}

const WIDTHS: Readonly<Record<SurfaceKind | 'buffer', number>> = Object.freeze({keys: 320, roll: 320, buffer: 320, scope: 288, spectrum: 288, meter: 224});

/**
 * The natural width of a view object's element, in CSS pixels: the width of
 * its box until the author resizes it. Its natural height is its own.
 */
export function viewWidth(kind: SurfaceKind | 'buffer'): number { return WIDTHS[kind]; }

/** How a view's drawing takes a height: which part is measured and what is written. */
interface Fitting {
  /** The whole of what the element draws, and the part of it whose height is set. */
  parts?(root: ParentNode): {content: HTMLElement | null; surface: HTMLElement | null};
  write(element: HTMLElement, pixels: number): void;
  /** Give the element its own height back. `initial` is its `height` attribute before fitting. */
  clear(element: HTMLElement, initial: string | null): void;
  /** The least height written, in CSS pixels. */
  readonly least: number;
}

const token = (name: string, content: string, surface: string, least: number): Fitting => ({
  parts: root => ({content: root.querySelector<HTMLElement>(content), surface: root.querySelector<HTMLElement>(surface)}),
  write: (element, pixels) => element.style.setProperty(name, `${pixels}px`),
  clear: element => element.style.removeProperty(name),
  least,
});
const attribute = (least: number, parts?: Fitting['parts']): Fitting => ({
  ...(parts ? {parts} : {}),
  write: (element, pixels) => { if (element.getAttribute('height') !== String(pixels)) element.setAttribute('height', String(pixels)); },
  clear: (element, initial) => { if (initial === null) element.removeAttribute('height'); else element.setAttribute('height', initial); },
  least,
});

// Parts are the presenters' public names for their pieces; their classes are not.
const FITTINGS: Readonly<Record<SurfaceKind | 'buffer', Fitting>> = Object.freeze({
  keys: token('--wm-note-height', '[part~="root"]', '[part~="viewport"]', 24),
  scope: token('--wm-oscilloscope-height', '[part~="root"]', '[part~="plot"]', 32),
  spectrum: token('--wm-spectrum-height', '[part~="root"]', '[part~="plot"]', 32),
  // The meter and the roll take their whole height as an attribute.
  meter: attribute(32),
  roll: attribute(48),
  // A clip view's attribute counts its tools and ruler; what it draws is measured.
  buffer: attribute(96, root => { const section = root.querySelector<HTMLElement>('section'); return {content: section, surface: null}; }),
});

/**
 * Make a view element as tall as its box (DEC-080): the part that draws takes
 * the height its tools and readouts leave, and follows the box when it is
 * resized. The element must already be inside the box, which sets its width.
 * Returns the release function, which gives the element its own height back.
 */
export function fitViewElement(element: HTMLElement, kind: SurfaceKind | 'buffer', box: HTMLElement | null = element.parentElement): () => void {
  const fitting = FITTINGS[kind];
  const view = element.ownerDocument.defaultView;
  if (!box || !view || typeof view.ResizeObserver !== 'function') return () => {};
  const initial = element.getAttribute('height');
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
    if (written !== undefined) fitting.clear(element, initial);
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
  defineViewElements();
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
