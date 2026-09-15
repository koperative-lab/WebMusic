// ============================================================================
// Main-thread client for the parse worker. `createParserWorker()` moves
// MusicXML / MXL / MIDI / ABC parsing off the main thread: the worker parses
// and posts back plain Score JSON, which is cheaply rebuilt here with
// `scoreFromJSON`. Where Workers don't exist (Node, SSR, very old browsers)
// — or constructing one throws — the client transparently falls back to
// synchronous in-process parsing behind the same Promise API.
// ============================================================================

import {scoreFromJSON, type Score} from '../core';
import {
  abortReason,
  createScoreCancellationContext,
  raceWithScoreAbort,
  type ScoreCancellationContext,
} from './cancellation';
import type {ScoreParseResult} from './diagnostics';
import {ABCParseLimitError} from './formats/abc';
import {MIDIParseLimitError} from './formats/midi';
import {MusicXMLParseLimitError} from './formats/musicxml';
import {MXLParseLimitError} from './formats/mxl';
import {createRequestTracker, type WorkerLike} from '@webmusic/kernel/worker';
import {
  assertScoreInputByteLength,
  formatFromExtension,
  loadScoreDetailed,
  readScoreResponse,
  resolveLoadScoreLimits,
  scoreInputByteLengthAtMost,
  ScoreInputLimitError,
  ScoreLoadAbortError,
  ScoreLoadTimeoutError,
  type LoadScoreOptions,
} from './load';
import {
  PARSE_WORKER_PROTOCOL,
  PARSE_WORKER_PROTOCOL_VERSION,
  type CancelParseRequest,
  type ParseRequest,
  type ParseResponse,
  type ParseWorkerError,
  type ParseWorkerFormat,
} from './worker-protocol';

/** Structured remote failure returned by the versioned parser Worker. */
export class ParserWorkerRemoteError extends Error {
  readonly code: string;
  readonly operation: ParseWorkerError['operation'];
  readonly retryable: boolean;
  readonly timeoutMs?: number;

  constructor(details: ParseWorkerError) {
    super(details.message);
    this.name = details.name || 'ParserWorkerRemoteError';
    this.code = details.code;
    this.operation = details.operation;
    this.retryable = details.retryable;
    this.timeoutMs = details.timeoutMs;
  }
}

// Re-export seam: request plumbing lives in the shared kernel and is bundled
// into this package's dist at build time (no runtime dependency).
export {createRequestTracker, type RequestTracker, type WorkerLike} from '@webmusic/kernel/worker';

/** Handle returned by {@link createParserWorker}. */
export interface ParserWorker {
  /** Parse a call-time snapshot; caller-owned binary input is never mutated or detached. */
  parse(data: ArrayBuffer | Uint8Array | string, format?: ParseWorkerFormat, options?: ParserWorkerOptions): Promise<Score>;
  /** Parse score bytes/text and preserve detailed format diagnostics when available. */
  parseDetailed(
    data: ArrayBuffer | Uint8Array | string,
    format?: ParseWorkerFormat,
    options?: ParserWorkerOptions,
  ): Promise<ScoreParseResult>;
  /**
   * Fetch a score on the main thread (workers may lack the page's cookies /
   * relative base) and transfer the client-owned response bytes to the worker.
   */
  loadFromUrl(url: string, format?: ParseWorkerFormat, options?: ParserWorkerOptions): Promise<Score>;
  /** Fetch then parse while preserving detailed format diagnostics when available. */
  loadFromUrlDetailed(
    url: string,
    format?: ParseWorkerFormat,
    options?: ParserWorkerOptions,
  ): Promise<ScoreParseResult>;
  /** Terminate the worker; in-flight requests reject. Idempotent. */
  dispose(): void;
}

/** Per-call limits and cancellation accepted by the worker client. */
export type ParserWorkerOptions = Omit<LoadScoreOptions, 'format'>;

// ---------------------------------------------------------------------------
// Request-id correlation (pure, exported for unit tests)
// ---------------------------------------------------------------------------


// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

function defaultWorkerFactory(): WorkerLike {
  // The `new Worker(new URL(..., import.meta.url))` pattern is statically
  // analyzable by Vite / webpack / Rollup, which bundle the worker entry
  // alongside this file. If your bundler can't handle it, pass your own
  // Worker (or factory) to `createParserWorker` instead.
  if (typeof import.meta.url !== 'string') {
    throw new Error('Default parser Worker URL is unavailable in this module format');
  }
  return new Worker(new URL('./worker.js', import.meta.url), {type: 'module'});
}

function toTransferPayload(
  data: ArrayBuffer | string,
): {data: string | ArrayBuffer; transfer: Transferable[]} {
  if (typeof data === 'string') return {data, transfer: []};
  // Every binary value reaching requestParse is already client-owned: either
  // a bounded public-input snapshot or a bounded URL response buffer.
  return {data, transfer: [data]};
}

/**
 * Validate before allocating, then snapshot caller-owned binary data exactly
 * once. Both Worker and fallback routes consume this private immutable-by-
 * convention buffer, so mutations after parse() cannot change the operation.
 */
function snapshotPublicParseInput(
  data: ArrayBuffer | Uint8Array | string,
  options: ParserWorkerOptions,
): ArrayBuffer | string {
  const {maxInputBytes} = resolveLoadScoreLimits(options);
  if (typeof data === 'string') {
    assertScoreInputByteLength(scoreInputByteLengthAtMost(data, maxInputBytes), maxInputBytes, 'input');
    return data;
  }
  assertScoreInputByteLength(data.byteLength, maxInputBytes, 'input');
  const source = data instanceof Uint8Array ? data : new Uint8Array(data);
  const copy = new Uint8Array(source.byteLength);
  copy.set(source);
  return copy.buffer as ArrayBuffer;
}

/**
 * Create a parser that runs format parsing in a Web Worker, keeping the main
 * thread free (parsing a large file takes 100–400ms; rebuilding the returned
 * Score JSON takes ~50ms). Without arguments it spawns the bundler-friendly
 * `new Worker(new URL('./worker.js', import.meta.url), {type: 'module'})`;
 * pass a `Worker` instance or a factory when that pattern doesn't survive
 * your bundler. If `Worker` is unavailable (Node / SSR) or construction
 * fails, every call parses in-process instead — same API, no worker.
 */
