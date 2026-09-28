// ============================================================================
// @webmusic/audio/play/headless — Headless Components: the stateful playback engines
// you instantiate and drive yourself. No DOM, no custom elements — pure audio
// objects that work in any framework (or none).
//
// Pair with:
//   @webmusic/audio/play            — the stateless data API (decode / load / export)
//   @webmusic/audio/play/element     — styled Web Components built on these engines
// ============================================================================

// ---- Stable central playback owner and compatibility clip engine ----
export {
  AudioPlayer,
  createAudioPlayer,
  type AudioPlayerOptions,
  type AudioPlayerTransport,
  type AudioPlayerEvents,
  type AudioPlayerSourceDetail,
} from './audio-player';

// ---- Player (single-clip transport; the PlayerLike surface) ----
export {
  AudioClipPlayer,
  createAudioClipPlayer,
  type AudioClipPlayerOptions,
  type AudioScratchSession,
  type AudioClipPlayerEvents,
  type PlayerTimeUpdate,
  type PlayerEngineKind,
  type PlayerLike,
} from './player';

// ---- Engines (the PlaybackEngine interface + the two implementations) ----
export {BufferEngine, type PlaybackEngine, type BufferEngineOptions} from './engines/buffer-engine';
export {
  MediaEngine,
  type MediaEngineOptions,
  type MediaPlaybackAdapter,
  type MediaPlaybackAdapterFactory,
} from './engines/media-engine';

// ---- Playlist (sequential multi-clip playback) ----
export {
  AudioPlaylist,
  createAudioPlaylist,
  type AudioPlaylistOptions,
  type AudioPlaylistEvents,
  type AudioPlaylistEntry,
  type AudioPlaylistEntryStatus,
} from './playlist';

// ---- Mixer (synchronised multi-clip / stem playback) ----
export {
  AudioMixer,
  createAudioMixer,
  type AudioMixerOptions,
  type AudioMixerEvents,
  type AudioMixerSnapshot,
  type AudioMixerMemberSnapshot,
  type MixerMemberInit,
} from './mixer';

// ---- Recorder (microphone → AudioClip) ----
export {
  AudioRecorder,
  createAudioRecorder,
  type AudioRecorderOptions,
  type AudioRecorderEvents,
} from './recorder';

// ---- Effects (the post-processing chain factories) ----
export {
  gain,
  filter,
  delay,
  compressor,
  chainEffects,
  customEffect,
  insertEffect,
  type Effect,
  type EffectNodes,
  type GainOptions,
  type FilterOptions,
  type DelayOptions,
  type CompressorOptions,
} from './effects';

import type {PlayerLikeKernelContract} from './playerlike-contract';

// Keep the compile-time kernel contract reachable without emitting a bare
// runtime import into otherwise side-effect-free bundles.
type _PlayerLikeKernelContractAnchor = PlayerLikeKernelContract;
