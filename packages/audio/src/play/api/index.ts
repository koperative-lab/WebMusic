// ============================================================================
// @webmusic/audio/play/api — the stateless programming API: WAV codec, audio
// decoding, clip loading,
// and offline export. Pure data in / data out — no DOM, no audio-engine state.
//
// The stateful and visual layers live in the companion subpaths:
//   @webmusic/audio/play/headless   — runtime objects (players, mixer, recorder,
//                               engines, effect factories)
//   @webmusic/audio/play/element    — styled Web Components
// ============================================================================

// ---- WAV (pure-JS, the testable byte-level core) ----
export {parseWav, serializeWav, type DecodedWav, type WavBitDepth} from '../core/wav';

// ---- Decode ----
export {decodeAudio, decodeAudioChunked, type DecodedAudio, type DecodeOptions} from '../core/decode';

// ---- Load / format detection ----
export {
  loadClip,
  loadClipFromUrl,
  detectAudioFormat,
  formatFromExtension,
  type LoadClipOptions,
  type LoadClipFromUrlOptions,
} from './load';
export {
  DEFAULT_MAX_INPUT_BYTES,
  DEFAULT_MAX_DECODED_FRAMES,
  DEFAULT_MAX_DECODED_BYTES,
  DEFAULT_MAX_CHANNELS,
  DEFAULT_REQUEST_TIMEOUT_MS,
  type AudioResourceLimits,
  type AudioFetchOptions,
} from './resource-limits';

// ---- Effect contract types (the factories live at `@webmusic/audio/play/headless`) ----
export type {Effect, EffectNodes} from '../core/effect';

// ---- Headless component configuration/result contracts (type-only) ----
// Runtime constructors and factories remain exclusive to `/headless`.
export type {
  AudioClipPlayerOptions,
  AudioScratchSession,
  AudioClipPlayerEvents,
  PlayerTimeUpdate,
  PlayerEngineKind,
  PlayerLike,
} from '../headless/player';
export type {
  AudioMixerOptions,
  AudioMixerEvents,
  AudioMixerSnapshot,
  AudioMixerMemberSnapshot,
  MixerMemberInit,
} from '../headless/mixer';
export type {
  AudioRecorderOptions,
  AudioRecorderEvents,
} from '../headless/recorder';
export type {
  PlaybackEngine,
  BufferEngineOptions,
} from '../headless/engines/buffer-engine';
export type {
  MediaEngineOptions,
  MediaPlaybackAdapter,
  MediaPlaybackAdapterFactory,
} from '../headless/engines/media-engine';
export type {
  GainOptions,
  FilterOptions,
  DelayOptions,
  CompressorOptions,
} from '../headless/effects';

// ---- Export / offline render ----
export {clipToWav, clipToBlob, renderClipWithEffect, type ClipToWavOptions} from './export';

// ---- Worker-offloaded decoding (main-thread client + testable protocol) ----
export {
  createDecoderWorker,
  createRequestTracker,
  type DecoderWorker,
  type DecodedResult,
  type DecoderRequestOptions,
  type DecoderWorkerOptions,
  type DecodeClipOptions,
  type RequestTracker,
  type WorkerLike,
} from './worker-client';
export {
  handleDecodeRequest,
  transferablesOf,
  type DecodeRequest,
  type DecodeResponse,
  type DecodeWorkerFormat,
} from '../core/worker-protocol';

// ---- Pure transport helpers (shared with custom UIs) ----
export {formatTime, parseLoopAttr} from '../core/format';
