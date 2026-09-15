import {AnalysisComponentElement, type AnalysisViewType} from './internal/analysis-component';
import {defineOnce} from './base';

/** One musical display, composed alongside other player-bound elements. */
export class ChordAnalysisElement extends AnalysisComponentElement {
  static get observedAttributes(): string[] {
    return ['src', 'format', 'player', 'density', 'scheme', 'motion', 'window'];
  }

  protected get analysisType(): AnalysisViewType { return 'chords'; }
}

/** Register <chord-analysis>. Idempotent, SSR-safe. */
export function defineChordAnalysisElement(tag = 'chord-analysis'): void {
  defineOnce(tag, ChordAnalysisElement);
}
