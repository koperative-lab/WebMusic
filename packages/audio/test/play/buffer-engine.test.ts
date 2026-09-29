import {describe, expect, it} from 'vitest';
import {createAudioClip} from '../../src/core';
import type {TransportClockReader} from '@webmusic/kernel/transport';
import {BufferEngine} from '../../src/play/headless/engines/buffer-engine';

/** Fake BaseAudioContext with a controllable clock recording source.start calls. */
function fakeContext() {
  const started: Array<{when: number; offset: number}> = [];
  const stopped: number[] = [];
  const sources: any[] = [];
  const node = () => ({
    connect: () => {},
    disconnect: () => {},
    gain: {value: 1},
  });
  const ctx: any = {
    currentTime: 0,
    createGain: node,
    createBuffer: (channels: number, length: number, sampleRate: number) => ({
      numberOfChannels: channels,
      length,
      sampleRate,
      duration: length / sampleRate,
      getChannelData: () => new Float32Array(length),
    }),
    createBufferSource: () => {
      const source: any = {
        buffer: null,
        playbackRate: {value: 1},
        loop: false,
        loopStart: 0,
        loopEnd: 0,
        onended: null,
        disconnected: 0,
        connect: () => {},
        disconnect() {
          source.disconnected++;
        },
        start: (when: number, offset: number) => started.push({when, offset}),
        stop: () => stopped.push(ctx.currentTime),
      };
      sources.push(source);
      return source;
    },
  };
  return {ctx: ctx as BaseAudioContext, started, stopped, sources};
}

function makeClip(seconds = 2, sampleRate = 1000) {
  return createAudioClip({
    channelData: [new Float32Array(seconds * sampleRate)],
    sampleRate,
  });
}

// CONTRACTUAL — @webmusic/bridge depends on this behavior: ScoreAudioSync's
// sample-accurate join schedules `play(when)` and assumes the position
// parks at the seek offset through the pre-roll (its drift monitor holds
// off until `when`). Behavioral changes here require a matching bridge
// change (bridges/score-audio/src/sync.ts).
describe('BufferEngine scheduled start', () => {
  it('starts immediately when `when` is omitted or already past', () => {
    const {ctx, started} = fakeContext();
    (ctx as any).currentTime = 1.5;
    const engine = new BufferEngine(ctx, makeClip());
    void engine.play(0.25);
    expect(started).toEqual([{when: 1.5, offset: 0.25}]);
    expect(engine.currentTime).toBeCloseTo(0.25, 9);

    const past = fakeContext();
    (past.ctx as any).currentTime = 2;
    const engine2 = new BufferEngine(past.ctx, makeClip());
    void engine2.play(0, 1); // `when` in the past clamps to now
    expect(past.started).toEqual([{when: 2, offset: 0}]);
  });

  it('schedules a future start and holds currentTime at the offset through the pre-roll', () => {
    const {ctx, started} = fakeContext();
    (ctx as any).currentTime = 1;
    const engine = new BufferEngine(ctx, makeClip());
    void engine.play(0.5, 3);
    expect(started).toEqual([{when: 3, offset: 0.5}]);
    // Pre-roll: the clock has not reached `when`; position must hold.
    (ctx as any).currentTime = 2;
    expect(engine.currentTime).toBeCloseTo(0.5, 9);
    // After `when`, position advances from the offset.
    (ctx as any).currentTime = 3.25;
    expect(engine.currentTime).toBeCloseTo(0.75, 9);
  });

  it('setRate during the pre-roll keeps the hold and only changes the post-start slope', () => {
    const {ctx, sources} = fakeContext();
    (ctx as any).currentTime = 1;
    const engine = new BufferEngine(ctx, makeClip());
    void engine.play(0.5, 3);
    (ctx as any).currentTime = 2; // still before `when`
    engine.setRate(2);
    expect(sources[0].playbackRate.value).toBe(2);
    // Pre-roll: the source is silent until `when`, so the position must keep
    // holding at the armed offset — the rate change affects only the slope
    // AFTER the scheduled start.
    (ctx as any).currentTime = 2.5;
    expect(engine.currentTime).toBeCloseTo(0.5, 9);
    // After `when`: advances from the offset at the new rate.
    (ctx as any).currentTime = 3.25;
    expect(engine.currentTime).toBeCloseTo(1.0, 9);
  });

  it('releases the hold at exactly t === when: position is exactly the offset', () => {
    const {ctx} = fakeContext();
    (ctx as any).currentTime = 1;
    const engine = new BufferEngine(ctx, makeClip());
    void engine.play(0.5, 3);
    (ctx as any).currentTime = 3; // the boundary itself: hold over, no advance yet
    expect(engine.currentTime).toBe(0.5);
  });

  it('pause during the pre-roll window retracts the pending start and keeps the offset', () => {
    const {ctx, stopped} = fakeContext();
    (ctx as any).currentTime = 1;
    const engine = new BufferEngine(ctx, makeClip());
    void engine.play(0.5, 3);
    (ctx as any).currentTime = 2; // still before `when`
    engine.pause();
    expect(stopped).toHaveLength(1); // source.stop() cancels the scheduled start
    expect(engine.playing).toBe(false);
    expect(engine.currentTime).toBeCloseTo(0.5, 9);
  });
});

