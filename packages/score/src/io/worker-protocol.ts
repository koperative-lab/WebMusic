// ============================================================================
// Parse-worker protocol: the message shapes exchanged between the main-thread
// client (`worker-client.ts`) and the worker entry (`worker.ts`), plus the
// pure request handler. Keeping the handler here — free of any worker-global
// access — makes it unit-testable in plain Node.
// ============================================================================

import type {Score} from '../core';
import type {ScoreDiagnostic} from './diagnostics';
import {loadScoreDetailed, type LoadScoreOptions, type ScoreFormat} from './load';

/** Stable identity and major version for worker messages. */
export const PARSE_WORKER_PROTOCOL = '@webmusic/score/io/parse-worker' as const;
export const PARSE_WORKER_PROTOCOL_VERSION = 1 as const;

/** Format hint accepted by the parse worker; `'auto'` sniffs the bytes. */
export type ParseWorkerFormat = ScoreFormat | 'auto';

interface ParseRequestPayload {
  /** Correlation id chosen by the client; echoed back on the response. */
  id: number;
  /** `parse-detailed` retains diagnostics without changing `parse` output. */
  action: 'parse' | 'parse-detailed';
  /** Optional format hint; omitted or `'auto'` triggers byte sniffing. */
  format?: ParseWorkerFormat;
  /** Raw score bytes/text. ArrayBuffers may arrive transferred (zero-copy). */
  data: string | ArrayBuffer;
  /** Optional resource-limit overrides forwarded by {@link ParserWorker}. */
  options?: Omit<LoadScoreOptions, 'format' | 'signal' | 'timeoutMs'>;
}

interface LegacyParseEnvelope {
  protocol?: never;
  protocolVersion?: never;
}

interface V1ParseEnvelope {
  protocol: typeof PARSE_WORKER_PROTOCOL;
  protocolVersion: typeof PARSE_WORKER_PROTOCOL_VERSION;
}

/**
 * Request posted to the parse worker. Legacy v0 omits both protocol fields;
 * v1 requires both, so the public type cannot construct a partial header that
 * the runtime would reject.
 */
export type ParseRequest = ParseRequestPayload & (LegacyParseEnvelope | V1ParseEnvelope);

/** Best-effort cancellation for one parse request. */
export interface CancelParseRequest {
  protocol: typeof PARSE_WORKER_PROTOCOL;
  protocolVersion: typeof PARSE_WORKER_PROTOCOL_VERSION;
  id: number;
  action: 'cancel';
}

export type ParseWorkerRequest = ParseRequest | CancelParseRequest;

/** Plain-JSON shape produced by `Score#toJSON()` (structured-clone safe). */
export type ScoreJSON = ReturnType<Score['toJSON']>;

export type ParseWorkerErrorCode =
  | 'invalid-request'
  | 'unsupported-protocol'
  | 'score-input-limit'
  | 'score-load-aborted'
  | 'score-load-timeout'
  | 'abc-parse-limit'
  | 'mxl-parse-limit'
  | 'parse-failed';

/** Versioned error details returned alongside the compatibility error text. */
export interface ParseWorkerError {
  version: 1;
  name: string;
  message: string;
  code: ParseWorkerErrorCode | (string & {});
  operation: 'protocol' | 'parse' | 'cancel';
  retryable: boolean;
  timeoutMs?: number;
}

interface ParseResponseId {
  id: number;
}

export type ParseResponse =
  | (ParseResponseId &
      (LegacyParseEnvelope | V1ParseEnvelope) &
      {ok: true; score: ScoreJSON; diagnostics?: readonly ScoreDiagnostic[]})
  | (ParseResponseId & LegacyParseEnvelope & {ok: false; error: string; errorDetail?: ParseWorkerError})
  | (ParseResponseId & V1ParseEnvelope & {ok: false; error: string; errorDetail: ParseWorkerError});

/**
 * Handle one parse request. Pure: takes a message, returns a response, never
 * throws (parse failures become `{ok: false, error}` responses) and never
 * touches worker globals — `worker.ts` wires it to `onmessage`.
 */
