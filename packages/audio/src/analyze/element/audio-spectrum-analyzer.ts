import {
  mountSpectrumAnalyzer,
  type SpectrumAnalyzerFrame,
  type SpectrumAnalyzerHandle,
  type SpectrumAnalyzerState,
} from '@webmusic/ui/spectrum-analyzer';
import {createRealtimeAnalyzer, type RealtimeAnalyzer, type RealtimeFrame} from '../headless/realtime';
import {WebMusicElement, boolAttr, defineOnce, upgradeProperties} from './internal/base';
import {
  bindAnalysisPlayer,
  type AnalysisPlayerSnapshot,
  type AnalysisPlayerTarget,
  type AnalysisPlayerUpdate,
} from './internal/player-binding';
import {applyAnalysisTheme} from './internal/theme';

export interface AudioSpectrumProbeDetail {
  frequency: number;
  decibels?: number;
}

/** Live, inspectable FFT spectrum from a borrowed audio graph. */
export class AudioSpectrumAnalyzerElement extends WebMusicElement {
  static get observedAttributes(): string[] {
    return ['player', 'frozen', 'peak-hold', 'min-frequency', 'max-frequency', 'aria-label'];
  }

  #explicitAnalyser?: AnalyserNode;
  #player?: AnalysisPlayerTarget;
  #playerState: AnalysisPlayerSnapshot['state'] = 'unbound';
  #playing = false;
  #analyser?: AnalyserNode;
  #runner?: RealtimeAnalyzer;
  #stallTimer?: ReturnType<typeof setTimeout>;
  #retryTimer?: ReturnType<typeof setTimeout>;
  #stalled = false;
  #stallReported = false;
  #unbind?: () => void;
  #revision = 0;
  #sourceRevision = 0;
  #lastTime?: {seconds: number; at: number};
  #frame?: SpectrumAnalyzerFrame;
  #status: SpectrumAnalyzerState['status'] = 'waiting';
  #presenter?: SpectrumAnalyzerHandle;
  #selectedFrequency = 1_000;

