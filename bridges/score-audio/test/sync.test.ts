import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {TransportClock} from '@webmusic/kernel/transport';
import {createAudioClip} from '@webmusic/audio';
import type {Score} from '@webmusic/score';
import {ScoreAudioSync, createSyncedPlayback} from '../src/sync';

/** Mirrors MAX_CONSECUTIVE_DRIFT_JOINS in src/sync.ts (module-private). */
const MAX_DRIFT_ATTEMPTS = 3;

/**
 * Fake audio-clock context plus structural transports. `withClock: true`
 * builds the score fake ON a real kernel TransportClock and exposes it (the
 * ScorePlayer v2 contract); `withClock: false` models a clockless transport
 * (TonePlayer, third parties) exercising the sampled fallback path.
 */
function makeWorld({withClock = true} = {}) {
  const ctx = {currentTime: 0} as unknown as BaseAudioContext;
  const clock = () => (ctx as unknown as {currentTime: number}).currentTime;
  const advance = (dt: number) => {
    (ctx as unknown as {currentTime: number}).currentTime += dt;
  };

  const scoreCalls: string[] = [];
  const scoreClock = new TransportClock(clock);
  const score = {
    async play() {
      scoreCalls.push('play');
      scoreClock.start(clock());
    },
    pause() {
      scoreCalls.push('pause');
      scoreClock.pause(clock());
    },
    stop() {
      scoreCalls.push('stop');
      scoreClock.pause(clock());
      scoreClock.seekTo(0, clock());
    },
    seekNominal(nominalSeconds: number) {
      scoreCalls.push(`seekNominal:${nominalSeconds}`);
      scoreClock.seekTo(nominalSeconds, clock());
    },
    setRate(rate: number) {
      scoreClock.setRate(rate, clock());
    },
    get nominalSeconds() {
      return scoreClock.positionAt(clock());
    },
    ...(withClock ? {clock: scoreClock} : {}),
  };

  const clipCalls: Array<{op: string; value?: number}> = [];
  let clipState = {offset: 0, when: 0, playing: false, rate: 1};
  const clip = {
    async play(when?: number) {
      clipCalls.push({op: 'play', value: when});
      clipState = {...clipState, when: when ?? clock(), playing: true};
    },
    pause() {
      clipCalls.push({op: 'pause'});
      clipState = {...clipState, offset: this.seconds, playing: false};
    },
    stop() {
      clipCalls.push({op: 'stop'});
      clipState = {...clipState, offset: 0, playing: false};
    },
    seek(seconds: number) {
      clipCalls.push({op: 'seek', value: seconds});
      clipState = {...clipState, offset: seconds, when: clock()};
    },
    setRate(rate: number) {
      clipState = {...clipState, offset: this.seconds, when: Math.max(clipState.when, clock()), rate};
    },
    get playing() {
      return clipState.playing;
    },
    get seconds() {
      if (!clipState.playing) return clipState.offset;
      // Mirrors BufferEngine: position holds at the offset through the pre-roll.
      return clipState.offset + Math.max(0, clock() - clipState.when) * clipState.rate;
    },
  };

  return {ctx, clockNow: clock, advance, score, scoreClock, clip, scoreCalls, clipCalls};
}

