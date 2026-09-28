// ============================================================================
// @webmusic/audio/analyze/headless — stateful analysis engines without Custom
// Elements or a visual skin.
//
//   createRealtimeAnalyzer — a live main-thread AnalyserNode tap (owns a timer,
//                            ring buffers, and a pitch detector).
//   createAudioAnalysisSession — incremental analysis over an evolving clip;
//                            `update` recomputes only what a sample edit touched.
//
// No DOM — pair with your own UI, or the styled Web Components at
// `@webmusic/audio/analyze/element`. The one-shot analyzers live at the
// `@webmusic/audio/analyze` package root.
// ============================================================================

export {
  createRealtimeAnalyzer,
  type RealtimeAnalyzer,
  type RealtimeAnalyzerOptions,
  type RealtimeFrame,
  type RealtimeSource,
} from './realtime';

export {
  createAudioAnalysisSession,
  type AudioAnalysisSession,
  type AudioAnalysisSessionOptions,
} from './session';

export {
  createTransientDetector,
  type TransientDetector,
  type TransientInput,
  type TransientObservation,
} from './transient';
