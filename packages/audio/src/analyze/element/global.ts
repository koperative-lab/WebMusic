// ============================================================================
// Type surface for the browser-only `@webmusic/audio/analyze/global` IIFE bundle.
//
// The runtime target is `dist/auto.global.js`, loaded as a classic <script>.
// It registers every element and creates `window.WebMusicAudioAnalyze`; it is not an
// ESM or CommonJS module and intentionally has no module exports. This source
// exists solely so the published bundle has an accurate declaration file.
// ============================================================================

import type {
  AudioLevelAnalyzerElement,
  AudioMeterElement,
  AudioOscilloscopeElement,
  AudioSpectrumAnalyzerElement,
  AudioTransientAnalyzerElement,
  defineAllAudioElements,
  defineAudioLevelAnalyzerElement,
  defineAudioMeterElement,
  defineAudioOscilloscopeElement,
  defineAudioSpectrumAnalyzerElement,
  defineAudioTransientAnalyzerElement,
} from './index';

// Spell out runtime members because the declaration bundler treats a type-only
// re-export as a value when expanding `typeof import('./index')` into a global
// namespace. AudioMeterPlayer remains a named type export, not a browser global.
type AudioAnalyzeGlobal = {
  readonly AudioLevelAnalyzerElement: typeof AudioLevelAnalyzerElement;
  readonly AudioMeterElement: typeof AudioMeterElement;
  readonly AudioOscilloscopeElement: typeof AudioOscilloscopeElement;
  readonly AudioSpectrumAnalyzerElement: typeof AudioSpectrumAnalyzerElement;
  readonly AudioTransientAnalyzerElement: typeof AudioTransientAnalyzerElement;
  readonly defineAllAudioElements: typeof defineAllAudioElements;
  readonly defineAudioLevelAnalyzerElement: typeof defineAudioLevelAnalyzerElement;
  readonly defineAudioMeterElement: typeof defineAudioMeterElement;
  readonly defineAudioOscilloscopeElement: typeof defineAudioOscilloscopeElement;
  readonly defineAudioSpectrumAnalyzerElement: typeof defineAudioSpectrumAnalyzerElement;
  readonly defineAudioTransientAnalyzerElement: typeof defineAudioTransientAnalyzerElement;
};

declare global {
  /** APIs exposed by the classic `@webmusic/audio/analyze/global` browser bundle. */
  var WebMusicAudioAnalyze: AudioAnalyzeGlobal;

  interface Window {
    WebMusicAudioAnalyze: AudioAnalyzeGlobal;
  }
}

export {};
