import {isPitchedNote, noteMidi, noteVoiceString, type Note, type Part, type Score} from '../../core';
import type {Motif, MotifOptions, RhythmPattern} from './types';

/** @internal Resolve motif options consistently for one-shot and session analysis. */
export function resolveMotifOptions(opts: MotifOptions = {}): {length: number; minOccurrences: number} {
  const length = opts.length ?? 4;
  if (!Number.isSafeInteger(length) || length < 1) {
    throw new RangeError('Motif length must be a positive safe integer');
  }
  const requestedOccurrences = opts.minOccurrences ?? 2;
  if (!Number.isSafeInteger(requestedOccurrences) || requestedOccurrences < 1) {
    throw new RangeError('Motif minOccurrences must be a positive safe integer');
  }
  return {length, minOccurrences: Math.max(2, requestedOccurrences)};
}

/** A note's onset and duration in quarter notes (tempo- and ppq-independent). */
function onsetQuarters(note: Note): number {
  return note.onsetQuarters.toFloat();
}
function durationQuarters(note: Note): number {
  return note.duration.quarters.toFloat();
}
/**
 * Canonical EXACT key token for a note's notated duration ("num/den" of the
 * reduced Rational, "num" when integral). Dedupe keys must never be built from
 * floats: `offset.toFloat() - onset.toFloat()` is onset-dependent for
 * non-dyadic durations (triplet eighths yield 0.3333333333333333 at one onset
 * and 0.33333333333333337 at another), so identical notated rhythms would get
 * different keys and never group.
 */
function durationKey(note: Note): string {
  return note.duration.quarters.toString();
}

interface IndexedNote {
  note: Note;
  /** Index into the part's `notes` array (what `Motif.occurrences` reports). */
  index: number;
}

/**
 * Find repeated melodic motifs (interval + rhythm patterns).
 *
 * Windows slide along each VOICE of each part separately, so simultaneous
 * notes from different voices are never mixed into one "melody". Within a
 * voice, chord tones (notes sharing an onset) are collapsed to the highest
 * pitch. Trivial motifs (all-zero interval patterns, i.e. one repeated pitch)
 * are filtered out, and a motif is only reported when it has at least
 * `minOccurrences` (default `2`, minimum `2`) NON-overlapping occurrences.
 */
export function findMotifs(score: Score, opts: MotifOptions = {}): Motif[] {
  const {length, minOccurrences} = resolveMotifOptions(opts);
  return motifsFromEntries(
    score.parts.map((part) => partMotifEntries(part, length)),
    minOccurrences,
  );
}

/**
 * @internal One sliding-window occurrence of an (interval, rhythm) pattern
 * within a part. `key` fully determines the pattern; `occurrence` is the
 * prebuilt occurrence record the merge pushes by reference. A pure function
 * of the part and the window length, so the incremental analyzer caches the
 * entry list per Part identity and only rescans edited parts.
 */
export interface MotifEntry {
  readonly key: string;
  readonly intervals: ReadonlyArray<number>;
  readonly rhythm: ReadonlyArray<number>;
  readonly occurrence: Motif['occurrences'][number];
}

/**
 * @internal Sliding-window motif scan of ONE part, in the exact order the
 * full algorithm visits windows (voice-map insertion order, then position).
 */
export function partMotifEntries(part: Part, length: number): MotifEntry[] {
  const partId = part.id as string;
  const entries: MotifEntry[] = [];
  for (const line of voiceLines(part)) {
    const count = line.length;
    if (count < length) continue;
    // Hoist per-note projections out of the sliding window.
    const midis = new Array<number>(count);
    const durations = new Array<number>(count);
    const durationKeys = new Array<string>(count);
    for (let index = 0; index < count; index += 1) {
      midis[index] = noteMidi(line[index].note);
      durations[index] = durationQuarters(line[index].note);
      durationKeys[index] = durationKey(line[index].note);
    }
    for (let index = 0; index <= count - length; index += 1) {
      const intervals = new Array<number>(length - 1);
      let trivial = true;
      for (let offset = 1; offset < length; offset += 1) {
        const interval = midis[index + offset] - midis[index + offset - 1];
        intervals[offset - 1] = interval;
        if (interval !== 0) trivial = false;
      }
      if (trivial) continue; // trivial: repeated pitch
      const rhythm = new Array<number>(length);
      const rhythmKeys = new Array<string>(length);
      const noteIndexes = new Array<number>(length);
      for (let offset = 0; offset < length; offset += 1) {
        rhythm[offset] = durations[index + offset];
        rhythmKeys[offset] = durationKeys[index + offset];
        noteIndexes[offset] = line[index + offset].index;
      }
      entries.push({
        // Intervals are integer semitone differences (exact); rhythms are
        // keyed on exact rational durations, never on floats.
        key: `${intervals.join(',')}|${rhythmKeys.join(',')}`,
        intervals,
        rhythm,
        occurrence: {partId, startQuarters: onsetQuarters(line[index].note), noteIndexes},
      });
    }
  }
  return entries;
}

