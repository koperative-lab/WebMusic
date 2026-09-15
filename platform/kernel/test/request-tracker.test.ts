import {describe, expect, it} from 'vitest';
import {createRequestTracker} from '../src/worker';

describe('createRequestTracker', () => {
  it('correlates out-of-order replies and removes settled requests immediately', async () => {
    const tracker = createRequestTracker<string>();
    const first = tracker.add();
    const second = tracker.add();

    expect(first.id).not.toBe(second.id);
    expect(tracker.size).toBe(2);
    expect(tracker.resolve(second.id, 'second')).toBe(true);
    expect(tracker.size).toBe(1);
    expect(tracker.resolve(first.id, 'first')).toBe(true);
    expect(tracker.size).toBe(0);
    await expect(first.promise).resolves.toBe('first');
    await expect(second.promise).resolves.toBe('second');
    expect(tracker.reject(second.id, new Error('late failure'))).toBe(false);
    expect(tracker.resolve(first.id, 'duplicate')).toBe(false);
    expect(tracker.reject(-1, undefined)).toBe(false);
  });

  it('settles every crash request without letting old replies affect later work', async () => {
    const tracker = createRequestTracker<string>();
    const first = tracker.add();
    const second = tracker.add();
    const failure = new Error('worker failed');
    const results = Promise.allSettled([first.promise, second.promise]);

    tracker.rejectAll(failure);
    expect(tracker.size).toBe(0);
    const later = tracker.add();
    expect([first.id, second.id]).not.toContain(later.id);
    expect(tracker.resolve(first.id, 'stale reply')).toBe(false);
    expect(tracker.reject(second.id, new Error('stale error'))).toBe(false);
    expect(tracker.size).toBe(1);
    expect(tracker.resolve(later.id, 'restarted')).toBe(true);

    await expect(results).resolves.toEqual([
      {status: 'rejected', reason: failure},
      {status: 'rejected', reason: failure},
    ]);
    await expect(later.promise).resolves.toBe('restarted');
    tracker.rejectAll(failure);
    expect(tracker.size).toBe(0);
  });

  it('allows an owner to reject a failed send without disturbing another request', async () => {
    const tracker = createRequestTracker<string>();
    const failed = tracker.add();
    const pending = tracker.add();
    const failure = new DOMException('cannot clone request', 'DataCloneError');
    const result = failed.promise.catch((error: unknown) => error);

    expect(tracker.reject(failed.id, failure)).toBe(true);
    expect(tracker.size).toBe(1);
    tracker.resolve(pending.id, 'done');
    await expect(result).resolves.toBe(failure);
    await expect(pending.promise).resolves.toBe('done');
  });
});
