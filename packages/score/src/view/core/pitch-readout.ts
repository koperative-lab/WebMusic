import {Pitch} from '../../core';

/** MIDI readouts choose a spelling; they do not infer a harmonic key. */
export type PitchReadoutSpelling = 'sharp' | 'flat';

/** One sounding pitch projected onto a single notation column. */
export interface CurrentStaffMark {
  midi: number;
  id: string;
  label: string;
  diatonic: number;
  accidental?: 'sharp' | 'flat';
  active: true;
  column: 0;
}

/** One exact-MIDI position on the caller's ordered strings. */
export interface CurrentFretMark {
  midi: number;
  stringIndex: number;
  fret: number;
  label: string;
  mark: string;
  active: true;
  id: string;
}

const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'] as const;
const FLAT_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

export const STANDARD_VIEW_TUNING: readonly number[] = Object.freeze([40, 45, 50, 55, 59, 64]);

/** Return a written pitch. MIDI must be an integer in 0–127; no key is inferred. */
export function readoutPitch(midi: number, spelling: PitchReadoutSpelling = 'sharp'): Pitch {
  validateMidi(midi);
  validateSpelling(spelling);
  if (spelling === 'sharp') return Pitch.fromMidi(midi);
  return Pitch.parse(`${FLAT_NAMES[midi % 12]}${Math.floor(midi / 12) - 1}`);
}

/** Unique ascending pitches on one staff column, with exact spelling-derived steps. */
export function currentStaffMarks(midis: readonly number[], spelling: PitchReadoutSpelling = 'sharp'): CurrentStaffMark[] {
  validateSpelling(spelling);
  return uniqueMidis(midis).map((midi) => {
    const pitch = readoutPitch(midi, spelling);
    return {
      midi,
      id: `note-${midi}`,
      label: pitch.toString(),
      diatonic: pitch.octave * 7 + LETTERS.indexOf(pitch.step),
      accidental: pitch.alter > 0 ? 'sharp' as const : pitch.alter < 0 ? 'flat' as const : undefined,
      active: true,
      column: 0,
    };
  });
}

/** Open-string MIDI values in physical order, with no sorting or octave folding. */
export function parseViewTuning(raw: string | null): readonly number[] {
  if (!raw?.trim() || raw.trim().toLowerCase() === 'standard') return STANDARD_VIEW_TUNING;
  const values = raw.trim().split(/[\s,]+/).map(Number);
  return values.length >= 1 && values.length <= 12
    && values.every((midi) => Number.isSafeInteger(midi) && midi >= 0 && midi <= 127)
    ? values : STANDARD_VIEW_TUNING;
}

/** Every exact-MIDI location inside the selected fret window, not a chord fingering. */
export function currentFretMarks(
  midis: readonly number[],
  tuning: readonly number[] = STANDARD_VIEW_TUNING,
  firstFret = 0,
  frets = 12,
  spelling: PitchReadoutSpelling = 'sharp',
): CurrentFretMark[] {
  validateSpelling(spelling);
  if (tuning.length < 1 || tuning.length > 12) throw new RangeError('Pitch readout tuning requires 1–12 MIDI pitches.');
  tuning.forEach(validateMidi);
  if (!Number.isSafeInteger(firstFret) || firstFret < 0 || firstFret > 24
    || !Number.isSafeInteger(frets) || frets < 1 || frets > 24) {
    throw new RangeError('Pitch readout fret window requires integer firstFret in 0–24 and frets in 1–24.');
  }
  return uniqueMidis(midis).flatMap((midi) => {
    const pitch = readoutPitch(midi, spelling);
    const label = pitch.toString();
    const mark = `${pitch.step}${pitch.alter > 0 ? '#' : pitch.alter < 0 ? 'b' : ''}`;
    return tuning.flatMap((open, stringIndex) => {
      const fret = midi - open;
      return fret >= firstFret && fret <= firstFret + frets
        ? [{midi, stringIndex, fret, label, mark, active: true as const, id: `fret-${stringIndex}-${fret}`}]
        : [];
    });
  });
}

function validateMidi(midi: number): void {
  if (!Number.isSafeInteger(midi) || midi < 0 || midi > 127) throw new RangeError('Pitch readout MIDI must be an integer between 0 and 127.');
}

function validateSpelling(spelling: PitchReadoutSpelling): void {
  if (spelling !== 'sharp' && spelling !== 'flat') throw new RangeError('Pitch readout spelling must be sharp or flat.');
}

function uniqueMidis(midis: readonly number[]): number[] {
  midis.forEach(validateMidi);
  return [...new Set(midis)].sort((a, b) => a - b);
}
