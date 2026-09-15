// Internal reusable implementation for @webmusic/score/view. Public consumers use
// `@webmusic/score/view/api`, `/headless` or `/render`; keeping this barrel
// private lets the implementation evolve without expanding the package API.
export {createPianoRollLayout, createStaffLayout, createWaterfallLayout} from './layout';
export {createScoreMap} from './map';
export type {ScoreMap, ScoreMapCell, ScoreMapMark, ScoreMapOptions} from './map';
export {findSequenceNote, scoreToNoteSequence, secondsToQuarters} from './note-sequence';
export * from './windowing';
export {validateScoreViewConfiguration} from './configuration';
export type * from './types';
