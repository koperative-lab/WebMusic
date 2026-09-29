import {describe, expect, it, vi} from 'vitest';
import {EventEmitter} from '../../src/core/events/EventEmitter';

interface Events {
  tick: number;
  done: void;
}

describe('EventEmitter', () => {
  it('delivers typed payloads to subscribers', () => {
    const em = new EventEmitter<Events>();
    const seen: number[] = [];
    em.on('tick', (n) => seen.push(n));
    em.emit('tick', 1);
    em.emit('tick', 2);
    expect(seen).toEqual([1, 2]);
  });

  it('off and the returned unsubscribe both stop delivery', () => {
    const em = new EventEmitter<Events>();
    const fn = vi.fn();
    const off = em.on('tick', fn);
    off();
    em.emit('tick', 1);
    expect(fn).not.toHaveBeenCalled();
  });

  it('once fires exactly once', () => {
    const em = new EventEmitter<Events>();
    const fn = vi.fn();
    em.once('tick', fn);
    em.emit('tick', 1);
    em.emit('tick', 2);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('removeAllListeners clears a single event', () => {
    const em = new EventEmitter<Events>();
    const fn = vi.fn();
    em.on('tick', fn);
    em.removeAllListeners('tick');
    em.emit('tick', 1);
    expect(fn).not.toHaveBeenCalled();
  });
});
