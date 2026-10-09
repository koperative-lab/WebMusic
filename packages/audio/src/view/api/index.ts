// ============================================================================
// @webmusic/audio/view/api — stable programmatic surface.
//
// This entry exposes data contracts plus reusable colour and viewport math.
// It does not create DOM nodes or install a visual skin. Imperative, unstyled
// Code-only view models live at `@webmusic/audio/view/headless`; browser drawing
// adapters live at `@webmusic/audio/view/render`; styled Web Components live at
// `@webmusic/audio/view/element`.
// ============================================================================

// The core surface, re-exported BY NAME so an addition to core does not
// become public semver surface by accident. This list mirrors the curated
// barrel in ../core/index.ts; extending it is an API decision.
export {
  viridis,
  magma,
  grayscale,
  colormapByName,
  type RGB,
  type Colormap,
  type ColormapName,
} from '../core';
export {
  bufferedScrollRange,
  visibleColumnRange,
  visibleTimeRange,
  pixelToSeconds,
  secondsToPixel,
  clampCanvasBackingSize,
  DEFAULT_BUFFER_SCREENS,
  MAX_CANVAS_DIMENSION,
  type IndexRange,
  type CanvasBackingSize,
} from '../core';
// BBC `audiowaveform` v2 interop, the same hydration `<audio-view peaks-src>`
// performs — re-exported so a code-only consumer can reach it without an
// element or a dependency on the package root.
export {peaksFromWaveformData} from '../../core';

export type {
  AudioViewportSnapshot,
  AudioViewportUpdate,
  AudioViewportSubscriber,
  AudioViewportHandle,
  RenderedAudioVisualizer,
  ViewportAudioVisualizer,
  TimelineRenderOptions,
  WaveformRenderOptions,
  SpectrogramRenderOptions,
  SpectrogramData,
  MeterRenderOptions,
  AnalyserSource,
  ViewPlayerBinding,
  PlayerLike,
} from '../core';

// Code-component contracts are exposed type-only so applications can define
// configuration and result boundaries without pulling stateful runtimes into
// the API entry.
export type {
  AudioTimelineOptions,
  AudioTimelineSnapshot,
  AudioTimelineHit,
  AudioTimelineGeometryUpdate,
  AudioTimelineSubscriber,
} from '../headless/timeline';
export type {
  WaveformViewModelOptions,
  WaveformColumn,
  WaveformChannelPeak,
} from '../headless/waveform';
export type {
  SpectrogramViewModelOptions,
  SpectrogramFrameView,
} from '../headless/spectrogram';
export type {
  LevelMeterFrame,
  LevelMeterOptions,
  SpectrumBarsOptions,
} from '../headless/meter';
export type {
  AudioMeterDisplayType,
  AudioMeterFrequencyScale,
  AudioMeterLoudnessMode,
  AudioMeterTrigger,
  AudioMeterDisplayOptions,
  AudioMeterDisplaySnapshot,
} from '../headless/meter-display';
export type {
  AudioTimelineBinding,
  BindAudioTimelineOptions,
  PlayheadTarget,
} from '../headless/binding';
