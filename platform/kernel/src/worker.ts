// ============================================================================
// Worker plumbing shared by every family's worker clients: the minimal
// structural Worker surface and the pending-request correlation tracker.
// Extracted verbatim from @webscore/io's worker-client (the copies in
// score/io, audio/play and audio/analyze were byte-identical). Family-specific
// policy — protocol versioning, cancellation, restart, error mapping — stays
// in each package by design.
// ============================================================================

/** Minimal Worker surface the client needs (a real `Worker` satisfies it). */
export interface WorkerLike {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  terminate(): void;
  addEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
  addEventListener(type: 'error', listener: (event: ErrorEvent) => void): void;
}

/** Pending-request registry correlating worker responses by id. */
export interface RequestTracker<T> {
  /** Register a new request; returns its id and the promise to hand out. */
  add(): {id: number; promise: Promise<T>};
  /** Settle the request with the given id. Returns false for unknown ids. */
  resolve(id: number, value: T): boolean;
  /** Reject the request with the given id. Returns false for unknown ids. */
  reject(id: number, error: unknown): boolean;
  /** Reject every pending request (worker crashed / disposed). */
  rejectAll(error: unknown): void;
  /** Number of in-flight requests. */
  readonly size: number;
}

/** Create a {@link RequestTracker}. Pure bookkeeping, no worker involved. */
export function createRequestTracker<T>(): RequestTracker<T> {
  let nextId = 0;
  const pending = new Map<number, {resolve: (value: T) => void; reject: (error: unknown) => void}>();
  return {
    add() {
      const id = nextId++;
      const promise = new Promise<T>((resolve, reject) => {
        pending.set(id, {resolve, reject});
      });
      return {id, promise};
    },
    resolve(id, value) {
      const entry = pending.get(id);
      if (!entry) return false;
      pending.delete(id);
      entry.resolve(value);
      return true;
    },
    reject(id, error) {
      const entry = pending.get(id);
      if (!entry) return false;
      pending.delete(id);
      entry.reject(error);
      return true;
    },
    rejectAll(error) {
      const entries = [...pending.values()];
      pending.clear();
      for (const entry of entries) entry.reject(error);
    },
    get size() {
      return pending.size;
    },
  };
}

// ---------------------------------------------------------------------------
// Worker-scope detection. Every worker runtime entry is a declared side-effect
// entry: evaluating it registers a message handler. That registration must
// happen ONLY inside a real dedicated worker, so importing the same module
// from Node, SSR or a browser main thread stays a harmless no-op and the pure
// handler beside it remains unit-testable everywhere.
//
// Extracted after the four runtimes (score io/analyze, audio play/analyze)
// had drifted into two different guards: three used a heuristic (importScripts
// present / 'onmessage' in scope / a constructor-name regex), one used the
// stricter instanceof check below. The strict one is the better-reasoned
// variant — a name regex matches Service and Shared worker scopes too, and
// both inherit from WorkerGlobalScope without having the dedicated worker's
// global postMessage channel.
// ---------------------------------------------------------------------------

/** The dedicated-worker global surface a runtime needs to register itself. */
export interface DedicatedWorkerScope {
  addEventListener(type: 'message', listener: (event: {data: unknown}) => void): void;
  postMessage(message: unknown, transfer?: Transferable[]): void;
  onmessage?: ((event: {data: unknown}) => void) | null;
}

interface WorkerScopeGlobals {
  WorkerGlobalScope?: unknown;
  DedicatedWorkerGlobalScope?: unknown;
  self?: unknown;
}

/**
 * The current global scope when it is a real dedicated worker, else
 * `undefined`. Guard a worker runtime's registration on this.
 *
 * @param globals Injectable global object (tests); defaults to `globalThis`.
 */
export function dedicatedWorkerScope(
  globals: WorkerScopeGlobals = globalThis as WorkerScopeGlobals,
): DedicatedWorkerScope | undefined {
  const WorkerGlobalScopeConstructor = globals.WorkerGlobalScope;
  if (
    typeof WorkerGlobalScopeConstructor !== 'function' ||
    !(globals.self instanceof (WorkerGlobalScopeConstructor as new () => object))
  ) {
    return undefined;
  }

  const candidate = globals.self as Partial<DedicatedWorkerScope>;
  // ServiceWorkerGlobalScope and SharedWorkerGlobalScope also inherit from
  // WorkerGlobalScope, but neither has the dedicated worker's global
  // postMessage channel. Capability-check both methods before registering.
  if (
    typeof candidate.addEventListener !== 'function' ||
    typeof candidate.postMessage !== 'function'
  ) {
    return undefined;
  }

  // Where the dedicated-scope constructor is exposed, use it to exclude any
  // non-standard WorkerGlobalScope that happens to provide a postMessage-like
  // method. The capability check above remains the cross-runtime fallback.
  const DedicatedWorkerGlobalScopeConstructor = globals.DedicatedWorkerGlobalScope;
  if (
    typeof DedicatedWorkerGlobalScopeConstructor === 'function' &&
    !(globals.self instanceof (DedicatedWorkerGlobalScopeConstructor as new () => object))
  ) {
    return undefined;
  }
  return candidate as DedicatedWorkerScope;
}
