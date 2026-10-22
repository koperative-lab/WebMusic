// @webmusic/score/analyze/element — four foundational musical inspection tools.
// Importing this entry registers nothing. Headless/API analysis remains separate.

export type {
  AnalysisViewSeekDetail as AnalysisSeekDetail,
  AnalysisSelection,
  AnalysisViewSelectDetail as AnalysisSelectDetail,
  AnalysisInspection,
  AnalysisInspectionCandidate,
} from './internal/analysis-component';
export {ChordAnalysisElement, defineChordAnalysisElement} from './score-chord-analysis';
export {IntervalAnalysisElement, defineIntervalAnalysisElement} from './score-interval-analysis';
export {ScaleAnalysisElement, defineScaleAnalysisElement} from './score-scale-analysis';
export {RhythmAnalysisElement, defineRhythmAnalysisElement} from './score-rhythm-analysis';

import {defineChordAnalysisElement} from './score-chord-analysis';
import {defineIntervalAnalysisElement} from './score-interval-analysis';
import {defineScaleAnalysisElement} from './score-scale-analysis';
import {defineRhythmAnalysisElement} from './score-rhythm-analysis';

/** Register the four Analyze components at their default tags. Idempotent and SSR-safe. */
export function defineAllAnalysisElements(): void {
  defineChordAnalysisElement();
  defineIntervalAnalysisElement();
  defineScaleAnalysisElement();
  defineRhythmAnalysisElement();
}
