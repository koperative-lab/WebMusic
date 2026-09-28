import {describe, expect, it} from 'vitest';
import {measureLoudness} from '../../src/analyze/core/loudness';
import {sine, silence, whiteNoise} from './signals';

describe('measureLoudness', () => {
  it('measures a full-scale sine near 0 dBFS peak with the expected RMS', () => {
    const sr = 48000;
    const channel = sine(1000, 2, sr, 1.0);
    const {rms, truePeakDb, integratedLufs} = measureLoudness([channel], sr);

    // A unit sine has RMS = 1/sqrt(2) ≈ 0.707.
    expect(rms).toBeCloseTo(Math.SQRT1_2, 2);
    // Peak ~ 0 dBFS (just under, due to sampling).
    expect(truePeakDb).toBeGreaterThan(-0.2);
    expect(truePeakDb).toBeLessThanOrEqual(0.01);
    // A 0 dBFS 1 kHz sine sits around −3 LUFS (K-weighting boosts ~+0 at 1 kHz,
    // and LUFS of an RMS-0.707 signal ≈ -3.0). Allow a wide tolerance.
    expect(integratedLufs).toBeGreaterThan(-6);
    expect(integratedLufs).toBeLessThan(0);
  });

  it('reports silence as -Infinity loudness and zero RMS', () => {
    const {rms, truePeakDb, integratedLufs} = measureLoudness([silence(1, 48000)], 48000);
    expect(rms).toBe(0);
    expect(truePeakDb).toBe(-Infinity);
    expect(integratedLufs).toBe(-Infinity);
  });

  it('orders loud vs quiet signals correctly (monotonic in level)', () => {
    const sr = 48000;
    const loud = measureLoudness([sine(1000, 1, sr, 1.0)], sr).integratedLufs;
    const quiet = measureLoudness([sine(1000, 1, sr, 0.1)], sr).integratedLufs;
    // 20 dB lower amplitude → ~20 LU quieter.
    expect(loud).toBeGreaterThan(quiet);
    expect(loud - quiet).toBeGreaterThan(15);
    expect(loud - quiet).toBeLessThan(25);
  });

  it('produces a finite, sane LUFS for white noise', () => {
    const sr = 48000;
    const {integratedLufs, rms} = measureLoudness([whiteNoise(1, sr, 0.5)], sr);
    expect(Number.isFinite(integratedLufs)).toBe(true);
    expect(rms).toBeGreaterThan(0);
    expect(integratedLufs).toBeLessThan(0);
  });
});
