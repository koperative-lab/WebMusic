// ============================================================================
// @webmusic/score/view/api — the stateless API: score → geometry layout,
// note-sequence conversion, and the shared visual types. Pure data in / data
// out, no DOM. Published through the @webmusic/score/view capability entry.
//
// The other layers of @webmusic/score/view:
//   @webmusic/score/view/headless  — stateful code-only score views
//   @webmusic/score/view/render    — imperative browser visualizers
//   @webmusic/score/view/element   — styled Web Components (<score-view>, …)
//
// (All playback — engine, synths, controllers, transport drivers — lives in
// @webmusic/score/play.)
// ============================================================================

// ---- Layout geometry (Score → positioned notes / glyphs) ----
export {createPianoRollLayout, createStaffLayout, createWaterfallLayout} from '../core';

// ---- Whole-piece projection (Score → one navigable strip) ----
export {createScoreMap} from '../core';
export {validateScoreViewConfiguration} from '../core';

// ---- Note-sequence conversion + time helpers ----
export {findSequenceNote, scoreToNoteSequence, secondsToQuarters} from '../core';

// ---- Current-pitch projections (held MIDI notes → notation/string data) ----
export {readoutPitch, currentStaffMarks, currentFretMarks, STANDARD_VIEW_TUNING} from '../core/pitch-readout';
export type {PitchReadoutSpelling, CurrentStaffMark, CurrentFretMark} from '../core/pitch-readout';

// ---- Shared visual types ----
export type {
  PianoRollNote,
  RenderedScoreVisualizer,
  ScoreMap,
  ScoreMapCell,
  ScoreMapMark,
  ScoreMapOptions,
  ScoreNoteSequence,
  ScoreSequenceNote,
  ScoreViewType,
  ScoreViewConfiguration,
  ScoreViewOptionsByType,
  StaffRenderOptions,
  StaffGlyph,
  VisualizerRenderOptions,
  ViewLayoutOptions,
  WaterfallRenderOptions,
  WaterfallNote,
} from '../core';

// Configuration/result contracts for the code-only score-view component.
// These are type-only: importing /api still pulls in no stateful runtime.
export type {
  ScoreViewOptions,
  ScoreViewState,
  ScoreViewTimeRange,
} from '../headless/score-view';
export type {PitchViewOptions, PitchViewState} from '../headless/pitch-view';
