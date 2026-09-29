// ============================================================================
// <audio-meter> — a live RMS level + FFT spectrum tap.
//
// AudioMeterController owns or borrows Web Audio resources. @webmusic/ui owns
// presentation and frame scheduling. This element is the small, inheritable
// browser composition boundary between them.
//
// Attributes: player mode ("level" | "spectrum")  bars  aria-label
//             fft-size  smoothing-time-constant  level-scale  peak-decay
// Legacy CSS vars: --wameter-bg --wameter-track --wameter-fill
//                  --wameter-peak --wameter-height
// Semantic CSS vars: --wm-meter-* --wm-surface --wm-accent --wm-danger
// ============================================================================

import {
  mountMeter,
  type MeterBinding,
  type MeterHandle,
} from '@webmusic/ui/meter';
import {
  AudioMeterController,
  type AudioMeterControllerOptions,
} from '../headless/meter';
import {WebMusicElement, numAttr, upgradeProperties} from './internal/base';

/** Borrowed nonvisual player capability; monitoring never owns its transport. */
export interface AudioMeterPlayer {
  readonly analyser?: AnalyserNode;
  on?(event: 'sourcechange' | 'load', listener: () => void): () => void;
}

type PlayerElement = Element & {
  readonly analyser?: AnalyserNode;
  readonly player?: AudioMeterPlayer;
};

/** Attributes that feed the controller's options rather than the presenter. */
const TUNING_ATTRIBUTES: readonly string[] = [
  'fft-size',
  'smoothing-time-constant',
  'level-scale',
  'peak-decay',
];

export class AudioMeterElement extends WebMusicElement {
  static get observedAttributes(): string[] {
    return ['player', 'mode', 'bars', 'aria-label', ...TUNING_ATTRIBUTES];
  }

  protected root?: ShadowRoot;
  private contextRef?: BaseAudioContext;
  private analyserRef?: AnalyserNode;
  private meter?: AudioMeterController;
  private explicitPlayer?: AudioMeterPlayer;
  private boundPlayer?: AudioMeterPlayer;
  private boundTarget?: PlayerElement;
  private playerAnalyser?: AnalyserNode;
  private playerUnbind: Array<() => void> = [];
  private sourceObserver?: MutationObserver;
  private bindingRevision = 0;
  private refreshingPlayer = false;
  private presenter?: MeterHandle;
  /** Created once and re-appended; a per-mount node would accumulate. */
  private compatibilityStyle?: HTMLStyleElement;

  protected override onMount(): void {
    // Register rollback before lazy-property setters can rebuild resources.
    this.own(() => this.teardown());
    upgradeProperties(this, ['context', 'analyser', 'player']);
    if (!this.root) this.root = this.attachShadow({mode: 'open'});
    if (!this.meter) this.meter = this.buildController();
    this.mountCurrentUI();
    this.bindPlayer();
    this.observePlayerTarget();
  }

  attributeChangedCallback(name?: string): void {
    if (!this.isConnected) return;
    if (name === 'player') {
      this.bindPlayer();
      return;
    }
    if (name === 'aria-label') {
      this.presenter?.updateLabel(this.getAttribute('aria-label') ?? undefined);
      return;
    } else if (name !== undefined && TUNING_ATTRIBUTES.includes(name)) {
      // Keep the caller's pass-through route connected while changing tuning.
      // Supplying defaults also makes removing an attribute restore its default.
      try {
        this.meter?.configure({
          fftSize: 1024, smoothingTimeConstant: 0.8, levelScale: 1.8, peakDecay: 0.012,
          ...this.meterTuning,
        });
      } catch (error) {
        this.onMeterError(error);
      }
      return;
    }
    // What is left — mode and bars — selects the presenter's DOM shape (a level
    // track or a fixed number of spectrum bars), which it builds at mount and
    // cannot restructure in place.
    this.remountUI();
  }

  /** Borrow a player directly; this takes precedence over the `player` selector. */
  set player(player: AudioMeterPlayer | undefined) {
    this.explicitPlayer = player;
    if (player) {
      this.contextRef = undefined;
      this.analyserRef = undefined;
    }
    if (!this.isConnected) this.rebuild();
    this.bindPlayer();
  }
  get player(): AudioMeterPlayer | undefined {
    return this.explicitPlayer ?? this.boundPlayer;
  }

