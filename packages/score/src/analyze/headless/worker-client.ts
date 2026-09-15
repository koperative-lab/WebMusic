import type {Score} from '../../core';
import {spawnDefaultAnalysisWorker} from '../worker-url';
import {
  createAnalysisSession,
  freezeAnalysisResult,
  type AnalysisResult,
  type AnalysisSession,
  type AnalysisSessionOptions,
} from './session';
import {
  ANALYSIS_WORKER_PROTOCOL,
  ANALYSIS_WORKER_PROTOCOL_VERSION,
  validateAnalysisWorkerOptions,
} from './worker-protocol';
import type {
  AnalysisWorkerErrorCode,
  AnalysisWorkerErrorDetails,
  AnalysisWorkerRequest,
  AnalysisWorkerResponse,
  ScoreJSON,
} from './worker-protocol';

export {ANALYSIS_WORKER_PROTOCOL, ANALYSIS_WORKER_PROTOCOL_VERSION} from './worker-protocol';

export type {
  AnalysisWorkerRequest,
  AnalysisWorkerErrorCode,
  AnalysisWorkerErrorDetails,
  AnalysisWorkerResponse,
  AnalyzeRequestMessage,
  ScoreJSON,
  UpdateRequestMessage,
} from './worker-protocol';

/** Structured remote failure returned by the versioned analysis Worker. */
export class AnalysisWorkerRemoteError extends Error {
  readonly code: AnalysisWorkerErrorCode;
  readonly operation: AnalysisWorkerErrorDetails['operation'];
  readonly retryable: boolean;
  readonly causeCode?: string;

  constructor(details: AnalysisWorkerErrorDetails) {
    super(details.message);
    this.name = 'AnalysisWorkerRemoteError';
    this.code = details.code;
    this.operation = details.operation;
    this.retryable = details.retryable;
    this.causeCode = details.causeCode;
  }
}

/**
 * The subset of the `Worker` interface the client needs. A real `Worker`
 * satisfies it; tests can pass a hand-rolled fake.
 */
/** What the client reads off `message` / `error` events. */
export interface AnalysisWorkerEventLike {
  data?: unknown;
  message?: string;
}

export interface AnalysisWorkerLike {
  postMessage(message: unknown): void;
  addEventListener(
    type: 'message' | 'error',
    listener: (event: AnalysisWorkerEventLike) => void,
  ): void;
  removeEventListener?(
    type: 'message' | 'error',
    listener: (event: AnalysisWorkerEventLike) => void,
  ): void;
  terminate(): void;
}

export type AnalysisWorkerFactory = () => AnalysisWorkerLike;

/**
 * Main-thread handle to an analysis running off-thread (or, when Workers are
 * unavailable, to an in-process fallback behind the same Promise API).
 */
export interface AnalysisWorkerClient {
  /**
   * Full analysis; (re)creates the worker-resident session with `options`.
   * Supersedes older pending worker updates; their promises settle with this
   * analysis, or a newer queued input, while this promise retains its own result.
   * Failure of the newest analysis rejects all pending updates and drops their
   * queued score, because the requested session options were not installed.
   */
  analyze(score: Score, options?: AnalysisSessionOptions): Promise<AnalysisResult>;
  /**
   * Incremental re-analysis after an edit. Latest-wins: when several
   * `update` calls overlap, every outstanding promise resolves with the
   * result of the NEWEST score — never with stale data — and scores
   * superseded before they were sent are skipped entirely (the worker only
   * ever analyzes the most recent one).
   */
  update(score: Score): Promise<AnalysisResult>;
  /**
   * Reject all in-flight promises and terminate the worker. A worker passed
   * as a ready-made instance is NOT terminated (the caller owns it); workers
   * the client created itself (default or via factory) are.
   */
  dispose(): void;
}

interface Waiter {
  resolve(result: AnalysisResult): void;
  reject(error: Error): void;
}

