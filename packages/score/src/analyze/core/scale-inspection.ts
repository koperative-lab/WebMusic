import type {Score} from '../../core';
import type {IntervalPitchMode, IntervalSelection} from './interval';
import {inspectionNotes, type TheoryNoteEvidence} from './inspection-notes';

export type TheoryScale = 'major' | 'natural-minor' | 'harmonic-minor'
  | 'melodic-minor-ascending' | 'melodic-minor-descending';
export type ScaleKind = TheoryScale;

export interface ScaleInspectionOptions {
  /** Explicit pitch name without an octave, such as C, F# or Bb. Never guessed. */
  readonly tonic: string;
  /** Defaults to major. The two melodic-minor directions are chosen, not inferred. */
  readonly scale?: TheoryScale;
  readonly pitchMode?: IntervalPitchMode;
}

export interface ScaleDegreePitch {
  readonly degree: number;
  /** Spelled reference pitch class without octave. */
  readonly pitch: string;
}

export interface ScaleNoteInspection extends TheoryNoteEvidence {
  /** Diatonic letter degree, 1..7, independent of enharmonic equivalence. */
  readonly degree: number;
  /** Semitones above/below the reference scale's spelled degree. */
  readonly alteration: number;
  /** ASCII degree label, for example 4, #4 or b5. */
  readonly label: string;
  /** Exact spelled membership. An altered degree is not a musical error. */
  readonly inScale: boolean;
}

export interface ScaleInspection {
  readonly tonic: string;
  readonly scale: TheoryScale;
  readonly pitchMode: IntervalPitchMode;
  readonly pitches: readonly ScaleDegreePitch[];
  readonly notes: readonly ScaleNoteInspection[];
}

const STEPS = 'CDEFGAB';
const NATURAL = [0, 2, 4, 5, 7, 9, 11];
const SCALES: Readonly<Record<TheoryScale, readonly number[]>> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  'natural-minor': [0, 2, 3, 5, 7, 8, 10],
  'harmonic-minor': [0, 2, 3, 5, 7, 8, 11],
  'melodic-minor-ascending': [0, 2, 3, 5, 7, 9, 11],
  'melodic-minor-descending': [0, 2, 3, 5, 7, 8, 10],
};

/** Internal spelling arithmetic also supplies explicit-key chord degrees. */
export function theoryPitchName(name: string): {step: string; alter: number} {
  if (typeof name !== 'string') throw new TypeError('Tonic must be a pitch name');
  const normalized = name.trim().replace(/♯/g, '#').replace(/♭/g, 'b');
  const match = /^([A-G])((?:#{1,2}|b{1,2})?)$/.exec(normalized);
  if (!match) throw new RangeError('Tonic must be a pitch name without octave (C, F#, Bb)');
  return {step: match[1]!, alter: match[2]!.startsWith('b') ? -match[2]!.length : match[2]!.length};
}

export function degreeAccidental(alter: number): string {
  return alter < 0 ? 'b'.repeat(-alter) : '#'.repeat(alter);
}

export function theoryScalePitches(tonic: string, scale: TheoryScale): {step: string; alter: number}[] {
  if (!Object.prototype.hasOwnProperty.call(SCALES, scale)) throw new RangeError('Unknown reference scale');
  const root = theoryPitchName(tonic);
  const rootIndex = STEPS.indexOf(root.step);
  return SCALES[scale].map((distance, index) => {
    const position = rootIndex + index;
    const stepIndex = position % 7;
    const naturalDistance = NATURAL[stepIndex]! + 12 * Math.floor(position / 7) - NATURAL[rootIndex]!;
    return {step: STEPS[stepIndex]!, alter: root.alter + distance - naturalDistance};
  });
}

/** Inspect spelled scale membership in an explicit tonal reference, never infer a key. */
export function inspectScale(
  score: Score,
  selection: IntervalSelection,
  options: ScaleInspectionOptions,
): ScaleInspection {
  const scale = options.scale ?? 'major';
  const pitchMode = options.pitchMode ?? 'written';
  const reference = theoryScalePitches(options.tonic, scale);
  const root = reference[0]!;
  const notes = inspectionNotes(score, pitchMode, selection).map(({pitch, evidence}) => {
    const index = (STEPS.indexOf(pitch.step) - STEPS.indexOf(root.step) + 7) % 7;
    const alteration = pitch.alter - reference[index]!.alter;
    return {...evidence, degree: index + 1, alteration,
      label: `${degreeAccidental(alteration)}${index + 1}`, inScale: alteration === 0};
  });
  return {
    tonic: `${root.step}${degreeAccidental(root.alter)}`, scale, pitchMode,
    pitches: reference.map((pitch, index) => ({degree: index + 1, pitch: `${pitch.step}${degreeAccidental(pitch.alter)}`})),
    notes,
  };
}
