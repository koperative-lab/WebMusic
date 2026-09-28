// ============================================================================
// Shared analysis result types. Pure data shapes — no DOM, no audio globals —
// so this module is safe to import from a worker, Node, or SSR.
// ============================================================================

import type {AudioPeaks, BeatGrid} from '../../core';

/** The analysis tasks `createAudioAnalysisSession` can run, by name. */
export type AudioAnalysisTask =
  | 'peaks'
  | 'loudness'
  | 'tempo'
  | 'key'
  | 'onsets'
  | 'pitch'
  | 'spectrogram'
  | 'features';

/** RMS / peak / LUFS loudness measures (see {@link measureLoudness}). */
export interface LoudnessResult {
  /** Linear root-mean-square amplitude over the whole clip, in [0, 1]. */
  rms: number;
  /** Compatibility field: maximum absolute sample in dBFS, not oversampled inter-sample true peak. */
  truePeakDb: number;
  /** Integrated loudness in LUFS (ITU-R BS.1770 K-weighting + gating). */
  integratedLufs: number;
  /** Optional momentary-loudness curve (LUFS per 400 ms window). */
  momentary?: Float32Array;
}

/** Tempo + beat grid estimate (see {@link detectTempo}). */
export interface TempoResult {
  bpm: number;
  /** 0..1 — how confident the estimate is. */
  confidence: number;
  /** Detected beat grid (anchors the clip for sync / looping). */
  grid: BeatGrid;
}

/** Krumhansl–Schmuckler key estimate (see {@link detectAudioKey}). */
export interface AudioKeyResult {
  tonic: string;
  mode: 'major' | 'minor';
  /** 0..1 — gap between the best and runner-up candidate. */
  confidence: number;
  /** All 24 candidates ranked best-first (correlation score each). */
  scores?: Array<{tonic: string; mode: 'major' | 'minor'; score: number}>;
}

/** Per-frame fundamental-frequency track (see {@link trackPitch}). */
export interface PitchTrackResult {
  /** Frame center times in seconds. */
  times: Float32Array;
  /** Detected fundamental in Hz per frame (0 = unvoiced). */
  frequencies: Float32Array;
  /** 0..1 clarity / confidence per frame. */
  confidences: Float32Array;
}

/** STFT magnitude spectrogram (see {@link computeSpectrogram}). */
export interface SpectrogramData {
  /** Frame center times in seconds. */
  times: Float32Array;
  /** Bin center frequencies in Hz (length = `binsPerFrame`). */
  frequencies: Float32Array;
  /** Row-major magnitudes: `magnitudes[frame * binsPerFrame + bin]`. */
  magnitudes: Float32Array;
  /** Number of frequency bins per frame. */
  binsPerFrame: number;
}

/** Meyda frame features (see {@link extractFeatures}). */
export interface AudioFeatureFrames {
  /** Frame center times in seconds. */
  times: Float32Array;
  /** The feature names extracted (Meyda feature identifiers). */
  featureNames: string[];
  /**
   * Per-feature data. Scalar features map to a `Float32Array` of length
   * `frames`; vector features (e.g. `mfcc`, `chroma`) map to an array of
   * per-frame `Float32Array`s.
   */
  features: Record<string, Float32Array | Float32Array[]>;
}

/** Everything an {@link AudioAnalysisSession} can produce. */
export interface AudioAnalysisResult {
  peaks: AudioPeaks;
  loudness: LoudnessResult;
  tempo?: TempoResult;
  key?: AudioKeyResult;
  onsets?: number[];
  pitchTrack?: PitchTrackResult;
  spectrogram?: SpectrogramData;
  features?: AudioFeatureFrames;
}
