/** Current Score JSON schema marker emitted by {@link Score.toJSON}. */
export const SCORE_JSON_SCHEMA_VERSION = '0.1' as const;

/** Exact Score JSON schema identifier accepted by the current reader. */
export const SCORE_JSON_SCHEMA_ID = `https://webscore.dev/schema/score/v${SCORE_JSON_SCHEMA_VERSION}` as const;

/** Stable machine-readable failure categories for Score JSON rehydration. */
export type ScoreJSONErrorCode =
  | 'invalid-json'
  | 'unsupported-schema'
  | 'invalid-score';

/** Error raised when Score JSON cannot be safely rehydrated. */
export class ScoreJSONError extends Error {
  readonly code: ScoreJSONErrorCode;

  constructor(code: ScoreJSONErrorCode, message: string) {
    super(`scoreFromJSON: ${message}`);
    this.name = 'ScoreJSONError';
    this.code = code;
  }
}
