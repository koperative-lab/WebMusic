// @webmusic/score/analyze/headless — code-only, stateful analysis components.
// These resources consume data/events and return or publish domain results;
// they never create UI, touch the DOM, or carry visual defaults.
export {
  createAnalysisSession,
  type AnalysisResult,
  type AnalysisSession,
  type AnalysisSessionOptions,
} from './session';
export {
  createLiveChordTracker,
  createLiveKeyTracker,
  type LiveChordState,
  type LiveChordTracker,
  type LiveKeyTracker,
} from './live-trackers';
export * from './worker-client';

export {createScoreReport, type ScoreReport} from './report';
export {
  createAnalysisFollower,
  type AnalysisFollower,
  type AnalysisFollowerOptions,
  type AnalysisFollowerState,
  type AnalysisSeekOutcome,
} from './follower';

// Prediction: 20 Hz of cursor in, a position at any instant out. Pure
// arithmetic — every time is an argument, so none of it needs a browser.
export {
  createTransportClock,
  rateFromDurations,
  type TransportClock,
  type TransportClockOptions,
  type TransportReading,
  type TransportSample,
} from './transport-clock';

// The projections: an analysis, shaped for the surfaces that draw it. This is
// where "listing chords out is a headless job" is actually answered — a
// consumer rendering its own markup can call these instead of mounting an
// element, and gets exactly what the element draws.
export * from './workbench';
