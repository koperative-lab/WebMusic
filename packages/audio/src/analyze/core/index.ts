// Internal reusable analysis algorithms. This directory is deliberately not a
// public package subpath yet; `../api` selects the stable public surface.
export {computePeaks, type ComputePeaksOptions} from './peaks';
export {measureLoudness} from './loudness';
export {
  computeSpectrogram,
  createFftJsBackend,
  type FFTBackend,
  type SpectrogramOptions,
} from './spectrogram';
export {
  detectOnsets,
  histogramOnsetIntervals,
  type OnsetOptions,
  type OnsetIntervalBin,
  type OnsetIntervalHistogramOptions,
} from './onsets';
export {detectAudioKey, computeChromagram, keyFromChroma, type KeyOptions} from './key';
export {detectTempo, type TempoEngine, type TempoOptions} from './tempo';
export {trackPitch, type PitchEngine, type PitchOptions} from './pitch';
export {extractFeatures, DEFAULT_FEATURES, type ExtractFeaturesOptions} from './features';
export {summarizeClip, type ClipSummary} from './summary';
export type {
  AudioAnalysisResult,
  AudioAnalysisTask,
  AudioFeatureFrames,
  AudioKeyResult,
  LoudnessResult,
  PitchTrackResult,
  SpectrogramData,
  TempoResult,
} from './types';
