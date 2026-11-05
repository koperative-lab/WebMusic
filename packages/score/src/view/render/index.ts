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
export {bindPlayerToVisualizer, type PlayerBindingHandlers} from './binding';
export {
  renderScoreThumbnail,
  type ScoreThumbnailRenderOptions,
} from './thumbnail';
export {
  renderScoreVisualizer,
  type ScoreVisualizerRenderOptions,
} from './score-visualizer';
export {
  SCORE_GRID_FEATURES,
  SCORE_GRID_SNAPS,
  mountScoreGrid,
  parseScoreGridFeatures,
  type ScoreGridContent,
  type ScoreGridFeature,
  type ScoreGridHandle,
  type ScoreGridOptions,
  type ScoreGridPlayback,
  type ScoreGridSettings,
  type ScoreGridSnap,
  type ScoreGridTool,
} from './score-grid';
export {
  SCORE_SHEET_DURATIONS,
  SCORE_SHEET_FEATURES,
  SCORE_SHEET_LAYOUTS,
  mountScoreSheet,
  parseScoreSheetFeatures,
  type ScoreSheetContent,
  type ScoreSheetDuration,
  type ScoreSheetFeature,
  type ScoreSheetHandle,
  type ScoreSheetLayout,
  type ScoreSheetOptions,
  type ScoreSheetPlayback,
  type ScoreSheetSettings,
} from './score-sheet';