describe('ScoreAudioSync (clock-anchored transport)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('schedules the clip to join at the lead-in with an anchor-matched offset', async () => {
    const {ctx, score, clip, clipCalls} = makeWorld();
    const sync = new ScoreAudioSync(score, clip, ctx, {leadInSeconds: 0.1, driftCheckIntervalMs: 0});
    await sync.play();
    const seekCall = clipCalls.find((c) => c.op === 'seek');
    const playCall = clipCalls.find((c) => c.op === 'play');
    expect(playCall?.value).toBeCloseTo(0.1, 9); // when = t0 + leadIn
    expect(seekCall?.value).toBeCloseTo(0.1, 9); // clock.positionAt(when)
  });

  it('keeps the two transports aligned once the clip joins', async () => {
    const {ctx, clockNow, advance, score, clip} = makeWorld();
    const sync = new ScoreAudioSync(score, clip, ctx, {leadInSeconds: 0.05, driftCheckIntervalMs: 0});
    await sync.play();
    advance(1.05);
    expect(clip.seconds).toBeCloseTo(score.nominalSeconds, 9);
    expect(sync.clock.positionAt(clockNow())).toBeCloseTo(score.nominalSeconds, 9);
  });

  it('exposes the transport clock read-through (never a mirror when the score has one)', async () => {
    const {ctx, score, scoreClock, clip} = makeWorld();
    const sync = new ScoreAudioSync(score, clip, ctx, {driftCheckIntervalMs: 0});
    expect(sync.clock).toBe(scoreClock); // identity: reads go to the owner's clock
  });

  it('does not treat the pre-roll hold as drift', async () => {
    const {ctx, advance, score, clip, clipCalls} = makeWorld();
    const sync = new ScoreAudioSync(score, clip, ctx, {leadInSeconds: 0.5, driftCheckIntervalMs: 0});
    await sync.play();
    const seeksBefore = clipCalls.filter((c) => c.op === 'seek').length;
    advance(0.2); // still inside the pre-roll
    expect(sync.checkDrift()).toBe(0);
    expect(clipCalls.filter((c) => c.op === 'seek')).toHaveLength(seeksBefore);
  });

  it('joins exactly at the armed origin when the score clock is holding (scheduled start)', async () => {
    const {ctx, score, scoreClock, clip, clipCalls} = makeWorld();
    const sync = new ScoreAudioSync(score, clip, ctx, {leadInSeconds: 0.05, driftCheckIntervalMs: 0});
    // Arm a scheduled start half a second out, beyond the lead-in horizon.
    score.play = async () => {
      scoreClock.startAt(0.5, 2);
    };
    await sync.play();
    const playCall = clipCalls.find((c) => c.op === 'play');
    const seekCall = clipCalls.find((c) => c.op === 'seek');
    expect(playCall?.value).toBeCloseTo(0.5, 9); // the armed origin, taken as-is
    expect(seekCall?.value).toBeCloseTo(2, 9); // positionAt(origin) = armed position
  });

  it('proposes now + leadIn to the master and starts both on that shared origin', async () => {
    const {ctx, score, scoreClock, clip, clipCalls} = makeWorld();
    const sync = new ScoreAudioSync(score, clip, ctx, {leadInSeconds: 0.06, driftCheckIntervalMs: 0});
    let proposed: number | undefined;
    // A master that honors scheduled starts (ScorePlayer): arm at the proposal.
    score.play = async (when?: number) => {
      proposed = when;
      scoreClock.startAt(when ?? 0, 0);
    };
    await sync.play();
    expect(proposed).toBeCloseTo(0.06, 9); // now + leadIn, proposed by the sync
    const playCall = clipCalls.find((c) => c.op === 'play');
    const seekCall = clipCalls.find((c) => c.op === 'seek');
    expect(playCall?.value).toBeCloseTo(0.06, 9); // the clip joins at the very same instant
    expect(seekCall?.value).toBeCloseTo(0, 9); // positionAt(origin) = armed position
  });

  it('takes a still-future armed origin directly, even inside the lead-in horizon', async () => {
    const {ctx, score, scoreClock, clip, clipCalls} = makeWorld();
    const sync = new ScoreAudioSync(score, clip, ctx, {leadInSeconds: 0.05, driftCheckIntervalMs: 0});
    // The master armed nearer than a full lead-in (its own start work already
    // consumed headroom): the join must not slip past the shared origin.
    score.play = async () => {
      scoreClock.startAt(0.02, 1);
    };
    await sync.play();
    const playCall = clipCalls.find((c) => c.op === 'play');
    const seekCall = clipCalls.find((c) => c.op === 'seek');
    expect(playCall?.value).toBeCloseTo(0.02, 9); // the armed origin, not now + leadIn
    expect(seekCall?.value).toBeCloseTo(1, 9);
  });

  it('falls back to the lead-in join when the armed origin has already passed', async () => {
    const {ctx, advance, score, scoreClock, clip, clipCalls} = makeWorld();
    const sync = new ScoreAudioSync(score, clip, ctx, {leadInSeconds: 0.05, driftCheckIntervalMs: 0});
    advance(0.1);
    // The holding flag persists until the next start/pause even after the
    // origin passes; a position mid-flight must not produce a join in the past.
    score.play = async () => {
      scoreClock.startAt(0.05, 0);
    };
    await sync.play();
    const playCall = clipCalls.find((c) => c.op === 'play');
    const seekCall = clipCalls.find((c) => c.op === 'seek');
    expect(playCall?.value).toBeCloseTo(0.15, 9); // now + leadIn
    expect(seekCall?.value).toBeCloseTo(0.1, 9); // positionAt(when), live past the origin
  });

  it('reseeks the clip when drift exceeds the tolerance', async () => {
    const {ctx, advance, score, clip, clipCalls} = makeWorld();
    const sync = new ScoreAudioSync(score, clip, ctx, {
      leadInSeconds: 0.05,
      driftToleranceSeconds: 0.03,
      driftCheckIntervalMs: 0,
    });
    await sync.play();
    advance(1);
    clip.seek(clip.seconds + 0.2); // inject drift
    const drift = sync.checkDrift();
    expect(Math.abs(drift)).toBeGreaterThan(0.03);
    await vi.advanceTimersByTimeAsync(0); // let the re-join microtasks settle
    const ops = clipCalls.slice(-3).map((c) => c.op);
    expect(ops).toEqual(['pause', 'seek', 'play']);
    advance(0.05); // past the correction's lead-in
    expect(clip.seconds).toBeCloseTo(score.nominalSeconds, 9);
  });

  it('pause/seek/setRate drive both transports through the owner clock', async () => {
    const {ctx, clockNow, advance, score, clip, scoreCalls, clipCalls} = makeWorld();
    const sync = new ScoreAudioSync(score, clip, ctx, {leadInSeconds: 0.05, driftCheckIntervalMs: 0});
    await sync.play();
    advance(1.05);

    sync.setRate(2);
    await vi.advanceTimersByTimeAsync(0);
    advance(0.5); // includes the rejoin lead-in
    expect(clip.seconds).toBeCloseTo(score.nominalSeconds, 9);

    await sync.seek(0.25); // nominal in, nominal through — no rate conversion anywhere
    expect(scoreCalls).toContain('seekNominal:0.25');
    const rejoinSeek = clipCalls[clipCalls.length - 2];
    const rejoinPlay = clipCalls[clipCalls.length - 1];
    expect(rejoinSeek.op).toBe('seek');
    expect(rejoinSeek.value).toBeCloseTo(0.25 + 0.05 * 2, 9); // positionAt(when) at rate 2
    expect(rejoinPlay.op).toBe('play');
    expect(sync.clock.positionAt(clockNow())).toBeCloseTo(0.25, 9);
    advance(0.05);
    expect(clip.seconds).toBeCloseTo(score.nominalSeconds, 9);

    sync.pause();
    expect(scoreCalls).toContain('pause');
    expect(clipCalls.some((c) => c.op === 'pause')).toBe(true);
    const frozen = sync.clock.positionAt(clockNow());
    advance(3);
    expect(sync.clock.positionAt(clockNow())).toBe(frozen);
  });

  it('reads the clip position and running state from the clip clock when exposed', async () => {
    const {ctx, clockNow, advance, score, clip} = makeWorld();
    const clipClock = new TransportClock(clockNow);
    let pendingOffset = 0;
    const calls: string[] = [];
    // A follower like AudioClipPlayer with a buffer-engine clock: the
    // sampled `seconds` surface is deliberately wrong so the test proves
    // the drift monitor reads the clock instead.
    const clockedClip = {
      async play(when?: number) {
        calls.push('play');
        if (when !== undefined) clipClock.startAt(when, pendingOffset);
        else clipClock.start(clockNow(), pendingOffset);
      },
      pause() {
        calls.push('pause');
        clipClock.pause(clockNow());
      },
      stop() {
        calls.push('stop');
        clipClock.pause(clockNow());
        clipClock.seekTo(0, clockNow());
      },
      seek(seconds: number) {
        calls.push('seek');
        pendingOffset = seconds;
        clipClock.seekTo(seconds, clockNow());
      },
      get seconds() {
        return 1_000; // sampling surface lies; the clock is authoritative
      },
      clock: clipClock,
    };
    void clip;
    const sync = new ScoreAudioSync(score, clockedClip, ctx, {
      leadInSeconds: 0.05,
      driftCheckIntervalMs: 0,
    });
    await sync.play();
    advance(1.05);

    // Aligned by clock: no correction despite the absurd sampled seconds.
    expect(Math.abs(sync.checkDrift())).toBeLessThan(1e-9);
    const joinsAfterPlay = calls.filter((call) => call === 'play').length;
    await vi.advanceTimersByTimeAsync(0);
    expect(calls.filter((call) => call === 'play')).toHaveLength(joinsAfterPlay);

    // A clip whose clock reports paused (ended, torn down) is not corrected
    // into a re-join thrash: drift is reported but no join is queued.
    clipClock.pause(clockNow());
    advance(1);
    expect(Math.abs(sync.checkDrift())).toBeGreaterThan(0.5);
    await vi.advanceTimersByTimeAsync(0);
    expect(calls.filter((call) => call === 'play')).toHaveLength(joinsAfterPlay);
  });

  it('applies a clip offset for external backing tracks', async () => {
    const {ctx, score, clip, clipCalls} = makeWorld();
    const sync = new ScoreAudioSync(score, clip, ctx, {
      leadInSeconds: 0.1,
      clipOffsetSeconds: 1.5,
      driftCheckIntervalMs: 0,
    });
    await sync.play();
    const seekCall = clipCalls.find((c) => c.op === 'seek');
    expect(seekCall?.value).toBeCloseTo(1.6, 9); // 1.5 + positionAt(when)
  });

  it('matches the master rate on a drift re-join, not just the position', async () => {
    const {ctx, advance, score, scoreClock, clip} = makeWorld();
    const rates: number[] = [];
    const rateTrackingClip = {
      ...clip,
      setRate(rate: number) {
        rates.push(rate);
        clip.setRate(rate);
      },
      get playing() {
        return clip.playing;
      },
      get seconds() {
        return clip.seconds;
      },
    };
    const sync = new ScoreAudioSync(score, rateTrackingClip, ctx, {
      leadInSeconds: 0.05,
      driftCheckIntervalMs: 0,
    });
    await sync.play();
    advance(1);
    // The master is driven directly (as ScorePlayer.setRate can be), so the
    // sync never saw the change and the clip is left on the old slope.
    scoreClock.setRate(2, ctx.currentTime);
    advance(1);
    rates.length = 0;
    sync.checkDrift();
    await vi.advanceTimersByTimeAsync(0);
    // The correction re-anchors the slope, so the drift cannot grow straight
    // back — a seek-only correction would have pushed nothing here.
    expect(rates).toContain(2);
  });

  it('stops re-joining and reports when corrections never converge', async () => {
    const {ctx, advance, score, clip} = makeWorld();
    const failures: string[] = [];
    // A clip that ignores setRate entirely (the contract allows it) and runs
    // at a fixed slower rate: every correction is undone before the next check.
    const stubbornClip = {
      ...clip,
      setRate: undefined,
      get playing() {
        return clip.playing;
      },
      get seconds() {
        return clip.seconds * 0.5;
      },
    };
    const sync = new ScoreAudioSync(score, stubbornClip, ctx, {
      leadInSeconds: 0.05,
      driftCheckIntervalMs: 0,
      onOperationError: (operation) => failures.push(operation),
    });
    await sync.play();
    for (let i = 0; i < MAX_DRIFT_ATTEMPTS + 2; i++) {
      advance(1);
      sync.checkDrift();
      await vi.advanceTimersByTimeAsync(0);
    }
    // The unconvergeable mismatch surfaces once instead of stuttering forever.
    expect(failures.filter((operation) => operation === 'drift re-join')).toHaveLength(1);

    // An explicit command re-arms correction: the caller may have just fixed it.
    await sync.seek(0);
    advance(1);
    sync.checkDrift();
    await vi.advanceTimersByTimeAsync(0);
    expect(failures.filter((operation) => operation === 'drift re-join')).toHaveLength(1);
  });
});

