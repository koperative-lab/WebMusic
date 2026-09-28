import {mountLevelAnalyzer, type LevelAnalyzerHandle, type LevelAnalyzerSample} from '@webmusic/ui/level-analyzer';
import {createRealtimeAnalyzer, type RealtimeAnalyzer, type RealtimeFrame} from '../headless/realtime';
import {WebMusicElement, defineOnce, upgradeProperties} from './internal/base';
import {bindAnalysisPlayer, type AnalysisPlayerSnapshot, type AnalysisPlayerTarget, type AnalysisPlayerUpdate} from './internal/player-binding';
import {applyAnalysisTheme} from './internal/theme';

export interface AudioLevelChangeDetail {
  rmsDbfs: number;
  peakDbfs: number;
  crestDb: number;
  heldPeakDbfs: number;
  thresholdDbfs: number;
}

const HISTORY_LENGTH = 64;
const STALL_MS = 500;

function toDbfs(linear: number): number {
  return 20 * Math.log10(Math.max(1e-6, linear));
}

/** Sampled dynamics inspector over a borrowed audio graph. */
export class AudioLevelAnalyzerElement extends WebMusicElement {
  static get observedAttributes(): string[] { return ['player', 'threshold-dbfs']; }

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
  #handle?: LevelAnalyzerHandle;
  #sample?: LevelAnalyzerSample;
  #heldPeakDbfs?: number;
  #history: LevelAnalyzerSample[] = [];
  #frozen = false;
  #status = 'Waiting for playback';
  #lastTime?: {seconds: number; at: number};

