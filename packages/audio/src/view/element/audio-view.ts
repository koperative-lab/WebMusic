// ============================================================================
// <audio-view> — the single @webmusic/audio/view visualization element.
//
// The `type` attribute picks the drawing (`waveform` by default, `spectrogram`,
// `meter`); switching it at runtime disposes the old visualizer and re-renders.
//
//   <audio-player id="p" src="song.mp3"></audio-player>
//   <audio-view player="#p" type="waveform" pixels-per-second="100" interactive></audio-view>
//   <audio-view player="#p" type="spectrogram" color-map="magma" min-freq="20" max-freq="16000"></audio-view>
//   <audio-view player="#p" type="meter"></audio-view>
//   <audio-view peaks-src="song.json" annotate></audio-view>
//
// Data comes from properties (`.peaks` / `.spectrogram` / `.frequencyData` /
// `.clip` / `.regions` / `.options`) or from a URL: `src` decodes audio, while
// `peaks-src` reads BBC audiowaveform v2 JSON and decodes NOTHING. Binding to
// an `<audio-player>` borrows structural live state/time and DOM events,
// so binding does not require @webmusic/audio/play; only the `src` loader
// resolves `@webmusic/audio/play/api` dynamically.
//
// Geometry — zoom, offset and the visible window — lives in ONE headless
// AudioTimeline the element owns, kept in step with what the renderer actually
// painted through its `onViewportChange`. `zoom`, `visibleRange()`, `panTo()`
// all read the same numbers the surface is drawn from, and nothing here
// re-derives them.
//
// Methods: visibleRange() panTo(startSeconds) setZoom(pixelsPerSecond)
// Events (webaudio:*, all `{bubbles, composed}`):
//   seek {seconds, region?}    a pointer click on an `interactive` surface, or
//                              its Arrow/Home/End keyboard equivalent. A bound
//                              player's own transport announces its seeks
//                              itself — this element never re-emits those.
//   regionchange {regions}     an `annotate` drag created a region; `regions`
//                              is the element's whole list, not just the new one
//   viewportchange {startSeconds, endSeconds}
//                              the visible window moved: user pan/zoom and
//                              programmatic panTo()/setZoom() alike
//   error {error}              a `src` / `peaks-src` load or a render failed
// ============================================================================

import {
  Region,
  createRegion,
  peaksFromWaveformData,
  type AudioClip,
  type AudioFormat,
  type AudioPeaks,
  type WaveformDataJSON,
  isAudioClipEditorPort,
  type AudioClipEditorPort,
  type AudioInteractionSession,
  type AudioDocumentPlaybackBinding,
  type AudioPlaybackSourceSnapshot,
} from '../../core';
import {observeElementSource, observeElementTarget} from '@webmusic/kernel/element';
import {createAudioViewEditing, audioDocumentPlaybackCompatible, type AudioViewEditing} from '../headless/audio-editing';
import {mountWaveformEditor, type WaveformEditingHandle} from '../render/waveform-editor';
import {renderWaveformVisualizer} from '../render/waveform';
import {renderSpectrogramVisualizer} from '../render/spectrogram-view';
import {renderLoudnessMeter} from '../render/meter';
import {bindPlayerToWaveform} from '../render/binding';
import {createAudioTimeline, type AudioTimeline} from '../headless/timeline';
import {computeClipPeaks, peaksDuration} from '../headless/peaks';
import type {
  AudioViewport,
  MeterRenderOptions,
  ViewPlayerBinding,
  RenderedAudioVisualizer,
  SpectrogramData,
  SpectrogramRenderOptions,
  WaveformRenderOptions,
} from '../core/types';
import {
  WebMusicElement,
  boolAttr,
  defineOnce,
  numAttr,
  upgradeProperties,
} from './internal/base';
import {applyAudioPresenterSurface, prepareAudioViewHost} from './internal/surface';
import {
  mountStage,
  mountSurfaceSlider,
  type StageHandle,
  type SurfaceSliderHandle,
} from '@webmusic/ui/stage';
import {mountStatus, type StatusHandle} from '@webmusic/ui/status';

/** The union of option bags `<audio-view>` accepts across its three types. */
export type AudioViewOptions = WaveformRenderOptions & SpectrogramRenderOptions & MeterRenderOptions;

/** The visualization a `<audio-view>` draws. */
export type AudioViewType = 'waveform' | 'spectrogram' | 'meter';

/** Pointer behavior; seeking modes require `interactive`. */
export type AudioViewDragMode = 'seek' | 'scrub' | 'pan' | 'none';

/** `timeupdate` detail dispatched by `<audio-player>`. */
interface TimeUpdateDetail {
  seconds: number;
  duration: number;
  progress?: number;
}

/** Optional playback-owned scratch capability; View never creates an audio graph. */
interface BoundScratchSession {
  readonly active: boolean;
  moveToSeconds(seconds: number, audible?: boolean): void;
  end(resume?: boolean): void | Promise<void>;
}

interface BoundPlayerFacade {
  readonly player?: BoundPlayerFacade;
  readonly clip?: AudioClip;
  readonly analyser?: AnalyserNode;
  readonly seconds?: number;
  readonly currentTime?: number;
  readonly duration?: number;
  readonly playing?: boolean;
  readonly scratching?: boolean;
  readonly documentBinding?: AudioDocumentPlaybackBinding;
  readonly source?: AudioPlaybackSourceSnapshot;
  seek?(seconds: number): void;
  beginScratch?(): BoundScratchSession | undefined;
}

/** Scale the renderers draw at when nothing asks for another one. */
const DEFAULT_PIXELS_PER_SECOND = 100;

/** Public properties that may have been assigned before the upgrade. */
const PROPS = [
  'clip',
  'peaks',
  'spectrogram',
  'frequencyData',
  'regions',
  'options',
  'type',
  'zoom',
  'interactive',
  'dragMode',
  'annotate',
  'follow',
  'scrollable',
  'editor',
  'editable',
  'interactionSession',
] as const;

// Numeric attributes mirrored onto the renderer options bag (all NaN-safe).
const NUMERIC_OPTION_ATTRS: ReadonlyArray<readonly [attr: string, key: string]> = [
  ['pixels-per-second', 'pixelsPerSecond'], // horizontal zoom (waveform / spectrogram)
  ['height', 'height'], // surface height in CSS px
  ['amplitude', 'amplitude'], // waveform vertical gain
  ['device-pixel-ratio', 'devicePixelRatio'], // render resolution override
  ['min-freq', 'minFreq'], // spectrogram band, Hz
  ['max-freq', 'maxFreq'],
  ['min-db', 'minDb'], // spectrogram colour-mapping dB range
  ['max-db', 'maxDb'],
  ['bars', 'bars'], // meter spectrum bar count
  ['bands', 'bands'], // waveform multi-band colour band count
  ['history', 'historyTrail'], // waveform recent-history glow window (seconds)
];

// String attributes mirrored onto the renderer options bag.
const STRING_OPTION_ATTRS: ReadonlyArray<readonly [attr: string, key: string]> = [
  ['wave-color', 'waveColor'], // waveform fill
  ['progress-color', 'progressColor'], // played portion, left of the playhead
  ['playhead-color', 'playheadColor'], // playhead line
  ['background-color', 'backgroundColor'], // surface background
  ['color-map', 'colorMap'], // spectrogram colormap name
  ['color-mode', 'colorMode'], // waveform colouring: static | multiband | colormap
  ['channel-layout', 'channelLayout'], // waveform: merge | split (stacked stereo)
  ['color', 'color'], // meter bar colour
  ['peak-color', 'peakColor'], // meter peak-hold colour
  ['mode', 'mode'], // meter mode: level | spectrum
];

/**
 * Attributes that only change how the current data is painted. None of them
 * can change WHICH data the element holds, so none of them needs the stage
 * rebuilt — see {@link AudioViewElement.applyOptionsInPlace}. `pixels-per-second`
 * is handled before this set: it has a cheaper live-zoom path of its own.
 */
const IN_PLACE_OPTION_ATTRS: ReadonlySet<string> = new Set([
  ...NUMERIC_OPTION_ATTRS.map(([attr]) => attr),
  ...STRING_OPTION_ATTRS.map(([attr]) => attr),
  'scrollable',
  'virtualization',
]);

/** What the element is waiting for, per type — never a silent blank surface. */
const EMPTY_STATE_MESSAGES: Readonly<Record<AudioViewType, string>> = {
  waveform: 'No audio to draw — assign .clip or .peaks',
  spectrogram: 'No spectrogram to draw — assign .spectrogram',
  meter: 'No analyser to meter — bind a player with an analyser',
};

/** Accessible names for a view that is displayed rather than operated. */
const DISPLAY_LABELS: Readonly<Record<AudioViewType, string>> = {
  waveform: 'Audio waveform',
  spectrogram: 'Audio spectrogram',
  meter: 'Audio level meter',
};

