import {describe, expect, it} from 'vitest';
import {EventEmitter} from '../src/events';

interface Events {
  tick: number;
  label: string;
}

describe('EventEmitter', () => {
  it('on delivers payloads to subscribers', () => {
    const e = new EventEmitter<Events>();
    const got: number[] = [];
    e.on('tick', (n) => got.push(n));
    e.emit('tick', 1);
    e.emit('tick', 2);
    expect(got).toEqual([1, 2]);
  });

  it('keeps emit exception propagation while emitSafely isolates subscribers', () => {
    const e = new EventEmitter<Events>();
    const failure = new Error('listener failed');
    const received: number[] = [];
    const errors: unknown[] = [];
    e.on('tick', () => {
      throw failure;
    });
    e.on('tick', (value) => received.push(value));

    expect(() => e.emit('tick', 1)).toThrow(failure);
    expect(received).toEqual([]);

    e.emitSafely('tick', 2, (error) => { errors.push(error); });
    expect(received).toEqual([2]);
    expect(errors).toEqual([failure]);
  });

  it('does not let a failing emitSafely error observer escape delivery', () => {
    const e = new EventEmitter<Events>();
    const received: number[] = [];
    e.on('tick', () => {
      throw new Error('listener failed');
    });
    e.on('tick', (value) => received.push(value));

    expect(() => e.emitSafely('tick', 3, () => {
      throw new Error('observer failed');
    })).not.toThrow();
    expect(received).toEqual([3]);
  });

  it('snapshots safe-delivery listeners at dispatch start', () => {
    const e = new EventEmitter<Events>();
    const received: string[] = [];
    const late = (value: number) => received.push(`late:${value}`);
    const second = (value: number) => received.push(`second:${value}`);
    e.on('tick', (value) => {
      received.push(`first:${value}`);
      e.off('tick', second);
      e.on('tick', late);
    });
    e.on('tick', second);

    e.emitSafely('tick', 1, () => {});
    expect(received).toEqual(['first:1', 'second:1']);

    e.emitSafely('tick', 2, () => {});
    expect(received).toEqual(['first:1', 'second:1', 'first:2', 'late:2']);
  });

  it('reports rejected listeners and contains a rejected async observer', async () => {
    const e = new EventEmitter<Events>();
    const listenerFailure = new Error('async listener failed');
    const observerFailure = new Error('async observer failed');
    const errors: Array<{error: unknown; mode: string}> = [];
    e.once('tick', async () => {
      throw listenerFailure;
    });

    expect(e.emitSafely('tick', 4, async (error, mode) => {
      errors.push({error, mode});
      throw observerFailure;
    })).toBe(1);
    await Promise.resolve();
    await Promise.resolve();

    expect(errors).toEqual([{error: listenerFailure, mode: 'rejection'}]);
    expect(e.emitSafely('tick', 5, () => {})).toBe(0);
  });

  it('snapshots emit listeners at dispatch start (same membership as emitSafely)', () => {
    const e = new EventEmitter<Events>();
    const received: string[] = [];
    const late = (value: number) => received.push(`late:${value}`);
    const second = (value: number) => received.push(`second:${value}`);
    e.on('tick', (value) => {
      received.push(`first:${value}`);
      e.off('tick', second);
      e.on('tick', late);
    });
    e.on('tick', second);

    e.emit('tick', 1);
    expect(received).toEqual(['first:1', 'second:1']);

    e.emit('tick', 2);
    expect(received).toEqual(['first:1', 'second:1', 'first:2', 'late:2']);
  });

  it('a self-rearming once listener fires once per emit instead of looping', () => {
    const e = new EventEmitter<Events>();
    const got: number[] = [];
    const arm = (): void => {
      e.once('tick', (n) => {
        got.push(n);
        arm();
      });
    };
    arm();
    e.emit('tick', 1); // live-set iteration would deliver this emit forever
    e.emit('tick', 2);
    expect(got).toEqual([1, 2]);
  });

  it('once fires exactly once', () => {
    const e = new EventEmitter<Events>();
    const got: number[] = [];
    e.once('tick', (n) => got.push(n));
    e.emit('tick', 1);
    e.emit('tick', 2);
    expect(got).toEqual([1]);
  });

  it.each(['emit', 'emitSafely'] as const)('once fires only once across nested %s snapshots', (method) => {
    const emitter = new EventEmitter<Events>();
    const received: number[] = [];
    const emit = (value: number) => emitter[method]('tick', value, () => {});
    emitter.on('tick', (value) => {
      if (value === 1) emit(2);
    });
    emitter.once('tick', (value) => received.push(value));

    emit(1);
    emit(3);

    expect(received).toEqual([2]);
  });

  it('once unsubscribe before firing prevents delivery', () => {
    const e = new EventEmitter<Events>();
    const got: number[] = [];
    const off = e.once('tick', (n) => got.push(n));
    off();
    e.emit('tick', 1);
    expect(got).toEqual([]);
  });

  it('on returns an unsubscribe function', () => {
    const e = new EventEmitter<Events>();
    const got: number[] = [];
    const off = e.on('tick', (n) => got.push(n));
    e.emit('tick', 1);
    off();
    e.emit('tick', 2);
    expect(got).toEqual([1]);
  });

  it('off removes a specific listener only', () => {
    const e = new EventEmitter<Events>();
    const a: number[] = [];
    const b: number[] = [];
    const la = (n: number) => a.push(n);
    e.on('tick', la);
    e.on('tick', (n) => b.push(n));
    e.off('tick', la);
    e.emit('tick', 1);
    expect(a).toEqual([]);
    expect(b).toEqual([1]);
  });

  it('removeAllListeners(event) clears only that event', () => {
    const e = new EventEmitter<Events>();
    const ticks: number[] = [];
    const labels: string[] = [];
    e.on('tick', (n) => ticks.push(n));
    e.on('label', (s) => labels.push(s));
    e.removeAllListeners('tick');
    e.emit('tick', 1);
    e.emit('label', 'x');
    expect(ticks).toEqual([]);
    expect(labels).toEqual(['x']);
  });

  it('removeAllListeners(falsyKey) clears only that key, not the emitter', () => {
    // '' and 0 are legitimate keys of an event map and both are falsy, so a
    // truthiness test here would silently wipe every listener instead.
    interface FalsyEvents {
      '': number;
      0: number;
      keep: number;
    }
    const e = new EventEmitter<FalsyEvents>();
    const got: string[] = [];
    e.on('', () => got.push('empty'));
    e.on(0, () => got.push('zero'));
    e.on('keep', () => got.push('keep'));

    e.removeAllListeners('');
    e.emit('', 1);
    e.emit(0, 1);
    e.emit('keep', 1);
    expect(got).toEqual(['zero', 'keep']);

    got.length = 0;
    e.removeAllListeners(0);
    e.emit(0, 1);
    e.emit('keep', 1);
    expect(got).toEqual(['keep']);
  });

  it('removeAllListeners() clears everything (clear alias too)', () => {
    const e = new EventEmitter<Events>();
    const got: Array<number | string> = [];
    e.on('tick', (n) => got.push(n));
    e.on('label', (s) => got.push(s));
    e.removeAllListeners();
    e.emit('tick', 1);
    e.emit('label', 'x');
    expect(got).toEqual([]);

    const e2 = new EventEmitter<Events>();
    e2.on('tick', (n) => got.push(n));
    e2.clear();
    e2.emit('tick', 9);
    expect(got).toEqual([]);
  });
});