/**
 * @internal Merge per-part motif entries (in part order) into deduplicated
 * motifs and apply the `minOccurrences` filter. Iterating parts in score
 * order reproduces the global insertion order of the full algorithm, so ids
 * (`motif-N`) and occurrence order match a from-scratch `findMotifs` exactly.
 */
export function motifsFromEntries(
  entryLists: ReadonlyArray<readonly MotifEntry[]>,
  minOccurrences: number,
): Motif[] {
  const motifs = new Map<
    string,
    {
      readonly id: string;
      readonly intervals: ReadonlyArray<number>;
      readonly rhythm: ReadonlyArray<number>;
      occurrences: Array<Motif['occurrences'][number]>;
    }
  >();
  for (const entries of entryLists) {
    for (const entry of entries) {
      let motif = motifs.get(entry.key);
      if (!motif) {
        motif = {
          id: `motif-${motifs.size + 1}`,
          intervals: entry.intervals,
          rhythm: entry.rhythm,
          occurrences: [],
        };
        motifs.set(entry.key, motif);
      }
      motif.occurrences.push(entry.occurrence);
    }
  }
  // occurrences.length bounds the non-overlapping count, so the (much more
  // expensive) greedy check only runs on motifs that could possibly pass.
  return [...motifs.values()].filter(
    (motif) =>
      motif.occurrences.length >= minOccurrences &&
      nonOverlappingOccurrences(motif) >= minOccurrences,
  );
}

/**
 * Split a part's notes into monophonic lines: one per voice/continuous phrase,
 * sorted by onset, with chord tones (same onset within the voice) collapsed to
 * the highest note. Rests and unpitched percussion are phrase boundaries, not
 * melodic pitch events.
 */
function voiceLines(part: Part): IndexedNote[][] {
  const byVoice = new Map<string, IndexedNote[]>();
  [...part.notes].forEach((note, index) => {
    const voice = noteVoiceString(note) || `staff-${note.staff ?? 1}`;
    const list = byVoice.get(voice) ?? [];
    list.push({note, index});
    byVoice.set(voice, list);
  });

  const lines: IndexedNote[][] = [];
  for (const list of byVoice.values()) {
    list.sort((a, b) => onsetQuarters(a.note) - onsetQuarters(b.note));
    const line: IndexedNote[] = [];
    for (let index = 0; index < list.length; ) {
      const onset = list[index].note.onsetQuarters;
      let highest: IndexedNote | undefined;
      while (index < list.length && list[index].note.onsetQuarters.eq(onset)) {
        const entry = list[index++];
        if (isPitchedNote(entry.note) && (!highest || noteMidi(entry.note) > noteMidi(highest.note))) {
          highest = entry;
        }
      }
      if (highest) {
        line.push(highest);
      } else if (line.length > 0) {
        // Do not manufacture melodic intervals across a notated rest.
        lines.push(line.splice(0));
      }
    }
    if (line.length > 0) lines.push(line);
  }
  return lines;
}

/** Greedy count of occurrences that do not share any note with an earlier one. */
function nonOverlappingOccurrences(motif: Motif): number {
  const sorted = [...motif.occurrences].sort((a, b) => a.startQuarters - b.startQuarters);
  const used = new Set<string>();
  let count = 0;
  for (const occurrence of sorted) {
    const keys = occurrence.noteIndexes.map((index) => `${occurrence.partId}:${index}`);
    if (keys.some((key) => used.has(key))) continue;
    for (const key of keys) used.add(key);
    count += 1;
  }
  return count;
}

export function rhythmPatterns(score: Score, length = 4): RhythmPattern[] {
  if (!Number.isSafeInteger(length) || length < 1) {
    throw new RangeError('Rhythm pattern length must be a positive safe integer');
  }
  const patterns = new Map<string, RhythmPattern>();

  for (const part of score.parts) {
    const notes = [...part.notes];
    for (let index = 0; index <= notes.length - length; index += 1) {
      const slice = notes.slice(index, index + length);
      const pattern = slice.map((note) => durationQuarters(note));
      // Key on exact rational durations (see durationKey): float-keyed
      // patterns split identical non-dyadic rhythms by onset.
      const key = slice.map((note) => durationKey(note)).join(',');
      const current = patterns.get(key) ?? {pattern, count: 0, onsets: []};
      current.count += 1;
      current.onsets.push(onsetQuarters(slice[0]));
      patterns.set(key, current);
    }
  }

  return [...patterns.values()].sort((a, b) => b.count - a.count);
}