describe('ScoreAudioSync (clockless transport fallback)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('anchors by sampling and stays aligned (v1 parity)', async () => {
    const {ctx, clockNow, advance, score, clip, clipCalls} = makeWorld({withClock: false});
    const sync = new ScoreAudioSync(score, clip, ctx, {leadInSeconds: 0.1, driftCheckIntervalMs: 0});
    await sync.play();
    const playCall = clipCalls.find((c) => c.op === 'play');
    expect(playCall?.value).toBeCloseTo(0.1, 9);
    advance(1.1);
    expect(clip.seconds).toBeCloseTo(score.nominalSeconds, 9);
    expect(sync.clock.positionAt(clockNow())).toBeCloseTo(score.nominalSeconds, 9);
  });

  it('re-anchors the mirror to the transport before measuring clip drift', async () => {
    const {ctx, advance, score, clip} = makeWorld({withClock: false});
    score.setRate = () => {}; // the transport refuses the shared rate
    const sync = new ScoreAudioSync(score, clip, ctx, {leadInSeconds: 0.05, driftCheckIntervalMs: 0});
    await sync.play();
    advance(1.05);
    sync.setRate(2);
    await vi.advanceTimersByTimeAsync(0);
    advance(1); // the transport advanced 1s at rate 1; the mirror reckoned 2s

    const drift = sync.checkDrift();

    // Blind dead reckoning read ~0 here; anchored to the transport, the
    // check sees the clip a full second ahead and corrects onto the truth.
    expect(drift).toBeGreaterThan(0.5);
    await vi.advanceTimersByTimeAsync(0);
    advance(0.05); // past the correction's lead-in
    expect(Math.abs(clip.seconds - score.nominalSeconds)).toBeLessThan(0.2);
  });

  it('mirrors a clockless transport stopping on its own instead of sailing past it', async () => {
    const {ctx, clockNow, advance, score, scoreClock, clip} = makeWorld({withClock: false});
    // TonePlayer contract: nominalSeconds clamps at the score duration.
    Object.defineProperty(score, 'nominalSeconds', {
      get: () => Math.min(2, scoreClock.positionAt(clockNow())),
    });
    const sync = new ScoreAudioSync(score, clip, ctx, {
      leadInSeconds: 0.05,
      driftCheckIntervalMs: 100,
      tick: {intervalMs: 25, createWorker: () => null},
    });
    await sync.play();
    // A clockless position must first prove that it can advance. Sample the
    // transport through the score before it pins at its natural 2s end.
    for (let step = 0; step < 8; step += 1) {
      advance(0.25);
      await vi.advanceTimersByTimeAsync(100);
    }
    advance(0.3);
    await vi.advanceTimersByTimeAsync(100); // pinned for longer than its observed step → stall

    expect(clip.playing).toBe(false); // the clip no longer runs alone past the end
    expect(sync.clock.paused).toBe(true);
    expect(vi.getTimerCount()).toBe(0); // settled: the monitor idles
  });

  it('wraps a loop on a clockless transport that finishes on its own', async () => {
    const {ctx, clockNow, advance, score, scoreClock, clip, scoreCalls} = makeWorld({withClock: false});
    Object.defineProperty(score, 'nominalSeconds', {
      get: () => Math.min(2, scoreClock.positionAt(clockNow())),
    });
    const sync = new ScoreAudioSync(score, clip, ctx, {
      leadInSeconds: 0.05,
      driftCheckIntervalMs: 100,
      loop: {startSeconds: 0, endSeconds: 5}, // end past the transport's own end
      tick: {intervalMs: 25, createWorker: () => null},
    });
    await sync.play();
    for (let step = 0; step < 8; step += 1) {
      advance(0.25);
      await vi.advanceTimersByTimeAsync(100);
    }
    advance(0.3);
    await vi.advanceTimersByTimeAsync(100); // observed movement, then a real stall → wrap

    expect(scoreCalls).toContain('seekNominal:0');
    expect(scoreCalls.filter((call) => call === 'play').length).toBeGreaterThanOrEqual(2);
    advance(0.06);
    expect(clip.playing).toBe(true);
    expect(clip.seconds).toBeCloseTo(score.nominalSeconds, 9);
  });

  it('seek and rate flow through the mirror clock', async () => {
    const {ctx, clockNow, advance, score, clip, scoreCalls} = makeWorld({withClock: false});
    const sync = new ScoreAudioSync(score, clip, ctx, {leadInSeconds: 0.05, driftCheckIntervalMs: 0});
    await sync.play();
    advance(1.05);
    sync.setRate(2);
    await sync.seek(0.25);
    expect(scoreCalls).toContain('seekNominal:0.25');
    expect(sync.clock.positionAt(clockNow())).toBeCloseTo(0.25, 9);
    advance(0.05);
    expect(clip.seconds).toBeCloseTo(score.nominalSeconds, 9);
  });
});

