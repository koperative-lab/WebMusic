import {dedicatedWorkerScope} from '@webmusic/kernel/worker';
import {ScoreJSONError, scoreFromJSON, type Part, type Score} from '../../core';
import {createAnalysisSession, type AnalysisSession} from './session';
import {
  ANALYSIS_WORKER_PROTOCOL,
  ANALYSIS_WORKER_PROTOCOL_VERSION,
  validateAnalysisWorkerOptions,
  type AnalysisWorkerErrorCode,
  type AnalysisWorkerErrorDetails,
  type AnalysisWorkerRequest,
  type AnalysisWorkerResponse,
  type ScoreJSON,
} from './worker-protocol';

export * from './worker-protocol';

interface PartCacheEntry {
  /** `JSON.stringify` of the part's JSON as last received. */
  key: string;
  /** The Part object the session's current score holds for that JSON. */
  part: Part;
}

/**
 * Per-worker mutable state for {@link handleAnalyzeRequest}. Opaque to
 * callers; create one with {@link createAnalysisWorkerState}.
 */
export interface AnalysisWorkerState {
  session: AnalysisSession | null;
  partCache: Map<string, PartCacheEntry>;
}

export function createAnalysisWorkerState(): AnalysisWorkerState {
  return {session: null, partCache: new Map()};
}

/**
 * Parse an incoming score JSON, reusing the previous update's `Part` objects
 * for parts whose serialized JSON is unchanged. This restores the object
 * identity `AnalysisSession` keys its caches on (the structural sharing that
 * `Score.edit` provides in-process is lost across `postMessage`), so an
 * update that edited one part re-analyzes only that part.
 */
function reviveScore(state: AnalysisWorkerState, json: ScoreJSON): Score {
  let score = scoreFromJSON(json);
  const rawParts: unknown[] = Array.isArray((json as {parts?: unknown[]})?.parts)
    ? (json as {parts: unknown[]}).parts
    : [];
  const nextCache = new Map<string, PartCacheEntry>();
  for (let index = 0; index < score.parts.length && index < rawParts.length; index += 1) {
    const parsed = score.parts[index];
    const key = JSON.stringify(rawParts[index]);
    const previous = state.partCache.get(parsed.id);
    if (previous && previous.key === key) {
      score = score.withPart(previous.part); // replaces in place, keeps order
      nextCache.set(parsed.id, previous);
    } else {
      nextCache.set(parsed.id, {key, part: parsed});
    }
  }
  state.partCache = nextCache;
  return score;
}

/**
 * Pure message handler behind the worker: takes the worker's mutable state
 * and one request, returns the response to post back. Factored out of the
 * `self.onmessage` wiring so it can be unit-tested in Node without a Worker.
 */
export function handleAnalyzeRequest(
  state: AnalysisWorkerState,
  message: unknown,
): AnalysisWorkerResponse {
  const id = requestId(message);
  if (!isRecord(message)) {
    return failure(id, 'invalid-request', 'protocol', 'Analysis worker request must be an object');
  }
  if (id < 0) {
    return failure(id, 'invalid-request', 'protocol', 'Analysis worker request id must be a non-negative safe integer');
  }
  if (message.protocol !== ANALYSIS_WORKER_PROTOCOL) {
    return failure(
      id,
      'unsupported-protocol',
      'protocol',
      `Unsupported analysis worker protocol ${String(message.protocol)}; expected ${ANALYSIS_WORKER_PROTOCOL}`,
    );
  }
  if (message.protocolVersion !== ANALYSIS_WORKER_PROTOCOL_VERSION) {
    return failure(
      id,
      'unsupported-protocol',
      'protocol',
      `Unsupported analysis worker protocol ${String(message.protocolVersion)}; expected ${ANALYSIS_WORKER_PROTOCOL_VERSION}`,
    );
  }
  if (message.action !== 'analyze' && message.action !== 'update') {
    return failure(
      id,
      'invalid-request',
      'protocol',
      `Unsupported analysis worker action "${String(message.action)}"`,
    );
  }
  if (!('score' in message)) {
    return failure(id, 'invalid-request', message.action, 'Analysis worker request is missing score');
  }
  if (message.action === 'analyze') {
    const optionsError = validateAnalysisWorkerOptions(message.options);
    if (optionsError) {
      return failure(id, 'invalid-request', 'analyze', optionsError);
    }
  }

  const request = message as unknown as AnalysisWorkerRequest;
  try {
    const score = reviveScore(state, request.score);
    if (request.action === 'analyze' || !state.session) {
      const options = request.action === 'analyze' ? (request.options ?? {}) : {};
      state.session = createAnalysisSession(score, options);
      return {
        protocol: ANALYSIS_WORKER_PROTOCOL,
        protocolVersion: ANALYSIS_WORKER_PROTOCOL_VERSION,
        id: request.id,
        ok: true,
        result: state.session.result,
      };
    }
    return {
      protocol: ANALYSIS_WORKER_PROTOCOL,
      protocolVersion: ANALYSIS_WORKER_PROTOCOL_VERSION,
      id: request.id,
      ok: true,
      result: state.session.update(score),
    };
  } catch (error) {
    const message_ = error instanceof Error ? error.message : String(error);
    return failure(
      request.id,
      'analysis-failed',
      request.action,
      message_,
      error instanceof ScoreJSONError ? error.code : undefined,
    );
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requestId(value: unknown): number {
  return isRecord(value) && typeof value.id === 'number' && Number.isSafeInteger(value.id)
    ? value.id
    : -1;
}

function failure(
  id: number,
  code: AnalysisWorkerErrorCode,
  operation: AnalysisWorkerErrorDetails['operation'],
  message: string,
  causeCode?: string,
): AnalysisWorkerResponse {
  return {
    protocol: ANALYSIS_WORKER_PROTOCOL,
    protocolVersion: ANALYSIS_WORKER_PROTOCOL_VERSION,
    id,
    ok: false,
    error: message,
    errorDetails: {
      version: 1,
      code,
      operation,
      message,
      retryable: false,
      ...(causeCode ? {causeCode} : {}),
    },
  };
}

// ---------------------------------------------------------------------------
// Self-registration — only inside a real (dedicated) worker scope. Importing
// this module from Node, SSR, or a browser main thread is a no-op, so the
// pure handler above stays unit-testable everywhere.
// ---------------------------------------------------------------------------

const scope = dedicatedWorkerScope();
if (scope) {
  const state = createAnalysisWorkerState();
  scope.addEventListener('message', (event) => {
    scope.postMessage(handleAnalyzeRequest(state, event.data));
  });
}