/** The accessible name of a seekable (interactive) time-axis view. */
const SEEK_LABEL = 'Audio position';

const NO_REGIONS: readonly Region[] = Object.freeze([]);

const AUDIO_FORMATS = new Set<AudioFormat>([
  'wav',
  'aiff',
  'mp3',
  'flac',
  'ogg',
  'opus',
  'm4a',
  'aac',
  'webm',
]);

function audioFormatAttr(raw: string | null): AudioFormat | undefined {
  const value = raw?.trim().toLowerCase();
  if (!value) return undefined;
  if (AUDIO_FORMATS.has(value as AudioFormat)) return value as AudioFormat;
  throw new Error(`Unsupported audio format "${value}".`);
}

/**
 * Seconds of audio a peaks pyramid covers. It is the only duration a
 * `peaks-src` view has: nothing decoded the audio, so there is no clip to ask.
 */
export class AudioViewElement extends WebMusicElement {
  static get observedAttributes(): string[] {
    return [
      'src',
      'peaks-src',
      'format',
      'type',
      'player',
      'editor',
      'editable',
      'interactive',
      'drag-mode',
      'annotate',
      'follow',
      'scrollable',
      'virtualization',
      'width',
      ...NUMERIC_OPTION_ATTRS.map(([attr]) => attr),
      ...STRING_OPTION_ATTRS.map(([attr]) => attr),
    ];
  }

  private explicitClip?: AudioClip;
  private sourceClip?: AudioClip;
  private explicitPeaks?: AudioPeaks;
  private sourcePeaks?: AudioPeaks;
  private explicitSpectrogram?: SpectrogramData;
  private explicitFrequencyData?: SpectrogramData | readonly SpectrogramData[];
  private explicitRegions?: readonly Region[];
  private explicitOptions?: AudioViewOptions;
  private explicitEditor?: AudioClipEditorPort;
  private explicitInteractionSession?: AudioInteractionSession;
  private editing?: AudioViewEditing;
  private editorSurface?: WaveformEditingHandle;
  private editorCleanup?: () => void;
  private editorStateCleanup?: () => void;
  private editorGeneration = 0;
  private editorResolutionRevision = 0;

  private rendered?: RenderedAudioVisualizer;
  private renderedClip?: AudioClip;
  private renderedDuration = 0;
  private host?: HTMLElement;
  private surfaceSlider?: SurfaceSliderHandle;
  private trackGesture?: {
    zoom: number;
    seconds: number;
    offset: number;
    pending?: number;
    last?: number;
    scratch?: BoundScratchSession;
  };
  /** A released gesture remains borrowed until playback-owned inertia settles. */
  private releasedScratch?: {session: BoundScratchSession; cleanup(): void};
  private dragFrame = 0;
  private seekRevision = 0;
  private viewportUnsubscribe?: () => void;
  private boundPlayer?: EventTarget;
  private playerUnbind?: () => void;
  private playerTargetCleanup?: () => void;
  private playerTargetGeneration = 0;
  private vizBinding?: {unsubscribe(): void};
  private bindingRevision = 0;
  private presentationRevision = 0;
  private derivedClip?: AudioClip;
  private derivedPeaks?: AudioPeaks;
  private sourceToken = 0;
  private sourceAbort?: AbortController;
  private peaksToken = 0;
  private peaksAbort?: AbortController;
  private pendingLoads = 0;
  private assignedRole?: string;
  private assignedAriaLabel?: string;
  private stage?: StageHandle;
  private status?: StatusHandle;
  private timelineInstance?: AudioTimeline;
  private updatingOptionsInPlace = false;
  private pendingOptionsInPlace = false;
  /** The last window announced, so a repaint is never mistaken for a pan. */
  private announcedRange?: AudioViewport;

  protected override onMount(): void {
    // Register rollback before the property upgrade below can build a stage.
    this.own(() => this.teardown());
    prepareAudioViewHost(this);
    upgradeProperties(this, PROPS);
    this.applyWidth();
    this.bindPlayer();
    this.updateEditable();
    if (this.hasEditorIntent()) { this.bindEditor(); return; }
    if (this.hasAttribute('peaks-src') && !this.explicitPeaks) void this.loadPeaksSource();
    if (this.hasAttribute('src') && !this.explicitClip) void this.loadSource();
    else this.refresh();
  }

  attributeChangedCallback(name: string, previous: string | null, next: string | null): void {
    // A write that changes nothing — a framework re-applying its props, or
    // `setAttribute(name, getAttribute(name))` — must not cost a rebuild.
    if (!this.isConnected || previous === next) return;
    if (name === 'editor') { this.bindEditor(); return; }
    if (name === 'editable') { this.updateEditable(); this.refresh(); return; }
    if (name === 'player') {
      this.bindPlayer();
      this.refresh();
      return;
    }
    if (name === 'src' || name === 'format') {
      if (this.hasEditorIntent()) { this.bindEditor(); return; }
      void this.loadSource();
      return;
    }
    if (name === 'peaks-src') {
      if (this.hasEditorIntent()) { this.bindEditor(); return; }
      void this.loadPeaksSource();
      return;
    }
    if (name === 'width') {
      this.applyWidth();
      return;
    }
    // Recompose gesture ownership without rebuilding the data or canvas.
    if (name === 'follow' || name === 'annotate' || name === 'interactive' || name === 'drag-mode') {
      if (name === 'annotate' && this.hasEditorIntent()) this.updateEditable();
      this.configureAccessibility();
      this.bindVisualizer();
      return;
    }
    // Live zoom: re-scale the existing surface in place (keeps scroll position
    // and playhead) instead of tearing the canvas down and rebuilding it.
    if (name === 'pixels-per-second' && this.rendered && this.type !== 'meter') {
      const pps = numAttr(this, 'pixels-per-second', Number.NaN);
      if (Number.isFinite(pps) && pps > 0) {
        this.applyZoom(pps);
        return;
      }
    }
    if (IN_PLACE_OPTION_ATTRS.has(name)) {
      this.applyOptionsInPlace();
      return;
    }
    this.refresh();
  }

  /** Reflect the `width` attribute onto the element's own inline width. */
  private applyWidth(): void {
    const raw = this.getAttribute('width')?.trim();
    this.style.width = !raw ? '' : /^\d+(\.\d+)?$/.test(raw) ? `${raw}px` : raw;
  }

  // ---- Public properties ----

  /** Borrowed document owner. Undefined restores the editor selector. */
  set editor(value: AudioClipEditorPort | undefined) {
    if (value !== undefined && !isAudioClipEditorPort(value)) throw new TypeError('editor must implement AudioClipEditorPort');
    if (value !== undefined && this.hasIndependentSource()) throw new Error('source-conflict: An editor cannot be combined with independent audio sources');
    if (value && this.explicitInteractionSession && this.explicitInteractionSession.getSnapshot().documentId !== value.getSnapshot().documentId) throw new Error('The interaction session belongs to another document');
    if (this.explicitEditor === value) return;
    this.explicitEditor = value;
    if (this.isConnected) this.bindEditor();
  }
  get editor(): AudioClipEditorPort | undefined { return this.editing?.editor ?? this.explicitEditor; }
  get editable(): boolean { return boolAttr(this, 'editable', false); }
  set editable(value: boolean) { this.setAttribute('editable', value ? 'true' : 'false'); }
  set interactionSession(value: AudioInteractionSession | undefined) {
    if (value && this.editor && value.getSnapshot().documentId !== this.editor.getSnapshot().documentId) throw new Error('The interaction session belongs to another document');
    if (value === this.explicitInteractionSession) return;
    this.explicitInteractionSession = value;
    if (this.isConnected) this.bindEditor();
  }
  get interactionSession(): AudioInteractionSession | undefined { return this.editing?.session ?? this.explicitInteractionSession; }

  set clip(clip: AudioClip | undefined) {
    this.assertIndependentSource(clip);
    if (clip && clip === this.explicitClip) return;
    if (clip) {
      this.cancelClipLoad();
      this.sourceClip = undefined;
    }
    this.explicitClip = clip;
    this.invalidateDerivedPeaks();
    if (this.isConnected) {
      if (this.hasEditorIntent()) { this.bindEditor(); return; }
      if (!clip && this.hasAttribute('src')) void this.loadSource();
      else this.refresh();
    }
  }
  get clip(): AudioClip | undefined {
    return this.explicitClip;
  }

  set peaks(peaks: AudioPeaks | undefined) {
    this.assertIndependentSource(peaks);
    this.explicitPeaks = peaks;
    if (this.isConnected) { if (this.hasEditorIntent()) this.bindEditor(); else this.refresh(); }
  }
  get peaks(): AudioPeaks | undefined {
    return this.explicitPeaks ?? this.sourcePeaks;
  }

