// Browser surface adapters. Retained visualizers create/manage drawing nodes;
// `paint*` adapters draw into presenter-owned frames. Code-only view models
// live at `@webmusic/audio/view/headless`.
export {renderWaveformVisualizer} from './waveform';
export {renderSpectrogramVisualizer} from './spectrogram-view';
export {renderLoudnessMeter} from './meter';
export {
  paintWaveformOverview,
  type AudioCanvasFrame,
  type WaveformOverviewOptions,
} from './overview';
export {paintLiveProjection, type LiveProjectionRenderOptions} from './live';
export {bindPlayerToWaveform, type BindWaveformOptions, type WaveformBinding} from './binding';
export {
  bindAudioTimelineViewport,
  type AudioTimelineViewportBinding,
} from './viewport-binding';
export {
  mountAudioTimeline,
  createAudioTimelinePresenterBinding,
  audioTimelineTicks,
  formatAudioTimelinePosition,
  type AudioTimelineRange,
  type AudioTimelinePresenterBindingOptions,
  type MountAudioTimelineOptions,
  type AudioTimelinePresenterHandle,
} from './audio-timeline';