  protected override onMount(): void {
    this.own(() => this.#teardown());
    this.#mount();
    const onVisibility = () => {
      if (this.ownerDocument.hidden) {
        if (!this.frozen) {
          this.#stop();
          this.#clear('paused');
        }
      } else {
        this.#stalled = false;
        this.#stallReported = false;
        if (!this.frozen) this.#reconcile(true);
      }
    };
    this.ownerDocument.addEventListener('visibilitychange', onVisibility);
    this.own(() => this.ownerDocument.removeEventListener('visibilitychange', onVisibility));
    upgradeProperties(this, ['analyser', 'frozen', 'peakHold']);
    this.#bind();
  }

  attributeChangedCallback(name?: string, previous?: string | null, next?: string | null): void {
    if (!this.isConnected || previous === next) return;
    if (name === 'player') this.#bind();
    else if (name === 'frozen') {
      if (this.frozen) {
        this.#stop();
        this.#status = 'frozen';
        this.#presenter?.update();
      } else this.#reconcile(true);
    } else if (name === 'peak-hold' || name === 'min-frequency' || name === 'max-frequency') {
      this.#presenter?.update();
    } else if (name === 'aria-label') {
      this.#presenter?.element.setAttribute('aria-label', this.getAttribute('aria-label') ?? 'Spectrum analyzer');
    }
  }

  /** Direct borrowed graph input; takes precedence over `player`. */
  set analyser(value: AnalyserNode | undefined) {
    if (value === this.#explicitAnalyser) return;
    this.#explicitAnalyser = value;
    this.#sourceRevision += 1;
    this.#stalled = false;
    this.#stallReported = false;
    if (this.isConnected) this.#resetForTransportChange();
  }
  get analyser(): AnalyserNode | undefined { return this.#explicitAnalyser ?? this.#analyser; }

  get frozen(): boolean { return boolAttr(this, 'frozen'); }
  set frozen(value: boolean) {
    if (value) this.setAttribute('frozen', '');
    else this.removeAttribute('frozen');
  }

  get peakHold(): boolean { return boolAttr(this, 'peak-hold'); }
  set peakHold(value: boolean) {
    if (value) this.setAttribute('peak-hold', '');
    else this.removeAttribute('peak-hold');
  }

  get selectedFrequency(): number { return this.#presenter?.selectedFrequency ?? this.#selectedFrequency; }
  get frame(): SpectrumAnalyzerFrame | undefined { return this.#frame; }

  get minFrequency(): number {
    const raw = this.getAttribute('min-frequency');
    const parsed = raw === null ? 20 : Number(raw);
    return Number.isFinite(parsed) && parsed >= 1 ? parsed : 20;
  }
  set minFrequency(value: number) { this.setAttribute('min-frequency', String(value)); }

  get maxFrequency(): number {
    const raw = this.getAttribute('max-frequency');
    const parsed = raw === null ? 20_000 : Number(raw);
    return Number.isFinite(parsed) && parsed > 1 ? parsed : 20_000;
  }
  set maxFrequency(value: number) { this.setAttribute('max-frequency', String(value)); }

  /** Clear the presenter's held spectrum without affecting the audio source. */
  resetPeaks(): void { this.#presenter?.resetPeaks(); }

  #mount(): void {
    this.#presenter = mountSpectrumAnalyzer(this, {
      snapshot: () => ({
        frame: this.#frame,
        sourceRevision: this.#sourceRevision,
        frozen: this.frozen,
        peakHold: this.peakHold,
        minFrequency: this.minFrequency,
        maxFrequency: this.maxFrequency,
        status: this.#status,
      }),
      setFrozen: (value) => { this.frozen = value; },
      setPeakHold: (value) => { this.peakHold = value; },
      probe: (frequency, decibels) => {
        this.#selectedFrequency = frequency;
        this.dispatchEvent(new CustomEvent<AudioSpectrumProbeDetail>('webaudio:spectrumprobe', {
          detail: {frequency, ...(decibels === undefined ? {} : {decibels})},
          bubbles: true,
          composed: true,
        }));
      },
    }, {
      label: this.getAttribute('aria-label') ?? 'Spectrum analyzer',
      onError: (error) => this.#report(error),
    });
    applyAnalysisTheme(this, this.#presenter.element, 'audio-spectrum-analyzer');
  }

  #bind(): void {
    this.#unbind?.();
    this.#unbind = undefined;
    this.#player = undefined;
    this.#playerState = 'unbound';
    this.#playing = false;
    this.#sourceRevision += 1;
    this.#lastTime = undefined;
    this.#stalled = false;
    this.#stallReported = false;
    this.#resetForTransportChange();
    this.#unbind = bindAnalysisPlayer(this, (kind, reading) => this.#onPlayer(kind, reading));
  }

  #onPlayer(kind: AnalysisPlayerUpdate, reading: AnalysisPlayerSnapshot): void {
    this.#player = reading.target;
    this.#playerState = reading.state;
    this.#playing = kind === 'end' ? false : reading.playing;
    if (this.#explicitAnalyser) return;
    if (kind === 'target' || kind === 'source' || kind === 'seek' || kind === 'end') {
      if (kind === 'target' || kind === 'source') this.#sourceRevision += 1;
      this.#lastTime = undefined;
      this.#stalled = false;
      this.#stallReported = false;
      this.#resetForTransportChange();
    } else if (kind === 'state') {
      this.#lastTime = undefined;
      this.#stalled = false;
      this.#stallReported = false;
      this.#resetForTransportChange();
    } else if (kind === 'time') {
      const at = performance.now();
      const previous = this.#lastTime;
      this.#lastTime = {seconds: reading.seconds, at};
      if (previous && Math.abs(reading.seconds - previous.seconds) > (at - previous.at) / 250 + 0.25) {
        this.#stalled = false;
        this.#stallReported = false;
        this.#resetForTransportChange();
      }
    }
  }

  #resetForTransportChange(): void {
    if (this.frozen) this.frozen = false;
    else this.#reconcile(true);
  }

  #reconcile(clear: boolean): void {
    if (clear) {
      this.#stop();
      this.#clear('waiting');
    }
    if (!this.isConnected || this.#stalled) return;
    if (this.frozen) {
      this.#status = 'frozen';
      this.#presenter?.update();
      return;
    }
    if (this.ownerDocument.hidden) {
      this.#stop();
      this.#clear('paused');
      return;
    }
    let analyser: AnalyserNode | undefined;
    try {
      analyser = this.#explicitAnalyser ?? (this.#playing ? this.#player?.analyser : undefined);
    } catch (error) {
      this.#stop();
      this.#clear('unavailable');
      this.#report(error);
      return;
    }
    if (!analyser) {
      this.#stop();
      this.#clear(this.#playing || this.#playerState === 'invalid' || this.#playerState === 'ambiguous'
        ? 'unavailable' : this.#player ? 'paused' : 'waiting');
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
        if (this.#revision !== revision || !this.isConnected) return;
        try {
          this.#accept(frame, analyser);
          this.#armStall(revision);
        } catch (error) {
          this.#stop();
          this.#clear('unavailable');
          this.#report(error);
        }
      });
      this.#status = 'waiting';
      this.#presenter?.update();
      this.#armStall(revision);
    } catch (error) {
      this.#stop();
      this.#clear('unavailable');
      this.#report(error);
    }
  }

  #accept(frame: RealtimeFrame, analyser: AnalyserNode): void {
    const bytes = frame.frequencyData;
    const minDb = analyser.minDecibels;
    const maxDb = analyser.maxDecibels;
    const sampleRate = analyser.context.sampleRate;
    const fftSize = analyser.fftSize;
    if (!bytes || !Number.isFinite(minDb) || !Number.isFinite(maxDb) || minDb >= maxDb ||
      !Number.isFinite(sampleRate) || sampleRate <= 0 || !Number.isFinite(fftSize) || fftSize <= 0) {
      throw new Error('Spectrum analyser frame is unavailable');
    }
    const bins = new Float32Array(bytes.length);
    const scale = (maxDb - minDb) / 255;
    for (let index = 0; index < bytes.length; index += 1) bins[index] = minDb + bytes[index]! * scale;
    this.#frame = {bins, sampleRate, fftSize, minDb, maxDb};
    this.#status = 'live';
    this.#stallReported = false;
    this.#presenter?.update();
  }