describe('BufferEngine transport edges', () => {
  it('play(offset) while already playing is a no-op (no restart, no position jump)', () => {
    const {ctx, started} = fakeContext();
    const engine = new BufferEngine(ctx, makeClip());
    void engine.play(0.25); // t=0
    (ctx as any).currentTime = 1;
    void engine.play(1.75); // ignored: would desync position from the running source
    expect(started).toHaveLength(1);
    expect(engine.currentTime).toBeCloseTo(1.25, 9);
  });
});

describe('BufferEngine looping', () => {
  it('wraps currentTime into the loop window via modulo while playing', () => {
    const {ctx} = fakeContext();
    const engine = new BufferEngine(ctx, makeClip(), {loop: {start: 0.5, end: 1.5}});
    void engine.play(0.5); // t=0
    (ctx as any).currentTime = 2.2; // unwrapped position 2.7 → 0.5 + (2.2 % 1)
    expect(engine.currentTime).toBeCloseTo(0.7, 9);

    // Boolean loop wraps over the full clip duration.
    const full = fakeContext();
    const engine2 = new BufferEngine(full.ctx, makeClip(), {loop: true});
    void engine2.play(0); // t=0, duration 2
    (full.ctx as any).currentTime = 5; // unwrapped 5 → 5 % 2
    expect(engine2.currentTime).toBeCloseTo(1, 9);
  });

  it('pause normalizes to the wrapped position and feeds it to the resume offset', () => {
    const {ctx, started} = fakeContext();
    const engine = new BufferEngine(ctx, makeClip(), {loop: {start: 0.5, end: 1.5}});
    void engine.play(0.5); // t=0
    (ctx as any).currentTime = 2.2; // wrapped position 0.7
    engine.pause();
    expect(engine.currentTime).toBeCloseTo(0.7, 9);
    // Resume without an explicit offset: the native source must be started at
    // the WRAPPED offset (an unwrapped one would never re-enter the loop window).
    void engine.play();
    expect(started).toHaveLength(2);
    expect(started[1].when).toBe(2.2);
    expect(started[1].offset).toBeCloseTo(0.7, 9);
  });

  it('folds a seek past the loop end into the window instead of escaping it', () => {
    const {ctx, started} = fakeContext();
    const engine = new BufferEngine(ctx, makeClip(), {loop: {start: 0.5, end: 1.5}});
    void engine.play(0.5); // t=0

    // 1.9 is past loopEnd: a native source started there plays out of the
    // window and never re-enters it, so the clock's wrapped read would part
    // company with the audio actually sounding.
    (ctx as any).currentTime = 0.4;
    engine.seek(1.9);

    expect(started).toHaveLength(2);
    expect(started[1].offset).toBeCloseTo(0.9, 9); // 0.5 + (1.9 − 0.5) % 1
    expect(engine.currentTime).toBeCloseTo(0.9, 9);
  });

  it('folds a play offset past the loop end into the window', () => {
    const {ctx, started} = fakeContext();
    const engine = new BufferEngine(ctx, makeClip(), {loop: {start: 0.5, end: 1.5}});

    void engine.play(1.8);

    expect(started[0].offset).toBeCloseTo(0.8, 9); // 0.5 + (1.8 − 0.5) % 1
    expect(engine.currentTime).toBeCloseTo(0.8, 9);
  });

  it('leaves a seek before the loop start alone', () => {
    const {ctx, started} = fakeContext();
    const engine = new BufferEngine(ctx, makeClip(), {loop: {start: 0.5, end: 1.5}});
    void engine.play(0.5);

    // Native sources play from before loopStart into the loop, so this
    // position is honoured rather than folded.
    (ctx as any).currentTime = 0.2;
    engine.seek(0.1);

    expect(started[1].offset).toBeCloseTo(0.1, 9);
  });

  it('setRate mid-loop keeps the wrapped read continuous across the rate change', () => {
    const {ctx, sources} = fakeContext();
    const engine = new BufferEngine(ctx, makeClip(), {loop: {start: 0.5, end: 1.5}});
    void engine.play(0.5); // t=0
    (ctx as any).currentTime = 2.2; // unwrapped 2.7, wrapped 0.7
    engine.setRate(2);
    // Continuous at the change instant: same wrapped position.
    expect(engine.currentTime).toBeCloseTo(0.7, 9);
    expect(sources[0].playbackRate.value).toBe(2);
    // Advances at the new rate, still wrapped into the loop window:
    // unwrapped 2.7 + 0.25·2 = 3.2 → 0.5 + (2.7 % 1) = 1.2.
    (ctx as any).currentTime = 2.45;
    expect(engine.currentTime).toBeCloseTo(1.2, 9);
  });
});

