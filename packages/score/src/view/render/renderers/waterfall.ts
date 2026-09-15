// Waterfall DOM implementation for the explicit /render surface.
import {Rational, type Score} from '../../../core';
import {projectScoreAnnotations, type ScoreAnnotation} from '../../core/annotations';
import type {ScoreNoteSequence, ScoreSequenceNote} from '../../core/types';
import {bufferedScrollRange} from '../../core/windowing';
import {drawVerticalScoreAnnotations} from '../annotations';
import {
  MAX_MIDI_PITCH,
  MIN_MIDI_PITCH,
  MIN_NOTE_LENGTH,
  SVG_NS,
  makeClipped,
  makeScrollable,
  scheduleFrame,
  setExplicitSize,
  type RectPosition,
  type ResolvedVisualizerConfig,
  type VisualizerConfig,
} from './base';
import {BaseSVGVisualizer} from './svg';

export interface WaterfallVisualizerConfig extends VisualizerConfig {
  /** Natural-note pitch column width in pixels. */
  whiteNoteWidth?: number;
  /** Accidental pitch column width in pixels. */
  blackNoteWidth?: number;
  showOnlyOctavesUsed?: boolean;
  /** Fit pitch columns unless either column width is an explicit positive number. */
  fitToWidth?: boolean;
}

