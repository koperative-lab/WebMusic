import {describe, expect, it, vi} from 'vitest';
import {ParamHandle, ParamSurface, type ParamDescriptor} from '../src/module/parameter';

const descriptor: ParamDescriptor = {
  id: 'gain', unit: 'linear-gain', range: {min: 0, max: 2}, defaultValue: 1, step: 0.1,
};

describe('shared numeric parameter handles', () => {
  it('borrows the same handle across surfaces and publishes committed base state', () => {
    const apply = vi.fn();
    const handle = new ParamHandle(descriptor, {apply});
    const first = new ParamSurface([handle]);
    const second = new ParamSurface([handle]);
    const observed: number[] = [];
    first.get('gain')!.subscribe((snapshot) => {
      expect(snapshot).toBe(handle.snapshot);
      expect(apply).toHaveBeenLastCalledWith(snapshot.baseValue);
      observed.push(snapshot.baseValue);
    });
    second.get('gain')!.setBaseValue(1.25);
    expect([...first]).toEqual([handle]);
    expect(observed).toEqual([1.25]);
    expect(handle.snapshot).toEqual({baseValue: 1.25, revision: 1, baseRevision: 1, disposed: false, effectiveReadback: {status: 'unavailable'}});
    expect(handle.descriptor.step).toBe(0.1); // UI increment does not quantize legal values.
  });

  it('validates metadata and values before invoking a backend', () => {
    const apply = vi.fn();
    const handle = new ParamHandle(descriptor, {apply});
    for (const value of [NaN, Infinity, -1, 3]) expect(() => handle.setBaseValue(value)).toThrow(RangeError);
    expect(apply).not.toHaveBeenCalled();
    expect(() => new ParamHandle({...descriptor, defaultValue: 3})).toThrow(RangeError);
    expect(() => new ParamHandle({...descriptor, step: 0})).toThrow(RangeError);
    expect(() => new ParamHandle({...descriptor, range: {min: 2, max: 1}})).toThrow();
    expect(() => new ParamHandle({...descriptor, scale: 'logarithmic'})).toThrow(RangeError);
    expect(() => new ParamSurface([handle, handle])).toThrow('Duplicate');
  });

  it('keeps a finite UI display range separate from legal parameter writes', () => {
    const displayRange = {min: 0, max: 2};
    const handle = new ParamHandle({...descriptor, range: {min: 0, max: Number.MAX_VALUE}, displayRange});
    displayRange.max = 9;
    expect(handle.descriptor.displayRange).toEqual({min: 0, max: 2});
    handle.setBaseValue(20);
    expect(handle.snapshot.baseValue).toBe(20);
    for (const invalid of [{min: -1, max: 1}, {min: 0, max: 3}, {min: 2, max: 1}, {min: 0, max: Infinity}]) {
      expect(() => new ParamHandle({...descriptor, displayRange: invalid})).toThrow('finite ordered subset');
    }
  });

  it('retains the exact previous snapshot when a synchronous backend rejects', () => {
    const failure = new Error('backend rejected');
    const handle = new ParamHandle(descriptor, {apply: () => { throw failure; }});
    const before = handle.snapshot;
    const listener = vi.fn();
    handle.subscribe(listener);
    expect(() => handle.setBaseValue(0.5)).toThrow(failure);
    expect(handle.snapshot).toBe(before);
    expect(listener).not.toHaveBeenCalled();
  });

  it('rejects writes re-entering backend apply before stale state can overwrite them', () => {
    const handle: ParamHandle = new ParamHandle(descriptor, {apply: () => handle.setBaseValue(0.2)});
    expect(() => handle.setBaseValue(0.5)).toThrow('re-enter');
    expect(handle.snapshot.baseValue).toBe(1);
    expect(handle.snapshot.revision).toBe(0);
  });

  it('does not deliver an old snapshot after a listener commits a newer value', () => {
    const handle = new ParamHandle(descriptor);
    const seen: number[] = [];
    handle.subscribe((snapshot) => { if (snapshot.baseValue === 0.5) handle.setBaseValue(0.25); });
    handle.subscribe((snapshot) => seen.push(snapshot.baseValue));
    handle.subscribe(() => { throw new Error('bad observer'); });
    expect(() => handle.setBaseValue(0.5)).not.toThrow();
    expect(seen).toEqual([0.25]);
    expect(handle.snapshot.revision).toBe(2);
  });

  it('disposes once, releases subscriptions and makes all borrowed surfaces terminal', () => {
    const handle = new ParamHandle(descriptor);
    const surface = new ParamSurface([handle]);
    const unsubscribed = vi.fn();
    const off = handle.subscribe(unsubscribed);
    off();
    off();
    const lifecycle = vi.fn();
    handle.subscribe(lifecycle);
    handle.dispose();
    handle.dispose();
    expect(lifecycle).toHaveBeenCalledOnce();
    expect(unsubscribed).not.toHaveBeenCalled();
    expect(surface.get('gain')!.snapshot.disposed).toBe(true);
    expect(() => surface.get('gain')!.setBaseValue(1)).toThrow('disposed');
  });

  it('cannot resurrect a parameter disposed inside its backend callback', () => {
    const handle: ParamHandle = new ParamHandle(descriptor, {apply: () => handle.dispose()});
    expect(() => handle.setBaseValue(0.5)).toThrow('disposed');
    expect(handle.snapshot).toMatchObject({baseValue: 1, revision: 1, disposed: true});
  });

  it('gives identical callbacks independently releasable subscriptions and contains async observers', async () => {
    const handle = new ParamHandle(descriptor);
    const listener = vi.fn();
    const oldOff = handle.subscribe(listener);
    handle.subscribe(listener);
    oldOff();
    oldOff();
    handle.subscribe(async () => { throw new Error('async observer'); });
    handle.setBaseValue(0.25);
    await Promise.resolve();
    expect(listener).toHaveBeenCalledOnce();
  });

  it('rejects an async backend without committing its candidate value', async () => {
    const handle = new ParamHandle(descriptor, {apply: async () => { throw new Error('async backend'); }});
    expect(() => handle.setBaseValue(0.5)).toThrow('synchronous');
    await Promise.resolve();
    expect(handle.snapshot.baseValue).toBe(1);
    expect(handle.snapshot.revision).toBe(0);
  });
});
