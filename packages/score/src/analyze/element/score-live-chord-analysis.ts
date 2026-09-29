import {AnalysisComponentElement, type AnalysisViewType} from './internal/analysis-component';
import {defineOnce} from './base';

/** One musical display, composed alongside other player-bound elements. */
export class LiveChordAnalysisElement extends AnalysisComponentElement {
  static get observedAttributes(): string[] {
    return ['player', 'density', 'scheme', 'spelling', 'alternates', 'stability-ms'];
  }

  protected get analysisType(): AnalysisViewType { return 'live-chord'; }
}

/** Register <score-live-chord-analysis>. Idempotent, SSR-safe. */
export function defineLiveChordAnalysisElement(tag = 'score-live-chord-analysis'): void {
  defineOnce(tag, LiveChordAnalysisElement);
}