class WorkerBackedClient implements AnalysisWorkerClient {
  readonly #worker: AnalysisWorkerLike;
  readonly #ownsWorker: boolean;
  #nextId = 1;
  #disposed = false;
  /** Terminal runtime failure: future calls reject instead of hanging on a dead Worker. */
  #failure: Error | null = null;
  /** Pending `analyze` calls by request id. */
  readonly #analyzeWaiters = new Map<number, Waiter>();
  /** All outstanding `update` promises — settled together, latest-wins. */
  #updateWaiters: Waiter[] = [];
  #inFlightUpdateId: number | null = null;
  /** The newest reanalysis must settle before subsequently queued updates run. */
  #analysisBarrierId: number | null = null;
  /** Already sent updates superseded by reanalysis; their replies are ignored. */
  readonly #retiredUpdateIds = new Set<number>();
  /** Newest score queued behind an update or analysis (older ones dropped). */
  #queuedUpdate: ScoreJSON | null = null;
  #listenersAttached = true;
  readonly #onWorkerMessage = (event: AnalysisWorkerEventLike): void => {
    this.#onMessage(event.data);
  };
  readonly #onWorkerError = (event: AnalysisWorkerEventLike): void => {
    this.#failWorker(new Error(event?.message ?? 'Analysis worker error'));
  };

  constructor(worker: AnalysisWorkerLike, ownsWorker: boolean) {
    this.#worker = worker;
    this.#ownsWorker = ownsWorker;
    try {
      worker.addEventListener('message', this.#onWorkerMessage);
      worker.addEventListener('error', this.#onWorkerError);
    } catch (error) {
      this.#disposed = true;
      this.#detachWorkerListeners();
      if (ownsWorker) {
        try { worker.terminate(); } catch { /* Preserve the construction error. */ }
      }
      throw error;
    }
  }

  analyze(score: Score, options?: AnalysisSessionOptions): Promise<AnalysisResult> {
    if (this.#disposed) return Promise.reject(new Error('AnalysisWorkerClient is disposed'));
    if (this.#failure) return Promise.reject(this.#failure);
    let json: ScoreJSON;
    try { json = score.toJSON(); } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
    if (this.#disposed) return Promise.reject(new Error('AnalysisWorkerClient is disposed'));
    if (this.#failure) return Promise.reject(this.#failure);
    const id = this.#nextId++;
    const promise = new Promise<AnalysisResult>((resolve, reject) => {
      this.#analyzeWaiters.set(id, {resolve, reject});
    });
    if (this.#inFlightUpdateId !== null) this.#retiredUpdateIds.add(this.#inFlightUpdateId);
    this.#inFlightUpdateId = null;
    this.#queuedUpdate = null;
    this.#analysisBarrierId = id;
    this.#post({
      protocol: ANALYSIS_WORKER_PROTOCOL,
      protocolVersion: ANALYSIS_WORKER_PROTOCOL_VERSION,
      id,
      action: 'analyze',
      score: json,
      options,
    });
    return promise;
  }

  update(score: Score): Promise<AnalysisResult> {
    if (this.#disposed) return Promise.reject(new Error('AnalysisWorkerClient is disposed'));
    if (this.#failure) return Promise.reject(this.#failure);
    let json: ScoreJSON;
    try { json = score.toJSON(); } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
    if (this.#disposed) return Promise.reject(new Error('AnalysisWorkerClient is disposed'));
    if (this.#failure) return Promise.reject(this.#failure);
    const promise = new Promise<AnalysisResult>((resolve, reject) => {
      this.#updateWaiters.push({resolve, reject});
    });
    if (this.#inFlightUpdateId === null && this.#analysisBarrierId === null) {
      this.#sendUpdate(json);
    } else {
      this.#queuedUpdate = json; // supersedes any previously queued score
    }
    return promise;
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#failAll(new Error('AnalysisWorkerClient is disposed'));
    this.#detachWorkerListeners();
    if (this.#ownsWorker) this.#worker.terminate();
  }

  #post(message: AnalysisWorkerRequest): void {
    try {
      this.#worker.postMessage(message);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.#failWorker(new Error(`Analysis worker failed to accept a request: ${message}`));
    }
  }

  #sendUpdate(json: ScoreJSON): void {
    const id = this.#nextId++;
    this.#inFlightUpdateId = id;
    this.#post({
      protocol: ANALYSIS_WORKER_PROTOCOL,
      protocolVersion: ANALYSIS_WORKER_PROTOCOL_VERSION,
      id,
      action: 'update',
      score: json,
    });
  }

  #onMessage(value: unknown): void {
    if (this.#disposed || this.#failure) return;
    if (!isResponseRecord(value)) {
      this.#failWorker(new Error('Analysis worker returned a malformed response envelope'));
      return;
    }
    if (
      value.protocol !== ANALYSIS_WORKER_PROTOCOL ||
      value.protocolVersion !== ANALYSIS_WORKER_PROTOCOL_VERSION
    ) {
      this.#failWorker(
        new Error(
          `Unsupported analysis worker response protocol ${String(value.protocol)}@${String(value.protocolVersion)}; ` +
            `expected ${ANALYSIS_WORKER_PROTOCOL}@${ANALYSIS_WORKER_PROTOCOL_VERSION}`,
        ),
      );
      return;
    }
    if (typeof value.ok !== 'boolean') {
      this.#failWorker(new Error('Analysis worker returned a malformed response'));
      return;
    }
    if (value.ok === true && (!('result' in value) || !isAnalysisResult(value.result))) {
      this.#failWorker(new Error('Analysis worker returned a malformed success response'));
      return;
    }
    if (
      value.ok === false &&
      (typeof value.error !== 'string' || !isValidErrorDetails(value.errorDetails))
    ) {
      this.#failWorker(new Error('Analysis worker returned a malformed error response'));
      return;
    }
    const response = value as unknown as AnalysisWorkerResponse;

    const analyzeWaiter = this.#analyzeWaiters.get(response.id);
    if (analyzeWaiter) {
      if (response.ok) {
        const result = this.#freezeRemoteResult(response.result);
        if (!result) return;
        this.#analyzeWaiters.delete(response.id);
        analyzeWaiter.resolve(result);
        if (response.id === this.#analysisBarrierId) {
          this.#analysisBarrierId = null;
          this.#settleUpdates(response, result);
        }
      } else {
        this.#analyzeWaiters.delete(response.id);
        analyzeWaiter.reject(remoteError(response));
        if (response.id === this.#analysisBarrierId) {
          this.#analysisBarrierId = null;
          // The requested options were not installed. Do not silently run a
          // later queued edit against the previous session's options.
          this.#queuedUpdate = null;
          this.#settleUpdates(response);
        }
      }
      return;
    }

    if (this.#retiredUpdateIds.delete(response.id)) return;
    if (response.id !== this.#inFlightUpdateId) {
      this.#failWorker(new Error(`Analysis worker returned unknown request id ${response.id}`));
      return;
    }
    this.#inFlightUpdateId = null;
    this.#settleUpdates(response);
  }

  #settleUpdates(response: AnalysisWorkerResponse, resolved?: AnalysisResult): void {
    if (this.#queuedUpdate !== null) {
      // A newer score arrived while this one was being analyzed: drop this
      // (now stale) result and send the newest score. All waiters — including
      // the callers whose scores were skipped — resolve with the final result.
      const next = this.#queuedUpdate;
      this.#queuedUpdate = null;
      this.#sendUpdate(next);
      return;
    }
    if (response.ok) {
      const result = resolved ?? this.#freezeRemoteResult(response.result);
      if (!result) return;
      const waiters = this.#updateWaiters;
      this.#updateWaiters = [];
      for (const waiter of waiters) waiter.resolve(result);
    } else {
      const waiters = this.#updateWaiters;
      this.#updateWaiters = [];
      const error = remoteError(response);
      for (const waiter of waiters) waiter.reject(error);
    }
  }

  #freezeRemoteResult(result: AnalysisResult): AnalysisResult | undefined {
    try {
      return freezeAnalysisResult(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.#failWorker(
        new Error(`Analysis worker returned a result that could not be made immutable: ${message}`),
      );
      return undefined;
    }
  }

  #failAll(error: Error): void {
    const analyzeWaiters = [...this.#analyzeWaiters.values()];
    this.#analyzeWaiters.clear();
    const updateWaiters = this.#updateWaiters;
    this.#updateWaiters = [];
    this.#inFlightUpdateId = null;
    this.#analysisBarrierId = null;
    this.#retiredUpdateIds.clear();
    this.#queuedUpdate = null;
    for (const waiter of analyzeWaiters) waiter.reject(error);
    for (const waiter of updateWaiters) waiter.reject(error);
  }

  #failWorker(error: Error): void {
    if (this.#disposed || this.#failure) return;
    this.#failure = error;
    this.#failAll(error);
    this.#detachWorkerListeners();
    if (this.#ownsWorker) {
      try {
        this.#worker.terminate();
      } catch {
        // A failed Worker may already be terminated by the runtime.
      }
    }
  }

  #detachWorkerListeners(): void {
    if (!this.#listenersAttached) return;
    this.#listenersAttached = false;
    try { this.#worker.removeEventListener?.('message', this.#onWorkerMessage); } catch { /* Continue cleanup. */ }
    try { this.#worker.removeEventListener?.('error', this.#onWorkerError); } catch { /* Continue cleanup. */ }
  }
}

function isResponseRecord(value: unknown): value is Record<string, unknown> & {id: number} {
  return isObject(value) && Number.isSafeInteger(value.id) && (value.id as number) >= 0;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isValidErrorDetails(value: unknown): value is AnalysisWorkerErrorDetails {
  return isObject(value) &&
    value.version === 1 &&
    typeof value.code === 'string' &&
    (value.operation === 'protocol' || value.operation === 'analyze' || value.operation === 'update') &&
    typeof value.message === 'string' &&
    typeof value.retryable === 'boolean' &&
    (value.causeCode === undefined || typeof value.causeCode === 'string');
}

function isAnalysisResult(value: unknown): value is AnalysisResult {
  if (!isObject(value) || !isKeyResult(value.key)) return false;
  return isArrayOf(value.chords, isChordSegment) &&
    isArrayOf(value.roman, isRomanResult) &&
    isArrayOf(value.motifs, isMotif) &&
    isArrayOf(value.issues, isVoiceLeadingIssue);
}

function isKeyResult(value: unknown): boolean {
  return isObject(value) &&
    typeof value.tonic === 'string' &&
    (value.mode === 'major' || value.mode === 'minor') &&
    isFiniteNumber(value.confidence) &&
    isArrayOf(value.scores, (score) =>
      isObject(score) &&
      typeof score.tonic === 'string' &&
      (score.mode === 'major' || score.mode === 'minor') &&
      isFiniteNumber(score.score));
}

function isChordSegment(value: unknown): boolean {
  return isObject(value) &&
    isFiniteNumber(value.startQuarters) &&
    isFiniteNumber(value.endQuarters) &&
    isArrayOf(value.pitchClasses, (pitchClass) =>
      Number.isSafeInteger(pitchClass) && (pitchClass as number) >= 0 && (pitchClass as number) <= 11) &&
    typeof value.chord === 'string';
}

function isRomanResult(value: unknown): boolean {
  return isObject(value) &&
    isFiniteNumber(value.startQuarters) &&
    isFiniteNumber(value.endQuarters) &&
    typeof value.chord === 'string' &&
    typeof value.roman === 'string';
}

function isMotif(value: unknown): boolean {
  return isObject(value) &&
    typeof value.id === 'string' &&
    isArrayOf(value.intervals, isFiniteNumber) &&
    isArrayOf(value.rhythm, isFiniteNumber) &&
    isArrayOf(value.occurrences, (occurrence) =>
      isObject(occurrence) &&
      typeof occurrence.partId === 'string' &&
      isFiniteNumber(occurrence.startQuarters) &&
      isArrayOf(
        occurrence.noteIndexes,
        (index) => Number.isSafeInteger(index) && (index as number) >= 0,
      ));
}

function isVoiceLeadingIssue(value: unknown): boolean {
  return isObject(value) &&
    (value.type === 'parallel-fifth' ||
      value.type === 'parallel-octave' ||
      value.type === 'large-leap' ||
      value.type === 'voice-crossing') &&
    isFiniteNumber(value.startQuarters) &&
    isFiniteNumber(value.endQuarters) &&
    isArrayOf(value.voices, (voice) => typeof voice === 'string') &&
    (value.voiceParts === undefined ||
      isArrayOf(value.voiceParts, (partId) => typeof partId === 'string') &&
      (value.voiceParts as unknown[]).length === (value.voices as unknown[]).length) &&
    (value.severity === 'info' || value.severity === 'warning' || value.severity === 'error');
}

function isArrayOf(
  value: unknown,
  predicate: (entry: unknown) => boolean,
): boolean {
  return Array.isArray(value) && value.every(predicate);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function remoteError(response: Extract<AnalysisWorkerResponse, {ok: false}>): Error {
  const details = response.errorDetails;
  if (
    details &&
    details.version === 1 &&
    typeof details.code === 'string' &&
    typeof details.operation === 'string' &&
    typeof details.message === 'string'
  ) {
    return new AnalysisWorkerRemoteError(details);
  }
  return new Error(typeof response.error === 'string' ? response.error : 'Analysis worker failed');
}

/** In-process fallback: same Promise API, runs synchronously on this thread. */
class InProcessClient implements AnalysisWorkerClient {
  #session: AnalysisSession | null = null;
  #disposed = false;

  analyze(score: Score, options: AnalysisSessionOptions = {}): Promise<AnalysisResult> {
    if (this.#disposed) return Promise.reject(new Error('AnalysisWorkerClient is disposed'));
    try {
      const optionsError = validateAnalysisWorkerOptions(options);
      if (optionsError) throw new TypeError(optionsError);
      this.#session = createAnalysisSession(score, options);
      return Promise.resolve(this.#session.result);
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
  }

  update(score: Score): Promise<AnalysisResult> {
    if (this.#disposed) return Promise.reject(new Error('AnalysisWorkerClient is disposed'));
    try {
      if (!this.#session) this.#session = createAnalysisSession(score);
      return Promise.resolve(this.#session.update(score));
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
  }

  dispose(): void {
    this.#disposed = true;
    this.#session = null;
  }
}

/**
 * Create a main-thread client for worker-offloaded analysis.
 *
 * - `createAnalysisWorker()` spawns the bundled module worker
 *   (`new Worker(new URL('./worker.js', import.meta.url), {type: 'module'})`,
 *   which Vite/webpack/Rollup bundle automatically).
 * - `createAnalysisWorker(worker)` / `createAnalysisWorker(() => worker)`
 *   uses a caller-supplied Worker (custom bundler setups, SharedWorker
 *   shims, tests).
 * - When `Worker` is unavailable or its default module Worker cannot be
 *   constructed (Node, SSR, old runtimes, CSP / bundler restrictions), and no
 *   worker was supplied, the client transparently falls back to an in-process
 *   `createAnalysisSession` behind the same Promise API.
 *
 * Transfer strategy: scores cross the boundary as `score.toJSON()` plain
 * objects via `postMessage`. The JSON output contains no class instances, so
 * the structured clone is cheap (unlike cloning the live object graph with
 * its Rational/Pitch instances), and we avoid a `JSON.stringify`/`parse`
 * round-trip on top of the worker-side `scoreFromJSON` parse.
 */
export function createAnalysisWorker(
  workerOrFactory?: AnalysisWorkerLike | AnalysisWorkerFactory,
): AnalysisWorkerClient {
  if (typeof workerOrFactory === 'function') {
    return new WorkerBackedClient(workerOrFactory(), true);
  }
  if (workerOrFactory) {
    return new WorkerBackedClient(workerOrFactory, false);
  }
  // The default spawn lives in `../worker-url` — its own build entry — so the
  // `./worker.js` URL stays anchored to the dist directory that also holds
  // `worker.js`, even when this module is hoisted into a shared chunk. In the
  // CommonJS build `import.meta.url` is compiled away there, so the documented
  // in-process fallback applies.
  const worker = spawnDefaultAnalysisWorker();
  if (worker) return new WorkerBackedClient(worker, true);
  return new InProcessClient();
}
