// ============================================================================
// @webmusic/score/play/auto — the drop-in entry. Importing this module (or loading the
// prebuilt global bundle via a <script> tag) registers EVERY play element at its
// default tag, so you can use the custom elements on a page with zero JS wiring:
//
//   <script type="module" src="https://cdn.jsdelivr.net/npm/@webmusic/score/play/dist/element/auto.js"></script>
//   <score-player src="song.mid"></score-player>
//
// or, classic (non-module) script:
//
//   <script src="https://cdn.jsdelivr.net/npm/@webmusic/score/play/dist/auto.global.js"></script>
//   <score-player src="song.mid"></score-player>
//
// `@webmusic/score/play/global` is the package-export name for that browser IIFE. It
// has no ESM/CommonJS exports; use `@webmusic/score/play/auto` for a module import.
//
// Need custom tags, tree-shaking, or to wire elements by hand? Skip this entry
// and import the individual `define*` functions from `@webmusic/score/play/element`.
// ============================================================================

import {defineAllElements} from './index';

// The side effect: register every element as soon as this module is evaluated,
// so every tag works from a single `@webmusic/score/play/auto` import.
defineAllElements();

// Re-export the named API too, so the same module can also be used imperatively
// (e.g. `import { defineScorePlayerElement } from '@webmusic/score/play/auto'`).
export * from './index';
