export {
  DEFAULT_MAX_MAPPED_BEATS,
  beatGridFromTimeMap,
  timeMapFromBeatGrid,
  type BeatGridFromTimeMapOptions,
} from './mapping';
export {renderScoreToClip} from './render';
export {
  createScoreAudioSession,
  type CreateScoreAudioSessionOptions,
  type ScoreAudioSession,
} from './session';
export {registerAudioParticipant, type AudioParticipantOptions, type AudioParticipantPlayer} from './audio-participant';
export {
  DEFAULT_MAX_TRANSCRIPTION_MEASURES,
  DEFAULT_MAX_TRANSCRIPTION_NOTES,
  scoreFromTranscription,
  type ScoreFromTranscriptionOptions,
} from './transcription';
export {createWebMusicProjectPlugins} from './project';