describe('BufferEngine construction rate', () => {
  it('passes a construction rate outside [0.25, 4] through to the source unclamped', () => {
    const {ctx, sources} = fakeContext();
    const engine = new BufferEngine(ctx, makeClip(), {rate: 8});
    void engine.play(0);
    expect(sources[0].playbackRate.value).toBe(8); // only setRate() clamps
    (ctx as any).currentTime = 0.1;
    expect(engine.currentTime).toBeCloseTo(0.8, 9); // position advances at 8×
  });

  it('coerces a non-positive construction rate to 1 (designed change)', () => {
    const {ctx, sources} = fakeContext();
    const engine = new BufferEngine(ctx, makeClip(), {rate: -1});
    void engine.play(0);
    expect(sources[0].playbackRate.value).toBe(1);
    (ctx as any).currentTime = 0.5;
    expect(engine.currentTime).toBeCloseTo(0.5, 9);
  });
});

describe('BufferEngine clock exposure', () => {
  it('exposes a TransportClockReader that reads the UNWRAPPED position under loop', () => {
    const {ctx} = fakeContext();
    const engine = new BufferEngine(ctx, makeClip(), {loop: {start: 0.5, end: 1.5}});
    const clock: TransportClockReader = engine.clock; // read-only view, no mutators
    expect(clock.paused).toBe(true);
    void engine.play(0.5); // t=0
    (ctx as any).currentTime = 2.2;
    expect(clock.paused).toBe(false);
    expect(clock.rate).toBe(1);
    // The reader is the raw transport axis: unwrapped clip seconds. Only the
    // engine's currentTime applies the loop-window modulo.
    expect(clock.positionAt(2.2)).toBeCloseTo(2.7, 9);
    expect(engine.currentTime).toBeCloseTo(0.7, 9);
    // Congruent modulo the loop span (2.7 − 0.7 = 2 × span).
    expect((clock.positionAt(2.2) - engine.currentTime) % 1).toBeCloseTo(0, 9);
  });

  it('keeps the reader anchored across pause: position freezes at the wrapped value', () => {
    const {ctx} = fakeContext();
    const engine = new BufferEngine(ctx, makeClip(), {loop: {start: 0.5, end: 1.5}});
    void engine.play(0.5); // t=0
    (ctx as any).currentTime = 2.2;
    engine.pause();
    expect(engine.clock.paused).toBe(true);
    expect(engine.clock.positionAt(99)).toBeCloseTo(0.7, 9); // normalized wrapped
  });
});

