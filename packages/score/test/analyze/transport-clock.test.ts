// Whole milliseconds, no timers, no DOM, nothing mounted. That is the point of
// the module under test: a cursor arrives at 20 Hz, a lane asks at 60 Hz, and
// everything in between is arithmetic that can be driven with integers.

import {describe, expect, it} from 'vitest';
import {createTransportClock, rateFromDurations} from '../../src/analyze/headless/transport-clock';

/** A cursor tick, as `webscore:timeupdate` delivers one. */
const tick = (atMs: number, nominalSeconds: number, rate = 1) => ({atMs, nominalSeconds, rate});

describe('createTransportClock', () => {
  it('interpolates between two sparse samples instead of stepping', () => {
    const clock = createTransportClock();
    clock.sample(tick(1000, 10));

    // The three frames a 60 Hz screen draws before the next 20 Hz cursor.
    expect(clock.readAt(1016).seconds).toBeCloseTo(10.016, 6);
    expect(clock.readAt(1033).seconds).toBeCloseTo(10.033, 6);
    expect(clock.readAt(1050).seconds).toBeCloseTo(10.05, 6);
    expect(clock.readAt(1016).held).toBe(false);
  });

  it('reads the same instant the same way however often it is asked', () => {
    const clock = createTransportClock();
    clock.sample(tick(1000, 10));
    expect(clock.readAt(1030)).toEqual(clock.readAt(1030));
  });

  it('coasts to a bounded, decelerating stop when a pause stops the cursor', () => {
    // `pause()` emits nothing at all, so starvation is the only signal there is.
    const clock = createTransportClock();
    clock.sample(tick(1000, 10));

    const early = clock.readAt(1060).seconds;
    const later = clock.readAt(1090).seconds;
    const settled = clock.readAt(1200).seconds;

    // Still moving forward, and each interval covers less ground than the last.
    expect(later).toBeGreaterThan(early);
    expect(settled).toBeGreaterThan(later);
    expect(later - early).toBeLessThan(early - 10);

    // The whole overshoot past the expected interval is half the decay window:
    // 25 ms of nominal time, which at 120 bpm and 64 px per quarter is 3.2 px.
    expect(settled).toBeLessThanOrEqual(10.075 + 1e-9);
    expect(clock.readAt(1200).held).toBe(true);
    // And then it stays put rather than drifting off in a background tab.
    expect(clock.readAt(9000).seconds).toBe(settled);
  });

  it('holds the epoch through ordinary and late ticks', () => {
    const clock = createTransportClock();
    clock.sample(tick(1000, 10));
    const start = clock.readAt(1000).epoch;

    clock.sample(tick(1050, 10.05));
    clock.sample(tick(1100, 10.1));
    expect(clock.readAt(1100).epoch).toBe(start);

    // A tick 400 ms late is a starved clock catching up, not a jump: the coast
    // stopped at 75 ms and the transport did not.
    clock.sample(tick(1500, 10.5));
    expect(clock.readAt(1500).epoch).toBe(start);
    expect(clock.readAt(1500).seconds).toBeCloseTo(10.5, 6);
  });

  it('bumps the epoch on a seek, forwards and backwards', () => {
    const forwards = createTransportClock();
    forwards.sample(tick(1000, 10));
    const before = forwards.readAt(1000).epoch;
    forwards.sample(tick(1050, 30));
    expect(forwards.readAt(1050).epoch).toBe(before + 1);
    expect(forwards.readAt(1050).seconds).toBeCloseTo(30, 6);

    const backwards = createTransportClock();
    backwards.sample(tick(1000, 10));
    backwards.sample(tick(1050, 2));
    expect(backwards.readAt(1050).epoch).toBe(backwards.readAt(1000).epoch);
    expect(backwards.readAt(1050).seconds).toBeCloseTo(2, 6);
  });

  it('takes a loop wrap down the same path as a seek', () => {
    const clock = createTransportClock({durationSeconds: 12});
    clock.sample(tick(1000, 11.9));
    const before = clock.readAt(1000).epoch;
    // `wrapLoop()` emits a cursor bypassing the throttle, so the wrap is
    // announced and only has to be RECOGNISED — the loop region is unreadable.
    clock.sample(tick(1020, 0));
    expect(clock.readAt(1020).epoch).toBe(before + 1);
    expect(clock.readAt(1020).seconds).toBe(0);
  });

  it('reads the rate off the sample and never differences it', () => {
    const clock = createTransportClock();
    clock.sample(tick(1000, 10));
    const before = clock.readAt(1000).epoch;

    // `retune()` emits a cursor at the change: same position, new rate. A
    // finite difference could not tell this from a seek, which is the whole
    // reason the rate is on the wire.
    clock.sample(tick(1050, 10.05, 2));
    expect(clock.readAt(1050).epoch).toBe(before);
    expect(clock.readAt(1050).rate).toBe(2);
    // Twice the nominal seconds per real second, immediately.
    expect(clock.readAt(1070).seconds).toBeCloseTo(10.09, 6);
  });

  it('re-measures the cursor interval instead of trusting the documented one', () => {
    const slow = createTransportClock();
    // A borrowed controller ticking at 100 ms, not the score player's 50.
    for (let index = 0; index <= 6; index += 1) {
      slow.sample(tick(1000 + index * 100, 10 + index * 0.1));
    }
    // 120 ms after the last one it is still coasting, because 120 ms is no
    // longer late for this stream.
    expect(slow.readAt(1720).held).toBe(false);

    // The same 120 ms against the documented 50 ms interval is long over.
    const quick = createTransportClock();
    quick.sample(tick(1000, 10));
    expect(quick.readAt(1120).held).toBe(true);
  });

  it('stops dead on the end of the piece', () => {
    const clock = createTransportClock({durationSeconds: 12});
    clock.sample(tick(1000, 11.9));
    const before = clock.readAt(1000).epoch;
    clock.stop(1010, 12);

    const reading = clock.readAt(1400);
    expect(reading.seconds).toBe(12);
    expect(reading.rate).toBe(0);
    expect(reading.held).toBe(true);
    expect(reading.epoch).toBe(before + 1);
  });

  it('gives a drag the position outright, and ignores the player echoing back', () => {
    const clock = createTransportClock({durationSeconds: 60});
    clock.sample(tick(1000, 10));
    const before = clock.readAt(1000).epoch;

    clock.hold(25);
    expect(clock.readAt(1010).seconds).toBe(25);
    expect(clock.readAt(1010).held).toBe(true);
    expect(clock.readAt(1010).epoch).toBe(before + 1);

    clock.release(1010);
    // The cursor still in flight is reporting where the transport WAS. Taking
    // it would yank the lane back to 10 for one interval after every scrub.
    clock.sample(tick(1050, 10.2));
    expect(clock.readAt(1060).seconds).toBe(25);

    // The one that agrees ends the standoff, and playback resumes from there.
    clock.sample(tick(1100, 25.05));
    expect(clock.readAt(1120).seconds).toBeCloseTo(25.07, 6);
  });

  it('stops ignoring the player once the grace has run out', () => {
    const clock = createTransportClock({durationSeconds: 60});
    clock.sample(tick(1000, 10));
    clock.hold(25);
    clock.release(1010);

    // Nobody ever agreed: something else is driving the transport, and after
    // 250 ms this clock believes it rather than its own last reader.
    clock.sample(tick(1400, 4));
    expect(clock.readAt(1400).seconds).toBeCloseTo(4, 6);
  });

  it('clamps every reading to the piece', () => {
    const clock = createTransportClock({durationSeconds: 10});
    clock.sample(tick(1000, 9.98));
    expect(clock.readAt(1400).seconds).toBe(10);
    clock.sample(tick(1500, -3));
    expect(clock.readAt(1500).seconds).toBe(0);
  });

  it('survives a player that reports nonsense', () => {
    const clock = createTransportClock();
    clock.sample(tick(1000, 10));
    clock.sample(tick(1050, Number.NaN));
    clock.sample({atMs: 1060, nominalSeconds: 10.06, rate: Number.NaN});
    const reading = clock.readAt(1060);
    expect(reading.seconds).toBeCloseTo(10.06, 6);
    // The last rate anyone actually reported still stands: a lane that stops
    // because one field arrived broken is worse than one that keeps going.
    expect(reading.rate).toBe(1);
  });
});

describe('rateFromDurations', () => {
  it('reads the rate off the two durations', () => {
    expect(rateFromDurations(120, 60)).toBe(2);
    expect(rateFromDurations(120, 240)).toBe(0.5);
    expect(rateFromDurations(120, 120)).toBe(1);
  });

  it('answers 1 for anything it cannot read', () => {
    // Including position 0, where `nominal / transport` is 0/0 and the whole
    // reason this reads durations rather than positions.
    expect(rateFromDurations(0, 0)).toBe(1);
    expect(rateFromDurations(120, 0)).toBe(1);
    expect(rateFromDurations(Number.NaN, 60)).toBe(1);
    expect(rateFromDurations(120, Number.POSITIVE_INFINITY)).toBe(1);
  });
});
