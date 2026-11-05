// Waterfall DOM implementation for the explicit /render surface.
import {Rational, type Score} from '../../../core';
import {projectScoreAnnotations, type ScoreAnnotation} from '../../core/annotations';
import type {ScoreNoteSequence, ScoreSequenceNote} from '../../core/types';
import {bufferedScrollRange} from '../../core/windowing';
import {drawHorizontalScoreAnnotations, drawVerticalScoreAnnotations} from '../annotations';
import {horizontalDirection, viewDirection} from './direction';
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

/** Passive directional time view; held-pitch presentation belongs to PitchView. */
export class WaterfallSVGVisualizer extends BaseSVGVisualizer {
  protected declare config: ResolvedWaterfallVisualizerConfig;
  /** Pending follow-scroll target on the SVG time axis; independent of physical orientation. */
  private pendingTimeScroll?: {y: number; height: number; force: boolean};
  private timeScrollScheduled = false;
  private lastWrittenScrollPosition?: number;
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
   * Time-axis viewport length and blank landing space in CSS pixels. Down/right
   * prepend this space before the SVG; up/left append it after the SVG. Keep
   * scroll-space and SVG-space separate when mapping notes and visible windows.
   * In the default down orientation, this is the leading top padding.
   */
  private scrollPaddingTop = 0;

  private get direction() { return viewDirection(this.config?.direction, 'down'); }
  /** Native time-axis viewport; a UI presenter may supply focus and scrollbar styling. */
  get scrollViewport(): HTMLElement | undefined { return this.parentElement; }
  private get horizontal(): boolean { return horizontalDirection(this.direction); }
  private get reversed(): boolean { return this.direction === 'down' || this.direction === 'right'; }
  private get scrollPosition(): number { return this.horizontal ? this.parentElement?.scrollLeft ?? 0 : this.parentElement?.scrollTop ?? 0; }
  private set scrollPosition(value: number) {
    if (!this.parentElement) return;
    if (this.horizontal) this.parentElement.scrollLeft = value;
    else this.parentElement.scrollTop = value;
  }

  private timePosition(seconds: number): number {
    return this.reversed ? this.height - seconds * this.config.pixelsPerSecond : seconds * this.config.pixelsPerSecond;
  }

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
    this.annotationWidth = this.annotations.length ? (this.horizontal ? this.horizontalAnnotations().height : 180) : 0;

