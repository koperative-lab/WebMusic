// @webmusic/score/analyze/element — five focused musical displays.
// Importing this entry registers nothing. Headless/API analysis remains separate.

export type {AnalysisViewSeekDetail as AnalysisSeekDetail} from './internal/analysis-component';
export {KeyAnalysisElement, defineKeyAnalysisElement} from './key-analysis';
export {ChordAnalysisElement, defineChordAnalysisElement} from './chord-analysis';
export {RomanAnalysisElement, defineRomanAnalysisElement} from './roman-analysis';
export {VoiceLeadingAnalysisElement, defineVoiceLeadingAnalysisElement} from './voice-leading-analysis';
export {LiveChordAnalysisElement, defineLiveChordAnalysisElement} from './live-chord-analysis';

import {defineKeyAnalysisElement} from './key-analysis';
import {defineChordAnalysisElement} from './chord-analysis';
import {defineRomanAnalysisElement} from './roman-analysis';
import {defineVoiceLeadingAnalysisElement} from './voice-leading-analysis';
import {defineLiveChordAnalysisElement} from './live-chord-analysis';

/** Register the five Analyze components at their default tags. Idempotent and SSR-safe. */
export function defineAllAnalysisElements(): void {
  defineKeyAnalysisElement();
  defineChordAnalysisElement();
  defineRomanAnalysisElement();
  defineVoiceLeadingAnalysisElement();
  defineLiveChordAnalysisElement();
}