  set spectrogram(spectrogram: SpectrogramData | undefined) {
    this.assertIndependentSource(spectrogram);
    this.explicitSpectrogram = spectrogram;
    if (this.isConnected) { if (this.hasEditorIntent()) this.bindEditor(); else this.refresh(); }
  }
  get spectrogram(): SpectrogramData | undefined {
    return this.explicitSpectrogram;
  }

  /**
   * STFT data driving the waveform's frequency-aware colour modes
   * (`color-mode="multiband"` / `"colormap"`). An array colours a `split`
   * stereo display per channel. Falls back to `.spectrogram`, which is the
   * same payload seen from the other type's point of view.
   */
  set frequencyData(data: SpectrogramData | readonly SpectrogramData[] | undefined) {
    this.assertIndependentSource(data);
    this.explicitFrequencyData = data;
    if (this.isConnected) { if (this.hasEditorIntent()) this.bindEditor(); else this.refresh(); }
  }
  get frequencyData(): SpectrogramData | readonly SpectrogramData[] | undefined {
    return this.explicitFrequencyData;
  }

  set regions(regions: readonly Region[] | undefined) {
    this.explicitRegions = regions;
    const current = this.baseRegions();
    this.timeline.setRegions(current);
    this.rendered?.setRegions(this.withElementRegionSkin(current));
    // The drag binding accumulates only the regions IT created, on top of the
    // list it was bound with. A replaced list has to rebind, or the next drag
    // would re-add the regions this assignment just dropped.
    if (this.annotate && this.isConnected) this.bindVisualizer();
  }
  get regions(): readonly Region[] | undefined {
    return this.explicitRegions;
  }

  set options(options: AudioViewOptions | undefined) {
    this.explicitOptions = options;
    if (this.isConnected) this.refresh();
  }
  get options(): AudioViewOptions | undefined {
    return this.explicitOptions;
  }

  /** Reflects the `type` attribute; unknown values fall back to `waveform`. */
  get type(): AudioViewType {
    const raw = this.getAttribute('type');
    return raw === 'spectrogram' || raw === 'meter' ? raw : 'waveform';
  }
  set type(type: AudioViewType) {
    this.setAttribute('type', type);
  }

  /**
   * The horizontal scale the surface is actually drawn at, in pixels per
   * second: the `pixels-per-second` attribute, else `.options.pixelsPerSecond`,
   * else the renderers' own default. It never reports 0 for a view that is
   * being drawn — a zoom control reading it would otherwise start from a scale
   * nothing uses.
   */
  get zoom(): number {
    const fromAttribute = numAttr(this, 'pixels-per-second', Number.NaN);
    if (Number.isFinite(fromAttribute) && fromAttribute > 0) return fromAttribute;
    const fromOptions = this.explicitOptions?.pixelsPerSecond;
    if (fromOptions !== undefined && Number.isFinite(fromOptions) && fromOptions > 0) {
      return fromOptions;
    }
    return DEFAULT_PIXELS_PER_SECOND;
  }
  set zoom(pixelsPerSecond: number) {
    this.setZoom(pixelsPerSecond);
  }

  /**
   * Re-zoom the waveform / spectrogram in place — keeps the scroll position and
   * playhead, unlike a re-render. Reflects `pixels-per-second`, so it is the
   * smooth path for a live zoom control.
   */
  setZoom(pixelsPerSecond: number): void {
    if (!(Number.isFinite(pixelsPerSecond) && pixelsPerSecond > 0)) return;
    this.setAttribute('pixels-per-second', String(pixelsPerSecond));
  }

  /**
   * Whether pointer and keyboard input seek the view. Tri-state like `follow`
   * and `scrollable`: absent → off, present → on unless explicitly negated
   * (`interactive="false"`).
   */
  get interactive(): boolean {
    return boolAttr(this, 'interactive', false);
  }
  set interactive(on: boolean) {
    this.setAttribute('interactive', on ? 'true' : 'false');
  }

  /** Track dragging is opt-in; `seek` retains the original position slider. */
  get dragMode(): AudioViewDragMode {
    const value = this.getAttribute('drag-mode');
    return value === 'scrub' || value === 'pan' || value === 'none' ? value : 'seek';
  }
  set dragMode(mode: AudioViewDragMode) {
    this.setAttribute('drag-mode', mode);
  }

  /**
   * Whether dragging across the surface creates a region. Each drag emits
   * `webaudio:regionchange` with the element's WHOLE region list — the ones it
   * already had plus the new one. Editing existing regions is deliberately not
   * part of this contract.
   */
  get annotate(): boolean {
    return boolAttr(this, 'annotate', false);
  }
  set annotate(on: boolean) {
    this.setAttribute('annotate', on ? 'true' : 'false');
  }

  /**
   * Whether the playhead auto-follows playback (the view scrolls to keep it
   * centred). Reflects the `follow` attribute; defaults to `interactive`, so
   * `interactive` views follow by default but can opt out with `follow="false"`.
   */
  get follow(): boolean {
    return boolAttr(this, 'follow', this.interactive);
  }
  set follow(on: boolean) {
    this.setAttribute('follow', on ? 'true' : 'false');
  }

  /**
   * Whether the user can pan the waveform horizontally (scrollbar / wheel /
   * drag). Reflects the `scrollable` attribute; defaults to `true`. When off the
   * surface is locked, but programmatic `follow` can still move it.
   */
  get scrollable(): boolean {
    return boolAttr(this, 'scrollable', true);
  }
  set scrollable(on: boolean) {
    this.setAttribute('scrollable', on ? 'true' : 'false');
  }

  // ---- Timeline / viewport ----

  /**
   * The element's geometry model. Replace this hook to seed a subclass's own
   * timeline (a fixed window, a shared one); everything zoom-, offset- and
   * window-shaped in this element reads and writes exactly this object.
   */
  protected createTimeline(): AudioTimeline {
    return createAudioTimeline({
      durationSeconds: this.resolveDuration(),
      pixelsPerSecond: this.zoom,
    });
  }

  /**
   * Built on first use and kept for the element's whole life: a disconnect must
   * not cost the window the user was looking at, and `zoom` / `visibleRange()`
   * are readable before the first mount.
   */
  private get timeline(): AudioTimeline {
    return (this.timelineInstance ??= this.createTimeline());
  }

  /**
   * The window the surface currently paints, in seconds — `undefined` when it
   * paints no time axis at all (nothing rendered, a meter, or no duration yet).
   * Consumers can use this to display the visible window.
   */
  visibleRange(): AudioViewport | undefined {
    if (!this.rendered || this.type === 'meter') return undefined;
    if (!(this.resolveDuration() > 0)) return undefined;
    return this.timeline.visibleRange();
  }

  /**
   * Scroll so the visible window starts at `startSeconds`, clamped to the clip.
   * The counterpart of {@link visibleRange}: a "jump to chorus" button can
   * drive this view through this method.
   */
  panTo(startSeconds: number): void {
    if (!Number.isFinite(startSeconds) || this.centeredPlayhead()) return;
    const start = Math.max(0, startSeconds);
    this.timeline.setOffset(start * this.zoom);
    // The renderer is the surface of record: it clamps against its own content
    // and reports back through onViewportChange, which re-seats the timeline.
    this.rendered?.setOffset?.(start);
    this.announceViewport();
    if (this.dragMode === 'pan') this.surfaceSlider?.update();
  }

  /** Live re-scale: the renderer keeps its DOM, the timeline keeps the window. */
  private applyZoom(pixelsPerSecond: number): void {
    this.surfaceSlider?.cancelGesture();
    // Final-release callbacks can reenter after UIKit released its pointer.
    this.cancelTrackGesture();
    this.timeline.setZoom(pixelsPerSecond);
    this.rendered?.setZoom(pixelsPerSecond);
    this.announceViewport();
  }

  /** Seat the timeline on the window the renderer actually painted. */
  private adoptViewport(viewport: AudioViewport, announce: boolean): void {
    const pixelsPerSecond = this.zoom;
    const width = Math.max(0, viewport.endSeconds - viewport.startSeconds) * pixelsPerSecond;
    this.timeline.setViewport(width);
    this.timeline.setOffset(Math.max(0, viewport.startSeconds) * pixelsPerSecond);
    if (this.dragMode === 'pan') this.surfaceSlider?.update();
    if (announce) this.announceViewport();
    // A first paint is not a pan: record it so the next real move is the first
    // event a listener sees.
    else this.announcedRange = this.timeline.visibleRange();
  }

  /** Tell listeners the window moved — once per distinct window. */
  private announceViewport(): void {
    const range = this.visibleRange();
    if (!range) return;
    const previous = this.announcedRange;
    if (
      previous &&
      previous.startSeconds === range.startSeconds &&
      previous.endSeconds === range.endSeconds
    ) {
      return;
    }
    this.announcedRange = range;
    this.dispatchEvent(
      new CustomEvent('webaudio:viewportchange', {detail: range, bubbles: true, composed: true}),
    );
  }

