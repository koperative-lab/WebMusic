import {
  DEFAULT_PPQ,
  isSoundingNote,
  noteEndSeconds,
  noteMidi,
  noteOnsetSeconds,
  noteVelocity,
  scoreDurationSeconds,
  scoreKeySignatures,
  scoreTimeSignatures,
  tickToSeconds,
  type Score,
} from '../../core';
import type {ScoreNoteSequence, ScoreSequenceNote} from './types';
import {lowerBoundByStartTime} from './windowing';

const FIFTHS_TO_MAJOR_KEY = [0, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10, 5];

/**
 * Memoized conversions, keyed by Score identity. Scores are immutable once
 * built, so the same Score always yields the same sequence; this avoids
 * re-converting the full score for every view mounted on it. Callers receive
 * a shared object and must not mutate it (no in-repo caller does).
 */
const noteSequenceCache = new WeakMap<Score, ScoreNoteSequence>();

export function scoreToNoteSequence(score: Score): ScoreNoteSequence {
  const cached = noteSequenceCache.get(score);
  if (cached) {
    return cached;
  }
  const sequence = convertScoreToNoteSequence(score);
  noteSequenceCache.set(score, sequence);
  return sequence;
}

function convertScoreToNoteSequence(score: Score): ScoreNoteSequence {
  const partIndexes = new Map(score.parts.map((part, index) => [part.id, index]));

  const notes = score.parts.flatMap((part) => {
    const partIndex = partIndexes.get(part.id) ?? 0;
    return [...part.notes]
      .filter(isSoundingNote)
      .map((note) =>
        Object.freeze({
          noteId: note.id,
          partId: part.id,
          pitch: noteMidi(note),
          velocity: Math.round(Math.max(0, Math.min(1, noteVelocity(note) / 127)) * 100),
          startTime: noteOnsetSeconds(note, score),
          endTime: noteEndSeconds(note, score),
          instrument: partIndex,
          program: partIndex,
          part: partIndex,
          voice: parseVoice(note.voice),
          staff: note.staff ?? inferStaff(noteMidi(note), part.staves),
        }),
      );
  });

  notes.sort((a, b) => a.startTime - b.startTime || a.pitch - b.pitch);
  const totalTime = notes.reduce(
    (maxEnd, note) => Math.max(maxEnd, note.endTime),
    scoreDurationSeconds(score),
  );

  return Object.freeze({
    ticksPerQuarter: DEFAULT_PPQ,
    tempos: Object.freeze(
      score.timeMap.tempi.map((t) =>
        Object.freeze({time: score.timeMap.quartersToSeconds(t.atQuarters), qpm: t.bpm * (t.unit ?? 1)}),
      ),
    ),
    timeSignatures: Object.freeze(
      scoreTimeSignatures(score).map((s) =>
        Object.freeze({
          time: tickToSeconds(score, s.tick),
          numerator: s.numerator,
          denominator: s.denominator,
        }),
      ),
    ),
    keySignatures: Object.freeze(
      scoreKeySignatures(score).map((s) =>
        Object.freeze({
          time: tickToSeconds(score, s.tick),
          key: fifthsToKey(s.fifths),
          mode: s.mode === 'minor' ? 1 : 0,
        }),
      ),
    ),
    partInfos: Object.freeze(
      score.parts.map((part, index) => Object.freeze({part: index, name: part.name})),
    ),
    notes: Object.freeze(notes),
    totalTime,
  });
}

/** Tolerance for matching a playback onset against a converted note time. */
const SEQUENCE_TIME_EPSILON = 0.000001;

/**
 * Locate the note a playback onset refers to. This runs on every noteOn, so
 * it binary-searches the run of candidates rather than scanning the score:
 * `scoreToNoteSequence` sorts by `startTime`, so every note within the
 * matching tolerance is one contiguous window.
 */
