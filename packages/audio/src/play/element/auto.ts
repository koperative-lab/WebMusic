// ============================================================================
// @webmusic/audio/play/auto — the drop-in entry. Importing this module (or loading the
// prebuilt global bundle via a <script> tag) registers EVERY play element at its
// default tag, so you can use the custom elements on a page with zero JS wiring:
//
//   <script type="module" src="https://cdn.jsdelivr.net/npm/@webmusic/audio/play/auto"></script>
//   <audio-player src="song.mp3" controls></audio-player>
//
// or, classic (non-module) script:
//
//   <script src="https://cdn.jsdelivr.net/npm/@webmusic/audio/play/global"></script>
//
// Need custom tags, tree-shaking, or to wire elements by hand? Skip this entry
// and import the individual `define*` functions from `@webmusic/audio/play/element`.
// ============================================================================

import {configureDecoderWorkerScriptUrl} from '../api/worker-client';
import {defineAllAudioElements} from './index';

// The side effect: register all elements as soon as this module is evaluated.
const currentScript = typeof document !== 'undefined' ? (document.currentScript as HTMLScriptElement | null) : null;
configureDecoderWorkerScriptUrl(currentScript?.src);
defineAllAudioElements();

// Re-export the named API too, so the same module can also be used imperatively
// (e.g. `import { defineAudioPlayerElement } from '@webmusic/audio/play/auto'`).
export * from './index';