  /** Read the window back off the renderer and announce it if it moved. */
  private syncViewportFromRenderer(): void {
    const viewport = this.rendered?.viewport?.();
    if (viewport) this.adoptViewport(viewport, true);
  }

  /** Re-seat the timeline on a freshly rendered surface and follow its window. */
  private syncTimeline(): void {
    this.timeline.setDuration(this.resolveDuration());
    this.timeline.setPlayhead(this.currentSeconds());
    this.timeline.setZoom(this.zoom);
    this.timeline.setRegions(this.baseRegions());
    const rendered = this.rendered;
    if (!rendered) return;
    const viewport = rendered.viewport?.();
    if (viewport) this.adoptViewport(viewport, false);
    // Pan and zoom performed by the user (scrollbar, wheel) surface only here;
    // without this subscription the timeline would drift the moment anyone
    // touched the scrollbar.
    this.viewportUnsubscribe = rendered.onViewportChange?.((next) =>
      this.adoptViewport(next, true),
    );
  }

  // ---- Rendering ----

  private teardown(): void {
    this.cancelClipLoad();
    this.cancelPeaksLoad();
    this.playerTargetGeneration++; this.playerTargetCleanup?.(); this.playerTargetCleanup = undefined;
    this.unbindPlayer();
    const generation = this.unbindEditor();
    if (generation !== this.editorGeneration) return;
    const revision = this.teardownRendered();
    if (generation !== this.editorGeneration || revision !== this.presentationRevision) return;
    this.stage?.destroy();
    this.stage = undefined;
  }

  private teardownRendered(): number {
    const revision = ++this.presentationRevision;
    this.bindingRevision++;
    const slider = this.surfaceSlider, viewport = this.viewportUnsubscribe;
    const binding = this.vizBinding, rendered = this.rendered, status = this.status;
    this.surfaceSlider = undefined;
    this.viewportUnsubscribe = undefined;
    this.vizBinding = undefined;
    this.rendered = undefined;
    this.editorSurface = undefined;
    this.renderedClip = undefined;
    this.renderedDuration = 0;
    this.status = undefined;
    this.host = undefined;
    // Cancellation can synchronously attach a newer editor or presentation.
    // Release only the captured lifetime, never fields installed by callbacks.
    const failures: unknown[] = [];
    for (const cleanup of [() => slider?.destroy(), () => viewport?.(), () => binding?.unsubscribe(),
      () => rendered?.dispose(), () => status?.destroy()]) {
      try { cleanup(); } catch (error) { failures.push(error); }
    }
    if (revision === this.presentationRevision) this.configureAccessibility();
    for (const error of failures.slice(1)) console.error('[WebAudio] Audio View presentation cleanup failed', error);
    if (failures.length) throw failures[0];
    return revision;
  }

  private invalidateDerivedPeaks(): void {
    this.derivedClip = undefined;
    this.derivedPeaks = undefined;
  }

  private resolveClip(): AudioClip | undefined {
    if (this.hasEditorIntent()) return undefined;
    if (this.explicitClip) return this.explicitClip;
    if (this.sourceClip) return this.sourceClip;
    // A wrapped player's resolved data takes precedence over a wrapper's old
    // authored clip. Explicit View data remains the standalone override above.
    return this.playerFacade()?.clip ?? (this.boundPlayer as BoundPlayerFacade | undefined)?.clip;
  }

  private resolvePeaks(): AudioPeaks | undefined {
    // Precomputed peaks first — that is the whole point of `peaks-src`: a view
    // that never decodes audio.
    if (this.explicitPeaks) return this.explicitPeaks;
    if (this.sourcePeaks) return this.sourcePeaks;
    const clip = this.resolveClip();
    if (!clip) return undefined;
    if (this.derivedClip !== clip) {
      this.derivedClip = clip;
      this.derivedPeaks = computeClipPeaks(clip);
    }
    return this.derivedPeaks;
  }

  /**
   * `virtualization` as an attribute: absent keeps the renderer default (on), a
   * number overrides the buffer-screens window, anything else reads as the same
   * tri-state boolean every other flag here uses.
   */
  private virtualizationAttr(): boolean | {bufferScreens: number} | undefined {
    const raw = this.getAttribute('virtualization');
    if (raw == null) return undefined;
    const bufferScreens = Number(raw.trim());
    if (raw.trim() !== '' && Number.isFinite(bufferScreens) && bufferScreens >= 0) {
      return {bufferScreens};
    }
    return boolAttr(this, 'virtualization', true);
  }

  /**
   * The option bag handed to the renderer. Replace this hook to add or override
   * options without re-implementing the attribute mirroring.
   */
  protected renderOptions(): AudioViewOptions {
    const opts: Record<string, unknown> = {};
    for (const [attr, key] of NUMERIC_OPTION_ATTRS) {
      if (this.getAttribute(attr) == null) continue;
      const value = numAttr(this, attr, Number.NaN);
      if (Number.isFinite(value)) opts[key] = value;
    }
    for (const [attr, key] of STRING_OPTION_ATTRS) {
      const value = this.getAttribute(attr);
      if (value != null && value !== '') opts[key] = value;
    }
    opts.scrollable = this.scrollable;
    const virtualization = this.virtualizationAttr();
    if (virtualization !== undefined) opts.virtualization = virtualization;
    const regions = this.baseRegions();
    if (regions.length > 0) opts.regions = this.withElementRegionSkin(regions);
    const duration = this.resolveDuration();
    if (duration > 0) opts.durationSeconds = duration;
    // Element defaults follow the shared semantic palette. The renderers resolve
    // these paint tokens against their surface, retaining caller theme changes.
    // Meter fill/background stay with its neutral presenter defaults.
    const skin: Partial<AudioViewOptions> =
      this.type === 'meter'
        ? {peakColor: 'var(--wm-meter-peak, var(--wm-danger, #c0392b))'}
        : this.type === 'waveform'
          ? {
              waveColor: 'var(--wm-waveform, #999)',
              progressColor: 'var(--wm-waveform-progress, var(--wm-foreground, #444))',
              playheadColor: 'var(--wm-playhead, #c0392b)',
            }
          : {playheadColor: 'var(--wm-playhead, #c0392b)'};
    // Explicit `.options` (a property bag) wins over the attributes.
    return {
      ...skin, ...opts, ...this.explicitOptions,
      // The gesture contract owns its anchor, including the silent clip edges.
      playheadMode: this.centeredPlayhead() ? 'center' : 'position',
    } as AudioViewOptions;
  }

  /**
   * The element's current regions: an explicit `.regions` assignment, else the
   * ones the clip carries. One list, used for drawing, for hit-testing and as
   * the seed `annotate` merges new drags onto.
   */
  private baseRegions(): readonly Region[] {
    return this.explicitRegions ?? this.resolveClip()?.regions ?? NO_REGIONS;
  }

  private withElementRegionSkin(regions: readonly Region[]): readonly Region[] {
    const defaultColor =
      this.type === 'spectrogram' ? 'rgba(255,255,255,0.7)' : 'rgba(0, 0, 0, 0.12)';
    return regions.map((region) =>
      region.color ? region : new Region({...region.toJSON(), color: defaultColor}),
    );
  }

  private refresh(): void {
    if (!this.stage) {
      this.stage = mountStage(
        this,
        {render: (surface) => this.renderStage(surface)},
        {label: 'Audio visualization', onError: (error) => this.onViewError(error)},
      );
      applyAudioPresenterSurface(this, this.stage.element, 'audio-view', 'stage');
    } else {
      this.stage.update();
    }
  }

