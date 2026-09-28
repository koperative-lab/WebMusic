// ============================================================================
// Public types for @webmusic/audio/view — the renderer contract and option bags.
//
// Mirrors @webscore/view's `RenderedScoreVisualizer` / `*RenderOptions` split:
// every `render*Visualizer` returns a `RenderedAudioVisualizer` handle and
// takes an options bag. `SpectrogramData` is declared here (not in core) so the
// spectrogram renderer can consume @webmusic/audio/analyze output structurally
// without view depending on analyze.
// ============================================================================

import type {Region} from '../../core';

/** Names of the built-in spectrogram colormaps. */
export type ColormapName = 'viridis' | 'magma' | 'grayscale' | 'gray';

/** Immutable geometry published by a horizontally scrollable audio surface. */
export interface AudioViewportSnapshot {
  /** CSS pixels scrolled past the left edge. */
  readonly offsetPixels: number;
  /** Measured visible width in CSS pixels. */
  readonly viewportWidth: number;
  /** Horizontal scale in CSS pixels per second. */
  readonly pixelsPerSecond: number;
  /** Full scrollable width in CSS pixels. */
  readonly contentWidth: number;
  /** Duration represented by the surface. */
  readonly durationSeconds: number;
}

/** Atomic programmatic update accepted by an {@link AudioViewportHandle}. */
export interface AudioViewportUpdate {
  offsetPixels?: number;
  pixelsPerSecond?: number;
}

/** Notification emitted after observable viewport geometry changes. */
export type AudioViewportSubscriber = (snapshot: AudioViewportSnapshot) => void;

/**
 * Narrow viewport capability a caller supplies to {@link bindAudioTimelineViewport}
 * and to `mountAudioTimeline`. The handle owns DOM viewport state, not a domain
 * model: it reports measured geometry and accepts atomic zoom/offset updates
 * from a caller-owned timeline controller.
 *
 * The bundled renderers do NOT implement it — they expose the wider
 * {@link ViewportAudioVisualizer}, whose `viewport()` is a method returning a
 * plain range. Adapting one to the other is the caller's job, because only the
 * caller knows whether its timeline or the DOM owns the scroll position.
 */
export interface AudioViewportHandle {
  readonly snapshot: AudioViewportSnapshot;
  setViewport(update: AudioViewportUpdate): void;
  subscribe(subscriber: AudioViewportSubscriber): () => void;
}

/**
 * The handle returned by every `render*Visualizer`. Lets callers drive the
 * playhead, zoom, regions and hit-testing without knowing the concrete
 * renderer — the digital-audio analogue of `RenderedScoreVisualizer`.
 */
export interface RenderedAudioVisualizer {
  /**
   * Update the playhead to `playheadSeconds`, optionally following it. Waveform
   * progress/history paint is coalesced to animation frames; spectrogram ticks
   * reuse the image until following exposes unpainted pixels. With no argument,
   * re-lay-out and repaint the current view.
   */
  redraw(playheadSeconds?: number, scrollIntoView?: boolean): void;
  /**
   * Paint an observed position in the current animation frame without queuing
   * another frame. Presentation observers use this when available; other
   * visualizers retain the redraw fallback.
   */
  redrawFrame?(playheadSeconds: number, scrollIntoView?: boolean): void;
  /**
   * Change the playhead geometry without replacing the canvas. Center mode
   * follows every cursor update, including at clip boundaries with blank
   * padding, and ignores independent panning. Default is position.
   */
  setPlayheadMode?(mode: 'position' | 'center'): void;
  /** Change the horizontal scale (pixels per second) and repaint. */
  setZoom(pixelsPerSecond: number): void;
  /** Replace the overlaid regions/markers and repaint the overlay. */
  setRegions(regions: readonly Region[]): void;
  /**
   * Map a pointer position (CSS px relative to the rendered surface) to a time
   * and, when the point falls inside one, the region under it.
   */
  hitTest(x: number, y: number): {seconds: number; region?: Region};
  /**
   * Scroll so the visible window starts at `startSeconds`, clamped to the
   * clip. Other controls can drive the view through this method. Ignored in
   * center playhead mode.
   */
  setOffset?(startSeconds: number): void;
  /** The visible clip intersection, in seconds; excludes center-mode padding. */
  viewport?(): AudioViewport;
  /**
   * Observe pan and zoom. Fires for user scrolling and for programmatic
   * `setOffset`/`setZoom` alike, so observers stay in step either way.
   * Returns an unsubscribe function.
   */
  onViewportChange?(listener: (viewport: AudioViewport) => void): () => void;
  /** Release DOM nodes, listeners and animation frames. Safe to call twice. */
  dispose(): void;
}