describe('ScoreAudioSync loop', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('wraps at the loop boundary through a scheduled re-join', async () => {
    const {ctx, clockNow, advance, score, clip, scoreCalls} = makeWorld();
    const sync = new ScoreAudioSync(score, clip, ctx, {
      leadInSeconds: 0.05,
      driftCheckIntervalMs: 0,
      loop: {startSeconds: 0.5, endSeconds: 1},
      tick: {intervalMs: 25, createWorker: () => null},
    });
    await sync.play();
    advance(1.1); // past the loop end
    await vi.advanceTimersByTimeAsync(30); // one tick fires the wrap
    expect(scoreCalls).toContain('seekNominal:0.5');
    expect(sync.clock.positionAt(clockNow())).toBeLessThan(1);
    advance(0.06);
    expect(clip.seconds).toBeCloseTo(score.nominalSeconds, 9);
  });

  it('wraps onto a shared re-entry origin when the master honors scheduled seeks', async () => {
    const {ctx, clockNow, advance, score, scoreClock, clip, clipCalls} = makeWorld();
    const sync = new ScoreAudioSync(score, clip, ctx, {
      leadInSeconds: 0.05,
      driftCheckIntervalMs: 0,
      loop: {startSeconds: 0.5, endSeconds: 1},
      tick: {intervalMs: 25, createWorker: () => null},
    });
    // A master that arms the re-entry rather than resuming at once — what
    // ScorePlayer.seekNominal(target, when) does with the proposal.
    score.seekNominal = (nominalSeconds: number, when?: number) => {
      if (when === undefined) scoreClock.seekTo(nominalSeconds, clockNow());
      else scoreClock.startAt(when, nominalSeconds);
    };
    await sync.play();
    advance(1.1); // past the loop end
    await vi.advanceTimersByTimeAsync(30); // one tick fires the wrap

    // Both sides leave the boundary on ONE instant: the master is armed and
    // the clip is scheduled at exactly that origin, from the loop start.
    expect(scoreClock.holding).toBe(true);
    const origin = scoreClock.state.originTime;
    expect(origin).toBeGreaterThan(clockNow());
    const rejoin = clipCalls.filter((c) => c.op === 'play').at(-1);
    expect(rejoin?.value).toBeCloseTo(origin, 9);
    const reseek = clipCalls.filter((c) => c.op === 'seek').at(-1);
    expect(reseek?.value).toBeCloseTo(0.5, 9);
  });

  it('wraps a whole-piece loop even when the score transport finishes first', async () => {
    const {ctx, clockNow, advance, score, scoreClock, clip, scoreCalls} = makeWorld();
    const sync = new ScoreAudioSync(score, clip, ctx, {
      leadInSeconds: 0.05,
      driftCheckIntervalMs: 0,
      loop: {startSeconds: 0, endSeconds: 2},
      tick: {intervalMs: 25, createWorker: () => null},
    });
    await sync.play();
    advance(2.001);
    // The scheduler's own tick wins the race: the natural finish pauses the
    // transport clock and rewinds it before the sync's watcher ever sees
    // the boundary crossing.
    scoreClock.pause(clockNow());
    scoreClock.seekTo(0, clockNow());

    await vi.advanceTimersByTimeAsync(30); // one sync tick reconciles + wraps

    expect(scoreCalls).toContain('seekNominal:0');
    expect(scoreCalls.filter((call) => call === 'play')).toHaveLength(2);
    expect(scoreClock.paused).toBe(false);
    advance(0.06); // past the re-join lead-in
    expect(clip.playing).toBe(true);
    expect(clip.seconds).toBeCloseTo(score.nominalSeconds, 9);
  });

  it('wraps a loop whose end lies past the score duration instead of stalling', async () => {
    const {ctx, clockNow, advance, score, scoreClock, clip, scoreCalls} = makeWorld();
    const sync = new ScoreAudioSync(score, clip, ctx, {
      leadInSeconds: 0.05,
      driftCheckIntervalMs: 0,
      loop: {startSeconds: 0.5, endSeconds: 5},
      tick: {intervalMs: 25, createWorker: () => null},
    });
    await sync.play();
    advance(2); // the score self-finishes at its duration, before the loop end
    scoreClock.pause(clockNow());
    scoreClock.seekTo(0, clockNow());

    await vi.advanceTimersByTimeAsync(30);

    expect(scoreCalls).toContain('seekNominal:0.5');
    expect(scoreClock.paused).toBe(false);
    advance(0.06);
    expect(clip.playing).toBe(true);
    expect(clip.seconds).toBeCloseTo(score.nominalSeconds, 9);
  });

  it('rejects an empty loop region and clears via null', () => {
    const {ctx, score, clip} = makeWorld();
    const sync = new ScoreAudioSync(score, clip, ctx, {tick: {createWorker: () => null}});
    expect(() => sync.setLoop({startSeconds: 1, endSeconds: 1})).toThrow(RangeError);
    sync.setLoop({startSeconds: 0, endSeconds: 2});
    expect(sync.loop).toEqual({startSeconds: 0, endSeconds: 2});
    sync.setLoop(null);
    expect(sync.loop).toBeNull();
  });

  it('snapshots loop input and output so callers cannot mutate live bounds', () => {
    const {ctx, score, clip} = makeWorld();
    const input = {startSeconds: 0, endSeconds: 2};
    const sync = new ScoreAudioSync(score, clip, ctx, {loop: input});

    input.endSeconds = 4;
    expect(sync.loop).toEqual({startSeconds: 0, endSeconds: 2});
    const output = sync.loop!;
    output.endSeconds = 8;
    expect(sync.loop).toEqual({startSeconds: 0, endSeconds: 2});
    sync.dispose();
  });
});

