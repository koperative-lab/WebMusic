import {
  isPitchedNote,
  Pitch,
  type Note,
  type Part,
  type Score,
  type Step,
} from "../../core";

export type IntervalPitchMode = "written" | "sounding";

/** Select notes by ID, lane, or a half-open quarter-note range. Filters combine. */
export interface IntervalSelection {
  readonly noteIds?: ReadonlyArray<string>;
  readonly partId?: string;
  readonly voiceId?: string;
  readonly fromQuarters?: number;
  readonly toQuarters?: number;
}

export interface IntervalAnalysisOptions {
  /** Written spelling by default; sounding mode applies each part's transposition. */
  readonly pitchMode?: IntervalPitchMode;
}

export interface IntervalEvidence {
  readonly noteId: string;
  readonly partId: string;
  readonly voiceId: string;
  readonly onsetQuarters: number;
  readonly offsetQuarters: number;
  /** The score's authored spelling, regardless of `pitchMode`. */
  readonly writtenPitch: string;
  /** Spelling used to calculate this interval. */
  readonly pitch: string;
}

export interface AnalyzedInterval {
  /** Stable for this pair of score note identities and interval kind. */
  readonly id: string;
  readonly kind: "melodic" | "harmonic";
  /** Spelled interval, using the score's chord-style notation (`3M`, `5P`). */
  readonly label: string;
  readonly number: number;
  readonly quality: string;
  /** Signed for melodic motion; non-negative for vertical harmony. */
  readonly semitones: number;
  readonly direction: "ascending" | "descending" | "stationary" | "vertical";
  /** Melodic onset span, or the sounding overlap of a harmonic pair, in quarters. */
  readonly startQuarters: number;
  readonly endQuarters: number;
  /** Chronological for melody; lower to upper pitch for harmony. */
  readonly evidence: readonly [IntervalEvidence, IntervalEvidence];
}

export interface IntervalAnalysis {
  readonly pitchMode: IntervalPitchMode;
  readonly intervals: ReadonlyArray<AnalyzedInterval>;
}

interface Candidate {
  readonly note: Note;
  readonly part: Part;
  readonly pitch: Pitch;
  readonly evidence: IntervalEvidence;
  readonly partIndex: number;
  readonly noteIndex: number;
}

const STEPS = "CDEFGAB";
const NATURAL_SEMITONES = [0, 2, 4, 5, 7, 9, 11] as const;

function spelling(pitch: Pitch, part: Part, mode: IntervalPitchMode): Pitch {
  if (mode === "written" || !part.transpose) return pitch;
  const { chromatic, diatonic, octaveChange = 0 } = part.transpose;
  const targetMidi = pitch.midi + chromatic + 12 * octaveChange;
  if (diatonic === undefined) return Pitch.fromMidi(targetMidi);

  // A MusicXML diatonic hint preserves the intended letter through a
  // transposition; MIDI-only conversion would turn, for example, Eb into D#.
  const position =
    pitch.octave * 7 + STEPS.indexOf(pitch.step) + diatonic + 7 * octaveChange;
  const octave = Math.floor(position / 7);
  const step = STEPS[((position % 7) + 7) % 7] as Step;
  const alter = targetMidi - ((octave + 1) * 12 + Pitch.STEP_TO_SEMITONE[step]);
  return Number.isSafeInteger(alter) && alter >= -2 && alter <= 2
    ? new Pitch(step, alter as -2 | -1 | 0 | 1 | 2, octave)
    : Pitch.fromMidi(targetMidi);
}

function intervalName(
  from: Pitch,
  to: Pitch,
): { number: number; quality: string; label: string } {
  const letterDistance =
    (to.octave - from.octave) * 7 +
    STEPS.indexOf(to.step) -
    STEPS.indexOf(from.step);
  const number = Math.abs(letterDistance) + 1;
  const base =
    NATURAL_SEMITONES[(number - 1) % 7]! + 12 * Math.floor((number - 1) / 7);
  const semitones = to.midi - from.midi;
  const chromaticDistance =
    letterDistance === 0
      ? Math.abs(semitones)
      : semitones * Math.sign(letterDistance);
  const alteration = chromaticDistance - base;
  const perfectClass = [0, 3, 4].includes((number - 1) % 7);
  let quality: string;
  if (perfectClass) {
    quality =
      alteration === 0
        ? "P"
        : alteration > 0
          ? "A".repeat(alteration)
          : "d".repeat(-alteration);
  } else {
    quality =
      alteration === 0
        ? "M"
        : alteration === -1
          ? "m"
          : alteration > 0
            ? "A".repeat(alteration)
            : "d".repeat(-alteration - 1);
  }
  return { number, quality, label: `${number}${quality}` };
}

