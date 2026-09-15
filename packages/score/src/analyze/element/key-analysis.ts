import {AnalysisComponentElement, type AnalysisViewType} from './internal/analysis-component';
import {defineOnce} from './base';

/** One musical display, composed alongside other player-bound elements. */
export class KeyAnalysisElement extends AnalysisComponentElement {
  static get observedAttributes(): string[] {
    return ['src', 'format', 'player', 'density', 'scheme', 'motion', 'window'];
  }

  protected get analysisType(): AnalysisViewType { return 'key'; }
}

/** Register <key-analysis>. Idempotent, SSR-safe. */
export function defineKeyAnalysisElement(tag = 'key-analysis'): void {
  defineOnce(tag, KeyAnalysisElement);
}
