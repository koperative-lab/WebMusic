import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {TransportClock} from '../src/transport';
import {
  MirrorClockMaster,
  TransportGroup,
  type ClocklessMasterTransport,
  type SyncFollowerTransport,
} from '../src/sync';

/**
 * Neutral fakes on an injectable reference clock. The master is built ON a
 * real kernel TransportClock (the required-clock contract); followers model
 * a buffer-engine-like scheduled start whose position parks at the seek
 * offset through the pre-roll. The full behavioral matrix additionally runs
 * through the bridge's ScoreAudioSync suite, which drives this same class
 * behind the domain adapters.
 */
function makeWorld() {
  let t = 0;
  const now = () => t;
  const advance = (dt: number) => {
    t += dt;
  };

  const masterCalls: string[] = [];
  const masterClock = new TransportClock(now);
  const master = {
    async play(when?: number) {
      masterCalls.push('play');
      if (when !== undefined && when > now()) {
        masterClock.startAt(when, masterClock.positionAt(now()));
      } else {
        masterClock.start(now());
      }
    },
    pause() {
      masterCalls.push('pause');
      masterClock.pause(now());
    },
    stop() {
      masterCalls.push('stop');
      masterClock.pause(now());
      masterClock.seekTo(0, now());
    },
    seekPosition(position: number, _when?: number) {
      masterCalls.push(`seek:${position}`);
      masterClock.seekTo(position, now());
    },
    setRate(rate: number) {
      masterClock.setRate(rate, now());
    },
    get position() {
      return masterClock.positionAt(now());
    },
    clock: masterClock,
  };

  function makeFollower() {
    const calls: Array<{op: string; value?: number}> = [];
    let state = {offset: 0, when: 0, running: false, rate: 1};
    const transport = {
      async play(when?: number) {
        calls.push({op: 'play', value: when});
        state = {...state, when: when ?? now(), running: true};
      },
      pause() {
        calls.push({op: 'pause'});
        state = {...state, offset: this.position, running: false};
      },
      stop() {
        calls.push({op: 'stop'});
        state = {...state, offset: 0, running: false};
      },
      seek(position: number) {
        calls.push({op: 'seek', value: position});
        state = {...state, offset: position, when: now()};
      },
      setRate(rate: number) {
        state = {...state, offset: this.position, when: Math.max(state.when, now()), rate};
      },
      get running() {
        return state.running;
      },
      get position() {
        if (!state.running) return state.offset;
        // Mirrors a buffer engine: position holds at the offset through the pre-roll.
        return state.offset + Math.max(0, now() - state.when) * state.rate;
      },
    };
    return {transport, calls};
  }

  const {transport: follower, calls: followerCalls} = makeFollower();
  return {now, advance, master, masterClock, masterCalls, follower, followerCalls, makeFollower};
}

function makeGroup(
  world: ReturnType<typeof makeWorld>,
  options: ConstructorParameters<typeof TransportGroup>[2] = {},
  followerOptions: {offsetSeconds?: number} = {},
) {
  const group = new TransportGroup(world.master, world.now, {
    leadInSeconds: 0.05,
    driftCheckIntervalMs: 0,
    ...options,
  });
  group.addFollower(world.follower, followerOptions);
  return group;
}

