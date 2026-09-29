// @webmusic/score/analyze/element — two focused musical inspection tools.
// Importing this entry registers nothing. Headless/API analysis remains separate.

export type {
  AnalysisViewSeekDetail as AnalysisSeekDetail,
  AnalysisSelection,
  AnalysisViewSelectDetail as AnalysisSelectDetail,
  AnalysisInspection,
  AnalysisInspectionCandidate,
} from './internal/analysis-component';
export {ChordAnalysisElement, defineChordAnalysisElement} from './score-chord-analysis';
export {LiveChordAnalysisElement, defineLiveChordAnalysisElement} from './score-live-chord-analysis';

import {defineChordAnalysisElement} from './score-chord-analysis';
import {defineLiveChordAnalysisElement} from './score-live-chord-analysis';

/** Register the two Analyze components at their default tags. Idempotent and SSR-safe. */
export function defineAllAnalysisElements(): void {
  defineChordAnalysisElement();
  defineLiveChordAnalysisElement();
}