export function handleParseRequest(msg: ParseRequest, signal?: AbortSignal): Promise<ParseResponse>;
export async function handleParseRequest(msg: unknown, signal?: AbortSignal): Promise<ParseResponse> {
  const record = isRecord(msg) ? msg : undefined;
  const id = record && Number.isSafeInteger(record.id) && (record.id as number) >= 0
    ? record.id as number
    : -1;
  let operation: ParseWorkerError['operation'] = 'protocol';
  try {
    if (!record) throw codedError('invalid-request', 'Parse worker request must be an object');
    if (id < 0) throw codedError('invalid-request', 'Parse request id must be a non-negative safe integer');
    // Runtime input can violate the public union (postMessage is untyped), so
    // validate a deliberately widened envelope rather than asking TypeScript
    // to narrow an impossible partial-header state.
    const envelope = record;
    const hasProtocol = envelope.protocol !== undefined;
    const hasProtocolVersion = envelope.protocolVersion !== undefined;
    if (hasProtocol !== hasProtocolVersion) {
      throw codedError(
        'invalid-request',
        'Parser worker protocol and protocolVersion must either both be present or both be omitted for legacy v0',
      );
    }
    if (hasProtocol && envelope.protocol !== PARSE_WORKER_PROTOCOL) {
      throw codedError('unsupported-protocol', `Unsupported parser worker protocol "${String(envelope.protocol)}"`);
    }
    if (hasProtocolVersion && envelope.protocolVersion !== PARSE_WORKER_PROTOCOL_VERSION) {
      throw codedError(
        'unsupported-protocol',
        `Unsupported parser worker protocol version ${String(envelope.protocolVersion)} (expected ${PARSE_WORKER_PROTOCOL_VERSION})`,
      );
    }
    if (record.action !== 'parse' && record.action !== 'parse-detailed') {
      throw codedError(
        'invalid-request',
        `Unsupported action "${String(record.action)}" (expected "parse" or "parse-detailed")`,
      );
    }
    if (
      record.format !== undefined &&
      record.format !== 'auto' &&
      record.format !== 'midi' &&
      record.format !== 'mxl' &&
      record.format !== 'musicxml' &&
      record.format !== 'abc'
    ) {
      throw codedError('invalid-request', `Unsupported parser worker format "${String(record.format)}"`);
    }
    operation = 'parse';
    if (typeof record.data !== 'string' && !(record.data instanceof ArrayBuffer)) {
      throw codedError('invalid-request', 'Parse request data must be a string or ArrayBuffer');
    }
    if (record.options !== undefined && !isRecord(record.options)) {
      throw codedError('invalid-request', 'Parse request options must be an object when provided');
    }
    const request = record as unknown as ParseRequest;
    const format = request.format && request.format !== 'auto' ? request.format : undefined;
    const result = await loadScoreDetailed(request.data, {...request.options, format, signal});
    return {
      protocol: PARSE_WORKER_PROTOCOL,
      protocolVersion: PARSE_WORKER_PROTOCOL_VERSION,
      id,
      ok: true,
      score: result.score.toJSON(),
      ...(request.action === 'parse-detailed' ? {diagnostics: result.diagnostics} : {}),
    };
  } catch (err) {
    const errorDetail = serializeWorkerError(err, signal?.aborted ? 'cancel' : operation);
    return {
      protocol: PARSE_WORKER_PROTOCOL,
      protocolVersion: PARSE_WORKER_PROTOCOL_VERSION,
      id,
      ok: false,
      error: errorDetail.message,
      errorDetail,
    };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function serializeWorkerError(
  error: unknown,
  operation: ParseWorkerError['operation'],
): ParseWorkerError {
  if (!(error instanceof Error)) {
    return {
      version: 1,
      name: 'Error',
      message: String(error),
      code: 'parse-failed',
      operation,
      retryable: false,
    };
  }
  const code = (error as Error & {code?: unknown}).code;
  const stableCode = typeof code === 'string'
    ? code
    : error.name === 'AbortError'
      ? 'score-load-aborted'
      : error.name === 'ScoreLoadTimeoutError'
        ? 'score-load-timeout'
        : 'parse-failed';
  const timeoutMs = (error as Error & {timeoutMs?: unknown}).timeoutMs;
  return {
    version: 1,
    name: error.name || 'Error',
    message: error.message,
    code: stableCode,
    operation,
    retryable: stableCode === 'score-load-timeout',
    ...(Number.isSafeInteger(timeoutMs) ? {timeoutMs: timeoutMs as number} : {}),
  };
}

function codedError(code: ParseWorkerErrorCode, message: string): Error {
  return Object.assign(new Error(message), {code});
}
