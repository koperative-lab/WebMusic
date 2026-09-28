import {Rational, isPitchedNote, type Score} from '../../../core';
import {spellChordNotes, type Key, type SpellingPreference} from '../../core';
import type {FlowLaneView} from '../../headless/workbench';

interface Cell {
  start: Rational;
  end: Rational;
}

const MAX_VIRTUAL_MEASURES = 10000;

function splitMeasure(score: Score, start: Rational, end: Rational): Cell[] {
  const last = end.gt(score.durationQuarters) ? score.durationQuarters : end;
  if (!last.gt(start)) return [];

  const meter = score.timeMap.timeSignatureAt(start);
  if (meter.numerator < 2) return [{start, end: last}];
  const beat = new Rational(4, meter.denominator);
  const division = start.add(beat.mul(new Rational(Math.floor(meter.numerator / 2))));
  return division.gt(start) && division.lt(last)
    ? [{start, end: division}, {start: division, end: last}]
    : [{start, end: last}];
}

function cellsFor(score: Score): Cell[] {
  const duration = score.durationQuarters.toFloat();
  if (duration <= 0) return [];

  if (score.measures.length > 0) {
    const cells: Cell[] = [];
    let cursor = Rational.ZERO;
    for (const measure of [...score.measures].sort((a, b) => a.onsetQuarters.cmp(b.onsetQuarters))) {
      if (measure.onsetQuarters.gt(cursor)) {
        cells.push(...splitMeasure(score, cursor, measure.onsetQuarters));
      }
      const start = measure.onsetQuarters.gt(cursor) ? measure.onsetQuarters : cursor;
      cells.push(...splitMeasure(score, start, measure.offsetQuarters));
      if (measure.offsetQuarters.gt(cursor)) cursor = measure.offsetQuarters;
    }
    if (cursor.lt(score.durationQuarters)) cells.push(...splitMeasure(score, cursor, score.durationQuarters));
    return cells;
  }

  const cells: Cell[] = [];
  let measure = score.timeMap.quartersToMBS(Rational.ZERO).measure;
  for (let count = 0; count < MAX_VIRTUAL_MEASURES; count += 1, measure += 1) {
    const start = score.timeMap.mbsToQuarters({measure, beat: 1, subbeat: Rational.ZERO});
    if (start.toFloat() >= duration) break;
    const end = score.timeMap.mbsToQuarters({measure: measure + 1, beat: 1, subbeat: Rational.ZERO});
    if (!end.gt(start)) break;
    cells.push(...splitMeasure(score, start, end));
  }
  const tail = cells.length > 0 ? cells[cells.length - 1]!.end : Rational.ZERO;
  if (tail.lt(score.durationQuarters)) cells.push(...splitMeasure(score, tail, score.durationQuarters));
  return cells;
}

/** A bounded visual reading of score-wide notes, not a rewrite of raw chord events. */
export function projectChordCells(
  score: Score,
  lane: FlowLaneView,
  options: {spelling: SpellingPreference; key?: Key},
): FlowLaneView {
  const notes = score.notes.filter(isPitchedNote);
  const bands = cellsFor(score).map(({start, end}, index) => {
    const present = notes.filter((note) => note.onsetQuarters.lt(end)
      && note.offsetQuarters.gt(start));
    const reading = spellChordNotes(present, options);
    return {
      id: `chord-cell-${index}`,
      start: score.timeMap.quartersToSeconds(start),
      end: score.timeMap.quartersToSeconds(end),
      stampStart: start.toFloat(),
      stampEnd: end.toFloat(),
      track: 0,
      primary: present.length > 0 ? reading.label : undefined,
      tone: reading.primary?.rootPitchClass,
      weight: 1,
      disabled: present.length === 0,
    };
  });
  return {...lane, bands};
}