  /**
   * Draw one pass into the stage surface. Replace this hook to render another
   * visualization while keeping the element's stage, binding and accessibility.
   */
  protected renderStage(host: HTMLElement): void {
    const generation = this.editorGeneration;
    const revision = this.teardownRendered();
    if (generation !== this.editorGeneration || revision !== this.presentationRevision) return;
    host.style.width = '100%';
    this.host = host;

    if (this.hasEditorIntent()) {
      this.updateEditable();
      if (!this.editing?.state.available) return this.renderUnavailable(host, this.getAttribute('data-editor-state') === 'source-conflict' ? 'Editor conflicts with an independent audio source' : 'Audio editor unavailable');
      if (this.type !== 'waveform') return this.renderUnavailable(host, 'Sequence documents support waveform views. Render explicit audio before using a clip-only view.');
      this.editorSurface = mountWaveformEditor(host, this.editing, {...this.renderOptions(),
        onPreview: (result) => this.dispatchEvent(new CustomEvent('webaudio:editpreview', {detail: result, bubbles: true, composed: true})),
        onCommit: (result) => this.dispatchEvent(new CustomEvent('webaudio:editcommit', {detail: result, bubbles: true, composed: true})),
        onError: (error) => this.dispatchEvent(new CustomEvent('webaudio:editerror', {detail: {error}, bubbles: true, composed: true})),
      });
      this.rendered = this.editorSurface;
      this.renderedDuration = this.resolveDuration();
      this.syncTimeline(); this.configureAccessibility(); this.updateDocumentPlayback(); this.bindVisualizer();
      return;
    }
    if (this.editable) return this.renderUnavailable(host, 'Editing requires a ready audio editor');
    if (this.playerFacade()?.source?.kind === 'sequence' && !this.explicitClip && !this.sourceClip && !this.explicitPeaks && !this.sourcePeaks && this.type !== 'meter') {
      return this.renderUnavailable(host, 'This player contains a sequence. Bind the same editor for its waveform, or supply explicitly rendered audio.');
    }

    const options = this.renderOptions();
    this.renderedClip = this.resolveClip();
    this.renderedDuration = this.resolveDuration();
    switch (this.type) {
      case 'spectrogram': {
        if (!this.explicitSpectrogram) return this.renderEmpty(host);
        this.rendered = renderSpectrogramVisualizer(host, this.explicitSpectrogram, options);
        break;
      }
      case 'meter': {
        const analyser = this.resolveAnalyser();
        if (!analyser) return this.renderEmpty(host);
        this.rendered = renderLoudnessMeter(host, analyser, options);
        // A meter has no time axis — no playhead, no seek, no viewport — but it
        // is still a thing on the page that needs a name.
        this.configureAccessibility();
        return;
      }
      default: {
        const peaks = this.resolvePeaks();
        if (!peaks) return this.renderEmpty(host);
        // The waveform tints by frequency (color-mode multiband/colormap) from
        // `.frequencyData`, computed from the same channel as `.peaks`.
        this.rendered = renderWaveformVisualizer(host, peaks, {
          ...options,
          // `.options.frequencyData` (e.g. a per-channel array for a split
          // stereo view) wins, then the `.frequencyData` property, and last the
          // single `.spectrogram` — the same payload, seen from the other type.
          frequencyData:
            options.frequencyData ?? this.explicitFrequencyData ?? this.explicitSpectrogram,
        });
        break;
      }
    }
    this.syncTimeline();
    this.configureAccessibility();
    this.bindVisualizer();
  }

  /**
   * Say what is missing instead of leaving a blank box. Nothing is disposed or
   * latched here, so assigning the missing data and refreshing draws normally.
   */
  private renderEmpty(host: HTMLElement): void {
    this.status = mountStatus(
      host,
      {snapshot: () => ({kind: 'empty', message: EMPTY_STATE_MESSAGES[this.type]})},
      {classNames: {root: 'wui-status--embedded'}},
    );
    this.configureAccessibility();
  }

  private renderUnavailable(host: HTMLElement, message: string): void {
    this.status = mountStatus(host, {snapshot: () => ({kind: 'empty', message})}, {classNames: {root: 'wui-status--embedded'}});
    this.configureAccessibility();
  }

  /**
   * Re-draw with new options without disturbing the stage.
   *
   * The renderers bake colour, height and gain into the canvas they build, so
   * there is no "set colour" call to make: in place means rebuilding the
   * visualizer into the SAME stage surface and putting the window and playhead
   * back. What survives is everything a full refresh() destroys — the surface
   * node and anything mounted beside it, and the element's scroll position.
   */
  private applyOptionsInPlace(): void {
    if (this.updatingOptionsInPlace) {
      this.pendingOptionsInPlace = true;
      return;
    }
    const host = this.host;
    if (!host || !this.rendered) {
      this.refresh();
      return;
    }
    // Stage.update() clears the surface's children. This path deliberately
    // retains caller content beside the visualizer, so it needs its own
    // bounded re-entry loop around renderStage() instead of using Stage's.
    this.updatingOptionsInPlace = true;
    let passes = 0;
    try {
      do {
        this.pendingOptionsInPlace = false;
        try {
          const range = this.visibleRange();
          const {playheadSeconds} = this.timeline.snapshot;
          const announced = this.announcedRange;
          const generation = this.editorGeneration, revision = this.presentationRevision + 1;
          this.renderStage(host);
          if (generation !== this.editorGeneration || revision !== this.presentationRevision || this.host !== host) return;
          // Only the paint changed, so restore what was already announced:
          // putting the window back must not look like an external pan.
          this.announcedRange = announced;
          if (range) this.panTo(range.startSeconds);
          if (playheadSeconds > 0) this.rendered?.redraw(playheadSeconds, false);
        } catch (error) {
          this.reportInPlaceError(error);
          return;
        }
        passes++;
      } while (this.pendingOptionsInPlace && this.isConnected && this.host === host && passes < 32);
      if (this.pendingOptionsInPlace && this.isConnected && this.host === host) {
        this.reportInPlaceError(new Error('AudioView in-place update did not stabilize after 32 passes'));
      }
    } finally {
      this.pendingOptionsInPlace = false;
      this.updatingOptionsInPlace = false;
    }
  }

  private reportInPlaceError(error: unknown): void {
    // Match Stage's contained error sink: a consumer's throwing or async
    // reporter cannot escape the attribute change that caused the repaint.
    try {
      void Promise.resolve(this.onViewError(error)).catch(() => {});
    } catch {
      /* keep the original render failure contained */
    }
  }

  /** Resolve an AnalyserNode for the meter from the bound player, if any. */
  private resolveAnalyser(): AnalyserNode | undefined {
    return this.playerFacade()?.analyser;
  }

  // ---- Player binding (player="#id"), structural live observation + events ----

  private bindPlayer(): void {
    const generation = ++this.playerTargetGeneration;
    this.playerTargetCleanup?.(); this.playerTargetCleanup = undefined;
    const selector = this.getAttribute('player');
    if (!selector) { this.connectPlayer(undefined); this.updateDocumentPlayback(); return; }
    let initial = true;
    const cleanup = observeElementTarget(this, selector, (target, state) => {
      if (generation !== this.playerTargetGeneration || !this.isConnected) return;
      const changed = target !== this.boundPlayer;
      this.connectPlayer(state === 'ready' ? target : undefined);
      this.updateDocumentPlayback();
      if (state === 'invalid') this.onViewError(new Error('Invalid player selector'));
      if (!initial && changed && !this.hasEditorIntent()) this.refresh();
    });
    initial = false;
    if (generation === this.playerTargetGeneration) this.playerTargetCleanup = cleanup; else cleanup();
  }

  private connectPlayer(target: EventTarget | undefined): void {
    if (target === this.boundPlayer) return;
    this.unbindPlayer();
    this.boundPlayer = target;
    if (target) {
      const onSourceChange = (): void => {
        if (this.hasEditorIntent()) { this.updateDocumentPlayback(); this.bindVisualizer(); return; }
        // Immutable clip identity invalidates the derived cache in resolvePeaks.
        // A new player using the same clip must not copy/rescan all PCM again.
        if (this.isConnected) this.refresh();
      };
      const onLoaded = (): void => {
        if (!this.isConnected) return;
        if (this.hasEditorIntent()) { this.updateDocumentPlayback(); this.bindVisualizer(); return; }
        if (!this.rendered || this.type === 'meter' ||
            this.resolveClip() !== this.renderedClip ||
            this.resolveDuration() !== this.renderedDuration) {
          this.refresh();
        } else {
          // Graph readiness changes the available transport, not immutable data.
          // Keep the painted window/focus and bind the current player in place.
          this.bindVisualizer();
          const seconds = this.currentSeconds();
          this.timeline.setPlayhead(seconds);
          this.rendered?.redraw(seconds, false);
          this.surfaceSlider?.update();
        }
      };
      target.addEventListener('webaudio:loaded', onLoaded);
      target.addEventListener('webaudio:sourcechange', onSourceChange);
      target.addEventListener('webaudio:documentstatechange', onSourceChange);
      this.playerUnbind = () => {
        target.removeEventListener('webaudio:loaded', onLoaded);
        target.removeEventListener('webaudio:sourcechange', onSourceChange);
        target.removeEventListener('webaudio:documentstatechange', onSourceChange);
      };
    }
    this.bindVisualizer();
  }

  private unbindPlayer(): void {
    this.bindingRevision++;
    this.playerUnbind?.();
    this.playerUnbind = undefined;
    this.vizBinding?.unsubscribe();
    this.vizBinding = undefined;
    this.boundPlayer = undefined;
    this.invalidateDerivedPeaks();
  }

