import type {Score} from '../../core';
import type {AnalysisResult, AnalysisSessionOptions} from './session';

/**
 * The plain-data shape `Score.toJSON()` produces and `scoreFromJSON` accepts.
 * This type describes the analysis Worker wire payload; callers must still
 * keep metadata structured-clone safe.
 */
export type ScoreJSON = ReturnType<Score['toJSON']>;

/** Stable identity and version for analysis Worker messages. */
export const ANALYSIS_WORKER_PROTOCOL = '@webmusic/score/analyze/analysis-worker' as const;
export const ANALYSIS_WORKER_PROTOCOL_VERSION = 1 as const;

export type AnalysisWorkerErrorCode =
  | 'unsupported-protocol'
  | 'invalid-request'
  | 'analysis-failed'
  | (string & {});

export interface AnalysisWorkerErrorDetails {
  version: 1;
  code: AnalysisWorkerErrorCode;
  operation: 'protocol' | 'analyze' | 'update';
  message: string;
  retryable: boolean;
  causeCode?: string;
}

interface AnalysisWorkerRequestEnvelope {
  protocol: typeof ANALYSIS_WORKER_PROTOCOL;
  protocolVersion: typeof ANALYSIS_WORKER_PROTOCOL_VERSION;
  id: number;
}

/** `analyze`: (re)create the worker-resident session and return a full result. */
export interface AnalyzeRequestMessage extends AnalysisWorkerRequestEnvelope {
  action: 'analyze';
  score: ScoreJSON;
  options?: AnalysisSessionOptions;
}

/** `update`: feed an edited score to the worker-resident session. */
export interface UpdateRequestMessage extends AnalysisWorkerRequestEnvelope {
  action: 'update';
  score: ScoreJSON;
}

export type AnalysisWorkerRequest = AnalyzeRequestMessage | UpdateRequestMessage;

/**
 * Validate the untyped `analyze.options` wire value without rejecting unknown
 * fields that a future protocol version may introduce. Returns an error
 * message for malformed input and `undefined` for a value the current session
 * implementation can safely consume.
 *
 * Kept in this import-safe protocol module so the Worker handler and the
 * in-process fallback enforce the same runtime contract.
 */
export function validateAnalysisWorkerOptions(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) return 'Analysis worker options must be an object when provided';
  if (
    value.windowQuarters !== undefined &&
    (typeof value.windowQuarters !== 'number' || !Number.isFinite(value.windowQuarters))
  ) {
    return 'Analysis worker option windowQuarters must be a finite number';
  }
  for (const name of ['motifLength', 'minOccurrences'] as const) {
    const option = value[name];
    if (
      option !== undefined &&
      (typeof option !== 'number' || !Number.isSafeInteger(option) || option < 1)
    ) {
      return `Analysis worker option ${name} must be a positive safe integer`;
    }
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export type AnalysisWorkerResponse =
  | {
      protocolVersion: typeof ANALYSIS_WORKER_PROTOCOL_VERSION;
      protocol: typeof ANALYSIS_WORKER_PROTOCOL;
      id: number;
      ok: true;
      result: AnalysisResult;
    }
  | {
      protocolVersion: typeof ANALYSIS_WORKER_PROTOCOL_VERSION;
      protocol: typeof ANALYSIS_WORKER_PROTOCOL;
      id: number;
      ok: false;
      /** Compatibility display text; use errorDetails for program logic. */
      error: string;
      errorDetails: AnalysisWorkerErrorDetails;
    };
