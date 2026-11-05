// SVG/canvas implementation for the explicit /render surface.
import type {ScoreNoteSequence, ScoreSequenceNote} from '../../core/types';
import {clampCanvasBackingSize, visibleNoteRange, type IndexRange} from '../../core/windowing';
import {
  BaseVisualizer,
  ensureScrollViewport,
  getRenderedHeight,
  scheduleFrame,
  setExplicitSize,
  setExplicitStyleSize,
  type VisualizerConfig,
} from './base';
import {BaseSVGVisualizer} from './svg';

/**
 * How long a resolved note colour is trusted while the playhead repaints. A
 * scheme change, a resize or an attribute change on the canvas or an ancestor
 * drops it at once; this bound only catches a stylesheet swapped elsewhere.
 */
const COLOR_REFRESH_MS = 1000;
/** Ancestor attributes a theme switch is written through. */
const THEME_ATTRIBUTES = ['class', 'style', 'data-theme', 'data-scheme', 'data-color-scheme'];

function clockNow(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now();
}

/** Canvas piano roll with viewport-sized static and active-note layers. */
export class PianoRollCanvasVisualizer extends BaseVisualizer {
  protected ctx: CanvasRenderingContext2D;
  private readonly canvas: HTMLCanvasElement;
  private overlayCanvas?: HTMLCanvasElement;
  private overlayCtx?: CanvasRenderingContext2D;
  private stage?: HTMLElement;
  private spacer?: HTMLElement;
  private backing = {width: 1, height: 1, scaleX: 1, scaleY: 1};
  private cssWidth = 1;
  private cssHeight = 1;
  private overlayTime?: number;
  private viewRedrawScheduled = false;
  private scrollTarget?: HTMLElement;
  private resizeObserver?: ResizeObserver;
  private staticColor?: string;
  /** The offset a follow-scroll already painted, so its own scroll event does not paint it again. */
  private followPainted?: number;
  /** Resolved layer colours: a probe and `getComputedStyle` per layer, not per frame. */
  private readonly resolvedColors = new Map<boolean, {input: string; color: string; at: number}>();
  /** Records attribute writes on the canvas and its ancestors; read synchronously at paint time. */
  private themeObserver?: MutationObserver;
  private releaseScheme?: () => void;
  private readonly onViewportScroll = (): void => {
    if (this.viewRedrawScheduled) return;
    this.viewRedrawScheduled = true;
    scheduleFrame(() => {
      this.viewRedrawScheduled = false;
      const followed = this.followPainted;
      this.followPainted = undefined;
      if (this.disposed || (followed !== undefined && this.getScrollX() === followed)) return;
      this.drawStatic();
      this.drawOverlay();
    });
  };

  constructor(sequence: ScoreNoteSequence, canvas: HTMLCanvasElement, config: VisualizerConfig = {}) {
    super(sequence, config);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('This visualizer requires a 2D canvas context');

    this.ctx = ctx;
    this.canvas = canvas;
    const viewportHeight = getRenderedHeight(canvas, this.height);
    this.parentElement = this.adoptScrollViewport(
      ensureScrollViewport(canvas, 'webscore-piano-roll-viewport', viewportHeight),
    );
    this.setupLayers();
    this.allocateBackingStore();

    if (this.parentElement) {
      this.scrollTarget = this.parentElement;
      this.parentElement.addEventListener('scroll', this.onViewportScroll, {passive: true});
      if (typeof ResizeObserver !== 'undefined') {
        this.resizeObserver = new ResizeObserver(() => this.handleViewportResize());
        this.resizeObserver.observe(this.parentElement);
      }
    }
    this.watchColorScheme();
    this.watchTheme();
    this.redraw();
  }

  /**
   * Observe the attributes a theme is switched through on the canvas and every
   * ancestor. Nothing runs on a mutation: `resolveColor` drains the records
   * synchronously, so a class or inline colour written just before a paint is
   * honoured by that paint.
   */
  private watchTheme(): void {
    this.themeObserver?.disconnect();
    this.themeObserver = undefined;
    const view = this.canvas.ownerDocument?.defaultView as (Window & typeof globalThis) | null | undefined;
    const Observer = view?.MutationObserver;
    if (!Observer) return;
    const observer = new Observer(() => {});
    for (let node: Element | null = this.canvas; node; node = node.parentElement) {
      observer.observe(node, {attributes: true, attributeFilter: THEME_ATTRIBUTES});
    }
    this.themeObserver = observer;
  }

  /** A light/dark switch re-resolves the layer colours and repaints both layers. */
  private watchColorScheme(): void {
    const view = this.canvas.ownerDocument?.defaultView;
    const query = typeof view?.matchMedia === 'function' ? view.matchMedia('(prefers-color-scheme: dark)') : undefined;
    if (!query) return;
    const changed = (): void => {
      if (this.disposed) return;
      this.resolvedColors.clear();
      this.drawStatic();
      this.drawOverlay();
    };
    if (typeof query.addEventListener === 'function') {
      query.addEventListener('change', changed);
      this.releaseScheme = () => query.removeEventListener('change', changed);
    } else if (typeof query.addListener === 'function') {
      query.addListener(changed);
      this.releaseScheme = () => query.removeListener(changed);
    }
  }

