import {describe, expect, it} from 'vitest';
import {BeatGrid, beatGridMapping} from '../../src/core';

describe('beatGridMapping', () => {
  const grid = BeatGrid.fromTempo(120, 8); // 8 seconds at 120 BPM (16 beats)
  const mapping = beatGridMapping(grid);

  it('delegates both directions to the grid', () => {
    expect(mapping.positionToSeconds(4)).toBeCloseTo(grid.beatToSeconds(4), 12);
    expect(mapping.secondsToPosition(1.25)).toBeCloseTo(grid.secondsToBeat(1.25), 12);
  });

  it('round-trips exactly on the grid span', () => {
    for (const beat of [0, 1, 3.5, 7]) {
      expect(mapping.secondsToPosition(mapping.positionToSeconds(beat))).toBeCloseTo(beat, 9);
    }
  });
});
