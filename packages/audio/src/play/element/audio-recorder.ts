// ============================================================================
// <audio-recorder> — a record button with a live level bar, take playback
// and WAV export. Press to open the microphone (AudioRecorder → PCM), press
// again to stop; the finished take is announced as `webaudio:recorded`, can be
// replayed from the ▶ button and serialized from ⬇ WAV. Mirrors <score-recorder>.
//
// Attributes:
//   device-id           microphone to open (a MediaDeviceInfo.deviceId)
//   echo-cancellation   tri-state; absent leaves the engine default (on)
//   sample-rate         requested capture rate; the hardware may refuse it
//   max-seconds         memory ceiling for one take, NOT a timer — see
//                       resolveRecorderOptions() for the seconds→frames rate
//   auto-export         serialize every finished take and emit webaudio:exported
// Properties: .recorder .take .recording .playing .level
// Methods: start() stop() toggle() · playTake() stopPlayback() togglePlayback()
//          exportTake() downloadTake()
// Events (webaudio:*, {bubbles, composed}):
//   recordingstart                 capture is live — the microphone is open
//   level {level}                  input RMS 0..1, while recording
//   recorded {clip}                the finished take
//   exported {blob, format, clip}  WAV bytes, from `auto-export` or exportTake()
//   error                          engine, playback or presenter failure
// CSS vars: --war-bg --war-fg --war-accent --war-track --war-muted
// ============================================================================

import type {AudioClip} from '../../core';
import {AudioRecorder, type AudioRecorderOptions} from '../headless/recorder';
import {AudioClipPlayer} from '../headless/player';
import type {AudioPlayer} from '../headless/audio-player';
import {AudioPlayerConnection, type AudioPlayerTarget} from './internal/player-connection';
import {clipToBlob, type ClipToWavOptions} from '../api/export';
import {formatTime} from '../core/format';
import {WebMusicElement, boolAttr, defineOnce, numAttr, upgradeProperties} from './internal/base';
import {
  mountRecorder,
  type RecorderBinding,
  type RecorderHandle,
  type RecorderState,
} from '@webmusic/ui/recorder';

/**
 * AudioRecorder's own rate fallback (`sampleRate = 44100` until a context
 * settles it). Anything else here would advertise a default the engine never
 * uses.
 */
const FALLBACK_SAMPLE_RATE = 44_100;

/** The one serialization the audio family ships; `clipToWav` produces it. */
const EXPORT_FORMATS: readonly {id: string; label: string}[] = [{id: 'wav', label: 'WAV'}];

/** Detail of `webaudio:recorded`. */
export interface AudioRecorderRecordedDetail {
  clip: AudioClip;
}

/** Detail of `webaudio:exported`: the take serialized for download or upload. */
export interface AudioRecorderExportedDetail {
  blob: Blob;
  format: 'wav';
  clip: AudioClip;
}

/** Every `webaudio:*` this element emits, so `dispatch` cannot invent a payload. */
interface AudioRecorderEventMap {
  recordingstart: void;
  level: {level: number};
  recorded: AudioRecorderRecordedDetail;
  exported: AudioRecorderExportedDetail;
  error: Error;
}

export class AudioRecorderElement extends WebMusicElement {
  static get observedAttributes(): string[] {
    return ['player', 'device-id', 'echo-cancellation', 'sample-rate', 'max-seconds', 'auto-export'];
  }

  protected root?: ShadowRoot;
  private engine?: AudioRecorder;
  private ui?: RecorderHandle;
  private offFns: Array<() => void> = [];
  private capturing = false;
  private starting = false;
  private currentLevel = 0;
  private lastTake?: AudioClip;
  private takes = 0;
  private captureStartedAt = 0;
  private playback?: AudioClipPlayer;
  private owner?: AudioPlayer;
  private ownerOff: Array<() => void> = [];
  private readonly connection = new AudioPlayerConnection(
    this, (player) => this.attachPlayer(player), (error) => this.onRecorderError(error),
  );
  private playbackOff?: () => void;
  /** Created once and re-appended; a per-render node would accumulate. */
  private compatibilityStyle?: HTMLStyleElement;
  private readonly subscribers = new Set<() => void>();

