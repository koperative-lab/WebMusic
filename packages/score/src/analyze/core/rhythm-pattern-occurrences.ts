import {Rational, noteVoiceString, type Note, type Part, type Score} from '../../core';

export interface RhythmPatternOccurrenceOptions {
  /** Attacks per pattern. Default `4`. */
  length?: number;
  /** Required non-overlapping appearances. Default and minimum `2`. */
  minOccurrences?: number;
  /** Restrict the search to one score part. */
  partId?: string;
}

export interface RhythmPatternOccurrence {
  readonly partId: string;
  readonly voiceId: string;
  /** Source note IDs for every attack, including simultaneous chord members. */
  readonly noteIds: readonly string[];
  /** Written attack positions in quarter notes. */
  readonly attackQuarters: readonly number[];
  readonly startQuarters: number;
  readonly endQuarters: number;
}

export interface RhythmPatternOccurrenceGroup {
  /** Stable within one scan, not across changed scores or search options. */
  readonly id: string;
  /** Exact-keyed notated durations, exposed in quarter notes. */
  readonly durations: readonly number[];
  /** Exact-keyed distances between successive attacks, in quarter notes. */
  readonly onsetGaps: readonly number[];
  /** All appearances, including windows that overlap another appearance. */
  readonly occurrences: readonly RhythmPatternOccurrence[];
}

interface Attack {
  readonly voiceId: string;
  readonly onset: Rational;
  readonly end: Rational;
  readonly duration: Rational;
  readonly noteIds: readonly string[];
}

interface InternalOccurrence {
  readonly start: Rational;
  readonly end: Rational;
  readonly value: RhythmPatternOccurrence;
}

interface InternalGroup {
  readonly id: string;
  readonly durations: readonly number[];
  readonly onsetGaps: readonly number[];
  readonly occurrences: InternalOccurrence[];
}

function option(value: number | undefined, fallback: number, name: string): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < 1) {
    throw new RangeError(`${name} must be a positive safe integer`);
  }
  return resolved;
}

/**
 * One written attack per onset in a voice. Rests separate phrases; tied
 * continuations are not new attacks. Chord members share an attack whose
 * duration is the longest member's notated duration.
 */
function attackLines(part: Part): Attack[][] {
  const byVoice = new Map<string, Note[]>();
  for (const note of part.notes) {
    const voice = noteVoiceString(note) || `staff-${note.staff ?? 1}`;
    const notes = byVoice.get(voice) ?? [];
    notes.push(note);
    byVoice.set(voice, notes);
  }

  const lines: Attack[][] = [];
  for (const [voiceId, notes] of byVoice) {
    notes.sort((left, right) => left.onsetQuarters.cmp(right.onsetQuarters));
    let line: Attack[] = [];
    for (let index = 0; index < notes.length;) {
      const onset = notes[index].onsetQuarters;
      const members: Note[] = [];
      while (index < notes.length && notes[index].onsetQuarters.eq(onset)) members.push(notes[index++]);
      const sounding = members.filter((note) => !note.rest && note.tie !== 'continue' && note.tie !== 'stop');
      if (sounding.length > 0) {
        const end = sounding.reduce((latest, note) => note.offsetQuarters.gt(latest) ? note.offsetQuarters : latest,
          sounding[0].offsetQuarters);
        line.push({
          voiceId,
          onset,
          end,
          duration: end.sub(onset),
          noteIds: sounding.map((note) => String(note.id)),
        });
      } else if (members.some((note) => note.rest) && line.length > 0) {
        lines.push(line);
        line = [];
      }
    }
    if (line.length > 0) lines.push(line);
  }
  return lines;
}

/** Maximum number of appearances with disjoint written time spans. */
function nonOverlappingCount(occurrences: readonly InternalOccurrence[]): number {
  const sorted = [...occurrences].sort((left, right) =>
    left.end.cmp(right.end) || left.start.cmp(right.start));
  let lastEnd: Rational | undefined;
  let count = 0;
  for (const occurrence of sorted) {
    if (lastEnd && occurrence.start.lt(lastEnd)) continue;
    lastEnd = occurrence.end;
    count += 1;
  }
  return count;
}

/**
 * Find recurring notated attack patterns across a score. Unlike
 * `rhythmPatterns`, this follows each part/voice separately and retains source
 * identities and spans for playback-linked inspection. Matching requires both
 * exact rational durations and exact rational inter-onset gaps; pitch is ignored.
 * Explicit rests break a phrase, but an unnotated silent gap is part of its
 * inter-onset signature. No performed groove is inferred.
 */
export function findRhythmPatternOccurrences(
  score: Score,
  options: RhythmPatternOccurrenceOptions = {},
): RhythmPatternOccurrenceGroup[] {
  const length = option(options.length, 4, 'Rhythm pattern length');
  const minOccurrences = Math.max(2, option(options.minOccurrences, 2, 'Rhythm pattern minOccurrences'));
  const parts = options.partId === undefined
    ? score.parts
    : score.parts.filter((part) => String(part.id) === options.partId);
  if (options.partId !== undefined && parts.length === 0) {
    throw new RangeError(`Unknown rhythm pattern part: ${options.partId}`);
  }

  const groups = new Map<string, InternalGroup>();
  for (const part of parts) {
    for (const line of attackLines(part)) {
      for (let index = 0; index <= line.length - length; index += 1) {
        const attacks = line.slice(index, index + length);
        const durations = attacks.map((attack) => attack.duration);
        const gaps = attacks.slice(1).map((attack, offset) => attack.onset.sub(attacks[offset].onset));
        const key = JSON.stringify([
          durations.map((duration) => duration.toString()),
          gaps.map((gap) => gap.toString()),
        ]);
        let group = groups.get(key);
        if (!group) {
          group = {
            id: `rhythm-${groups.size + 1}`,
            durations: durations.map((duration) => duration.toFloat()),
            onsetGaps: gaps.map((gap) => gap.toFloat()),
            occurrences: [],
          };
          groups.set(key, group);
        }
        const first = attacks[0];
        const end = attacks.reduce((latest, attack) => attack.end.gt(latest) ? attack.end : latest,
          attacks[0].end);
        group.occurrences.push({
          start: first.onset,
          end,
          value: {
            partId: String(part.id),
            voiceId: first.voiceId,
            noteIds: attacks.flatMap((attack) => attack.noteIds),
            attackQuarters: attacks.map((attack) => attack.onset.toFloat()),
            startQuarters: first.onset.toFloat(),
            endQuarters: end.toFloat(),
          },
        });
      }
    }
  }
  return [...groups.values()]
    .filter((group) => nonOverlappingCount(group.occurrences) >= minOccurrences)
    .map((group) => ({
      id: group.id,
      durations: group.durations,
      onsetGaps: group.onsetGaps,
      occurrences: group.occurrences.map((occurrence) => occurrence.value),
    }));
}
