// ============================================================================
// Web Component entry — imported via `@webmusic/audio/play/element`. Kept separate
// from the package's main entry so the I/O + playback API tree-shakes free of
// any DOM / custom-element code for code-only consumers.
//
// Four elements, one job each:
//   <audio-player>         central transport over a clip, queue or mix
//   <audio-playlist>       N clips in sequence: queue with auto-advance
//   <audio-mixer>          N clips at once: mixing desk (volume/mute/solo)
//   <audio-recorder>  microphone → AudioClip, emits webaudio:recorded
// ============================================================================

export {AudioPlayerElement, defineAudioPlayerElement, type AudioPlayerSeekDetail, type AudioPlayerElementSourceDetail} from './audio-player';

export {
  AudioPlaylistElement,
  defineAudioPlaylistElement,
  type AudioPlaylistTrackDetail,
} from './audio-playlist';
export {AudioMixerElement, defineAudioMixerElement, type AudioMixerMemberSpec} from './audio-mixer';
export {
  AudioRecorderElement,
  defineAudioRecorderElement,
  type AudioRecorderRecordedDetail,
  type AudioRecorderExportedDetail,
} from './audio-recorder';

// Pure helpers shared with custom UIs.
export {formatTime, parseLoopAttr} from '../core/format';

import {defineAudioPlayerElement} from './audio-player';
import {defineAudioPlaylistElement} from './audio-playlist';
import {defineAudioMixerElement} from './audio-mixer';
import {defineAudioRecorderElement} from './audio-recorder';

/**
 * Register every `@webmusic/audio/play` custom element at its default tag — the
 * one-call path behind the drop-in `@webmusic/audio/play/auto` bundle. Call it once in
 * the browser, or import `@webmusic/audio/play/auto` to have it called for you.
 * Idempotent: each `define*` skips a tag that is already defined.
 */
export function defineAllAudioElements(): void {
  defineAudioPlayerElement();
  defineAudioPlaylistElement();
  defineAudioMixerElement();
  defineAudioRecorderElement();
}

export type {AudioPlayerTarget} from './internal/player-connection';
