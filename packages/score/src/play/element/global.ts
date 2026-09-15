// ============================================================================
// Type surface for the browser-only `@webmusic/score/play/global` IIFE bundle.
//
// The runtime target is `dist/play/auto.global.js`, loaded as a classic <script>.
// It registers every element and creates `window.WebMusicScorePlay`; it is not an
// ESM or CommonJS module and intentionally has no module exports. This source
// exists solely so the published bundle has an accurate declaration file.
// ============================================================================

import type * as Elements from './index.js';

declare global {
  /** APIs exposed by the classic `@webmusic/score/play/global` browser bundle. */
  var WebMusicScorePlay: typeof Elements;

  interface Window {
    WebMusicScorePlay: typeof Elements;
  }
}

export {};
