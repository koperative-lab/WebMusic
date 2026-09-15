/** Stable error used when a score operation is cancelled without an Error reason. */
export class ScoreLoadAbortError extends Error {
  readonly code = 'score-load-aborted';

  constructor(message = 'Score loading was aborted') {
    super(message);
    this.name = 'AbortError';
  }
}

/** Stable error used when a score operation exceeds its caller-provided timeout. */
export class ScoreLoadTimeoutError extends Error {
  readonly code = 'score-load-timeout';
  readonly timeoutMs: number;

  constructor(timeoutMs: number) {
    super(`Score loading timed out after ${timeoutMs.toLocaleString()} ms`);
    this.name = 'ScoreLoadTimeoutError';
    this.timeoutMs = timeoutMs;
  }
}

export interface ScoreCancellationOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

/**
 * One cancellation scope for a complete public operation. The explicit
 * deadline check also catches synchronous parsing that monopolises the event
 * loop past the timeout before the timer callback gets a chance to run.
 */
export interface ScoreCancellationContext {
  readonly signal: AbortSignal;
  abort(reason?: unknown): void;
  throwIfAborted(): void;
  dispose(): void;
}

export function createScoreCancellationContext(options: ScoreCancellationOptions = {}): ScoreCancellationContext {
  const timeoutMs = resolveTimeoutMs(options.timeoutMs);
  const controller = new AbortController();
  const deadline = timeoutMs == null ? undefined : Date.now() + timeoutMs;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;

  const abortFromCaller = () => controller.abort(abortReason(options.signal));
  if (options.signal?.aborted) abortFromCaller();
  else options.signal?.addEventListener('abort', abortFromCaller, {once: true});

  if (timeoutMs != null && !controller.signal.aborted) {
    timeout = setTimeout(() => controller.abort(new ScoreLoadTimeoutError(timeoutMs)), timeoutMs);
  }

  return {
    signal: controller.signal,
    abort(reason?: unknown) {
      if (!controller.signal.aborted) controller.abort(reason instanceof Error ? reason : new ScoreLoadAbortError());
    },
    throwIfAborted() {
      if (!controller.signal.aborted && deadline != null && Date.now() >= deadline) {
        controller.abort(new ScoreLoadTimeoutError(timeoutMs!));
      }
      throwIfScoreAborted(controller.signal);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (timeout != null) clearTimeout(timeout);
      options.signal?.removeEventListener('abort', abortFromCaller);
    },
  };
}

/** Return a stable Error for an aborted signal, preserving Error reasons. */
export function abortReason(signal: AbortSignal | undefined): Error {
  const reason = signal?.reason;
  if (reason instanceof Error) return reason;
  return new ScoreLoadAbortError();
}

export function throwIfScoreAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw abortReason(signal);
}

/**
 * Reject promptly when a signal aborts. The underlying task may be
 * non-interruptible, but its eventual result can no longer escape this race.
 */
export function raceWithScoreAbort<T>(task: PromiseLike<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) return Promise.resolve(task);
  try {
    throwIfScoreAborted(signal);
  } catch (error) {
    // The caller already started this task before passing its promise. Even
    // if cancellation won synchronously, consume its eventual rejection.
    void Promise.resolve(task).catch(() => {});
    return Promise.reject(error);
  }

  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortReason(signal));
    signal.addEventListener('abort', onAbort, {once: true});
    Promise.resolve(task).then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        if (signal.aborted) reject(abortReason(signal));
        else resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(signal.aborted ? abortReason(signal) : error);
      },
    );
  });
}

function resolveTimeoutMs(timeoutMs: number | undefined): number | undefined {
  if (timeoutMs == null) return undefined;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2_147_483_647) {
    throw new RangeError('Score load option timeoutMs must be a positive safe integer no greater than 2147483647');
  }
  return timeoutMs;
}
