import {
  mountOscilloscope,
  type OscilloscopeHandle,
  type OscilloscopeState,
  type OscilloscopeTrace,
  type OscilloscopeTriggerEdge,
} from '@webmusic/ui/oscilloscope';
import {createRealtimeAnalyzer, type RealtimeAnalyzer, type RealtimeFrame} from '../headless/realtime';
import {WebMusicElement, boolAttr, defineOnce, upgradeProperties} from './internal/base';
import {
  bindAnalysisPlayer,
  type AnalysisPlayerSnapshot,
  type AnalysisPlayerTarget,
  type AnalysisPlayerUpdate,
} from './internal/player-binding';
import {applyAnalysisTheme} from './internal/theme';

export interface AudioOscilloscopeProbeDetail {
  /** Time from the left edge of the sampled window, not player/media time. */
  timeMs: number;
  /** Instantaneous linear sample amplitude, when a window exists. */
  amplitude?: number;
}

const STALL_MS = 500;

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

/** Align a bounded sampled window to the most recent eligible threshold crossing. */
export function selectOscilloscopeTrace(
  samples: Float32Array,
  sampleRate: number,
  timebaseMs: number,
  triggerLevel: number,
  triggerEdge: OscilloscopeTriggerEdge,
): OscilloscopeTrace {
  if (samples.length < 2 || !Number.isFinite(sampleRate) || sampleRate <= 0) {
    throw new RangeError('Oscilloscope requires at least two samples and a positive sample rate');
  }
  if (!Number.isFinite(timebaseMs) || timebaseMs <= 0) {
    throw new RangeError('timebaseMs must be positive and finite');
  }
  if (!Number.isFinite(triggerLevel) || triggerLevel < -1 || triggerLevel > 1) {
    throw new RangeError('triggerLevel must be a finite amplitude from -1 to 1');
  }
  if (triggerEdge !== 'off' && triggerEdge !== 'rising' && triggerEdge !== 'falling') {
    throw new RangeError('triggerEdge must be off, rising or falling');
  }
  const count = clamp(Math.round(timebaseMs * sampleRate / 1_000) + 1, 2, samples.length);
  const lastStart = samples.length - count;
  let start = lastStart;
  let triggered = false;
  if (triggerEdge !== 'off') {
    for (let index = lastStart; index >= 1; index -= 1) {
      const previous = samples[index - 1]!;
      const current = samples[index]!;
      const crossing = triggerEdge === 'rising'
        ? previous < triggerLevel && current >= triggerLevel
        : previous > triggerLevel && current <= triggerLevel;
      if (!crossing) continue;
      start = index;
      triggered = true;
      break;
    }
  }
  const visible = samples.slice(start, start + count);
  return {
    samples: visible,
    timebaseMs: (count - 1) / sampleRate * 1_000,
    triggered,
    silent: visible.every((sample) => Math.abs(sample) < 1e-5),
  };
}

/** Triggered inspection of one borrowed, mono AnalyserNode time-domain window. */
export class AudioOscilloscopeElement extends WebMusicElement {
  static get observedAttributes(): string[] {
    return ['player', 'frozen', 'timebase-ms', 'trigger-level', 'trigger-edge', 'aria-label'];
  }

