import {AnalysisComponentElement, type AnalysisViewType} from './internal/analysis-component';
import {defineOnce} from './base';

/** One musical display, composed alongside other player-bound elements. */
export class ChordAnalysisElement extends AnalysisComponentElement {
  static get observedAttributes(): string[] {
    return ['src', 'format', 'player', 'density', 'scheme', 'motion', 'window', 'spelling', 'key'];
  }

  /** Local key interpretation, e.g. `C major` or `A minor`. */
  get key(): string | undefined { return this.getAttribute('key') ?? undefined; }
  set key(value: string | undefined) {
    if (value === undefined) this.removeAttribute('key');
    else this.setAttribute('key', value);
  }

  protected get analysisType(): AnalysisViewType { return 'chords'; }
}

/** Register <score-chord-analysis>. Idempotent, SSR-safe. */
export function defineChordAnalysisElement(tag = 'score-chord-analysis'): void {
  defineOnce(tag, ChordAnalysisElement);
}
