import {describe, expect, it} from 'vitest';
import {EventEmitter} from '../../src/core';

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

    e.emitSafely('tick', 2, (error) => {
      errors.push(error);
    });
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

  it('once fires exactly once', () => {
    const e = new EventEmitter<Events>();
    const got: number[] = [];
    e.once('tick', (n) => got.push(n));
    e.emit('tick', 1);
    e.emit('tick', 2);
    expect(got).toEqual([1]);
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
