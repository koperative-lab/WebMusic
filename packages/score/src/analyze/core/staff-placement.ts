// ============================================================================
// Staff placement — where a SPELLED pitch sits on a stave, and nothing else.
//
// Every function here is geometry over one number: the diatonic step. The
// ladder is continuous and absolute, C0 = 0, D0 = 1 … B0 = 6, C1 = 7, so
// MIDDLE C (C4) = 28. A presenter draws lines and shapes; it never decides
// which line a note sits on, because that follows the SPELLING and not the
// sound — F#4 and Gb4 are the same key and different lines.
//
// ## There are deliberately two copies of this ladder in @webmusic/score
//
// `view/core/layout.ts`'s `STEP_TO_DIATONIC` and `diatonicStepsFromMiddleC`
// are the same ladder, and its `createStaffLayout` already counts ledger
// lines. It uses a DIFFERENT origin — C4 = 0 — so for a note the score
// actually spelled, `diatonicOf(step, octave) === diatonicStepsFromMiddleC(note)
// + 28`. The identity holds on the spelled branch ONLY: given no spelling that
// one falls back to a MIDI approximation and this one to middle C, and the two
// approximations are not each other.
//
// (Symbols, not line numbers, on purpose. The first draft of this header cited
// four line numbers and three of them were stale inside the same commit,
// because the commit had edited the files it was pointing at.)
//
// The copy is not an oversight. `scripts/package-policy.mjs:142` declares
// `analyze: ["core", "io"]`, so the analyze capability may never import view
// (enforced by `checkCapabilityBoundaries`). Lifting the shared ladder into
// `packages/score/src/core/` is the clean fix and is a separate commit: it
// drags `view/core/layout.ts` and `test/view/layout.test.ts` into a change
// that otherwise touches no rendering at all. Until then: change one, check
// the other.
//
// The same applies to `LETTER_FIFTHS` below and `FIFTHS_TO_MAJOR_KEY` in
// `view/core/note-sequence.ts`. They are different tables — seven letters to a
// fifths count here, twelve fifths to a pitch class there — but they describe
// one circle.
// ============================================================================

import type {Key} from './types';

/** Which stave (or pair of staves) a placement is measured against. */
export type StaffSystem = 'grand' | 'treble' | 'bass';

/** An accidental a presenter can draw. Alters beyond a double are unspellable. */
export type StaffAccidental = 'sharp' | 'flat' | 'natural' | 'double-sharp' | 'double-flat';

/** Diatonic step of MIDDLE C — the anchor the whole ladder is quoted against. */
export const MIDDLE_C_DIATONIC = 28;

/** Letter to its offset inside an octave of the ladder. C = 0 … B = 6. */
export const STEP_TO_DIATONIC: Readonly<Record<string, number>> = Object.freeze({
  C: 0,
  D: 1,
  E: 2,
  F: 3,
  G: 4,
  A: 5,
  B: 6,
});

/** The inverse of {@link STEP_TO_DIATONIC}, indexed by `diatonic % 7`. */
export const DIATONIC_TO_STEP: readonly string[] = Object.freeze(['C', 'D', 'E', 'F', 'G', 'A', 'B']);

/**
 * Clef glyphs, because a glyph is domain vocabulary and domain vocabulary
 * lives in @webmusic/score. `scripts/check-architecture.mjs:784` forbids any
 * notation glyph inside `packages/ui/src/**` — the kit positions a clef the
 * caller hands it and never owns one. These are the strings to hand over.
 */
export const CLEF_GLYPHS: Readonly<Record<string, string>> = Object.freeze({
  treble: '\u{1D11E}',
  bass: '\u{1D122}',
  alto: '\u{1D121}',
  tenor: '\u{1D121}',
  percussion: '\u{1D125}',
});

/**
 * The accidental glyphs, for the same reason {@link CLEF_GLYPHS} lives here:
 * `check-architecture.mjs`'s `checkUiDomainVocabulary` bans every notation
 * glyph — U+266D/266E/266F included — from `packages/ui/src/**`, so the kit
 * CANNOT write a sharp sign even if it wanted to. A read-out that prints
 * `C♯` gets the character from this package or not at all.
 */
export const ACCIDENTAL_GLYPHS: Readonly<Record<string, string>> = Object.freeze({
  '#': '♯',
  b: '♭',
  natural: '♮',
  '##': '\u{1D12A}',
  bb: '\u{1D12B}',
});

