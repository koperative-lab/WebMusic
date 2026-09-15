import {describe, expect, it} from 'vitest';
import {Rational, TimeMap, timeMapMapping} from '../../src/core';

describe('timeMapMapping', () => {
  const tm = new TimeMap(
    [{atQuarters: Rational.ZERO, bpm: 120}],
    [{atQuarters: Rational.ZERO, measureNumber: 1, timeSignature: {numerator: 4, denominator: 4}}],
  );
  const mapping = timeMapMapping(tm);

  it('converts quarters to seconds through the TimeMap', () => {
    // 120 BPM: one quarter = 0.5 s.
    expect(mapping.positionToSeconds(0)).toBeCloseTo(0, 12);
    expect(mapping.positionToSeconds(4)).toBeCloseTo(2, 12);
  });

  it('round-trips on the positive axis within the 1/480 quantization', () => {
    for (const q of [0, 1, 2.5, 7 / 3]) {
      const back = mapping.secondsToPosition(mapping.positionToSeconds(q));
      expect(Math.abs(back - q)).toBeLessThanOrEqual(1 / 480 + 1e-9);
    }
  });
});