describe('TransportGroup joins and drift', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('starts master and follower on one shared armed origin', async () => {
    const world = makeWorld();
    const group = makeGroup(world);

    await group.play();

    expect(world.masterClock.holding).toBe(true);
    expect(world.masterClock.state.originTime).toBeCloseTo(0.05, 9);
    const playCall = world.followerCalls.find((c) => c.op === 'play');
    expect(playCall?.value).toBeCloseTo(0.05, 9); // the very same instant
    expect(world.masterClock.positionAt(world.now())).toBe(0); // no master-only lead

    world.advance(1.05);
    expect(world.follower.position).toBeCloseTo(world.master.position, 9);
    expect(group.position).toBeCloseTo(world.master.position, 9);
  });

  it('exposes the master clock read-through and holds off drift through the pre-roll', async () => {
    const world = makeWorld();
    const group = makeGroup(world, {leadInSeconds: 0.5});
    expect(group.clock).toBe(world.masterClock);

    await group.play();
    const seeksBefore = world.followerCalls.filter((c) => c.op === 'seek').length;
    world.advance(0.2); // inside the pre-roll
    expect(group.checkDrift()).toBe(0);
    expect(world.followerCalls.filter((c) => c.op === 'seek')).toHaveLength(seeksBefore);
  });

  it('re-joins a drifted follower on the shared clock', async () => {
    const world = makeWorld();
    const group = makeGroup(world);
    await group.play();
    world.advance(1);
    world.follower.seek(world.follower.position + 0.2); // inject drift

    const drift = group.checkDrift();
    expect(Math.abs(drift)).toBeGreaterThan(0.03);
    await vi.advanceTimersByTimeAsync(0);
    const ops = world.followerCalls.slice(-3).map((c) => c.op);
    expect(ops).toEqual(['pause', 'seek', 'play']);
    world.advance(0.05);
    expect(world.follower.position).toBeCloseTo(world.master.position, 9);
  });

  it('waits for a follower\'s later armed start without hiding other followers\' drift', async () => {
    const world = makeWorld();
    const group = makeGroup(world);
    const clock = new TransportClock(world.now);
    let requested = 0;
    const delayed = {
      clock,
      play: vi.fn((when = world.now()) => {
        clock.startAt(when + Math.max(0, 2 - requested) / clock.rate, Math.max(2, requested));
      }),
      pause: () => clock.pause(world.now()),
      stop: () => clock.pause(world.now()),
      seek: (position: number) => { requested = position; },
      setRate: (rate: number) => clock.setRate(rate, world.now()),
      get position() { return clock.position; },
    };
    group.addFollower(delayed);
    await group.play();

    for (let check = 0; check < 5; check += 1) {
      world.advance(0.25);
      expect(group.checkDrift()).toBe(0);
      await vi.advanceTimersByTimeAsync(0);
    }
    expect(delayed.play).toHaveBeenCalledOnce();
    world.follower.seek(world.follower.position + 0.2);
    expect(group.checkDrift()).toBeCloseTo(0.2, 9);
    await vi.advanceTimersByTimeAsync(0);
    expect(delayed.play).toHaveBeenCalledOnce();

    world.advance(1);
    expect(group.checkDrift()).toBeCloseTo(0, 9);
    clock.seekTo(clock.position + 0.2, world.now());
    expect(group.checkDrift()).toBeCloseTo(0.2, 9);
    await vi.advanceTimersByTimeAsync(0);
    expect(delayed.play).toHaveBeenCalledTimes(2);
    group.dispose();
  });

  it('applies a per-follower offset', async () => {
    const world = makeWorld();
    const group = makeGroup(world, {leadInSeconds: 0.1}, {offsetSeconds: 1.5});
    await group.play();
    const seekCall = world.followerCalls.find((c) => c.op === 'seek');
    // Armed start: the master's position at the shared origin is 0, so the
    // follower parks exactly at its offset.
    expect(seekCall?.value).toBeCloseTo(1.5, 9);
    world.advance(2);
    expect(group.checkDrift()).toBeCloseTo(0, 9);
  });

  it('re-joins only the follower that drifted, not the whole set', async () => {
    const world = makeWorld();
    const second = world.makeFollower();
    const group = makeGroup(world);
    group.addFollower(second.transport);
    await group.play();
    world.advance(1);

    second.transport.seek(second.transport.position + 0.2); // only #2 drifts
    const before = world.followerCalls.length;
    group.checkDrift();
    await vi.advanceTimersByTimeAsync(0);

    expect(world.followerCalls.length).toBe(before); // #1 untouched
    const ops = second.calls.slice(-3).map((c) => c.op);
    expect(ops).toEqual(['pause', 'seek', 'play']);
    world.advance(0.05);
    expect(second.transport.position).toBeCloseTo(world.master.position, 9);
  });

  it('joins a follower added mid-playback and stops managing a removed one', async () => {
    const world = makeWorld();
    const group = makeGroup(world);
    await group.play();
    world.advance(0.5);

    const late = world.makeFollower();
    group.addFollower(late.transport);
    await vi.advanceTimersByTimeAsync(0);
    world.advance(0.1);
    expect(late.transport.position).toBeCloseTo(world.master.position, 9);
    expect(group.followerCount).toBe(2);

    expect(group.removeFollower(late.transport)).toBe(true);
    expect(group.removeFollower(late.transport)).toBe(false);
    const opsAfterRemove = late.calls.length;
    group.pause();
    expect(late.calls.length).toBe(opsAfterRemove); // no longer commanded
    expect(group.followerCount).toBe(1);
  });
});