describe('ScoreAudioSync lifecycle hardening', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('starts an idle play command synchronously inside the caller activation stack', () => {
    const {ctx, score, clip} = makeWorld();
    const play = vi.spyOn(score, 'play');
    const sync = new ScoreAudioSync(score, clip, ctx, {driftCheckIntervalMs: 0});

    const pendingPlay = sync.play();

    expect(play).toHaveBeenCalledOnce();
    return pendingPlay;
  });

  it('watches natural completion while playing with drift checks off, and idles after pause or stop', async () => {
    const {ctx, score, clip} = makeWorld();
    const createWorker = vi.fn(() => null);
    const sync = new ScoreAudioSync(score, clip, ctx, {
      driftCheckIntervalMs: 0,
      tick: {intervalMs: 25, createWorker},
    });

    expect(createWorker).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    await sync.play();
    expect(createWorker).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(1);

    sync.setLoop({startSeconds: 0, endSeconds: 1});
    expect(vi.getTimerCount()).toBe(1);
    sync.setLoop(null);
    expect(vi.getTimerCount()).toBe(1);
    sync.pause();
    expect(vi.getTimerCount()).toBe(0);
    await sync.play();
    expect(vi.getTimerCount()).toBe(1);
    sync.stop();
    expect(vi.getTimerCount()).toBe(0);
    sync.dispose();
  });

  it('settles into pause and stops the monitor when the score finishes on its own', async () => {
    const {ctx, clockNow, advance, score, scoreClock, clip} = makeWorld();
    const sync = new ScoreAudioSync(score, clip, ctx, {
      leadInSeconds: 0.05,
      driftCheckIntervalMs: 250,
      tick: {intervalMs: 25, createWorker: () => null},
    });
    await sync.play();
    advance(3);
    // ScorePlayer's scheduler finish: pause the clock and rewind it.
    scoreClock.pause(clockNow());
    scoreClock.seekTo(0, clockNow());

    await vi.advanceTimersByTimeAsync(30);

    expect(clip.playing).toBe(false); // the clip does not keep running alone
    expect(vi.getTimerCount()).toBe(0); // the watcher idles instead of ticking forever

    await sync.play(); // a later play() recovers cleanly from the settled state
    expect(scoreClock.paused).toBe(false);
    expect(vi.getTimerCount()).toBe(1);
    sync.dispose();
  });

  it('keeps pause authoritative when an older async play settles later', async () => {
    const {ctx, clockNow, score, scoreClock, clip, clipCalls} = makeWorld();
    let resolvePlay!: () => void;
    score.play = () => new Promise<void>((resolve) => {
      resolvePlay = () => {
        scoreClock.start(clockNow());
        resolve();
      };
    });
    const sync = new ScoreAudioSync(score, clip, ctx, {driftCheckIntervalMs: 0});

    const pendingPlay = sync.play();
    await Promise.resolve();
    sync.pause();
    resolvePlay();
    await pendingPlay;

    expect(scoreClock.paused).toBe(true);
    expect(clipCalls.some(({op}) => op === 'play')).toBe(false);
  });

  it('applies a rate change without cancelling a pending play', async () => {
    const {ctx, clockNow, score, scoreClock, clip, clipCalls} = makeWorld();
    let resolvePlay!: () => void;
    score.play = () => new Promise<void>((resolve) => {
      resolvePlay = () => {
        scoreClock.start(clockNow());
        resolve();
      };
    });
    const sync = new ScoreAudioSync(score, clip, ctx, {driftCheckIntervalMs: 0});

    const pendingPlay = sync.play();
    await Promise.resolve();
    sync.setRate(2);
    resolvePlay();
    await pendingPlay;

    expect(scoreClock.rate).toBe(2);
    expect(clipCalls.some(({op}) => op === 'play')).toBe(true);
  });

  it('serializes a seek behind a pending play and leaves both transports running together', async () => {
    const {ctx, clockNow, score, scoreClock, clip} = makeWorld();
    let resolvePlay!: () => void;
    score.play = () => new Promise<void>((resolve) => {
      resolvePlay = () => {
        scoreClock.start(clockNow());
        resolve();
      };
    });
    const sync = new ScoreAudioSync(score, clip, ctx, {
      leadInSeconds: 0,
      driftCheckIntervalMs: 0,
    });

    const pendingPlay = sync.play();
    await Promise.resolve();
    const pendingSeek = sync.seek(0.5);
    resolvePlay();
    await Promise.all([pendingPlay, pendingSeek]);

    expect(scoreClock.paused).toBe(false);
    expect(clip.playing).toBe(true);
    expect(score.nominalSeconds).toBeCloseTo(0.5, 9);
    expect(clip.seconds).toBeCloseTo(0.5, 9);
  });

  it('executes overlapping seeks in call order even when the first settles slowly', async () => {
    const {ctx, clockNow, score, scoreClock, clip} = makeWorld();
    let finishFirst!: () => void;
    let finishSecond!: () => void;
    score.seekNominal = (seconds) => new Promise<void>((resolve) => {
      const finish = () => {
        scoreClock.seekTo(seconds, clockNow());
        resolve();
      };
      if (seconds === 1) finishFirst = finish;
      else finishSecond = finish;
    });
    const sync = new ScoreAudioSync(score, clip, ctx, {driftCheckIntervalMs: 0});

    const first = sync.seek(1);
    const second = sync.seek(2);
    await Promise.resolve();
    expect(finishFirst).toBeTypeOf('function');
    expect(finishSecond).toBeUndefined();
    finishFirst();
    await first;
    await Promise.resolve();
    expect(finishSecond).toBeTypeOf('function');
    finishSecond();
    await second;

    expect(score.nominalSeconds).toBe(2);
    expect(clip.seconds).toBe(2);
  });

  it('re-applies stop after a pending seek settles with a stale position', async () => {
    const {ctx, clockNow, score, scoreClock, clip} = makeWorld();
    const sync = new ScoreAudioSync(score, clip, ctx, {
      leadInSeconds: 0,
      driftCheckIntervalMs: 0,
    });
    await sync.play();
    let finishSeek!: () => void;
    score.seekNominal = (seconds) => new Promise<void>((resolve) => {
      finishSeek = () => {
        scoreClock.seekTo(seconds, clockNow());
        resolve();
      };
    });

    const pendingSeek = sync.seek(3);
    await Promise.resolve();
    sync.stop();
    finishSeek();
    await pendingSeek;

    expect(scoreClock.paused).toBe(true);
    expect(score.nominalSeconds).toBe(0);
    expect(clip.playing).toBe(false);
    expect(clip.seconds).toBe(0);
  });

  it('replays stop before a later play when an older seek settles late', async () => {
    const {ctx, clockNow, score, scoreClock, clip} = makeWorld();
    const sync = new ScoreAudioSync(score, clip, ctx, {
      leadInSeconds: 0,
      driftCheckIntervalMs: 0,
    });
    await sync.play();
    let finishSeek!: () => void;
    score.seekNominal = (seconds) => new Promise<void>((resolve) => {
      finishSeek = () => {
        scoreClock.seekTo(seconds, clockNow());
        resolve();
      };
    });

    const pendingSeek = sync.seek(3);
    sync.stop();
    const pendingPlay = sync.play();
    finishSeek();
    await Promise.all([pendingSeek, pendingPlay]);

    expect(scoreClock.paused).toBe(false);
    expect(score.nominalSeconds).toBe(0);
    expect(clip.playing).toBe(true);
    expect(clip.seconds).toBe(0);
  });

  it('keeps stop position authoritative when pause follows a pending seek', async () => {
    const {ctx, clockNow, score, scoreClock, clip} = makeWorld();
    const sync = new ScoreAudioSync(score, clip, ctx, {
      leadInSeconds: 0,
      driftCheckIntervalMs: 0,
    });
    await sync.play();
    let finishSeek!: () => void;
    score.seekNominal = (seconds) => new Promise<void>((resolve) => {
      finishSeek = () => {
        scoreClock.seekTo(seconds, clockNow());
        resolve();
      };
    });

    const pendingSeek = sync.seek(3);
    sync.stop();
    sync.pause();
    finishSeek();
    await pendingSeek;
    await vi.advanceTimersByTimeAsync(0);

    expect(scoreClock.paused).toBe(true);
    expect(score.nominalSeconds).toBe(0);
    expect(clip.playing).toBe(false);
    expect(clip.seconds).toBe(0);
  });

  it('preserves a completed seek position when pause supersedes the pending seek', async () => {
    const {ctx, clockNow, score, scoreClock, clip} = makeWorld();
    const sync = new ScoreAudioSync(score, clip, ctx, {
      leadInSeconds: 0,
      driftCheckIntervalMs: 0,
    });
    await sync.play();
    let finishSeek!: () => void;
    score.seekNominal = (seconds) => new Promise<void>((resolve) => {
      finishSeek = () => {
        scoreClock.seekTo(seconds, clockNow());
        resolve();
      };
    });

    const pendingSeek = sync.seek(3);
    sync.pause();
    finishSeek();
    await pendingSeek;

    expect(scoreClock.paused).toBe(true);
    expect(score.nominalSeconds).toBe(3);
    expect(clip.playing).toBe(false);
    expect(clip.seconds).toBe(3);
  });

  it('keeps pause authoritative over a pending rate-change re-join', async () => {
    const {ctx, score, scoreClock, clip} = makeWorld();
    const sync = new ScoreAudioSync(score, clip, ctx, {
      leadInSeconds: 0,
      driftCheckIntervalMs: 0,
    });
    await sync.play();
    const startClip = clip.play.bind(clip);
    let finishClipPlay!: () => void;
    clip.play = (when) => new Promise<void>((resolve) => {
      finishClipPlay = () => {
        void startClip(when);
        resolve();
      };
    });

    sync.setRate(2);
    sync.pause();
    finishClipPlay();
    await vi.advanceTimersByTimeAsync(0);

    expect(scoreClock.paused).toBe(true);
    expect(clip.playing).toBe(false);
  });

  it('re-joins at the latest clock anchor after rapid rate changes', async () => {
    const {ctx, advance, score, clip} = makeWorld();
    const sync = new ScoreAudioSync(score, clip, ctx, {
      leadInSeconds: 0,
      driftCheckIntervalMs: 0,
    });
    await sync.play();
    const startClip = clip.play.bind(clip);
    let finishFirstJoin!: () => void;
    let joinCalls = 0;
    clip.play = (when) => {
      joinCalls += 1;
      if (joinCalls > 1) return startClip(when);
      return new Promise<void>((resolve) => {
        finishFirstJoin = () => {
          void startClip(when);
          resolve();
        };
      });
    };

    sync.setRate(2);
    advance(0.1);
    sync.setRate(3);
    finishFirstJoin();
    await vi.advanceTimersByTimeAsync(0);

    expect(score.nominalSeconds).toBeCloseTo(0.2, 9);
    expect(clip.seconds).toBeCloseTo(score.nominalSeconds, 9);
    expect(joinCalls).toBe(2);
  });

  it('pauses both transports when an independent re-join cannot restart the clip', async () => {
    const {ctx, score, scoreClock, clip} = makeWorld();
    const sync = new ScoreAudioSync(score, clip, ctx, {
      leadInSeconds: 0,
      driftCheckIntervalMs: 0,
    });
    await sync.play();
    clip.play = async () => {
      throw new Error('re-join failed');
    };

    sync.setRate(2);
    await vi.advanceTimersByTimeAsync(0);

    expect(scoreClock.paused).toBe(true);
    expect(clip.playing).toBe(false);
  });

  it('reports an independent re-join failure through onOperationError', async () => {
    const {ctx, score, clip} = makeWorld();
    const failures: Array<{operation: string; error: unknown}> = [];
    const sync = new ScoreAudioSync(score, clip, ctx, {
      leadInSeconds: 0,
      driftCheckIntervalMs: 0,
      onOperationError: (operation, error) => {
        failures.push({operation, error});
      },
    });
    await sync.play();
    clip.play = async () => {
      throw new Error('re-join failed');
    };

    sync.setRate(2);
    await vi.advanceTimersByTimeAsync(0);

    expect(failures).toHaveLength(1);
    expect(failures[0].operation).toBe('rate re-join');
    expect((failures[0].error as Error).message).toBe('re-join failed');
  });

  it('swallows observer exceptions and still settles the re-join rollback', async () => {
    const {ctx, score, scoreClock, clip} = makeWorld();
    const sync = new ScoreAudioSync(score, clip, ctx, {
      leadInSeconds: 0,
      driftCheckIntervalMs: 0,
      onOperationError: () => {
        throw new Error('observer exploded');
      },
    });
    await sync.play();
    clip.play = async () => {
      throw new Error('re-join failed');
    };

    sync.setRate(2);
    await vi.advanceTimersByTimeAsync(0);

    expect(scoreClock.paused).toBe(true);
    expect(clip.playing).toBe(false);
  });

  it('aligns a paused clip to the score transport actual clamped seek position', async () => {
    const {ctx, clockNow, score, scoreClock, clip} = makeWorld();
    score.seekNominal = (seconds) => {
      scoreClock.seekTo(Math.min(seconds, 1), clockNow());
    };
    const sync = new ScoreAudioSync(score, clip, ctx, {driftCheckIntervalMs: 0});

    await sync.seek(5);

    expect(score.nominalSeconds).toBe(1);
    expect(clip.seconds).toBe(1);
  });

  it('treats a transport left paused after a mid-playback seek as a failed resume', async () => {
    const {ctx, clockNow, advance, score, scoreClock, clip} = makeWorld();
    const failures: string[] = [];
    const sync = new ScoreAudioSync(score, clip, ctx, {
      leadInSeconds: 0.05,
      driftCheckIntervalMs: 0,
      onOperationError: (operation) => {
        failures.push(operation);
      },
    });
    await sync.play();
    advance(1);
    // Model ScorePlayer's real contract: seekNominal re-anchors, the restart
    // fails, the error is swallowed — the promise resolves with the clock
    // left paused.
    score.seekNominal = async (nominalSeconds: number) => {
      scoreClock.pause(clockNow());
      scoreClock.seekTo(nominalSeconds, clockNow());
    };

    await sync.seek(0.5);

    expect(clip.playing).toBe(false);
    expect(clip.seconds).toBeCloseTo(0.5, 9);
    expect(failures).toEqual(['resume after seek']);
    advance(1); // the clip must not keep running alone
    expect(clip.seconds).toBeCloseTo(0.5, 9);

    // A later play() recovers cleanly from the settled paused state.
    await sync.play();
    advance(0.1);
    expect(clip.playing).toBe(true);
    expect(clip.seconds).toBeCloseTo(score.nominalSeconds, 9);
  });

  it('rolls back the score transport when the clip cannot start', async () => {
    const {ctx, score, scoreClock, clip} = makeWorld();
    clip.play = async () => {
      throw new Error('clip start failed');
    };
    const sync = new ScoreAudioSync(score, clip, ctx, {driftCheckIntervalMs: 0});

    await expect(sync.play()).rejects.toThrow('clip start failed');
    expect(scoreClock.paused).toBe(true);
    expect(clip.playing).toBe(false);
  });

  it('still applies a queued seek after an earlier play fails', async () => {
    const {ctx, score, clip} = makeWorld();
    clip.play = async () => {
      throw new Error('clip start failed');
    };
    const sync = new ScoreAudioSync(score, clip, ctx, {
      leadInSeconds: 0,
      driftCheckIntervalMs: 0,
    });

    const settled = await Promise.allSettled([sync.play(), sync.seek(0.5)]);

    expect(settled.map(({status}) => status)).toEqual(['rejected', 'fulfilled']);
    expect(score.nominalSeconds).toBeCloseTo(0.5, 9);
    expect(clip.seconds).toBeCloseTo(0.5, 9);
    expect(clip.playing).toBe(false);
  });

  it('does not duplicate pause or stop commands when no transition is pending', async () => {
    const paused = makeWorld();
    const pauseSync = new ScoreAudioSync(paused.score, paused.clip, paused.ctx, {driftCheckIntervalMs: 0});
    pauseSync.pause();
    await Promise.resolve();
    expect(paused.scoreCalls.filter((call) => call === 'pause')).toHaveLength(1);
    expect(paused.clipCalls.filter(({op}) => op === 'pause')).toHaveLength(1);

    const stopped = makeWorld();
    const stopSync = new ScoreAudioSync(stopped.score, stopped.clip, stopped.ctx, {driftCheckIntervalMs: 0});
    stopSync.stop();
    await Promise.resolve();
    expect(stopped.scoreCalls.filter((call) => call === 'stop')).toHaveLength(1);
    expect(stopped.clipCalls.filter(({op}) => op === 'stop')).toHaveLength(1);
  });

  it('does not let a drift check supersede a pending seek', async () => {
    const {ctx, score, scoreClock, clip, clipCalls} = makeWorld();
    const sync = new ScoreAudioSync(score, clip, ctx, {
      leadInSeconds: 0,
      driftCheckIntervalMs: 0,
    });
    await sync.play();
    clip.seek(clip.seconds + 1); // make a drift correction tempting

    let finishSeek!: () => void;
    score.seekNominal = (seconds) => new Promise<void>((resolve) => {
      finishSeek = () => {
        scoreClock.seekTo(seconds, (ctx as unknown as {currentTime: number}).currentTime);
        resolve();
      };
    });
    const pendingSeek = sync.seek(0.25);
    await Promise.resolve();
    const callsBeforeCheck = clipCalls.length;

    expect(sync.checkDrift()).toBe(0);
    expect(clipCalls).toHaveLength(callsBeforeCheck);
    finishSeek();
    await pendingSeek;

    expect(clipCalls.at(-2)?.op).toBe('seek');
    expect(clipCalls.at(-2)?.value).toBeCloseTo(0.25, 9);
    expect(clipCalls.at(-1)?.op).toBe('play');
  });

  it('validates timing options and public positions before touching transports', async () => {
    const {ctx, score, clip, scoreCalls} = makeWorld();
    expect(() => new ScoreAudioSync(score, clip, ctx, {leadInSeconds: -1})).toThrow(RangeError);
    expect(() => new ScoreAudioSync(score, clip, ctx, {clipOffsetSeconds: -1})).toThrow(RangeError);
    expect(() => new ScoreAudioSync(score, clip, ctx, {driftCheckIntervalMs: Infinity})).toThrow(RangeError);
    expect(() => new ScoreAudioSync(score, clip, ctx, {tick: {intervalMs: 0.5}})).toThrow(RangeError);
    expect(() => new ScoreAudioSync(score, clip, ctx, {tick: {intervalMs: 2_147_483_648}})).toThrow(RangeError);

    const sync = new ScoreAudioSync(score, clip, ctx, {driftCheckIntervalMs: 0});
    await expect(sync.seek(Number.NaN)).rejects.toThrow(RangeError);
    expect(scoreCalls.some((call) => call.startsWith('seekNominal:'))).toBe(false);
    expect(() => sync.setRate(0)).toThrow(RangeError);
    expect(() => sync.setRate(0.249)).toThrow(/between 0.25 and 4/);
    expect(() => sync.setRate(4.001)).toThrow(/between 0.25 and 4/);
    expect(() => sync.setRate(0.25)).not.toThrow();
    expect(() => sync.setRate(4)).not.toThrow();
    expect(() => sync.setLoop({startSeconds: 0, endSeconds: Infinity})).toThrow(RangeError);
  });

  it('attempts every owned transport cleanup even when one disposer throws', () => {
    const {ctx, score, clip} = makeWorld();
    const clipDispose = vi.fn(() => {
      throw new Error('clip cleanup failed');
    });
    const scoreDispose = vi.fn();
    Object.assign(clip, {dispose: clipDispose});
    Object.assign(score, {dispose: scoreDispose});
    const sync = new ScoreAudioSync(score, clip, ctx, {driftCheckIntervalMs: 0});

    expect(() => sync.dispose()).toThrow('clip cleanup failed');
    expect(clipDispose).toHaveBeenCalledOnce();
    expect(scoreDispose).toHaveBeenCalledOnce();
    expect(() => sync.dispose()).not.toThrow();
  });
});