/** The visible time window of a scrollable renderer. */
export interface AudioViewport {
  startSeconds: number;
  endSeconds: number;
}

/**
 * Precise return type of the waveform renderer. A scrollable surface always
 * owns its window, so the viewport members every renderer only *may* have are
 * required here — a caller holding this handle never has to test for them.
 */
export interface ViewportAudioVisualizer extends RenderedAudioVisualizer {
  setPlayheadMode(mode: 'position' | 'center'): void;
  setOffset(startSeconds: number): void;
  viewport(): AudioViewport;
  onViewportChange(listener: (viewport: AudioViewport) => void): () => void;
}

/** Shared knobs for the time-axis renderers (waveform + spectrogram). */
export interface TimelineRenderOptions {
  /**
   * `position` (default) places the cursor at its timeline position; optional
   * following clamps at clip edges. `center` always keeps it at the measured
   * viewport center, adds blank padding at the edges, and ignores independent
   * panning. Center mode follows even when redraw's scrollIntoView is false.
   */
  playheadMode?: 'position' | 'center';
  /** Horizontal scale; default 100. */
  pixelsPerSecond?: number;
  /** Total duration in seconds, when not derivable from the data. */
  durationSeconds?: number;
  /** Device pixel ratio override (defaults to `window.devicePixelRatio`). */
  devicePixelRatio?: number;
  /** Regions/markers to overlay. */
  regions?: readonly Region[];
  /**
   * Viewport virtualization: when on, only the visible columns (± a buffer of
   * `bufferScreens` viewports) are painted, recomputed on scroll. `true`
   * enables it with the default buffer; `false` always paints everything; an
   * object enables it with a custom buffer. Default `true`. Spectrogram backing
   * storage is limited to that buffered stripe; hidden hosts defer raster work.
   */
  virtualization?: boolean | {bufferScreens?: number};
  /** Hex/CSS colour of the playhead line. */
  playheadColor?: string;
  /**
   * Allow the user to pan the surface horizontally (scrollbar / wheel / drag);
   * default `true`. When `false`, the surface is locked and only programmatic
   * follow can move the view. Honored by waveform and spectrogram renderers.
   */
  scrollable?: boolean;
}

/** Options for {@link renderWaveformVisualizer}. */
export interface WaveformRenderOptions extends TimelineRenderOptions {
  /** Waveform fill colour (min/max columns). */
  waveColor?: string;
  /** Colour of the portion already played (left of the playhead). */
  progressColor?: string;
  /** Background colour; transparent when omitted. */
  backgroundColor?: string;
  /** Vertical gain applied to the [-1, 1] peaks before drawing; default 1. */
  amplitude?: number;
  /** Pixel height of the surface; default 128. */
  height?: number;
  /**
   * How the waveform is coloured. `static` (default) fills with `waveColor` /
   * `progressColor`; `multiband` tints each column by its spectral balance —
   * bass → red, mids → green, treble → blue and their additive mixes (the
   * "multi-band" look); `colormap` maps each column's spectral centroid through
   * `colorMap`. The frequency-aware modes need {@link frequencyData}.
   */
  colorMode?: 'static' | 'multiband' | 'colormap';
  /**
   * STFT data driving `colorMode` `multiband` / `colormap` — the same
   * `SpectrogramData` a spectrogram view consumes, computed from the *same*
   * channel as the peaks. Pass an array (one per peaks channel) to colour a
   * `split` stereo display per channel. Ignored when `colorMode` is `static`.
   */
  frequencyData?: SpectrogramData | readonly SpectrogramData[];
  /** Number of frequency bands for `multiband`; default 3 (red / green / blue). */
  bands?: number;
  /** Colormap for `colorMode: 'colormap'`; default `viridis`. */
  colorMap?: ColormapName | string;
  /**
   * `merge` (default) folds every peaks channel into one waveform around the
   * centre line; `split` stacks the first two channels — channel 0 in the top
   * half, channel 1 mirrored in the bottom half (a stereo display).
   */
  channelLayout?: 'merge' | 'split';
  /**
   * Seconds of "recent history" highlighted around the playhead during playback:
   * columns within this window behind the playhead stay full-brightness while
   * the rest dim, a trailing glow that follows playback (like a real-time
   * meter's persistence). `0` / omitted disables it.
   */
  historyTrail?: number;
}