  protected override onMount(): void {
    this.own(() => this.#teardown());
    const onVisibility = () => {
      if (this.ownerDocument.hidden) {
        this.#stop();
        this.#sample = undefined;
        this.#heldPeakDbfs = undefined;
        this.#history = [];
        this.#status = 'Paused';
        this.#render();
      } else {
        this.#stalled = false;
        this.#reportedStall = false;
        this.#reconcile(true);
      }
    };
    this.ownerDocument.addEventListener('visibilitychange', onVisibility);
    this.own(() => this.ownerDocument.removeEventListener('visibilitychange', onVisibility));
    upgradeProperties(this, ['analyser']);
    this.#handle = mountLevelAnalyzer(this, {
      onThresholdChange: (value) => { this.thresholdDbfs = value; },
      onFreezeChange: (frozen) => { this.#frozen = frozen; this.#render(); },
      onResetHold: () => { this.#heldPeakDbfs = this.#sample?.peakDbfs; this.#render(); },
    });
    applyAnalysisTheme(this, this.#handle.element, 'audio-level-analyzer');
    this.#render();
    this.#bind();
  }

  attributeChangedCallback(name?: string, previous?: string | null, next?: string | null): void {
    if (!this.isConnected || previous === next) return;
    if (name === 'player') this.#bind();
    else this.#render();
  }

  /** A caller-owned input graph; it takes precedence over the player analyser. */
  set analyser(value: AnalyserNode | undefined) {
    if (this.#explicitAnalyser === value && !this.#stalled) return;
    this.#explicitAnalyser = value;
    this.#reportedStall = false;
    this.#readFailed = false;
    if (this.isConnected) this.#reconcile(true);
  }

  get analyser(): AnalyserNode | undefined { return this.#explicitAnalyser; }
  get sample(): Readonly<LevelAnalyzerSample> | undefined { return this.#sample; }
  get heldPeakDbfs(): number | undefined { return this.#heldPeakDbfs; }
  get frozen(): boolean { return this.#frozen; }

  /** Sample-peak comparison threshold, from -60 to 0 dBFS. Default -12. */
  get thresholdDbfs(): number {
    const raw = this.getAttribute('threshold-dbfs');
    const value = raw === null ? -12 : Number(raw);
    return Number.isFinite(value) ? Math.max(-60, Math.min(0, value)) : -12;
  }

  set thresholdDbfs(value: number) {
    this.setAttribute('threshold-dbfs', String(Number.isFinite(value) ? Math.max(-60, Math.min(0, value)) : -12));
  }

  #bind(): void {
    this.#unbind?.();
    this.#unbind = undefined;
    this.#player = undefined;
    this.#playerState = 'unbound';
    this.#playing = false;
    this.#reportedStall = false;
    this.#readFailed = false;
    this.#lastTime = undefined;
    this.#reconcile(true);
    this.#unbind = bindAnalysisPlayer(this, (kind, reading) => this.#onPlayer(kind, reading));
  }

  #onPlayer(kind: AnalysisPlayerUpdate, reading: AnalysisPlayerSnapshot): void {
    if (kind === 'target' || kind === 'source') {
      this.#player = reading.target;
      this.#playerState = reading.state;
      this.#playing = reading.playing;
      this.#reportedStall = false;
      this.#readFailed = false;
      this.#lastTime = undefined;
      this.#reconcile(true);
      return;
    }
    if (kind === 'seek' || kind === 'end') {
      this.#playing = kind !== 'end' && reading.playing;
      this.#reportedStall = false;
      this.#lastTime = undefined;
      this.#reconcile(true);
      return;
    }
    if (kind === 'time') {
      const at = performance.now();
      const previous = this.#lastTime;
      this.#lastTime = {seconds: reading.seconds, at};
      if (previous && Math.abs(reading.seconds - previous.seconds) > (at - previous.at) / 250 + 0.25) {
        this.#playing = reading.playing;
        this.#reconcile(true);
        return;
      }
    }
    const changed = this.#playing !== reading.playing;
    this.#playing = reading.playing;
    if (changed) {
      this.#reportedStall = false;
      this.#readFailed = false;
      this.#lastTime = undefined;
      this.#reconcile(true);
    }
  }

  #reconcile(reset: boolean): void {
    if (reset) {
      this.#stalled = false;
      this.#stop();
      this.#frozen = false;
      this.#sample = undefined;
      this.#heldPeakDbfs = undefined;
      this.#history = [];
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
      const runner = createRealtimeAnalyzer(analyser, {intervalMs: 50});
      this.#runner = runner;
      this.#analyser = analyser;
      runner.start((frame) => {
        if (revision !== this.#revision || !this.isConnected) return;
        this.#armStall(revision);
        if (!this.#frozen) this.#accept(frame);
      });
      this.#armStall(revision);
      this.#status = 'Live';
      this.#render();
    } catch (error) {
      this.#stop();
      this.#status = 'Live analyser unavailable';
      this.#render();
      this.#report(error);
    }
  }

  #accept(frame: RealtimeFrame): void {
    this.#reportedStall = false;
    const sample = {rmsDbfs: toDbfs(frame.rms), peakDbfs: toDbfs(frame.peak)};
    this.#status = frame.peak <= 1e-6 ? 'No signal' : 'Live';
    this.#sample = sample;
    this.#heldPeakDbfs = Math.max(this.#heldPeakDbfs ?? -Infinity, sample.peakDbfs);
    this.#history.push(sample);
    if (this.#history.length > HISTORY_LENGTH) this.#history.shift();
    this.#render();
    this.dispatchEvent(new CustomEvent<AudioLevelChangeDetail>('webaudio:levelchange', {
      detail: {
        ...sample,
        crestDb: sample.peakDbfs - sample.rmsDbfs,
        heldPeakDbfs: this.#heldPeakDbfs,
        thresholdDbfs: this.thresholdDbfs,
      },
      bubbles: true,
      composed: true,
    }));
  }

  #render(): void {
    this.#handle?.update({
      sample: this.#sample,
      heldPeakDbfs: this.#heldPeakDbfs,
      history: this.#history,
      thresholdDbfs: this.thresholdDbfs,
      frozen: this.#frozen,
      status: this.#frozen ? 'Frozen' : this.#status,
    });
  }

  #armStall(revision: number): void {
    if (this.#stallTimer) clearTimeout(this.#stallTimer);
    this.#stallTimer = setTimeout(() => {
      if (revision !== this.#revision || !this.isConnected) return;
      this.#stalled = true;
      this.#stop();
      this.#sample = undefined;
      this.#status = 'Live audio unavailable';
      this.#render();
      if (!this.#reportedStall) {
        this.#reportedStall = true;
        this.#report(new Error('Live level frames stopped arriving.'));
      }
      if (!this.ownerDocument.hidden) {
        this.#stallTimer = setTimeout(() => {
          this.#stallTimer = undefined;
          if (this.#stalled && this.isConnected && !this.ownerDocument.hidden) this.#reconcile(true);
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
    this.#handle?.destroy();
    this.#handle = undefined;
    this.#player = undefined;
    this.#sample = undefined;
    this.#heldPeakDbfs = undefined;
    this.#history = [];
  }
}

export function defineAudioLevelAnalyzerElement(tag = 'audio-level-analyzer'): void {
  defineOnce(tag, AudioLevelAnalyzerElement);
}