export function createParserWorker(workerOrFactory?: WorkerLike | (() => WorkerLike)): ParserWorker {
  const tracker = createRequestTracker<ParseResponse & {ok: true}>();
  const activeOperations = new Set<ScoreCancellationContext>();
  // A cancelled request is removed from the tracker before its best-effort
  // Worker response can arrive. Only those explicitly known late ids may be
  // ignored; every other unknown id is a protocol failure that must settle
  // current work instead of leaving it pending forever.
  const cancelledResponseIds = new Set<number>();
  let worker: WorkerLike | undefined;
  let disposed = false;
  /** Whether we already tried (and failed) to get a worker this session. */
  let fallback = false;
  /** A factory/default worker can be recreated after a runtime failure. */
  const canRestartWorker = workerOrFactory == null || typeof workerOrFactory === 'function';

  function retireWorker(error: Error): void {
    const failedWorker = worker;
    worker = undefined;
    // A caller-owned single Worker cannot be brought back. Subsequent calls
    // deliberately use the documented in-process fallback rather than posting
    // to a dead object and leaving a promise pending forever.
    if (!canRestartWorker) fallback = true;
    cancelledResponseIds.clear();
    tracker.rejectAll(error);
    try {
      failedWorker?.terminate();
    } catch {
      // A crashed Worker may reject terminate(); it is already unusable.
    }
  }

  function obtainWorker(): WorkerLike | undefined {
    if (disposed || fallback || worker) return worker;
    let candidate: WorkerLike | undefined;
    try {
      if (typeof workerOrFactory === 'function') candidate = workerOrFactory();
      else if (workerOrFactory) candidate = workerOrFactory;
      else if (typeof Worker === 'function') candidate = defaultWorkerFactory();
    } catch {
      candidate = undefined;
    }
    // Factories are application code and may dispose this client before
    // returning ownership of their Worker. Never publish that late resource.
    if (disposed) {
      try { candidate?.terminate(); } catch { /* already retired */ }
      return undefined;
    }
    worker = candidate;
    if (!worker) {
      fallback = true;
      return undefined;
    }
    const attachedWorker = worker;
    attachedWorker.addEventListener('message', (event: MessageEvent) => {
      if (worker !== attachedWorker || disposed) return;
      const response = event.data as Partial<ParseResponse> | undefined;
      if (!isCompatibleResponse(response)) {
        retireWorker(new Error('Parser worker returned an incompatible or malformed protocol response'));
        return;
      }
      if (cancelledResponseIds.delete(response.id)) return;
      const settled = response.ok
        ? tracker.resolve(response.id, response)
        : tracker.reject(response.id, errorFromResponse(response));
      if (!settled) {
        retireWorker(new Error(`Parser worker returned unknown request id ${response.id}`));
      }
    });
    attachedWorker.addEventListener('error', (event: ErrorEvent) => {
      if (worker !== attachedWorker || disposed) return;
      retireWorker(new Error(`Parser worker failed: ${event.message ?? 'unknown error'}`));
    });
    return attachedWorker;
  }

  async function parse(
    data: ArrayBuffer | Uint8Array | string,
    format?: ParseWorkerFormat,
    options: ParserWorkerOptions = {},
  ): Promise<Score> {
    return runOperation(options, async (operation) => {
      const snapshot = snapshotPublicParseInput(data, options);
      return (await requestParse(snapshot, format, options, false, operation)).score;
    });
  }

  async function parseDetailed(
    data: ArrayBuffer | Uint8Array | string,
    format?: ParseWorkerFormat,
    options: ParserWorkerOptions = {},
  ): Promise<ScoreParseResult> {
    return runOperation(options, (operation) => {
      const snapshot = snapshotPublicParseInput(data, options);
      return requestParse(snapshot, format, options, true, operation);
    });
  }

  async function loadFromUrl(
    url: string,
    format?: ParseWorkerFormat,
    options: ParserWorkerOptions = {},
  ): Promise<Score> {
    return (await loadFromUrlDetailed(url, format, options)).score;
  }

  async function loadFromUrlDetailed(
    url: string,
    format?: ParseWorkerFormat,
    options: ParserWorkerOptions = {},
  ): Promise<ScoreParseResult> {
    return runOperation(options, async (operation) => {
      const response = await raceWithScoreAbort(fetch(url, {signal: operation.signal}), operation.signal);
      if (!response.ok) {
        cancelResponseBody(response.body);
        throw new Error(`Failed to load score from ${url}: ${response.status} ${response.statusText}`);
      }
      const limits = resolveLoadScoreLimits(options);
      const buffer = await readScoreResponse(
        response,
        limits.maxInputBytes,
        `response from ${url}`,
        operation.signal,
      );
      operation.throwIfAborted();
      // `readScoreResponse` allocated this buffer for this operation, so the
      // Worker route may transfer it without violating caller ownership.
      return requestParse(
        buffer,
        format ?? formatFromExtension(url) ?? 'auto',
        options,
        true,
        operation,
      );
    });
  }

  async function runOperation<T>(
    options: ParserWorkerOptions,
    task: (operation: ScoreCancellationContext) => Promise<T>,
  ): Promise<T> {
    if (disposed) throw new Error('Parser worker has been disposed');
    const operation = createScoreCancellationContext(options);
    activeOperations.add(operation);
    try {
      operation.throwIfAborted();
      const result = await raceWithScoreAbort(task(operation), operation.signal);
      operation.throwIfAborted();
      return result;
    } finally {
      activeOperations.delete(operation);
      operation.dispose();
    }
  }

  async function requestParse(
    data: ArrayBuffer | string,
    format: ParseWorkerFormat | undefined,
    options: ParserWorkerOptions,
    detailed: boolean,
    operation: ScoreCancellationContext,
  ): Promise<ScoreParseResult> {
    operation.throwIfAborted();
    const resolvedFormat = format && format !== 'auto' ? format : undefined;
    const safeOptions = workerSafeOptions(options);
    const target = obtainWorker();
    operation.throwIfAborted();
    if (!target) {
      // In-process parsers cannot all be preempted mid-call. The abort race
      // still rejects promptly for async work and suppresses every late result.
      const result = await raceWithScoreAbort(
        loadScoreDetailed(data, {...safeOptions, format: resolvedFormat, signal: operation.signal}),
        operation.signal,
      );
      return detailed ? result : {score: result.score, diagnostics: EMPTY_DIAGNOSTICS};
    }
    const {data: payload, transfer} = toTransferPayload(data);
    const {id, promise} = tracker.add();
    const request: ParseRequest = {
      protocol: PARSE_WORKER_PROTOCOL,
      protocolVersion: PARSE_WORKER_PROTOCOL_VERSION,
      id,
      action: detailed ? 'parse-detailed' : 'parse',
      format: resolvedFormat ?? 'auto',
      data: payload,
      options: safeOptions,
    };
    const cancelRequest: CancelParseRequest = {
      protocol: PARSE_WORKER_PROTOCOL,
      protocolVersion: PARSE_WORKER_PROTOCOL_VERSION,
      id,
      action: 'cancel',
    };
    const onAbort = () => {
      if (!tracker.reject(id, abortReason(operation.signal))) return;
      rememberCancelledResponseId(cancelledResponseIds, id);
      try {
        target.postMessage(cancelRequest);
      } catch {
        // The local promise is already rejected; cancellation is best-effort.
      }
    };
    operation.signal.addEventListener('abort', onAbort, {once: true});
    if (operation.signal.aborted) onAbort();
    try {
      if (!operation.signal.aborted) target.postMessage(request, transfer);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      retireWorker(new Error(`Parser worker failed to accept a request: ${message}`));
    }
    try {
      const response = await promise;
      operation.throwIfAborted();
      return {
        score: scoreFromJSON(response.score as Parameters<typeof scoreFromJSON>[0]),
        diagnostics: detailed ? Object.freeze([...(response.diagnostics ?? [])]) : EMPTY_DIAGNOSTICS,
      };
    } finally {
      operation.signal.removeEventListener('abort', onAbort);
    }
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    const error = new Error('Parser worker has been disposed');
    for (const operation of activeOperations) operation.abort(error);
    tracker.rejectAll(error);
    cancelledResponseIds.clear();
    try {
      worker?.terminate();
    } catch {
      // A crashed Worker may throw while being terminated.
    }
    worker = undefined;
  }

  return {parse, parseDetailed, loadFromUrl, loadFromUrlDetailed, dispose};
}