  /**
   * (Re)connect the rendered visualizer to its inputs: a bound player's DOM
   * events, and — when `annotate` is on — drag-to-create regions. Annotation
   * does not need a player, so the binding is created for either reason.
   */
  private bindVisualizer(): void {
    const revision = ++this.bindingRevision;
    this.vizBinding?.unsubscribe();
    this.vizBinding = undefined;
    const rendered = this.rendered;
    if (!rendered || this.type === 'meter') return;
    if (this.hasEditorIntent() && !this.documentPlaybackCompatible() && !this.annotate) {
      this.updateDocumentPlayback();
      return;
    }
    const annotate = this.annotate;
    if (!this.boundPlayer && !annotate) return;

    const redraw = (seconds: number | undefined, follow: boolean | undefined, currentFrame: boolean): void => {
      if (this.rendered !== rendered || revision !== this.bindingRevision) return;
      if (this.hasEditorIntent() && !this.documentPlaybackCompatible()) return;
      if (seconds !== undefined) this.timeline.setPlayhead(seconds);
      if (this.rendered !== rendered || revision !== this.bindingRevision) return;
      const follows = !!follow && this.shouldFollow();
      if (currentFrame && seconds !== undefined && rendered.redrawFrame) rendered.redrawFrame(seconds, follows);
      else rendered.redraw(seconds, follows);
      if (this.rendered !== rendered || revision !== this.bindingRevision) return;
      this.surfaceSlider?.update();
      if (follows || this.centeredPlayhead()) this.syncViewportFromRenderer();
    };
    const binding = bindPlayerToWaveform(this.playerAdapter(), {
      ...rendered,
      redraw: (seconds, follow) => redraw(seconds, follow, false),
      redrawFrame: (seconds, follow) => redraw(seconds, follow, true),
    }, {
      followPlayhead: this.follow,
      seekOnClick: false, // the element wires its own click→seek + webaudio:seek
      // Only when nothing else owns the pointer. With `interactive` the kit's
      // SurfaceSlider is mounted on this very node and captures the pointer, so
      // two independent owners would run one gesture: the slider scrubbing the
      // playhead across the region the drag is drawing.
      draggableRegions: annotate && !this.interactive && !this.editing?.state.editable,
      surface: this.host,
      ...(annotate ? {onRegionChange: (created) => this.commitDragRegions(created)} : {}),
    });
    if (revision !== this.bindingRevision || this.rendered !== rendered) binding.unsubscribe();
    else this.vizBinding = binding;
  }

  /**
   * Borrow live position/activity when the selected player exposes them.
   * Legacy DOM event targets keep their event-only position projection, and
   * an inert adapter still lets annotate work without a player.
   */
  private playerAdapter(): ViewPlayerBinding {
    const target = this.boundPlayer;
    const playerView = this.playerFacade();
    const position = playerView?.seconds ?? playerView?.currentTime;
    const hasLivePosition = typeof position === 'number' && Number.isFinite(position);
    const timeline = this.timeline;
    return {
      on: (event, listener) => {
        if (!target) return () => {};
        const handler = (domEvent: Event): void => {
          listener((domEvent as CustomEvent<TimeUpdateDetail>).detail);
        };
        const domName = `webaudio:${event}`;
        target.addEventListener(domName, handler);
        return () => target.removeEventListener(domName, handler);
      },
      seek: (seconds) => playerView?.seek?.(seconds),
      get seconds() {
        return playerView?.seconds ?? playerView?.currentTime ?? timeline.snapshot.playheadSeconds;
      },
      get duration() {
        return playerView?.duration ?? 0;
      },
      get playing() {
        return hasLivePosition ? playerView?.playing : undefined;
      },
      get scratching() {
        return hasLivePosition ? playerView?.scratching : undefined;
      },
    };
  }

  /**
   * A drag created a region. render/binding.ts accumulates only the regions IT
   * created — it starts from an empty array — so the element merges them onto
   * the list it already had; without this the first drag would silently discard
   * every pre-existing region, in the event AND on the surface.
   */
  private commitDragRegions(created: readonly Region[]): void {
    const regions = [...this.baseRegions(), ...created];
    this.timeline.setRegions(regions);
    this.rendered?.setRegions(this.withElementRegionSkin(regions));
    this.dispatchEvent(
      new CustomEvent('webaudio:regionchange', {detail: {regions}, bubbles: true, composed: true}),
    );
  }

  private playerFacade(): BoundPlayerFacade | undefined {
    const target = this.boundPlayer as BoundPlayerFacade | undefined;
    return target?.player ?? target;
  }

  /** New track scrubs read back accepted time; legacy request events stay compatible. */
  private commitSeek(seconds: number, region?: Region, readback = false, scratch?: BoundScratchSession, audible = true): number | undefined {
    if (this.hasEditorIntent() && !this.documentPlaybackCompatible()) return;
    if (!scratch) this.cancelReleasedScratch();
    const revision = ++this.seekRevision;
    const rendered = this.rendered;
    const player = this.playerFacade();
    const duration = this.resolveDuration();
    this.timeline.setDuration(duration);
    const requested = duration > 0 ? Math.max(0, Math.min(duration, seconds)) : Math.max(0, seconds);
    if (!readback) {
      // Existing click/keyboard listeners observe a request before the player
      // command. Some legacy facades publish their new snapshot on a later tick.
      this.timeline.setPlayhead(requested);
      this.dispatchEvent(new CustomEvent('webaudio:seek', {
        detail: {seconds: requested, region}, bubbles: true, composed: true,
      }));
      if (revision !== this.seekRevision || rendered !== this.rendered || player !== this.playerFacade()) return;
      player?.seek?.(requested);
      if (revision !== this.seekRevision || rendered !== this.rendered || player !== this.playerFacade()) return;
      this.rendered?.redraw(requested, this.shouldFollow());
      this.surfaceSlider?.update();
      return requested;
    }
    if (scratch) {
      if (!scratch.active) return;
      scratch.moveToSeconds(requested, audible);
      if (!scratch.active) return;
    } else player?.seek?.(requested);
    // A borrowed callback can replace the source or issue a newer command.
    if (revision !== this.seekRevision || rendered !== this.rendered || player !== this.playerFacade()) return;
    const reported = player?.seconds ?? player?.currentTime;
    const accepted = typeof reported === 'number' && Number.isFinite(reported) ? reported : requested;
    this.timeline.setPlayhead(accepted);
    this.rendered?.redraw(accepted, this.shouldFollow());
    this.surfaceSlider?.update();
    this.dispatchEvent(
      new CustomEvent('webaudio:seek', {detail: {seconds: accepted, region}, bubbles: true, composed: true}),
    );
    return revision === this.seekRevision && rendered === this.rendered ? accepted : undefined;
  }

  private centeredPlayhead(): boolean {
    return this.dragMode === 'scrub' && !this.annotate && this.type !== 'meter';
  }

  private shouldFollow(): boolean {
    return this.follow && !this.trackGesture && (this.annotate || this.dragMode !== 'pan');
  }

  private cancelTrackGesture(resume = false): void {
    const scratch = this.trackGesture?.scratch;
    if (this.dragFrame) this.ownerDocument.defaultView?.cancelAnimationFrame(this.dragFrame);
    this.dragFrame = 0;
    this.trackGesture = undefined;
    if (!resume) this.cancelReleasedScratch();
    if (scratch) this.finishScratch(scratch, resume);
  }

  private takeReleasedScratch(): BoundScratchSession | undefined {
    const released = this.releasedScratch;
    this.releasedScratch = undefined;
    released?.cleanup();
    return released?.session;
  }

  private cancelReleasedScratch(): void {
    const scratch = this.takeReleasedScratch();
    if (scratch?.active) this.finishScratch(scratch, false);
  }

  private finishScratch(scratch: BoundScratchSession, resume: boolean): void {
    let isCurrent = (): boolean => true;
    let complete = (): void => {};
    if (resume) {
      this.cancelReleasedScratch();
      const window = this.ownerDocument.defaultView;
      const cancel = (): void => this.cancelReleasedScratch();
      const released = {
        session: scratch,
        cleanup: (): void => {
          this.removeEventListener('blur', cancel);
          window?.removeEventListener('blur', cancel);
        },
      };
      this.releasedScratch = released;
      this.addEventListener('blur', cancel);
      window?.addEventListener('blur', cancel);
      isCurrent = () => this.releasedScratch === released;
      complete = () => {
        // An older completion must not detach a newer gesture's coast owner.
        if (this.releasedScratch === released) this.takeReleasedScratch();
      };
    }
    try {
      void Promise.resolve(scratch.end(resume)).then(complete, (error) => {
        const report = isCurrent();
        complete();
        if (report) this.reportInPlaceError(error);
      });
    } catch (error) {
      const report = isCurrent();
      complete();
      if (report) this.reportInPlaceError(error);
    }
  }

  /** One expensive transport seek per animation frame, plus exact release. */
  private queueTrackValue(value: number, mode: 'scrub' | 'pan'): void {
    const gesture = this.trackGesture;
    if (!gesture) return;
    if (gesture.scratch && !gesture.scratch.active) {
      this.surfaceSlider?.cancelGesture();
      this.cancelTrackGesture();
      return;
    }
    gesture.pending = value;
    if (this.dragFrame) return;
    const window = this.ownerDocument.defaultView;
    if (!window) return;
    this.dragFrame = window.requestAnimationFrame(() => {
      this.dragFrame = 0;
      try { this.flushTrackValue(mode); } catch (error) { this.reportInPlaceError(error); }
    });
  }

