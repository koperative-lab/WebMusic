// @webmusic/score/view/headless — code-only score-view components. This entry owns
// state and behavior, but never creates UI, accesses the DOM, or applies style.
export {
  createScoreView,
  type ScoreView,
  type ScoreViewListener,
  type ScoreViewOptions,
  type ScoreViewState,
  type ScoreViewTimeRange,
} from './score-view';
export type {ScoreViewType} from '../core/types';
export {
  createPitchView,
  type PitchView,
  type PitchViewOptions,
  type PitchViewState,
  type PitchViewListener,
} from './pitch-view';
export {
  createScoreMapView,
  type ScoreMapView,
  type ScoreMapViewOptions,
  type ScoreMapViewState,
  type ScoreMapViewListener,
  type ScoreMapSeekOutcome,
} from './score-map';
export {
  createActiveNoteTracker,
  type ActiveNoteListener,
  type ActiveNoteState,
  type ActiveNoteTracker,
} from './active-notes';