const MAX_CANCELLED_RESPONSE_IDS = 1024;

function rememberCancelledResponseId(ids: Set<number>, id: number): void {
  if (ids.size >= MAX_CANCELLED_RESPONSE_IDS) {
    const oldest = ids.values().next().value as number | undefined;
    if (oldest != null) ids.delete(oldest);
  }
  ids.add(id);
}

function cancelResponseBody(body: ReadableStream<Uint8Array> | null | undefined): void {
  try {
    const cancellation = body?.cancel();
    if (cancellation) void Promise.resolve(cancellation).catch(() => {});
  } catch {
    // Cancellation is best-effort. Preserve the useful HTTP error below.
  }
}

const EMPTY_DIAGNOSTICS: ScoreParseResult['diagnostics'] = Object.freeze([]);

function workerSafeOptions(
  options: ParserWorkerOptions,
): Omit<LoadScoreOptions, 'format' | 'signal' | 'timeoutMs'> {
  return {
    ...(options.maxInputBytes == null ? {} : {maxInputBytes: options.maxInputBytes}),
    ...(options.abc == null ? {} : {abc: options.abc}),
    ...(options.midi == null ? {} : {midi: options.midi}),
    ...(options.musicxml == null ? {} : {musicxml: options.musicxml}),
    ...(options.mxl == null ? {} : {mxl: options.mxl}),
  };
}