  private flushTrackValue(mode: 'scrub' | 'pan'): void {
    const gesture = this.trackGesture;
    if (!gesture || gesture.pending === undefined) return;
    const value = gesture.pending;
    gesture.pending = undefined;
    if (value === gesture.last) return;
    const previous = gesture.last;
    gesture.last = value;
    try {
      if (mode === 'pan') this.panTo(value);
      else {
        const accepted = this.commitSeek(value, undefined, true, gesture.scratch);
        // The renderer centers accepted content time, including clip boundaries.
        if (accepted !== undefined && this.trackGesture === gesture) this.syncViewportFromRenderer();
      }
    } catch (error) {
      gesture.last = previous;
      throw error;
    } finally {
      if (this.trackGesture === gesture) this.surfaceSlider?.update();
    }
  }

  private resolveDuration(): number {
    if (this.hasEditorIntent()) {
      const content = this.editing?.state.document.content;
      return content ? content.length / content.sampleRate : 0;
    }
    const facade = this.playerFacade();
    if (facade?.duration) return facade.duration;
    const clip = this.resolveClip();
    if (clip) return clip.duration;
    const times = this.explicitSpectrogram?.times;
    const spectrogramDuration = times?.[times.length - 1];
    if (typeof spectrogramDuration === 'number' && spectrogramDuration > 0) {
      return spectrogramDuration;
    }
    const peaks = this.resolvePeaks();
    return peaks ? peaksDuration(peaks) : 0;
  }

  /** Where the playhead is: the bound player if there is one, else our own. */
  private currentSeconds(): number {
    if (this.hasEditorIntent() && !this.documentPlaybackCompatible()) return 0;
    const facade = this.playerFacade();
    return facade?.seconds ?? facade?.currentTime ?? this.timeline.snapshot.playheadSeconds;
  }

  /**
   * Compose the shared surface slider for a seekable view. Non-interactive
   * projections retain their display role; the meter uses `group` so its
   * presenter's own `role="meter"` remains exposed.
   */
  private configureAccessibility(): void {
    this.surfaceSlider?.destroy();
    this.surfaceSlider = undefined;
    this.cancelTrackGesture();
    this.releaseAccessibility();
    if (!this.rendered) return;
    if (this.editorSurface && this.editing?.state.editable) return;
    this.rendered.setPlayheadMode?.(this.centeredPlayhead() ? 'center' : 'position');
    if (this.centeredPlayhead()) {
      this.rendered.redraw(this.currentSeconds(), false);
      this.syncViewportFromRenderer();
    }
    const annotating = this.annotate;
    const mode = annotating ? 'seek' : this.dragMode;
    const panning = mode === 'pan';
    const operable = this.type !== 'meter' &&
      (panning ? this.scrollable : this.interactive);
    if (operable && this.host) {
      let pendingRegion: Region | undefined;
      let dragFrom: number | undefined;
      let moved = false;
      let gestureRevision = 0;
      const trackMode = mode === 'scrub' || mode === 'pan' ? mode : undefined;
      this.surfaceSlider = mountSurfaceSlider(
        this,
        {
          snapshot: () => {
            const duration = this.resolveDuration();
            const range = this.visibleRange();
            return {
              minimum: 0,
              maximum: panning ? Math.max(0, duration - ((range?.endSeconds ?? 0) - (range?.startSeconds ?? 0))) : duration,
              value: panning ? range?.startSeconds ?? 0 : this.timeline.snapshot.playheadSeconds,
            };
          },
          valueAt: (point) => {
            const gesture = this.trackGesture;
            moved = point.gesture?.moved === true;
            if (gesture && trackMode && moved) {
              const initial = panning ? gesture.offset : gesture.seconds;
              return initial - (point.gesture?.deltaX ?? 0) / gesture.zoom;
            }
            if (panning) return gesture?.offset ?? this.visibleRange()?.startSeconds ?? 0;
            const hit = this.rendered?.hitTest(point.x, point.y);
            pendingRegion = hit?.region;
            return hit?.seconds ?? this.timeline.snapshot.playheadSeconds;
          },
          preview: (seconds) => {
            if (dragFrom === undefined) dragFrom = seconds;
          },
          gesture: (phase) => {
            if (phase === 'start') {
              gestureRevision++;
              moved = false;
              // Let the same player transfer its original playing intent on
              // re-grab before terminating the previous released session.
              const coasting = trackMode === 'scrub' ? this.takeReleasedScratch() : undefined;
              this.cancelTrackGesture();
              if (trackMode) {
                const player = this.playerFacade();
                const gesture = this.trackGesture = {
                  seconds: this.currentSeconds(), zoom: this.zoom,
                  offset: this.visibleRange()?.startSeconds ?? 0,
                  scratch: undefined as BoundScratchSession | undefined,
                };
                if (trackMode === 'scrub') {
                  try {
                    // Called inside pointerdown to retain browser user activation.
                    const scratch = player?.beginScratch?.();
                    if (this.trackGesture === gesture && this.playerFacade() === player) {
                      gesture.scratch = scratch;
                      if (scratch?.active) gesture.seconds = this.currentSeconds();
                    }
                    else if (scratch) void Promise.resolve(scratch.end(false)).catch((error) => this.reportInPlaceError(error));
                  } catch (error) {
                    if (this.trackGesture === gesture) this.cancelTrackGesture();
                    throw error;
                  } finally {
                    if (coasting?.active && coasting !== this.trackGesture?.scratch) this.finishScratch(coasting, false);
                  }
                }
              }
              return;
            }
            const revision = gestureRevision;
            const ending = this.trackGesture;
            try {
              if (phase === 'end' && trackMode) this.flushTrackValue(trackMode);
            } finally {
              if (revision === gestureRevision && this.trackGesture === ending) {
                this.cancelTrackGesture(phase === 'end');
                this.surfaceSlider?.update();
                pendingRegion = undefined;
                dragFrom = undefined;
                moved = false;
              }
            }
          },
          commit: (seconds) => {
            if (trackMode && moved) {
              this.queueTrackValue(seconds, trackMode);
              return;
            }
            if (panning) {
              this.panTo(seconds);
              this.surfaceSlider?.update();
              return;
            }
            const region = pendingRegion;
            const from = dragFrom;
            pendingRegion = undefined;
            dragFrom = undefined;
            if (annotating && from !== undefined && Math.abs(seconds - from) > 1e-3) {
              this.commitDragRegions([createRegion({
                label: '', startSeconds: Math.min(from, seconds), endSeconds: Math.max(from, seconds),
              })]);
              return;
            }
            const scratch = this.trackGesture?.scratch;
            this.commitSeek(seconds, region, !!scratch, scratch, false);
          },
        },
        {
          label: panning ? 'Audio viewport' : SEEK_LABEL,
          pointerTarget: this.host,
          pointerMode: trackMode ? 'drag' : mode === 'none' ? 'click' : 'absolute',
          ...(trackMode ? {cursor: 'grab', dragCursor: 'grabbing'} : {}),
          ...(annotating ? {commitOn: 'release' as const} : {}),
          keyboardStep: ({minimum, maximum}, event) => {
            if (panning) {
              const range = this.visibleRange();
              const span = (range?.endSeconds ?? 0) - (range?.startSeconds ?? 0);
              return Math.max(0.05, span / (event.shiftKey ? 1 : 4));
            }
            return Math.max(1, (maximum - minimum) / 100);
          },
          onError: (error) => this.onViewError(error),
        },
      );
      return;
    }
    this.applyRole(this.type === 'meter' ? 'group' : 'img');
    this.applyLabel(DISPLAY_LABELS[this.type]);
  }

  /** Drop only what this element assigned — never an author's own ARIA. */
  private releaseAccessibility(): void {
    if (this.assignedRole !== undefined && this.getAttribute('role') === this.assignedRole) {
      this.removeAttribute('role');
    }
    this.assignedRole = undefined;
    if (this.assignedAriaLabel !== undefined && this.getAttribute('aria-label') === this.assignedAriaLabel) {
      this.removeAttribute('aria-label');
    }
    this.assignedAriaLabel = undefined;
  }

  private applyRole(role: string): void {
    if (this.hasAttribute('role')) return;
    this.setAttribute('role', role);
    this.assignedRole = role;
  }

  private applyLabel(label: string): void {
    if (this.hasAttribute('aria-label') || this.hasAttribute('aria-labelledby')) return;
    this.setAttribute('aria-label', label);
    this.assignedAriaLabel = label;
  }

  /**
   * The element's one observable failure channel: a failed `src` or
   * `peaks-src` load and a failed render all arrive here.
   */
  protected onViewError(cause: unknown): void {
    const error = cause instanceof Error ? cause : new Error(String(cause));
    this.dispatchEvent(
      new CustomEvent('webaudio:error', {detail: {error}, bubbles: true, composed: true}),
    );
  }

