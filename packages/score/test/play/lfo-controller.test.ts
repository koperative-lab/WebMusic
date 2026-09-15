import {describe, expect, it, vi} from 'vitest';
import {
  LfoController,
  LFO_SHAPES,
  createLfoController,
  lfoWave,
  type LfoFrameCallback,
  type LfoTarget,
} from '../../src/play/headless/lfo';

class FrameScheduler {
  private nextHandle = 1;
  readonly callbacks = new Map<number, LfoFrameCallback>();
  readonly cancelled: number[] = [];

  readonly request = (callback: LfoFrameCallback): number => {
    const handle = this.nextHandle++;
    this.callbacks.set(handle, callback);
    return handle;
  };

  readonly cancel = (handle: number): void => {
    this.cancelled.push(handle);
    this.callbacks.delete(handle);
  };

  get pending(): number[] {
    return [...this.callbacks.keys()];
  }

  fire(handle = this.pending[0]!): void {
    const callback = this.callbacks.get(handle);
    if (!callback) throw new Error(`Missing frame ${handle}`);
    this.callbacks.delete(handle);
    callback(0);
  }
}

function createHarness(options: {
  now?: number;
  target?: LfoTarget;
  onError?: (error: unknown) => void;
} = {}): {
  controller: LfoController;
  scheduler: FrameScheduler;
  setNow(value: number): void;
} {
  const scheduler = new FrameScheduler();
  let now = options.now ?? 0;
  const controller = new LfoController({
    now: () => now,
    requestFrame: scheduler.request,
    cancelFrame: scheduler.cancel,
    target: options.target,
    onError: options.onError,
  });
  return {
    controller,
    scheduler,
    setNow(value: number): void {
      now = value;
    },
  };
}

describe('LfoController state and waveform', () => {
  it('is DOM-free and retains the legacy defaults and pure waveforms', () => {
    const controller = createLfoController({
      requestFrame: () => 1,
      cancelFrame: () => {},
    });

    expect(controller.snapshot()).toEqual({
      shape: 'sine',
      rate: 1,
      depth: 0.6,
      running: false,
      phase: 0,
    });
    expect(LFO_SHAPES).toEqual(['sine', 'triangle', 'square', 'saw']);
    expect(lfoWave('sine', 0.25)).toBeCloseTo(1);
    expect(lfoWave('triangle', 0)).toBe(1);
    expect(lfoWave('triangle', 0.5)).toBe(-1);
    expect(lfoWave('square', 0.75)).toBe(-1);
    expect(lfoWave('saw', 1)).toBe(1);
  });

  it('advances phase, applies the latest frame value, notifies, then re-arms', () => {
    const sequence: string[] = [];
    const target: LfoTarget = {
      min: 0,
      max: 10,
      apply: (value) => sequence.push(`apply:${value}`),
    };
    const {controller, scheduler, setNow} = createHarness({target});
    controller.subscribe(() =>
      sequence.push(
        `notify:${controller.snapshot().running}:${controller.snapshot().phase}`,
      ),
    );

    controller.start();
    expect(sequence).toEqual(['notify:true:0']);
    expect(scheduler.pending).toEqual([1]);
    sequence.length = 0;
    setNow(0.25);

    scheduler.fire(1);

    expect(sequence).toEqual(['apply:8', 'notify:true:0.25']);
    expect(controller.snapshot().phase).toBe(0.25);
    expect(scheduler.pending).toEqual([2]);
  });

  it('configures normalized state and hot-swaps targets without eager apply', () => {
    const first = {min: 0, max: 10, apply: vi.fn()};
    const second = {min: 10, max: 20, apply: vi.fn()};
    const {controller, scheduler, setNow} = createHarness({target: first});
    const notify = vi.fn();
    controller.subscribe(notify);

    controller.configure({
      shape: 'square',
      rate: -4,
      depth: 2,
      phase: -0.25,
      target: second,
    });

    expect(controller.snapshot()).toEqual({
      shape: 'square',
      rate: 0.05,
      depth: 1,
      running: false,
      phase: 0.75,
    });
    expect(first.apply).not.toHaveBeenCalled();
    expect(second.apply).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledOnce();

    controller.configure({rate: 99});
    expect(controller.snapshot().rate).toBe(12);

    controller.start();
    setNow(1);
    scheduler.fire();
    expect(second.apply).toHaveBeenCalledWith(10);
    expect(first.apply).not.toHaveBeenCalled();

    controller.setTarget(undefined);
    setNow(2);
    scheduler.fire();
    expect(second.apply).toHaveBeenCalledOnce();
  });

  it('does not apply a target replaced re-entrantly while reading its range', () => {
    const scheduler = new FrameScheduler();
    const firstApply = vi.fn();
    const secondApply = vi.fn();
    const second: LfoTarget = {min: 10, max: 20, apply: secondApply};
    const first: LfoTarget = {
      get min(): number {
        controller.setTarget(second);
        return 0;
      },
      max: 1,
      apply: firstApply,
    };
    const controller = new LfoController({
      now: () => 0.25,
      requestFrame: scheduler.request,
      cancelFrame: scheduler.cancel,
      target: first,
    });
    controller.start();

    scheduler.fire(1);
    expect(firstApply).not.toHaveBeenCalled();
    expect(secondApply).not.toHaveBeenCalled();
    scheduler.fire(2);
    expect(secondApply).toHaveBeenCalledOnce();
  });
});