function isCompatibleResponse(response: Partial<ParseResponse> | undefined): response is ParseResponse {
  if (
    !response ||
    !Number.isSafeInteger(response.id) ||
    (response.id as number) < 0 ||
    typeof response.ok !== 'boolean'
  ) return false;
  const payload = response as Partial<ParseResponse> & {
    score?: unknown;
    diagnostics?: unknown;
    error?: unknown;
    errorDetail?: unknown;
  };
  const hasProtocolHeader = response.protocol !== undefined || response.protocolVersion !== undefined;
  const isLegacyResponse = response.protocol === undefined && response.protocolVersion === undefined;
  if (
    hasProtocolHeader &&
    (response.protocol !== PARSE_WORKER_PROTOCOL || response.protocolVersion !== PARSE_WORKER_PROTOCOL_VERSION)
  ) {
    return false;
  }
  if (response.ok) {
    return typeof payload.score === 'object' &&
      payload.score != null &&
      (payload.diagnostics === undefined ||
        (Array.isArray(payload.diagnostics) && payload.diagnostics.every(isScoreDiagnostic)));
  }
  return typeof payload.error === 'string' &&
    (isLegacyResponse
      ? payload.errorDetail === undefined || isParseWorkerError(payload.errorDetail)
      : isParseWorkerError(payload.errorDetail));
}

function errorFromResponse(response: ParseResponse & {ok: false}): Error {
  const details = response.errorDetail;
  if (!details) return new Error(response.error);
  switch (details.code) {
    case 'score-input-limit':
      return new ScoreInputLimitError(details.message);
    case 'score-load-aborted':
      return new ScoreLoadAbortError(details.message);
    case 'score-load-timeout':
      return details.timeoutMs === undefined
        ? new ParserWorkerRemoteError(details)
        : new ScoreLoadTimeoutError(details.timeoutMs);
    case 'abc-parse-limit':
      return new ABCParseLimitError(details.message);
    case 'mxl-parse-limit':
      return new MXLParseLimitError(details.message);
    case 'midi-parse-limit':
      return new MIDIParseLimitError(details.message);
    case 'musicxml-parse-limit':
      return new MusicXMLParseLimitError(details.message);
    default:
      return new ParserWorkerRemoteError(details);
  }
}

function isParseWorkerError(value: unknown): value is ParseWorkerError {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const detail = value as Partial<ParseWorkerError>;
  return detail.version === 1 &&
    typeof detail.name === 'string' &&
    typeof detail.message === 'string' &&
    typeof detail.code === 'string' &&
    (detail.operation === 'protocol' || detail.operation === 'parse' || detail.operation === 'cancel') &&
    typeof detail.retryable === 'boolean' &&
    (detail.timeoutMs === undefined ||
      (Number.isSafeInteger(detail.timeoutMs) && (detail.timeoutMs as number) >= 1));
}

function isScoreDiagnostic(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const diagnostic = value as Record<string, unknown>;
  if (
    typeof diagnostic.code !== 'string' ||
    (diagnostic.severity !== 'info' && diagnostic.severity !== 'warning') ||
    (diagnostic.format !== 'musicxml' &&
      diagnostic.format !== 'mxl' &&
      diagnostic.format !== 'midi' &&
      diagnostic.format !== 'abc') ||
    typeof diagnostic.message !== 'string'
  ) return false;
  if (diagnostic.location === undefined) return true;
  if (typeof diagnostic.location !== 'object' || diagnostic.location === null || Array.isArray(diagnostic.location)) return false;
  const location = diagnostic.location as Record<string, unknown>;
  return (location.partId === undefined || typeof location.partId === 'string') &&
    (location.measureNumber === undefined ||
      (typeof location.measureNumber === 'number' && Number.isFinite(location.measureNumber)));
}
