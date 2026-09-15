import {EventEmitter} from '../../src/core';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {
  emitPlaybackEvent,
  emitPlaybackOperationError,
  reportPlaybackOperationFailure,
  type PlaybackListenerError,
  type PlaybackOperationError,
} from '../../src/play/headless/playback-events';

interface Events {
  tick: number;
  operationError: PlaybackOperationError;
  listenerError: PlaybackListenerError;
}

describe('playback event diagnostics', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('delivers rejected subscribers through the structured listenerError event', async () => {
    const emitter = new EventEmitter<Events>();
    const failure = new Error('async subscriber');
    const observed: PlaybackListenerError[] = [];
    emitter.on('tick', async () => {
      throw failure;
    });
    emitter.on('listenerError', (error) => observed.push(error));

    emitPlaybackEvent(emitter, 'AsyncEventTest', 'tick', 1);
    await Promise.resolve();
    await Promise.resolve();

    expect(observed).toEqual([{
      kind: 'listenerError',
      source: 'AsyncEventTest',
      event: 'tick',
      mode: 'rejection',
      error: failure,
    }]);
  });

  it('defers, deduplicates, and rate-limits the default console fallback', () => {
    vi.useFakeTimers();
    const reported = vi.spyOn(console, 'error').mockImplementation(() => {});
    const emitter = new EventEmitter<Events>();
    const failure = new Error('repeated subscriber');
    emitter.on('tick', () => {
      throw failure;
    });

    emitPlaybackEvent(emitter, 'DeferredReporterTest', 'tick', 1);
    emitPlaybackEvent(emitter, 'DeferredReporterTest', 'tick', 2);
    expect(reported).not.toHaveBeenCalled();

    vi.advanceTimersByTime(0);
    expect(reported).toHaveBeenCalledTimes(1);
    expect(reported).toHaveBeenCalledWith(
      expect.stringContaining('(2 occurrences)'),
      failure,
    );

    emitPlaybackEvent(emitter, 'DeferredReporterTest', 'tick', 3);
    vi.advanceTimersByTime(999);
    expect(reported).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(reported).toHaveBeenCalledTimes(2);
  });

  it('coalesces unique error messages into a low-cardinality source bucket', () => {
    vi.useFakeTimers();
    const reported = vi.spyOn(console, 'error').mockImplementation(() => {});
    const emitter = new EventEmitter<Events>();
    let failure = 0;
    emitter.on('tick', () => {
      throw new Error(`unique subscriber failure ${failure++}`);
    });

    for (let value = 0; value < 100; value += 1) {
      emitPlaybackEvent(emitter, 'BoundedReporterTest', 'tick', value);
    }
    vi.advanceTimersByTime(0);

    expect(reported).toHaveBeenCalledTimes(1);
    expect(reported).toHaveBeenCalledWith(
      expect.stringContaining('(100 occurrences)'),
      expect.any(Error),
    );
  });

  it('does not inspect hostile Error accessors while reporting cleanup failures', () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    class HostileError extends Error {
      constructor() {
        super();
        // The getter below makes `message` readonly at the type level.
        delete (this as {message?: string}).message;
      }

      override get message(): string {
        throw new Error('message getter must not run');
      }
    }

    expect(() => {
      reportPlaybackOperationFailure('SafeReporterTest', 'release', new HostileError());
    }).not.toThrow();
    vi.advanceTimersByTime(0);
  });

  it('delivers operation failures through the structured public channel', () => {
    vi.useFakeTimers();
    const reported = vi.spyOn(console, 'error').mockImplementation(() => {});
    const emitter = new EventEmitter<Events>();
    const failure = new Error('backend release failed');
    const observed: PlaybackOperationError[] = [];
    emitter.on('operationError', (error) => observed.push(error));

    emitPlaybackOperationError(emitter, 'OperationEventTest', 'noteOffById', failure);
    vi.advanceTimersByTime(0);

    expect(observed).toEqual([{
      kind: 'operationError',
      source: 'OperationEventTest',
      operation: 'noteOffById',
      error: failure,
    }]);
    expect(reported).not.toHaveBeenCalled();
  });

  it('retains the deferred fallback when operationError is unobserved', () => {
    vi.useFakeTimers();
    const reported = vi.spyOn(console, 'error').mockImplementation(() => {});
    const emitter = new EventEmitter<Events>();
    const failure = new Error('unobserved backend failure');

    emitPlaybackOperationError(emitter, 'UnobservedOperationTest', 'cleanup', failure);
    expect(reported).not.toHaveBeenCalled();
    vi.advanceTimersByTime(0);

    expect(reported).toHaveBeenCalledWith(
      expect.stringContaining('"cleanup" operation failed'),
      failure,
    );
  });

  it('routes a faulty operationError observer through listenerError', async () => {
    const emitter = new EventEmitter<Events>();
    const observerFailure = new Error('operation observer failed');
    const listenerErrors: PlaybackListenerError[] = [];
    emitter.on('operationError', async () => {
      throw observerFailure;
    });
    emitter.on('listenerError', (error) => listenerErrors.push(error));

    emitPlaybackOperationError(
      emitter,
      'OperationObserverTest',
      'noteOn',
      new Error('backend failed'),
    );
    await Promise.resolve();
    await Promise.resolve();

    expect(listenerErrors).toEqual([{
      kind: 'listenerError',
      source: 'OperationObserverTest',
      event: 'operationError',
      mode: 'rejection',
      error: observerFailure,
    }]);
  });

  it('contains a rejected listenerError observer and defers its fallback', async () => {
    vi.useFakeTimers();
    const reported = vi.spyOn(console, 'error').mockImplementation(() => {});
    const emitter = new EventEmitter<Events>();
    emitter.on('tick', () => {
      throw new Error('subscriber failed');
    });
    emitter.on('listenerError', async () => {
      throw new Error('observer failed');
    });

    expect(() => emitPlaybackEvent(emitter, 'ObserverTest', 'tick', 1)).not.toThrow();
    await Promise.resolve();
    await Promise.resolve();
    expect(reported).not.toHaveBeenCalled();

    vi.advanceTimersByTime(0);
    expect(reported).toHaveBeenCalledWith(
      expect.stringContaining('"listenerError" listener failed'),
      expect.any(Error),
    );
  });
});
