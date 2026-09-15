import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {createTickSource, type TickWorkerLike} from '../src/tick';

function fakeWorker() {
  const messages: unknown[] = [];
  let messageListener: ((event: {data: unknown}) => void) | null = null;
  let errorListener: ((event: unknown) => void) | null = null;
  let terminated = false;
  let terminateCalls = 0;
  const worker: TickWorkerLike = {
    postMessage(message) {
      messages.push(message);
    },
    terminate() {
      terminated = true;
      terminateCalls += 1;
    },
    addEventListener(type: 'message' | 'error', l: ((event: {data: unknown}) => void) | ((event: unknown) => void)) {
      if (type === 'message') messageListener = l as (event: {data: unknown}) => void;
      else errorListener = l as (event: unknown) => void;
    },
  };
  return {
    worker,
    messages,
    tick: () => messageListener?.({data: 0}),
    fail: () => errorListener?.(new Error('worker script failed to load')),
    get terminated() {
      return terminated;
    },
    get terminateCalls() {
      return terminateCalls;
    },
  };
}

describe('createTickSource (worker-backed)', () => {
  it('starts/stops the worker interval and delivers ticks to the callback', () => {
    const fake = fakeWorker();
    const source = createTickSource({intervalMs: 10, createWorker: () => fake.worker});
    expect(source.workerBacked).toBe(true);

    const ticks: number[] = [];
    source.start(() => ticks.push(1));
    expect(fake.messages).toEqual([{type: 'start', intervalMs: 10}]);
    fake.tick();
    fake.tick();
    expect(ticks).toHaveLength(2);

    source.stop();
    expect(fake.messages[1]).toEqual({type: 'stop'});
    fake.tick(); // late worker message after stop must not fire the callback
    expect(ticks).toHaveLength(2);
    expect(source.running).toBe(false);
  });

  it('start is idempotent and replaces the callback', () => {
    const fake = fakeWorker();
    const source = createTickSource({createWorker: () => fake.worker});
    const a: number[] = [];
    const b: number[] = [];
    source.start(() => a.push(1));
    source.start(() => b.push(1));
    expect(fake.messages).toHaveLength(1); // one start message
    fake.tick();
    expect(a).toHaveLength(0);
    expect(b).toHaveLength(1);
  });

  it('dispose terminates the worker and forbids restarting', () => {
    const fake = fakeWorker();
    const source = createTickSource({createWorker: () => fake.worker});
    source.start(() => {});
    source.dispose();
    source.dispose();
    expect(fake.terminated).toBe(true);
    expect(fake.terminateCalls).toBe(1);
    expect(() => source.start(() => {})).toThrow(/disposed/);
  });
});

describe('createTickSource (async worker failure)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('falls back to a main-thread interval while running and keeps ticking', () => {
    const fake = fakeWorker();
    const source = createTickSource({intervalMs: 25, createWorker: () => fake.worker});
    const ticks: number[] = [];
    source.start(() => ticks.push(1));
    fake.tick();
    expect(ticks).toHaveLength(1);

    fake.fail();
    expect(source.workerBacked).toBe(false);
    expect(fake.terminated).toBe(true);
    vi.advanceTimersByTime(100);
    expect(ticks).toHaveLength(5); // one worker tick, then four interval ticks

    source.stop();
    vi.advanceTimersByTime(100);
    expect(ticks).toHaveLength(5);
    source.dispose();
    expect(fake.terminateCalls).toBe(1); // dispose must not terminate twice
  });

  it('ignores queued ticks from a worker after switching to the fallback', () => {
    const fake = fakeWorker();
    const source = createTickSource({intervalMs: 25, createWorker: () => fake.worker});
    const tick = vi.fn();
    source.start(tick);
    fake.fail();
    fake.tick(); // Already queued before the worker was terminated.
    expect(tick).not.toHaveBeenCalled();
    vi.advanceTimersByTime(25);
    expect(tick).toHaveBeenCalledOnce();
    source.dispose();
  });

  it('falls back when sending the worker start command fails synchronously', () => {
    const fake = fakeWorker();
    fake.worker.postMessage = () => { throw new Error('worker is unavailable'); };
    const source = createTickSource({intervalMs: 25, createWorker: () => fake.worker});
    const tick = vi.fn();
    expect(() => source.start(tick)).not.toThrow();
    expect(source.running).toBe(true);
    expect(source.workerBacked).toBe(false);
    vi.advanceTimersByTime(50);
    expect(tick).toHaveBeenCalledTimes(2);
    source.dispose();
    expect(fake.terminateCalls).toBe(1);
  });

  it('releases a worker whose stop command fails and restarts on the fallback', () => {
    const fake = fakeWorker();
    const source = createTickSource({intervalMs: 25, createWorker: () => fake.worker});
    const tick = vi.fn();
    source.start(tick);
    fake.worker.postMessage = () => { throw new Error('worker is unavailable'); };
    expect(() => source.stop()).not.toThrow();
    expect(source.running).toBe(false);
    expect(source.workerBacked).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    source.start(tick);
    fake.tick();
    vi.advanceTimersByTime(25);
    expect(tick).toHaveBeenCalledOnce();
    source.dispose();
  });

  it('a failure before start routes the next start to the main thread', () => {
    const fake = fakeWorker();
    const source = createTickSource({intervalMs: 10, createWorker: () => fake.worker});
    fake.fail();
    expect(source.workerBacked).toBe(false);
    const ticks: number[] = [];
    source.start(() => ticks.push(1));
    expect(fake.messages).toEqual([]); // the dead worker is never asked to start
    vi.advanceTimersByTime(30);
    expect(ticks).toHaveLength(3);
    source.dispose();
  });

  it('a late failure event after dispose is ignored', () => {
    const fake = fakeWorker();
    const source = createTickSource({createWorker: () => fake.worker});
    source.start(() => {});
    source.dispose();
    expect(fake.terminateCalls).toBe(1);
    fake.fail();
    expect(fake.terminateCalls).toBe(1);
    expect(source.workerBacked).toBe(false);
  });
});

describe('createTickSource (main-thread fallback)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('falls back to setInterval when no worker is available', () => {
    const source = createTickSource({intervalMs: 25, createWorker: () => null});
    expect(source.workerBacked).toBe(false);
    const ticks: number[] = [];
    source.start(() => ticks.push(1));
    vi.advanceTimersByTime(100);
    expect(ticks).toHaveLength(4);
    source.stop();
    vi.advanceTimersByTime(100);
    expect(ticks).toHaveLength(4);
  });

  it('rejects invalid intervals', () => {
    for (const bad of [0, -5, 0.5, Number.MIN_VALUE, 2_147_483_648, NaN, Infinity]) {
      expect(() => createTickSource({intervalMs: bad, createWorker: () => null})).toThrow(RangeError);
    }
  });

  it('revokes the Blob URL when the default worker is rejected by CSP', () => {
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test-worker');
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    vi.stubGlobal('Worker', class {
      constructor() {
        throw new Error('Refused by Content Security Policy');
      }
    });

    const source = createTickSource({intervalMs: 25});

    expect(source.workerBacked).toBe(false);
    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:test-worker');
    source.dispose();
  });

  it('keeps a created worker when a URL polyfill throws during cleanup', () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test-worker');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {
      throw new Error('polyfill cleanup failed');
    });
    vi.stubGlobal('Worker', class {
      postMessage() {}
      terminate() {}
      addEventListener() {}
    });

    const source = createTickSource();

    expect(source.workerBacked).toBe(true);
    source.dispose();
  });
});
