import {isPitchedNote, Pitch, type Note, type Part, type Score, type Step} from '../../core';
import type {IntervalEvidence, IntervalPitchMode, IntervalSelection} from './interval';

/** Note provenance shared by the basic theory inspections. */
export type TheoryNoteEvidence = IntervalEvidence;

export interface InspectionNote {
  readonly note: Note;
  readonly pitch: Pitch;
  readonly evidence: TheoryNoteEvidence;
}

export function validatePitchMode(value: IntervalPitchMode): void {
  if (value !== 'written' && value !== 'sounding') throw new RangeError('Unknown inspection pitch mode');
}

/** Internal shared written/concert-pitch conversion, including spelling provenance. */
export function inspectedPitch(pitch: Pitch, part: Part, mode: IntervalPitchMode): {pitch: Pitch; inferred: boolean} {
  if (mode === 'written' || !part.transpose) return {pitch, inferred: false};
  const {chromatic, diatonic, octaveChange = 0} = part.transpose;
  const midi = pitch.midi + chromatic + 12 * octaveChange;
  if (diatonic === undefined) {
    // A zero or whole-octave shift has an exact spelling-preserving answer.
    // An incidental transpose declaration must not turn Db into C#.
    if (chromatic % 12 === 0) {
      const octaves = chromatic / 12 + octaveChange;
      return {pitch: octaves === 0 ? pitch : new Pitch(pitch.step, pitch.alter, pitch.octave + octaves), inferred: false};
    }
    return {pitch: Pitch.fromMidi(midi), inferred: true};
  }
  const steps = 'CDEFGAB';
  const position = pitch.octave * 7 + steps.indexOf(pitch.step) + diatonic + 7 * octaveChange;
  const octave = Math.floor(position / 7);
  const step = steps[((position % 7) + 7) % 7] as Step;
  const alter = midi - ((octave + 1) * 12 + Pitch.STEP_TO_SEMITONE[step]);
  return Number.isSafeInteger(alter) && alter >= -2 && alter <= 2
    ? {pitch: new Pitch(step, alter as -2 | -1 | 0 | 1 | 2, octave), inferred: false}
    : {pitch: Pitch.fromMidi(midi), inferred: true};
}

/** Internal selection uses sounding overlap with a half-open written range. */
export function inspectionNotes(
  score: Score,
  pitchMode: IntervalPitchMode,
  selection?: IntervalSelection,
): InspectionNote[] {
  validatePitchMode(pitchMode);
  if (selection) {
    if (selection.noteIds === undefined && selection.partId === undefined && selection.voiceId === undefined
      && selection.fromQuarters === undefined && selection.toQuarters === undefined) {
      throw new TypeError('Inspection selection needs note IDs, a part/voice, or a quarter range');
    }
    if (selection.noteIds !== undefined && (!Array.isArray(selection.noteIds)
      || !selection.noteIds.every((id) => typeof id === 'string'))) {
      throw new TypeError('Inspection noteIds must be an array of strings');
    }
    if ((selection.fromQuarters === undefined) !== (selection.toQuarters === undefined)) {
      throw new TypeError('Inspection range needs both fromQuarters and toQuarters');
    }
    if (selection.fromQuarters !== undefined && selection.toQuarters !== undefined
      && (!Number.isFinite(selection.fromQuarters) || !Number.isFinite(selection.toQuarters)
        || selection.toQuarters < selection.fromQuarters)) {
      throw new RangeError('Inspection range must be finite and ordered');
    }
  }
  const ids = selection?.noteIds === undefined ? undefined : new Set(selection.noteIds);
  const from = selection?.fromQuarters ?? -Infinity;
  const to = selection?.toQuarters ?? Infinity;
  if (from === to || ids?.size === 0) return [];
  return score.parts.flatMap((part) => {
    if (selection?.partId !== undefined && selection.partId !== part.id) return [];
    return part.notes.flatMap((note): InspectionNote[] => {
      if (!isPitchedNote(note) || (selection?.voiceId !== undefined && selection.voiceId !== note.voice)
        || (ids !== undefined && !ids.has(note.id))) return [];
      const onset = note.onsetQuarters.toFloat();
      const offset = note.offsetQuarters.toFloat();
      if (offset === onset ? onset < from || onset >= to : onset >= to || offset <= from) return [];
      const {pitch, inferred} = inspectedPitch(note.pitch, part, pitchMode);
      return [{
        note,
        pitch,
        evidence: {
          noteId: note.id, partId: part.id, voiceId: note.voice,
          onsetQuarters: onset, offsetQuarters: offset,
          writtenPitch: note.pitch.toString(), pitch: pitch.toString(),
          spellingInferred: inferred,
        },
      }];
    });
  });
}
