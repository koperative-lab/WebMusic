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
