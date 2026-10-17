// ============================================================================
// @webmusic/audio/view/auto — the drop-in entry. Importing this module (or loading
// the prebuilt global bundle via a <script> tag) registers EVERY view element
// at its default tag, so the custom elements work on a page with zero JS
// wiring:
//
//   <script type="module" src="https://cdn.jsdelivr.net/npm/@webmusic/audio/view/auto"></script>
//   <audio-view type="waveform"></audio-view>
//
// or, classic (non-module) script:
//
//   <script src="https://cdn.jsdelivr.net/npm/@webmusic/audio/view/global"></script>
//
// Need custom tags, tree-shaking, or to wire elements by hand? Skip this entry
// and import the individual `define*` functions from `@webmusic/audio/view/element`.
// ============================================================================

import {AudioMeterElement as LocalAudioMeterElement, defineAllAudioElements} from './index';

// The side effect: register all elements as soon as this module is evaluated.
defineAllAudioElements();

// View and Analyze can be loaded as separate classic bundles in either order.
// Publish the constructor that owns the registered tag in this document.
export const AudioMeterElement: typeof LocalAudioMeterElement =
  (typeof customElements !== 'undefined' && customElements.get('audio-meter') as typeof LocalAudioMeterElement | undefined) || LocalAudioMeterElement;
export type AudioMeterElement = LocalAudioMeterElement;

// Re-export the named API too, so the same module can also be used imperatively
// (e.g. `import { defineAudioViewElement } from '@webmusic/audio/view/auto'`).
export * from './index';
