// ============================================================================
// <audio-live-view> — a scrolling projection of a live AnalyserNode. The
// newest column is at the right edge and history slides left.
//
// This is the capability's missing cardinality: every other surface here needs
// data that already exists (a decoded clip, a peaks pyramid, a precomputed
// spectrogram). The only live path was `<audio-view type="meter">`, which is
// instantaneous — it has no time axis at all, so nothing could show what the
// microphone did a second ago.
//
// One element, two drawings, exactly as <audio-view> keeps waveform and
// spectrogram under one `type`: both are "append one column per frame and
// scroll", differing only in how a column is painted.
//
// Attributes: type source window-seconds height wave-color color-map
// Properties: .analyser
// Events: none — this element only draws what it is given.
//
// There is deliberately no dB-range attribute: the window a byte frequency
// frame is scaled into belongs to the analyser's own minDecibels/maxDecibels,
// and the analyser here is BORROWED. Writing to it would silently change what
// every other reader of the same tap sees.
// ============================================================================

import {
  createLiveViewController,
  type LiveProjectionType,
  type LiveViewController,
} from '../headless/live';
import {paintLiveProjection} from '../render/live';
import {
  HTMLElementBase,
  cssSizeAttr,
  defineOnce,
  numAttr,
  upgradeProperties,
} from './internal/base';
import {applyAudioPresenterSurface, prepareAudioViewHost} from './internal/surface';
import {mountCanvasStage, type CanvasStageHandle} from '@webmusic/ui/stage';
import type {StatusState} from '@webmusic/ui/status';
import {observeElementTarget} from '@webmusic/kernel/element';

/** Which drawing the live columns get. */
export type LiveViewType = LiveProjectionType;

const TYPES: ReadonlySet<string> = new Set(['waveform', 'spectrogram'] satisfies LiveViewType[]);

/** Anything that can hand over a live analyser. */
interface AnalyserSource extends Element {
  loading?: boolean;
  loadError?: Error;
  analyser?: AnalyserNode;
  inputAnalyser?: AnalyserNode;
  recorder?: {inputAnalyser?: AnalyserNode};
  player?: {analyser?: AnalyserNode};
}

/**
 * `<audio-live-view>` — draw what is being heard right now.
 *
 * ```html
 * <audio-recorder id="rec"></audio-recorder>
 * <audio-live-view source="#rec" type="waveform" window-seconds="4"></audio-live-view>
 * ```
 *
 * Point `source` at anything exposing an `AnalyserNode` — the recorder, a
 * player, an `<audio-meter>` — or assign `.analyser` directly. The node is
 * **borrowed**: this element never creates, mutates or disposes it, so several
 * views can read the same tap.
 */
export class AudioLiveViewElement extends HTMLElementBase {
  static get observedAttributes(): string[] {
    return ['type', 'source', 'window-seconds', 'height', 'wave-color', 'color-map'];
  }

  private explicitAnalyser?: AnalyserNode;
  private boundAnalyser?: AnalyserNode;
  private readonly controller: LiveViewController = createLiveViewController();
  private presenter?: CanvasStageHandle;
  private sourceTarget?: AnalyserSource;
  private sourceLoading = false;
  private sourceError?: Error;
  private stopSourceObservation?: () => void;
  private detachSource?: () => void;

  connectedCallback(): void {
    upgradeProperties(this, ['analyser', 'source']);
    this.controller.setType(this.type);
    this.controller.setWindowSeconds(this.windowSeconds);
    this.mountPresenter();
    this.resolveSource();
  }

  disconnectedCallback(): void {
    this.stopSourceObservation?.();
    this.stopSourceObservation = undefined;
    this.detachSource?.();
    this.detachSource = undefined;
    this.sourceTarget = undefined;
    this.boundAnalyser = undefined;
    this.presenter?.destroy();
    this.presenter = undefined;
    this.controller.clear();
  }

  attributeChangedCallback(name?: string, previous?: string | null, next?: string | null): void {
    if (!this.isConnected || previous === next) return;
    if (name === 'source') {
      this.resolveSource();
    } else if (name === 'type') {
      this.controller.setType(this.type);
      this.presenter?.update();
    } else if (name === 'window-seconds') {
      this.controller.setWindowSeconds(this.windowSeconds);
      this.presenter?.update();
    } else if (name === 'height') {
      this.applySize();
      this.presenter?.update();
    } else {
      this.presenter?.redraw();
    }
  }

  /** Which drawing the columns get. Defaults to `waveform`. */
  get type(): LiveViewType {
    const raw = this.getAttribute('type');
    return raw != null && TYPES.has(raw) ? (raw as LiveViewType) : 'waveform';
  }

  set type(type: LiveViewType) {
    this.setAttribute('type', type);
  }