export function findSequenceNote(
  sequence: ScoreNoteSequence,
  pitch: number,
  startTime: number,
): ScoreSequenceNote | undefined {
  const notes = sequence.notes;
  if (!notes || notes.length === 0) return undefined;
  for (
    let index = lowerBoundByStartTime(notes, startTime - SEQUENCE_TIME_EPSILON);
    index < notes.length;
    index += 1
  ) {
    const note = notes[index];
    const offset = note.startTime - startTime;
    if (offset >= SEQUENCE_TIME_EPSILON) break; // past the window; the rest is later still
    if (note.pitch === pitch && Math.abs(offset) < SEQUENCE_TIME_EPSILON) return note;
  }
  return undefined;
}

/**
 * Convert nominal score seconds to quarter notes using a full tempo map,
 * accumulating quarters piecewise across every tempo segment up to `seconds`.
 * Falls back to 120 qpm when no tempo is present; clamps negative time to zero.
 * Time must be finite. Marker times must be finite and non-negative, with
 * finite positive quarter-notes-per-minute values.
 */
export function secondsToQuarters(
  tempos: ReadonlyArray<{time: number; qpm: number}>,
  seconds: number,
): number {
  if (!Number.isFinite(seconds)) throw new RangeError('Sequence time must be finite.');
  for (const tempo of tempos) {
    if (!Number.isFinite(tempo.time) || tempo.time < 0 || !Number.isFinite(tempo.qpm) || tempo.qpm <= 0) {
      throw new RangeError('Sequence tempo markers require finite non-negative times and finite positive qpm.');
    }
  }
  if (seconds <= 0) return 0;
  if (tempos.length === 0) {
    return (seconds * 120) / 60;
  }

  const sorted = getSortedTempos(tempos);
  let quarters = 0;
  let segmentStart = 0;
  // Before the first tempo marker, assume the first marker's tempo.
  let qpm = sorted[0].qpm;

  for (const tempo of sorted) {
    if (tempo.time >= seconds) break;
    if (tempo.time > segmentStart) {
      quarters += ((tempo.time - segmentStart) * qpm) / 60;
      segmentStart = tempo.time;
    }
    qpm = tempo.qpm;
  }

  if (seconds > segmentStart) {
    quarters += ((seconds - segmentStart) * qpm) / 60;
  }

  return quarters;
}

type TempoMarker = {time: number; qpm: number};

/**
 * Cache of time-sorted tempo arrays, keyed by input array identity.
 * `scoreToNoteSequence` already produces sorted tempos, so the common case is
 * a sortedness check (O(n) once) with no copy. Unsorted inputs are copied and
 * sorted exactly once per transitively frozen array. Mutable caller arrays
 * are checked and, when needed, copied and sorted on every call.
 */
const sortedTemposCache = new WeakMap<ReadonlyArray<TempoMarker>, ReadonlyArray<TempoMarker>>();

function getSortedTempos(tempos: ReadonlyArray<TempoMarker>): ReadonlyArray<TempoMarker> {
  // Only cache a transitively immutable input. Freezing the outer array is
  // insufficient because changing an entry's `time` can invalidate the
  // cached order. Mutable caller input is cheap to re-check on every call and
  // therefore always reflects its current contents.
  const cacheable = Object.isFrozen(tempos) && tempos.every((tempo) => Object.isFrozen(tempo));
  if (!cacheable) {
    return isSortedByTime(tempos) ? tempos : [...tempos].sort((a, b) => a.time - b.time);
  }
  let sorted = sortedTemposCache.get(tempos);
  if (!sorted) {
    sorted = isSortedByTime(tempos) ? tempos : [...tempos].sort((a, b) => a.time - b.time);
    sortedTemposCache.set(tempos, sorted);
  }
  return sorted;
}

function isSortedByTime(tempos: ReadonlyArray<TempoMarker>): boolean {
  for (let index = 1; index < tempos.length; index += 1) {
    if (tempos[index].time < tempos[index - 1].time) {
      return false;
    }
  }
  return true;
}

function parseVoice(voice: string | undefined): number | undefined {
  if (!voice) return undefined;
  const parsed = Number(voice);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function inferStaff(midi: number, staves: number | undefined): number | undefined {
  if (!staves || staves < 2) return undefined;
  return midi < 60 ? 2 : 1;
}

function fifthsToKey(fifths: number): number {
  const index = ((fifths % 12) + 12) % 12;
  return FIFTHS_TO_MAJOR_KEY[index] ?? 0;
}