const BLACK_PITCH_CLASSES = new Set([1, 3, 6, 8, 10]);
const DEFAULT_BLACK_WIDTH_RATIO = .62;
const isBlackPitch = (pitch: number): boolean => BLACK_PITCH_CLASSES.has(pitch % 12);
const positiveWidth = (value: number | undefined, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
const pitchBound = (value: number | undefined): number | undefined =>
  typeof value === 'number' && Number.isFinite(value)
    ? Math.max(MIN_MIDI_PITCH, Math.min(MAX_MIDI_PITCH, Math.round(value))) : undefined;

type PitchColumn = {x: number; width: number};
type ResolvedWaterfallVisualizerConfig = ResolvedVisualizerConfig &
  Required<Pick<WaterfallVisualizerConfig, 'whiteNoteWidth' | 'blackNoteWidth'>> &
  Pick<WaterfallVisualizerConfig, 'showOnlyOctavesUsed'>;

/** Passive vertical time view; held-pitch presentation belongs to PitchView. */
export class WaterfallSVGVisualizer extends BaseSVGVisualizer {
  protected declare config: ResolvedWaterfallVisualizerConfig;
  /** Pending follow-scroll target; `y` and `height` are svg-space rect attributes. */
  private pendingVerticalScroll?: {y: number; height: number; force: boolean};
  private verticalScrollScheduled = false;
  private lastWrittenScrollTop?: number;
  private hostContainer?: HTMLDivElement;
  private columns = new Map<number, PitchColumn>();
  private layoutObserver?: ResizeObserver;
  private removeWindowResize?: () => void;
  private fitToWidth = false;
  private blackWidthRatio = DEFAULT_BLACK_WIDTH_RATIO;
  private requestedPitchRange?: {min?: number; max?: number};
  private inferredPitchRange?: {min: number; max: number};
  private lowPitch = 21;
  private highPitch = 108;
  private lastActiveTime?: number;
  /** Position survives highlight clearing so stop/replay can rewind the viewport. */
  private lastPositionTime?: number;
  private readonly annotations: readonly ScoreAnnotation[];
  private annotationWidth = 0;
  /**
   * Top padding (px) of the scrollable notes container.
   *
   * `setupDOM` lays the scrollable content out as [top padding | notes SVG]
   * and sizes both the padding and the container's border-box height to one
   * viewport, so playback starts on an empty screen and time 0 (the bottom
   * of the SVG) scrolls up from the bottom edge. Two vertical coordinate
   * spaces follow from that layout:
   *
   * - scroll-space: `scrollTop` units; y = 0 at the top of the scrollable
   *   content (the start of the padding).
   * - svg-space: note-rect `y` attribute units; y = 0 at the top of the
   *   notes SVG, which sits `scrollPaddingTop` below the scroll-space
   *   origin (larger y = earlier time).
   *
   * Convert with {@link scrollToSvgY} / {@link svgToScrollY}; never compare
   * a value from one space against a value from the other.
   */
  private scrollPaddingTop = 0;

  constructor(sequence: ScoreNoteSequence, parentElement: HTMLDivElement, config: WaterfallVisualizerConfig = {}, private readonly score?: Score) {
    super(sequence, config);
    if (!(parentElement instanceof HTMLDivElement)) {
      throw new Error('This visualizer requires a <div> element to display the visualization');
    }

    const explicitWhiteWidth = positiveWidth(config.whiteNoteWidth, 0);
    const explicitBlackWidth = positiveWidth(config.blackNoteWidth, 0);
    const whiteNoteWidth = explicitWhiteWidth || (explicitBlackWidth ? explicitBlackWidth / DEFAULT_BLACK_WIDTH_RATIO : 20);
    this.requestedPitchRange = {min: pitchBound(config.minPitch), max: pitchBound(config.maxPitch)};
    this.config = {
      ...this.config,
      whiteNoteWidth,
      blackNoteWidth: Math.min(whiteNoteWidth, explicitBlackWidth || whiteNoteWidth * DEFAULT_BLACK_WIDTH_RATIO),
      showOnlyOctavesUsed: config.showOnlyOctavesUsed,
    };
    this.fitToWidth = config.fitToWidth === true && ![config.whiteNoteWidth, config.blackNoteWidth]
      .some((width) => typeof width === 'number' && Number.isFinite(width) && width > 0);
    this.blackWidthRatio = this.config.blackNoteWidth / this.config.whiteNoteWidth;
    this.annotations = score && config.showAnnotations !== false ? projectScoreAnnotations(score) : [];
    this.annotationWidth = this.annotations.length ? 180 : 0;

    this.setupDOM(parentElement);
    if (!this.svg || !this.parentElement) return;
    makeScrollable(parentElement, 'x');
    makeClipped(parentElement, 'y');
    try {
      this.resizeLayout();
    } catch (error) {
      this.dispose();
      throw error;
    }
    this.parentElement.scrollTop = this.parentElement.scrollHeight;
    const view = parentElement.ownerDocument?.defaultView;
    const Observer = view?.ResizeObserver ?? globalThis.ResizeObserver;
    if (Observer) {
      this.layoutObserver = new Observer(() => this.resizeLayout());
      this.layoutObserver.observe(parentElement);
    } else if (view) {
      const resize = () => this.resizeLayout();
      view.addEventListener('resize', resize);
      this.removeWindowResize = () => view.removeEventListener('resize', resize);
    }
  }

  redraw(activeNote?: ScoreSequenceNote, scrollIntoView?: boolean): number | null {
    if (this.disposed || !activeNote) return null;
    this.redrawAtTime(activeNote.startTime, scrollIntoView);
    if (this.disposed) return null;
    const position = this.getNotePosition(activeNote, 0);
    return position ? Math.round(position.y) : null;
  }

  override redrawAtTime(seconds: number, scrollIntoView?: boolean): number | null {
    if (this.disposed) return null;
    const range = this.getActiveTimeCandidateRange(seconds);
    if (!this.drawn) this.draw();
    if (!this.svg || !this.parentElement) return null;

    const movedBackwards = this.lastPositionTime !== undefined && seconds < this.lastPositionTime;
    this.clearActiveNotes();
    if (this.disposed) return null;
    this.lastActiveTime = seconds;
    this.lastPositionTime = seconds;
    const notes = this.noteSequence.notes;
    for (let index = range.start; index < range.end; index += 1) {
      const note = notes[index];
      if (!this.isActiveAtTime(note, seconds)) continue;
      const element = this.resolveNoteElementForHighlight(index);
      this.fillActiveRect(element, note);
    }
    const position = this.height - seconds * this.config.pixelsPerSecond;
    if (!this.disposed && scrollIntoView !== false) this.scheduleVerticalScroll(position, 0, movedBackwards);
    return position;
  }

  protected override getVisibleTimeWindow(): {t0: number; t1: number} | undefined {
    const element = this.parentElement;
    if (!element) return undefined;
    const size = element.clientHeight;
    if (!(size > 0)) return undefined;
    const {lo, hi} = bufferedScrollRange(element.scrollTop, size, this.virtualizationConfig.bufferScreens);
    // The buffered window is in scroll-space; note positions (and therefore
    // times) live in svg-space, so convert before mapping to time. Time is
    // inverted along y: larger svg y = earlier time.
    const pps = this.config.pixelsPerSecond;
    return {t0: (this.height - this.scrollToSvgY(hi)) / pps, t1: (this.height - this.scrollToSvgY(lo)) / pps};
  }

  /** scroll-space y → svg-space y (see {@link scrollPaddingTop}). */
  private scrollToSvgY(scrollY: number): number {
    return scrollY - this.scrollPaddingTop;
  }

  /** svg-space y → scroll-space y (see {@link scrollPaddingTop}). */
  private svgToScrollY(svgY: number): number {
    return svgY + this.scrollPaddingTop;
  }

  private scheduleVerticalScroll(y: number, height: number, force = false): void {
    // A reset followed by the next tick within one frame still needs to rewind.
    this.pendingVerticalScroll = {y, height, force: force || this.pendingVerticalScroll?.force === true};
    if (this.verticalScrollScheduled) return;
    this.verticalScrollScheduled = true;
    scheduleFrame(() => {
      this.verticalScrollScheduled = false;
      if (this.disposed) {
        this.pendingVerticalScroll = undefined;
        return;
      }
      this.flushVerticalScroll();
    });
  }

  private flushVerticalScroll(): void {
    const pending = this.pendingVerticalScroll;
    this.pendingVerticalScroll = undefined;
    if (!pending || !this.parentElement) return;
    const element = this.parentElement;
    // The container's border-box height equals its top padding (see
    // setupDOM), so the padding doubles as the viewport size when
    // clientHeight is not measurable.
    const viewportSize = element.clientHeight > 0 ? element.clientHeight : this.scrollPaddingTop;
    // All svg-space: bottom edge of the visible area vs. bottom edge of the
    // active note's rect.
    const viewportBottom = this.scrollToSvgY(element.scrollTop + viewportSize);
    const noteBottom = pending.y + pending.height;
    // Follow mode: as playback moves the active note up the SVG (later time =
    // smaller y), keep its bottom edge pinned to the visible bottom edge.
    // Ordinary forward updates preserve a manual look-ahead. An earlier
    // playback position is a seek/repeat and must return to its landing point.
    if (pending.force || noteBottom < viewportBottom) {
      const target = this.svgToScrollY(noteBottom) - viewportSize;
      if (target !== element.scrollTop && (pending.force || target !== this.lastWrittenScrollTop)) {
        element.scrollTop = target;
        this.lastWrittenScrollTop = target;
      }
    }
  }

  private resolvePitchRange(): {min: number; max: number} {
    let automatic = {min: 21, max: 108};
    if (this.config.showOnlyOctavesUsed) {
      if (!this.inferredPitchRange) {
        let min = MAX_MIDI_PITCH;
        let max = MIN_MIDI_PITCH;
        for (const note of this.noteSequence.notes) {
          min = Math.min(min, note.pitch);
          max = Math.max(max, note.pitch);
        }
        this.inferredPitchRange = {
          min: Math.max(MIN_MIDI_PITCH, Math.floor(min / 12) * 12),
          max: Math.min(MAX_MIDI_PITCH, Math.floor(max / 12) * 12 + 11),
        };
      }
      automatic = this.inferredPitchRange;
    }
    // Base construction calls getSize before derived fields are initialized.
    // Preserve the caller's endpoints separately from any inferred ranges.
    const requested = this.requestedPitchRange ?? {min: pitchBound(this.config.minPitch), max: pitchBound(this.config.maxPitch)};
    let min = requested.min ?? automatic.min;
    let max = requested.max ?? automatic.max;
    if (min > max) {
      if (requested.min !== undefined && requested.max !== undefined) [min, max] = [max, min];
      else if (requested.min !== undefined) max = min;
      else min = max;
    }
    return {min, max};
  }

  protected override getSize(): {width: number; height: number} {
    const {min: low, max: high} = this.resolvePitchRange();
    this.lowPitch = low;
    this.highPitch = high;
    let whiteNotesDrawn = 0;
    for (let midi = low; midi <= high; midi += 1) if (!isBlackPitch(midi)) whiteNotesDrawn += 1;
    // Raised endpoints reserve half a natural column, matching pitch keyboards.
    const units = whiteNotesDrawn + (isBlackPitch(low) ? .5 : 0) + (isBlackPitch(high) ? .5 : 0);
    const measured = this.hostContainer?.clientWidth || this.hostContainer?.getBoundingClientRect().width || 0;
    if (this.fitToWidth && measured > 0) {
      this.annotationWidth = this.annotations?.length ? Math.min(180, measured * .4) : 0;
      this.config.whiteNoteWidth = Math.max(1, measured - this.annotationWidth) / Math.max(1, units);
      this.config.blackNoteWidth = this.config.whiteNoteWidth * this.blackWidthRatio;
    }

    const endTime = this.noteSequence.totalTime;
    if (!endTime) {
      throw new Error(
        this.noteSequence.notes.length === 0
          ? 'Cannot visualize an empty score: the note sequence contains no notes and has no duration.'
          : 'Cannot size the waterfall visualizer: the note sequence has no totalTime. Ensure the score has a duration (e.g. via scoreToNoteSequence).',
      );
    }
    return {
      width: Math.max(1, units) * (this.config.whiteNoteWidth || 20),
      height: Math.max(endTime * this.config.pixelsPerSecond, MIN_NOTE_LENGTH),
    };
  }

  protected override getNotePosition(note: ScoreSequenceNote, _noteIndex: number): RectPosition | null {
    const column = this.columns.get(note.pitch);
    if (!column) return null;
    const len = this.getNoteEndTime(note) - this.getNoteStartTime(note);
    const h = Math.max(this.config.pixelsPerSecond * len - this.config.noteSpacing, MIN_NOTE_LENGTH);
    const x = column.x;
    const w = column.width;
    const y = this.height - this.getNoteStartTime(note) * this.config.pixelsPerSecond - h;
    return {x, y, w, h};
  }

  private getViewportHeight(): number {
    const measured = this.hostContainer?.clientHeight || this.hostContainer?.getBoundingClientRect().height || 0;
    // A short score need not reserve an empty viewport. Long scores retain a
    // bounded natural height, while explicit host sizing fills all its space.
    return measured > 0 ? measured : Math.min(200, Math.max(80, this.noteSequence.totalTime * this.config.pixelsPerSecond));
  }

  private setupDOM(container: HTMLDivElement): void {
    this.hostContainer = container;
    this.parentElement = document.createElement('div');
    this.parentElement.classList.add('waterfall-notes-container');
    const height = this.getViewportHeight();
    // One viewport of top padding and the same border-box height: the notes
    // SVG lays out below the padding, establishing the scroll-space/svg-space
    // offset documented on `scrollPaddingTop`.
    this.scrollPaddingTop = Math.max(1, height);
    this.parentElement.style.paddingTop = `${this.scrollPaddingTop}px`;
    this.parentElement.style.height = `${this.scrollPaddingTop}px`;
    this.parentElement.style.boxSizing = 'border-box';
    this.parentElement.style.overflowX = 'hidden';
    this.parentElement.style.overflowY = 'auto';

    this.svg = document.createElementNS(SVG_NS, 'svg');
    this.svg.classList.add('waterfall-notes');
    this.parentElement.appendChild(this.svg);
    container.innerHTML = '';
    container.appendChild(this.parentElement);
    makeScrollable(container, 'x');
  }

  private layoutPitchColumns(): void {
    this.columns.clear();
    let x = isBlackPitch(this.lowPitch) ? this.config.whiteNoteWidth / 2 : 0;
    for (let midi = this.lowPitch; midi <= this.highPitch; midi += 1) {
      if (isBlackPitch(midi)) {
        this.columns.set(midi, {x: x - this.config.blackNoteWidth / 2, width: this.config.blackNoteWidth});
      } else {
        this.columns.set(midi, {x, width: this.config.whiteNoteWidth});
        x += this.config.whiteNoteWidth;
      }
    }
  }

  public clearActiveNotes(): void {
    if (this.disposed) return;
    if (this.svg) this.unfillActiveRect(this.svg);
    this.lastActiveTime = undefined;
  }

  public override dispose(): void {
    if (this.disposed) return;
    super.dispose();
    this.layoutObserver?.disconnect();
    this.removeWindowResize?.();
    this.columns.clear();
    this.activeElements.clear();
    this.extraIndices.clear();
    this.renderedRange = {start: 0, end: 0};
    this.pendingVerticalScroll = undefined;
    this.noteElements = [];
    this.drawn = false;
    if (this.parentElement?.parentElement === this.hostContainer) this.parentElement?.remove();
    this.parentElement = undefined;
    this.svg = undefined;
    this.hostContainer = undefined;
    this.lastActiveTime = undefined;
    this.lastPositionTime = undefined;
  }

  private resizeLayout(): void {
    if (this.disposed || !this.hostContainer || !this.parentElement || !this.svg) return;
    const box = this.hostContainer.getBoundingClientRect();
    if (this.drawn && !(box.width > 0 || box.height > 0 || this.hostContainer.clientWidth > 0 || this.hostContainer.clientHeight > 0)) return;
    const padding = Math.max(1, this.getViewportHeight());
    const oldPosition = this.parentElement.scrollTop;
    const oldTime = this.lastActiveTime;
    const size = this.getSize();
    if (this.drawn && size.width === this.width && padding === this.scrollPaddingTop) return;
    this.width = size.width;
    this.height = size.height;
    this.scrollPaddingTop = padding;
    this.parentElement.style.paddingTop = `${padding}px`;
    this.parentElement.style.height = `${padding}px`;
    this.parentElement.style.width = `${this.width + this.annotationWidth}px`;
    setExplicitSize(this.svg, this.width + this.annotationWidth, this.height, {fractionalWidth: true});
    this.clear();
    this.layoutPitchColumns();
    if (this.disposed) return;
    this.draw();
    if (this.score && this.annotations.length) drawVerticalScoreAnnotations(this.svg, this.annotations, {
      yAtQuarter: (quarter) => this.height - this.score!.timeMap.quartersToSeconds(Rational.from(quarter)) * this.config.pixelsPerSecond,
      x: this.width, width: this.annotationWidth, height: this.height,
      color: this.config.noteColor ?? `rgb(${this.config.noteRGB})`,
    });
    if (oldTime !== undefined) this.redrawAtTime(oldTime, false);
    if (this.disposed || !this.parentElement) return;
    // Padding and viewport have equal height, so scrollTop is the score's
    // visible bottom position in SVG coordinates even after a height change.
    this.parentElement.scrollTop = oldPosition;
    this.lastWrittenScrollTop = undefined;
  }
}