  protected override onMount(): void {
    // Register rollback before anything can acquire a microphone or a context.
    this.own(() => { this.connection.disconnect(); this.teardown(); });
    upgradeProperties(this, ['player']);
    if (!this.root) this.root = this.attachShadow({mode: 'open'});
    this.mountCurrentUI();
    this.connection.connect();
  }

  attributeChangedCallback(name?: string): void {
    if (name === 'player') this.connection.refresh();
    // No attribute reconfigures a running take: the option bag is read when the
    // next one starts and `auto-export` when it stops. Only the status line,
    // which shows the pending limit, has to catch up.
    if (this.isConnected) this.notifyUI();
  }

  // --- public state ---

  /** Borrow the central player for take audition; microphone ownership stays here. */
  set player(player: AudioPlayerTarget | undefined) {
    this.connection.set(player);
    if (this.isConnected) this.notifyUI();
  }
  get player(): AudioPlayer | undefined { return this.connection.player; }

  /** True from the moment capture goes live until the take is assembled. */
  get recording(): boolean {
    return this.capturing;
  }

  /** Live input RMS, the value `webaudio:level` carries. Zero while idle. */
  get level(): number {
    return this.currentLevel;
  }

  /** The engine behind the take in progress. Borrowed — undefined while idle. */
  get recorder(): AudioRecorder | undefined {
    return this.engine;
  }

  /** The last finished take. Survives a disconnect: it is data, not a resource. */
  get take(): AudioClip | undefined {
    return this.lastTake;
  }

  /** True while the take is playing back. */
  get playing(): boolean {
    return this.owner ? this.owner.clip === this.lastTake && !this.owner.transport && this.owner.playing : this.playback !== undefined;
  }

  // --- recording ---

  /**
   * Open the microphone and begin capture. Resolves once the take is live, or
   * once the failure has been reported as `webaudio:error`.
   */
  async start(): Promise<void> {
    if (this.starting || this.capturing) return;
    this.stopPlayback();
    // A host that stopped the borrowed engine itself leaves it assigned and
    // idle; it is finished either way, so release it before minting the next.
    if (this.engine) this.releaseEngine();
    let recorder: AudioRecorder;
    try {
      recorder = this.createRecorder(this.resolveRecorderOptions());
    } catch (error) {
      // Construction can reject invalid frame budgets before an engine exists.
      // State is already idle, so an error listener can repair options and retry.
      this.onRecorderError(error);
      return;
    }
    this.engine = recorder;
    this.starting = true;
    this.notifyUI();
    try {
      this.subscribeToEngine(recorder);
      await recorder.start();
      // Identity, not a generation counter: every start mints a fresh engine
      // and every teardown clears the field, so a stale permission grant can
      // never match the engine the element is currently driving.
      if (this.engine !== recorder) recorder.dispose();
      else if (!this.isConnected) this.releaseEngine();
    } catch (error) {
      if (this.engine === recorder) {
        this.releaseEngine();
        this.onRecorderError(error);
      }
    } finally {
      if (this.engine === recorder) {
        this.starting = false;
        this.notifyUI();
      }
    }
  }

  /**
   * Stop capture and resolve with the take. `webaudio:recorded` carries the
   * same clip, so a listener-only host never has to await this.
   */
  async stop(): Promise<AudioClip | undefined> {
    const recorder = this.engine;
    if (!recorder) return undefined;
    if (!this.capturing) {
      // Stopping before capture went live cancels the permission request. The
      // engine can only answer that with "not recording", which is not a
      // failure the host asked to hear about.
      this.releaseEngine();
      return undefined;
    }
    try {
      return await recorder.stop();
    } catch (error) {
      if (this.engine === recorder) {
        this.releaseEngine();
        this.onRecorderError(error);
      }
      return undefined;
    } finally {
      if (this.engine === recorder) this.releaseEngine();
    }
  }

  /** Record or stop, whichever the current state calls for — the button's action. */
  async toggle(): Promise<void> {
    if (this.starting) return;
    if (this.capturing) await this.stop();
    else await this.start();
  }

  // --- take playback ---

