import {describe, expect, it} from 'vitest';
import {Duration, PartId, Pitch, Rational, ScoreBuilder, VoiceId} from '../../src/core';
import {createScoreMap} from '../../src/view';

function scoreWith(
  measures: Array<[number, number, number]>,
  notes: Array<[number, number]>,
) {
  const builder = new ScoreBuilder();
  const part = PartId('part');
  builder.addPart({id: part, name: 'Part'});
  for (const [number, start, duration] of measures) builder.addMeasure({
    id: builder.newMeasureId(), number,
    onsetQuarters: Rational.from(start), durationQuarters: Rational.from(duration),
  });
  for (const [start, duration] of notes) builder.addNote(part, {
    id: builder.newNoteId(), pitch: Pitch.parse('C4'), voice: VoiceId('voice'),
    onsetQuarters: Rational.from(start), duration: new Duration({base: Rational.from(duration)}),
  });
  return builder.build();
}

describe('whole-score map coverage', () => {
  it('includes notes beyond the final measured region', () => {
    const map = createScoreMap(scoreWith([[1, 0, 4]], [[8, 1]]));
    expect(map.durationQuarters).toBe(9);
    expect(map.cells).toEqual([
      {startQuarters: 0, endQuarters: 4, firstMeasure: 1, lastMeasure: 1, count: 0, density: 0},
      {startQuarters: 4, endQuarters: 9, count: 1, density: 1},
    ]);
  });

  it('covers leading, interior and trailing gaps without inventing measure numbers', () => {
    const map = createScoreMap(scoreWith([[12, 2, 2], [19, 6, 2]], [[0, 1], [2, 1], [4, 1], [6, 1], [9, 1]]));
    expect(map.cells.map((cell) => [cell.startQuarters, cell.endQuarters, cell.firstMeasure, cell.lastMeasure, cell.count])).toEqual([
      [0, 2, undefined, undefined, 1],
      [2, 4, 12, 12, 1],
      [4, 6, undefined, undefined, 1],
      [6, 8, 19, 19, 1],
      [8, 10, undefined, undefined, 1],
    ]);
    expect(map.marks.map((mark) => mark.label)).toEqual(['m. 12', 'm. 19']);
  });

  it.each([1, 2, 3, 4])('shares maxCells %s across measured and unmeasured spans', (maxCells) => {
    const notes: Array<[number, number]> = [[0, 1], [1, 4], [4, 2], [6, 1], [9, 1]];
    const map = createScoreMap(scoreWith([[12, 2, 2], [19, 6, 2]], notes), {maxCells});
    expect(map.cells.length).toBeLessThanOrEqual(maxCells);
    expect(map.cells[0].startQuarters).toBe(0);
    expect(map.cells[map.cells.length - 1].endQuarters).toBe(10);
    for (const [index, cell] of map.cells.entries()) {
      if (index > 0) expect(cell.startQuarters).toBe(map.cells[index - 1].endQuarters);
      expect(cell.endQuarters).toBeGreaterThan(cell.startQuarters);
      expect(cell.count).toBe(notes.filter(([start, duration]) => start < cell.endQuarters && start + duration > cell.startQuarters).length);
      if (cell.firstMeasure !== undefined) expect([12, 19]).toContain(cell.firstMeasure);
      if (cell.lastMeasure !== undefined) expect([12, 19]).toContain(cell.lastMeasure);
    }
    if (maxCells === 1) expect(map.cells[0]).toMatchObject({firstMeasure: 12, lastMeasure: 19, count: 5});
  });

  it('coalesces overlapping and nested measures into non-overlapping coverage', () => {
    const map = createScoreMap(scoreWith([[10, 0, 8], [11, 2, 2], [12, 6, 4], [20, 10, 2]], [[2, 1], [9, 2], [12, 1]]));
    expect(map.cells.map((cell) => [cell.startQuarters, cell.endQuarters, cell.firstMeasure, cell.lastMeasure, cell.count])).toEqual([
      [0, 10, 10, 12, 2],
      [10, 12, 20, 20, 1],
      [12, 13, undefined, undefined, 1],
    ]);
  });

  it('clips negative measure coverage at zero and retains zero-duration measures only as marks', () => {
    const map = createScoreMap(scoreWith([[0, -2, 4], [7, 3, 0], [8, 6, 2]], [[4, 1], [8, 1]]));
    expect(map.cells.map((cell) => [cell.startQuarters, cell.endQuarters, cell.firstMeasure, cell.count])).toEqual([
      [0, 2, 0, 0], [2, 6, undefined, 1], [6, 8, 8, 0], [8, 9, undefined, 1],
    ]);
    expect(map.marks.some((mark) => mark.label === 'm. 7')).toBe(true);
  });

  it('keeps whole-score coverage when a part filter has no matching notes', () => {
    const score = scoreWith([[1, 2, 2]], [[8, 1]]);
    const all = createScoreMap(score);
    const filtered = createScoreMap(score, {part: 'missing'});
    expect(filtered.cells.map(({startQuarters, endQuarters}) => [startQuarters, endQuarters]))
      .toEqual(all.cells.map(({startQuarters, endQuarters}) => [startQuarters, endQuarters]));
    expect(filtered.cells.every((cell) => cell.count === 0 && cell.density === 0)).toBe(true);
  });
});
