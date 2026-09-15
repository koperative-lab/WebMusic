// Primitives
export {Rational} from './primitives/Rational';
export {Pitch} from './primitives/Pitch';
export {Duration, type DurationOpts} from './primitives/Duration';

// Model
export {Note, type NoteData, type PerformedAttributes, type Articulation, type Ornament, type Tie, type Slur, type SlurMark, type SlurValue, type GraceNote, type BeamMark, type StemDirection, type TupletMark, type RestDisplay} from './model/Note';
export {Measure, type MeasureData, type MeasureRepeat, type Clef, type BarlineStyle} from './model/Measure';
export {Part, type PartData, type Transpose} from './model/Part';
export type {PartClefChange, DirectionPosition, PartDirection} from './model/notation';
export {Score, type ScoreData} from './model/Score';
export {ScoreBuilder} from './model/ScoreBuilder';
export {ScoreEditSession} from './model/ScoreEditSession';
export {
  validateScore,
  assertValidScore,
  type ScoreValidationIssue,
  type ScoreValidationIssueCode,
} from './validate';

// Time
export {TimeMap, type TempoEntry, type MeterEntry, type MBS, type MeasureRef} from './time/TimeMap';
export {timeMapMapping, type TimelineMapping} from './time/timeline-mapping';

// Queries
export {notesAt, notesIn, notesOverlapping, restsIn, type NoteQueryOptions} from './query/queries';
export {isPitchedNote, isSoundingNote, type PitchedNote, type SoundingNote} from './query/note-kind';
// Transposing-instrument helpers (written ↔ sounding pitch).
export {soundingPitch, writtenPitch, transpositionSemitones} from './query/transposition';
// Tie-chain helpers: group tied notes, merge into effective sounding events.
export {tieChains, mergedTiedNotes, type MergedNoteEvent} from './query/ties';

// Transforms
// Repeat expansion: unroll repeat barlines + volta endings into a linear Score.
export {expandRepeats, playedDurationSeconds} from './transform/expandRepeats';

// Events
export {EventEmitter, type EventListenerFailureMode} from './events/EventEmitter';
export {
  observeScorePlayback,
  type ScorePlaybackSource,
  type ScorePlaybackSnapshot,
  type ScorePlaybackNote,
  type ScorePlaybackReadiness,
  type ScorePlaybackState,
} from './playback';

// Stateful playback lives in `@webmusic/score/play/headless`; analysis utilities
// (summarizeScore, chordTimeline) live in `@webmusic/score/analyze`. `core` keeps
// only the model, time, queries, events, and serialization for custom builds.

// Serialization
export {scoreFromJSON} from './serialize/fromJSON';
export {
  SCORE_JSON_SCHEMA_ID,
  SCORE_JSON_SCHEMA_VERSION,
  ScoreJSONError,
  type ScoreJSONErrorCode,
} from './serialize/schema';

// Types
export type {Step, Alter, Octave, MidiNumber} from './types/pitch';
export type {TimeSignature, KeySignature, Mode, Tempo, ScoreMetadata} from './types/meta';
export {NoteId, MeasureId, PartId, VoiceId, ScoreId} from './types/ids';

// Utilities
export {makeId} from './utils/id';

// Compatibility helpers (tick-style accessors for downstream packages)
export {
  DEFAULT_PPQ,
  pitchToMidi,
  midiToPitch,
  quartersToTicks,
  ticksToQuarters,
  noteMidi,
  noteOnsetTicks,
  noteDurationTicks,
  noteEndTicks,
  noteOnsetSeconds,
  noteDurationSeconds,
  noteEndSeconds,
  noteVelocity,
  noteVoiceString,
  scoreNotes,
  scoreTitle,
  scoreComposer,
  scoreDurationTicks,
  scoreDurationSeconds,
  scoreTempos,
  scoreTimeSignatures,
  scoreKeySignatures,
  tickToSeconds,
  secondsToTick,
  tickToMeasureBeat,
  locateTick,
  locateSeconds,
  measureStartTicks,
  measureDurationTicks,
  type TempoChange,
  type TimeSignatureChange,
  type KeySignatureChange,
  type TimePosition,
} from './compat';
