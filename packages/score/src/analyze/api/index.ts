// ============================================================================
// @webmusic/score/analyze/api — the stateless API: one-shot score analysis (key,
// chords, roman numerals, motifs, voice leading, summary). Pure functions in /
// data out, no DOM and no long-lived resource ownership.
//
// The package's other layers build on this one:
//   @webmusic/score/analyze/headless  — incremental stateful analysis
//   @webmusic/score/analyze/element  — Web Components (<live-chord>, …)
// ============================================================================

export {identifyChord, identifyChordFromMidi, segmentChords} from '../core';
export {detectKey} from '../core';
export {distributions, type DistributionBin, type Distributions} from '../core';
export {findMotifs, rhythmPatterns} from '../core';
export {romanNumeralForChord, romanNumerals, type RomanNumeralOptions} from '../core';
export {voiceLeading} from '../core';
// Incremental re-analysis for live editing (`createAnalysisSession`) is a
// stateful analysis session — it lives at `@webmusic/score/analyze/headless`,
// keeping this entry purely the stateless analysis API.
// Headless summary + basic chord timeline (moved here from @webmusic/score).
export {
  chordTimeline,
  summarizeScore,
  type ChordTimelineOptions,
  type ChordTimelineSegment,
  type ScoreSummary,
} from '../core';
export type {
  ChordSegment,
  ChordWindowOptions,
  Key,
  KeyResult,
  Motif,
  MotifOptions,
  RhythmPattern,
  RNAResult,
  VoiceLeadingIssue,
} from '../core';

// User-facing configuration and result contracts for the code-only stateful
// components. Type-only re-exports keep this stateless runtime entry free of
// session/worker implementation code.
export type {AnalysisResult, AnalysisSessionOptions} from '../headless/session';
export type {LiveChordState} from '../headless/live-trackers';
