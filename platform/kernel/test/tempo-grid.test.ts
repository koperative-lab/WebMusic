import {describe, expect, it} from 'vitest';
import {
  TempoClock, TransportClock, createTempoGrid, snapToTempoGrid, tapTempo, tempoGridBeatPosition, tempoGridJump,
  tempoGridLines, tempoGridMapping, tempoGridPosition,
} from '../src/transport';

describe('TempoGrid', () => {
  it('validates and freezes a grid with 4/4 and anchor 0 by default', () => {
    const grid = createTempoGrid({bpm: 120});
    expect(grid).toEqual({bpm: 120, anchor: 0, beatsPerBar: 4});
    expect(Object.isFrozen(grid)).toBe(true);
    expect(() => createTempoGrid({bpm: 0})).toThrow(RangeError);
    expect(() => createTempoGrid({bpm: 1001})).toThrow(RangeError);
    expect(() => createTempoGrid({bpm: 120, anchor: Number.NaN})).toThrow(RangeError);
    expect(() => createTempoGrid({bpm: 120, beatsPerBar: 2.5})).toThrow(RangeError);
  });

  it('reports beat, bar, beat in bar and phase on both sides of the anchor', () => {
    const grid = createTempoGrid({bpm: 120, anchor: 1, beatsPerBar: 4});
    expect(tempoGridPosition(grid, 1)).toEqual({beat: 0, bar: 0, beatInBar: 0, phase: 0});
    const later = tempoGridPosition(grid, 1 + 0.5 * 5 + 0.125);
    expect(later.bar).toBe(1);
    expect(later.beatInBar).toBe(1);
    expect(later.phase).toBeCloseTo(0.25);
    const earlier = tempoGridPosition(grid, 0.75);
    expect(earlier.bar).toBe(-1);
    expect(earlier.beatInBar).toBe(3);
    expect(earlier.phase).toBeCloseTo(0.5);
    expect(tempoGridBeatPosition(grid, 3)).toBeCloseTo(2.5);
  });

  it('snaps to beats or subdivisions in each direction', () => {
    const grid = createTempoGrid({bpm: 60, anchor: 0.2});
    expect(snapToTempoGrid(grid, 1.6)).toBeCloseTo(1.2);
    expect(snapToTempoGrid(grid, 1.3, {direction: 'forward'})).toBeCloseTo(2.2);
    expect(snapToTempoGrid(grid, 1.9, {direction: 'backward'})).toBeCloseTo(1.2);
    expect(snapToTempoGrid(grid, 1.6, {division: 2})).toBeCloseTo(1.7);
    expect(snapToTempoGrid(grid, 2.2, {direction: 'forward'})).toBeCloseTo(2.2);
  });

  it('keeps the beat phase across a quantized jump', () => {
    const grid = createTempoGrid({bpm: 120});
    // From a quarter into beat 3, jump near beat 10: land a quarter into beat 10.
    expect(tempoGridJump(grid, 1.5 + 0.125, 4.9)).toBeCloseTo(5.125);
  });

  it('lists grid lines in a window and marks downbeats', () => {
    const grid = createTempoGrid({bpm: 120, beatsPerBar: 3});
    const lines = tempoGridLines(grid, 0, 2);
    expect(lines.map((line) => line.beat)).toEqual([0, 1, 2, 3, 4]);
    expect(lines.filter((line) => line.downbeat).map((line) => line.beat)).toEqual([0, 3]);
    expect(tempoGridLines(grid, 0, 0.5, 2).map((line) => line.position)).toEqual([0, 0.25, 0.5]);
  });

  it('maps beats to positions as a TimelineMapping', () => {
    const mapping = tempoGridMapping(createTempoGrid({bpm: 90, anchor: 0.5}));
    expect(mapping.positionToSeconds(3)).toBeCloseTo(2.5);
    expect(mapping.secondsToPosition(2.5)).toBeCloseTo(3);
  });

  it('estimates tap tempo from the latest run of taps', () => {
    expect(tapTempo([1])).toBeUndefined();
    expect(tapTempo([0, 0.5, 1, 1.5])).toBeCloseTo(120);
    // A gap longer than the reset starts a new run.
    expect(tapTempo([0, 0.5, 10, 10.6, 11.2])).toBeCloseTo(100);
    // The median ignores one late tap.
    expect(tapTempo([0, 0.5, 1, 1.7, 2.2])).toBeCloseTo(120);
  });
});

describe('TempoClock', () => {
  it('reads beats from a transport clock at its rate', () => {
    const clock = new TransportClock();
    clock.start(10, 0);
    const tempo = new TempoClock(clock, createTempoGrid({bpm: 120}));
    expect(tempo.beatAt(11)).toBeCloseTo(2);
    clock.setRate(2, 11);
    expect(tempo.beatAt(12)).toBeCloseTo(6);
    expect(tempo.effectiveBpm).toBe(240);
  });

  it('returns the reference time of the next grid line and of a beat', () => {
    const clock = new TransportClock();
    clock.start(100, 0.1);
    const tempo = new TempoClock(clock, createTempoGrid({bpm: 120}));
    expect(tempo.nextGridTime(100)).toBeCloseTo(100.4);
    expect(tempo.nextGridTime(100.4)).toBeCloseTo(100.9);
    expect(tempo.nextGridTime(100, 4)).toBeCloseTo(100.025);
    expect(tempo.timeAtBeat(4)).toBeCloseTo(101.9);
  });

  it('cannot schedule against a paused clock and swaps grids without touching the clock', () => {
    const clock = new TransportClock();
    const tempo = new TempoClock(clock, createTempoGrid({bpm: 120}));
    expect(() => tempo.nextGridTime(0)).toThrow(RangeError);
    const next = tempo.withGrid(createTempoGrid({bpm: 60}));
    expect(next.clock).toBe(clock);
    expect(next.grid.bpm).toBe(60);
    expect(tempo.grid.bpm).toBe(120);
  });
});
