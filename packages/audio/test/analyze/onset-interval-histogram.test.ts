import {describe, expect, it} from 'vitest';
import {histogramOnsetIntervals} from '../../src/analyze/api';

describe('histogramOnsetIntervals', () => {
  it('returns populated interval bins and an open overflow bucket', () => {
    expect(
      histogramOnsetIntervals([0, 0.125, 0.375, 0.875, 2.125], {
        bucketSeconds: 0.25,
        overflowSeconds: 1,
      }),
    ).toEqual([
      {startSeconds: 0, endSeconds: 0.25, count: 1},
      {startSeconds: 0.25, endSeconds: 0.5, count: 1},
      {startSeconds: 0.5, endSeconds: 0.75, count: 1},
      {startSeconds: 1, count: 1},
    ]);
  });

  it('uses the overflow threshold even when it is not a bucket boundary', () => {
    expect(
      histogramOnsetIntervals([0, 1.125], {bucketSeconds: 0.4, overflowSeconds: 1}),
    ).toEqual([{startSeconds: 1, count: 1}]);
  });

  it('ignores invalid and nonpositive adjacent gaps', () => {
    expect(histogramOnsetIntervals([0, 0, Number.NaN, 1, 2])).toEqual([
      {startSeconds: 1, endSeconds: 1.05, count: 1},
    ]);
  });

  it('rejects unsafe bucket options', () => {
    expect(() => histogramOnsetIntervals([0, 1], {bucketSeconds: 0})).toThrow(RangeError);
    expect(() => histogramOnsetIntervals([0, 1], {overflowSeconds: Infinity})).toThrow(RangeError);
    expect(() => histogramOnsetIntervals([0, 1], {bucketSeconds: 1e-8})).toThrow(RangeError);
  });
});
