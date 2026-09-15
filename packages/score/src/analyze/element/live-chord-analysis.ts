import {AnalysisComponentElement, type AnalysisViewType} from './internal/analysis-component';
import {defineOnce} from './base';

/** One musical display, composed alongside other player-bound elements. */
export class LiveChordAnalysisElement extends AnalysisComponentElement {
  static get observedAttributes(): string[] {
    return ['player', 'density', 'scheme', 'spelling', 'alternates'];
  }

  protected get analysisType(): AnalysisViewType { return 'live-chord'; }
}

/** Register <live-chord-analysis>. Idempotent, SSR-safe. */
export function defineLiveChordAnalysisElement(tag = 'live-chord-analysis'): void {
  defineOnce(tag, LiveChordAnalysisElement);
}