/**
 * An ASCII pitch or chord name as a reader wants to SEE it: `'F#4'` becomes
 * `'F♯4'`, `'Bbm7'` becomes `'B♭m7'`.
 *
 * Only a run of accidentals immediately after a letter is converted, so the
 * `b` of `'Bdim7'`, the `b` of `'b9'` in a figure and the `#` of a CSS colour
 * are all left alone. The ASCII form stays the value on `ChordNaming.symbol`
 * and `SpelledPitch.name`: that is what a caller compares, slugs and
 * round-trips, and this is the display of it.
 */
export function toDisplayName(ascii: string): string {
  return ascii.replace(
    /([A-Ga-g])(#{1,2}|b{1,2})/g,
    (_all, letter: string, marks: string) => `${letter}${ACCIDENTAL_GLYPHS[marks] ?? marks}`,
  );
}

/** Where one diatonic step sits, and which ledger lines it needs to get there. */
export interface StaffPlacement {
  /**
   * Vertical position in HALF STAFF SPACES, increasing downward, measured from
   * the top line of the stave named by {@link staff} — NOT of the system. One
   * diatonic step is one half space, so a line sits on every even offset.
   *
   * On a grand system that means `y` restarts at the lower stave, and the two
   * are not comparable: B3 is `y = -1` on the lower stave and middle C, a
   * semitone above it, is `y = 10` on the upper. Use {@link systemY} to draw
   * both staves against one origin.
   */
  readonly y: number;
  /**
   * {@link y} re-measured from the top line of the system's TOP stave, so a
   * grand system reads as one continuous ladder and a higher pitch always has
   * a smaller number: B3 is `11`, middle C is `10`. Equal to `y` on a
   * single-stave system, and `y + `{@link GRAND_STAFF_STAVE_OFFSET} on a grand
   * system's lower stave.
   */
  readonly systemY: number;
  /**
   * Which stave of a grand system the pitch belongs to. Always `'upper'` for
   * a treble-only system and `'lower'` for a bass-only one.
   */
  readonly staff: 'upper' | 'lower';
  /**
   * The diatonic steps at which a ledger line must be drawn, ascending. Empty
   * when the pitch already sits within the stave. These are LINE positions,
   * so they are always even relative to the stave, and a pitch in a space
   * still needs the line below (or above) it: C6 needs A5 and C6, two lines.
   */
  readonly ledgers: readonly number[];
}

// The five treble lines, top to bottom: F5 A5 C5 E5 G4 — in diatonic steps,
// 38 36 34 32 30. The bass lines are A3 F3 D3 B2 G2 — 26 24 22 20 18. The
// grand staff is one continuous ladder across both, which is why middle C
// (28) lands exactly between 30 and 26 and takes a ledger line of its own.
const TREBLE_TOP = 38;
const TREBLE_BOTTOM = 30;
const BASS_TOP = 26;
const BASS_BOTTOM = 18;

/**
 * Half staff spaces from a grand system's treble top line down to its bass top
 * line — the number that turns a lower-stave {@link StaffPlacement.y} into a
 * {@link StaffPlacement.systemY}. It is the continuous ladder's own spacing,
 * which is what puts middle C exactly halfway between the two staves.
 */
export const GRAND_STAFF_STAVE_OFFSET = TREBLE_TOP - BASS_TOP;

// The ladder a real instrument can reach, in diatonic steps: C-1 (MIDI 0) is
// -7 and C9 is 63, so this covers all of MIDI with an octave to spare either
// side. `staffPlacement` clamps to it because `ledgerLines` allocates one entry
// per line between the stave and the note, and a malformed MusicXML <octave>
// reaches `diatonicOf` unharmed: `diatonicOf('C', 1e9)` is 7e9, which is finite,
// passes every guard, and asks for an array JavaScript cannot allocate.
const LOWEST_STEP = -7;
const HIGHEST_STEP = 70;

/** The diatonic step of a notated pitch. `diatonicOf('C', 4)` is 28. */
export function diatonicOf(step: string, octave: number): number {
  const letter = STEP_TO_DIATONIC[step.toUpperCase()];
  if (letter === undefined || !Number.isFinite(octave)) return MIDDLE_C_DIATONIC;
  return Math.round(octave) * 7 + letter;
}

/** The letter and octave a diatonic step spells. The inverse of {@link diatonicOf}. */
export function pitchOfDiatonic(diatonic: number): {step: string; octave: number} {
  const value = Number.isFinite(diatonic) ? Math.round(diatonic) : MIDDLE_C_DIATONIC;
  const octave = Math.floor(value / 7);
  return {step: DIATONIC_TO_STEP[value - octave * 7], octave};
}

/** The accidental that draws an alter, or `undefined` when nothing is drawn. */
export function accidentalForAlter(alter: number, natural = false): StaffAccidental | undefined {
  if (!Number.isFinite(alter)) return undefined;
  switch (Math.round(alter)) {
    case 2:
      return 'double-sharp';
    case 1:
      return 'sharp';
    case 0:
      return natural ? 'natural' : undefined;
    case -1:
      return 'flat';
    case -2:
      return 'double-flat';
    default:
      return undefined;
  }
}

/**
 * Place one diatonic step on a stave.
 *
 * On a grand system the split is the classical one: middle C and everything
 * above it is read from the treble stave, everything below it from the bass.
 * That is what puts middle C's single ledger line under the treble stave
 * rather than over the bass one.
 *
 * `y` is in half staff spaces from ITS OWN stave's top line, so a caller
 * multiplies by its own half-space in pixels and is done; `systemY` is the
 * same number re-based on the system. Middle C on a grand system is `y = 10`;
 * C6 is `y = -4`, four half spaces above the treble's top line, reached across
 * TWO ledger lines (A5 and C6).
 */
export function staffPlacement(diatonic: number, system: StaffSystem = 'grand'): StaffPlacement {
  const step = clampStep(diatonic);
  const lower = system === 'bass' || (system === 'grand' && step < MIDDLE_C_DIATONIC);
  const top = lower ? BASS_TOP : TREBLE_TOP;
  const bottom = lower ? BASS_BOTTOM : TREBLE_BOTTOM;
  const y = top - step;
  return {
    y,
    systemY: system === 'grand' && lower ? y + GRAND_STAFF_STAVE_OFFSET : y,
    staff: lower ? 'lower' : 'upper',
    ledgers: ledgerLines(step, top, bottom),
  };
}

/** A step this can actually draw. See {@link LOWEST_STEP}. */
function clampStep(diatonic: number): number {
  if (!Number.isFinite(diatonic)) return MIDDLE_C_DIATONIC;
  return Math.min(HIGHEST_STEP, Math.max(LOWEST_STEP, Math.round(diatonic)));
}

/**
 * The ledger lines between a stave and a step outside it, ascending. A ledger
 * sits on every LINE position between the stave and the note, the note's own
 * position included when it is itself a line.
 */
function ledgerLines(step: number, top: number, bottom: number): readonly number[] {
  const lines: number[] = [];
  if (step > top) {
    for (let line = top + 2; line <= step; line += 2) lines.push(line);
  } else if (step < bottom) {
    for (let line = bottom - 2; line >= step; line -= 2) lines.push(line);
    lines.reverse();
  }
  return lines;
}

// The key-signature order, as diatonic steps on a TREBLE stave. Sharps run
// F5 C5 G5 D5 A4 E5 B4; flats run Bb4 Eb5 Ab4 Db5 Gb4 Cb5 Fb4. The bass
// stave draws the same shapes two octaves lower, hence the flat -14 below —
// that offset is the whole difference between the two clefs' signatures.
const TREBLE_SHARP_STEPS = [38, 35, 39, 36, 33, 37, 34] as const;
const TREBLE_FLAT_STEPS = [34, 37, 33, 36, 32, 35, 31] as const;
const BASS_OCTAVE_OFFSET = -14;

/** Fifths from C for each natural letter: F is one flat side, B is five sharp. */
const LETTER_FIFTHS: Readonly<Record<string, number>> = Object.freeze({
  F: -1,
  C: 0,
  G: 1,
  D: 2,
  A: 3,
  E: 4,
  B: 5,
});

/**
 * Where a key sits on the circle of fifths: `1` for G major, `-6` for Gb
 * major, `0` for C major and A minor.
 *
 * Derived from the tonic's SPELLING, not its pitch class, so Gb major reads
 * as six flatward and F# major six sharpward even though they sound alike. A
 * minor key answers what its relative major answers — three fifths flatward.
 * Returns `0` for a tonic this cannot parse, which is the honest answer: the
 * middle of the circle rather than a guess.
 *
 * This answers a POSITION, never a signature. It is deliberately UNCLAMPED,
 * which is the whole reason it is separate from {@link keySignatureFifths}:
 * the two questions part company past seven accidentals. A signature stops at
 * seven because a stave has seven letters to put one on; a position does not,
 * and a caller that seats keys around a dial needs the position — clamping
 * `G#` (eight) to `7` would seat it on Db and turn the wheel to the wrong key.
 * It is also the only honest source for "is this a flat key?", because the
 * clamped answer erases the sign: `keySignatureFifths(Fb major)` is `0`, and
 * `0 < 0` is false.
 */
export function keyFifths(key: Key): number {
  const tonic = typeof key.tonic === 'string' ? key.tonic.trim() : '';
  const match = /^([A-Ga-g])(#{1,2}|b{1,2})?$/.exec(tonic);
  if (!match) return 0;
  const letter = LETTER_FIFTHS[match[1].toUpperCase()];
  if (letter === undefined) return 0;
  const accidentals = match[2] ?? '';
  const alter = accidentals.startsWith('#') ? accidentals.length : -accidentals.length;
  return letter + alter * 7 - (key.mode === 'minor' ? 3 : 0);
}

/**
 * How many sharps (positive) or flats (negative) a key signs.
 *
 * {@link keyFifths} with the keys a stave cannot write ruled out. Returns `0`
 * for a tonic this cannot parse, which is the honest answer: no accidentals
 * rather than a guess.
 *
 * A THEORETICAL key gets the same `0`. G# major signs eight sharps and D#
 * major nine; no signature can write them, and clamping to seven would draw
 * C# major's signature and call it G#'s — seven accidentals that are not the
 * key's, which is the one thing worse than none. The pitches themselves are
 * still spelled correctly and simply carry their own accidentals.
 *
 * Ask {@link keyFifths} instead whenever the question is where the key SITS
 * rather than what it WRITES; this one's `0` cannot tell C major apart from
 * G# major.
 */
export function keySignatureFifths(key: Key): number {
  const fifths = keyFifths(key);
  return fifths < -7 || fifths > 7 ? 0 : fifths;
}

/**
 * The accidentals a key signature draws, in the order a scribe writes them.
 *
 * A `'grand'` system returns the treble shapes only; a caller draws them
 * again on the lower stave with {@link keySignatureAccidentals}`(key, 'bass')`,
 * because the two staves carry the same signature at different heights and a
 * single flat list could not say which stave a step belongs to.
 */
export function keySignatureAccidentals(
  key: Key,
  system: StaffSystem = 'treble',
): ReadonlyArray<{diatonic: number; accidental: StaffAccidental}> {
  const fifths = keySignatureFifths(key);
  if (fifths === 0) return [];
  const offset = system === 'bass' ? BASS_OCTAVE_OFFSET : 0;
  const steps = fifths > 0 ? TREBLE_SHARP_STEPS : TREBLE_FLAT_STEPS;
  const accidental: StaffAccidental = fifths > 0 ? 'sharp' : 'flat';
  return steps
    .slice(0, Math.abs(fifths))
    .map((diatonic) => ({diatonic: diatonic + offset, accidental}));
}

/**
 * Which LETTERS a key signature alters, and by how much: `{F: 1}` for G major,
 * `{B: -1, E: -1, A: -1}` for E-flat major, `{}` for C major.
 *
 * A signature binds a letter in every octave, which is the fact
 * {@link keySignatureAccidentals} cannot express — it answers in diatonic
 * steps, because it is telling a scribe where to draw. This one is what a
 * caller needs to decide whether a sounding pitch still needs an accidental of
 * its own, and it is where `SpelledPitch.accidental` comes from: an F in G
 * major draws a NATURAL, and an F# draws nothing.
 *
 * The two letter orders are read off the step tables above rather than written
 * out again, so the sharp order F C G D A E B and the flat order B E A D G C F
 * have exactly one definition in this file.
 */
export function keySignatureAlters(key: Key): Readonly<Record<string, number>> {
  const fifths = keySignatureFifths(key);
  if (fifths === 0) return EMPTY_ALTERS;
  const steps = fifths > 0 ? TREBLE_SHARP_STEPS : TREBLE_FLAT_STEPS;
  const alter = fifths > 0 ? 1 : -1;
  const alters: Record<string, number> = {};
  for (const diatonic of steps.slice(0, Math.abs(fifths))) {
    alters[DIATONIC_TO_STEP[diatonic % 7]] = alter;
  }
  return Object.freeze(alters);
}

/** The signature of C major and A minor, and of every key that cannot sign one. */
const EMPTY_ALTERS: Readonly<Record<string, number>> = Object.freeze({});
