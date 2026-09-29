// Internal reusable view primitives. The directory is intentionally not a
// published package subpath yet; `../api` selects the stable public surface.
export {
  viridis,
  magma,
  grayscale,
  colormapByName,
  type RGB,
  type Colormap,
  type ColormapName,
} from './colormaps';

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
} from './windowing';

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
} from './types';
