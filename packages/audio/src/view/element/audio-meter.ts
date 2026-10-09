// ============================================================================
// <audio-meter> — one compact live monitor, seven display types.
//
// AudioMeterController owns or borrows Web Audio resources. AudioMeterDisplay
// reduces its windows into one snapshot per frame. @webmusic/ui's canvas stage
// owns the surface, sizing and frame scheduling; the render painters draw the
// snapshot with a palette resolved from this element's CSS tokens. This
// element is the small, inheritable browser composition boundary between
// them.
//
// Attributes: player type theme size width height mode bars aria-label
//             scale window-seconds timebase-ms trigger loudness-mode
//             reference-dbfs fft-size smoothing-time-constant level-scale
//             peak-decay
// Legacy CSS vars: --wameter-bg --wameter-track --wameter-fill
//                  --wameter-peak --wameter-height
// Semantic CSS vars: --wm-meter-* --wm-audio-meter-* --wm-surface --wm-accent
//                    --wm-danger --wm-foreground --wm-foreground-muted
// ============================================================================

import {
  mountCanvasStage,
  type CanvasStageFrame,
} from '@webmusic/ui/stage';
import type {StatusState} from '@webmusic/ui/status';
import {
  AudioMeterController,
  type AudioMeterControllerOptions,
} from '../headless/meter';
import {
  AUDIO_METER_DISPLAY_TYPES,
  AudioMeterDisplay,
  type AudioMeterDisplayOptions,
  type AudioMeterDisplaySnapshot,
  type AudioMeterDisplayType,
} from '../headless/meter-display';
import {
  createAudioMeterPainter,
  defaultAudioMeterPalette,
  parseCssColor,
  type AudioMeterPainter,
  type AudioMeterPalette,
  type AudioMeterTheme,
} from '../render/meter-display';
import type {AudioCanvasFrame} from '../render/overview';
import {WebMusicElement, cssSizeAttr, numAttr, upgradeProperties} from './internal/base';

/** Borrowed nonvisual player capability; monitoring never owns its transport. */
export interface AudioMeterPlayer {
  readonly analyser?: AnalyserNode;
  on?(event: 'sourcechange' | 'load', listener: () => void): () => void;
}

/** The mounted surface a subclass may replace through `mountMeterUI`. */
export interface AudioMeterSurfaceHandle {
  element: HTMLElement;
  /** Paint one frame now; the default surface also repaints on its own animation frames. */
  redraw(): void;
  /** Rename the surface in place. */
  updateLabel(label: string): void;
  destroy(): void;
}

type PlayerElement = Element & {
  readonly analyser?: AnalyserNode;
  readonly player?: AudioMeterPlayer;
};

/** Attributes that feed the controller's options rather than the display. */
const TUNING_ATTRIBUTES: readonly string[] = [
  'fft-size',
  'smoothing-time-constant',
  'level-scale',
  'peak-decay',
];

/** Attributes that reconfigure the display reduction without a remount. */
const DISPLAY_ATTRIBUTES: readonly string[] = [
  'scale',
  'window-seconds',
  'timebase-ms',
  'trigger',
  'loudness-mode',
  'reference-dbfs',
  'bars',
];

const TYPE_LABELS: Record<AudioMeterDisplayType, string> = {
  vu: 'VU meter',
  loudness: 'Loudness meter',
  waveform: 'Waveform',
  oscilloscope: 'Oscilloscope',
  spectrum: 'Spectrum',
  spectrogram: 'Spectrogram',
  stereometer: 'Stereometer',
};

/** Size presets: each caps the adaptive height at one of the UI kit's surface tiers. */
export type AudioMeterSize = 'sm' | 'md' | 'lg';

const SIZE_CAPS: Record<AudioMeterSize, string> = {
  sm: 'var(--wm-surface-sm, 72px)',
  md: 'var(--wm-surface-md, 144px)',
  lg: 'var(--wm-surface-lg, 216px)',
};

/**
 * Width-to-height ratio each display keeps while its container is narrower
 * than the preset cap allows, so a phone-width meter shrinks with its column
 * instead of keeping a desktop height.
 */
const TYPE_ASPECT: Record<AudioMeterDisplayType, number> = {
  vu: 2.6,
  loudness: 2.2,
  waveform: 4,
  oscilloscope: 4,
  spectrum: 2.6,
  spectrogram: 2.6,
  stereometer: 1.6,
};

