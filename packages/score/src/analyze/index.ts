// ============================================================================
// @webmusic/score/analyze — score analysis in three public layers:
//
//   @webmusic/score/analyze           — this root entry, the stateless API:
//                                 one-shot analysis functions (detectKey,
//                                 segmentChords, romanNumerals, findMotifs,
//                                 voiceLeading, summarizeScore, …).
//                                 Pure data in / data out, no DOM. `./api` is
//                                 the internal source directory backing it.
//   @webmusic/score/analyze/headless  — code-only stateful analysis components:
//                                 createAnalysisSession, live chord/key
//                                 trackers and the Worker client. No UI/DOM.
//   @webmusic/score/analyze/element  — live musical surfaces: score-following
//                                 key/chord/Roman/voice-leading lanes,
//                                 and current chord names.
//                                 Whole-score reports remain data APIs.
//
// Element implementation details live under src/element/internal and are not
// part of the package's public API. Worker clients use
// `@webmusic/score/analyze/worker-client`; the self-registering worker runtime is
// published at `@webmusic/score/analyze/worker`.
// ============================================================================

export * from './api';