  /** Play the captured take back. A no-op without a take, or while recording. */
  async playTake(): Promise<void> {
    const clip = this.lastTake;
    if (!clip || this.capturing || this.playing) return;
    const owner = this.owner;
    if (!owner && this.connection.requested) return;
    if (owner) {
      try {
        // The owner pauses a previous group when this explicit audition selects a take.
        owner.setClip(clip);
        await owner.play();
      } catch (error) { if (this.owner === owner) this.onRecorderError(error); }
      if (this.owner === owner) this.notifyUI();
      return;
    }
    const player = new AudioClipPlayer(clip);
    this.playback = player;
    this.playbackOff = player.on('end', () => {
      if (this.playback === player) this.stopPlayback();
    });
    this.notifyUI();
    try {
      await player.play();
    } catch (error) {
      if (this.playback !== player) return;
      this.stopPlayback();
      this.onRecorderError(error);
    }
  }

  /** Stop take playback and release its player. */
  stopPlayback(): void {
    if (this.owner) {
      if (this.owner.clip === this.lastTake && !this.owner.transport) this.owner.stop();
      this.notifyUI();
      return;
    }
    this.releasePlayback();
  }

  private releasePlayback(): void {
    if (!this.playback) return;
    this.playbackOff?.();
    this.playbackOff = undefined;
    this.playback.dispose();
    this.playback = undefined;
    this.notifyUI();
  }

  async togglePlayback(): Promise<void> {
    if (this.playing) this.stopPlayback();
    else await this.playTake();
  }

  // --- export ---

  /**
   * Serialize the take as WAV and announce it as `webaudio:exported`. Returns
   * the blob so a caller can upload it without a listener; `undefined` when
   * there is nothing to export.
   */
  exportTake(options: ClipToWavOptions = {}): Blob | undefined {
    const clip = this.lastTake;
    if (!clip) return undefined;
    const blob = clipToBlob(clip, options);
    this.dispatch('exported', {blob, format: 'wav', clip});
    return blob;
  }

  /** Save the take to disk — what the presenter's ⬇ WAV button does. */
  downloadTake(fileName = 'recording.wav'): void {
    const blob = this.exportTake();
    const document = this.ownerDocument;
    if (!blob || !document) return;
    // An object URL is the only way to hand bytes to the browser's downloader.
    // Where there is none (jsdom, an SSR shim), `webaudio:exported` is the
    // whole result rather than a failure.
    if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return;
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    // Firefox only follows a click on an anchor that is in the document.
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    // Revoking in the same task cancels the download in some browsers.
    setTimeout(() => URL.revokeObjectURL(url), 1_000);
  }

  // --- hooks ---

  /** Replace to configure or subclass the engine (extra constraints, a fake). */
  protected createRecorder(options: AudioRecorderOptions): AudioRecorder {
    return new AudioRecorder(options);
  }

  /**
   * The option bag for the next take. `max-seconds` is the one attribute the
   * engine has no equivalent for: it caps retained FRAMES, so seconds need a
   * rate. In order: the rate the last take actually resolved to (the capture
   * context's own), then the `sample-rate` we are about to request, and finally
   * AudioRecorder's own 44100 fallback — the first take of a page that asks for
   * nothing is therefore budgeted at 44100, whatever the hardware later picks.
   */
  protected resolveRecorderOptions(): AudioRecorderOptions {
    const requestedRate = this.requestedSampleRate;
    const rate = this.lastTake?.sampleRate ?? (requestedRate || FALLBACK_SAMPLE_RATE);
    const deviceId = this.getAttribute('device-id')?.trim();
    const maxSeconds = this.maxSeconds;
    return {
      ...(deviceId ? {deviceId} : {}),
      ...(this.hasAttribute('echo-cancellation')
        ? {echoCancellation: boolAttr(this, 'echo-cancellation', true)}
        : {}),
      ...(requestedRate ? {sampleRate: requestedRate} : {}),
      ...(maxSeconds ? {maxRecordedFrames: Math.max(1, Math.ceil(maxSeconds * rate))} : {}),
    };
  }

  /**
   * Structural UI contract for subclasses that want the stock recorder DOM with
   * different behaviour behind the buttons.
   */
  protected createRecorderBinding(): RecorderBinding {
    return {
      snapshot: () => this.snapshot(),
      toggleRecording: () => this.toggle(),
      togglePlayback: () => this.togglePlayback(),
      export: (format) => {
        if (format === 'wav') this.downloadTake();
      },
      subscribe: (notify) => {
        this.subscribers.add(notify);
        return () => this.subscribers.delete(notify);
      },
    };
  }

