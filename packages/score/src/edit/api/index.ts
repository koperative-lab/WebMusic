export {ScoreEditor, createScoreEditor, type ScoreEditorOptions} from '../headless/score-editor';
export {applyScoreOperations} from '../core';
export {
  ScoreEditError, createScorePositionMap, composeScorePositionMaps, mapScorePosition,
  isScoreDocumentSource, isScoreEditorPort,
  type ScoreEditorPort, type ScoreEditorState, type ScoreDocumentSource, type ScoreDocumentSnapshot,
  type ScoreDocumentChange, type ScoreEditCommand, type ScoreEditOperation, type ScoreEditResult,
  type ScoreEditTransaction, type ScoreRevisionGuard, type ScoreCheckpoint, type ScoreInteractionSession,
  type ScoreInteractionSnapshot, type ScoreDraftResult, type ScoreNoteInput, type ScoreNotationDuration, type ScoreNotationEntry, type ScoreQuarterValue,
  type ScorePositionMap, type ScoreMappedPosition, type ScoreEditErrorCode, type ScoreEditFailure,
} from '../../core/editing';
