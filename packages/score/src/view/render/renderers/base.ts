/**
 * Shared lifecycle, sizing and DOM helpers for the explicit /render surface.
 *
 * The visualizer design is adapted from Magenta.js core/visualizer.ts.
 * Original copyright 2018 Google Inc., Apache License 2.0.
 */
import type {ScoreNoteSequence, ScoreSequenceNote, VisualizerRenderOptions} from '../../core/types';
import {
  activeNoteCandidateRange,
  isSortedByStartTime,
  maxNoteDuration,
  resolveVirtualization,
  type IndexRange,
  type ResolvedVirtualization,
} from '../../core/windowing';

export const MIN_NOTE_LENGTH = 1;
export const MIN_MIDI_PITCH = 0;
export const MAX_MIDI_PITCH = 127;
export const SVG_NS = 'http://www.w3.org/2000/svg';

export type DataAttribute = [string, unknown];
export type CSSProperty = [string, string | null];

/** Run on the next animation frame, or synchronously outside a browser. */
export function scheduleFrame(callback: () => void): void {
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(callback);
  } else {
    callback();
  }
}

export interface RectPosition {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function setExplicitSize(element: HTMLElement | SVGElement, width: number, height: number, options: {fractionalWidth?: boolean} = {}): void {
  const roundedWidth = Math.max(1, options.fractionalWidth ? width : Math.ceil(width));
  const roundedHeight = Math.max(1, Math.ceil(height));
  element.setAttribute('width', `${roundedWidth}`);
  element.setAttribute('height', `${roundedHeight}`);
  setExplicitStyleSize(element, roundedWidth, roundedHeight, options);
}

export function setExplicitStyleSize(element: HTMLElement | SVGElement, width: number, height: number, options: {fractionalWidth?: boolean} = {}): void {
  const roundedWidth = Math.max(1, options.fractionalWidth ? width : Math.ceil(width));
  const roundedHeight = Math.max(1, Math.ceil(height));
  element.style.setProperty('width', `${roundedWidth}px`, 'important');
  element.style.setProperty('height', `${roundedHeight}px`, 'important');
  element.style.setProperty('max-width', 'none', 'important');
  element.style.setProperty('max-height', 'none', 'important');
  element.style.setProperty('display', 'block');
  element.style.setProperty('margin', '0', 'important');
  element.style.setProperty('flex', '0 0 auto');
}

export function makeScrollable(element: HTMLElement, axis: 'x' | 'y' | 'both' = 'both'): void {
  if (axis === 'x' || axis === 'both') {
    element.style.setProperty('overflow-x', 'auto', 'important');
  }
  if (axis === 'y' || axis === 'both') {
    element.style.setProperty('overflow-y', 'auto', 'important');
  }
}

export function makeClipped(element: HTMLElement, axis: 'x' | 'y' | 'both' = 'both'): void {
  if (axis === 'x' || axis === 'both') {
    element.style.setProperty('overflow-x', 'hidden', 'important');
  }
  if (axis === 'y' || axis === 'both') {
    element.style.setProperty('overflow-y', 'hidden', 'important');
  }
}

export function getRenderedHeight(element: HTMLElement | SVGElement, fallback: number): number {
  const rectHeight = element.getBoundingClientRect().height;
  if (rectHeight > 0) return rectHeight;

  const computed = window.getComputedStyle(element);
  const cssHeight = Number.parseFloat(computed.height);
  if (Number.isFinite(cssHeight) && cssHeight > 0) return cssHeight;

  const minHeight = Number.parseFloat(computed.minHeight);
  if (Number.isFinite(minHeight) && minHeight > 0) return minHeight;
  return fallback;
}

export function ensureScrollViewport<T extends HTMLElement | SVGElement>(
  element: T,
  className: string,
  viewportHeight: number,
): {viewport: HTMLElement; created: boolean} | undefined {
  const parent = element.parentElement;
  if (!parent) return undefined;

  let viewport: HTMLElement;
  let created = false;
  if (parent.dataset.webscoreScrollViewport === className) {
    viewport = parent;
  } else {
    viewport = document.createElement('div');
    viewport.classList.add(className);
    viewport.dataset.webscoreScrollViewport = className;
    parent.insertBefore(viewport, element);
    viewport.appendChild(element);
    created = true;
  }

  viewport.style.setProperty('display', 'block');
  viewport.style.setProperty('width', '100%');
  viewport.style.setProperty('max-width', '100%');
  viewport.style.setProperty('height', `${Math.max(1, Math.ceil(viewportHeight))}px`);
  viewport.style.setProperty('box-sizing', 'border-box');
  viewport.style.setProperty('margin', '0', 'important');
  viewport.style.setProperty('overflow-x', 'auto', 'important');
  viewport.style.setProperty('overflow-y', 'hidden', 'important');
  return {viewport, created};
}

export type ResolvedVisualizerConfig = Required<
  Pick<VisualizerRenderOptions, 'noteHeight' | 'noteSpacing' | 'pixelsPerSecond' | 'noteRGB' | 'activeNoteRGB'>
> &
  Pick<VisualizerRenderOptions, 'minPitch' | 'maxPitch' | 'noteColor' | 'activeNoteColor'>;

export type VisualizerConfig = VisualizerRenderOptions;
export type INoteSequence = ScoreNoteSequence;

// Compatibility type namespace retained for note-sequence consumers.
// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace NoteSequence {
  export type INote = ScoreSequenceNote;
  export type ITempo = ScoreNoteSequence['tempos'][number];
  export type IKeySignature = ScoreNoteSequence['keySignatures'][number];
  export type ITimeSignature = ScoreNoteSequence['timeSignatures'][number];
}