describe('TransportGroup lifecycle hardening', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('keeps pause authoritative when an older async play settles later', async () => {
    const world = makeWorld();
    let resolvePlay!: () => void;
    world.master.play = () =>
      new Promise<void>((resolve) => {
        resolvePlay = () => {
          world.masterClock.start(world.now());
          resolve();
        };
      });
    const group = makeGroup(world);

    const pending = group.play();
    await Promise.resolve();
    group.pause();
    resolvePlay();
    await pending;

    expect(world.masterClock.paused).toBe(true);
    expect(world.followerCalls.some(({op}) => op === 'play')).toBe(false);
  });

  it('executes overlapping seeks in call order', async () => {
    const world = makeWorld();
    let releaseFirst!: () => void;
    let seeks = 0;
    const original = world.master.seekPosition.bind(world.master);
    world.master.seekPosition = (position: number, when?: number) => {
      seeks += 1;
      if (seeks === 1) {
        return new Promise<void>((resolve) => {
          releaseFirst = () => {
            original(position, when);
            resolve();
          };
        });
      }
      return original(position, when);
    };
    const group = makeGroup(world);

    const first = group.seek(0.25);
    const second = group.seek(0.75);
    releaseFirst();
    await Promise.all([first, second]);

    expect(world.master.position).toBeCloseTo(0.75, 9);
    expect(world.follower.position).toBeCloseTo(0.75, 9);
  });

  it('settles as paused and reports when the master stays paused after a mid-playback seek', async () => {
    const world = makeWorld();
    const failures: string[] = [];
    const group = makeGroup(world, {
      onOperationError: (operation) => {
        failures.push(operation);
      },
    });
    await group.play();
    world.advance(1);
    world.master.seekPosition = (position: number) => {
      world.masterClock.pause(world.now());
      world.masterClock.seekTo(position, world.now());
    };

    await group.seek(0.5);

    expect(world.follower.running).toBe(false);
    expect(world.follower.position).toBeCloseTo(0.5, 9);
    expect(failures).toEqual(['resume after seek']);
  });

  it('rolls back and reports a failed independent re-join', async () => {
    const world = makeWorld();
    const failures: Array<{operation: string; error: unknown}> = [];
    const group = makeGroup(world, {
      leadInSeconds: 0,
      onOperationError: (operation, error) => {
        failures.push({operation, error});
      },
    });
    await group.play();
    world.follower.play = async () => {
      throw new Error('re-join failed');
    };

    group.setRate(2);
    await vi.advanceTimersByTimeAsync(0);

    expect(world.masterClock.paused).toBe(true);
    expect(world.follower.running).toBe(false);
    expect(failures).toHaveLength(1);
    expect(failures[0].operation).toBe('rate re-join');
    expect((failures[0].error as Error).message).toBe('re-join failed');
  });

  it('settles into pause and idles the monitor when the master stops on its own', async () => {
    const world = makeWorld();
    const group = makeGroup(world, {
      driftCheckIntervalMs: 250,
      tick: {intervalMs: 25, createWorker: () => null},
    });
    await group.play();
    world.advance(3);
    world.masterClock.pause(world.now());
    world.masterClock.seekTo(0, world.now());

    await vi.advanceTimersByTimeAsync(30);

    expect(world.follower.running).toBe(false); // not left running alone
    expect(vi.getTimerCount()).toBe(0); // the watcher idles

    await group.play(); // recovers cleanly
    expect(world.masterClock.paused).toBe(false);
    expect(vi.getTimerCount()).toBe(1);
    group.dispose();
  });

  it('contains watcher read failures and pauses participants before reporting them', async () => {
    const world = makeWorld();
    const master = Object.assign(world.master, {
      reconcile() { throw new Error('transport clock unavailable'); },
    });
    const failures: Array<{operation: string; paused: boolean}> = [];
    const group = new TransportGroup(master, world.now, {
      driftCheckIntervalMs: 25,
      tick: {createWorker: () => null},
      onOperationError(operation) {
        failures.push({operation, paused: world.masterClock.paused});
      },
    });
    group.addFollower(world.follower);
    await group.dispatch({type: 'play'});
    await vi.advanceTimersByTimeAsync(25);
    expect(failures).toEqual([{operation: 'transport monitor', paused: true}]);
    expect(world.follower.running).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    group.dispose();
  });

  it('wraps a whole-piece loop even when the master finishes first', async () => {
    const world = makeWorld();
    const group = makeGroup(world, {
      loop: {startSeconds: 0, endSeconds: 2},
      tick: {intervalMs: 25, createWorker: () => null},
    });
    await group.play();
    world.advance(2.001);
    // The master's own finish wins the race: pause + rewind before the
    // group's watcher sees the boundary.
    world.masterClock.pause(world.now());
    world.masterClock.seekTo(0, world.now());

    await vi.advanceTimersByTimeAsync(30);

    expect(world.masterCalls).toContain('seek:0');
    expect(world.masterCalls.filter((call) => call === 'play')).toHaveLength(2);
    expect(world.masterClock.paused).toBe(false);
    world.advance(0.06);
    expect(world.follower.running).toBe(true);
    expect(world.follower.position).toBeCloseTo(world.master.position, 9);
  });

  it('validates options and disposes every member even when one throws', () => {
    const world = makeWorld();
    expect(() => new TransportGroup(world.master, world.now, {leadInSeconds: -1})).toThrow(RangeError);
    expect(() => new TransportGroup(world.master, world.now, {tick: {intervalMs: 0}})).toThrow(RangeError);
    expect(
      () => new TransportGroup(world.master, world.now, {loop: {startSeconds: 1, endSeconds: 1}}),
    ).toThrow(RangeError);

    const disposals: string[] = [];
    const master = {
      ...world.master,
      dispose() {
        disposals.push('master');
      },
    };
    const group = new TransportGroup(master, world.now);
    const follower: SyncFollowerTransport = {
      ...world.follower,
      dispose() {
        disposals.push('follower');
        throw new Error('follower dispose failed');
      },
    };
    group.addFollower(follower);
    expect(() => group.dispose()).toThrow('follower dispose failed');
    expect(disposals).toEqual(['follower', 'master']); // master still released
    expect(() => group.dispose()).not.toThrow();
    expect(() => group.checkDrift()).toThrow(/disposed/);
  });
});

