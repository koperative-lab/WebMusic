import {AnalysisComponentElement, type AnalysisViewType} from './internal/analysis-component';
import {defineOnce} from './base';

/** Inspect written attacks within explicit simple, compound or additive beat groups. */
export class RhythmAnalysisElement extends AnalysisComponentElement {
  static get observedAttributes(): string[] {
    return ['src', 'format', 'player', 'density', 'scheme', 'motion', 'window', 'part', 'beat-groups', 'subdivision'];
  }
  protected get analysisType(): AnalysisViewType { return 'rhythm'; }
}

/** Register <score-rhythm-analysis>; idempotent and SSR-safe. */
export function defineRhythmAnalysisElement(tag = 'score-rhythm-analysis'): void {
  defineOnce(tag, RhythmAnalysisElement);
}