  #explicitAnalyser?: AnalyserNode;
  #player?: AnalysisPlayerTarget;
  #playerState: AnalysisPlayerSnapshot['state'] = 'unbound';
  #playing = false;
  #loading = false;
  #emptySource = false;
  #loadError?: Error;
  #analyser?: AnalyserNode;
  #runner?: RealtimeAnalyzer;
  #stallTimer?: ReturnType<typeof setTimeout>;
  #retryTimer?: ReturnType<typeof setTimeout>;
  #stalled = false;
  #stallReported = false;
  #unbind?: () => void;
  #revision = 0;
  #lastTime?: {seconds: number; at: number};
  #raw?: Float32Array;
  #sampleRate = 0;
  #trace?: OscilloscopeTrace;
  #status: OscilloscopeState['status'] = 'waiting';
  #presenter?: OscilloscopeHandle;

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
    upgradeProperties(this, ['analyser', 'frozen', 'timebaseMs', 'triggerLevel', 'triggerEdge']);
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
    } else if (name === 'timebase-ms' || name === 'trigger-level' || name === 'trigger-edge') {
      this.#project();
    } else if (name === 'aria-label') {
      this.#presenter?.element.setAttribute('aria-label', this.getAttribute('aria-label') ?? 'Oscilloscope');
    }
  }

  /** Direct caller-owned graph input; takes precedence over `player`. */
  set analyser(value: AnalyserNode | undefined) {
    if (value === this.#explicitAnalyser) return;
    this.#explicitAnalyser = value;
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

  /** Visible time span, capped by the borrowed analyser's current sample window. */
  get timebaseMs(): number {
    const raw = this.getAttribute('timebase-ms');
    const parsed = raw === null ? 10 : Number(raw);
    const requested = Number.isFinite(parsed) && parsed > 0 ? parsed : 10;
    const available = this.#availableTimeMs();
    return clamp(requested, Math.min(1, available), available);
  }
  set timebaseMs(value: number) { this.setAttribute('timebase-ms', String(value)); }

  /** Trigger threshold in linear sample amplitude, from -1 to 1. */
  get triggerLevel(): number {
    const raw = this.getAttribute('trigger-level');
    const parsed = raw === null ? 0 : Number(raw);
    return Number.isFinite(parsed) ? clamp(parsed, -1, 1) : 0;
  }
  set triggerLevel(value: number) { this.setAttribute('trigger-level', String(value)); }

  get triggerEdge(): OscilloscopeTriggerEdge {
    const raw = this.getAttribute('trigger-edge');
    return raw === 'off' || raw === 'falling' ? raw : 'rising';
  }
  set triggerEdge(value: OscilloscopeTriggerEdge) { this.setAttribute('trigger-edge', value); }

  get trace(): OscilloscopeTrace | undefined { return this.#trace; }
  get selectedTimeMs(): number { return this.#presenter?.selectedTimeMs ?? 0; }

  #availableTimeMs(): number {
    return this.#raw && this.#sampleRate > 0
      ? Math.max(.001, (this.#raw.length - 1) / this.#sampleRate * 1_000)
      : 100;
  }

  #mount(): void {
    this.#presenter = mountOscilloscope(this, {
      snapshot: () => ({
        trace: this.#trace,
        availableTimeMs: this.#availableTimeMs(),
        timebaseMs: this.timebaseMs,
        triggerLevel: this.triggerLevel,
        triggerEdge: this.triggerEdge,
        frozen: this.frozen,
        status: this.#status,
      }),
      setFrozen: (value) => { this.frozen = value; },
      setTimebaseMs: (value) => { this.timebaseMs = value; },
      setTriggerLevel: (value) => { this.triggerLevel = value; },
      setTriggerEdge: (value) => { this.triggerEdge = value; },
      probe: (timeMs, amplitude) => {
        this.dispatchEvent(new CustomEvent<AudioOscilloscopeProbeDetail>('webaudio:oscilloscopeprobe', {
          detail: {timeMs, ...(amplitude === undefined ? {} : {amplitude})},
          bubbles: true,
          composed: true,
        }));
      },
    }, {
      label: this.getAttribute('aria-label') ?? 'Oscilloscope',
      onError: (error) => this.#report(error),
    });
    applyAnalysisTheme(this, this.#presenter.element, 'audio-oscilloscope');
  }

  #bind(): void {
    this.#unbind?.();
    this.#unbind = undefined;
    this.#player = undefined;
    this.#playerState = 'unbound';
    this.#loading = false;
    this.#emptySource = false;
    this.#loadError = undefined;
    this.#playing = false;
    this.#lastTime = undefined;
    this.#stalled = false;
    this.#stallReported = false;
    this.#resetForTransportChange();
    this.#unbind = bindAnalysisPlayer(this, (kind, reading) => this.#onPlayer(kind, reading));
  }

  #onPlayer(kind: AnalysisPlayerUpdate, reading: AnalysisPlayerSnapshot): void {
    this.#loading = reading.loading;
    this.#emptySource = reading.empty;
    this.#loadError = reading.loadError;
    this.#player = reading.target;
    this.#playerState = reading.state;
    this.#playing = kind === 'end' ? false : reading.playing;
    if (this.#explicitAnalyser) return;
    if (kind === 'target' || kind === 'source' || kind === 'seek' || kind === 'end' || kind === 'state') {
      this.#lastTime = undefined;
      this.#stalled = false;
      this.#stallReported = false;
      this.#resetForTransportChange();
    } else if (kind === 'time') {
      const at = performance.now();
      const previous = this.#lastTime;
      this.#lastTime = {seconds: reading.seconds, at};
      if (previous && Math.abs(reading.seconds - previous.seconds) > (at - previous.at) / 250 + .25) {
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
    if (!this.#explicitAnalyser && (this.#loading || this.#loadError)) {
      this.#stop();
      this.#clear(this.#loadError ? 'unavailable' : 'loading');
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
        ? 'unavailable' : this.#player && !this.#emptySource ? 'paused' : 'waiting');
      return;
    }
    if (this.#analyser === analyser && this.#runner?.running) return;
    this.#stop();
    const revision = ++this.#revision;
    try {
      const runner = createRealtimeAnalyzer(analyser, {intervalMs: 50, includeTimeDomain: true});
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
    const samples = frame.timeDomainData;
    const sampleRate = analyser.context.sampleRate;
    if (!samples || samples.length < 2 || !Number.isFinite(sampleRate) || sampleRate <= 0) {
      throw new Error('Oscilloscope time-domain frame is unavailable');
    }
    this.#raw = samples;
    this.#sampleRate = sampleRate;
    this.#status = 'live';
    this.#stallReported = false;
    this.#project();
  }

  #project(): void {
    this.#trace = this.#raw
      ? selectOscilloscopeTrace(this.#raw, this.#sampleRate, this.timebaseMs, this.triggerLevel, this.triggerEdge)
      : undefined;
    this.#presenter?.update();
  }

  #armStall(revision: number): void {
    if (this.#stallTimer) clearTimeout(this.#stallTimer);
    this.#stallTimer = setTimeout(() => {
      if (revision !== this.#revision || !this.isConnected || this.frozen || !this.#runner?.running) return;
      this.#stalled = true;
      this.#stop();
      this.#clear('unavailable');
      if (!this.#stallReported) this.#report(new Error('Oscilloscope stopped producing frames'));
      this.#stallReported = true;
      const retryRevision = this.#revision;
      this.#retryTimer = setTimeout(() => {
        this.#retryTimer = undefined;
        if (retryRevision !== this.#revision || !this.isConnected || this.frozen || this.ownerDocument.hidden) return;
        this.#stalled = false;
        this.#reconcile(true);
      }, STALL_MS);
    }, STALL_MS);
  }

  #clear(status: OscilloscopeState['status']): void {
    this.#raw = undefined;
    this.#sampleRate = 0;
    this.#trace = undefined;
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
    this.#clear('waiting');
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

export function defineAudioOscilloscopeElement(tag = 'audio-oscilloscope'): void {
  defineOnce(tag, AudioOscilloscopeElement);
}