  private setupLayers(): void {
    const viewport = this.parentElement;
    if (!viewport || typeof document === 'undefined') return;

    const stage = document.createElement('div');
    stage.classList.add('webscore-piano-roll-canvas-stage');
    stage.style.setProperty('position', 'sticky');
    stage.style.setProperty('left', '0');
    stage.style.setProperty('top', '0');
    stage.style.setProperty('overflow', 'hidden');
    viewport.insertBefore(stage, this.canvas);
    stage.appendChild(this.canvas);
    this.canvas.style.setProperty('position', 'absolute');
    this.canvas.style.setProperty('top', '0');
    this.canvas.style.setProperty('left', '0');

    const overlay = document.createElement('canvas');
    overlay.classList.add('webscore-piano-roll-overlay');
    overlay.style.setProperty('position', 'absolute');
    overlay.style.setProperty('top', '0');
    overlay.style.setProperty('left', '0');
    overlay.style.setProperty('pointer-events', 'none');
    overlay.style.setProperty('z-index', '1');
    stage.appendChild(overlay);
    this.overlayCanvas = overlay;
    this.overlayCtx = overlay.getContext('2d') ?? undefined;

    const spacer = document.createElement('div');
    spacer.classList.add('webscore-piano-roll-spacer');
    spacer.style.setProperty('width', `${Math.max(1, Math.ceil(this.width))}px`);
    spacer.style.setProperty('height', '0');
    spacer.style.setProperty('pointer-events', 'none');
    viewport.appendChild(spacer);
    this.stage = stage;
    this.spacer = spacer;
  }

  private allocateBackingStore(): void {
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    const viewportWidth = this.parentElement?.clientWidth ?? 0;
    this.cssWidth = Math.max(1, Math.ceil(viewportWidth > 0 ? Math.min(this.width, viewportWidth) : this.width));
    this.cssHeight = Math.max(1, Math.ceil(this.height));
    this.backing = clampCanvasBackingSize(this.cssWidth, this.cssHeight, dpr);

    this.canvas.width = this.backing.width;
    this.canvas.height = this.backing.height;
    setExplicitStyleSize(this.canvas, this.cssWidth, this.cssHeight);
    if (this.overlayCanvas) {
      this.overlayCanvas.width = this.backing.width;
      this.overlayCanvas.height = this.backing.height;
      setExplicitStyleSize(this.overlayCanvas, this.cssWidth, this.cssHeight);
    }
    if (this.stage) {
      this.stage.style.setProperty('width', `${this.cssWidth}px`);
      this.stage.style.setProperty('height', `${this.cssHeight}px`);
    }
  }

  private handleViewportResize(): void {
    if (this.disposed) return;
    this.resolvedColors.clear();
    this.watchTheme();
    this.allocateBackingStore();
    this.drawStatic();
    this.drawOverlay();
  }

  private getScrollX(): number {
    return this.scrollTarget?.scrollLeft ?? 0;
  }

