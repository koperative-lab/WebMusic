import {AnalysisComponentElement, type AnalysisViewType} from './internal/analysis-component';
import {defineOnce} from './base';

/** One musical display, composed alongside other player-bound elements. */
export class ChordAnalysisElement extends AnalysisComponentElement {
  static get observedAttributes(): string[] {
    return ['src', 'format', 'player', 'density', 'scheme', 'motion', 'window', 'mode', 'grouping', 'beat-groups', 'spelling', 'key', 'pitch-mode', 'alternates', 'stability-ms'];
  }

  /** Score inspection or the currently held notes; changes never command playback. */
  get mode(): 'score' | 'live' { return this.getAttribute('mode') === 'live' ? 'live' : 'score'; }
  set mode(value: 'score' | 'live') { this.setAttribute('mode', value); }

  /** Collect score pitches within one metrical beat, or inspect exact simultaneous spans. */
  get grouping(): 'beat' | 'simultaneous' { return this.getAttribute('grouping') === 'simultaneous' ? 'simultaneous' : 'beat'; }
  set grouping(value: 'beat' | 'simultaneous') { this.setAttribute('grouping', value); }

  /** Local key interpretation, e.g. `C major` or `A minor`. */
  get key(): string | undefined { return this.getAttribute('key') ?? undefined; }
  set key(value: string | undefined) {
    if (value === undefined) this.removeAttribute('key');
    else this.setAttribute('key', value);
  }

  protected get analysisType(): AnalysisViewType { return this.mode === 'live' ? 'live-chord' : 'chords'; }
}

/** Register <score-chord-analysis>. Idempotent, SSR-safe. */
export function defineChordAnalysisElement(tag = 'score-chord-analysis'): void {
  defineOnce(tag, ChordAnalysisElement);
}