    this.setupDOM(parentElement);
    if (!this.svg || !this.parentElement) return;
    makeScrollable(parentElement, this.horizontal ? 'y' : 'x');
    makeClipped(parentElement, this.horizontal ? 'x' : 'y');
    try {
      this.resizeLayout();
    } catch (error) {
      this.dispose();
      throw error;
    }
    this.scrollPosition = this.reversed ? this.height : 0;
    if (this.shouldVirtualize()) this.updateVirtualWindow();
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
    return position ? Math.round(this.horizontal ? position.x : position.y) : null;
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
    const position = this.timePosition(seconds);
    if (!this.disposed && scrollIntoView !== false) this.scheduleTimeScroll(position, 0, movedBackwards);
    return position;
  }

  protected override getVisibleTimeWindow(): {t0: number; t1: number} | undefined {
    const element = this.parentElement;
    if (!element) return undefined;
    const size = this.horizontal ? element.clientWidth : element.clientHeight;
    if (!(size > 0)) return undefined;
    const {lo, hi} = bufferedScrollRange(this.scrollPosition, size, this.virtualizationConfig.bufferScreens);
    // Convert the physical viewport into the SVG time axis, accounting for
    // the blank landing space before mapping back to nominal seconds.
    const pps = this.config.pixelsPerSecond;
    return this.reversed
      ? {t0: (this.height - this.scrollToSvgPosition(hi)) / pps, t1: (this.height - this.scrollToSvgPosition(lo)) / pps}
      : {t0: this.scrollToSvgPosition(lo) / pps, t1: this.scrollToSvgPosition(hi) / pps};
  }

  /** scroll-space → SVG time-axis position (see {@link scrollPaddingTop}). */
  private scrollToSvgPosition(scrollY: number): number {
    return scrollY - (this.reversed ? this.scrollPaddingTop : 0);
  }

  /** SVG time-axis position → scroll-space (see {@link scrollPaddingTop}). */
  private svgToScrollPosition(svgY: number): number {
    return svgY + (this.reversed ? this.scrollPaddingTop : 0);
  }

  private scheduleTimeScroll(y: number, height: number, force = false): void {
    // A reset followed by the next tick within one frame still needs to rewind.
    this.pendingTimeScroll = {y, height, force: force || this.pendingTimeScroll?.force === true};
    if (this.timeScrollScheduled) return;
    this.timeScrollScheduled = true;
    scheduleFrame(() => {
      this.timeScrollScheduled = false;
      if (this.disposed) {
        this.pendingTimeScroll = undefined;
        return;
      }
      this.flushTimeScroll();
    });
  }

  private flushTimeScroll(): void {
    const pending = this.pendingTimeScroll;
    this.pendingTimeScroll = undefined;
    if (!pending || !this.parentElement) return;
    const element = this.parentElement;
    const measured = this.horizontal ? element.clientWidth : element.clientHeight;
    const viewportSize = measured > 0 ? measured : this.scrollPaddingTop;
    const edge = this.scrollToSvgPosition(this.scrollPosition + (this.reversed ? viewportSize : 0));
    const targetEdge = pending.y + (this.reversed ? pending.height : 0);
    // Forward ticks preserve a manual look-ahead in either coordinate direction.
    // A seek to earlier musical time always returns to its current landing edge.
    if (pending.force || (this.reversed ? targetEdge < edge : targetEdge > edge)) {
      const target = this.svgToScrollPosition(targetEdge) - (this.reversed ? viewportSize : 0);
      if (target !== this.scrollPosition && (pending.force || target !== this.lastWrittenScrollPosition)) {
        this.scrollPosition = target;
        this.lastWrittenScrollPosition = target;
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
    const measured = this.horizontal
      ? this.hostContainer?.clientHeight || this.hostContainer?.getBoundingClientRect().height || 0
      : this.hostContainer?.clientWidth || this.hostContainer?.getBoundingClientRect().width || 0;
    if (this.fitToWidth && measured > 0) {
      this.annotationWidth = this.annotations?.length ? Math.min(this.horizontal ? this.horizontalAnnotations().height : 180, measured * .4) : 0;
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
    const time = this.getNoteStartTime(note) * this.config.pixelsPerSecond;
    const position = this.reversed ? this.height - time - h : time;
    return this.horizontal
      ? {x: position, y: this.width - column.x - column.width, w: h, h: column.width}
      : {x: column.x, y: position, w: column.width, h};
  }

  private getViewportHeight(): number {
    const measured = this.horizontal
      ? this.hostContainer?.clientWidth || this.hostContainer?.getBoundingClientRect().width || 0
      : this.hostContainer?.clientHeight || this.hostContainer?.getBoundingClientRect().height || 0;
    // A short score need not reserve an empty viewport. Long scores retain a
    // bounded natural height, while explicit host sizing fills all its space.
    return measured > 0 ? measured : Math.min(200, Math.max(80, this.noteSequence.totalTime * this.config.pixelsPerSecond));
  }

  private setupDOM(container: HTMLDivElement): void {
    this.hostContainer = container;
    this.parentElement = document.createElement('div');
    this.parentElement.classList.add('waterfall-notes-container');
    this.parentElement.dataset.direction = this.direction;
    this.parentElement.style.boxSizing = 'border-box';
    this.parentElement.style.overflowX = this.horizontal ? 'auto' : 'hidden';
    this.parentElement.style.overflowY = this.horizontal ? 'hidden' : 'auto';
    this.layoutViewport(this.getViewportHeight());

    this.svg = document.createElementNS(SVG_NS, 'svg');
    this.svg.classList.add('waterfall-notes');
    this.parentElement.appendChild(this.svg);
    container.innerHTML = '';
    container.appendChild(this.parentElement);
    makeScrollable(container, this.horizontal ? 'y' : 'x');
  }

  private layoutViewport(size: number): void {
    const viewport = this.parentElement;
    if (!viewport) return;
    this.scrollPaddingTop = Math.max(1, size);
    const padding = `${this.scrollPaddingTop}px`;
    viewport.style.paddingTop = !this.horizontal && this.reversed ? padding : '0';
    viewport.style.paddingBottom = !this.horizontal && !this.reversed ? padding : '0';
    viewport.style.paddingLeft = this.horizontal && this.reversed ? padding : '0';
    viewport.style.paddingRight = this.horizontal && !this.reversed ? padding : '0';
    viewport.style.width = this.horizontal ? padding : `${this.width + this.annotationWidth}px`;
    viewport.style.height = this.horizontal ? `${this.width + this.annotationWidth}px` : padding;
  }

  private horizontalAnnotations(svg = document.createElementNS(SVG_NS, 'svg')): {height: number; group: SVGGElement} {
    return drawHorizontalScoreAnnotations(svg, this.annotations ?? [], {
      xAtQuarter: (quarter) => this.timePosition(this.score!.timeMap.quartersToSeconds(Rational.from(quarter))),
      width: this.height, reverse: this.reversed,
      color: this.config.noteColor ?? `rgb(${this.config.noteRGB})`,
    });
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
    this.pendingTimeScroll = undefined;
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
    const oldPosition = this.scrollPosition;
    const oldTime = this.lastActiveTime;
    const size = this.getSize();
    if (this.drawn && size.width === this.width && padding === this.scrollPaddingTop) return;
    this.width = size.width;
    this.height = size.height;
    this.layoutViewport(padding);
    setExplicitSize(this.svg, this.horizontal ? this.height : this.width + this.annotationWidth, this.horizontal ? this.width + this.annotationWidth : this.height, {fractionalWidth: true, fractionalHeight: true});
    this.clear();
    this.layoutPitchColumns();
    if (this.disposed) return;
    this.draw();
    if (this.score && this.annotations.length) {
      if (this.horizontal) {
        const {group} = this.horizontalAnnotations(this.svg);
        group.setAttribute('transform', `translate(0 ${this.width}) ${group.getAttribute('transform') ?? ''}`.trim());
      } else drawVerticalScoreAnnotations(this.svg, this.annotations, {
        yAtQuarter: (quarter) => this.timePosition(this.score!.timeMap.quartersToSeconds(Rational.from(quarter))),
        x: this.width, width: this.annotationWidth, height: this.height,
        color: this.config.noteColor ?? `rgb(${this.config.noteRGB})`,
      });
    }
    if (oldTime !== undefined) this.redrawAtTime(oldTime, false);
    if (this.disposed || !this.parentElement) return;
    // The landing-space extent matches the viewport, so the physical scroll
    // coordinate retains its musical edge when the viewport is resized.
    this.scrollPosition = oldPosition;
    this.lastWrittenScrollPosition = undefined;
  }
}