describe('createSyncedPlayback validation', () => {
  // Validation runs before any player construction, so the score is unused
  // on the throwing paths.
  const dummyScore = {} as unknown as Score;

  it('rejects a streaming clip at construction instead of failing deep inside play()', () => {
    const streaming = createAudioClip({
      sampleRate: 44100,
      sourceUrl: 'https://example.com/backing.mp3',
      length: 44100,
      numberOfChannels: 2,
    });
    expect(() => createSyncedPlayback(dummyScore, streaming)).toThrow(/decoded samples/);
  });

  it('rejects a conflicting engine override instead of silently discarding it', () => {
    const clip = createAudioClip({sampleRate: 44100, channelData: [new Float32Array(8)]});
    expect(() =>
      createSyncedPlayback(dummyScore, clip, {clipOptions: {engine: 'media'} as never}),
    ).toThrow(/buffer engine/);
    expect(() =>
      createSyncedPlayback(dummyScore, clip, {clipOptions: {mediaAdapterFactory: () => null} as never}),
    ).toThrow(/buffer engine/);
  });

  it('rejects clip-side loop and rate, which the sync itself owns', () => {
    const clip = createAudioClip({sampleRate: 44100, channelData: [new Float32Array(8)]});
    // A clip-side loop would advance the clip clock unwrapped past its loop
    // end, silently invalidating the drift monitor's clip read-through.
    expect(() =>
      createSyncedPlayback(dummyScore, clip, {clipOptions: {loop: true} as never}),
    ).toThrow(/setLoop/);
    expect(() =>
      createSyncedPlayback(dummyScore, clip, {clipOptions: {loop: {start: 0, end: 1}} as never}),
    ).toThrow(/setLoop/);
    // A construction-time rate seeds a slope mismatch that drift correction,
    // which only re-anchors position, can never resolve.
    expect(() =>
      createSyncedPlayback(dummyScore, clip, {clipOptions: {rate: 2} as never}),
    ).toThrow(/setRate/);
  });
});