describe('MirrorClockMaster (clockless fallback)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function makeClocklessWorld(clampAt?: number) {
    let t = 0;
    const now = () => t;
    const advance = (dt: number) => {
      t += dt;
    };
    const calls: string[] = [];
    const innerClock = new TransportClock(now);
    const inner: ClocklessMasterTransport = {
      async play() {
        calls.push('play');
        innerClock.start(now());
      },
      pause() {
        calls.push('pause');
        innerClock.pause(now());
      },
      stop() {
        calls.push('stop');
        innerClock.pause(now());
        innerClock.seekTo(0, now());
      },
      seekPosition(position: number) {
        calls.push(`seek:${position}`);
        innerClock.seekTo(position, now());
      },
      setRate(rate: number) {
        innerClock.setRate(rate, now());
      },
      get position() {
        const raw = innerClock.positionAt(now());
        return clampAt === undefined ? raw : Math.min(clampAt, raw);
      },
    };
    return {now, advance, inner, innerClock, calls};
  }

  it('anchors by sampling and stays aligned', async () => {
    const world = makeClocklessWorld();
    const {transport: follower} = (() => {
      let state = {offset: 0, when: 0, running: false, rate: 1};
      const transport = {
        async play(when?: number) {
          state = {...state, when: when ?? world.now(), running: true};
        },
        pause() {
          state = {...state, offset: this.position, running: false};
        },
        stop() {
          state = {...state, offset: 0, running: false};
        },
        seek(position: number) {
          state = {...state, offset: position, when: world.now()};
        },
        get position() {
          if (!state.running) return state.offset;
          return state.offset + Math.max(0, world.now() - state.when) * state.rate;
        },
        get running() {
          return state.running;
        },
      };
      return {transport};
    })();
    const master = new MirrorClockMaster(world.inner, world.now);
    const group = new TransportGroup(master, world.now, {leadInSeconds: 0.05, driftCheckIntervalMs: 0});
    group.addFollower(follower);

    await group.play();
    world.advance(1.05);
    expect(follower.position).toBeCloseTo(world.inner.position, 9);
    expect(group.clock.positionAt(world.now())).toBeCloseTo(world.inner.position, 9);
  });

  it('re-anchors the mirror to the transport before measuring drift', async () => {
    const world = makeClocklessWorld();
    world.inner.setRate = () => {}; // the transport refuses the shared rate
    const master = new MirrorClockMaster(world.inner, world.now);
    const group = new TransportGroup(master, world.now, {leadInSeconds: 0.05, driftCheckIntervalMs: 0});
    let followerPos = 0;
    const follower = {
      async play() {
        /* running from wherever it was seeked */
      },
      pause() {},
      stop() {},
      seek(position: number) {
        followerPos = position;
      },
      setRate() {},
      get position() {
        return followerPos + 1; // permanently one second ahead of its seek target
      },
      running: true,
    };
    group.addFollower(follower);
    await group.play();
    world.advance(1.05);
    group.setRate(2); // mirror would reckon 2x; the transport stays at 1x
    await vi.advanceTimersByTimeAsync(0);
    world.advance(1);

    const drift = group.checkDrift();

    // Blind dead reckoning would have compared against the 2x extrapolation;
    // anchored to the transport the drift reflects the truth axis.
    expect(group.clock.positionAt(world.now())).toBeCloseTo(world.inner.position, 9);
    expect(Number.isFinite(drift)).toBe(true);
  });

  it('reports a stalled transport and the group settles instead of sailing on', async () => {
    const world = makeClocklessWorld(2); // clamps at its 2s duration
    const master = new MirrorClockMaster(world.inner, world.now);
    const {transport: follower} = (() => {
      let state = {offset: 0, when: 0, running: false};
      const transport = {
        async play(when?: number) {
          state = {...state, when: when ?? world.now(), running: true};
        },
        pause() {
          state = {...state, offset: this.position, running: false};
        },
        stop() {
          state = {...state, offset: 0, running: false};
        },
        seek(position: number) {
          state = {...state, offset: position, when: world.now()};
        },
        get position() {
          if (!state.running) return state.offset;
          return state.offset + Math.max(0, world.now() - state.when);
        },
        get running() {
          return state.running;
        },
      };
      return {transport};
    })();
    const group = new TransportGroup(master, world.now, {
      leadInSeconds: 0.05,
      driftCheckIntervalMs: 100,
      tick: {intervalMs: 25, createWorker: () => null},
    });
    group.addFollower(follower);

    await group.play();
    world.advance(2.05); // sail past the transport's own end
    await vi.advanceTimersByTimeAsync(100); // first check samples the pin
    world.advance(0.1);
    await vi.advanceTimersByTimeAsync(100); // second check: stalled → settle

    expect(follower.running).toBe(false);
    expect(group.clock.paused).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('TransportGroup command authority', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('delivers a coherent initial snapshot and stable seek positions at non-unit rate', async () => {
    const world = makeWorld();
    const group = makeGroup(world);
    const events: string[] = [];
    const detach = group.subscribe((event) => events.push(`${event.type}:${event.snapshot.revision}`));
    expect(events).toEqual(['snapshot:0']);
    await group.dispatch({type: 'rate', rate: 2});
    const commit = await group.dispatch({type: 'seek', position: 10});
    expect(commit).toMatchObject({status: 'committed', revision: 2, snapshot: {position: 10, rate: 2, pending: false}});
    expect(world.follower.position).toBe(10);
    expect(events).toEqual(['snapshot:0', 'invalidate:1', 'commit:1', 'invalidate:2', 'commit:2']);
    detach();
    await group.dispatch({type: 'play'});
    expect(events).toHaveLength(5);
    group.dispose();
  });

  it('invalidates before starting and respects reentrant replacement from an observer', async () => {
    const world = makeWorld();
    const group = makeGroup(world);
    let replacement: Promise<unknown> | undefined;
    group.subscribe((event) => {
      if (event.type === 'invalidate' && event.command.type === 'play') {
        replacement = group.dispatch({type: 'pause'});
      }
    });
    const revisions: number[] = [];
    group.subscribe((event) => revisions.push(event.snapshot.revision));
    const stale = await group.dispatch({type: 'play'});
    await replacement;
    expect(stale.status).toBe('superseded');
    expect(world.masterCalls).not.toContain('play');
    expect(group.snapshot.paused).toBe(true);
    expect(revisions).toEqual([...revisions].sort((a, b) => a - b));
    group.dispose();
  });

  it('awaits late-start reconciliation before committing pause', async () => {
    const world = makeWorld();
    let release!: () => void;
    const started = new Promise<void>((resolve) => { release = resolve; });
    const play = world.follower.play.bind(world.follower);
    world.follower.play = async (when?: number) => {
      await started;
      await play(when);
    };
    const group = makeGroup(world);
    const pendingPlay = group.dispatch({type: 'play'});
    await Promise.resolve();
    let paused = false;
    const pendingPause = group.dispatch({type: 'pause'}).then((value) => { paused = true; return value; });
    await Promise.resolve();
    expect(paused).toBe(false);
    release();
    expect((await pendingPlay).status).toBe('superseded');
    expect((await pendingPause).snapshot).toMatchObject({paused: true, pending: false});
    expect(world.follower.running).toBe(false);
    group.dispose();
  });

  it('rejects a failed participant start and publishes failure after cleanup', async () => {
    const world = makeWorld();
    world.follower.play = async () => { throw new Error('unavailable instrument'); };
    const group = makeGroup(world);
    const failures: boolean[] = [];
    group.subscribe((event) => { if (event.type === 'error') failures.push(event.snapshot.paused); });
    await expect(group.dispatch({type: 'play'})).rejects.toThrow('unavailable instrument');
    expect(failures).toEqual([true]);
    expect(world.follower.running).toBe(false);
    group.dispose();
  });

  it('rejects an observably refused follower start instead of committing it', async () => {
    const world = makeWorld();
    world.follower.play = async () => {};
    const group = makeGroup(world);
    await expect(group.dispatch({type: 'play'})).rejects.toThrow('Follower transport did not start');
    expect(group.snapshot).toMatchObject({paused: true, pending: false});
    expect(world.follower.running).toBe(false);
    group.dispose();
  });

  it('uses a follower clock to observe a refused start without a running getter', async () => {
    const world = makeWorld();
    const clock = new TransportClock(world.now);
    const group = new TransportGroup(world.master, world.now, {driftCheckIntervalMs: 0});
    group.addFollower({
      play() {},
      pause() { clock.pause(world.now()); },
      stop() { clock.pause(world.now()); },
      seek(position) { clock.seekTo(position, world.now()); },
      get position() { return clock.position; },
      clock,
    });
    await expect(group.dispatch({type: 'play'})).rejects.toThrow('Follower transport did not start');
    expect(group.snapshot.paused).toBe(true);
    group.dispose();
  });

  it('does not seek a follower removed by its rate callback during a join', async () => {
    const world = makeWorld();
    const group = makeGroup(world);
    world.follower.setRate = () => { group.removeFollower(world.follower); };
    await group.dispatch({type: 'play'});
    expect(world.followerCalls.map((call) => call.op)).toEqual(['pause']);
    expect(group.followerCount).toBe(0);
    group.dispose();
  });

  it('does not seek after a rate callback supersedes the join with stop', async () => {
    const world = makeWorld();
    const group = makeGroup(world);
    await group.dispatch({type: 'seek', position: 9});
    world.followerCalls.length = 0;
    world.follower.setRate = () => { group.stop(); };
    expect((await group.dispatch({type: 'play'})).status).toBe('superseded');
    expect(world.followerCalls.some((call) => call.op === 'seek')).toBe(false);
    expect(world.follower.position).toBe(0);
    group.dispose();
  });

  it.each(['pause', 'stop'] as const)('still %ss remaining followers when an earlier member detaches itself', async (command) => {
    const world = makeWorld();
    const group = makeGroup(world);
    const sibling = world.makeFollower();
    group.addFollower(sibling.transport);
    await group.dispatch({type: 'play'});
    const apply = world.follower[command].bind(world.follower);
    world.follower[command] = () => {
      apply();
      group.removeFollower(world.follower);
    };
    await group.dispatch({type: command});
    expect(sibling.transport.running).toBe(false);
    expect(sibling.calls.at(-1)?.op).toBe(command);
    group.dispose();
  });

  it('does not continue a paused seek after a follower synchronously stops the group', async () => {
    const world = makeWorld();
    const group = makeGroup(world);
    const sibling = world.makeFollower();
    group.addFollower(sibling.transport);
    world.follower.seek = () => { group.stop(); };
    expect((await group.dispatch({type: 'seek', position: 7})).status).toBe('superseded');
    expect(sibling.calls.some((call) => call.op === 'seek')).toBe(false);
    expect(sibling.transport.position).toBe(0);
    group.dispose();
  });

  it('does not claim successful seeking when the master silently fails to resume', async () => {
    const world = makeWorld();
    const group = makeGroup(world);
    await group.dispatch({type: 'play'});
    world.master.seekPosition = (position) => {
      world.masterClock.pause(world.now());
      world.masterClock.seekTo(position, world.now());
    };
    await expect(group.dispatch({type: 'seek', position: 8})).rejects.toThrow('stayed paused');
    expect(world.follower.running).toBe(false);
    expect(group.snapshot.paused).toBe(true);
    group.dispose();
  });

  it('rejects an observably refused rate instead of committing it', async () => {
    const world = makeWorld();
    world.master.setRate = () => {};
    const group = makeGroup(world);
    await expect(group.dispatch({type: 'rate', rate: 2})).rejects.toThrow('did not accept');
    expect(group.snapshot).toMatchObject({rate: 1, paused: true, pending: false});
    group.dispose();
  });

  it('keeps disposal final when pending work settles later', async () => {
    const world = makeWorld();
    let release!: () => void;
    world.master.play = () => new Promise<void>((resolve) => { release = resolve; });
    const group = makeGroup(world);
    const states: boolean[] = [];
    group.subscribe((event) => states.push(event.snapshot.disposed));
    const pending = group.dispatch({type: 'play'});
    group.dispose();
    release();
    expect((await pending).status).toBe('superseded');
    expect(group.snapshot.disposed).toBe(true);
    expect(states.at(-1)).toBe(true);
    expect(world.followerCalls.some((call) => call.op === 'play')).toBe(false);
  });

  it('reports watcher loop re-entry through the same revisioned authority', async () => {
    const world = makeWorld();
    const group = makeGroup(world);
    const seeks: number[] = [];
    group.subscribe((event) => {
      if (event.type === 'invalidate' && event.command.type === 'seek') seeks.push(event.command.position);
    });
    await group.dispatch({type: 'loop', loop: {startSeconds: 1, endSeconds: 2}});
    await group.dispatch({type: 'play'});
    world.advance(3);
    await vi.advanceTimersByTimeAsync(25);
    expect(seeks).toEqual([1]);
    expect(group.snapshot.position).toBe(1);
    expect(group.snapshot.revision).toBeGreaterThan(2);
    group.dispose();
  });

  it('validates commands without invalidating an existing valid session', () => {
    const group = makeGroup(makeWorld());
    expect(() => group.dispatch({type: 'seek', position: Number.NaN})).toThrow(RangeError);
    expect(group.snapshot.revision).toBe(0);
    group.dispose();
  });
});

describe('TransportGroup affine participant coordinates', () => {
  it('scales both local positions and rates while reporting drift on the master axis', async () => {
    const world = makeWorld();
    const group = new TransportGroup(world.master, world.now, {leadInSeconds: 0.05, driftCheckIntervalMs: 0});
    group.addFollower(world.follower, {offsetSeconds: 3, positionScale: 0.5});
    await group.dispatch({type: 'rate', rate: 2});
    await group.dispatch({type: 'seek', position: 10});
    expect(world.follower.position).toBe(8);
    await group.dispatch({type: 'play'});
    world.advance(2.05);
    expect(world.master.position).toBe(14);
    expect(world.follower.position).toBe(10);
    expect(group.checkDrift()).toBeCloseTo(0, 9);
    await group.dispatch({type: 'pause'});
    await group.dispatch({type: 'seek', position: 6});
    expect(world.follower.position).toBe(6);
    group.dispose();
  });

  it('rejects invalid mappings and scaled participants without rate control', () => {
    const world = makeWorld();
    const group = new TransportGroup(world.master, world.now, {driftCheckIntervalMs: 0});
    expect(() => group.addFollower(world.follower, {positionScale: 0})).toThrow(RangeError);
    expect(() => group.addFollower({...world.follower, setRate: undefined}, {positionScale: 2})).toThrow(/setRate/);
    expect(group.followerCount).toBe(0);
    group.dispose();
  });
});

describe('TransportGroup independent native loop mappings', () => {
  it('keeps the session continuous across different native loop periods and unwrapped clocks', async () => {
    const world = makeWorld();
    const group = new TransportGroup(world.master, world.now, {leadInSeconds: 0, driftCheckIntervalMs: 0});
    const first = world.follower;
    const second = world.makeFollower().transport;
    // These fakes expose unwrapped native-engine clocks. Loop mapping metadata
    // makes drift phase-aware without requiring the engine reader to wrap.
    group.addFollower(first, {loop: {startSeconds: 0, endSeconds: 4}});
    group.addFollower(second, {offsetSeconds: 1, positionScale: 0.5, loop: {startSeconds: 1, endSeconds: 4}});
    await group.dispatch({type: 'seek', position: 10});
    expect(first.position).toBe(2);
    expect(second.position).toBe(3);
    await group.dispatch({type: 'play'});
    world.advance(12);
    expect(group.snapshot.position).toBe(22);
    expect(first.position).toBe(14);
    expect(second.position).toBe(9);
    expect(group.checkDrift()).toBeCloseTo(0, 9);
    await group.dispatch({type: 'pause'});
    await group.dispatch({type: 'rate', rate: 2});
    await group.dispatch({type: 'seek', position: 9});
    expect(first.position).toBe(1);
    expect(second.position).toBe(2.5);
    group.dispose();
  });

  it('compares short phase error across a native loop boundary instead of whole-period drift', async () => {
    const world = makeWorld();
    const group = new TransportGroup(world.master, world.now, {leadInSeconds: 0, driftCheckIntervalMs: 0});
    group.addFollower(world.follower, {loop: {startSeconds: 0, endSeconds: 4}});
    await group.dispatch({type: 'play'});
    world.advance(3.99);
    world.follower.seek(4.01);
    expect(group.checkDrift()).toBeCloseTo(0.02, 9);
    group.dispose();
  });
});

describe('TransportGroup observer and reconciliation lifetime', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('removes an observer that throws during its initial delivery', async () => {
    const group = makeGroup(makeWorld());
    const listener = vi.fn(() => { throw new Error('view setup failed'); });
    const detach = group.subscribe(listener);
    await group.dispatch({type: 'seek', position: 4});
    expect(listener).toHaveBeenCalledTimes(1);
    detach();
    group.dispose();
  });

  it('makes a failed background drift correction observable and revises its state', async () => {
    const world = makeWorld();
    const group = makeGroup(world);
    const events: string[] = [];
    group.subscribe((event) => events.push(event.type));
    await group.dispatch({type: 'play'});
    const before = group.snapshot.revision;
    world.advance(1);
    world.follower.seek(9);
    world.follower.play = async () => { throw new Error('route lost'); };
    group.checkDrift();
    await vi.advanceTimersByTimeAsync(0);
    expect(group.snapshot.revision).toBeGreaterThan(before);
    expect(group.snapshot.paused).toBe(true);
    expect(events).toContain('reconcile');
    expect(events).toContain('operation-error');
    group.dispose();
  });

  it('observes the master stopping by itself through a pause commit', async () => {
    const world = makeWorld();
    const group = makeGroup(world, {driftCheckIntervalMs: 25});
    await group.dispatch({type: 'play'});
    const before = group.snapshot.revision;
    world.master.pause();
    await vi.advanceTimersByTimeAsync(25);
    expect(group.snapshot).toMatchObject({paused: true, pending: false});
    expect(group.snapshot.revision).toBeGreaterThan(before);
    expect(world.follower.running).toBe(false);
    group.dispose();
  });
});