/** Shared sizing, active-note lookup and scroll lifecycle. */
export abstract class BaseVisualizer {
  public noteSequence: ScoreNoteSequence;
  protected config: ResolvedVisualizerConfig;
  protected height = 0;
  protected width = 0;
  protected parentElement?: HTMLElement;
  protected createdViewport?: HTMLElement;
  protected readonly virtualizationConfig: ResolvedVirtualization;
  /** Guards callbacks that were queued before the renderer was released. */
  protected disposed = false;
  private cachedMaxNoteDuration?: number;
  private cachedNotesSorted?: boolean;

  constructor(sequence: ScoreNoteSequence, config: VisualizerConfig = {}) {
    this.noteSequence = sequence;
    this.virtualizationConfig = resolveVirtualization(config.virtualization, sequence.notes.length);
    this.config = {
      noteHeight: config.noteHeight || 6,
      noteSpacing: typeof config.noteSpacing === 'number' && Number.isFinite(config.noteSpacing) && config.noteSpacing >= 0 ? config.noteSpacing : 1,
      pixelsPerSecond: config.pixelsPerSecond || 30,
      // Headless renderers use deliberately neutral functional defaults. The
      // styled Web Component supplies the WebScore palette from /element.
      noteRGB: config.noteRGB || '96, 96, 96',
      activeNoteRGB: config.activeNoteRGB || '32, 32, 32',
      noteColor: config.noteColor,
      activeNoteColor: config.activeNoteColor,
      minPitch: config.minPitch,
      maxPitch: config.maxPitch,
    };

    const size = this.getSize();
    this.width = size.width;
    this.height = size.height;
  }