  /** How much history the strip holds. Defaults to 5 seconds. */
  get windowSeconds(): number {
    return Math.max(0.5, numAttr(this, 'window-seconds', 5));
  }

  /** Borrow an analyser directly (overrides `source`). Never disposed here. */
  set analyser(analyser: AnalyserNode | undefined) {
    this.explicitAnalyser = analyser;
    this.refreshSource();
  }

  get analyser(): AnalyserNode | undefined {
    return this.explicitAnalyser ?? this.boundAnalyser;
  }

  /** True while a source is connected and columns are arriving. */
  get live(): boolean {
    return this.analyser !== undefined;
  }

  // --- wiring ---

  private resolveSource(): void {
    this.stopSourceObservation?.();
    this.stopSourceObservation = undefined;
    this.detachSource?.();
    this.detachSource = undefined;
    this.sourceTarget = undefined;
    this.sourceError = undefined;
    const selector = this.getAttribute('source');
    if (!selector) { this.refreshSource(); return; }
    this.stopSourceObservation = observeElementTarget(this, selector, (element, state) => {
      this.detachSource?.();
      this.detachSource = undefined;
      this.sourceTarget = element as AnalyserSource | undefined;
      this.sourceError = state === 'invalid' ? new Error('Invalid source selector')
        : state === 'ambiguous' ? new Error('Source selector matches multiple elements') : undefined;
      const target = this.sourceTarget;
      if (target) {
        const refresh = (event: Event) => { if (event.target === target) this.refreshSource(); };
        const events = ['webaudio:loadstatechange', 'webaudio:sourcechange', 'webaudio:playerchange',
          'webaudio:loaded', 'webaudio:statechange', 'webaudio:recordingstart', 'webaudio:recorded'];
        for (const name of events) target.addEventListener(name, refresh);
        this.detachSource = () => { for (const name of events) target.removeEventListener(name, refresh); };
      }
      this.refreshSource();
    });
  }

  private refreshSource(): void {
    this.boundAnalyser = undefined;
    this.sourceLoading = false;
    const target = this.sourceTarget;
    if (target && !this.explicitAnalyser) {
      try {
        this.sourceLoading = target.loading === true;
        this.sourceError = target.loadError;
        if (!this.sourceLoading && !this.sourceError) {
          this.boundAnalyser = target.analyser ?? target.inputAnalyser ??
            target.recorder?.inputAnalyser ?? target.player?.analyser;
        }
      } catch (error) {
        this.sourceError = error instanceof Error ? error : new Error(String(error));
        this.dispatchError(this.sourceError);
      }
    }
    this.controller.setAnalyser(this.analyser);
    this.presenter?.update();
  }

  private applySize(): void {
    const host = this as unknown as HTMLElement;
    prepareAudioViewHost(host);
    host.style.setProperty('height', cssSizeAttr(this, 'height') ?? '4rem');
  }

  private mountPresenter(): void {
    this.applySize();
    this.presenter?.destroy();
    this.presenter = mountCanvasStage(
      this,
      {
        draw: (frame) => {
          this.controller.capture(frame.time);
          paintLiveProjection(frame, this.controller.buffer, this.type, {
            waveColor: this.getAttribute('wave-color') ?? 'currentColor',
            colorMap: this.getAttribute('color-map') ?? undefined,
          });
        },
        status: () => this.status(),
      },
      {
        label: this.getAttribute('aria-label') ?? 'Live audio',
        animate: true,
        fallbackWidth: 320,
        fallbackHeight: numericSize(this.getAttribute('height'), 64),
        onError: (error) => this.dispatchError(error),
      },
    );
    applyAudioPresenterSurface(
      this as unknown as HTMLElement,
      this.presenter.element,
      'audio-live-view',
      'stage',
    );
  }

  private status(): StatusState {
    if (!this.explicitAnalyser && this.sourceLoading) return {kind: 'loading', message: 'Loading audio source'};
    if (!this.explicitAnalyser && this.sourceError) return {kind: 'error', message: this.sourceError.message};
    if (!this.analyser) {
      return {kind: 'waiting', message: 'Waiting for a live audio source'};
    }
    return this.controller.buffer?.length
      ? {kind: 'ready'}
      : {kind: 'waiting', message: 'Waiting for a live audio frame'};
  }

  private dispatchError(error: unknown): void {
    const normalized = error instanceof Error ? error : new Error(String(error));
    this.dispatchEvent(
      new CustomEvent('webaudio:error', {
        detail: {error: normalized},
        bubbles: true,
        composed: true,
      }),
    );
  }
}

function numericSize(value: string | null, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/** Register `<audio-live-view>` (or a custom tag). Idempotent, SSR-safe. */
export function defineAudioLiveViewElement(tag = 'audio-live-view'): void {
  defineOnce(tag, AudioLiveViewElement);
}
