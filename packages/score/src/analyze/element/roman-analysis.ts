import {AnalysisComponentElement, type AnalysisViewType} from './internal/analysis-component';
import {defineOnce} from './base';

/** One musical display, composed alongside other player-bound elements. */
export class RomanAnalysisElement extends AnalysisComponentElement {
  static get observedAttributes(): string[] {
    return ['src', 'format', 'player', 'density', 'scheme', 'motion', 'window', 'function'];
  }

  protected get analysisType(): AnalysisViewType { return 'roman'; }
}

/** Register <roman-analysis>. Idempotent, SSR-safe. */
export function defineRomanAnalysisElement(tag = 'roman-analysis'): void {
  defineOnce(tag, RomanAnalysisElement);
}