  /** Replace this hook to provide a completely custom UI while retaining ownership. */
  protected mountRecorderUI(root: ShadowRoot): RecorderHandle {
    return mountRecorder(root, this.createRecorderBinding(), {
      exportFormats: EXPORT_FORMATS,
      stopPlaybackLabel: 'Stop playback',
      onError: (error) => this.onRecorderError(error),
    });
  }

  /** The single error funnel: engine, take playback and presenter alike. */
  protected onRecorderError(error: unknown): void {
    this.dispatch('error', error instanceof Error ? error : new Error(String(error)));
  }

  protected teardown(): void {
    this.releasePlayback();
    this.releaseEngine();
    this.ui?.destroy();
    this.ui = undefined;
  }

  private attachPlayer(player: AudioPlayer | undefined): void {
    for (const off of this.ownerOff) off();
    this.ownerOff = [];
    this.owner = player;
    if (player) {
      this.releasePlayback();
      const refresh = () => { if (this.owner === player) this.notifyUI(); };
      this.ownerOff = [player.on('sourcechange', refresh), player.on('statechange', refresh), player.on('timeupdate', refresh)];
    }
    this.notifyUI();
  }

  // --- engine wiring ---

  /**
   * Mirror every engine signal for one take. `start`/`stop` are subscribed, not
   * inferred from the promises: a host driving the borrowed `recorder` directly
   * still gets `webaudio:recordingstart`, the take and auto-export.
   */
  private subscribeToEngine(recorder: AudioRecorder): void {
    this.offFns.push(
      recorder.on('start', () => {
        if (this.engine !== recorder) return;
        this.capturing = true;
        this.captureStartedAt = Date.now();
        this.notifyUI();
        this.dispatch('recordingstart', undefined);
      }),
      recorder.on('level', (level) => {
        if (this.engine !== recorder) return;
        this.currentLevel = level;
        this.notifyUI();
        this.dispatch('level', {level});
      }),
      recorder.on('stop', (clip) => {
        if (this.engine !== recorder) return;
        this.acceptTake(clip);
      }),
      recorder.on('error', (error) => {
        if (this.engine !== recorder) return;
        // The engine already released the stream and the context (a breached
        // maxRecordedFrames/Bytes ends capture); mirror that state here.
        this.releaseEngine();
        this.onRecorderError(error);
      }),
    );
  }

  private acceptTake(clip: AudioClip): void {
    this.lastTake = clip;
    this.takes++;
    this.capturing = false;
    this.currentLevel = 0;
    this.notifyUI();
    this.dispatch('recorded', {clip});
    if (!boolAttr(this, 'auto-export')) return;
    try {
      this.exportTake();
    } catch (error) {
      // An unserializable take must not swallow the take itself.
      this.onRecorderError(error);
    }
  }

  private releaseEngine(): void {
    const engine = this.engine;
    const offFns = this.offFns;
    this.offFns = [];
    this.engine = undefined;
    this.capturing = false;
    this.starting = false;
    this.currentLevel = 0;
    for (const off of offFns) off();
    engine?.dispose();
    this.notifyUI();
  }

  // --- attributes ---

  /** `sample-rate` as a positive rate; 0 when absent or unreadable. */
  private get requestedSampleRate(): number {
    return this.hasAttribute('sample-rate') ? numAttr(this, 'sample-rate', 0, 0) : 0;
  }

  /** `max-seconds` as a positive budget; 0 means "engine default limits". */
  private get maxSeconds(): number {
    return numAttr(this, 'max-seconds', 0, 0);
  }

  // --- presentation ---

  private snapshot(): RecorderState {
    const take = this.lastTake;
    const idle = !this.capturing && !this.starting;
    return {
      recording: this.capturing,
      busy: this.starting,
      playing: this.playing,
      // Speech RMS sits well below 1; the bar needs headroom to move at all.
      level: Math.min(1, this.currentLevel * 1.8),
      // The presenter's two counters: seconds captured in the running take,
      // and takes captured since the element was upgraded.
      recordedCount: Math.floor(this.elapsedSeconds()),
      takeCount: this.takes,
      status: this.statusText(),
      canPlay: take !== undefined && idle && (!this.connection.requested || !!this.owner),
      canExport: take !== undefined && idle,
    };
  }

