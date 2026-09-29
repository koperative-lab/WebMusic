import {describe, expect, it} from 'vitest';
import {detectTempo} from '../../src/analyze/core/tempo';
import {clickTrain, silence} from './signals';

describe('detectTempo', () => {
  it('detects ~120 BPM from a 120-BPM click train', async () => {
    const sr = 44100;
    // 8 seconds = 16 beats at 120 BPM.
    const channel = clickTrain(120, 8, sr);
    const {bpm, grid, confidence} = await detectTempo(channel, sr);

    // music-tempo can land on a metrically-related multiple (e.g. 60/240); accept
    // the family by normalizing into [90, 180).
    let normalized = bpm;
    while (normalized < 90) normalized *= 2;
    while (normalized >= 180) normalized /= 2;
    expect(normalized).toBeGreaterThan(116);
    expect(normalized).toBeLessThan(124);

    expect(grid.bpm).toBeCloseTo(bpm, 5);
    expect(grid.beats.length).toBeGreaterThan(0);
    expect(confidence).toBeGreaterThan(0);
  }, 20000);

  it('accepts an array of channels and mixes to mono', async () => {
    const sr = 44100;
    const mono = clickTrain(120, 6, sr);
    const result = await detectTempo([mono, mono], sr);
    expect(result.bpm).toBeGreaterThan(0);
    expect(result.grid.beats.length).toBeGreaterThan(0);
  }, 20000);

  it('falls back gracefully for a silent signal (still returns a grid)', async () => {
    const sr = 22050;
    const result = await detectTempo(silence(2, sr), sr);
    expect(result.grid).toBeDefined();
    expect(Number.isFinite(result.bpm)).toBe(true);
  }, 20000);

  it('unknown engine falls back to the default music-tempo engine', async () => {
    const sr = 44100;
    const result = await detectTempo(clickTrain(120, 5, sr), sr, {engine: 'essentia'});
    // essentia is not installed → silent fallback → still a valid result.
    expect(result.bpm).toBeGreaterThan(0);
  }, 20000);
});
