// ============================================================================
// @webmusic/audio/view/headless — code-first audio view components.
//
// These objects calculate viewport state, waveform columns, spectrogram frames
// and meter values. They never create a surface or apply visual defaults, so a
// framework, terminal, native shell or custom renderer can consume the same
// results. Browser renderers are explicitly available from `/render`; styled
// Web Components live at `/element`.
// ============================================================================

export {
  LiveScrollBuffer,
  LiveViewController,
  createLiveViewController,
  frequencyColumn,
  timeDomainColumn,
  type LiveColumn,
  type LiveProjectionType,
  type LiveScrollOptions,
  type LiveViewControllerOptions,
} from './live';

export {computeClipPeaks, peaksDuration} from './peaks';

export {
  AudioTimeline,
  createAudioTimeline,
  type AudioTimelineOptions,
  type AudioTimelineSnapshot,
  type AudioTimelineHit,
  type AudioTimelineGeometryUpdate,
  type AudioTimelineSubscriber,
} from './timeline';

export {
  WaveformViewModel,
  createWaveformViewModel,
  fitWaveformColumns,
  type WaveformViewModelOptions,
  type WaveformColumn,
  type WaveformChannelPeak,
} from './waveform';

export {
  SpectrogramViewModel,
  createSpectrogramViewModel,
  type SpectrogramViewModelOptions,
  type SpectrogramFrameView,
} from './spectrogram';

export {
  AudioMeterController,
  createAudioMeterController,
  type AudioMeterControllerOptions,
  type AudioMeterConfiguration,
  type AudioMeterLevelFrame,
  calculateLevelMeter,
  calculateSpectrumBars,
  type LevelMeterFrame,
  type LevelMeterOptions,
  type SpectrumBarsOptions,
} from './meter';

export {
  bindPlayerToAudioTimeline,
  type AudioTimelineBinding,
  type BindAudioTimelineOptions,
  type PlayheadTarget,
} from './binding';