  private statusText(): string {
    if (this.starting) return 'opening microphone…';
    if (this.capturing) return `● recording… ${formatTime(this.elapsedSeconds())}`;
    if (this.playing) return 'playing take…';
    const take = this.lastTake;
    if (take) {
      return `take ${this.takes}: ${formatTime(take.duration)} · ${take.sampleRate / 1_000} kHz`;
    }
    const limit = this.maxSeconds;
    return limit ? `Ready · max ${formatTime(limit)}` : 'Ready';
  }

  private elapsedSeconds(): number {
    return this.capturing ? (Date.now() - this.captureStartedAt) / 1_000 : 0;
  }

  private mountCurrentUI(): void {
    // The ownerDocument guard keeps DOM-free lifecycle harnesses and SSR class
    // declaration tests useful; a real open ShadowRoot always owns a document.
    if (!this.isConnected || !this.root || !('ownerDocument' in this.root)) return;
    this.ui?.destroy();
    this.ui = this.mountRecorderUI(this.root);
    this.appendCompatibilityStyle();
  }

  /**
   * Re-append the ONE compatibility style node. The presenter handle's
   * destroy() only removes the presenter's own nodes, so creating a fresh
   * style per render grew the shadow root without bound.
   */
  private appendCompatibilityStyle(): void {
    if (!this.root?.ownerDocument) return;
    if (!this.compatibilityStyle) {
      this.compatibilityStyle = this.root.ownerDocument.createElement('style');
      this.compatibilityStyle.textContent =
        ':host{display:block;box-sizing:border-box;inline-size:100%;min-inline-size:0;max-inline-size:100%}:host([hidden]){display:none}.wui-recorder{' +
        'box-sizing:border-box;' +
        'background:var(--wm-audio-recorder-surface-background,var(--wm-recorder-surface-background,var(--wm-component-background,var(--war-bg,var(--wm-recorder-background,var(--wm-surface,#fff))))));' +
        'border:var(--wm-audio-recorder-surface-border,var(--wm-recorder-surface-border,var(--wm-component-border,1px solid var(--wm-border,#d8d8d8))));' +
        'padding:var(--wm-audio-recorder-surface-padding,var(--wm-recorder-surface-padding,var(--wm-component-padding,.6rem)));' +
        'border-radius:var(--wm-audio-recorder-surface-radius,var(--wm-recorder-surface-radius,var(--wm-component-radius,var(--wm-control-radius,0))));' +
        'color:var(--war-fg,var(--wm-recorder-text,var(--wm-component-foreground,var(--wm-foreground,#222))));' +
        '--wui-recorder-accent:var(--war-accent,var(--wm-recorder-accent,var(--wm-danger,#c0392b)));' +
        '--wui-recorder-track:var(--war-track,var(--wm-recorder-track,var(--wm-surface-muted,#ddd)));' +
        '--wui-recorder-button-border:var(--war-button-border,var(--wm-recorder-button-border,var(--wm-control-border,var(--wm-border,#d8d8d8))));' +
        '--wui-recorder-muted:var(--war-muted,var(--wm-recorder-muted,var(--wm-component-foreground-muted,var(--wm-foreground-muted,#666))))}';
    }
    this.root.append(this.compatibilityStyle);
  }

  private notifyUI(): void {
    for (const notify of this.subscribers) notify();
  }

  private dispatch<K extends keyof AudioRecorderEventMap>(
    type: K,
    detail: AudioRecorderEventMap[K],
  ): void {
    this.dispatchEvent(
      new CustomEvent<AudioRecorderEventMap[K]>(`webaudio:${type}`, {
        detail,
        bubbles: true,
        composed: true,
      }),
    );
  }
}

/** Register `<audio-recorder>` (or a custom tag). Idempotent, SSR-safe. */
export function defineAudioRecorderElement(tag = 'audio-recorder'): void {
  defineOnce(tag, AudioRecorderElement);
}
