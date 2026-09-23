/**
 * The kit's shared mount plumbing: how a presenter reports a failure, and how
 * it coalesces re-entrant repaints without spinning forever.
 *
 * Both existed in every presenter that needed them, in slightly different
 * shapes — which is how one copy of the stabilization loop ended up reporting a
 * failure for an update that had actually settled. Internal for the same reason
 * as `./dom`: it is plumbing, not a presenter, so it travels inside its
 * importers rather than becoming a published subpath.
 */

/**
 * Wrap a caller's error sink so a failure inside it cannot escape into the DOM
 * event that produced it.
 *
 * Two hazards, both seen in the wild and each previously handled by only some
 * of the presenters: a sink that throws would propagate out of a listener, and
 * a sink that is `async` despite its `void` return type would reject
 * unobserved. The wrapper swallows the first and consumes the second, and never
 * replaces the presenter failure that was being reported.
 *
 * This is the CONTAINED tier only. Several presenters deliberately keep a
 * second, bare reporter for failures raised while mounting, where a throwing
 * sink is meant to abort the mount and take the rollback with it — see
 * `mountParameterRack`, whose contract is pinned by parameter.test.ts. Do not
 * route those through here.
 */
export function createErrorSink(
  onError: ((error: unknown) => void) | undefined,
): (error: unknown) => void {
  return (error: unknown): void => {
    if (!onError) return;
    try {
      const pending = onError(error) as unknown;
      void Promise.resolve(pending).catch(() => {});
    } catch {
      // A caller's error sink never escapes a UI event handler.
    }
  };
}

/** Run every release before reporting the first failure, even if the sink throws. */
export function runCleanups(
  cleanups: Iterable<(() => void) | undefined>,
  onError?: (error: unknown) => void,
): void {
  let failed = false;
  let firstError: unknown;
  for (const cleanup of cleanups) {
    try {
      cleanup?.();
    } catch (error) {
      if (!failed) {
        failed = true;
        firstError = error;
      }
    }
  }
  if (failed) createErrorSink(onError)(firstError);
}

export interface UpdateLoopOptions {
  /**
   * Presenter name for the "did not stabilize" message, e.g. `'Equalizer'`.
   */
  name: string;
  /** One repaint pass. Calls to `run()` from inside it are coalesced. */
  pass: () => void;
  /** Whether this mount still owns its host. A superseded mount stops looping. */
  isCurrent?: () => boolean;
  /** Receives the "did not stabilize" failure, reported with the latch closed. */
  report?: (error: unknown) => void;
  /** Passes before the loop gives up. Defaults to 32. */
  limit?: number;
}

export interface UpdateLoop {
  /** Repaint, or fold into the repaint already running. */
  run: () => void;
  /**
   * Drop a coalesced repaint that has not run yet. A rollback path calls this
   * so a superseded mount cannot leave a queued pass behind it.
   */
  cancel: () => void;
}

/**
 * A repaint that tolerates being asked to repaint again from inside itself.
 *
 * A pass may change state the binding reads back, so the loop runs again rather
 * than dropping the request; after `limit` passes it stops and reports, because
 * a binding that never settles is a bug in the binding, not a reason to hang
 * the page. The failure is reported ONLY when the loop gave up with work still
 * pending — an update that settles on its final allowed pass is a success, and
 * one presenter used to report it as a failure anyway.
 */
export function createUpdateLoop(options: UpdateLoopOptions): UpdateLoop {
  const limit = options.limit ?? 32;
  let updating = false;
  let pending = false;

  const run = (): void => {
    if (options.isCurrent && !options.isCurrent()) return;
    if (updating) {
      pending = true;
      return;
    }
    updating = true;
    let passes = 0;
    try {
      do {
        pending = false;
        passes += 1;
        options.pass();
      } while (pending && (options.isCurrent?.() ?? true) && passes < limit);
    } finally {
      const exhausted = pending && (options.isCurrent?.() ?? true);
      pending = false;
      if (exhausted) {
        options.report?.(
          new Error(`${options.name} update did not stabilize after ${limit} passes`),
        );
      }
      // The report itself may synchronously ask for another update. Keep the
      // latch closed while it runs, then discard that bounded re-entry.
      pending = false;
      updating = false;
    }
  };

  return {run, cancel: () => {
    pending = false;
  }};
}

export interface HostClaim {
  /** Whether this mount still owns the host. */
  isCurrent: () => boolean;
  /** Destroy whoever owned the host before this mount claimed it. */
  destroyPrevious: () => void;
  /** Give the host back, if this mount is still the owner. */
  release: () => void;
}

/**
 * Take ownership of a host BEFORE tearing down the presenter that had it.
 *
 * The order matters, and eleven presenters had it the other way round. A
 * previous handle's `destroy()` runs caller code — a render cleanup, an
 * unsubscribe — and that code is allowed to mount a replacement into the same
 * host. When the registry is only written at the END of a mount, that
 * replacement claims the host, appends its DOM, and is then overwritten by the
 * outer mount that started all this: two roots in the host, and the registry
 * pointing at the older one.
 *
 * Claiming first turns that race into a check. The replacement's claim makes
 * `isCurrent()` false for the outer mount, which stops before appending and
 * returns an inert, already-superseded handle.
 */
export function claimHost<H extends {destroy: () => void}>(
  registry: WeakMap<object, H>,
  host: object,
  handle: H,
): HostClaim {
  let previous = registry.get(host);
  registry.set(host, handle);
  return {
    isCurrent: () => registry.get(host) === handle,
    destroyPrevious: () => {
      // Dropped before the call, so a long-lived claim cannot chain-retain
      // every presenter ever mounted on this host — and so a cleanup that
      // re-enters cannot destroy the same handle twice.
      const target = previous;
      previous = undefined;
      target?.destroy();
    },
    release: () => {
      if (registry.get(host) === handle) registry.delete(host);
    },
  };
}
