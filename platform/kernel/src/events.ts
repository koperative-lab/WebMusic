// ============================================================================
// Typed pub-sub shared by every @webscore/* and @webaudio/* package.
// Extracted from @webscore/core (the hardened superset of the two family
// copies); @webaudio's variant lacked emitSafely and is compatible.
// ============================================================================

type Listener<T> = (data: T) => unknown;

export type EventListenerFailureMode = 'throw' | 'rejection';

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return value != null &&
    (typeof value === 'object' || typeof value === 'function') &&
    typeof (value as {then?: unknown}).then === 'function';
}

/**
 * Tiny typed pub-sub.
 * Subscribers receive a typed payload per event name.
 */
export class EventEmitter<TEvents extends object = Record<string, unknown>> {
  private readonly listeners = new Map<keyof TEvents, Set<Listener<unknown>>>();

  on<K extends keyof TEvents>(event: K, listener: Listener<TEvents[K]>): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(listener as Listener<unknown>);
    return () => this.off(event, listener);
  }

  once<K extends keyof TEvents>(event: K, listener: Listener<TEvents[K]>): () => void {
    let fired = false;
    const off = this.on(event, (data) => {
      // A nested dispatch can consume this subscription while an outer
      // dispatch still holds its wrapper in a subscriber snapshot.
      if (fired) return;
      fired = true;
      off();
      return listener(data);
    });
    return off;
  }

  off<K extends keyof TEvents>(event: K, listener: Listener<TEvents[K]>): void {
    this.listeners.get(event)?.delete(listener as Listener<unknown>);
  }

  /**
   * Delivery snapshots the subscribers present at dispatch start — the same
   * membership semantics as {@link emitSafely}. Iterating the live set instead
   * would deliver the in-flight event to listeners added during dispatch,
   * making the ordinary self-rearming `once` idiom an infinite loop.
   */
  emit<K extends keyof TEvents>(event: K, data: TEvents[K]): void {
    const set = this.listeners.get(event);
    if (!set) return;
    for (const l of [...set]) l(data);
  }

  /**
   * Deliver an event without allowing one subscriber to prevent later
   * subscribers from running. The ordinary {@link emit} method deliberately
   * retains its historic exception propagation; lifecycle-sensitive owners
   * such as playback engines opt into this boundary explicitly.
   *
   * Delivery snapshots the subscribers present at dispatch start. Synchronous
   * throws and rejected promises are both reported. Errors thrown or rejected
   * by the observer are ignored: a diagnostic hook must never become a second
   * path out of a scheduler callback.
   */
  emitSafely<K extends keyof TEvents>(
    event: K,
    data: TEvents[K],
    onError: (
      error: unknown,
      mode: EventListenerFailureMode,
    ) => void | PromiseLike<void>,
  ): number {
    const set = this.listeners.get(event);
    if (!set) return 0;
    const snapshot = [...set];
    const report = (error: unknown, mode: EventListenerFailureMode): void => {
      try {
        const observation = onError(error, mode);
        if (isPromiseLike(observation)) {
          void Promise.resolve(observation).catch(() => {});
        }
      } catch {
        // The caller selected safe delivery; preserve that guarantee even
        // when its diagnostic observer is itself faulty.
      }
    };
    for (const listener of snapshot) {
      try {
        const result = listener(data);
        if (isPromiseLike(result)) {
          void Promise.resolve(result).catch((error: unknown) => {
            report(error, 'rejection');
          });
        }
      } catch (error) {
        report(error, 'throw');
      }
    }
    return snapshot.length;
  }

  removeAllListeners(event?: keyof TEvents): void {
    // Tested against `undefined`, not truthiness: `keyof TEvents` admits `''`
    // and `0`, and a caller clearing one of those keys would otherwise wipe
    // every listener on the emitter instead.
    if (event !== undefined) this.listeners.delete(event);
    else this.listeners.clear();
  }

  /** Alias of removeAllListeners for backward compatibility. */
  clear(event?: keyof TEvents): void {
    this.removeAllListeners(event);
  }
}
