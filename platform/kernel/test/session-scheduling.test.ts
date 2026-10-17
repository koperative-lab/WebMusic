import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {SessionTransport, type SessionSchedulingBinding, type SessionSchedulingEvent} from '../src/session';
import {createConnectionLease} from '../src/module/lease';

function world() {
  let time = 0;
  const session = new SessionTransport(() => time, {leadInSeconds: 0.1, driftCheckIntervalMs: 0, tick: {createWorker: () => null}});
  const transport = () => ({play: vi.fn(), pause: vi.fn(), stop: vi.fn(), seek: vi.fn(), setRate: vi.fn(), position: 0});
  return {session, transport, time: (value: number) => { time = value; }};
}

describe('shared Session scheduling authority', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('removes a constructor loop from scheduling views when looping is disabled', async () => {
    let time = 0;
    const session = new SessionTransport(() => time, {loop: {startSeconds: 0, endSeconds: 1}, leadInSeconds: 0,
      driftCheckIntervalMs: 0, tick: {createWorker: () => null}});
    try {
      expect(session.scheduling.snapshot.loop).toEqual({startSeconds: 0, endSeconds: 1});
      await session.play();
      await session.setLoop(null);
      time = 2.5;
      expect(session.snapshot.loop).toBeNull();
      expect(session.scheduling.snapshot.loop).toBeNull();
      expect(session.position).toBe(2.5);
      expect(session.scheduling.segments(2.5, 3.5)).toMatchObject([{positionStart: 2.5, positionEnd: 3.5}]);
    } finally { session.dispose(); }
  });

  it('prepares and activates every member before selecting one origin, without legacy commands', async () => {
    const w = world(), first = w.transport(), second = w.transport();
    let binding!: SessionSchedulingBinding;
    let ready!: () => void;
    const activation = new Promise<void>(resolve => { ready = resolve; });
    const activate = vi.fn(() => activation);
    const attach = vi.fn((next: SessionSchedulingBinding) => { binding = next; return createConnectionLease(() => {}); });
    w.session.register(first, {axis: 'local', durationSeconds: 10, activate, attachScheduling: attach});
    w.session.register(second, {axis: 'other', durationSeconds: 10, attachScheduling: () => createConnectionLease(() => {})});
    await w.session.preload();
    expect(activate).not.toHaveBeenCalled();
    const play = w.session.play();
    await vi.advanceTimersByTimeAsync(0);
    expect(activate).toHaveBeenCalledOnce();
    expect(binding.snapshot.phase).toBe('invalidated');
    w.time(7); ready(); await play;
    expect(binding.snapshot).toMatchObject({phase: 'ready', originTime: 7.1, paused: false});
    expect(binding.authority).toBe(w.session.scheduling.authority);
    expect(first.play).not.toHaveBeenCalled(); expect(first.seek).not.toHaveBeenCalled();
    expect(second.play).not.toHaveBeenCalled();
    w.session.dispose();
    expect(first.pause).not.toHaveBeenCalled();
  });

  it('delivers synchronous invalidation before any anchor mutation and supports reentrant commands', async () => {
    const w = world(), events: SessionSchedulingEvent[] = [];
    w.session.scheduling.subscribe(event => events.push(event));
    await w.session.play();
    events.length = 0;
    const seek = w.session.seek(3);
    expect(events[0]).toMatchObject({type: 'invalidate', snapshot: {originPosition: 0, phase: 'invalidated'}});
    await seek;
    expect(events.at(-1)).toMatchObject({type: 'anchor', snapshot: {originPosition: 3, phase: 'ready'}});
    let replacement: Promise<unknown> | undefined;
    const off = w.session.scheduling.subscribe(event => {
      if (event.type === 'invalidate' && !replacement) replacement = w.session.pause();
    });
    // Prevent callback recursion while assigning the resulting promise.
    off();
    let replaced = false;
    w.session.scheduling.subscribe(event => {
      if (event.type === 'invalidate' && !replaced) { replaced = true; replacement = w.session.pause(); }
    });
    const result = await w.session.seek(9);
    await replacement;
    expect(result.status).toBe('superseded');
    expect(w.session.scheduling.snapshot.paused).toBe(true);
    expect(w.session.scheduling.snapshot.originPosition).toBe(3);
    w.session.dispose();
  });

  it('does not arm a superseded play origin after preparation when a newer seek is queued', async () => {
    const w = world();
    let prepared!: () => void;
    const preparation = new Promise<void>(resolve => { prepared = resolve; });
    const anchors: number[] = [];
    w.session.register(w.transport(), {axis: 'local', durationSeconds: 10, prepare: () => preparation,
      attachScheduling: binding => createConnectionLease(binding.subscribe(event => {
        if (event.type === 'anchor' && !event.snapshot.paused) anchors.push(event.snapshot.originPosition);
      }))});
    const play = w.session.play();
    const seek = w.session.seek(3);
    prepared();
    expect((await play).status).toBe('superseded');
    await seek;
    expect(anchors).toEqual([3]);
    w.session.dispose();
  });

  it.each(['rate', 'loop'] as const)('retains a queued seek position for the final %s anchor', async command => {
    const w = world();
    let prepared!: () => void;
    const preparation = new Promise<void>(resolve => { prepared = resolve; });
    w.session.register(w.transport(), {axis: 'local', durationSeconds: 20, prepare: () => preparation,
      attachScheduling: () => createConnectionLease(() => {})});
    const anchors: SessionSchedulingEvent[] = [];
    w.session.scheduling.subscribe(event => {
      if (event.type === 'anchor' && !event.snapshot.paused) anchors.push(event);
    });
    try {
      const play = w.session.play(), seek = w.session.seek(3);
      const latest = command === 'rate' ? w.session.setRate(2) : w.session.setLoop({startSeconds: 0, endSeconds: 10});
      prepared();
      await Promise.all([play, seek, latest]);
      expect(anchors).toHaveLength(1);
      expect(anchors[0].snapshot).toMatchObject({originPosition: 3,
        rate: command === 'rate' ? 2 : 1, loop: command === 'loop' ? {startSeconds: 0, endSeconds: 10} : null});
    } finally { prepared(); w.session.dispose(); }
  });

  it('applies a queued loop without publishing the obsolete origin before a newer seek', async () => {
    const w = world();
    let prepared!: () => void;
    const preparation = new Promise<void>(resolve => { prepared = resolve; });
    w.session.register(w.transport(), {axis: 'local', durationSeconds: 20, prepare: () => preparation,
      attachScheduling: () => createConnectionLease(() => {})});
    const positions: number[] = [];
    w.session.scheduling.subscribe(event => {
      if (event.type === 'anchor' && !event.snapshot.paused) positions.push(event.snapshot.originPosition);
    });
    try {
      const play = w.session.play(), loop = w.session.setLoop({startSeconds: 1, endSeconds: 10}), seek = w.session.seek(3);
      prepared();
      await Promise.all([play, loop, seek]);
      expect(positions).toEqual([3]);
      expect(w.session.scheduling.snapshot.loop).toEqual({startSeconds: 1, endSeconds: 10});
    } finally { prepared(); w.session.dispose(); }
  });

  it('splits future passes exactly, excluding preroll, with affine mapping and stable iteration identities', async () => {
    const w = world();
    let binding!: SessionSchedulingBinding;
    w.session.register(w.transport(), {axis: 'scaled', durationSeconds: 20, offsetSeconds: -2, positionScale: 2,
      attachScheduling: next => { binding = next; return createConnectionLease(() => {}); }});
    await w.session.setLoop({startSeconds: 1, endSeconds: 2});
    await w.session.setRate(2);
    await w.session.play();
    expect(binding.snapshot.loop).toEqual({startSeconds: 0, endSeconds: 2});
    const segments = binding.segments(0, 2.1);
    expect(segments.map(segment => [segment.iteration, segment.positionStart, segment.positionEnd])).toEqual([
      [0, -2, 2], [1, 0, 2], [2, 0, 2],
    ]);
    expect(segments[0]).toMatchObject({referenceStart: 0.1, referenceEnd: 1.1, rate: 4});
    expect(segments[1].referenceStart).toBe(segments[0].referenceEnd);
    expect(binding.clock.positionAt(1.6)).toBeCloseTo(4);
    expect(binding.positionAt(1.6)).toBeCloseTo(0);
    expect(binding.clock.timeAt(4)).toBeCloseTo(1.6);
    w.time(1.6);
    expect(binding.segments(1.6, 1.7)[0].iteration).toBe(2);
    w.session.dispose();
  });

  it.each([0.05, -0.1])('keeps decimal loop boundaries contiguous at rate 1.5 with offset %s', async offset => {
    const w = world();
    let binding!: SessionSchedulingBinding;
    w.session.register(w.transport(), {axis: 'local', durationSeconds: 10, offsetSeconds: offset,
      attachScheduling: next => { binding = next; return createConnectionLease(() => {}); }});
    await w.session.setLoop({startSeconds: 0, endSeconds: 0.6});
    await w.session.setRate(1.5); await w.session.play();
    const windows = binding.segments(0, 2);
    expect(windows).toHaveLength(5);
    for (let index = 1; index < windows.length; index++) {
      expect(windows[index].referenceStart).toBe(windows[index - 1].referenceEnd);
      expect(windows[index].referenceEnd).toBeGreaterThan(windows[index].referenceStart);
      expect(windows[index].positionStart).toBe(offset);
      expect(windows[index].iteration).toBe(index);
    }
    expect(windows.at(-1)?.referenceEnd).toBe(2);
    w.session.dispose();
  });

  it('keeps the continuous owner anchor across many loops and freezes with reference time', async () => {
    const w = world();
    await w.session.setLoop({startSeconds: 0, endSeconds: 1});
    await w.session.play();
    const epoch = w.session.scheduling.epoch, origin = w.session.clock.state.originTime;
    w.time(5.35);
    await vi.advanceTimersByTimeAsync(1000);
    expect(w.session.clock.state.originTime).toBe(origin);
    expect(w.session.scheduling.epoch).toBe(epoch);
    expect(w.session.clock.positionAt(5.35)).toBeCloseTo(5.25);
    expect(w.session.position).toBeCloseTo(0.25);
    const before = w.session.scheduling.snapshot;
    await vi.advanceTimersByTimeAsync(5000);
    expect(w.session.scheduling.snapshot).toEqual(before);
    w.session.dispose();
  });

  it('releases one borrowed binding without changing peers or calling legacy pause', async () => {
    const w = world();
    let a!: SessionSchedulingBinding, b!: SessionSchedulingBinding;
    const first = w.transport(), release = vi.fn();
    const lease = w.session.register(first, {axis: 'a', durationSeconds: 5, attachScheduling: next => { a = next; return createConnectionLease(release); }});
    w.session.register(w.transport(), {axis: 'b', durationSeconds: 5, attachScheduling: next => { b = next; return createConnectionLease(() => {}); }});
    await w.session.play();
    const observer = vi.fn(); a.subscribe(observer);
    const epoch = b.epoch;
    lease.release(); await lease.settled;
    expect(a.snapshot.phase).toBe('disposed');
    expect(observer).toHaveBeenLastCalledWith(expect.objectContaining({type: 'dispose'}));
    expect(a.segments(0, 1)).toEqual([]);
    expect(b.snapshot.paused).toBe(false); expect(b.epoch).toBe(epoch);
    expect(release).toHaveBeenCalledOnce(); expect(first.pause).not.toHaveBeenCalled();
    w.session.dispose();
  });

  it('contains failed arm callbacks by pausing the authority and cancelling other members', async () => {
    const w = world();
    let cancelled = 0;
    w.session.register(w.transport(), {axis: 'bad', durationSeconds: 10, attachScheduling: binding => {
      const off = binding.subscribe(event => { if (event.type === 'anchor' && !event.snapshot.paused) throw new Error('arm failed'); });
      return createConnectionLease(off);
    }});
    w.session.register(w.transport(), {axis: 'peer', durationSeconds: 10, attachScheduling: binding => {
      const off = binding.subscribe(event => { if (event.snapshot.paused) cancelled++; });
      return createConnectionLease(off);
    }});
    await expect(w.session.play()).rejects.toThrow('arm failed');
    expect(w.session.snapshot.paused).toBe(true);
    expect(cancelled).toBeGreaterThan(0);
    w.session.dispose();
  });
});