  /** Build a transparent tap on this context (input -> analyser -> output). */
  set context(context: BaseAudioContext | undefined) {
    this.replaceSource(context ? {context} : undefined);
  }
  get context(): BaseAudioContext | undefined {
    return this.contextRef;
  }

  /** Monitor an existing AnalyserNode without owning or disconnecting it. */
  set analyser(analyser: AnalyserNode | undefined) {
    this.replaceSource(analyser ? {analyser} : undefined);
  }
  get analyser(): AnalyserNode | undefined {
    return this.meter?.analyser ?? this.analyserRef ?? this.playerAnalyser;
  }

  /** Input of the context-owned transparent tap. */
  get input(): AudioNode | undefined {
    return this.meter?.input;
  }

  /** Output of the context-owned transparent tap. */
  get output(): AudioNode | undefined {
    return this.meter?.output;
  }

  protected get meterMode(): 'level' | 'spectrum' {
    return this.getAttribute('mode') === 'spectrum' ? 'spectrum' : 'level';
  }

  protected get meterBars(): number {
    return numAttr(this, 'bars', 28, 4);
  }

  /**
   * Analyser and level knobs read from attributes. An absent or unparsable one
   * is omitted so the controller keeps its own default rather than receiving a
   * value this element invented.
   */
  protected get meterTuning(): AudioMeterControllerOptions {
    const fftSize = this.optionalNumber('fft-size', 32, 32_768);
    const smoothingTimeConstant = this.optionalNumber('smoothing-time-constant', 0, 1);
    const levelScale = this.optionalNumber('level-scale', 0);
    const peakDecay = this.optionalNumber('peak-decay', 0);
    return {
      ...(fftSize === undefined ? {} : {fftSize}),
      ...(smoothingTimeConstant === undefined ? {} : {smoothingTimeConstant}),
      ...(levelScale === undefined ? {} : {levelScale}),
      ...(peakDecay === undefined ? {} : {peakDecay}),
    };
  }

  /** Replace this hook to customize analyser configuration or controller type. */
  protected createMeterController(options: AudioMeterControllerOptions): AudioMeterController {
    return new AudioMeterController(options);
  }

  /**
   * Structural UI contract for subclasses that want to retain the stock meter
   * DOM while changing where values come from.
   */
  protected createMeterBinding(controller: AudioMeterController | undefined): MeterBinding {
    return {
      readLevel: () =>
        controller?.readLevel() ?? {rms: 0, peak: 0, peakHold: 0, level: 0},
      readSpectrum: (bars) => controller?.readSpectrum(bars) ?? new Float32Array(bars),
    };
  }

  /** Replace this hook to provide a completely custom UI while retaining ownership. */
  protected mountMeterUI(
    root: ShadowRoot,
    controller: AudioMeterController | undefined,
  ): MeterHandle {
    return mountMeter(root, this.createMeterBinding(controller), {
      mode: this.meterMode,
      bars: this.meterBars,
      label: this.getAttribute('aria-label') ?? undefined,
      animate: controller !== undefined,
      classNames: {
        root: 'wrap',
        track: 'track',
        fill: 'fill',
        peak: 'pk',
        spectrum: 'spectrum',
        bar: 'fbar',
      },
      parts: {root: 'wrap'},
      onError: (error) => this.onMeterError(error),
    });
  }

  /** Presenter read/scheduling failures are observable without breaking its loop. */
  protected onMeterError(error: unknown): void {
    if (typeof CustomEvent !== 'undefined') {
      this.dispatchEvent(
        new CustomEvent('webaudio:error', {
          detail: error,
          bubbles: true,
          composed: true,
        }),
      );
    }
  }

