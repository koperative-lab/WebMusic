import {describe, expect, it} from 'vitest';
import {TransportClock} from '../src/transport';

describe('TransportClock', () => {
  it('advances linearly from the anchor at rate 1 and rate 2', () => {
    const clock = new TransportClock();
    clock.start(10, 0);
    expect(clock.positionAt(10)).toBe(0);
    expect(clock.positionAt(13)).toBe(3);

    const fast = new TransportClock();
    fast.start(0, 5);
    fast.setRate(2, 0);
    expect(fast.positionAt(4)).toBe(13);
  });

  it('yields unclamped positions before the anchor', () => {
    const clock = new TransportClock();
    clock.start(10, 1);
    expect(clock.positionAt(8)).toBe(-1);
  });

  it('keeps position continuous across a rate change and applies the new slope after', () => {
    const clock = new TransportClock();
    clock.start(0, 0);
    const before = clock.positionAt(4); // 4
    clock.setRate(0.5, 4);
    expect(clock.positionAt(4)).toBe(before);
    expect(clock.positionAt(8)).toBe(before + 2);
  });

  it('rejects invalid rates', () => {
    const clock = new TransportClock();
    for (const bad of [0, -1, NaN, Infinity]) {
      expect(() => clock.setRate(bad, 0)).toThrow(RangeError);
    }
  });

  it('rejects non-finite anchor times and positions without corrupting the anchor', () => {
    const clock = new TransportClock();
    clock.start(0, 3);
    for (const bad of [NaN, Infinity, -Infinity]) {
      expect(() => clock.start(bad)).toThrow(RangeError);
      expect(() => clock.start(0, bad)).toThrow(RangeError);
      expect(() => clock.startAt(bad, 0)).toThrow(RangeError);
      expect(() => clock.startAt(0, bad)).toThrow(RangeError);
      expect(() => clock.pause(bad)).toThrow(RangeError);
      expect(() => clock.seekTo(bad, 1)).toThrow(RangeError);
      expect(() => clock.seekTo(1, bad)).toThrow(RangeError);
      expect(() => clock.setRate(1, bad)).toThrow(RangeError);
    }
    expect(clock.positionAt(4)).toBe(7); // every rejected call left the anchor intact
    expect(clock.paused).toBe(false);
  });

  it('pause freezes position; resume loses none; repeated pause is idempotent', () => {
    const clock = new TransportClock();
    clock.start(0, 0);
    clock.pause(5);
    expect(clock.positionAt(9)).toBe(5);
    clock.pause(9);
    expect(clock.positionAt(20)).toBe(5);
    clock.start(12);
    expect(clock.positionAt(12)).toBe(5);
    expect(clock.positionAt(14)).toBe(7);
  });

  it('seeks while playing and while paused, preserving the state', () => {
    const playing = new TransportClock();
    playing.start(0, 0);
    playing.seekTo(30, 2);
    expect(playing.paused).toBe(false);
    expect(playing.positionAt(3)).toBe(31);

    const paused = new TransportClock();
    paused.pause(0);
    paused.seekTo(30, 2);
    expect(paused.paused).toBe(true);
    expect(paused.positionAt(10)).toBe(30);
  });

  it('timeAt inverts positionAt while playing and throws while paused', () => {
    const clock = new TransportClock();
    clock.start(2, 10);
    clock.setRate(2, 2);
    const t = 7;
    expect(clock.timeAt(clock.positionAt(t))).toBeCloseTo(t, 12);
    clock.pause(8);
    expect(() => clock.timeAt(10)).toThrow(RangeError);
  });

  it('injected now() getter agrees with explicit-time methods', () => {
    let t = 0;
    const clock = new TransportClock(() => t);
    clock.start(0, 0);
    t = 6;
    expect(clock.position).toBe(clock.positionAt(6));
    expect(() => new TransportClock().position).toThrow(/no injected now/);
  });

  it('supports consumer-side loop wrap via seekTo', () => {
    const clock = new TransportClock();
    clock.start(0, 0);
    const loopStart = 2;
    const loopEnd = 5;
    const positions: number[] = [];
    for (let t = 0; t <= 8; t += 1) {
      let p = clock.positionAt(t);
      if (p >= loopEnd) {
        clock.seekTo(loopStart + ((p - loopStart) % (loopEnd - loopStart)), t);
        p = clock.positionAt(t);
      }
      positions.push(p);
    }
    expect(Math.max(...positions)).toBeLessThan(loopEnd);
    expect(positions[5]).toBe(loopStart);
  });
});

describe('TransportClock scheduled start (startAt)', () => {
  it('holds position through the pre-roll and advances after the origin', () => {
    const clock = new TransportClock();
    clock.startAt(5, 2);
    expect(clock.paused).toBe(false);
    expect(clock.holding).toBe(true);
    expect(clock.positionAt(3)).toBe(2); // pre-roll hold, not negative
    expect(clock.positionAt(5)).toBe(2);
    expect(clock.positionAt(6.5)).toBeCloseTo(3.5, 12);
  });

  it('setRate during the pre-roll keeps the armed origin and only changes the slope', () => {
    const clock = new TransportClock();
    clock.startAt(5, 2);
    clock.setRate(2, 3); // still pre-roll
    expect(clock.positionAt(4)).toBe(2);
    expect(clock.positionAt(6)).toBeCloseTo(4, 12); // 2 + (6-5)*2
  });

  it('seekTo during the pre-roll re-arms the held position at the same origin', () => {
    const clock = new TransportClock();
    clock.startAt(5, 2);
    clock.seekTo(7, 3);
    expect(clock.positionAt(4)).toBe(7);
    expect(clock.positionAt(6)).toBeCloseTo(8, 12);
  });

  it('pause during the pre-roll cancels the pending start at the held position', () => {
    const clock = new TransportClock();
    clock.startAt(5, 2);
    clock.pause(3);
    expect(clock.paused).toBe(true);
    expect(clock.positionAt(10)).toBe(2);
    expect(clock.holding).toBe(false);
  });

  it('a plain start() clears the hold', () => {
    const clock = new TransportClock();
    clock.startAt(5, 2);
    clock.start(3, 1);
    expect(clock.holding).toBe(false);
    expect(clock.positionAt(4)).toBeCloseTo(2, 12); // 1 + (4-3)*1
  });

  it('timeAt during the hold answers reachable positions and rejects unreachable ones', () => {
    const clock = new TransportClock();
    clock.startAt(5, 2);
    expect(clock.timeAt(2)).toBe(5); // the armed origin
    expect(clock.timeAt(3)).toBe(6); // past the origin, ordinary affine inverse
    // Positions below the armed origin never occur while holding: the naive
    // extrapolation would return t=4, where positionAt(4) is 2, not 1.
    expect(() => clock.timeAt(1)).toThrow(RangeError);
    clock.start(7); // leaving the hold restores unclamped backward extrapolation
    expect(clock.timeAt(1)).toBe(4); // anchor (7, 4) at rate 1
  });
});
