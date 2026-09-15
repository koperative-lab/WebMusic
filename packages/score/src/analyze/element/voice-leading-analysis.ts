import {AnalysisComponentElement, type AnalysisViewType} from './internal/analysis-component';
import {defineOnce} from './base';

/** One musical display, composed alongside other player-bound elements. */
export class VoiceLeadingAnalysisElement extends AnalysisComponentElement {
  static get observedAttributes(): string[] {
    return ['src', 'format', 'player', 'density', 'scheme', 'motion', 'window'];
  }

  protected get analysisType(): AnalysisViewType { return 'voice-leading'; }
}

/** Register <voice-leading-analysis>. Idempotent, SSR-safe. */
export function defineVoiceLeadingAnalysisElement(tag = 'voice-leading-analysis'): void {
  defineOnce(tag, VoiceLeadingAnalysisElement);
}