function identity(
  kind: AnalyzedInterval["kind"],
  first: Candidate,
  second: Candidate,
): string {
  return JSON.stringify([
    kind,
    first.part.id,
    first.note.id,
    second.part.id,
    second.note.id,
  ]);
}

function melodicInterval(
  first: Candidate,
  second: Candidate,
): AnalyzedInterval {
  const semitones = second.pitch.midi - first.pitch.midi;
  return {
    id: identity("melodic", first, second),
    kind: "melodic",
    ...intervalName(first.pitch, second.pitch),
    semitones,
    direction:
      semitones > 0 ? "ascending" : semitones < 0 ? "descending" : "stationary",
    startQuarters: first.evidence.onsetQuarters,
    endQuarters: second.evidence.onsetQuarters,
    evidence: [first.evidence, second.evidence],
  };
}

function harmonicInterval(
  first: Candidate,
  second: Candidate,
  from: number,
  to: number,
): AnalyzedInterval {
  const lower =
    first.pitch.midi < second.pitch.midi ||
    (first.pitch.midi === second.pitch.midi &&
      first.pitch.octave * 7 + STEPS.indexOf(first.pitch.step) <=
        second.pitch.octave * 7 + STEPS.indexOf(second.pitch.step))
      ? first
      : second;
  const upper = lower === first ? second : first;
  return {
    id: identity("harmonic", first, second),
    kind: "harmonic",
    ...intervalName(lower.pitch, upper.pitch),
    semitones: upper.pitch.midi - lower.pitch.midi,
    direction: "vertical",
    startQuarters: Math.max(
      first.evidence.onsetQuarters,
      second.evidence.onsetQuarters,
      from,
    ),
    endQuarters: Math.min(
      first.evidence.offsetQuarters,
      second.evidence.offsetQuarters,
      to,
    ),
    evidence: [lower.evidence, upper.evidence],
  };
}

function validate(selection: IntervalSelection, mode: IntervalPitchMode): void {
  if (mode !== "written" && mode !== "sounding")
    throw new TypeError("interval pitchMode must be written or sounding");
  if (!selection || typeof selection !== "object")
    throw new TypeError("interval selection is required");
  if (
    selection.noteIds === undefined &&
    selection.partId === undefined &&
    selection.voiceId === undefined &&
    selection.fromQuarters === undefined &&
    selection.toQuarters === undefined
  ) {
    throw new TypeError(
      "interval selection needs noteIds, a part/voice, or a quarter range",
    );
  }
  if (
    selection.noteIds !== undefined &&
    (!Array.isArray(selection.noteIds) ||
      !selection.noteIds.every((id) => typeof id === "string"))
  ) {
    throw new TypeError("interval noteIds must be an array of strings");
  }
  if (
    (selection.fromQuarters === undefined) !==
    (selection.toQuarters === undefined)
  ) {
    throw new TypeError(
      "interval range needs both fromQuarters and toQuarters",
    );
  }
  if (
    selection.fromQuarters !== undefined &&
    selection.toQuarters !== undefined &&
    (!Number.isFinite(selection.fromQuarters) ||
      !Number.isFinite(selection.toQuarters) ||
      selection.toQuarters < selection.fromQuarters)
  ) {
    throw new RangeError("interval range must be finite and ordered");
  }
}

/**
 * Inspect selected score notes without changing score state. Consecutive
 * pitched onsets in one voice make melodic intervals; pairs sounding at once
 * make harmonic intervals, including chord members in one voice. Explicit
 * rests and unpitched-only onsets interrupt melodic continuity.
 * Harmonic output is pairwise: at most n(n-1)/2 records for n selected pitched
 * notes. Narrow a range or select notes/voices when inspecting dense scores.
 */
