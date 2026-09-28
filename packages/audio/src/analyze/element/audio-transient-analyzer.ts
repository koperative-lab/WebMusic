import {
  mountTransientAnalyzer,
  type TransientAnalyzerHandle,
  type TransientAnalyzerSample,
} from '@webmusic/ui/transient-analyzer';
import {createTransientDetector} from '../headless/transient';
import {createRealtimeAnalyzer, type RealtimeAnalyzer, type RealtimeFrame} from '../headless/realtime';
import {WebMusicElement, defineOnce, upgradeProperties} from './internal/base';
import {bindAnalysisPlayer, type AnalysisPlayerSnapshot, type AnalysisPlayerTarget, type AnalysisPlayerUpdate} from './internal/player-binding';
import {applyAnalysisTheme} from './internal/theme';

export interface AudioTransientDetail {
  /** Approximate capture timestamp from performance.now(), in milliseconds. */
  timeMs: number;
  strength: number;
  threshold: number;
  intervalMs?: number;
}

const HISTORY_LENGTH = 64;
const STALL_MS = 500;

function thresholdFor(sensitivity: number): number {
  return 0.08 + (1 - sensitivity) * 0.28;
}

/** Streaming attack inspector over a borrowed audio graph. */
export class AudioTransientAnalyzerElement extends WebMusicElement {
  static get observedAttributes(): string[] { return ['player', 'sensitivity', 'min-interval-ms']; }

  #explicitAnalyser?: AnalyserNode;
  #player?: AnalysisPlayerTarget;
  #playerState: AnalysisPlayerSnapshot['state'] = 'unbound';
  #playing = false;
  #analyser?: AnalyserNode;
  #runner?: RealtimeAnalyzer;
  #unbind?: () => void;
  #stallTimer?: ReturnType<typeof setTimeout>;
  #revision = 0;
  #stalled = false;
  #reportedStall = false;
  #readFailed = false;
  #lastTime?: {seconds: number; at: number};
  #detector = createTransientDetector();
  #handle?: TransientAnalyzerHandle;
  #sample?: TransientAnalyzerSample;
  #history: TransientAnalyzerSample[] = [];
  #hitCount = 0;
  #lastIntervalMs?: number;
  #frozen = false;
  #status = 'Waiting for playback';

  protected override onMount(): void {
    this.own(() => this.#teardown());
    const onVisibility = () => {
      if (this.ownerDocument.hidden) {
        this.#stop();
        this.#resetReadings();
        this.#frozen = false;
        this.#status = 'Paused';
        this.#render();
      } else {
        this.#reportedStall = false;
        this.#reconcile(true);
      }
    };
    this.ownerDocument.addEventListener('visibilitychange', onVisibility);
    this.own(() => this.ownerDocument.removeEventListener('visibilitychange', onVisibility));
    upgradeProperties(this, ['analyser']);
    this.#handle = mountTransientAnalyzer(this, {
      onSensitivityChange: (value) => { this.sensitivity = value; },
      onFreezeChange: (value) => this.#setFrozen(value),
      onClear: () => this.reset(),
    });
    applyAnalysisTheme(this, this.#handle.element, 'audio-transient-analyzer');
    this.#render();
    this.#bind();
  }

  attributeChangedCallback(name?: string, previous?: string | null, next?: string | null): void {
    if (!this.isConnected || previous === next) return;
    if (name === 'player') this.#bind();
    else this.#render();
  }