  /** Rebuild the controller for a new audio source, then remount the presenter. */
  protected rebuild(): void {
    // Construct and validate the replacement before disconnecting a usable tap.
    const candidate = this.buildController();
    const previous = this.meter;
    try {
      this.presenter?.destroy();
      this.presenter = undefined;
      this.meter = candidate;
      this.mountCurrentUI();
    } catch (error) {
      try { candidate?.dispose(); } catch { /* preserve replacement failure */ }
      this.meter = previous;
      this.presenter = undefined;
      try { this.mountCurrentUI(); } catch { /* keep the original failure */ }
      throw error;
    }
    try { previous?.dispose(); } catch (error) { this.onMeterError(error); }
  }

  protected teardown(): void {
    this.sourceObserver?.disconnect();
    this.sourceObserver = undefined;
    this.unbindPlayer();
    let firstError: unknown;
    try {
      this.presenter?.destroy();
    } catch (error) {
      firstError ??= error;
    }
    this.presenter = undefined;
    try {
      this.meter?.dispose();
    } catch (error) {
      firstError ??= error;
    }
    this.meter = undefined;
    if (firstError !== undefined) throw firstError;
  }

  private replaceSource(
    source: {context: BaseAudioContext} | {analyser: AnalyserNode} | undefined,
  ): void {
    const previousContext = this.contextRef;
    const previousAnalyser = this.analyserRef;
    if (source && 'context' in source) {
      if (source.context === previousContext && this.meter) return;
      this.contextRef = source.context;
      this.analyserRef = undefined;
    } else if (source && 'analyser' in source) {
      if (source.analyser === previousAnalyser && this.meter) return;
      this.contextRef = undefined;
      this.analyserRef = source.analyser;
    } else {
      this.contextRef = undefined;
      this.analyserRef = undefined;
    }
    try {
      this.rebuild();
      this.bindPlayer();
    } catch (error) {
      this.contextRef = previousContext;
      this.analyserRef = previousAnalyser;
      throw error;
    }
  }

  private buildController(): AudioMeterController | undefined {
    const tuning = this.meterTuning;
    if (this.analyserRef) return this.createMeterController({...tuning, analyser: this.analyserRef});
    if (this.contextRef) return this.createMeterController({...tuning, context: this.contextRef});
    if (this.playerAnalyser) return this.createMeterController({...tuning, analyser: this.playerAnalyser});
    return undefined;
  }

  private resolvePlayerTarget(): PlayerElement | undefined {
    const selector = this.getAttribute('player');
    if (!selector) return undefined;
    try {
      const targets = (this.getRootNode() as ParentNode).querySelectorAll(selector);
      return targets.length === 1 ? targets[0] as PlayerElement : undefined;
    } catch (error) {
      this.onMeterError(error);
      return undefined;
    }
  }

  private bindPlayer(): void {
    const revision = this.unbindPlayer();
    if (revision !== this.bindingRevision || !this.isConnected || this.contextRef || this.analyserRef) return;
    const target = this.explicitPlayer ? undefined : this.resolvePlayerTarget();
    if (revision !== this.bindingRevision) return;
    this.boundTarget = target;
    this.boundPlayer = this.explicitPlayer ?? target?.player ?? target;
    const refresh = (): void => {
      if (revision === this.bindingRevision) this.refreshPlayerAnalyser();
    };
    if (target) {
      for (const name of ['webaudio:sourcechange', 'webaudio:loaded', 'webaudio:playerchange']) {
        target.addEventListener(name, refresh);
        this.playerUnbind.push(() => target.removeEventListener(name, refresh));
      }
      const registry = target.ownerDocument?.defaultView?.customElements;
      if (target.localName.includes('-') && !registry?.get(target.localName)) {
        void registry?.whenDefined(target.localName).then(() => {
          if (revision === this.bindingRevision && this.isConnected) this.bindPlayer();
        });
      }
    } else {
      const player = this.explicitPlayer;
      if (player?.on) {
        for (const event of ['sourcechange', 'load'] as const) {
          if (revision !== this.bindingRevision) break;
          const release = player.on(event, refresh);
          if (revision === this.bindingRevision) this.playerUnbind.push(release);
          else release();
        }
      }
    }
    if (revision === this.bindingRevision) this.refreshPlayerAnalyser();
  }

