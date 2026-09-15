import type {Score} from '../../core';
import {projectScoreAnnotations} from '../core/annotations';
import {drawHorizontalScoreAnnotations} from './annotations';

/** Mount an expression strip on the same quarter axis as a map's timeline lane. */
export function mountScoreMapAnnotations(
  timeline: {element: HTMLElement; lane: HTMLElement},
  score: Score,
  options: {part?: string; color?: string},
): () => void {
  const annotations = projectScoreAnnotations(score, {part: options.part});
  if (!annotations.length) return () => undefined;
  const document = timeline.element.ownerDocument;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('part', 'annotations');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'Score annotations');
  svg.style.display = 'block';
  svg.style.width = '100%';
  timeline.element.before(svg);
  const duration = score.durationQuarters.toFloat();
  let previousLayout = '';
  let disposed = false;
  const draw = (): void => {
    if (disposed) return;
    const host = svg.getBoundingClientRect();
    const lane = timeline.lane.getBoundingClientRect();
    const width = host.width || timeline.element.clientWidth || 640;
    const left = lane.width ? Math.max(0, lane.left - host.left) : 0;
    const laneWidth = lane.width || width;
    const layout = `${width}:${left}:${laneWidth}`;
    if (layout === previousLayout) return;
    previousLayout = layout;
    svg.replaceChildren();
    const result = drawHorizontalScoreAnnotations(svg, annotations, {
      width,
      xAtQuarter: (quarter) => left + quarter / Math.max(duration, Number.EPSILON) * laneWidth,
      color: options.color,
      maxLanes: 3,
    });
    svg.setAttribute('viewBox', `0 0 ${width} ${result.height}`);
    svg.setAttribute('height', String(result.height));
  };
  draw();
  const Observer = document.defaultView?.ResizeObserver;
  const observer = Observer ? new Observer(draw) : undefined;
  observer?.observe(timeline.lane);
  return () => {
    disposed = true;
    observer?.disconnect();
    svg.remove();
  };
}