describe('BufferEngine natural end', () => {
  it('onended snaps the position to duration, stops the transport and fires the callback', () => {
    const {ctx, sources} = fakeContext();
    const engine = new BufferEngine(ctx, makeClip());
    let ended = 0;
    engine.onEnded(() => ended++);
    void engine.play(0); // t=0, duration 2
    (ctx as any).currentTime = 2;
    sources[0].onended?.(); // native end-of-buffer
    expect(ended).toBe(1);
    expect(engine.playing).toBe(false);
    expect(engine.currentTime).toBe(2);
    expect(sources[0].disconnected).toBe(1);

    // Replaying must not leave the ended source attached to the graph.
    void engine.play(0);
    expect(sources).toHaveLength(2);
  });
});

describe('BufferEngine live loop changes', () => {
  it('folds the audible position into the anchor when a loop is disabled mid-flight', () => {
    const {ctx} = fakeContext();
    // Clip is 2 s; loop the first second so the unwrapped clock runs past it.
    const engine = new BufferEngine(ctx, makeClip(), {loop: {start: 0, end: 1}});
    void engine.play(0); // t=0
    (ctx as any).currentTime = 2.5;
    // Unwrapped position is 2.5; wrapped (audible) is 0.5.
    expect(engine.currentTime).toBeCloseTo(0.5, 9);

    engine.setLoop(false);
    // The source keeps playing from where it was, so the reader must too —
    // without normalization the wrap branch vanishes and the position jumps
    // to the clamped duration.
    expect(engine.currentTime).toBeCloseTo(0.5, 9);
    expect(engine.clock.positionAt(ctx.currentTime)).toBeCloseTo(0.5, 9);

    (ctx as any).currentTime = 3.5;
    expect(engine.currentTime).toBeCloseTo(1.5, 9);
  });

  it('keeps the position continuous when the loop window moves', () => {
    const {ctx} = fakeContext();
    const engine = new BufferEngine(ctx, makeClip(), {loop: {start: 0, end: 1}});
    void engine.play(0);
    (ctx as any).currentTime = 1.25;
    expect(engine.currentTime).toBeCloseTo(0.25, 9);

    engine.setLoop({start: 0, end: 2});
    expect(engine.currentTime).toBeCloseTo(0.25, 9);
  });

  it('leaves the position of a paused engine untouched', () => {
    const {ctx} = fakeContext();
    const engine = new BufferEngine(ctx, makeClip());
    engine.seek(0.75);
    engine.setLoop({start: 0, end: 1});
    expect(engine.currentTime).toBeCloseTo(0.75, 9);
  });
});