  private refreshPlayerAnalyser(): void {
    if (this.refreshingPlayer) return;
    const revision = this.bindingRevision;
    this.refreshingPlayer = true;
    try {
      const player = this.explicitPlayer ?? this.boundTarget?.player ?? this.boundTarget;
      const analyser = player?.analyser;
      if (revision !== this.bindingRevision || !this.isConnected) return;
      this.boundPlayer = player;
      if (analyser === this.playerAnalyser && this.meter?.analyser === analyser) return;
      const previous = this.playerAnalyser;
      this.playerAnalyser = analyser;
      try { this.rebuild(); }
      catch (error) { this.playerAnalyser = previous; throw error; }
    } catch (error) {
      this.onMeterError(error);
    } finally {
      this.refreshingPlayer = false;
      if (revision !== this.bindingRevision && this.isConnected) this.refreshPlayerAnalyser();
    }
  }

  private unbindPlayer(): number {
    const revision = ++this.bindingRevision;
    const releases = this.playerUnbind.splice(0);
    this.boundPlayer = undefined;
    this.boundTarget = undefined;
    this.playerAnalyser = undefined;
    const failures: unknown[] = [];
    for (const release of releases) {
      try { release(); } catch (error) { failures.push(error); }
    }
    for (const error of failures) this.onMeterError(error);
    return revision;
  }

  private observePlayerTarget(): void {
    if (typeof MutationObserver === 'undefined') return;
    this.sourceObserver = new MutationObserver(() => {
      if (this.explicitPlayer || this.contextRef || this.analyserRef) return;
      if (this.resolvePlayerTarget() !== this.boundTarget) this.bindPlayer();
    });
    this.sourceObserver.observe(this.getRootNode(), {
      childList: true, subtree: true, attributes: true, attributeFilter: ['id'],
    });
  }

  /** `numAttr` without a fallback: an absent or unparsable value stays absent. */
  private optionalNumber(name: string, min?: number, max?: number): number | undefined {
    const value = numAttr(this, name, Number.NaN, min, max);
    return Number.isFinite(value) ? value : undefined;
  }

  private remountUI(): void {
    this.presenter?.destroy();
    this.presenter = undefined;
    this.mountCurrentUI();
  }

  private mountCurrentUI(): void {
    // The ownerDocument guard keeps DOM-free lifecycle harnesses and SSR class
    // declaration tests useful; a real open ShadowRoot always owns a document.
    if (!this.isConnected || !this.root || !('ownerDocument' in this.root)) return;
    this.presenter = this.mountMeterUI(this.root, this.meter);
    this.appendCompatibilityStyle();
  }

  /**
   * Re-append the ONE compatibility style node, keeping it after the presenter
   * that a remount re-inserts. The presenter handle's destroy() only removes
   * its own nodes, so a fresh style per mount would grow the shadow root
   * without bound.
   */
  private appendCompatibilityStyle(): void {
    if (!this.root?.ownerDocument) return;
    if (!this.compatibilityStyle) {
      this.compatibilityStyle = this.root.ownerDocument.createElement('style');
      this.compatibilityStyle.textContent =
        ':host{display:block}.wui-meter{' +
        'box-sizing:border-box;' +
        'background:var(--wm-audio-meter-surface-background,var(--wm-meter-surface-background,var(--wm-component-background,var(--wm-meter-background,var(--wameter-bg,var(--wm-surface,#fff))))));' +
        'border:var(--wm-audio-meter-surface-border,var(--wm-meter-surface-border,var(--wm-component-border,1px solid var(--wm-border,#d8d8d8))));' +
        'padding:var(--wm-audio-meter-surface-padding,var(--wm-meter-surface-padding,var(--wm-component-padding,.6rem)));' +
        // UIKit reads legacy meter aliases directly; do not shadow inherited
        // --wm-meter-* values with a second set of element-owned defaults.
        'border-radius:var(--wm-audio-meter-surface-radius,var(--wm-meter-surface-radius,var(--wm-component-radius,var(--wm-control-radius,0))))}';
    }
    this.root.append(this.compatibilityStyle);
  }
}

/** Register `<audio-meter>`. Call once in the browser. */
export function defineAudioMeterElement(tag = 'audio-meter'): void {
  if (typeof customElements !== 'undefined' && !customElements.get(tag)) {
    customElements.define(tag, AudioMeterElement);
  }
}
