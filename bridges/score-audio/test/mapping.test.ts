import {describe, expect, it} from 'vitest';
import {Rational, TimeMap} from '@webmusic/score';
import {BeatGrid} from '@webmusic/audio';
import {beatGridFromTimeMap, timeMapFromBeatGrid} from '../src/mapping';

const METER = [{atQuarters: Rational.ZERO, measureNumber: 1, timeSignature: {numerator: 4, denominator: 4}}];

describe('beatGridFromTimeMap', () => {
  it('samples a constant-tempo map exactly', () => {
    const map = new TimeMap([{atQuarters: Rational.ZERO, bpm: 120}], METER);
    const grid = beatGridFromTimeMap(map, {durationQuarters: 4});
    expect(grid.beats).toHaveLength(5);
    expect(grid.beats[0]).toBeCloseTo(0, 12);
    expect(grid.beats[4]).toBeCloseTo(2, 12); // 4 quarters at 120 BPM = 2 s
    expect(grid.bpm).toBe(120);
  });

  it('folds a non-quarter beat unit into the grid bpm', () => {
    // "half = 60" — the same 120 quarters per minute as bpm 120, unit 1.
    const map = new TimeMap([{atQuarters: Rational.ZERO, bpm: 60, unit: 2}], METER);
    const grid = beatGridFromTimeMap(map, {durationQuarters: 4});

    expect(grid.beats[4]).toBeCloseTo(2, 12); // sampled beats already carry the unit
    // ...and so must bpm: reporting 60 here would contradict its own beats.
    expect(grid.bpm).toBe(120);
    expect(grid.secondsPerBeat()).toBeCloseTo(grid.beats[1] - grid.beats[0], 12);
  });

  it('captures mid-piece tempo changes at the sampled beats', () => {
    const map = new TimeMap(
      [
        {atQuarters: Rational.ZERO, bpm: 120},
        {atQuarters: new Rational(2, 1), bpm: 60},
      ],
      METER,
    );
    const grid = beatGridFromTimeMap(map, {durationQuarters: 4});
    // Quarters 0-2 at 0.5 s each, quarters 2-4 at 1 s each.
    expect(grid.beats.map((b) => Number(b.toFixed(6)))).toEqual([0, 0.5, 1, 2, 3]);
  });

  it('folds the tempo beat unit into the nominal bpm', () => {
    // "half note = 60" is 120 quarters per minute, so the sampled beats sit
    // 0.5 s apart; the grid's own bpm must agree with that spacing.
    const map = new TimeMap([{atQuarters: Rational.ZERO, bpm: 60, unit: 2}], METER);
    const grid = beatGridFromTimeMap(map, {durationQuarters: 4});
    expect(grid.beats.map((b) => Number(b.toFixed(6)))).toEqual([0, 0.5, 1, 1.5, 2]);
    expect(grid.bpm).toBe(120);
    expect(grid.secondsPerBeat()).toBeCloseTo(grid.beats[1] - grid.beats[0], 12);
  });

  it('combines the beat unit with finer subdivisions', () => {
    const map = new TimeMap([{atQuarters: Rational.ZERO, bpm: 60, unit: 2}], METER);
    const grid = beatGridFromTimeMap(map, {durationQuarters: 1, beatsPerQuarter: 2});
    expect(grid.beats).toEqual([0, 0.25, 0.5]);
    expect(grid.bpm).toBe(240);
  });

  it('supports finer beat subdivisions', () => {
    const map = new TimeMap([{atQuarters: Rational.ZERO, bpm: 120}], METER);
    const grid = beatGridFromTimeMap(map, {durationQuarters: 1, beatsPerQuarter: 2});
    expect(grid.beats).toEqual([0, 0.25, 0.5]);
    expect(grid.bpm).toBe(240);
  });

  it('does not round an exact decimal subdivision boundary up by one sample', () => {
    const map = new TimeMap([{atQuarters: Rational.ZERO, bpm: 120}], METER);
    const grid = beatGridFromTimeMap(map, {
      durationQuarters: 0.28,
      beatsPerQuarter: 25,
      maxBeats: 8,
    });
    expect(grid.beats).toHaveLength(8);
    expect(grid.beats.at(-1)).toBeCloseTo(0.14, 12);
  });

  it('rejects invalid options', () => {
    const map = new TimeMap([{atQuarters: Rational.ZERO, bpm: 120}], METER);
    expect(() => beatGridFromTimeMap(map, {durationQuarters: 0})).toThrow(RangeError);
    expect(() => beatGridFromTimeMap(map, {durationQuarters: Infinity})).toThrow(RangeError);
    expect(() => beatGridFromTimeMap(map, {durationQuarters: 1, beatsPerQuarter: 0.5})).toThrow(RangeError);
    expect(() => beatGridFromTimeMap(map, {durationQuarters: 10, maxBeats: 10})).toThrow(/maxBeats/);
    expect(() => beatGridFromTimeMap(map, {durationQuarters: 1, maxBeats: 1})).toThrow(RangeError);
  });
});

describe('timeMapFromBeatGrid', () => {
  it('reconstructs a constant-tempo timeline', () => {
    const grid = BeatGrid.fromTempo(120, 2); // 2 seconds at 120 BPM
    const map = timeMapFromBeatGrid(grid);
    expect(map.quartersToSeconds(new Rational(2, 1))).toBeCloseTo(1, 9);
  });

  it('round-trips through beatGridFromTimeMap within sampling accuracy', () => {
    const original = new TimeMap(
      [
        {atQuarters: Rational.ZERO, bpm: 100},
        {atQuarters: new Rational(3, 1), bpm: 140},
      ],
      METER,
    );
    const grid = beatGridFromTimeMap(original, {durationQuarters: 6});
    const rebuilt = timeMapFromBeatGrid(grid);
    for (let q = 0; q <= 6; q++) {
      expect(rebuilt.quartersToSeconds(new Rational(q, 1)))
        .toBeCloseTo(original.quartersToSeconds(new Rational(q, 1)), 9);
    }
  });

  it('rejects zero-length beat intervals', () => {
    expect(() => new BeatGrid({bpm: 120, beats: [0, 0.5, 0.5, 1]})).toThrow(/strictly ascending/);
  });
});