  private prepareContext(ctx: CanvasRenderingContext2D, scrollX: number): void {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.backing.width, this.backing.height);
    ctx.setTransform(this.backing.scaleX, 0, 0, this.backing.scaleY, -scrollX * this.backing.scaleX, 0);
  }

  private getVisibleIndexRange(scrollX: number): IndexRange {
    const notes = this.noteSequence.notes;
    if (!this.notesSortedByStart()) return {start: 0, end: notes.length};
    const pps = this.config.pixelsPerSecond;
    return visibleNoteRange(notes, scrollX / pps, (scrollX + this.cssWidth) / pps, this.getMaxNoteDuration());
  }

  private drawStatic(color = this.resolveColor(false)): void {
    const scrollX = this.getScrollX();
    this.prepareContext(this.ctx, scrollX);
    const notes = this.noteSequence.notes;
    const range = this.getVisibleIndexRange(scrollX);
    this.staticColor = color;
    for (let index = range.start; index < range.end; index += 1) {
      this.paintNote(this.ctx, notes[index], index, color);
    }
  }

  private drawOverlay(): void {
    const ctx = this.overlayCtx;
    if (!ctx) return;
    const scrollX = this.getScrollX();
    this.prepareContext(ctx, scrollX);
    const seconds = this.overlayTime;
    if (seconds === undefined) return;

    const notes = this.noteSequence.notes;
    const range = this.getActiveTimeCandidateRange(seconds);
    const color = this.resolveColor(true);
    for (let index = range.start; index < range.end; index += 1) {
      const note = notes[index];
      if (this.isActiveAtTime(note, seconds)) this.paintNote(ctx, note, index, color);
    }
  }

  /**
   * Canvas cannot resolve CSS variables itself. The answer is cached: the
   * playhead repaints every frame, and a probe plus `getComputedStyle` there
   * is a style recalculation per frame. A scheme change, a resize, a full
   * `redraw()` or a theme attribute written on the canvas or an ancestor drops
   * the cache; otherwise it is refreshed at most once per {@link COLOR_REFRESH_MS}.
   */
  private resolveColor(active: boolean): string {
    const color = active ? this.config.activeNoteColor : this.config.noteColor;
    const fallback = `rgb(${active ? this.config.activeNoteRGB : this.config.noteRGB})`;
    if (!color) return fallback;
    const document = this.canvas.ownerDocument;
    if (!document?.defaultView) return color;
    if (this.themeObserver && this.themeObserver.takeRecords().length > 0) this.resolvedColors.clear();
    const now = clockNow();
    const cached = this.resolvedColors.get(active);
    if (cached && cached.input === color && now - cached.at < COLOR_REFRESH_MS) return cached.color;
    const probe = document.createElement('span');
    probe.style.color = color;
    probe.style.display = 'none';
    this.canvas.appendChild(probe);
    try {
      const resolved = document.defaultView.getComputedStyle(probe).color || fallback;
      this.resolvedColors.set(active, {input: color, color: resolved, at: now});
      return resolved;
    } finally {
      probe.remove();
    }
  }

  private paintNote(ctx: CanvasRenderingContext2D, note: ScoreSequenceNote, index: number, color: string): void {
    const size = this.getNotePosition(note, index);
    if (!size) return;
    const opacity = note.velocity ? note.velocity / 100 + 0.2 : 1;
    ctx.fillStyle = color;
    ctx.globalAlpha = Math.min(1, Math.max(0, opacity));
    ctx.fillRect(Math.round(size.x), Math.round(size.y), Math.round(size.w), Math.round(size.h));
    ctx.globalAlpha = 1;
  }

  redraw(activeNote?: ScoreSequenceNote, scrollIntoView?: boolean): number | null {
    if (this.disposed) return null;
    if (!activeNote) {
      this.overlayTime = undefined;
      this.resolvedColors.clear();
      this.drawStatic();
      this.drawOverlay();
      return null;
    }
    return this.redrawAtTime(activeNote.startTime, scrollIntoView);
  }

  redrawAtTime(seconds: number, scrollIntoView?: boolean): number | null {
    if (this.disposed) return null;
    this.getActiveTimeCandidateRange(seconds);
    const color = this.resolveColor(false);
    if (color !== this.staticColor) this.drawStatic(color);
    this.overlayTime = seconds;
    this.drawOverlay();
    const activeNotePosition = seconds * this.config.pixelsPerSecond;
    this.scrollIntoViewIfNeeded(scrollIntoView, activeNotePosition);
    return activeNotePosition ?? null;
  }

  protected clear(): void {
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    if (this.overlayCtx && this.overlayCanvas) {
      this.overlayCtx.setTransform(1, 0, 0, 1, 0, 0);
      this.overlayCtx.clearRect(0, 0, this.overlayCanvas.width, this.overlayCanvas.height);
    }
  }

  public clearActiveNotes(): void {
    if (this.disposed) return;
    this.overlayTime = undefined;
    this.drawOverlay();
  }

  protected override paintScrolledViewport(): void {
    if (this.disposed) return;
    this.drawStatic();
    this.drawOverlay();
    this.followPainted = this.getScrollX();
  }

  public override dispose(): void {
    if (this.disposed) return;
    this.releaseScheme?.();
    this.releaseScheme = undefined;
    this.themeObserver?.disconnect();
    this.themeObserver = undefined;
    this.resolvedColors.clear();
    if (this.scrollTarget) {
      this.scrollTarget.removeEventListener('scroll', this.onViewportScroll);
      this.scrollTarget = undefined;
    }
    this.resizeObserver?.disconnect();
    this.resizeObserver = undefined;
    this.overlayTime = undefined;
    this.clear();
    if (this.stage) {
      const stageParent = this.stage.parentElement;
      if (stageParent && this.canvas.parentElement === this.stage) stageParent.insertBefore(this.canvas, this.stage);
      this.stage.remove();
      this.stage = undefined;
    }
    this.spacer?.remove();
    this.spacer = undefined;
    this.overlayCanvas = undefined;
    this.overlayCtx = undefined;
    super.dispose();
  }
}

/** SVG piano-roll renderer. */
export class PianoRollSVGVisualizer extends BaseSVGVisualizer {
  constructor(sequence: ScoreNoteSequence, svg: SVGSVGElement, config: VisualizerConfig = {}) {
    super(sequence, config);
    if (!(svg instanceof SVGSVGElement)) {
      throw new Error('This visualizer requires an <svg> element to display the visualization');
    }
    this.svg = svg;
    const size = this.getSize();
    this.width = size.width;
    this.height = size.height;
    this.clear();
    const viewportHeight = Math.max(getRenderedHeight(this.svg, this.height), this.height);
    this.parentElement = this.adoptScrollViewport(
      ensureScrollViewport(this.svg, 'webscore-piano-roll-viewport', viewportHeight),
    );
    setExplicitSize(this.svg, this.width, this.height);
    this.draw();
  }
}
