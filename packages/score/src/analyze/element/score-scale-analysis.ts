import type {ScaleKind} from '../core';
import {AnalysisComponentElement, type AnalysisViewType} from './internal/analysis-component';
import {defineOnce} from './base';

/** Compare authored pitches with an explicitly chosen tonic and scale. */
export class ScaleAnalysisElement extends AnalysisComponentElement {
  static get observedAttributes(): string[] {
    return ['src', 'format', 'player', 'density', 'scheme', 'motion', 'window', 'part', 'voice', 'tonic', 'scale', 'pitch-mode'];
  }
  get tonic(): string | undefined { return this.getAttribute('tonic') ?? undefined; }
  set tonic(value: string | undefined) {
    if (value === undefined) this.removeAttribute('tonic');
    else this.setAttribute('tonic', value);
  }
  get scale(): ScaleKind { return (this.getAttribute('scale') ?? 'major') as ScaleKind; }
  set scale(value: ScaleKind) { this.setAttribute('scale', value); }
  protected get analysisType(): AnalysisViewType { return 'scale'; }
}

/** Register <score-scale-analysis>; idempotent and SSR-safe. */
export function defineScaleAnalysisElement(tag = 'score-scale-analysis'): void {
  defineOnce(tag, ScaleAnalysisElement);
}
