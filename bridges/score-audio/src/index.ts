export {
  DEFAULT_MAX_MAPPED_BEATS,
  beatGridFromTimeMap,
  timeMapFromBeatGrid,
  type BeatGridFromTimeMapOptions,
} from './mapping';
export {
  ScoreAudioSync,
  createSyncedPlayback,
  renderScoreToClip,
  type ScoreAudioSyncOptions,
  type CreateSyncedPlaybackOptions,
  type SyncScoreTransport,
  type SyncClipTransport,
  type SyncMasterTransport,
  type SyncFollowerTransport,
  type SyncTransportClockView,
  type SyncLoopRegion,
} from './sync';
export {
  clipAsMaster,
  createAudioMasteredPlayback,
  scoreAsFollower,
  type AudioMasterAdapterOptions,
  type CreateAudioMasteredPlaybackOptions,
} from './audio-master';
export {
  DEFAULT_MAX_TRANSCRIPTION_MEASURES,
  DEFAULT_MAX_TRANSCRIPTION_NOTES,
  scoreFromTranscription,
  type ScoreFromTranscriptionOptions,
} from './transcription';
export type {SyncTransportContract} from './transport-contracts';

export type {TransportCommand, TransportCommit, TransportEvent, TransportSnapshot} from '@webmusic/kernel/sync';