describe('ScoreAudioSync (rate reconciliation)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('matches the follower to the leader slope when the leader is re-tuned behind the sync', async () => {
    const {ctx, advance, score, clip} = makeWorld();
    const rates: number[] = [];
    const applyRate = clip.setRate.bind(clip);
    clip.setRate = (rate: number) => {
      rates.push(rate);
      applyRate(rate);
    };
    const sync = new ScoreAudioSync(score, clip, ctx, {leadInSeconds: 0.05, driftCheckIntervalMs: 0});

    await sync.play();
    advance(0.05); // the clip has joined
    score.setRate(2); // ScorePlayer.setTempo() straight on the player the factory returned
    advance(0.5); // the leader advanced 1.0 nominal second, the follower only 0.5

    expect(sync.checkDrift()).toBeLessThan(-0.03);
    await vi.advanceTimersByTimeAsync(0);
    expect(rates.at(-1)).toBe(2);

    advance(0.05); // past the correction's lead-in
    advance(1);
    // Position AND slope corrected, so the two axes stay together instead of
    // re-diverging into another re-join on the next check.
    expect(clip.seconds).toBeCloseTo(score.nominalSeconds, 6);
    expect(Math.abs(sync.checkDrift())).toBeLessThan(0.03);
  });

  it('re-joins on a rate mismatch even while the positions still agree', async () => {
    const {ctx, clockNow, advance, score} = makeWorld();
    const clipClock = new TransportClock(clockNow);
    const calls: string[] = [];
    const clip = {
      play(when?: number) {
        clipClock.startAt(when ?? clockNow(), clipClock.positionAt(clockNow()));
      },
      pause() {
        clipClock.pause(clockNow());
      },
      stop() {
        clipClock.pause(clockNow());
        clipClock.seekTo(0, clockNow());
      },
      seek(seconds: number) {
        clipClock.seekTo(seconds, clockNow());
      },
      setRate(rate: number) {
        calls.push(`setRate:${rate}`);
        clipClock.setRate(rate, clockNow());
      },
      get seconds() {
        return clipClock.positionAt(clockNow());
      },
      get clock() {
        return clipClock;
      },
    };
    const sync = new ScoreAudioSync(score, clip, ctx, {leadInSeconds: 0.05, driftCheckIntervalMs: 0});

    await sync.play();
    advance(0.05);
    // Only the slope diverges: setRate preserves the position, so a
    // position-only monitor sees a perfectly aligned follower.
    clipClock.setRate(2, clockNow());

    expect(sync.checkDrift()).toBe(0);
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toContain('setRate:1');
    expect(clipClock.rate).toBe(1);
  });

  it('learns a clockless transport real slope instead of re-joining forever', async () => {
    const {ctx, advance, score, clip} = makeWorld({withClock: false});
    score.setRate = () => {}; // the transport refuses the shared rate and stays at 1
    const rates: number[] = [];
    const applyRate = clip.setRate.bind(clip);
    clip.setRate = (rate: number) => {
      rates.push(rate);
      applyRate(rate);
    };
    const sync = new ScoreAudioSync(score, clip, ctx, {leadInSeconds: 0.05, driftCheckIntervalMs: 0});

    await sync.play();
    advance(0.05);
    sync.setRate(2); // the mirror and the follower go to 2; the transport ignores it
    await vi.advanceTimersByTimeAsync(0);
    advance(0.05); // past the rate re-join's lead-in

    sync.checkDrift(); // first sample: no slope to derive yet
    await vi.advanceTimersByTimeAsync(0);
    advance(0.25);
    sync.checkDrift(); // two samples: the mirror learns the transport's real slope
    await vi.advanceTimersByTimeAsync(0);

    expect(sync.clock.rate).toBeCloseTo(1, 2);
    expect(rates.at(-1)).toBeCloseTo(1, 2);
  });
});

