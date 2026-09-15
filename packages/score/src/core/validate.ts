import type {Score} from './model/Score';
import type {Measure} from './model/Measure';
import {Rational} from './primitives/Rational';
import {
  hasTimeMapExplicitEntryOrigins,
  isExplicitMeterEntry,
  isExplicitTempoEntry,
  type MeterEntry,
  type TempoEntry,
} from './time/TimeMap';

/** A machine-readable category for a score-integrity diagnostic. */
export type ScoreValidationIssueCode =
  | 'duplicate-part-id'
  | 'duplicate-measure-id'
  | 'duplicate-measure-number'
  | 'duplicate-note-id'
  | 'measure-grid-same-onset'
  | 'measure-grid-overlap'
  | 'duplicate-time-map-tempo-position'
  | 'duplicate-time-map-meter-position'
  | 'time-map-measure-snapshot-mismatch'
  | 'measure-tempo-missing-time-map-entry'
  | 'measure-time-signature-missing-time-map-entry'
  | 'measure-tempo-time-map-mismatch'
  | 'measure-time-signature-time-map-mismatch';

/**
 * A non-mutating integrity diagnostic for a Score.
 *
 * Constructors intentionally stay permissive so callers can incrementally
 * assemble or inspect imperfect source material. Use this at ownership and
 * serialization boundaries where id lookups and a single unambiguous timeline
 * are required.
 */
export interface ScoreValidationIssue {
  readonly code: ScoreValidationIssueCode;
  readonly message: string;
}

function issue(code: ScoreValidationIssueCode, message: string): ScoreValidationIssue {
  return Object.freeze({code, message});
}

function entryAtPosition<T extends TempoEntry | MeterEntry>(
  entries: ReadonlyArray<T>,
  position: Rational,
): T | undefined {
  return entries.find((entry) => position.eq(entry.atQuarters));
}

function matchesMeasureTempo(entry: TempoEntry, measure: Measure): boolean {
  const tempo = measure.tempo;
  return tempo !== undefined && entry.bpm === tempo.bpm && (entry.unit ?? 1) === (tempo.unit ?? 1);
}

function matchesMeasureMeter(entry: MeterEntry, measure: Measure): boolean {
  const timeSignature = measure.timeSignature;
  return timeSignature !== undefined &&
    entry.measureNumber === measure.number &&
    entry.timeSignature.numerator === timeSignature.numerator &&
    entry.timeSignature.denominator === timeSignature.denominator;
}

function findDuplicatePositions(
  entries: ReadonlyArray<TempoEntry | MeterEntry>,
  code: 'duplicate-time-map-tempo-position' | 'duplicate-time-map-meter-position',
  label: 'tempo' | 'meter',
  issues: ScoreValidationIssue[],
): void {
  const firstAtPosition = new Set<string>();
  for (const entry of entries) {
    const position = entry.atQuarters.toString();
    if (firstAtPosition.has(position)) {
      issues.push(issue(code, `TimeMap has more than one ${label} entry at quarter ${position}`));
    } else {
      firstAtPosition.add(position);
    }
  }
}

function hasMatchingMeasureSnapshot(score: Score): boolean {
  const snapshots = score.timeMap.measures;
  if (!snapshots) return score.measures.length === 0;
  if (snapshots.length !== score.measures.length) return false;
  return snapshots.every((snapshot, index) => {
    const measure = score.measures[index];
    return (
      snapshot.number === measure.number &&
      snapshot.onsetQuarters.eq(measure.onsetQuarters) &&
      snapshot.durationQuarters.eq(measure.durationQuarters)
    );
  });
}

function validateMeasureGrid(measures: ReadonlyArray<Measure>, issues: ScoreValidationIssue[]): void {
  let previous: Measure | undefined;
  let furthestEnding: Measure | undefined;

  for (const measure of measures) {
    const sameOnset = previous?.onsetQuarters.eq(measure.onsetQuarters) ?? false;
    if (sameOnset) {
      issues.push(
        issue(
          'measure-grid-same-onset',
          `Measures "${previous!.id}" and "${measure.id}" start at the same quarter ${measure.onsetQuarters}`,
        ),
      );
    } else if (furthestEnding && measure.onsetQuarters.lt(furthestEnding.offsetQuarters)) {
      issues.push(
        issue(
          'measure-grid-overlap',
          `Measure "${measure.id}" starts at quarter ${measure.onsetQuarters} before measure "${furthestEnding.id}" ends at quarter ${furthestEnding.offsetQuarters}`,
        ),
      );
    }

    if (!furthestEnding || measure.offsetQuarters.gt(furthestEnding.offsetQuarters)) {
      furthestEnding = measure;
    }
    previous = measure;
  }
}