  #armStall(revision: number): void {
    if (this.#stallTimer) clearTimeout(this.#stallTimer);
    this.#stallTimer = setTimeout(() => {
      if (revision !== this.#revision || !this.isConnected || this.frozen || !this.#runner?.running) return;
      this.#stalled = true;
      this.#stop();
      this.#clear('unavailable');
      if (!this.#stallReported) this.#report(new Error('Spectrum analyser stopped producing frames'));
      this.#stallReported = true;
      const retryRevision = this.#revision;
      this.#retryTimer = setTimeout(() => {
        this.#retryTimer = undefined;
        if (retryRevision !== this.#revision || !this.isConnected || this.frozen || this.ownerDocument.hidden) return;
        this.#stalled = false;
        this.#reconcile(true);
      }, 500);
    }, 500);
  }

  #clear(status: SpectrumAnalyzerState['status']): void {
    this.#frame = undefined;
    this.#status = status;
    this.#presenter?.update();
  }

  #stop(): void {
    this.#revision += 1;
    if (this.#stallTimer) clearTimeout(this.#stallTimer);
    if (this.#retryTimer) clearTimeout(this.#retryTimer);
    this.#stallTimer = undefined;
    this.#retryTimer = undefined;
    this.#runner?.stop();
    this.#runner = undefined;
    this.#analyser = undefined;
  }

  #teardown(): void {
    this.#unbind?.();
    this.#unbind = undefined;
    this.#stop();
    this.#player = undefined;
    this.#lastTime = undefined;
    this.#frame = undefined;
    this.#status = 'waiting';
    this.#presenter?.destroy();
    this.#presenter = undefined;
  }

  #report(error: unknown): void {
    const normalized = error instanceof Error ? error : new Error(String(error));
    this.dispatchEvent(new CustomEvent('webaudio:error', {
      detail: {error: normalized},
      bubbles: true,
      composed: true,
    }));
  }
}

export function defineAudioSpectrumAnalyzerElement(tag = 'audio-spectrum-analyzer'): void {
  defineOnce(tag, AudioSpectrumAnalyzerElement);
}
