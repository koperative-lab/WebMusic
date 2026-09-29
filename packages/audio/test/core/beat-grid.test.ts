import {describe, expect, it} from 'vitest';
import {BeatGrid} from '../../src/core/time/BeatGrid';

describe('BeatGrid', () => {
  it('fromTempo generates a uniform grid', () => {
    const grid = BeatGrid.fromTempo(120, 4);
    expect(grid.secondsPerBeat()).toBeCloseTo(0.5);
    // beats at 0, .5, 1, 1.5, 2, 2.5, 3, 3.5, 4(.0)
    expect(grid.beats.length).toBeGreaterThanOrEqual(8);
  });

  it('maps seconds ↔ beat consistently for a uniform grid', () => {
    const grid = BeatGrid.fromTempo(120, 10);
    expect(grid.secondsToBeat(1)).toBeCloseTo(2); // 1s at 120bpm = beat 2
    expect(grid.beatToSeconds(2)).toBeCloseTo(1);
    expect(grid.secondsToBeat(grid.beatToSeconds(3.5))).toBeCloseTo(3.5, 3);
  });

  it('interpolates within an irregular grid', () => {
    const grid = new BeatGrid({bpm: 100, beats: [0, 0.6, 1.0, 1.8]});
    expect(grid.beatToSeconds(0.5)).toBeCloseTo(0.3);
    expect(grid.secondsToBeat(0.8)).toBeCloseTo(1.5, 3);
  });

  it('round-trips through JSON', () => {
    const grid = new BeatGrid({bpm: 128, beats: [0, 0.47, 0.94], downbeats: [0]});
    const back = BeatGrid.fromJSON(grid.toJSON());
    expect(back.bpm).toBe(128);
    expect(back.downbeats).toEqual([0]);
  });

  it('rejects non-finite tempo and malformed timelines without looping', () => {
    expect(() => BeatGrid.fromTempo(Number.POSITIVE_INFINITY, 4)).toThrow(/finite and positive/);
    expect(() => BeatGrid.fromTempo(Number.MIN_VALUE, 4)).toThrow(/finite beat interval/);
    expect(() => BeatGrid.fromTempo(120, Number.POSITIVE_INFINITY)).toThrow(/durationSeconds/);
    expect(() => new BeatGrid({bpm: 120, beats: [0, 0.5, 0.5, 1]})).toThrow(/strictly ascending/);
    expect(() => new BeatGrid({bpm: 120, beats: [0, Number.NaN]})).toThrow(/finite/);
    expect(() => new BeatGrid({bpm: 120, beats: [0, 1], downbeats: [0.5]})).toThrow(/also appear/);
  });
});