/**
 * STFT spectrogram payload — column-major magnitudes. Declared here so the
 * renderer consumes @webmusic/audio/analyze output structurally (view never imports
 * analyze). `magnitudes[frame * binsPerFrame + bin]` is the magnitude of the
 * `bin`-th frequency bin in the `frame`-th time frame.
 */
export interface SpectrogramData {
  /** Sorted time (seconds) represented by each frame; length === number of frames. */
  times: Float32Array | number[];
  /** Sorted centre frequency (Hz) of each bin; length === binsPerFrame. */
  frequencies: Float32Array | number[];
  /** Flattened frame-major magnitudes. */
  magnitudes: Float32Array;
  /** Bins per frame (rows). */
  binsPerFrame: number;
}

/** Options for {@link renderSpectrogramVisualizer}. */
export interface SpectrogramRenderOptions extends TimelineRenderOptions {
  /** Colormap name or custom mapper `t∈[0,1] → [r,g,b]`. Default `viridis`. */
  colorMap?: ColormapName | ((t: number) => [number, number, number]);
  /** Lowest frequency (Hz) drawn at the bottom; default 0. */
  minFreq?: number;
  /** Highest frequency (Hz) drawn at the top; default Nyquist of the data. */
  maxFreq?: number;
  /** dB floor for magnitude → colour mapping; default -100. */
  minDb?: number;
  /** dB ceiling for magnitude → colour mapping; default 0. */
  maxDb?: number;
  /** Pixel height of the surface; default 256. */
  height?: number;
}

/** Options for {@link renderLoudnessMeter}. */
export interface MeterRenderOptions {
  /** `level` = RMS/peak bars (default), `spectrum` = FFT bar graph. */
  mode?: 'level' | 'spectrum';
  /** Bars to draw in spectrum mode; default 28. */
  bars?: number;
  /** Pixel height of the surface; default 54. */
  height?: number;
  /** Bar/fill colour. */
  color?: string;
  /** Peak-hold tick colour. */
  peakColor?: string;
  /** Background colour. */
  backgroundColor?: string;
}

/** A source carrying an `AnalyserNode` (e.g. an `AudioClipPlayer`). */
export interface AnalyserSource {
  readonly analyser: AnalyserNode;
}

/**
 * Structural player surface the view binds to — deliberately a subset of
 * `AudioClipPlayer` so the renderer never imports @webmusic/audio/play. Any
 * object exposing `on`/`seek`/`seconds`/`duration` can drive a visualizer.
 *
 * This is NOT the kernel's playback control contract: `@webmusic/kernel/player`
 * owns the name `PlayerLike` for the transport surface (play/pause/stop/seek,
 * with `seconds`/`duration` optional), and a bare kernel `PlayerLike` does not
 * satisfy this binding — only its `TimedPlayerLike` tier does. The two shapes
 * are deliberately different: a visualizer needs a position to read and a seek
 * to call, never transport control.
 */
export interface ViewPlayerBinding {
  /** Subscribe to a player event; returns an unsubscribe function. */
  on(event: string, listener: (payload: unknown) => void): () => void;
  /** Seek to an absolute position in seconds. */
  seek(seconds: number): void;
  /** Current playback position in seconds. */
  readonly seconds: number;
  /** Total duration in seconds. */
  readonly duration: number;
  /**
   * Optional live activity flags. When either is available, render bindings
   * read seconds on display frames while active instead of limiting paint to
   * timeupdate events. Missing flags retain event-only observation.
   */
  readonly playing?: boolean;
  readonly scratching?: boolean;
}

/**
 * @deprecated Renamed to {@link ViewPlayerBinding}. The old spelling shadowed
 * the kernel's unrelated `PlayerLike` transport contract; it stays as an alias
 * for source compatibility and will be removed in a future major.
 */
export type PlayerLike = ViewPlayerBinding;
