// @webmusic/score/view/render — imperative browser renderers. This explicit
// compatibility surface owns DOM/canvas/SVG work and is intentionally
// separate from the code-only @webmusic/score/view/headless components.
export {
  renderPianoRollVisualizer,
  renderStaffVisualizer,
  renderWaterfallVisualizer,
} from './renderers/factory';
export {ScrollType} from './renderers/staff';
export type {WaterfallVisualizerConfig} from './renderers/waterfall';
export {renderOSMDStaffVisualizer, type OSMDStaffOptions} from './osmd-staff';
export {bindPlayerToVisualizer, type PlayerBindingHandlers} from './binding';
export {
  renderScoreThumbnail,
  type ScoreThumbnailRenderOptions,
} from './thumbnail';
export {
  renderScoreVisualizer,
  type ScoreVisualizerRenderOptions,
} from './score-visualizer';
