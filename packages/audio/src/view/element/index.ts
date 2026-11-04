// Styled Web Component entry — imported via `@webmusic/audio/view/element`.
// Kept separate from the package's main entry so the renderer/binding API tree-shakes free of
// any custom-element / DOM registration code for code-only consumers.
//
// Side-effect free: nothing registers until `defineAudioViewElement()` (or the
// aggregate `defineAllAudioElements()`) runs.
//
// Three elements, one job each:
//   <audio-view>            the projection stage: waveform / spectrogram / meter
//   <audio-meter>           live RMS level / FFT spectrum monitor
//   <audio-live-view>       a scrolling projection of a live AnalyserNode

export {
  AudioViewElement,
  defineAudioViewElement,
  type AudioViewOptions,
  type AudioViewType,
  type AudioViewDragMode,
} from './audio-view';
export {
  AudioLiveViewElement,
  defineAudioLiveViewElement,
  type LiveViewType,
} from './audio-live-view';

export {AudioMeterElement, defineAudioMeterElement} from './audio-meter';
export type {AudioMeterPlayer} from './audio-meter';

import {defineAudioMeterElement} from './audio-meter';
import {defineAudioViewElement} from './audio-view';
import {defineAudioLiveViewElement} from './audio-live-view';

/**
 * Register every `@webmusic/audio/view` custom element at its default tag — the
 * one-call path behind the drop-in `@webmusic/audio/view/auto` bundle. Call it once
 * in the browser, or import `@webmusic/audio/view/auto` to have it called for you.
 * Idempotent: each `define*` skips a tag that is already defined.
 */
export function defineAllAudioElements(): void {
  defineAudioMeterElement();
  defineAudioViewElement();
  defineAudioLiveViewElement();
}
