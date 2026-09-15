import type {Score} from '../../core';
import type {
  RenderedScoreVisualizer,
  ScoreViewType,
  StaffRenderOptions,
  VisualizerRenderOptions,
} from '../core/types';
import {
  renderPianoRollVisualizer,
  renderStaffVisualizer,
  renderWaterfallVisualizer,
} from './renderers/factory';
import type {WaterfallVisualizerConfig} from './renderers/waterfall';

const SVG_NS = 'http://www.w3.org/2000/svg';

export type ScoreVisualizerRenderOptions = VisualizerRenderOptions &
  WaterfallVisualizerConfig &
  StaffRenderOptions;

/** Create a view-specific render surface and mount the matching renderer. */
export function renderScoreVisualizer(
  score: Score,
  surface: HTMLElement,
  type: ScoreViewType,
  options: ScoreVisualizerRenderOptions = {},
): RenderedScoreVisualizer {
  const document = surface.ownerDocument ?? globalThis.document;
  if (!document) throw new Error('A document is required to render a score visualization.');
  if (type === 'staff') {
    const container = document.createElement('div');
    container.setAttribute('part', 'drawing');
    container.style.width = '100%';
    container.style.overflow = 'auto';
    surface.appendChild(container);
    return renderStaffVisualizer(score, container, options);
  }
  if (type === 'waterfall') {
    const container = document.createElement('div');
    container.setAttribute('part', 'drawing');
    container.style.width = '100%';
    container.style.height = '100%';
    container.style.overflow = 'hidden';
    surface.appendChild(container);
    return renderWaterfallVisualizer(score, container, options);
  }
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('part', 'drawing');
  svg.style.width = '100%';
  surface.appendChild(svg);
  return renderPianoRollVisualizer(score, svg, options);
}
