import {Rational, type Score} from '../../core';
import {projectScoreAnnotations} from '../core/annotations';
import type {PianoRollNote} from '../core/types';
import {drawThumbnailScoreAnnotations} from './annotations';

const SVG_NS = 'http://www.w3.org/2000/svg';

export interface ScoreThumbnailRenderOptions {
  color?: string;
  label?: string;
  /** Original source for expression marks; a bare note layout has none. */
  score?: Score;
  /** Default true when score is supplied. Hidden marks reserve no space. */
  showAnnotations?: boolean;
}

/** Paint a laid-out piano roll into a stage surface as a fitted SVG. */
export function renderScoreThumbnail(
  surface: HTMLElement,
  notes: readonly PianoRollNote[],
  options: ScoreThumbnailRenderOptions = {},
): SVGSVGElement | undefined {
  if (!notes.length) return undefined;
  let width = 0;
  let height = 0;
  for (const note of notes) {
    width = Math.max(width, note.x + note.width);
    height = Math.max(height, note.y + note.height);
  }

  const document = surface.ownerDocument;
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('part', 'drawing');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('width', '100%');
  svg.setAttribute('height', '100%');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', options.label ?? 'Score preview');
  const fill = options.color ?? 'currentColor';
  const annotations = options.score && options.showAnnotations !== false ? projectScoreAnnotations(options.score) : [];
  let noteParent: SVGSVGElement = svg;
  if (annotations.length && options.score) {
    const displayWidth = surface.clientWidth || surface.getBoundingClientRect().width || surface.parentElement?.clientWidth || 640;
    const timed = notes.find((note) => note.startSeconds > 0 && note.x > 0);
    const sustained = notes.find((note) => note.durationSeconds > 0 && note.width > 1);
    const scale = timed ? timed.x / timed.startSeconds : sustained ? (sustained.width + 1) / sustained.durationSeconds : 30;
    // Note rectangles omit their inter-note gap. Retain the full score axis,
    // including trailing silence, so expression anchors align with onsets.
    width = Math.max(width, options.score.durationSeconds * scale);
    const lane = drawThumbnailScoreAnnotations(svg, annotations, {
      xAtQuarter: (quarter) => options.score!.timeMap.quartersToSeconds(Rational.from(quarter)) * scale / width * displayWidth,
      width: displayWidth, color: fill, maxLanes: 3,
    });
    svg.dataset.webscoreAnnotationHeight = String(lane.height);
    // Annotation coordinates are CSS pixels. Only the nested note preview has
    // a viewBox, so an explicit host height cannot stretch text into tall glyphs.
    svg.removeAttribute('viewBox');
    svg.removeAttribute('preserveAspectRatio');
    svg.style.height = `calc(3rem + ${lane.height}px)`;
    // A very short explicit host scrolls this minimum drawing instead of
    // consuming the entire preview with its fixed-size annotation strip.
    svg.style.minHeight = `calc(1rem + ${lane.height}px)`;
    noteParent = document.createElementNS(SVG_NS, 'svg');
    noteParent.setAttribute('viewBox', `0 0 ${width} ${height}`);
    noteParent.setAttribute('preserveAspectRatio', 'none');
    noteParent.setAttribute('width', '100%');
    noteParent.dataset.webscoreThumbnailNotes = '';
    noteParent.setAttribute('y', String(lane.height));
    svg.append(noteParent);
  }
  for (const note of notes) {
    const rect = document.createElementNS(SVG_NS, 'rect');
    rect.setAttribute('x', String(note.x));
    rect.setAttribute('y', String(note.y));
    rect.setAttribute('width', String(Math.max(note.width, 0.5)));
    rect.setAttribute('height', String(note.height));
    rect.setAttribute('fill', fill);
    noteParent.append(rect);
  }
  surface.append(svg);
  fitThumbnailNotes(svg);
  return svg;
}

/** SVG viewport geometry needs a resolved number, not an unresolved CSS max(). */
function fitThumbnailNotes(svg: SVGSVGElement): void {
  const annotationHeight = Number(svg.dataset.webscoreAnnotationHeight ?? 0);
  const notes = svg.querySelector<SVGSVGElement>('[data-webscore-thumbnail-notes]');
  if (!annotationHeight || !notes) return;
  const document = svg.ownerDocument;
  const rem = Number.parseFloat(document.defaultView?.getComputedStyle(document.documentElement).fontSize ?? '') || 16;
  const measured = svg.getBoundingClientRect().height || svg.clientHeight;
  const drawingHeight = measured > 0 ? measured : rem * 3 + annotationHeight;
  const height = Math.max(rem, drawingHeight - annotationHeight);
  notes.setAttribute('height', String(height));
  notes.style.height = `${height}px`;
}

/** Internal Element adapter: retain readable label sizes as its container changes. */
export function mountScoreThumbnail(
  surface: HTMLElement,
  notes: readonly PianoRollNote[],
  options: ScoreThumbnailRenderOptions,
  onAnnotationHeight: (height: number) => void,
): () => void {
  let disposed = false;
  let width = -1;
  let drawing: SVGSVGElement | undefined;
  const draw = () => {
    if (disposed) return;
    const nextWidth = surface.clientWidth || surface.getBoundingClientRect().width || surface.parentElement?.clientWidth || 640;
    if (nextWidth !== width) {
      width = nextWidth;
      drawing?.remove();
      drawing = renderScoreThumbnail(surface, notes, options);
      if (drawing) drawing.style.height = '100%';
      onAnnotationHeight(Number(drawing?.dataset.webscoreAnnotationHeight ?? 0));
    }
    // The Element may apply its natural height during the callback above, or
    // a later container resize may change height without changing width.
    if (drawing) fitThumbnailNotes(drawing);
  };
  draw();
  const view = surface.ownerDocument.defaultView;
  const Observer = view?.ResizeObserver ?? globalThis.ResizeObserver;
  const observer = Observer ? new Observer(draw) : undefined;
  observer?.observe(surface);
  if (!observer) view?.addEventListener('resize', draw);
  return () => {
    if (disposed) return;
    disposed = true;
    observer?.disconnect();
    if (!observer) view?.removeEventListener('resize', draw);
    drawing?.remove();
    drawing = undefined;
  };
}
