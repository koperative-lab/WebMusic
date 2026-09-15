import {describe, expect, it} from 'vitest';
import {Duration, Rational} from '../../src/core';

describe('Duration', () => {
  it('basic note values in quarters', () => {
    expect(Duration.whole().quarters.eq(new Rational(4))).toBe(true);
    expect(Duration.quarter().quarters.eq(Rational.ONE)).toBe(true);
    expect(Duration.eighth().quarters.eq(new Rational(1, 2))).toBe(true);
  });

  it('dotted quarter = 3/2 quarters', () => {
    const dotted = Duration.dotted(Duration.quarter());
    expect(dotted.quarters.eq(new Rational(3, 2))).toBe(true);
  });

  it('double-dotted quarter = 7/4', () => {
    const d = new Duration({base: 1, dots: 2});
    expect(d.quarters.eq(new Rational(7, 4))).toBe(true);
  });

  it('triplet eighth = 1/3 quarter', () => {
    const t = Duration.triplet(Duration.eighth());
    expect(t.quarters.eq(new Rational(1, 3))).toBe(true);
  });

  it('toSeconds depends on bpm', () => {
    expect(Duration.quarter().toSeconds(120)).toBeCloseTo(0.5);
    expect(Duration.quarter().toSeconds(60)).toBeCloseTo(1);
  });

  it('rejects invalid bpm in toSeconds', () => {
    expect(() => Duration.quarter().toSeconds(0)).toThrow(RangeError);
    expect(() => Duration.quarter().toSeconds(-120)).toThrow(RangeError);
    expect(() => Duration.quarter().toSeconds(Number.NaN)).toThrow(RangeError);
  });
});

describe('Duration edge cases', () => {
  it('rejects out-of-range dots', () => {
    expect(() => new Duration({base: 1, dots: 5})).toThrow(RangeError);
    expect(() => new Duration({base: 1, dots: -1})).toThrow(RangeError);
  });

  it('four dots fold into a single rational', () => {
    // 1 + 1/2 + 1/4 + 1/8 + 1/16 = 31/16
    const d = new Duration({base: 1, dots: 4});
    expect(d.quarters.eq(new Rational(31, 16))).toBe(true);
  });

  it('rejects non-positive tuplet ratios', () => {
    expect(() => new Duration({base: 1, tuplet: [0, 2]})).toThrow(RangeError);
    expect(() => new Duration({base: 1, tuplet: [3, 0]})).toThrow(RangeError);
  });

  it('rejects negative note lengths and non-integral notation parameters', () => {
    expect(() => new Duration({base: -1})).toThrow(RangeError);
    expect(() => new Duration({base: 1, dots: 1.5})).toThrow(RangeError);
    expect(() => new Duration({base: 1, tuplet: [3.5, 2]})).toThrow(RangeError);
  });

  it('dotted triplet combines both factors exactly', () => {
    // dotted eighth in a 3:2 tuplet = (1/2 * 3/2) * 2/3 = 1/2
    const d = new Duration({base: [1, 2], dots: 1, tuplet: [3, 2]});
    expect(d.quarters.eq(new Rational(1, 2))).toBe(true);
  });

  it('quintuplet sixteenth = 1/5 quarter', () => {
    const d = new Duration({base: [1, 4], tuplet: [5, 4]});
    expect(d.quarters.eq(new Rational(1, 5))).toBe(true);
  });

  it('JSON round-trip preserves dots and tuplet', () => {
    const d = new Duration({base: [1, 2], dots: 1, tuplet: [3, 2]});
    const back = Duration.fromJSON(JSON.parse(JSON.stringify(d)));
    expect(back.quarters.eq(d.quarters)).toBe(true);
    expect(back.dots).toBe(1);
    expect(back.tuplet).toEqual([3, 2]);
  });

  it('snapshots a caller-owned tuplet tuple before computing and serializing duration', () => {
    const tuplet: [number, number] = [3, 2];
    const duration = new Duration({base: 1, tuplet});

    // Mutating an input object after construction must not alter this immutable
    // value or make its JSON representation disagree with `quarters`.
    tuplet[0] = 5;

    expect(duration.quarters.eq(new Rational(2, 3))).toBe(true);
    expect(duration.tuplet).toEqual([3, 2]);
    expect(Object.isFrozen(duration.tuplet)).toBe(true);

    const restored = Duration.fromJSON(duration.toJSON());
    expect(restored.quarters.eq(duration.quarters)).toBe(true);
  });
});