  public abstract redraw(activeNote?: ScoreSequenceNote, scrollIntoView?: boolean): number | null;
  protected abstract clear(): void;
  public abstract clearActiveNotes(): void;

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.pendingScrollTarget = undefined;
    this.scrollFlushScheduled = false;
    this.teardownScrollViewport();
  }

  protected adoptScrollViewport(
    result: {viewport: HTMLElement; created: boolean} | undefined,
  ): HTMLElement | undefined {
    if (result?.created) this.createdViewport = result.viewport;
    return result?.viewport;
  }

  protected teardownScrollViewport(): void {
    const viewport = this.createdViewport;
    this.createdViewport = undefined;
    if (!viewport) return;
    const parent = viewport.parentElement;
    if (parent) {
      while (viewport.firstChild) parent.insertBefore(viewport.firstChild, viewport);
    }
    viewport.remove();
    if (this.parentElement === viewport) this.parentElement = undefined;
  }

  protected updateMinMaxPitches(noExtraPadding = false): void {
    if (this.config.minPitch !== undefined && this.config.maxPitch !== undefined) return;
    if (this.config.minPitch === undefined) this.config.minPitch = MAX_MIDI_PITCH;
    if (this.config.maxPitch === undefined) this.config.maxPitch = MIN_MIDI_PITCH;

    for (const note of this.noteSequence.notes) {
      this.config.minPitch = Math.min(note.pitch, this.config.minPitch);
      this.config.maxPitch = Math.max(note.pitch, this.config.maxPitch);
    }
    if (!noExtraPadding) {
      this.config.minPitch -= 2;
      this.config.maxPitch += 2;
    }
  }

  protected getSize(): {width: number; height: number} {
    this.updateMinMaxPitches();
    const minPitch = this.config.minPitch ?? MIN_MIDI_PITCH;
    const maxPitch = this.config.maxPitch ?? MAX_MIDI_PITCH;
    const height = (maxPitch - minPitch) * this.config.noteHeight;
    const endTime = this.noteSequence.totalTime;
    if (!endTime) {
      throw new Error(
        this.noteSequence.notes.length === 0
          ? 'Cannot visualize an empty score: the note sequence contains no notes and has no duration.'
          : 'Cannot size the visualizer horizontally: the note sequence has no totalTime. Ensure the score has a duration (e.g. via scoreToNoteSequence).',
      );
    }
    return {width: endTime * this.config.pixelsPerSecond, height};
  }

  protected getNotePosition(note: ScoreSequenceNote, _noteIndex: number): RectPosition | null {
    const minPitch = this.config.minPitch ?? MIN_MIDI_PITCH;
    const duration = this.getNoteEndTime(note) - this.getNoteStartTime(note);
    const x = this.getNoteStartTime(note) * this.config.pixelsPerSecond;
    const w = Math.max(this.config.pixelsPerSecond * duration - this.config.noteSpacing, MIN_NOTE_LENGTH);
    const y = this.height - (note.pitch - minPitch) * this.config.noteHeight;
    return {x, y, w, h: this.config.noteHeight};
  }

  private pendingScrollTarget?: number;
  private scrollFlushScheduled = false;

  protected scrollIntoViewIfNeeded(scrollIntoView: boolean | undefined, activeNotePosition: number | undefined): void {
    if (!scrollIntoView || activeNotePosition === undefined || !this.parentElement) return;
    this.pendingScrollTarget = activeNotePosition;
    if (this.scrollFlushScheduled) return;
    this.scrollFlushScheduled = true;
    scheduleFrame(() => {
      this.scrollFlushScheduled = false;
      if (this.disposed) {
        this.pendingScrollTarget = undefined;
        return;
      }
      this.flushPendingScroll();
    });
  }

  private flushPendingScroll(): void {
    const target = this.pendingScrollTarget;
    this.pendingScrollTarget = undefined;
    if (target === undefined || !this.parentElement) return;
    const containerWidth = this.parentElement.clientWidth || this.parentElement.getBoundingClientRect().width;
    if (target > this.parentElement.scrollLeft + containerWidth) this.parentElement.scrollLeft = target - 20;
  }

  protected getNoteStartTime(note: ScoreSequenceNote): number {
    return Math.round(note.startTime * 100000000) / 100000000;
  }

  protected getNoteEndTime(note: ScoreSequenceNote): number {
    return Math.round(note.endTime * 100000000) / 100000000;
  }

  protected getMaxNoteDuration(): number {
    if (this.cachedMaxNoteDuration === undefined) {
      this.cachedMaxNoteDuration = maxNoteDuration(this.noteSequence.notes);
    }
    return this.cachedMaxNoteDuration;
  }

  protected notesSortedByStart(): boolean {
    if (this.cachedNotesSorted === undefined) {
      this.cachedNotesSorted = isSortedByStartTime(this.noteSequence.notes);
    }
    return this.cachedNotesSorted;
  }

  protected getActiveCandidateRange(activeNote: ScoreSequenceNote): IndexRange {
    const notes = this.noteSequence.notes;
    if (!this.notesSortedByStart()) return {start: 0, end: notes.length};
    return activeNoteCandidateRange(notes, activeNote, this.getMaxNoteDuration());
  }

  protected isPaintingActiveNote(note: ScoreSequenceNote, playedNote: ScoreSequenceNote): boolean {
    return this.isActiveAtTime(note, playedNote.startTime);
  }

  protected getActiveTimeCandidateRange(seconds: number): IndexRange {
    if (!Number.isFinite(seconds)) throw new RangeError('Visualizer time must be finite.');
    return this.getActiveCandidateRange({pitch: 0, startTime: seconds, endTime: seconds});
  }

  protected isActiveAtTime(note: ScoreSequenceNote, seconds: number): boolean {
    return note.startTime <= seconds && seconds < note.endTime;
  }
}
