// ============================================================================
// Type surface for the browser-only `@webmusic/audio/view/global` IIFE bundle.
//
// The runtime target is `dist/auto.global.js`, loaded as a classic <script>.
// It registers every element and creates `window.WebMusicAudioView`; it is not an
// ESM or CommonJS module and intentionally has no module exports. This source
// exists solely so the published bundle has an accurate declaration file.
// ============================================================================

import type {
  AudioLiveViewElement,
  AudioMeterElement,
  AudioViewElement,
  defineAllAudioElements,
  defineAudioLiveViewElement,
  defineAudioMeterElement,
  defineAudioViewElement,
} from './index';

// Keep this to runtime members: the declaration bundler otherwise expands a
// type-only re-export into `typeof AudioMeterPlayer` in the global namespace.
type AudioViewGlobal = {
  readonly AudioLiveViewElement: typeof AudioLiveViewElement;
  readonly AudioMeterElement: typeof AudioMeterElement;
  readonly AudioViewElement: typeof AudioViewElement;
  readonly defineAllAudioElements: typeof defineAllAudioElements;
  readonly defineAudioLiveViewElement: typeof defineAudioLiveViewElement;
  readonly defineAudioMeterElement: typeof defineAudioMeterElement;
  readonly defineAudioViewElement: typeof defineAudioViewElement;
};

declare global {
  /** APIs exposed by the classic `@webmusic/audio/view/global` browser bundle. */
  var WebMusicAudioView: AudioViewGlobal;

  interface Window {
    WebMusicAudioView: AudioViewGlobal;
  }
}

export {};
