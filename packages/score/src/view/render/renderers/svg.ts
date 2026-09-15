// Shared SVG implementation for the explicit /render surface.
import type {ScoreSequenceNote} from '../../core/types';
import {bufferedScrollRange, visibleNoteRange, type IndexRange} from '../../core/windowing';
import {
  BaseVisualizer,
  SVG_NS,
  scheduleFrame,
  type CSSProperty,
  type DataAttribute,
} from './base';

/** Shared active-note bookkeeping and windowed mounting for SVG renderers. */
export abstract class BaseSVGVisualizer extends BaseVisualizer {
  protected svg?: SVGSVGElement;
  protected drawn = false;
  protected noteElements: Array<SVGRectElement | undefined> = [];
  protected activeElements = new Set<SVGRectElement>();
  protected renderedRange: IndexRange = {start: 0, end: 0};
  protected extraIndices = new Set<number>();
  private virtualizationActive = false;
  private windowUpdateScheduled = false;
  private scrollTarget?: HTMLElement;
  private resizeObserver?: ResizeObserver;
  private readonly onViewportScroll = (): void => {
    if (this.windowUpdateScheduled) return;
    this.windowUpdateScheduled = true;
    scheduleFrame(() => {
      this.windowUpdateScheduled = false;
      if (!this.disposed && this.virtualizationActive && this.drawn) this.updateVirtualWindow();
    });
  };

  protected getNoteElement(index: number): SVGRectElement | null {
    const cached = this.noteElements[index];
    if (cached && cached.isConnected) return cached;
    const queried = this.svg?.querySelector<SVGRectElement>(`rect[data-index="${index}"]`) ?? null;
    if (queried) this.noteElements[index] = queried;
    return queried;
  }

  redraw(activeNote?: ScoreSequenceNote, scrollIntoView?: boolean): number | null {
    if (this.disposed || !activeNote) return null;
    this.redrawAtTime(activeNote.startTime, scrollIntoView);
    const position = this.getNotePosition(activeNote, 0);
    return position ? Math.round(position.x) : null;
  }

  redrawAtTime(seconds: number, scrollIntoView?: boolean): number | null {
    if (this.disposed) return null;
    const range = this.getActiveTimeCandidateRange(seconds);
    if (!this.drawn) this.draw();
    if (!this.svg) return null;

    this.unfillActiveRect(this.svg);
    const notes = this.noteSequence.notes;
    for (let index = range.start; index < range.end; index += 1) {
      const note = notes[index];
      if (!this.isActiveAtTime(note, seconds)) continue;
      const element = this.resolveNoteElementForHighlight(index);
      if (!element) continue;
      this.fillActiveRect(element, note);
    }

    const activeNotePosition = seconds * this.config.pixelsPerSecond;
    this.scrollIntoViewIfNeeded(scrollIntoView, activeNotePosition);
    return activeNotePosition ?? null;
  }

  protected resolveNoteElementForHighlight(index: number): SVGRectElement | null {
    let element = this.getNoteElement(index);
    if (!element && this.virtualizationActive) {
      this.drawNoteAtIndex(index);
      element = this.noteElements[index] ?? null;
      if (element) this.extraIndices.add(index);
    }
    return element;
  }

  protected fillActiveRect(element: Element | null, note: ScoreSequenceNote): void {
    if (!element) return;
    element.setAttribute('fill', this.getNoteFillColor(note, true));
    element.classList.add('active');
    this.activeElements.add(element as SVGRectElement);
  }

  protected unfillActiveRect(_svg: SVGSVGElement): void {
    for (const element of this.activeElements) {
      const index = Number(element.dataset.index);
      const note = this.noteSequence.notes[index];
      if (note) element.setAttribute('fill', this.getNoteFillColor(note, false));
      element.classList.remove('active');
    }
    this.activeElements.clear();
  }

  protected draw(): void {
    if (this.disposed || !this.svg) return;
    if (this.shouldVirtualize()) {
      this.setupVirtualization();
      this.updateVirtualWindow();
    } else {
      for (let index = 0; index < this.noteSequence.notes.length; index += 1) this.drawNoteAtIndex(index);
    }
    this.drawn = true;
  }

  protected drawNoteAtIndex(index: number): void {
    const note = this.noteSequence.notes[index];
    if (!note) return;
    const size = this.getNotePosition(note, index);
    if (!size) return;

    const fill = this.getNoteFillColor(note, false);
    const dataAttributes: DataAttribute[] = [
      ['index', index],
      ['instrument', note.instrument],
      ['program', note.program],
      ['isDrum', note.isDrum === true],
      ['pitch', note.pitch],
    ];
    const cssProperties: CSSProperty[] = [['--midi-velocity', String(note.velocity !== undefined ? note.velocity : 127)]];
    this.drawNote(index, size.x, size.y, size.w, size.h, fill, dataAttributes, cssProperties);
  }

