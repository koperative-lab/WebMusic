import type {
  EventEmitter,
  EventListenerFailureMode,
} from '../../core';

type Timer = ReturnType<typeof setTimeout>;

export interface PlaybackListenerError {
  kind: 'listenerError';
  source: string;
  event: string;
  mode: EventListenerFailureMode;
  error: unknown;
}

export interface PlaybackOperationError {
  kind: 'operationError';
  source: string;
  operation: string;
  error: unknown;
}

type DeferredPlaybackError = PlaybackListenerError | PlaybackOperationError;

interface ReportBucket {
  failure: DeferredPlaybackError;
  count: number;
  timer?: Timer;
}

interface PlaybackListenerEvents {
  listenerError: PlaybackListenerError;
}

interface PlaybackOperationEvents extends PlaybackListenerEvents {
  operationError: PlaybackOperationError;
}

const REPORT_INTERVAL_MS = 1000;
const reportBuckets = new Map<string, ReportBucket>();

function failureKey(failure: DeferredPlaybackError): string {
  // Keep the fallback reporter deliberately low-cardinality. In particular,
  // never use an Error's name/message (which may be unique or accessor-backed)
  // nor a dynamic member/operation label as a bucket key. Sources are the
  // package-owned component identifiers supplied at call sites.
  return `${failure.kind}:${failure.source}`;
}

function unrefTimer(timer: Timer): void {
  (timer as Timer & {unref?: () => void}).unref?.();
}

function scheduleBucket(key: string, bucket: ReportBucket, delay: number): void {
  bucket.timer = setTimeout(() => flushBucket(key, bucket), delay);
  unrefTimer(bucket.timer);
}

function flushBucket(key: string, bucket: ReportBucket): void {
  if (reportBuckets.get(key) !== bucket) return;
  bucket.timer = undefined;
  if (bucket.count === 0) {
    reportBuckets.delete(key);
    return;
  }

  const count = bucket.count;
  bucket.count = 0;
  const subject = bucket.failure.kind === 'listenerError'
    ? `"${bucket.failure.event}" listener`
    : `"${bucket.failure.operation}" operation`;
  const repeated = count > 1 ? ` (${count} occurrences)` : '';
  try {
    console.error(
      `[${bucket.failure.source}] ${subject} failed${repeated}:`,
      bucket.failure.error,
    );
  } catch {
    // Diagnostics remain best-effort even when a host replaces console.error.
  }

  // Keep the bucket for one window. Repeated failures are coalesced into one
  // trailing report; an idle bucket is removed by the same timer.
  scheduleBucket(key, bucket, REPORT_INTERVAL_MS);
}

/** Queue a default diagnostic outside the audio/timer callback and rate-limit it. */
export function reportPlaybackEventFailure(failure: PlaybackListenerError): void {
  enqueuePlaybackFailure(failure);
}

/** Best-effort diagnostic for backend cleanup failures without a public channel. */
export function reportPlaybackOperationFailure(
  source: string,
  operation: string,
  error: unknown,
): void {
  enqueuePlaybackFailure({kind: 'operationError', source, operation, error});
}

function enqueuePlaybackFailure(failure: DeferredPlaybackError): void {
  const key = failureKey(failure);
  const existing = reportBuckets.get(key);
  if (existing) {
    existing.failure = failure;
    existing.count += 1;
    return;
  }

  const bucket: ReportBucket = {
    failure,
    count: 1,
  };
  reportBuckets.set(key, bucket);
  scheduleBucket(key, bucket, 0);
}

/**
 * Dispatch one timing-sensitive playback event without letting application
 * code unwind an audio-clock, timer, or lifecycle callback. Subscriber faults
 * use the independent, structured `listenerError` event; they never masquerade
 * as an operational playback error.
 */
export function emitPlaybackEvent<
  TEvents extends PlaybackListenerEvents,
  TName extends keyof TEvents,
>(
  emitter: EventEmitter<TEvents>,
  source: string,
  event: TName,
  payload: TEvents[TName],
): void {
  dispatchPlaybackEvent(emitter, source, event, payload);
}

/**
 * Publish a contained backend/lifecycle failure to the owning player. An
 * unobserved failure retains the deferred console fallback used before the
 * public channel existed; a faulty observer is reported through listenerError.
 */
export function emitPlaybackOperationError<TEvents extends PlaybackOperationEvents>(
  emitter: EventEmitter<TEvents>,
  source: string,
  operation: string,
  error: unknown,
): void {
  const failure: PlaybackOperationError = {
    kind: 'operationError',
    source,
    operation,
    error,
  };
  const observed = dispatchPlaybackEvent(
    emitter,
    source,
    'operationError',
    failure,
  );
  if (observed === 0) reportPlaybackOperationFailure(source, operation, error);
}

function dispatchPlaybackEvent<
  TEvents extends PlaybackListenerEvents,
  TName extends keyof TEvents,
>(
  emitter: EventEmitter<TEvents>,
  source: string,
  event: TName,
  payload: TEvents[TName],
): number {
  return emitter.emitSafely(event, payload, (error, mode) => {
    const failure: PlaybackListenerError = {
      kind: 'listenerError',
      source,
      event: String(event),
      mode,
      error,
    };

    // Avoid recursive diagnostics when a listenerError observer itself fails.
    if (event === 'listenerError') {
      reportPlaybackEventFailure(failure);
      return;
    }

    const diagnosticEmitter = emitter as unknown as EventEmitter<PlaybackListenerEvents>;
    const observed = diagnosticEmitter.emitSafely(
      'listenerError',
      failure,
      (observerError, observerMode) => {
        reportPlaybackEventFailure({
          kind: 'listenerError',
          source,
          event: 'listenerError',
          mode: observerMode,
          error: observerError,
        });
      },
    );
    if (observed === 0) reportPlaybackEventFailure(failure);
  });
}
