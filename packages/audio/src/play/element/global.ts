// ============================================================================
// Type surface for the browser-only `@webmusic/audio/play/global` IIFE bundle.
//
// The runtime target is `dist/auto.global.js`, loaded as a classic <script>.
// It registers every element and creates `window.WebMusicAudioPlay`; it is not an
// ESM or CommonJS module and intentionally has no module exports. This source
// exists solely so the published bundle has an accurate declaration file.
// ============================================================================

import type * as Elements from './index';

declare global {
  /** APIs exposed by the classic `@webmusic/audio/play/global` browser bundle. */
  var WebMusicAudioPlay: typeof Elements;

  interface Window {
    WebMusicAudioPlay: typeof Elements;
  }
}

export {};
