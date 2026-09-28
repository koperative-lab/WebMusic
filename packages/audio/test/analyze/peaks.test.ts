import {peakCount, readPeak} from '../../src/core';
import {describe, expect, it} from 'vitest';
import {computePeaks} from '../../src/analyze/core/peaks';
import {sine, silence} from './signals';

describe('computePeaks', () => {
  it('produces a pyramid with the expected shape', () => {
    const sr = 44100;
    const channel = sine(440, 1, sr); // 44100 samples
    const peaks = computePeaks([channel], sr, {baseSamplesPerPeak: 256});

    expect(peaks.sampleRate).toBe(sr);
    expect(peaks.channels).toBe(1);
    expect(peaks.baseSamplesPerPeak).toBe(256);
    expect(peaks.levels.length).toBeGreaterThan(1);

    // Base level: ceil(44100 / 256) = 173 peaks.
    expect(peaks.levels[0].samplesPerPeak).toBe(256);
    expect(peakCount(peaks.levels[0], 1)).toBe(Math.ceil(44100 / 256));

    // Each successive level doubles samplesPerPeak and ~halves the peak count.
    for (let i = 1; i < peaks.levels.length; i++) {
      expect(peaks.levels[i].samplesPerPeak).toBe(peaks.levels[i - 1].samplesPerPeak * 2);
    }
    // Coarsest level collapses to a single peak.
    expect(peakCount(peaks.levels[peaks.levels.length - 1], 1)).toBe(1);
  });

  it('captures the true min/max of a full-scale sine within quantization error', () => {
    const sr = 8000;
    const channel = sine(200, 0.5, sr, 1.0);
    const peaks = computePeaks([channel], sr, {baseSamplesPerPeak: 128});

    // Over a window spanning several full periods, the quantized peak should be
    // ~+1 and the quantized trough ~−1 (within 1 quantization step = 1/128).
    let maxSeen = -2;
    let minSeen = 2;
    const count = peakCount(peaks.levels[0], 1);
    for (let p = 0; p < count; p++) {
      const {min, max} = readPeak(peaks.levels[0], 1, 0, p);
      if (max > maxSeen) maxSeen = max;
      if (min < minSeen) minSeen = min;
    }
    expect(maxSeen).toBeGreaterThan(0.98);
    expect(minSeen).toBeLessThan(-0.98);
  });

  it('exactly matches a hand-computed min/max on a known block', () => {
    // One channel, 4 samples, one peak covering all of them.
    const channel = Float32Array.from([0.5, -0.25, 0.75, -1.0]);
    const peaks = computePeaks([channel], 4, {baseSamplesPerPeak: 4});
    const {min, max} = readPeak(peaks.levels[0], 1, 0, 0);
    // Quantized: round(0.75*128)=96 → 96/128 = 0.75; round(-1*128)=-128 → -1.
    expect(max).toBeCloseTo(0.75, 5);
    expect(min).toBeCloseTo(-1, 5);
  });

  it('represents silence as flat zero peaks', () => {
    const peaks = computePeaks([silence(0.1, 8000)], 8000, {baseSamplesPerPeak: 64});
    const {min, max} = readPeak(peaks.levels[0], 1, 0, 0);
    expect(min).toBe(0);
    expect(max).toBe(0);
  });

  it('handles stereo with independent channel peaks', () => {
    const left = Float32Array.from([1, 1, 1, 1]);
    const right = Float32Array.from([-1, -1, -1, -1]);
    const peaks = computePeaks([left, right], 4, {baseSamplesPerPeak: 4});
    expect(peaks.channels).toBe(2);
    const l = readPeak(peaks.levels[0], 2, 0, 0);
    const r = readPeak(peaks.levels[0], 2, 1, 0);
    // Int8 quantization: +1.0 → round(128) clamped to 127 → 127/128 = 0.9921875;
    // −1.0 → −128 → exactly −1. Channels are independent.
    expect(l.max).toBeCloseTo(127 / 128, 5);
    expect(r.min).toBeCloseTo(-1, 5);
  });
});