export function analyzeIntervals(
  score: Score,
  selection: IntervalSelection,
  options: IntervalAnalysisOptions = {},
): IntervalAnalysis {
  const pitchMode = options.pitchMode ?? "written";
  validate(selection, pitchMode);
  const noteIds =
    selection.noteIds === undefined ? undefined : new Set(selection.noteIds);
  const from = selection.fromQuarters ?? -Infinity;
  const to = selection.toQuarters ?? Infinity;
  if (from === to || noteIds?.size === 0) return { pitchMode, intervals: [] };

  const melodic = new Map<Note, Candidate>();
  const harmonic: Candidate[] = [];
  for (const [partIndex, part] of score.parts.entries()) {
    if (selection.partId !== undefined && selection.partId !== part.id)
      continue;
    for (const [noteIndex, note] of part.notes.entries()) {
      if (
        !isPitchedNote(note) ||
        (selection.voiceId !== undefined && selection.voiceId !== note.voice) ||
        (noteIds !== undefined && !noteIds.has(note.id))
      )
        continue;
      const onset = note.onsetQuarters.toFloat();
      const offset = note.offsetQuarters.toFloat();
      const pitch = spelling(note.pitch, part, pitchMode);
      const candidate: Candidate = {
        note,
        part,
        pitch,
        partIndex,
        noteIndex,
        evidence: {
          noteId: note.id,
          partId: part.id,
          voiceId: note.voice,
          onsetQuarters: onset,
          offsetQuarters: offset,
          writtenPitch: note.pitch.toString(),
          pitch: pitch.toString(),
        },
      };
      if (onset >= from && onset < to) melodic.set(note, candidate);
      if (onset < to && offset > from) harmonic.push(candidate);
    }
  }

  const intervals: AnalyzedInterval[] = [];
  for (const part of score.parts) {
    if (selection.partId !== undefined && selection.partId !== part.id)
      continue;
    const voices = new Map<string, Note[]>();
    for (const note of part.notes) {
      if (selection.voiceId !== undefined && selection.voiceId !== note.voice)
        continue;
      const lane = voices.get(note.voice) ?? [];
      lane.push(note);
      voices.set(note.voice, lane);
    }
    for (const notes of voices.values()) {
      let previous: Candidate | undefined;
      for (let index = 0; index < notes.length;) {
        const onset = notes[index]!.onsetQuarters;
        let hasPitched = false;
        let current: Candidate | undefined;
        while (index < notes.length && notes[index]!.onsetQuarters.eq(onset)) {
          const note = notes[index++]!;
          if (isPitchedNote(note)) {
            hasPitched = true;
            current ??= melodic.get(note);
          }
        }
        if (!hasPitched) previous = undefined;
        else if (current) {
          if (previous) intervals.push(melodicInterval(previous, current));
          previous = current;
        }
      }
    }
  }

  harmonic.sort(
    (a, b) =>
      a.note.onsetQuarters.cmp(b.note.onsetQuarters) ||
      a.partIndex - b.partIndex ||
      a.noteIndex - b.noteIndex,
  );
  let active: Candidate[] = [];
  for (const candidate of harmonic) {
    active = active.filter((other) =>
      other.note.offsetQuarters.gt(candidate.note.onsetQuarters),
    );
    for (const other of active) {
      if (
        other.part.id === candidate.part.id &&
        other.note.voice === candidate.note.voice &&
        !other.note.onsetQuarters.eq(candidate.note.onsetQuarters)
      )
        continue;
      const interval = harmonicInterval(other, candidate, from, to);
      if (interval.endQuarters > interval.startQuarters)
        intervals.push(interval);
    }
    active.push(candidate);
  }

  intervals.sort(
    (a, b) =>
      a.startQuarters - b.startQuarters ||
      (a.kind === b.kind ? 0 : a.kind === "harmonic" ? -1 : 1) ||
      a.endQuarters - b.endQuarters ||
      a.id.localeCompare(b.id),
  );
  return { pitchMode, intervals };
}
