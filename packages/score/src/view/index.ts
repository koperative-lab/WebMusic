// ============================================================================
// @webmusic/score/view — root entry: the stateless API (layout geometry,
// note-sequence, types). Pure data in / data out; `./api` is the internal
// source directory backing this entry, not a published subpath.
//
// The full capability layout:
//   @webmusic/score/view            — stateless API
//   @webmusic/score/view/headless   — stateful code-only score views
//   @webmusic/score/view/render     — imperative browser visualizers
//   @webmusic/score/view/element    — styled Web Components (<score-view>,
//                                     <pitch-view>, <sheet-view>)
// ============================================================================

export * from './api';