/** How long a resolved palette is trusted before the tokens are read again. */
const PALETTE_REFRESH_MS = 500;

export class AudioMeterElement extends WebMusicElement {
  // Listed literally (plus the shared tuning spread) so the documentation
  // parameter catalog can be checked against this exact order.
  static get observedAttributes(): string[] {
    return [
      'player', 'type', 'theme', 'size', 'width', 'height', 'mode', 'bars', 'aria-label',
      'scale', 'window-seconds', 'timebase-ms', 'trigger', 'loudness-mode', 'reference-dbfs',
      ...TUNING_ATTRIBUTES,
    ];
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
  private presenter?: AudioMeterSurfaceHandle;
  private display?: AudioMeterDisplay;
  private painter?: AudioMeterPainter;
  private palette: AudioMeterPalette = defaultAudioMeterPalette();
  private paletteAt = -Infinity;
  private paletteDirty = true;
  private latest?: AudioMeterDisplaySnapshot;
  /** Created once and re-appended; a per-mount node would accumulate. */
  private compatibilityStyle?: HTMLStyleElement;
  /** The framed surface host and its token probe, created once with the style. */
  private frame?: HTMLElement;
  private probe?: HTMLElement;
  /** Whether this element wrote the host's inline width from its `width` attribute. */
  private appliedHostWidth = false;

  protected override onMount(): void {
    // Register rollback before lazy-property setters can rebuild resources.
    this.own(() => this.teardown());
    upgradeProperties(this, ['context', 'analyser', 'player', 'type', 'theme', 'size', 'width', 'height']);
    if (!this.root) this.root = this.attachShadow({mode: 'open'});
    if (!this.meter) this.meter = this.buildController();
    this.display ??= this.createMeterDisplay(this.displayOptions);
    this.painter ??= this.createMeterPainter();
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
      this.presenter?.updateLabel(this.accessibleName);
      return;
    }
    if (name === 'theme') {
      this.paletteDirty = true;
      this.presenter?.redraw();
      return;
    }
    if (name === 'type' || name === 'mode') {
      this.applyDisplayOptions();
      this.applyFrameSize();
      this.presenter?.updateLabel(this.accessibleName);
      this.syncStereo();
      this.presenter?.redraw();
      return;
    }
    if (name === 'size' || name === 'width' || name === 'height') {
      // The stage observes the frame, so a new box repaints on its own.
      this.applyFrameSize();
      return;
    }
    if (name !== undefined && DISPLAY_ATTRIBUTES.includes(name)) {
      this.applyDisplayOptions();
      this.presenter?.redraw();
      return;
    }
    if (name !== undefined && TUNING_ATTRIBUTES.includes(name)) {
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
      this.applyDisplayOptions();
      return;
    }
    this.presenter?.redraw();
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

  /** Selected display type; reflects the `type` attribute. */
  get type(): AudioMeterDisplayType {
    return this.meterType;
  }
  set type(value: AudioMeterDisplayType) {
    this.setAttribute('type', value);
  }

  /** Selected palette; reflects the `theme` attribute. */
  get theme(): AudioMeterTheme {
    return this.getAttribute('theme') === 'color' ? 'color' : 'mono';
  }
  set theme(value: AudioMeterTheme) {
    this.setAttribute('theme', value);
  }

  /** Size preset; reflects the `size` attribute. Unknown values read as `md`. */
  get size(): AudioMeterSize {
    const raw = this.getAttribute('size');
    return raw === 'sm' || raw === 'lg' ? raw : 'md';
  }
  set size(value: AudioMeterSize) {
    this.setAttribute('size', value);
  }

  /** Explicit host width as a CSS length (a bare number is pixels); `undefined` is fluid. */
  get width(): string | undefined {
    return cssSizeAttr(this, 'width');
  }
  set width(value: string | number | undefined) {
    if (value === undefined || value === null || value === '') this.removeAttribute('width');
    else this.setAttribute('width', String(value));
  }

  /** Explicit frame height as a CSS length (a bare number is pixels); `undefined` is adaptive. */
  get height(): string | undefined {
    return cssSizeAttr(this, 'height');
  }
  set height(value: string | number | undefined) {
    if (value === undefined || value === null || value === '') this.removeAttribute('height');
    else this.setAttribute('height', String(value));
  }

  /** The most recently painted reduction, for readouts and tests. */
  get snapshot(): AudioMeterDisplaySnapshot | undefined {
    return this.latest;
  }

  /** `type` wins; a legacy `mode` maps level to the VU dial and spectrum to the spectrum. */
  protected get meterType(): AudioMeterDisplayType {
    const type = this.getAttribute('type');
    if (type && (AUDIO_METER_DISPLAY_TYPES as readonly string[]).includes(type)) return type as AudioMeterDisplayType;
    return this.getAttribute('mode') === 'spectrum' ? 'spectrum' : 'vu';
  }

  protected get meterBars(): number {
    return numAttr(this, 'bars', 0, 0);
  }

  /** Display reduction options read from attributes. */
  protected get displayOptions(): AudioMeterDisplayOptions {
    const trigger = this.getAttribute('trigger');
    const scale = this.getAttribute('scale');
    const loudnessMode = this.getAttribute('loudness-mode');
    const gain = this.optionalNumber('level-scale', 0);
    const peakDecay = this.optionalNumber('peak-decay', 0);
    return {
      type: this.meterType,
      scale: scale === 'mel' || scale === 'linear' ? scale : 'log',
      windowSeconds: numAttr(this, 'window-seconds', 4, 0.5),
      timebaseMs: numAttr(this, 'timebase-ms', 20, 0.1),
      trigger: trigger === 'off' ? 'off' : 'rising',
      loudnessMode: loudnessMode === 'short-term' || loudnessMode === 'rms-fast' || loudnessMode === 'rms-slow'
        ? loudnessMode : 'momentary',
      referenceDbfs: numAttr(this, 'reference-dbfs', -18),
      bars: this.meterBars,
      gain: gain ?? 1.8,
      peakDecay: peakDecay ?? 0.012,
    };
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

  /** Replace this hook to change how analyser windows are reduced per type. */
  protected createMeterDisplay(options: AudioMeterDisplayOptions): AudioMeterDisplay {
    return new AudioMeterDisplay(options);
  }

  /** Replace this hook to draw the stock snapshots differently. */
  protected createMeterPainter(): AudioMeterPainter {
    return createAudioMeterPainter();
  }

  /**
   * Replace this hook to provide a completely custom surface while retaining
   * ownership. The default mounts the UI kit's canvas stage and paints every
   * animation frame through {@link paintMeterFrame}.
   */
  protected mountMeterUI(
    host: HTMLElement,
    controller: AudioMeterController | undefined,
  ): AudioMeterSurfaceHandle {
    void controller;
    const stage = mountCanvasStage(
      host,
      {
        draw: (frame) => this.paintMeterFrame(frame),
        status: () => this.meterStatus(),
      },
      {
        label: this.accessibleName,
        animate: true,
        fallbackWidth: 320,
        fallbackHeight: 96,
        classNames: {root: 'wrap'},
        parts: {root: 'wrap'},
        onError: (error) => this.onMeterError(error),
      },
    );
    return {
      element: stage.element,
      redraw: () => stage.redraw(),
      updateLabel: (label) => stage.element.setAttribute('aria-label', label),
      destroy: () => stage.destroy(),
    };
  }

  /** Capture the current window and paint it. Called once per presenter frame. */
  protected paintMeterFrame(frame: CanvasStageFrame | AudioCanvasFrame): void {
    const controller = this.meter;
    const display = this.display;
    const painter = this.painter;
    if (!controller?.analyser || !display || !painter) {
      this.latest = undefined;
      return;
    }
    const time = 'time' in frame && Number.isFinite(frame.time) ? frame.time : nowMs();
    this.refreshPalette(time);
    const snapshot = display.capture(controller, time);
    this.latest = snapshot;
    painter.paint(frame, snapshot, this.palette);
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
      this.display?.clear();
      this.latest = undefined;
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
    this.display?.clear();
    this.latest = undefined;
    if (firstError !== undefined) throw firstError;
  }

  private get accessibleName(): string {
    return this.getAttribute('aria-label') ?? TYPE_LABELS[this.meterType];
  }

  private meterStatus(): StatusState {
    if (!this.meter?.analyser) return {kind: 'empty', message: 'No audio source'};
    return {kind: 'ready'};
  }

  private applyDisplayOptions(): void {
    try {
      this.display?.configure(this.displayOptions);
    } catch (error) {
      this.onMeterError(error);
    }
  }

  /** Attach the stereo branch for the types that read it; release it otherwise. */
  private syncStereo(): void {
    const controller = this.meter;
    if (!controller) return;
    try {
      if (this.display?.wantsStereo && controller.analyser) controller.attachStereo();
      else controller.releaseStereo();
    } catch (error) {
      this.onMeterError(error);
    }
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

  private mountCurrentUI(): void {
    // The ownerDocument guard keeps DOM-free lifecycle harnesses and SSR class
    // declaration tests useful; a real open ShadowRoot always owns a document.
    if (!this.isConnected || !this.root || !('ownerDocument' in this.root)) return;
    // The branch belongs to the controller being shown, so it is settled
    // before the stage's first synchronous paint reads it.
    this.syncStereo();
    this.ensureFrame();
    this.applyFrameSize();
    this.paletteDirty = true;
    this.presenter = this.mountMeterUI(this.frame!, this.meter);
  }

  /**
   * Create the ONE framed host, its token probe and the compatibility style
   * node, then (re)append them. The stage mounts inside the frame, so a
   * remount replaces the surface without growing the shadow root.
   */
  private ensureFrame(): void {
    const root = this.root;
    if (!root?.ownerDocument) return;
    const document = root.ownerDocument;
    if (!this.compatibilityStyle) {
      this.compatibilityStyle = document.createElement('style');
      this.compatibilityStyle.textContent =
        ':host{display:block;box-sizing:border-box;max-width:100%;min-width:0}' +
        // Adaptive box: fluid width; the height follows the width at the
        // type's aspect ratio until the preset cap, unless a height token or
        // the height attribute fixes it. The same token chain feeds both
        // `height` and `max-height`, so a fixed height is never capped.
        '.frame{' +
        'box-sizing:border-box;position:relative;display:block;width:100%;min-width:0;overflow:hidden;' +
        'aspect-ratio:var(--wui-meter-aspect,3);' +
        'height:var(--wm-audio-meter-height,var(--wm-meter-height,var(--wameter-height,var(--wui-meter-height,auto))));' +
        'max-height:var(--wm-audio-meter-height,var(--wm-meter-height,var(--wameter-height,var(--wui-meter-max-height,none))));' +
        'min-height:var(--wm-audio-meter-min-height,var(--wm-meter-min-height,3rem));' +
        'background:var(--wm-audio-meter-surface-background,var(--wm-meter-surface-background,var(--wm-component-background,var(--wm-meter-background,var(--wameter-bg,var(--wm-surface,#fff))))));' +
        'border:var(--wm-audio-meter-surface-border,var(--wm-meter-surface-border,var(--wm-component-border,1px solid var(--wm-border,#d8d8d8))));' +
        'padding:var(--wm-audio-meter-surface-padding,var(--wm-meter-surface-padding,var(--wm-component-padding,.6rem)));' +
        // UIKit reads legacy meter aliases directly; do not shadow inherited
        // --wm-meter-* values with a second set of element-owned defaults.
        'border-radius:var(--wm-audio-meter-surface-radius,var(--wm-meter-surface-radius,var(--wm-component-radius,var(--wm-control-radius,0))));' +
        // The stage inside the frame is the drawing viewport, not a second card.
        '--wm-stage-surface-background:transparent;--wm-stage-surface-border:0;--wm-stage-surface-padding:0;--wm-stage-surface-radius:0;' +
        '--wm-stage-background:transparent;--wm-stage-border:0;--wm-stage-radius:0}' +
        // Token probe: the painters read these resolved colours. Legacy
        // aliases keep precedence exactly as the retired presenter gave them.
        '.palette{position:absolute;inset:0 auto auto 0;width:0;height:0;overflow:hidden;visibility:hidden;pointer-events:none;' +
        'color:var(--wameter-fill, var(--wm-meter-fill, var(--wm-accent, var(--wm-foreground, #111))));' +
        'border-color:var(--wameter-track, var(--wm-meter-track, var(--wm-surface-muted, #e4e4e4)));' +
        'outline-color:var(--wameter-peak, var(--wm-meter-peak, var(--wm-danger, #e0445b)));' +
        'caret-color:var(--wm-meter-muted, var(--wm-foreground-muted, #777));' +
        'column-rule-color:var(--wm-meter-warning, var(--wm-warning, #dea028));' +
        'font-family:var(--wm-font-mono, ui-monospace, monospace)}';
    }
    if (!this.frame) {
      this.frame = document.createElement('div');
      this.frame.className = 'frame';
      this.frame.setAttribute('part', 'frame');
      this.probe = document.createElement('span');
      this.probe.className = 'palette';
      this.probe.setAttribute('aria-hidden', 'true');
    }
    root.append(this.compatibilityStyle, this.frame);
    // The probe is a sibling of the stage inside the frame; the stage never
    // clears its host, so it survives remounts.
    if (this.probe && this.probe.parentNode !== this.frame) this.frame.append(this.probe);
  }

  /**
   * Write the box the attributes ask for: the type's aspect ratio, the preset
   * cap or the explicit height, and the explicit width on the host. Only a
   * width this element wrote is ever removed again, so an author's own inline
   * width survives.
   */
  private applyFrameSize(): void {
    const frame = this.frame;
    if (frame) {
      frame.style.setProperty('--wui-meter-aspect', String(TYPE_ASPECT[this.meterType]));
      const height = this.height;
      if (height !== undefined) {
        frame.style.setProperty('--wui-meter-height', height);
        frame.style.setProperty('--wui-meter-max-height', height);
      } else {
        frame.style.removeProperty('--wui-meter-height');
        frame.style.setProperty('--wui-meter-max-height', SIZE_CAPS[this.size]);
      }
    }
    const width = this.width;
    if (width !== undefined) {
      this.style.setProperty('width', width);
      this.appliedHostWidth = true;
    } else if (this.appliedHostWidth) {
      this.style.removeProperty('width');
      this.appliedHostWidth = false;
    }
  }

  /** Re-read the tokens at most every half second, or when the theme changed. */
  private refreshPalette(time: number): void {
    if (!this.paletteDirty && time - this.paletteAt < PALETTE_REFRESH_MS) return;
    this.paletteDirty = false;
    this.paletteAt = time;
    this.palette = this.resolvePalette();
  }

  private resolvePalette(): AudioMeterPalette {
    const palette = defaultAudioMeterPalette(this.theme);
    const probe = this.probe;
    const frame = this.frame;
    const view = this.ownerDocument?.defaultView;
    if (!probe || !frame || !view?.getComputedStyle) return palette;
    let computed: CSSStyleDeclaration;
    let frameStyle: CSSStyleDeclaration;
    try {
      computed = view.getComputedStyle(probe);
      frameStyle = view.getComputedStyle(frame);
    } catch {
      return palette;
    }
    const ink = parseCssColor(computed.color);
    if (ink && ink.alpha > 0) palette.ink = ink.rgb;
    const grid = parseCssColor(computed.borderTopColor || computed.borderColor);
    if (grid && grid.alpha > 0) palette.grid = grid.rgb;
    const danger = parseCssColor(computed.outlineColor);
    if (danger && danger.alpha > 0) palette.danger = danger.rgb;
    const muted = parseCssColor(computed.caretColor);
    if (muted && muted.alpha > 0) palette.muted = muted.rgb;
    const warning = parseCssColor(computed.columnRuleColor);
    if (warning && warning.alpha > 0) palette.warning = warning.rgb;
    if (computed.fontFamily && !computed.fontFamily.includes('var(')) palette.fontFamily = computed.fontFamily;
    const background = parseCssColor(frameStyle.backgroundColor);
    if (background && background.alpha > 0) {
      palette.background = background.rgb;
    } else {
      // A transparent surface shows the page; choose the end of the ramp that
      // contrasts with the ink so quiet cells still disappear into it.
      const luminance = (0.2126 * palette.ink[0] + 0.7152 * palette.ink[1] + 0.0722 * palette.ink[2]) / 255;
      palette.background = luminance > 0.5 ? [24, 24, 24] : [255, 255, 255];
    }
    return palette;
  }
}

function nowMs(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

/** Register `<audio-meter>`. Call once in the browser. */
export function defineAudioMeterElement(tag = 'audio-meter'): void {
  if (typeof customElements !== 'undefined' && !customElements.get(tag)) {
    customElements.define(tag, AudioMeterElement);
  }
}