describe('BufferEngine loop-window start offsets', () => {
  it('folds a start offset past the loop end back into the window', () => {
    const {ctx, started} = fakeContext();
    // Clip is 2 s; loop the first second. A native start at 1.5 would play out
    // to the buffer end and never re-enter the window — silent, yet `playing`.
    const engine = new BufferEngine(ctx, makeClip(), {loop: {start: 0, end: 1}});
    void engine.play(1.5);

    expect(started).toHaveLength(1);
    expect(started[0].offset).toBeCloseTo(0.5, 9); // 0 + (1.5 - 0) % 1
    expect(engine.playing).toBe(true);
    expect(engine.currentTime).toBeCloseTo(0.5, 9);
  });

  it('leaves a start offset before the loop start alone (play-in is native)', () => {
    const {ctx, started} = fakeContext();
    const engine = new BufferEngine(ctx, makeClip(), {loop: {start: 1, end: 2}});
    void engine.play(0.25);

    // Playing into the loop and then cycling is legitimate; do not fold it.
    expect(started[0].offset).toBeCloseTo(0.25, 9);
  });

  it('does not fold anything when no loop is set', () => {
    const {ctx, started} = fakeContext();
    const engine = new BufferEngine(ctx, makeClip());
    void engine.play(1.5);

    expect(started[0].offset).toBeCloseTo(1.5, 9);
  });
});


describe('BufferEngine command boundaries', () => {
  it('re-arms a pre-roll seek at the original scheduled time', async () => {
    const {ctx, started, stopped} = fakeContext();
    const engine = new BufferEngine(ctx, makeClip(), {rate: 2});
    await engine.play(0.5, 3);
    (ctx as any).currentTime = 1;

    engine.seek(0.75);

    expect(stopped).toEqual([1]);
    expect(started).toEqual([{when: 3, offset: 0.5}, {when: 3, offset: 0.75}]);
    (ctx as any).currentTime = 2.5;
    expect(engine.currentTime).toBe(0.75);
    (ctx as any).currentTime = 3.25;
    expect(engine.currentTime).toBe(1.25);
    engine.dispose();
  });

  it('keeps a paused position if replacement source startup fails', async () => {
    const {ctx, sources} = fakeContext();
    const engine = new BufferEngine(ctx, makeClip());
    await engine.play();
    const originalCreateSource = ctx.createBufferSource.bind(ctx);
    (ctx as any).createBufferSource = () => {
      const source = originalCreateSource();
      source.start = () => { throw new Error('source unavailable'); };
      return source;
    };

    expect(() => engine.seek(0.75)).toThrow('source unavailable');

    expect(engine.playing).toBe(false);
    expect(engine.currentTime).toBe(0.75);
    expect(sources[0].disconnected).toBe(1);
    expect(sources[1].disconnected).toBe(1);
    engine.dispose();
  });

  it('cannot recreate sources or mutate the frozen clock after disposal', async () => {
    const {ctx, started, sources} = fakeContext();
    const engine = new BufferEngine(ctx, makeClip(), {loop: {start: 0, end: 1}});
    await engine.play();
    (ctx as any).currentTime = 2.5;
    engine.dispose();
    const stoppedState = engine.clock.state;

    engine.prepare();
    engine.seek(1.5);
    engine.setRate(3);
    engine.setLoop(false);
    engine.stop();
    await engine.play(0.25, 6);
    engine.dispose();

    expect(started).toHaveLength(1);
    expect(sources).toHaveLength(1);
    expect(engine.playing).toBe(false);
    expect(engine.currentTime).toBe(0.5);
    expect(engine.clock.state).toEqual(stoppedState);
  });

  it('rejects unusable ranges before changing an existing loop', async () => {
    const {ctx, sources} = fakeContext();
    const range = {start: 0, end: 1};
    const engine = new BufferEngine(ctx, makeClip(), {loop: range});
    range.end = 0; // Caller edits cannot mutate the accepted snapshot.
    await engine.play();

    expect(() => engine.setLoop({start: 3, end: 4})).toThrow(RangeError);
    expect(() => engine.setLoop({start: 0, end: NaN})).toThrow(RangeError);
    expect(sources[0].loopEnd).toBe(1);
    (ctx as any).currentTime = 1.5;
    expect(engine.currentTime).toBe(0.5);
    engine.dispose();
  });
});
