import {isSoundingNote, type Score} from '../../core';

/** One clickable time span: measures, unmeasured coverage, or a group of both. */
export interface ScoreMapCell {
  /** First display measure number covered, when the score has measures. */
  firstMeasure?: number;
  /** Last display measure number covered (equal to `firstMeasure` for one). */
  lastMeasure?: number;
  startQuarters: number;
  endQuarters: number;
  /** Sounding notes overlapping the cell. */
  count: number;
  /** `count` relative to the busiest cell, 0..1. */
  density: number;
}

/** A structural landmark on the ruler. */
export interface ScoreMapMark {
  startQuarters: number;
  label: string;
  /** Rehearsal marks, tempo and meter changes are major; plain bars minor. */
  level: 'major' | 'minor';
}

export interface ScoreMap {
  durationQuarters: number;
  cells: ScoreMapCell[];
  marks: ScoreMapMark[];
}

export interface ScoreMapOptions {
  /** Restrict the density to one part, by id or name. Default: every part. */
  part?: string;
  /** Finite cell budget, rounded and clamped to at least one. Default: 64. */
  maxCells?: number;
  /** Finite ruler budget, rounded and clamped to at least one. Major landmarks survive thinning. Default: 24. */
  maxMarks?: number;
}

interface Span {
  startQuarters: number;
  endQuarters: number;
}

type CellSpan = Span & {firstMeasure?: number; lastMeasure?: number};

function selectedNotes(score: Score, part: string | undefined): Span[] {
  const spans: Span[] = [];
  for (const candidate of score.parts) {
    if (part !== undefined && candidate.id !== part && candidate.name !== part) continue;
    for (const note of candidate.notes) {
      if (!isSoundingNote(note)) continue;
      spans.push({
        startQuarters: note.onsetQuarters.toFloat(),
        endQuarters: note.offsetQuarters.toFloat(),
      });
    }
  }
  return spans.sort((a, b) => a.startQuarters - b.startQuarters);
}

/**
 * Cover the whole non-negative score axis. Overlapping measures form one
 * span; leading, inter-measure and trailing gaps retain no invented numbers.
 * Score guarantees onset-sorted measures. Stream spans so the cell budget
 * also bounds retained geometry for very long scores.
 */
function* measureCoverage(score: Score, durationQuarters: number): Generator<CellSpan> {
  let cursor = 0;
  let pending: CellSpan | undefined;
  for (const measure of score.measures) {
    const startQuarters = Math.max(0, measure.onsetQuarters.toFloat());
    const endQuarters = Math.min(durationQuarters, measure.offsetQuarters.toFloat());
    if (endQuarters <= startQuarters) continue;
    if (pending && startQuarters < pending.endQuarters) {
      pending.endQuarters = Math.max(pending.endQuarters, endQuarters);
      pending.lastMeasure = measure.number;
      continue;
    }
    if (pending) {
      yield pending;
      cursor = pending.endQuarters;
    }
    if (cursor < startQuarters) yield {startQuarters: cursor, endQuarters: startQuarters};
    pending = {startQuarters, endQuarters, firstMeasure: measure.number, lastMeasure: measure.number};
  }
  if (pending) {
    yield pending;
    cursor = pending.endQuarters;
  }
  if (cursor < durationQuarters) yield {startQuarters: cursor, endQuarters: durationQuarters};
}

/**
 * Real measures and uncovered spans share one cell budget. Without measures,
 * retain the existing even division into at most 32 cells.
 */
function cellSpans(
  score: Score,
  durationQuarters: number,
  maxCells: number,
): CellSpan[] {
  const measures = score.measures;
  if (measures.length === 0) {
    const count = Math.min(maxCells, 32);
    const step = durationQuarters / count;
    return Array.from({length: count}, (_, index) => ({
      startQuarters: index * step,
      endQuarters: (index + 1) * step,
    }));
  }

  let coverageCount = 0;
  for (const _span of measureCoverage(score, durationQuarters)) coverageCount += 1;
  const group = Math.max(1, Math.ceil(coverageCount / maxCells));
  const spans: CellSpan[] = [];
  let index = 0;
  for (const span of measureCoverage(score, durationQuarters)) {
    if (index % group === 0) {
      spans.push({...span});
    } else {
      const target = spans[spans.length - 1]!;
      target.endQuarters = span.endQuarters;
      if (target.firstMeasure === undefined && span.firstMeasure !== undefined) target.firstMeasure = span.firstMeasure;
      if (span.lastMeasure !== undefined) target.lastMeasure = span.lastMeasure;
    }
    index += 1;
  }
  return spans;
}

