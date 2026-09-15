import {describe, expect, it} from 'vitest';
import {Rational, ScoreBuilder} from '../../src/core';
import {createScoreMap} from '../../src/view/core/map';

function measuredScore(count: number) {
  const builder = new ScoreBuilder();
  for (let index = 0; index < count; index += 1) builder.addMeasure({
    id: builder.newMeasureId(), number: index + 1,
    onsetQuarters: new Rational(index * 4), durationQuarters: new Rational(4),
  });
  return builder.build();
}

describe('score-map resource boundaries', () => {
  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])('rejects non-finite budgets (%s) before constructing measure groups', (value) => {
    const score = measuredScore(1);
    expect(() => createScoreMap(score, {maxCells: value})).toThrow(RangeError);
    expect(() => createScoreMap(score, {maxMarks: value})).toThrow(RangeError);
    expect(() => createScoreMap(measuredScore(0), {maxCells: value})).toThrow(RangeError);
  });

  it('preserves rounding and the minimum finite budget', () => {
    const score = measuredScore(8);
    expect(createScoreMap(score, {maxCells: 3.5}).cells).toHaveLength(4);
    expect(createScoreMap(score, {maxCells: 0}).cells).toHaveLength(1);
    expect(createScoreMap(score, {maxCells: -10}).cells).toHaveLength(1);
  });

  it('supports more cells than the JavaScript argument limit', () => {
    const map = createScoreMap(measuredScore(150_000), {maxCells: 150_000});
    expect(map.cells).toHaveLength(150_000);
    expect(map.cells.every((cell) => cell.count === 0 && cell.density === 0)).toBe(true);
    expect(map.cells[149_999].endQuarters).toBe(600_000);
  });
});
