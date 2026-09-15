import {parseChordSymbol} from './chord-spelling';
import type {Score} from '../../core';
import {segmentChords} from './chords';
import type {ChordSegment, ChordWindowOptions, Key, RNAResult} from './types';

/** Options for {@link romanNumerals}. */
export interface RomanNumeralOptions extends ChordWindowOptions {
  /**
   * Precomputed result of `segmentChords(score, …)` to reuse instead of
   * segmenting again. Pass this when you already called `segmentChords`
   * (with the same options) so the score is only segmented once.
   */
  segments?: readonly ChordSegment[];
}

/**
 * Roman-numeral analysis of the chord progression relative to a key.
 *
 * Segmentation is ours and chord *parsing* is delegated to Tonal, but the
 * numeral itself follows this deliberately coarse degree/quality convention:
 *
 * - Degrees are computed relative to the key's tonic AND mode (in A minor,
 *   Am → i, E7 → V7, C → III).
 * - Uppercase for major/augmented quality, lowercase for minor/diminished,
 *   with `°` for diminished and `+` for augmented (e.g. vii°, III+).
 * - Conventional seventh suffixes: V7, ii7, Imaj7, vii half-diminished 7
 *   (rendered with U+00F8), and vii°7.
 * - Roots outside the diatonic scale get an accidental prefix (bII, #IV…),
 *   preferring the flat spelling.
 */
export function romanNumerals(
  score: Score,
  key: Key,
  opts: RomanNumeralOptions = {},
): RNAResult[] {
  const segments = opts.segments ?? segmentChords(score, opts);

  return segments.map((segment) => ({
    startQuarters: segment.startQuarters,
    endQuarters: segment.endQuarters,
    chord: segment.chord,
    roman: romanNumeralForChord(segment.chord, key),
  }));
}

const NUMERALS = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'] as const;
const MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11];
/** Natural minor: degrees are measured against the minor tonic. */
const MINOR_SCALE = [0, 2, 3, 5, 7, 8, 10];
const STEP_PC: Record<string, number> = {C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11};

/**
 * Derive a pitch-class-relative roman label for a single chord symbol in a key.
 * Inversion figures and contextual harmonic functions are not inferred.
 * Returns the chord symbol unchanged when it cannot be parsed (e.g. our
 * pitch-class-list fallback labels, which contain spaces).
 */
export function romanNumeralForChord(chordSymbol: string, key: Key): string {
  if (chordSymbol.includes(' ')) return chordSymbol;
  const chord = parseChordSymbol(chordSymbol);
  const rootPc = chord.tonic ? nameToPitchClass(chord.tonic) : null;
  const tonicPc = nameToPitchClass(key.tonic);
  if (rootPc == null || tonicPc == null) return chordSymbol;

  const semitones = (((rootPc - tonicPc) % 12) + 12) % 12;
  const scale = key.mode === 'minor' ? MINOR_SCALE : MAJOR_SCALE;

  let degree = scale.indexOf(semitones);
  let accidental = '';
  if (degree === -1) {
    // Chromatic root: prefer the lowered spelling (bII, bV…), else raised.
    degree = scale.indexOf((semitones + 1) % 12);
    if (degree !== -1) {
      accidental = 'b';
    } else {
      degree = scale.indexOf((semitones + 11) % 12);
      if (degree !== -1) accidental = '#';
    }
  }
  if (degree === -1) return chordSymbol;

  const {lowercase, suffix} = qualityNotation(chord.type, chord.quality, chord.aliases);
  const numeral = lowercase ? NUMERALS[degree].toLowerCase() : NUMERALS[degree];
  return `${accidental}${numeral}${suffix}`;
}

function nameToPitchClass(name: string): number | null {
  const match = /^([A-Ga-g])(#{1,3}|b{1,3})?$/.exec(name.trim());
  if (!match) return null;
  const base = STEP_PC[match[1].toUpperCase()];
  const accidentals = match[2] ?? '';
  const alter = accidentals.startsWith('#') ? accidentals.length : -accidentals.length;
  return (((base + alter) % 12) + 12) % 12;
}

function qualityNotation(
  type: string,
  quality: string,
  aliases: readonly string[] | undefined,
): {lowercase: boolean; suffix: string} {
  switch (type) {
    case 'major':
      return {lowercase: false, suffix: ''};
    case 'minor':
      return {lowercase: true, suffix: ''};
    case 'diminished':
      return {lowercase: true, suffix: '°'};
    case 'augmented':
      return {lowercase: false, suffix: '+'};
    case 'dominant seventh':
      return {lowercase: false, suffix: '7'};
    case 'minor seventh':
      return {lowercase: true, suffix: '7'};
    case 'major seventh':
      return {lowercase: false, suffix: 'maj7'};
    case 'minor/major seventh':
      return {lowercase: true, suffix: 'maj7'};
    case 'half-diminished':
      return {lowercase: true, suffix: '\u00f87'};
    case 'diminished seventh':
      return {lowercase: true, suffix: '°7'};
    case 'augmented seventh':
      return {lowercase: false, suffix: '+7'};
    case 'sixth':
      return {lowercase: false, suffix: '6'};
    case 'minor sixth':
      return {lowercase: true, suffix: '6'};
    default: {
      const lowercase = quality === 'Minor' || quality === 'Diminished';
      // Unknown qualities (sus chords, extensions…) keep Tonal's short alias.
      return {lowercase, suffix: aliases?.[0] ?? ''};
    }
  }
}
