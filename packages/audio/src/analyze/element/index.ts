// Live, task-specific analysis tools. Full-clip results belong to API/Headless.
export {AudioLevelAnalyzerElement, defineAudioLevelAnalyzerElement, type AudioLevelChangeDetail} from './audio-level-analyzer';
export {AudioMeterElement, defineAudioMeterElement} from './audio-meter';
export type {AudioMeterPlayer} from './audio-meter';
export {AudioOscilloscopeElement, defineAudioOscilloscopeElement, type AudioOscilloscopeProbeDetail} from './audio-oscilloscope';
export {AudioSpectrumAnalyzerElement, defineAudioSpectrumAnalyzerElement, type AudioSpectrumProbeDetail} from './audio-spectrum-analyzer';
export {AudioTransientAnalyzerElement, defineAudioTransientAnalyzerElement, type AudioTransientDetail} from './audio-transient-analyzer';

import {defineAudioLevelAnalyzerElement} from './audio-level-analyzer';
import {defineAudioMeterElement} from './audio-meter';
import {defineAudioOscilloscopeElement} from './audio-oscilloscope';
import {defineAudioSpectrumAnalyzerElement} from './audio-spectrum-analyzer';
import {defineAudioTransientAnalyzerElement} from './audio-transient-analyzer';

/** Register the five live Analyze tools. Idempotent and SSR-safe. */
export function defineAllAudioElements(): void {
  defineAudioLevelAnalyzerElement();
  defineAudioMeterElement();
  defineAudioOscilloscopeElement();
  defineAudioSpectrumAnalyzerElement();
  defineAudioTransientAnalyzerElement();
}