describe('TransportGroup partial asynchronous failure', () => {
  it('waits for another pending start and retracts it before reporting a failed join', async () => {
    const world = makeWorld();
    const late = world.makeFollower().transport;
    let release!: () => void;
    const start = late.play.bind(late);
    late.play = async (when?: number) => {
      await new Promise<void>((resolve) => { release = resolve; });
      await start(when);
    };
    world.follower.play = async () => { throw new Error('first failed'); };
    const group = new TransportGroup(world.master, world.now, {driftCheckIntervalMs: 0});
    group.addFollower(world.follower);
    group.addFollower(late);
    let reported = false;
    const pending = group.dispatch({type: 'play'}).catch((error: unknown) => { reported = true; return error; });
    await Promise.resolve();
    await Promise.resolve();
    expect(reported).toBe(false);
    release();
    expect(await pending).toBeInstanceOf(Error);
    expect(late.running).toBe(false);
    expect(group.snapshot.paused).toBe(true);
    group.dispose();
  });

  it('releases the remaining participants even when one pause throws', async () => {
    const world = makeWorld();
    const extra = world.makeFollower().transport;
    const group = makeGroup(world);
    group.addFollower(extra);
    await group.dispatch({type: 'play'});
    world.follower.pause = () => { throw new Error('pause hook failed'); };
    await expect(group.dispatch({type: 'pause'})).rejects.toThrow('pause hook failed');
    expect(extra.running).toBe(false);
    expect(world.masterClock.paused).toBe(true);
    group.dispose();
  });
});

describe('TransportGroup mixed queued command authority', () => {
  it('keeps a newer seek alive when an older asynchronous rate re-join fails', async () => {
    const world = makeWorld();
    const group = makeGroup(world);
    await group.dispatch({type: 'play'});
    let fail!: (error: Error) => void;
    let releaseSeek!: () => void;
    let joins = 0;
    const play = world.follower.play.bind(world.follower);
    world.follower.play = (when) => {
      joins += 1;
      return joins === 1 ? new Promise<void>((_resolve, reject) => { fail = reject; }) : play(when);
    };
    const seek = world.master.seekPosition.bind(world.master);
    world.master.seekPosition = (position, when) => new Promise<void>((resolve) => {
      releaseSeek = () => { seek(position, when); resolve(); };
    });
    group.setRate(2); // legacy surface queues a rate re-join
    const newer = group.dispatch({type: 'seek', position: 10});
    fail(new Error('old rate join failed'));
    for (let n = 0; n < 8; n += 1) await Promise.resolve();
    releaseSeek();
    const result = await newer;
    expect(result.status).toBe('committed');
    expect(result.snapshot.paused).toBe(false);
    expect(world.follower.running).toBe(true);
    group.dispose();
  });
});
