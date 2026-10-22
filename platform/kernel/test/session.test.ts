import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {SessionTransport} from '../src/session';
import {TransportClock} from '../src/transport';
import {createConnectionLease} from '../src/module/lease';

function deferred() {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((done, fail) => { resolve = done; reject = fail; });
  return {promise, resolve, reject};
}

function world() {
  let time = 0;
  const now = () => time;
  const session = new SessionTransport(now, {leadInSeconds: 0.05, driftCheckIntervalMs: 0,
    tick: {createWorker: () => null}});
  const leaf = () => {
    const clock = new TransportClock(now);
    const transport = {
      clock,
      play: vi.fn((when = now()) => { clock.startAt(when, clock.positionAt(now())); }),
      pause: vi.fn(() => clock.pause(now())),
      stop: vi.fn(() => { clock.pause(now()); clock.seekTo(0, now()); }),
      seek: vi.fn((position: number) => clock.seekTo(position, now())),
      setRate: vi.fn((rate: number) => clock.setRate(rate, now())),
      dispose: vi.fn(),
      get position() { return clock.positionAt(now()); },
      get running() { return !clock.paused; },
    };
    return transport;
  };
  return {now, session, leaf, advance: (seconds: number) => { time += seconds; }};
}

describe('source-free SessionTransport', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('conducts without a fabricated source, engine or audio context', async () => {
    const w = world();
    expect(w.session.snapshot).toMatchObject({axis: 'session-seconds', durationSeconds: null,
      participantCount: 0, paused: true, ended: false});
    expect(await w.session.play()).toMatchObject({status: 'committed', command: {type: 'play'}});
    w.advance(1.05);
    expect(w.session.position).toBeCloseTo(1);
    await w.session.pause();
    w.advance(2);
    expect(w.session.position).toBeCloseTo(1);
    w.session.dispose();
  });

  it('keeps discovery resource-free and anchors only after explicit preparation', async () => {
    const w = world();
    const pending = deferred();
    const prepare = vi.fn(() => pending.promise);
    const first = w.leaf();
    const second = w.leaf();
    w.session.register(first, {axis: 'clip-seconds', durationSeconds: 12, prepare});
    w.session.register(second, {axis: 'score-nominal-seconds', durationSeconds: 20});
    expect(prepare).not.toHaveBeenCalled();
    const playing = w.session.play();
    expect(prepare).toHaveBeenCalledOnce();
    expect(first.play).not.toHaveBeenCalled();
    w.advance(7);
    pending.resolve();
    await playing;
    expect(w.session.clock.state.originTime).toBeCloseTo(7.05);
    expect(first.play).toHaveBeenCalledWith(7.05);
    expect(second.play).toHaveBeenCalledWith(7.05);
    w.session.dispose();
  });

  it('maps seconds and rates explicitly and reports the mapped finite extent', async () => {
    const w = world();
    const leaf = w.leaf();
    w.session.register(leaf, {axis: 'score-nominal-seconds', durationSeconds: 22,
      offsetSeconds: 2, positionScale: 2});
    expect(w.session.snapshot.durationSeconds).toBe(10);
    await w.session.seek(3);
    await w.session.setRate(1.5);
    await w.session.play();
    expect(leaf.position).toBe(8);
    expect(leaf.clock.rate).toBe(3);
    w.advance(2.05);
    expect(w.session.position).toBeCloseTo(6);
    expect(leaf.position).toBeCloseTo(14);
    w.session.dispose();
  });

  it('rejects duplicate engines even through different adapters and stale releases are harmless', async () => {
    const w = world();
    const engine = {};
    const leaf = w.leaf();
    const lease = w.session.register(leaf, {axis: 'clip-seconds', durationSeconds: 10, identity: engine});
    expect(() => w.session.register(w.leaf(), {axis: 'clip-seconds', durationSeconds: 10, identity: engine})).toThrow(/lease/);
    await lease.ready;
    lease.release();
    await lease.settled;
    const replacement = w.session.register(leaf, {axis: 'clip-seconds', durationSeconds: 10, identity: engine});
    await replacement.ready;
    const pauses = leaf.pause.mock.calls.length;
    lease.release();
    expect(replacement.active).toBe(true);
    expect(leaf.pause).toHaveBeenCalledTimes(pauses);
    w.session.dispose();
  });

  it('removes one running member without disturbing peers or disposing borrowed engines', async () => {
    const w = world();
    const first = w.leaf();
    const second = w.leaf();
    const lease = w.session.register(first, {axis: 'clip-seconds', durationSeconds: 10});
    w.session.register(second, {axis: 'clip-seconds', durationSeconds: 10});
    await w.session.play();
    const peerPauses = second.pause.mock.calls.length;
    lease.release();
    await lease.settled;
    expect(first.running).toBe(false);
    expect(second.running).toBe(true);
    expect(second.pause).toHaveBeenCalledTimes(peerPauses);
    expect(w.session.snapshot.participantCount).toBe(1);
    w.session.dispose();
    expect(second.running).toBe(false);
    expect(first.dispose).not.toHaveBeenCalled();
    expect(second.dispose).not.toHaveBeenCalled();
  });

  it('quarantines an engine until a released pending start is cancelled', async () => {
    const w = world();
    const original = w.leaf();
    const pending = deferred();
    const leaf = {...original, play: vi.fn(async (when?: number) => {
      await pending.promise;
      original.play(when);
    })};
    const lease = w.session.register(leaf, {axis: 'clip-seconds', durationSeconds: 10, identity: original});
    const playing = w.session.play();
    await vi.advanceTimersByTimeAsync(0);
    expect(leaf.play).toHaveBeenCalledOnce();
    lease.release();
    expect(() => w.session.register(original, {axis: 'clip-seconds', durationSeconds: 10})).toThrow(/settling/);
    pending.resolve();
    await lease.settled;
    await playing;
    expect(original.running).toBe(false);
    const next = w.session.register(original, {axis: 'clip-seconds', durationSeconds: 10});
    await next.ready;
    expect(next.active).toBe(true);
    w.session.dispose();
  });

  it('leaving during preparation unblocks the remaining session but waits to release identity', async () => {
    const w = world();
    const leaf = w.leaf();
    const pending = deferred();
    const lease = w.session.register(leaf, {axis: 'clip-seconds', durationSeconds: 10,
      prepare: () => pending.promise});
    const playing = w.session.play();
    lease.release();
    await playing;
    expect(w.session.snapshot).toMatchObject({paused: false, participantCount: 0});
    expect(() => w.session.register(leaf, {axis: 'clip-seconds', durationSeconds: 10})).toThrow(/settling/);
    pending.resolve();
    await lease.settled;
    expect(leaf.play).not.toHaveBeenCalled();
    w.session.register(leaf, {axis: 'clip-seconds', durationSeconds: 10});
    w.session.dispose();
  });

  it('preserves command supersession when pause arrives during preparation', async () => {
    const w = world();
    const pending = deferred();
    const leaf = w.leaf();
    w.session.register(leaf, {axis: 'clip-seconds', durationSeconds: 10, prepare: () => pending.promise});
    const play = w.session.play();
    const pause = w.session.pause();
    pending.resolve();
    expect(await play).toMatchObject({status: 'superseded'});
    expect(await pause).toMatchObject({status: 'committed'});
    expect(w.session.snapshot.paused).toBe(true);
    expect(leaf.play).not.toHaveBeenCalled();
    w.session.dispose();
  });

  it('prepares and joins a new member without restarting an existing peer', async () => {
    const w = world();
    const peer = w.leaf();
    w.session.register(peer, {axis: 'clip-seconds', durationSeconds: 20});
    await w.session.play();
    const starts = peer.play.mock.calls.length;
    w.advance(2);
    const leaf = w.leaf();
    const pending = deferred();
    const lease = w.session.register(leaf, {axis: 'clip-seconds', durationSeconds: 10,
      prepare: () => pending.promise});
    expect(leaf.play).not.toHaveBeenCalled();
    w.advance(3);
    pending.resolve();
    await lease.ready;
    await vi.advanceTimersByTimeAsync(0);
    expect(peer.play).toHaveBeenCalledTimes(starts);
    expect(leaf.play).toHaveBeenCalledWith(5.05);
    expect(leaf.position).toBeCloseTo(5);
    w.session.dispose();
  });

  it('reports unknown/live durations and does not mistake pause for natural completion', async () => {
    const w = world();
    let duration: number | null = null;
    const leaf = w.leaf();
    w.session.register(leaf, {axis: 'clip-seconds', durationSeconds: () => duration});
    expect(w.session.snapshot.durationSeconds).toBeNull();
    duration = Infinity;
    expect(w.session.snapshot.durationSeconds).toBe(Infinity);
    await w.session.play();
    w.advance(100);
    leaf.pause();
    w.session.checkDrift();
    expect(w.session.snapshot).toMatchObject({paused: false, ended: false});
    duration = 2;
    w.session.checkDrift();
    expect(w.session.snapshot).toMatchObject({paused: false, ended: false});
    w.session.dispose();
  });

  it('ends only when every finite participant explicitly ended', async () => {
    const w = world();
    let firstEnded = false;
    let secondEnded = false;
    w.session.register(w.leaf(), {axis: 'clip-seconds', durationSeconds: 3, ended: () => firstEnded});
    w.session.register(w.leaf(), {axis: 'clip-seconds', durationSeconds: 6, ended: () => secondEnded});
    await w.session.play();
    w.advance(8);
    firstEnded = true;
    w.session.checkDrift();
    expect(w.session.snapshot.ended).toBe(false);
    secondEnded = true;
    w.session.checkDrift();
    expect(w.session.snapshot).toMatchObject({ended: true, paused: true, position: 6});
    await w.session.play();
    expect(w.session.snapshot).toMatchObject({ended: false, position: 0});
    w.session.dispose();
  });

  it('supports an explicit finite position policy and loops through the existing authority', async () => {
    const w = world();
    w.session.register(w.leaf(), {axis: 'clip-seconds', durationSeconds: 1, endPolicy: 'position'});
    await w.session.setLoop({startSeconds: 0, endSeconds: 1});
    await w.session.play();
    w.advance(2);
    w.session.checkDrift();
    expect(w.session.snapshot.ended).toBe(false);
    await w.session.setLoop(null);
    w.session.checkDrift();
    expect(w.session.snapshot).toMatchObject({ended: true, paused: true, position: 1});
    w.session.dispose();
  });

  it('an explicit session range can end a live member', async () => {
    const w = world();
    const session = new SessionTransport(w.now, {range: {startSeconds: 2, endSeconds: 4},
      leadInSeconds: 0, tick: {createWorker: () => null}});
    session.register(w.leaf(), {axis: 'live-seconds', durationSeconds: Infinity});
    await session.play();
    expect(session.snapshot.durationSeconds).toBe(4);
    w.advance(3);
    session.checkDrift();
    expect(session.snapshot).toMatchObject({ended: true, paused: true, position: 4});
    await session.stop();
    expect(session.position).toBe(2);
    session.dispose();
    w.session.dispose();
  });

  it.each((['check', 'tick'] as const).flatMap(driver =>
    (['invalidate', 'anchor'] as const).flatMap(phase =>
      (['stop', 'seek', 'play', 'dispose'] as const).map(command => ({driver, phase, command})))))(
    'preserves a newer $command from the natural-completion $phase callback during $driver', async ({driver, phase, command}) => {
      let time = 0;
      const session = new SessionTransport(() => time, {range: {startSeconds: 0, endSeconds: 1},
        leadInSeconds: 0, driftCheckIntervalMs: 0, tick: {createWorker: () => null}});
      let armed = false;
      let replaced = false;
      let replacement: ReturnType<SessionTransport['play']> | undefined;
      let immediatePosition: number | undefined;
      const anchors: number[] = [];
      const commands: string[] = [];
      session.subscribe(event => { if (armed && event.type === 'invalidate') commands.push(event.command.type); });
      session.scheduling.subscribe(event => {
        if (armed && event.type === 'anchor') anchors.push(event.snapshot.originPosition);
        if (!armed || replaced || event.type !== phase) return;
        replaced = true;
        if (command === 'dispose') session.dispose();
        else replacement = command === 'seek' ? session.seek(0.2) : session[command]();
        void replacement?.catch(() => {});
        immediatePosition = session.position;
      });
      try {
        await session.play();
        time = 1.25;
        armed = true;
        if (driver === 'check') expect(() => session.checkDrift()).not.toThrow();
        else await vi.advanceTimersByTimeAsync(25);
        expect(replaced).toBe(true);
        if (command === 'dispose') {
          expect(session.position).toBe(immediatePosition);
          expect(session.snapshot.disposed).toBe(true);
          expect(session.scheduling.snapshot.phase).toBe('disposed');
          expect(commands).toEqual([]);
        } else {
          const commit = await replacement;
          expect(commit?.status).toBe('committed');
          expect(commands).toEqual([command]);
          const position = command === 'seek' ? 0.2 : 0;
          const paused = command === 'stop' || command === 'seek' && phase === 'anchor';
          expect(session.snapshot).toMatchObject({position, paused, ended: false});
          expect(commit?.snapshot).toMatchObject({position, paused});
          expect(anchors.at(-1)).toBe(position);
          if (phase === 'invalidate') expect(anchors).not.toContain(1);
          time += 0.1;
          await vi.advanceTimersByTimeAsync(25);
          expect(session.position).toBeCloseTo(position + (paused ? 0 : 0.1));
          expect(session.snapshot.paused).toBe(paused);
        }
      } finally { session.dispose(); }
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it('failed preparation rejects the command without starting any engine', async () => {
    const w = world();
    const leaf = w.leaf();
    w.session.register(leaf, {axis: 'clip-seconds', durationSeconds: 10,
      prepare: () => Promise.reject(new Error('decode failed'))});
    await expect(w.session.play()).rejects.toThrow('decode failed');
    expect(w.session.snapshot.paused).toBe(true);
    expect(leaf.play).not.toHaveBeenCalled();
    w.session.dispose();
  });

  it.each(['prepare', 'activate', 'attach'] as const)('rejects member readiness when %s fails during a running join', async phase => {
    const w = world();
    await w.session.play();
    const failure = new Error(`${phase} failed`);
    const lease = w.session.register(w.leaf(), {axis: 'local', durationSeconds: 10,
      prepare: () => { if (phase === 'prepare') throw failure; },
      activate: async () => { if (phase === 'activate') throw failure; },
      attachScheduling: () => { if (phase === 'attach') throw failure; return createConnectionLease(() => {}); }});
    let readiness: unknown = 'pending';
    void lease.ready.then(() => { readiness = 'ready'; }, error => { readiness = error; });
    try {
      await expect(w.session.preload()).rejects.toBe(failure);
      await vi.advanceTimersByTimeAsync(0);
      expect(readiness).toBe(failure);
      expect(lease.active).toBe(true);
    } finally { lease.release(); await lease.settled; w.session.dispose(); }
  });

  it('exposes recovered readiness after a failed preparation is retried', async () => {
    const w = world();
    const leaf = w.leaf();
    let attempts = 0;
    const lease = w.session.register(leaf, {axis: 'clip-seconds', durationSeconds: 10,
      prepare: () => { if (++attempts === 1) throw new Error('transient decode failure'); }});
    const first = lease.ready;
    await expect(w.session.play()).rejects.toThrow('transient decode failure');
    await expect(first).rejects.toThrow('transient decode failure');
    expect(await w.session.play()).toMatchObject({status: 'committed'});
    expect(lease.ready).not.toBe(first);
    await expect(lease.ready).resolves.toBeUndefined();
    expect(leaf.play).toHaveBeenCalled();
    lease.release();
    await lease.settled;
    w.session.dispose();
  });

  it('reprepares changed source resources and snapshots the supplied callback', async () => {
    const w = world();
    const prepare = vi.fn();
    const replacement = vi.fn();
    const options = {axis: 'clip-seconds', durationSeconds: 10, prepare};
    w.session.register(w.leaf(), options);
    options.prepare = replacement;
    await w.session.play();
    await w.session.pause();
    await w.session.play();
    expect(prepare).toHaveBeenCalledTimes(2);
    expect(replacement).not.toHaveBeenCalled();
    w.session.dispose();
  });

  it('blocks identity reuse after a failed cancellation until release is retried successfully', async () => {
    const w = world();
    const leaf = w.leaf();
    const lease = w.session.register(leaf, {axis: 'clip-seconds', durationSeconds: 10});
    await w.session.play();
    const error = new Error('cannot retract sources');
    leaf.pause.mockImplementationOnce(() => { throw error; });
    expect(() => lease.release()).toThrow(error);
    expect(lease.cancellationError).toBe(error);
    expect(() => w.session.register(leaf, {axis: 'clip-seconds', durationSeconds: 10})).toThrow(/settling/);
    let settled = false;
    void lease.settled.then(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false);
    lease.release();
    await lease.settled;
    expect(lease.cancellationError).toBeUndefined();
    w.session.register(leaf, {axis: 'clip-seconds', durationSeconds: 10});
    w.session.dispose();
  });

  it('failed late-start cancellation retains the lease without stopping a running peer', async () => {
    const w = world();
    const leaf = w.leaf();
    const peer = w.leaf();
    const pending = deferred();
    const late = {...leaf, play: vi.fn(async (when?: number) => { await pending.promise; leaf.play(when); })};
    const lease = w.session.register(late, {axis: 'clip-seconds', durationSeconds: 10, identity: leaf});
    w.session.register(peer, {axis: 'clip-seconds', durationSeconds: 10});
    const playing = w.session.play();
    await vi.advanceTimersByTimeAsync(0);
    lease.release();
    const error = new Error('late cancellation failed');
    leaf.pause.mockImplementationOnce(() => { throw error; });
    pending.resolve();
    await playing;
    expect(peer.running).toBe(true);
    expect(lease.cancellationError).toBe(error);
    expect(() => w.session.register(leaf, {axis: 'clip-seconds', durationSeconds: 10})).toThrow(/settling/);
    lease.release();
    await lease.settled;
    expect(leaf.running).toBe(false);
    w.session.dispose();
  });

  it('observer registrations have separate lifetimes and rejected async observers are contained', async () => {
    const w = world();
    const listener = vi.fn();
    const first = w.session.subscribe(listener);
    const second = w.session.subscribe(listener);
    first();
    const before = listener.mock.calls.length;
    await w.session.seek(2);
    expect(listener.mock.calls.length).toBeGreaterThan(before);
    second();
    w.session.subscribe(async () => { throw new Error('observer failure'); });
    await w.session.play();
    expect(w.session.snapshot.paused).toBe(false);
    w.session.dispose();
  });

  it('keeps pending data separate from participants and waits before anchoring playback', async () => {
    const w = world();
    const first = w.leaf();
    const loaded = w.leaf();
    w.session.register(first, {axis: 'clip-seconds', durationSeconds: 2, endPolicy: 'position'});
    const hold = w.session.holdPendingSource();
    expect(w.session.snapshot).toMatchObject({participantCount: 1, pendingSourceCount: 1, durationSeconds: null});
    const play = w.session.play();
    await vi.advanceTimersByTimeAsync(0);
    expect(first.play).not.toHaveBeenCalled();
    w.advance(3);
    w.session.register(loaded, {axis: 'score-nominal-seconds', durationSeconds: 8, endPolicy: 'position'});
    hold.resolve();
    await play;
    expect(w.session.snapshot).toMatchObject({participantCount: 2, pendingSourceCount: 0, durationSeconds: 8});
    expect(first.play).toHaveBeenCalledWith(3.05);
    expect(loaded.play).toHaveBeenCalledWith(3.05);
    w.session.dispose();
  });

  it('does not end a partially loaded Session while its finite member has ended', async () => {
    const w = world();
    w.session.register(w.leaf(), {axis: 'clip-seconds', durationSeconds: 1, ended: () => true});
    await w.session.play();
    const hold = w.session.holdPendingSource();
    w.advance(3);
    w.session.checkDrift();
    expect(w.session.snapshot).toMatchObject({paused: false, ended: false, durationSeconds: null});
    hold.release();
    w.session.checkDrift();
    expect(w.session.snapshot).toMatchObject({paused: true, ended: true, durationSeconds: 1});
    w.session.dispose();
  });

  it('reports a failed source and rejects current and later plays until its reservation is released', async () => {
    const w = world();
    const hold = w.session.holdPendingSource();
    const errors: unknown[] = [];
    w.session.subscribe((event) => { if (event.type === 'source-error') errors.push(event.error); });
    const play = w.session.play();
    const failure = new Error('source could not be decoded');
    hold.reject(failure);
    await expect(play).rejects.toThrow(failure);
    await expect(w.session.play()).rejects.toThrow(failure);
    expect(errors).toEqual([failure]);
    expect(w.session.snapshot).toMatchObject({pendingSourceCount: 1, participantCount: 0, durationSeconds: null});
    hold.resolve();
    expect(hold.active).toBe(true);
    hold.release();
    expect(await w.session.play()).toMatchObject({status: 'committed'});
    w.session.dispose();
  });

  it('cancelling a load unblocks playback and ignores stale completion or failure', async () => {
    const w = world();
    const hold = w.session.holdPendingSource();
    const play = w.session.play();
    hold.release();
    hold.reject(new Error('cancelled request finished late'));
    hold.resolve();
    await expect(play).resolves.toMatchObject({status: 'committed'});
    expect(w.session.snapshot.pendingSourceCount).toBe(0);
    w.session.dispose();
  });

  it('disposal releases pending loads and supersedes a waiting start', async () => {
    const w = world();
    const hold = w.session.holdPendingSource();
    const play = w.session.play();
    w.session.dispose();
    await hold.ready;
    expect(await play).toMatchObject({status: 'superseded'});
    expect(hold.active).toBe(false);
    expect(w.session.snapshot).toMatchObject({disposed: true, pendingSourceCount: 0});
  });
});