  protected shouldVirtualize(): boolean {
    return this.virtualizationConfig.enabled && this.notesSortedByStart() && !!this.getVirtualScrollElement();
  }

  protected getVirtualScrollElement(): HTMLElement | undefined {
    return this.parentElement;
  }

  protected getVisibleTimeWindow(): {t0: number; t1: number} | undefined {
    const element = this.scrollTarget ?? this.getVirtualScrollElement();
    if (!element) return undefined;
    const size = element.clientWidth;
    if (!(size > 0)) return undefined;
    const {lo, hi} = bufferedScrollRange(element.scrollLeft, size, this.virtualizationConfig.bufferScreens);
    const pps = this.config.pixelsPerSecond;
    return {t0: lo / pps, t1: hi / pps};
  }

  protected setupVirtualization(): void {
    if (this.disposed || this.virtualizationActive) return;
    const element = this.getVirtualScrollElement();
    if (!element) return;
    this.scrollTarget = element;
    element.addEventListener('scroll', this.onViewportScroll, {passive: true});
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => this.onViewportScroll());
      this.resizeObserver.observe(element);
    }
    this.virtualizationActive = true;
  }

  protected teardownVirtualization(): void {
    if (this.scrollTarget) {
      this.scrollTarget.removeEventListener('scroll', this.onViewportScroll);
      this.scrollTarget = undefined;
    }
    this.resizeObserver?.disconnect();
    this.resizeObserver = undefined;
    this.virtualizationActive = false;
  }

  protected updateVirtualWindow(): void {
    if (this.disposed) return;
    const notes = this.noteSequence.notes;
    const window = this.getVisibleTimeWindow();
    const range = window
      ? visibleNoteRange(notes, window.t0, window.t1, this.getMaxNoteDuration())
      : {start: 0, end: notes.length};
    this.applyRenderedRange(range);
  }

  private applyRenderedRange(next: IndexRange): void {
    const prev = this.renderedRange;
    for (let index = prev.start; index < prev.end; index += 1) {
      if (index < next.start || index >= next.end) this.unmountNoteAtIndex(index);
    }

    for (const index of [...this.extraIndices]) {
      if (index >= next.start && index < next.end) {
        this.extraIndices.delete(index);
      } else {
        const element = this.noteElements[index];
        if (element && !this.activeElements.has(element)) {
          this.extraIndices.delete(index);
          this.unmountNoteAtIndex(index);
        }
      }
    }

    for (let index = next.start; index < next.end; index += 1) {
      if (!this.noteElements[index]) this.drawNoteAtIndex(index);
    }
    this.renderedRange = next;
  }

  private unmountNoteAtIndex(index: number): void {
    const element = this.noteElements[index];
    if (!element) return;
    if (this.activeElements.has(element)) {
      this.extraIndices.add(index);
      return;
    }
    element.remove();
    this.noteElements[index] = undefined;
  }

  protected getNoteFillColor(note: ScoreSequenceNote, isActive: boolean): string {
    const opacityBaseline = 0.2;
    const opacity = note.velocity ? note.velocity / 100 + opacityBaseline : 1;
    const color = isActive ? this.config.activeNoteColor : this.config.noteColor;
    if (color) return `color-mix(in srgb, ${color} ${Math.min(1, Math.max(0, opacity)) * 100}%, transparent)`;
    return `rgba(${isActive ? this.config.activeNoteRGB : this.config.noteRGB}, ${opacity})`;
  }

  private drawNote(
    index: number,
    x: number,
    y: number,
    w: number,
    h: number,
    fill: string,
    dataAttributes: DataAttribute[],
    cssProperties: CSSProperty[],
  ): void {
    if (!this.svg) return;
    const rect = document.createElementNS(SVG_NS, 'rect');
    rect.classList.add('note');
    rect.setAttribute('fill', fill);
    rect.setAttribute('x', `${x}`);
    rect.setAttribute('y', `${y}`);
    rect.setAttribute('width', `${w}`);
    rect.setAttribute('height', `${h}`);
    dataAttributes.forEach(([key, value]) => {
      if (value !== undefined) rect.dataset[key] = `${value}`;
    });
    cssProperties.forEach(([key, value]) => rect.style.setProperty(key, value));
    this.svg.appendChild(rect);
    this.noteElements[index] = rect;
  }

  protected clear(): void {
    this.activeElements.clear();
    this.extraIndices.clear();
    this.renderedRange = {start: 0, end: 0};
    if (!this.svg) return;
    this.svg.innerHTML = '';
    this.noteElements = [];
    this.drawn = false;
  }

  public clearActiveNotes(): void {
    if (this.disposed) return;
    if (this.svg) this.unfillActiveRect(this.svg);
  }

  public override dispose(): void {
    if (this.disposed) return;
    this.teardownVirtualization();
    this.clear();
    super.dispose();
  }
}
