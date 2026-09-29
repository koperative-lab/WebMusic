// ============================================================================
// @webmusic/audio/analyze/api — stable programmatic analysis surface.
//
// One-shot algorithms and worker-backed calls live here. Stateful realtime and
// incremental engines are published at `/headless`; styled Web Components are
// at `/element`.
// ============================================================================

// The core surface, re-exported BY NAME so an addition to core does not
// become public semver surface by accident. This list mirrors the curated
// barrel in ../core/index.ts; extending it is an API decision.
export {computePeaks, type ComputePeaksOptions} from "../core";
export {measureLoudness} from "../core";
export {
  computeSpectrogram,
  createFftJsBackend,
  type FFTBackend,
  type SpectrogramOptions,
} from "../core";
export {
  detectOnsets,
  histogramOnsetIntervals,
  type OnsetOptions,
  type OnsetIntervalBin,
  type OnsetIntervalHistogramOptions,
} from "../core";
export {detectAudioKey, computeChromagram, keyFromChroma, type KeyOptions} from "../core";
export {detectTempo, type TempoEngine, type TempoOptions} from "../core";
export {trackPitch, type PitchEngine, type PitchOptions} from "../core";
export {extractFeatures, DEFAULT_FEATURES, type ExtractFeaturesOptions} from "../core";
export {summarizeClip, type ClipSummary} from "../core";
export type {
  AudioAnalysisResult,
  AudioAnalysisTask,
  AudioFeatureFrames,
  AudioKeyResult,
  LoudnessResult,
  PitchTrackResult,
  SpectrogramData,
  TempoResult,
} from "../core";

// Stateful engine contracts are available here as types for option/result
// authoring. Their runtime factories stay exclusive to `/headless`.
export type {
  AudioAnalysisSession,
  AudioAnalysisSessionOptions,
} from "../headless/session";
export type {
  RealtimeAnalyzer,
  RealtimeAnalyzerOptions,
  RealtimeFrame,
  RealtimeSource,
} from "../headless/realtime";

export {
  createAnalysisWorker,
  configureAnalysisWorkerScriptUrl,
  createRequestTracker,
  resolveAnalysisWorkerUrl,
  type AnalysisWorkerClient,
  type AnalysisWorkerFactory,
  type AnalysisWorkerLike,
  type AnalyzeCallOptions,
  type RequestTracker,
} from "./worker-client";

export {
  createAnalysisWorkerState,
  handleAnalyzeRequest,
  type AnalyzeWorkerRequest,
  type AnalyzeWorkerResponse,
  type AnalyzeRequest,
  type RegisterRequest,
  type ReleaseRequest,
  type UpdateRequest,
  type AudioWorkerState,
} from "./worker-protocol";