describe('LfoController run lifecycle', () => {
  it('composes stop/start like disconnect/reconnect while retaining phase', () => {
    const {controller, scheduler, setNow} = createHarness();
    controller.start();
    setNow(0.4);
    scheduler.fire(1);
    expect(controller.snapshot().phase).toBeCloseTo(0.4);
    expect(scheduler.pending).toEqual([2]);

    controller.stop();
    controller.stop();
    expect(scheduler.cancelled).toEqual([2]);
    expect(controller.snapshot().running).toBe(false);
    expect(controller.snapshot().phase).toBeCloseTo(0.4);

    setNow(10);
    controller.setRunning(true);
    expect(controller.snapshot().running).toBe(true);
    expect(controller.snapshot().phase).toBeCloseTo(0.4);
    setNow(10.1);
    scheduler.fire(3);
    expect(controller.snapshot().phase).toBeCloseTo(0.5);
    controller.setRunning(false);
    expect(scheduler.cancelled).toEqual([2, 4]);
  });

  it('does not arm when a start subscriber stops re-entrantly', () => {
    const {controller, scheduler} = createHarness();
    controller.subscribe(() => {
      if (controller.snapshot().running) controller.stop();
    });

    controller.start();

    expect(controller.snapshot().running).toBe(false);
    expect(scheduler.pending).toEqual([]);
  });

  it('lets stop/start inside apply own the only next frame', () => {
    const scheduler = new FrameScheduler();
    let now = 0;
    const apply = vi.fn(() => {
      controller.stop();
      controller.start();
    });
    const controller = new LfoController({
      now: () => now,
      requestFrame: scheduler.request,
      cancelFrame: scheduler.cancel,
      target: {min: 0, max: 1, apply},
    });
    controller.start();
    now = 0.25;

    scheduler.fire(1);

    expect(apply).toHaveBeenCalledOnce();
    expect(controller.snapshot()).toMatchObject({running: true, phase: 0.25});
    expect(scheduler.pending).toEqual([2]);
    expect(scheduler.cancelled).toEqual([]);
  });

  it('contains and reports a target apply throw from a frame callback', () => {
    const failure = new Error('apply failed');
    const target = {min: 0, max: 1, apply: vi.fn(() => { throw failure; })};
    const onError = vi.fn();
    const {controller, scheduler, setNow} = createHarness({target, onError});
    const states: boolean[] = [];
    controller.subscribe(() => states.push(controller.snapshot().running));
    controller.start();
    setNow(0.2);

    expect(() => scheduler.fire(1)).not.toThrow();

    expect(controller.snapshot().running).toBe(false);
    expect(controller.snapshot().phase).toBeCloseTo(0.2);
    expect(scheduler.pending).toEqual([]);
    expect(states).toEqual([true, false]);
    expect(onError).toHaveBeenCalledExactlyOnceWith(failure);
    controller.start();
    expect(scheduler.pending).toEqual([2]);
  });

  it('contains a thrown undefined without losing the frame failure', () => {
    const onError = vi.fn();
    const {controller, scheduler} = createHarness({
      target: {
        min: 0,
        max: 1,
        apply: () => {
          throw undefined;
        },
      },
      onError,
    });
    controller.start();

    expect(() => scheduler.fire(1)).not.toThrow();
    expect(controller.snapshot().running).toBe(false);
    expect(onError).toHaveBeenCalledExactlyOnceWith(undefined);
  });

  it('contains an authoritative async apply rejection and reports it once', async () => {
    const failure = new Error('async apply failed');
    let reject!: (error: unknown) => void;
    const pending = new Promise<void>((_resolve, fail) => {
      reject = fail;
    });
    const onError = vi.fn(async () => {
      throw new Error('reporter failed');
    });
    const target: LfoTarget = {
      min: 0,
      max: 1,
      apply: () => pending,
    };
    const {controller, scheduler, setNow} = createHarness({target, onError});
    controller.start();
    setNow(0.1);
    scheduler.fire(1);
    expect(scheduler.pending).toEqual([2]);

    reject(failure);
    await Promise.resolve();
    await Promise.resolve();

    expect(controller.snapshot().running).toBe(false);
    expect(scheduler.cancelled).toEqual([2]);
    expect(onError).toHaveBeenCalledExactlyOnceWith(failure);
  });

  it('does not report an async failure after stop notification starts a new run', async () => {
    let reject!: (error: unknown) => void;
    const pending = new Promise<void>((_resolve, fail) => {
      reject = fail;
    });
    const onError = vi.fn();
    const {controller, scheduler, setNow} = createHarness({
      target: {min: 0, max: 1, apply: () => pending},
      onError,
    });
    controller.subscribe(() => {
      if (!controller.snapshot().running) controller.start();
    });
    controller.start();
    setNow(0.1);
    scheduler.fire(1);

    reject(new Error('superseded by subscriber'));
    await Promise.resolve();
    await Promise.resolve();

    expect(controller.snapshot().running).toBe(true);
    expect(scheduler.pending).toEqual([3]);
    expect(scheduler.cancelled).toEqual([2]);
    expect(onError).not.toHaveBeenCalled();
  });

  it('silently consumes rejections made stale by target swap, restart, or dispose', async () => {
    const deferred = (): {
      promise: Promise<void>;
      reject(error: unknown): void;
    } => {
      let reject!: (error: unknown) => void;
      const promise = new Promise<void>((_resolve, fail) => {
        reject = fail;
      });
      return {promise, reject};
    };
    const swapped = deferred();
    const restarted = deferred();
    const disposed = deferred();
    const first: LfoTarget = {
      min: 0,
      max: 1,
      apply: () => swapped.promise,
    };
    const nextResults = [restarted.promise, disposed.promise];
    const second: LfoTarget = {
      min: 0,
      max: 1,
      apply: () => nextResults.shift(),
    };
    const onError = vi.fn();
    const {controller, scheduler, setNow} = createHarness({
      target: first,
      onError,
    });
    controller.start();
    setNow(0.1);
    scheduler.fire(1);

    controller.setTarget(second);
    swapped.reject(new Error('swapped target'));
    await Promise.resolve();
    expect(controller.snapshot().running).toBe(true);

    setNow(0.2);
    scheduler.fire(2);
    controller.stop();
    controller.start();
    restarted.reject(new Error('old run'));
    await Promise.resolve();
    expect(controller.snapshot().running).toBe(true);

    setNow(0.3);
    scheduler.fire(4);
    controller.dispose();
    disposed.reject(new Error('disposed'));
    await Promise.resolve();
    await Promise.resolve();

    expect(controller.snapshot().running).toBe(false);
    expect(onError).not.toHaveBeenCalled();
  });

  it('cancels exactly once when stop occurs before requestFrame returns', () => {
    const cancelled: number[] = [];
    const controller = new LfoController({
      now: () => 0,
      requestFrame: () => {
        controller.stop();
        return 41;
      },
      cancelFrame: (handle) => cancelled.push(handle),
    });

    controller.start();
    controller.stop();

    expect(controller.snapshot().running).toBe(false);
    expect(cancelled).toEqual([41]);
  });

  it('rolls back running state when the injected clock or scheduler throws', () => {
    const clockFailure = new Error('clock failed');
    const clockError = vi.fn();
    const clock = new LfoController({
      now: () => {
        throw clockFailure;
      },
      requestFrame: () => 1,
      cancelFrame: () => {},
      onError: clockError,
    });

    expect(() => clock.start()).toThrow(clockFailure);
    expect(clock.snapshot().running).toBe(false);
    expect(clockError).not.toHaveBeenCalled();

    const scheduleFailure = new Error('schedule failed');
    const scheduleError = vi.fn();
    const scheduler = new LfoController({
      now: () => 0,
      requestFrame: () => {
        throw scheduleFailure;
      },
      cancelFrame: () => {},
      onError: scheduleError,
    });

    expect(() => scheduler.start()).toThrow(scheduleFailure);
    expect(scheduler.snapshot().running).toBe(false);
    expect(scheduleError).not.toHaveBeenCalled();
  });

  it('preserves a thrown undefined from direct cancellation', () => {
    const controller = new LfoController({
      requestFrame: () => 1,
      cancelFrame: () => {
        throw undefined;
      },
    });
    controller.start();
    let didThrow = false;

    try {
      controller.stop();
    } catch (error) {
      didThrow = true;
      expect(error).toBeUndefined();
    }

    expect(didThrow).toBe(true);
    expect(controller.snapshot().running).toBe(false);
  });

  it('skips listeners detached by unsubscribe or dispose during emit', () => {
    const order: string[] = [];
    const {controller, scheduler} = createHarness();
    let unsubscribeSecond = (): void => {};
    controller.subscribe(() => {
      order.push('first');
      unsubscribeSecond();
    });
    unsubscribeSecond = controller.subscribe(() => order.push('removed'));
    controller.subscribe(() => {
      order.push('dispose');
      controller.dispose();
    });
    controller.subscribe(() => order.push('after-dispose'));

    controller.start();

    expect(order).toEqual(['first', 'dispose']);
    expect(scheduler.pending).toEqual([]);
  });

  it('does not let a clock re-entry continue the superseded frame', () => {
    const scheduler = new FrameScheduler();
    const apply = vi.fn();
    let reads = 0;
    const controller = new LfoController({
      now: () => {
        reads += 1;
        if (reads === 2) {
          controller.stop();
          controller.start();
        }
        return reads / 10;
      },
      requestFrame: scheduler.request,
      cancelFrame: scheduler.cancel,
      target: {min: 0, max: 1, apply},
    });
    controller.start();

    scheduler.fire(1);

    expect(controller.snapshot()).toMatchObject({running: true, phase: 0});
    expect(apply).not.toHaveBeenCalled();
    expect(scheduler.pending).toEqual([2]);
  });

  it('makes a failed cancellation inert and never retries it', () => {
    const failure = new Error('cancel failed');
    const callback = vi.fn<LfoFrameCallback>();
    const cancel = vi.fn(() => { throw failure; });
    const controller = new LfoController({
      requestFrame: (next) => {
        callback.mockImplementation(next);
        return 7;
      },
      cancelFrame: cancel,
    });
    controller.start();

    expect(() => controller.stop()).toThrow(failure);
    expect(controller.snapshot().running).toBe(false);
    expect(() => controller.stop()).not.toThrow();
    expect(cancel).toHaveBeenCalledOnce();
    callback(0);
    expect(controller.snapshot().running).toBe(false);
  });

  it('disposes exactly once, clears subscribers, and never owns the target', () => {
    const target = {min: 0, max: 1, apply: vi.fn()};
    const {controller, scheduler} = createHarness({target});
    const notify = vi.fn();
    controller.subscribe(notify);
    controller.start();
    notify.mockClear();

    controller.dispose();
    controller.destroy();
    controller.start();
    controller.configure({rate: 4, target: undefined});

    expect(controller.snapshot()).toMatchObject({running: false, rate: 1});
    expect(scheduler.cancelled).toEqual([1]);
    expect(notify).not.toHaveBeenCalled();
    expect(target.apply).not.toHaveBeenCalled();
  });
});
