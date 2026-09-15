// ============================================================================
// Steady tick delivery for lookahead schedulers. Main-thread timers are
// throttled to >=1s in background tabs (and to once-a-minute under intensive
// throttling), which starves a 25ms scheduling pipeline. A dedicated worker
// reduces reliance on those timers; worker suspension and main-thread message
// delivery can still delay ticks. The worker is spun from an
// inline Blob (no asset to ship); environments without Worker/Blob (SSR,
// strict CSP) fall back to a main-thread interval transparently.
// ============================================================================

/** Minimal Worker surface the tick source needs (a real `Worker` satisfies it). */
export interface TickWorkerLike {
  postMessage(message: unknown): void;
  terminate(): void;
  addEventListener(type: 'message', listener: (event: {data: unknown}) => void): void;
  /**
   * Worker failure notification. Constructing a `Worker` succeeds before its
   * script is fetched, so a CSP/network failure surfaces only as this event —
   * the tick source listens and falls back to a main-thread interval.
   */
  addEventListener(type: 'error', listener: (event: unknown) => void): void;
}

export interface TickSourceOptions {
  /** Tick cadence in milliseconds. Default 25. */
  intervalMs?: number;
  /**
   * Injectable worker factory (tests; custom hosting). Return null to force
   * the main-thread fallback. Default: an inline-Blob interval worker where
   * supported, else null.
   */
  createWorker?: () => TickWorkerLike | null;
}

export interface TickSource {
  /** Start delivering ticks. Replaces any previous callback. Idempotent. */
  start(onTick: () => void): void;
  /** Stop delivering ticks; the source can be started again. */
  stop(): void;
  readonly running: boolean;
  /**
   * True when ticks come from a dedicated worker (throttle-resistant).
   * Flips to false if the worker fails asynchronously and the source falls
   * back to a main-thread interval.
   */
  readonly workerBacked: boolean;
  /** Stop and release the worker. The source cannot be restarted after. */
  dispose(): void;
}

/** Largest delay accepted by browser/Node integer timer implementations. */
export const MAX_TIMER_DELAY_MS = 2_147_483_647;

const WORKER_SOURCE = `
let id = null;
onmessage = (event) => {
  const data = event.data;
  if (data && data.type === 'start') {
    clearInterval(id);
    id = setInterval(() => postMessage(0), data.intervalMs);
  } else if (data && data.type === 'stop') {
    clearInterval(id);
    id = null;
  }
};
`;

function defaultWorkerFactory(): TickWorkerLike | null {
  if (typeof Worker === 'undefined' || typeof Blob === 'undefined' || typeof URL === 'undefined') {
    return null;
  }
  let url: string | undefined;
  try {
    url = URL.createObjectURL(new Blob([WORKER_SOURCE], {type: 'text/javascript'}));
    return new Worker(url);
  } catch {
    return null; // e.g. CSP forbids blob: workers — fall back to main thread.
  } finally {
    // The constructor consumes the URL immediately. Revoke it on both the
    // success and failure paths so repeated CSP failures cannot leak URLs.
    if (url !== undefined) {
      try {
        URL.revokeObjectURL(url);
      } catch {
        // URL cleanup is best-effort; do not discard a successfully-created
        // worker because of a partial DOM/polyfill implementation.
      }
    }
  }
}

/**
 * Create a {@link TickSource}. Worker-backed where possible, main-thread
 * `setInterval` otherwise — same surface either way.
 */
export function createTickSource(options: TickSourceOptions = {}): TickSource {
  const intervalMs = options.intervalMs ?? 25;
  if (!Number.isSafeInteger(intervalMs) || intervalMs < 1 || intervalMs > MAX_TIMER_DELAY_MS) {
    throw new RangeError(
      `TickSource intervalMs must be a positive safe integer no greater than ${MAX_TIMER_DELAY_MS}, got ${intervalMs}.`,
    );
  }
  const worker = (options.createWorker ?? defaultWorkerFactory)();

  let activeWorker = worker;
  let callback: (() => void) | null = null;
  let running = false;
  let disposed = false;
  let fallbackId: ReturnType<typeof setInterval> | null = null;

  const startFallbackInterval = (): void => {
    fallbackId ??= setInterval(() => {
      if (running) callback?.();
    }, intervalMs);
  };

  const fallBackFromWorker = (): void => {
    if (activeWorker === null || disposed) return;
    const failedWorker = activeWorker;
    activeWorker = null;
    try {
      failedWorker.terminate();
    } catch {
      // The worker already failed; releasing it is best-effort.
    }
    if (running) startFallbackInterval();
  };

  if (worker) {
    worker.addEventListener('message', () => {
      // A terminated worker can still have messages queued on the main
      // thread. Only the currently active source may wake the scheduler.
      if (activeWorker === worker && running) callback?.();
    });
    worker.addEventListener('error', () => {
      // Worker construction succeeds before its script loads; a CSP or fetch
      // failure arrives here asynchronously. Without this fallback the source
      // would report workerBacked=true yet never tick — silently starving
      // every scheduler fed by it.
      fallBackFromWorker();
    });
  }

  return {
    get running() {
      return running;
    },
    get workerBacked() {
      return activeWorker !== null;
    },
    start(onTick) {
      if (disposed) throw new Error('TickSource has been disposed.');
      callback = onTick;
      if (running) return;
      running = true;
      if (activeWorker) {
        try {
          activeWorker.postMessage({type: 'start', intervalMs});
        } catch {
          fallBackFromWorker();
        }
      } else {
        startFallbackInterval();
      }
    },
    stop() {
      if (!running) return;
      running = false;
      if (activeWorker) {
        try {
          activeWorker.postMessage({type: 'stop'});
        } catch (error) {
          // A broken wakeup source must not prevent its owner from pausing
          // playback. Disposal still reports errors after releasing it.
          if (disposed) throw error;
          fallBackFromWorker();
        }
      }
      if (fallbackId !== null) {
        clearInterval(fallbackId);
        fallbackId = null;
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      const errors: unknown[] = [];
      try {
        this.stop();
      } catch (error) {
        errors.push(error);
      }
      callback = null;
      try {
        activeWorker?.terminate();
      } catch (error) {
        errors.push(error);
      }
      activeWorker = null;
      if (errors.length > 0) throw errors[0];
    },
  };
}