describe('ScoreAudioSync revisioned command delegation', () => {
  it('uses the nominal master axis at non-unit rate and exposes initial/settled snapshots', async () => {
    const {ctx, score, clip} = makeWorld();
    const sync = new ScoreAudioSync(score, clip, ctx, {clipOffsetSeconds: 2, driftCheckIntervalMs: 0});
    const events: string[] = [];
    const detach = sync.subscribe((event) => events.push(event.type));
    expect(events).toEqual(['snapshot']);
    await sync.dispatch({type: 'rate', rate: 2});
    const result = await sync.dispatch({type: 'seek', position: 10});
    expect(result).toMatchObject({status: 'committed', snapshot: {position: 10, rate: 2, pending: false}});
    expect(clip.seconds).toBe(12);
    expect(events).toContain('invalidate');
    expect(events).toContain('commit');
    detach();
    sync.dispose();
  });

  it('validates the shared rate range before touching participants or revision', () => {
    const {ctx, score, clip} = makeWorld();
    const sync = new ScoreAudioSync(score, clip, ctx, {driftCheckIntervalMs: 0});
    expect(() => sync.dispatch({type: 'rate', rate: 5})).toThrow(/between 0.25 and 4/);
    expect(sync.snapshot.revision).toBe(0);
    sync.dispose();
  });

  it('rejects a master rate refusal through the strict surface and publishes the failure', async () => {
    const {ctx, score, clip} = makeWorld();
    score.setRate = () => {};
    const sync = new ScoreAudioSync(score, clip, ctx, {driftCheckIntervalMs: 0});
    const failures: unknown[] = [];
    sync.subscribe((event) => { if (event.type === 'error') failures.push(event.error); });
    await expect(sync.dispatch({type: 'rate', rate: 2})).rejects.toThrow('did not accept');
    expect(failures).toHaveLength(1);
    expect(sync.snapshot.paused).toBe(true);
    sync.dispose();
  });
});