  /** Caller-owned graph input, preferred over the bound player's analyser. */
  set analyser(value: AnalyserNode | undefined) {
    if (this.#explicitAnalyser === value && !this.#stalled) return;
    this.#explicitAnalyser = value;
    this.#reportedStall = false;
    this.#readFailed = false;
    if (this.isConnected) this.#reconcile(true);
  }
  get analyser(): AnalyserNode | undefined { return this.#explicitAnalyser; }
  get sample(): Readonly<TransientAnalyzerSample> | undefined { return this.#sample; }
  get hitCount(): number { return this.#hitCount; }
  get frozen(): boolean { return this.#frozen; }

  /** Detection sensitivity in [0, 1], default 0.55. */
  get sensitivity(): number {
    const raw = this.getAttribute('sensitivity');
    const value = raw === null ? 0.55 : Number(raw);
    return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0.55;
  }
  set sensitivity(value: number) {
    this.setAttribute('sensitivity', String(Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0.55));
  }

  /** Minimum spacing between emitted attack cues, in milliseconds. */
  get minIntervalMs(): number {
    const raw = this.getAttribute('min-interval-ms');
    const value = raw === null ? 160 : Number(raw);
    return Number.isFinite(value) ? Math.max(50, Math.min(1_000, value)) : 160;
  }
  set minIntervalMs(value: number) {
    this.setAttribute('min-interval-ms', String(Number.isFinite(value) ? Math.max(50, Math.min(1_000, value)) : 160));
  }

  /** Clear the inspection history without changing playback or the audio graph. */
  reset(): void {
    this.#resetReadings();
    this.#render();
  }

  #bind(): void {
    this.#unbind?.();
    this.#unbind = undefined;
    this.#player = undefined;
    this.#playerState = 'unbound';
    this.#playing = false;
    this.#lastTime = undefined;
    this.#reportedStall = false;
    this.#readFailed = false;
    this.#reconcile(true);
    this.#unbind = bindAnalysisPlayer(this, (kind, reading) => this.#onPlayer(kind, reading));
  }

  #onPlayer(kind: AnalysisPlayerUpdate, reading: AnalysisPlayerSnapshot): void {
    this.#player = reading.target;
    this.#playerState = reading.state;
    if (kind === 'target' || kind === 'source' || kind === 'seek' || kind === 'end') {
      this.#playing = kind !== 'end' && reading.playing;
      this.#lastTime = undefined;
      this.#reportedStall = false;
      if (!this.#explicitAnalyser) this.#reconcile(true);
      return;
    }
    if (kind === 'time') {
      const at = performance.now();
      const previous = this.#lastTime;
      this.#lastTime = {seconds: reading.seconds, at};
      if (!this.#explicitAnalyser && previous &&
        Math.abs(reading.seconds - previous.seconds) > (at - previous.at) / 250 + 0.25) {
        this.#playing = reading.playing;
        this.#reconcile(true);
        return;
      }
    }
    const changed = this.#playing !== reading.playing;
    this.#playing = reading.playing;
    if (changed && !this.#explicitAnalyser) {
      this.#lastTime = undefined;
      this.#reportedStall = false;
      this.#reconcile(true);
    }
  }

  #setFrozen(value: boolean): void {
    if (this.#frozen === value) return;
    this.#frozen = value;
    if (value) {
      this.#stop();
      this.#render();
    } else {
      this.#detector.reset();
      this.#stalled = false;
      this.#reconcile(false);
    }
  }

  #reconcile(reset: boolean): void {
    if (reset) {
      this.#stop();
      this.#resetReadings();
      this.#frozen = false;
      this.#stalled = false;
    }
    if (this.#stalled) return;
    if (this.ownerDocument.hidden) {
      this.#status = 'Paused';
      this.#render();
      return;
    }
    let analyser: AnalyserNode | undefined;
    try {
      analyser = this.#explicitAnalyser ?? (this.#playing ? this.#player?.analyser : undefined);
      this.#readFailed = false;
    } catch (error) {
      this.#stop();
      this.#status = 'Live analyser unavailable';
      this.#render();
      if (!this.#readFailed) this.#report(error);
      this.#readFailed = true;
      return;
    }
    if (!analyser) {
      this.#stop();
      this.#status = this.#playerState === 'invalid' ? 'Invalid player selector'
        : this.#playerState === 'ambiguous' ? 'Player selector matches multiple elements'
        : this.#playing ? 'Live analyser unavailable'
        : this.#player ? 'Paused' : 'Waiting for playback';
      this.#render();
      return;
    }
    if (this.#analyser === analyser && this.#runner?.running) return;
    this.#stop();
    const revision = ++this.#revision;
    try {
      const runner = createRealtimeAnalyzer(analyser, {intervalMs: 50, includeSpectrum: true});
      this.#runner = runner;
      this.#analyser = analyser;
      runner.start((frame) => {
        if (revision !== this.#revision || !this.isConnected) return;
        try {
          this.#accept(frame);
          if (revision === this.#revision && this.isConnected && this.#runner === runner && runner.running) {
            this.#armStall(revision);
          }
        } catch (error) {
          this.#stop();
          this.#status = 'Live analyser unavailable';
          this.#render();
          this.#report(error);
        }
      });
      this.#status = 'Listening';
      this.#render();
      this.#armStall(revision);
    } catch (error) {
      this.#stop();
      this.#status = 'Live analyser unavailable';
      this.#render();
      this.#report(error);
    }
  }

  #accept(frame: RealtimeFrame): void {
    if (!frame.frequencyData) throw new Error('Transient spectrum frame is unavailable');
    const observed = this.#detector.observe({
      time: frame.time, rms: frame.rms, frequencyData: frame.frequencyData,
    }, this.sensitivity, this.minIntervalMs);
    this.#reportedStall = false;
    this.#sample = {strength: observed.strength, hit: observed.hit};
    this.#history.push(this.#sample);
    if (this.#history.length > HISTORY_LENGTH) this.#history.shift();
    this.#status = frame.rms < 0.005 ? 'No signal' : 'Live';
    if (observed.hit) {
      this.#hitCount += 1;
      this.#lastIntervalMs = observed.intervalMs;
      this.dispatchEvent(new CustomEvent<AudioTransientDetail>('webaudio:transient', {
        detail: {
          timeMs: frame.time, strength: observed.strength, threshold: observed.threshold,
          ...(observed.intervalMs === undefined ? {} : {intervalMs: observed.intervalMs}),
        },
        bubbles: true,
        composed: true,
      }));
    }
    this.#render();
  }

  #render(): void {
    this.#handle?.update({
      sample: this.#sample,
      history: this.#history,
      sensitivity: this.sensitivity,
      threshold: thresholdFor(this.sensitivity),
      frozen: this.#frozen,
      hitCount: this.#hitCount,
      lastIntervalMs: this.#lastIntervalMs,
      status: this.#frozen ? 'Frozen' : this.#status,
    });
  }

  #resetReadings(): void {
    this.#detector.reset();
    this.#sample = undefined;
    this.#history = [];
    this.#hitCount = 0;
    this.#lastIntervalMs = undefined;
  }

  #armStall(revision: number): void {
    if (this.#stallTimer) clearTimeout(this.#stallTimer);
    this.#stallTimer = setTimeout(() => {
      if (revision !== this.#revision || !this.isConnected) return;
      this.#stalled = true;
      this.#stop();
      const stoppedRevision = this.#revision;
      this.#resetReadings();
      this.#status = 'Live audio unavailable';
      this.#render();
      if (!this.#reportedStall) {
        this.#reportedStall = true;
        this.#report(new Error('Live transient frames stopped arriving.'));
      }
      if (this.#revision === stoppedRevision && this.#stalled && this.isConnected && !this.ownerDocument.hidden) {
        this.#stallTimer = setTimeout(() => {
          this.#stallTimer = undefined;
          if (this.#revision === stoppedRevision && this.#stalled && this.isConnected && !this.ownerDocument.hidden) {
            this.#reconcile(true);
          }
        }, STALL_MS);
      }
    }, STALL_MS);
  }

  #stop(): void {
    this.#revision += 1;
    if (this.#stallTimer) clearTimeout(this.#stallTimer);
    this.#stallTimer = undefined;
    this.#runner?.stop();
    this.#runner = undefined;
    this.#analyser = undefined;
  }

  #report(error: unknown): void {
    this.dispatchEvent(new CustomEvent('webaudio:error', {
      detail: {error: error instanceof Error ? error : new Error(String(error))},
      bubbles: true,
      composed: true,
    }));
  }

  #teardown(): void {
    this.#unbind?.();
    this.#unbind = undefined;
    this.#stop();
    this.#resetReadings();
    this.#handle?.destroy();
    this.#handle = undefined;
    this.#player = undefined;
    this.#lastTime = undefined;
  }
}

export function defineAudioTransientAnalyzerElement(tag = 'audio-transient-analyzer'): void {
  defineOnce(tag, AudioTransientAnalyzerElement);
}
