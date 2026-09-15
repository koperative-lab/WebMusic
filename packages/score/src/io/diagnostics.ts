import type {Score} from '../core';

/** Score format that produced a structured normalisation diagnostic. */
export type ScoreDiagnosticFormat = 'musicxml' | 'mxl' | 'midi' | 'abc';

/**
 * Recoverable information loss or normalisation reported by a format adapter.
 * A missing diagnostic does not promise that an interchange document was
 * lossless; it only means that this adapter did not detect a reportable case.
 */
export interface ScoreDiagnostic {
  /** Stable, machine-readable identifier such as `musicxml-note-without-pitch`. */
  code: string;
  severity: 'info' | 'warning';
  format: ScoreDiagnosticFormat;
  message: string;
  location?: {
    partId?: string;
    measureNumber?: number;
  };
}

/** Result of a detailed score-format parse without changing legacy wrappers. */
export interface ScoreParseResult {
  score: Score;
  diagnostics: readonly ScoreDiagnostic[];
}

/** Result shape reserved for detailed serializers. */
export interface ScoreSerializeResult<T> {
  data: T;
  diagnostics: readonly ScoreDiagnostic[];
}
