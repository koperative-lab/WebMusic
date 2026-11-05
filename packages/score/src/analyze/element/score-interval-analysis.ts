import {AnalysisComponentElement, type AnalysisViewType} from './internal/analysis-component';
import {defineOnce} from './base';

/** Inspect spelled relationships between explicitly identified score notes. */
export class IntervalAnalysisElement extends AnalysisComponentElement {
  static get observedAttributes(): string[] {
    return ['src', 'format', 'player', 'density', 'scheme', 'motion', 'window', 'part', 'voice', 'kind', 'pitch-mode'];
  }
  protected get analysisType(): AnalysisViewType { return 'intervals'; }
}

/** Register <score-interval-analysis>; idempotent and SSR-safe. */
export function defineIntervalAnalysisElement(tag = 'score-interval-analysis'): void {
  defineOnce(tag, IntervalAnalysisElement);
}