/**
 * Report score-level ambiguity without mutating the Score.
 *
 * This intentionally does not validate musical content such as notes outside
 * a measure: imported MIDI commonly has no measure grid at all. It focuses on
 * conditions that make identifiers, time-map lookup, or the measure timeline
 * ambiguous for every consumer.
 */
export function validateScore(score: Score): ReadonlyArray<ScoreValidationIssue> {
  const issues: ScoreValidationIssue[] = [];

  const partsById = new Set<string>();
  const notesById = new Map<string, string>();
  for (const part of score.parts) {
    if (partsById.has(part.id)) {
      issues.push(issue('duplicate-part-id', `Duplicate part id "${part.id}"`));
    } else {
      partsById.add(part.id);
    }

    for (const note of part.notes) {
      const firstPartId = notesById.get(note.id);
      if (firstPartId !== undefined) {
        issues.push(
          issue(
            'duplicate-note-id',
            `Duplicate note id "${note.id}" appears in both part "${firstPartId}" and part "${part.id}"`,
          ),
        );
      } else {
        notesById.set(note.id, part.id);
      }
    }
  }

  const measuresById = new Set<string>();
  const measuresByNumber = new Map<number, string>();
  for (const measure of score.measures) {
    if (measuresById.has(measure.id)) {
      issues.push(issue('duplicate-measure-id', `Duplicate measure id "${measure.id}"`));
    } else {
      measuresById.add(measure.id);
    }

    const firstMeasureId = measuresByNumber.get(measure.number);
    if (firstMeasureId !== undefined) {
      issues.push(
        issue(
          'duplicate-measure-number',
          `Measures "${firstMeasureId}" and "${measure.id}" share display number ${measure.number}; Measure:Beat:Subbeat is ambiguous`,
        ),
      );
    } else {
      measuresByNumber.set(measure.number, measure.id);
    }
  }

  validateMeasureGrid(score.measures, issues);

  findDuplicatePositions(
    score.timeMap.tempi,
    'duplicate-time-map-tempo-position',
    'tempo',
    issues,
  );
  findDuplicatePositions(
    score.timeMap.meters,
    'duplicate-time-map-meter-position',
    'meter',
    issues,
  );

  if (!hasMatchingMeasureSnapshot(score)) {
    issues.push(
      issue(
        'time-map-measure-snapshot-mismatch',
        'TimeMap measure snapshots do not match score.measures',
      ),
    );
  }

  const hasTimelineProvenance = hasTimeMapExplicitEntryOrigins(score.timeMap);
  for (const measure of score.measures) {
    if (measure.tempo) {
      const entry = entryAtPosition(score.timeMap.tempi, measure.onsetQuarters);
      if (!entry) {
        issues.push(
          issue(
            'measure-tempo-missing-time-map-entry',
            `Measure "${measure.id}" declares a tempo at quarter ${measure.onsetQuarters}, but TimeMap has no tempo entry there`,
          ),
        );
      } else if (
        hasTimelineProvenance &&
        !isExplicitTempoEntry(score.timeMap, entry) &&
        !matchesMeasureTempo(entry, measure)
      ) {
        issues.push(
          issue(
            'measure-tempo-time-map-mismatch',
            `Measure "${measure.id}" declares tempo ${measure.tempo.bpm} bpm (unit ${measure.tempo.unit ?? 1}) at quarter ${measure.onsetQuarters}, but its inferred TimeMap entry is ${entry.bpm} bpm (unit ${entry.unit ?? 1})`,
          ),
        );
      }
    }
    if (measure.timeSignature) {
      const entry = entryAtPosition(score.timeMap.meters, measure.onsetQuarters);
      if (!entry) {
        issues.push(
          issue(
            'measure-time-signature-missing-time-map-entry',
            `Measure "${measure.id}" declares a time signature at quarter ${measure.onsetQuarters}, but TimeMap has no meter entry there`,
          ),
        );
      } else if (
        hasTimelineProvenance &&
        !isExplicitMeterEntry(score.timeMap, entry) &&
        !matchesMeasureMeter(entry, measure)
      ) {
        issues.push(
          issue(
            'measure-time-signature-time-map-mismatch',
            `Measure "${measure.id}" declares ${measure.timeSignature.numerator}/${measure.timeSignature.denominator} as measure ${measure.number} at quarter ${measure.onsetQuarters}, but its inferred TimeMap entry is ${entry.timeSignature.numerator}/${entry.timeSignature.denominator} as measure ${entry.measureNumber}`,
          ),
        );
      }
    }
  }

  return Object.freeze(issues);
}

/** Throw a clear error if a Score is structurally ambiguous. */
export function assertValidScore(score: Score): void {
  const issues = validateScore(score);
  if (issues.length === 0) return;
  throw new Error(`Score integrity validation failed: ${issues.map(({message}) => message).join('; ')}`);
}
