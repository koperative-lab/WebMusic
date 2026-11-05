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
export {createScoreViewEditing, scoreDocumentPlaybackCompatible,
  type ScoreViewEditing, type ScoreViewEditingOptions, type ScoreViewEditingState} from './score-editing';
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

// Document-owned editing: one editor shared by every View and the player.
export {ScoreEditor, createScoreEditor, type ScoreEditorOptions} from './score-editor';
export {loadScoreEditor, type LoadScoreEditorOptions} from './load-score-editor';
export type {
  ScoreEditorPort, ScoreEditorState, ScoreDocumentSource, ScoreDocumentSnapshot,
  ScoreDocumentChange, ScoreEditCommand, ScoreEditOperation, ScoreEditResult,
  ScoreEditTransaction, ScoreRevisionGuard, ScoreCheckpoint, ScoreInteractionSession,
  ScoreInteractionSnapshot, ScoreDraftResult,
} from '../../core/editing';