  protected override onLifecycleError(error: unknown): void {
    this.onViewError(error);
  }

  // ---- Sources ----

  /** aria-busy is shared by both loaders, so it is counted, not toggled. */
  private beginLoad(): void {
    this.pendingLoads++;
    this.setAttribute('aria-busy', 'true');
  }

  private endLoad(): void {
    this.pendingLoads = Math.max(0, this.pendingLoads - 1);
    if (this.pendingLoads === 0) this.removeAttribute('aria-busy');
  }

  private cancelClipLoad(): void {
    this.sourceToken++;
    this.sourceAbort?.abort();
    this.sourceAbort = undefined;
  }

  private cancelPeaksLoad(): void {
    this.peaksToken++;
    this.peaksAbort?.abort();
    this.peaksAbort = undefined;
  }

  private async loadSource(): Promise<void> {
    if (this.hasEditorIntent()) { this.bindEditor(); return; }
    this.surfaceSlider?.cancelGesture();
    this.cancelTrackGesture();
    this.cancelClipLoad();
    const token = this.sourceToken;
    const controller = new AbortController();
    this.sourceAbort = controller;
    const src = this.getAttribute('src')?.trim();
    this.sourceClip = undefined;
    this.invalidateDerivedPeaks();
    if (!src) {
      this.sourceAbort = undefined;
      this.refresh();
      return;
    }
    this.beginLoad();
    try {
      const play = await import('../../play/api');
      if (token !== this.sourceToken || !this.isConnected) return;
      const format = audioFormatAttr(this.getAttribute('format'));
      const clip = await play.loadClipFromUrl(src, {
        ...(format ? {format} : {}),
        signal: controller.signal,
      });
      if (token !== this.sourceToken || !this.isConnected) return;
      this.sourceClip = clip;
      this.invalidateDerivedPeaks();
      this.refresh();
    } catch (cause) {
      if (token !== this.sourceToken || !this.isConnected) return;
      this.onViewError(cause);
    } finally {
      if (token === this.sourceToken) this.sourceAbort = undefined;
      this.endLoad();
    }
  }

  /**
   * Hydrate BBC `audiowaveform` v2 JSON straight into the pyramid the renderer
   * reads. This is the path that draws a long file with no decode at all: no
   * AudioContext, no samples, no @webmusic/audio/play import.
   */
  private async loadPeaksSource(): Promise<void> {
    if (this.hasEditorIntent()) { this.bindEditor(); return; }
    this.surfaceSlider?.cancelGesture();
    this.cancelTrackGesture();
    this.cancelPeaksLoad();
    const token = this.peaksToken;
    const controller = new AbortController();
    this.peaksAbort = controller;
    const src = this.getAttribute('peaks-src')?.trim();
    this.sourcePeaks = undefined;
    if (!src) {
      this.peaksAbort = undefined;
      this.refresh();
      return;
    }
    this.beginLoad();
    try {
      const response = await fetch(src, {signal: controller.signal});
      if (!response.ok) throw new Error(`Peaks request failed: ${response.status} ${src}`);
      const json = (await response.json()) as WaveformDataJSON;
      if (token !== this.peaksToken || !this.isConnected) return;
      this.sourcePeaks = peaksFromWaveformData(json);
      this.refresh();
    } catch (cause) {
      if (token !== this.peaksToken || !this.isConnected) return;
      this.onViewError(cause);
    } finally {
      if (token === this.peaksToken) this.peaksAbort = undefined;
      this.endLoad();
    }
  }

  private hasEditorIntent(): boolean { return this.explicitEditor !== undefined || this.hasAttribute('editor'); }

  private hasIndependentSource(): boolean {
    return this.explicitClip !== undefined || this.explicitPeaks !== undefined || this.explicitSpectrogram !== undefined ||
      this.explicitFrequencyData !== undefined || this.hasAttribute('src') || this.hasAttribute('peaks-src');
  }

  private assertIndependentSource(value: unknown): void {
    if (value !== undefined && this.hasEditorIntent()) throw new Error('source-conflict: An editor cannot be combined with independent audio sources');
  }

  private updateEditable(): void {
    const supported = this.type === 'waveform';
    if (this.editing?.state.available) this.editing.setEditable(this.editable && supported && !this.annotate);
    this.setAttribute('data-editable-state', !this.editable ? 'readonly' : !supported ? 'unsupported-type' :
      !this.editing?.state.available ? 'unavailable' : this.annotate ? 'annotation' : 'ready');
  }

  /** Detach the old attachment before releasing anything that can publish. */
  private detachEditor(): () => void {
    const surface = this.editorSurface;
    const unsubscribe = this.editorStateCleanup;
    const editing = this.editing;
    this.editorSurface = undefined;
    if (this.rendered === surface) this.rendered = undefined;
    this.editorStateCleanup = undefined;
    this.editing = undefined;
    return () => {
      try { unsubscribe?.(); } finally {
        try { surface?.dispose(); } finally { editing?.dispose(); }
      }
    };
  }

  private unbindEditor(): number {
    const generation = ++this.editorGeneration;
    const discovery = this.editorCleanup;
    this.editorCleanup = undefined;
    const release = this.detachEditor();
    try { discovery?.(); } finally { release(); }
    return generation;
  }

  private bindEditor(): void {
    const generation = this.unbindEditor();
    const current = () => generation === this.editorGeneration && this.isConnected;
    if (!current()) return;
    if (!this.hasEditorIntent()) {
      this.removeAttribute('data-editor-state'); this.updateEditable();
      if (!current()) return;
      if (this.hasAttribute('src') && !this.explicitClip) void this.loadSource();
      if (!current()) return;
      if (this.hasAttribute('peaks-src') && !this.explicitPeaks) void this.loadPeaksSource();
      if (current()) this.refresh(); return;
    }
    this.cancelClipLoad();
    if (!current()) return;
    this.cancelPeaksLoad();
    if (!current()) return;
    if (this.hasIndependentSource()) {
      this.setAttribute('data-editor-state', 'source-conflict'); this.updateEditable(); if (current()) this.refresh(); return;
    }
    const cleanup = observeElementSource<AudioClipEditorPort>(this, {source: this.explicitEditor,
      selector: this.getAttribute('editor') ?? undefined, property: 'editor', accepts: isAudioClipEditorPort}, (resolution) => {
      if (!current()) return;
      // A nested sourcechange can supersede this attachment while the same
      // discovery subscription remains active.
      const revision = ++this.editorResolutionRevision;
      const attached = () => current() && revision === this.editorResolutionRevision;
      this.detachEditor()();
      if (!attached()) return;
      this.setAttribute('data-editor-state', resolution.state);
      if (resolution.state === 'ready' && resolution.source) {
        try {
          const editing = createAudioViewEditing(resolution.source, {
            editable: this.editable && this.type === 'waveform' && !this.annotate, interactionSession: this.explicitInteractionSession,
          });
          if (!attached()) { editing.dispose(); return; }
          this.editing = editing;
          const unsubscribe = editing.subscribe((state) => {
            if (!attached() || editing !== this.editing) return;
            this.setAttribute('data-editor-state', state.available ? 'ready' : 'unavailable');
            this.timeline.setDuration(state.document.content.length / state.document.content.sampleRate);
            if (!attached() || editing !== this.editing) return;
            this.updateDocumentPlayback();
            if (attached() && editing === this.editing && !state.available && this.editorSurface) this.refresh();
          });
          if (attached() && editing === this.editing) this.editorStateCleanup = unsubscribe;
          else { unsubscribe(); editing.dispose(); return; }
        } catch (error) {
          if (!attached()) return;
          this.setAttribute('data-editor-state', 'invalid'); this.onViewError(error);
        }
      }
      if (!attached()) return;
      this.updateEditable(); if (attached()) this.refresh();
    });
    if (current()) this.editorCleanup = cleanup; else cleanup();
  }

  private documentPlaybackCompatible(): boolean {
    return !!this.editing && audioDocumentPlaybackCompatible(this.editing.state.document, this.playerFacade()?.documentBinding);
  }

  private updateDocumentPlayback(): void {
    if (!this.hasEditorIntent()) return;
    const compatible = this.documentPlaybackCompatible();
    this.setAttribute('data-playback-state', !this.boundPlayer ? 'unbound' : compatible ? 'ready' : 'pending');
    this.rendered?.setPlayheadVisible?.(compatible);
    const player = this.playerFacade();
    this.editorSurface?.updatePlayback(player?.documentBinding, compatible ? player?.seconds ?? player?.currentTime ?? 0 : 0);
    if (!compatible) this.timeline.setPlayhead(0);
  }
}

/**
 * Register `<audio-view>` (or a custom tag). Call once in the browser. A no-op
 * outside the browser and when the tag is already taken. Tree-shakeable:
 * importing the package does not register elements until you invoke this.
 */
export function defineAudioViewElement(tag = 'audio-view'): void {
  defineOnce(tag, AudioViewElement);
}