function marksFor(score: Score, maxMarks: number): ScoreMapMark[] {
  const measures = score.measures;
  if (measures.length === 0) return [];

  // A landmark carries information a plain bar line does not, so it survives
  // the thinning that keeps a 400-bar score's ruler readable.
  const landmark = (index: number): string | undefined => {
    const measure = measures[index]!;
    if (measure.rehearsal) return measure.rehearsal;
    if (measure.tempo || measure.timeSignature) return `m. ${measure.number}`;
    return undefined;
  };

  const landmarks = measures.reduce(
    (total, _measure, index) => (landmark(index) === undefined ? total : total + 1),
    0,
  );
  const step = Math.max(1, Math.ceil((measures.length - landmarks) / Math.max(1, maxMarks - landmarks)));

  const marks: ScoreMapMark[] = [];
  measures.forEach((measure, index) => {
    const label = landmark(index);
    if (label === undefined && index % step !== 0) return;
    marks.push({
      startQuarters: measure.onsetQuarters.toFloat(),
      label: label ?? `m. ${measure.number}`,
      level: label === undefined ? 'minor' : 'major',
    });
  });
  return marks;
}

/** Index of the first cell that ends after `quarters` (binary search). */
function firstOverlappingCell(spans: readonly Span[], quarters: number): number {
  let low = 0;
  let high = spans.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (spans[middle]!.endQuarters > quarters) high = middle;
    else low = middle + 1;
  }
  return low;
}

/**
 * Project a whole score onto one navigable strip: where the notes are, where
 * the bars and rehearsal marks are, and nothing else. Deliberately cheap —
 * no analysis, no engraving, no per-note geometry — so it can front a score
 * that is far too long to render at once.
 */
export function createScoreMap(score: Score, options: ScoreMapOptions = {}): ScoreMap {
  const durationQuarters = score.durationQuarters.toFloat();
  const maxCells = finiteBudget(options.maxCells ?? 64, 'maxCells');
  const maxMarks = finiteBudget(options.maxMarks ?? 24, 'maxMarks');
  if (!(durationQuarters > 0)) return {durationQuarters: 0, cells: [], marks: []};

  const notes = selectedNotes(score, options.part);
  const spans = cellSpans(score, durationQuarters, maxCells);
  // Cells are contiguous and ascending, so each note is placed by locating
  // its first cell and walking forward — a filter per cell would re-scan
  // every note once per cell, which the long scores this element exists for
  // cannot afford.
  const counts = new Array<number>(spans.length).fill(0);
  for (const note of notes) {
    // A zero-length note is a point, not an overlapping span. Handle it
    // separately so an onset inside a cell is counted exactly once.
    if (note.endQuarters <= note.startQuarters) {
      const cell = Math.min(firstOverlappingCell(spans, note.startQuarters), spans.length - 1);
      if (cell >= 0) counts[cell]! += 1;
      continue;
    }
    let index = firstOverlappingCell(spans, note.startQuarters);
    for (; index < spans.length && spans[index]!.startQuarters < note.endQuarters; index += 1) {
      counts[index]! += 1;
    }
  }
  let busiest = 0;
  for (const count of counts) busiest = Math.max(busiest, count);

  return {
    durationQuarters,
    cells: spans.map((span, index) => ({
      ...span,
      count: counts[index]!,
      density: busiest > 0 ? counts[index]! / busiest : 0,
    })),
    marks: marksFor(score, maxMarks),
  };
}

function finiteBudget(value: number, name: string): number {
  if (!Number.isFinite(value)) throw new RangeError(`Score map ${name} must be finite.`);
  return Math.max(1, Math.round(value));
}
