// ============================================================================
// Chord spelling — the ONE place that answers "what is this pile of pitches
// called, and what is each pitch doing inside it".
//
// Every harmony read-out in this repo (name plate, keyboard, stave, fretboard)
// must agree about a sounding C#: same colour, same spelling, same role. They
// agree because they all read one function, not because seven renderers were
// each told the same convention.
//
// ## What Tonal gives us, and what it does not
//
// `detect()` returns `string[]` — an ORDER, with no weights. It computes them
// internally (root position 1, inversion 0.5) and throws them away before
// returning. So {@link ChordNaming} carries an ordinal `rank` and a derived
// `kind`; it deliberately carries NO 0…1 confidence, because ties are common
// (`detect(['B','D','F','Ab'])` returns four names, three of which tie) and
// their relative order is Tonal's mode index, not merit. Presenting a rank as
// a confidence would invent a fact.
//
// `get(symbol).rootDegree` is `NaN` for a root-position chord and `0` for an
// unparsable one, which `??` does NOT catch. It is never read here and never
// put on a type: it would also differ across the analyze worker's transports
// (`structuredClone` keeps NaN, a JSON hop turns it into `null`).
//
// The pitch-name tables below are local. `pitch-class.ts`'s `NOTE_NAMES` is a
// fixed MIXED table (sharps for 1 and 6, flats for 3, 8 and 10) that can never
// emit `D#` or `Db`, so it cannot implement a spelling preference. Two
// twelve-entry arrays cost nothing and add no dependency — and `@tonaljs/
// pitch-note` is only a TRANSITIVE dependency here, so importing it would be
// a phantom dependency that no gate in this repo can see.
//
// ## Two things detect() will hand you that are not true
//
// A name must ACCOUNT FOR EVERY SOUNDING PITCH, and one that does not is
// dropped ({@link covers}). Otherwise `detect()` offers `Cb9sus` for C-Db-F-G-Bb
// — meaning "C, flat ninth, suspended" — and Tonal reads the symbol back with a
// C-FLAT tonic, so the root turns into the bass, two different pitch classes
// both print `5`, and every figure moves a semitone. Ten voicings in the whole
// language do this and all ten are that one symbol shape.
//
// A name must also not be a spelling artifact ({@link DEMOTED_TYPES}).
//
// ## This module freezes; its ten neighbours in `analyze/core/` do not
//
// `view/core/note-sequence.ts` states the house rule — "callers receive a
// shared object and must not mutate it (no in-repo caller does)" — and states
// it rather than enforcing it. This module enforces it because it is the one
// that MEMOISES: every caller of `spellChord([60,64,67])` gets the same object
// graph, for as long as the cache holds it, so one caller reaching into a
// `pitches` array would rewrite what the next four read-outs draw. That is a
// shared-cache invariant, not a style preference, and it does not argue for
// freezing anything in the neighbours.
// ============================================================================

import {get as tonalChord, getChord as tonalChordOfType} from '@tonaljs/chord';
import {detect} from '@tonaljs/chord-detect';
import {isPitchedNote, noteMidi, type Note} from '../../core';
import {pitchClass} from './pitch-class';
import {accidentalForAlter, diatonicOf, keySignatureAlters, type StaffAccidental} from './staff-placement';
import type {Key} from './types';

/** Tonal's own chord record. Named once so the helpers below can pass it around. */
type TonalChord = ReturnType<typeof tonalChord>;

/** Sharp spelling of every pitch class. Paired with {@link FLAT_NAMES}. */
export const SHARP_NAMES: readonly string[] = Object.freeze([
  'C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B',
]);

/** Flat spelling of every pitch class. Paired with {@link SHARP_NAMES}. */
export const FLAT_NAMES: readonly string[] = Object.freeze([
  'C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B',
]);

/**
 * What a read-out prints when nothing is sounding. A placeholder, not
 * microcopy: this layer will not invent a sentence in anyone's language, and a
 * caller that wants "Play something" substitutes its own.
 */
export const NO_CHORD_LABEL = '—';

/**
 * What a sounding pitch is DOING in the chord it was named against.
 *
 * Structurally identical to `ToneRole` in `packages/ui/src/harmony-style.ts`,
 * and deliberately a SEPARATE declaration: `@webmusic/ui` is an optional peer
 * and this layer must stay DOM-free and dependency-free.
 *
 * NOTHING ENFORCES THAT. A score test importing `packages/ui/src/**` would
 * reach across the optional-peer boundary to do it, which is a worse problem
 * than the one it solves, so the eight members and their marks are pinned here
 * (`chord-spelling.test.ts`, "the eight roles and their marks") and kept in
 * step with the kit by hand. Add a role to one union and you must add it to
 * the other: change one, check the other, exactly as with the diatonic ladder
 * in `staff-placement.ts`.
 */
export type ToneRole =
  | 'root'
  | 'third'
  | 'fifth'
  | 'seventh'
  | 'extension'
  | 'bass'
  | 'other'
  | 'ghost';

/** How a naming stands relative to the primary one. See {@link ChordNaming}. */
export type ChordNamingKind = 'primary' | 'inversion' | 'enharmonic' | 'rootless' | 'alias';

/** How a caller wants pitch classes spelled. */
export type SpellingPreference = 'auto' | 'sharp' | 'flat';

/** One sounding pitch, spelled, placed and given a job. */
export interface SpelledPitch {
  readonly midi: number;
  /** ASCII scientific name — `'Eb4'`, `'F#4'`, `'B#3'`. Round-trips through `Pitch.parse`. */
  readonly name: string;
  /** Letter only: `'C'` … `'B'`. */
  readonly step: string;
  /**
   * Semitone alteration. Normally `-2` … `2`; a score that notated a triple
   * accidental keeps it, and {@link accidental} is then absent because no
   * stave can draw one.
   */
  readonly alter: number;
  readonly octave: number;
  readonly pitchClass: number;
  /** Diatonic step for the stave, C0 = 0 and middle C = 28. Follows the SPELLING. */
  readonly diatonic: number;
  /**
   * The accidental a stave must DRAW on this pitch, given `options.key`'s
   * signature. Absent when the signature already supplies the alteration (the
   * F# of G major) or the pitch is natural in a key that does not touch its
   * letter; `'natural'` when the signature alters the letter and this pitch
   * does not want it (the F natural of G major).
   *
   * Without this a presenter holding only {@link alter} draws nothing on that
   * F natural — and the reader sees an F sharp, because the signature already
   * put one there. With no `key` every alteration is drawn and no natural is,
   * which is right for a bare read-out with no signature on it.
   */
  readonly accidental?: StaffAccidental;
  readonly role: ToneRole;
  /**
   * The figure to PRINT on this pitch, read off the naming's own intervals and
   * therefore the honest one, not the role's generic mark: `'R' '3' '5' '7'`
   * for the chord tones, `'4'` on a suspended fourth, `'6'` on a sixth,
   * `'b9' '#9' '#11' 'b13'` on an altered extension, `'b5' '#5'` on an altered
   * fifth. ASCII always. A pitch the naming does not cover falls back to
   * {@link toneMarkFor}, and an unnamed set to `'.'`.
   *
   * It does NOT track {@link role} one-for-one, and that is the point: a sus4's
   * fourth is role `'extension'` and label `'4'`. The one role that also names
   * itself is the bass, which prints `'B'` before its figure — `'B9'` for the
   * D of a `C9/D`, `'B3'` for the E of a `Cmaj7/E`. It has to: the mark is the
   * colour's second channel, and a greyscale reader who sees a bare `'3'`
   * cannot tell a bass from a third at all.
   */
  readonly degreeLabel: string;
  /**
   * The figure this pitch carries in the named chord — `'1P'`, `'3M'`, `'7m'`,
   * `'9M'`, `'13M'`. Read from the chord's own ROOT-POSITION interval list, so
   * a sixth chord says `'6M'` and a ninth chord says `'9M'`. Absent when the
   * pitch is not a tone of the named chord (or nothing is named).
   */
  readonly interval?: string;
}

/** One way to name the sounding pitches. */
export interface ChordNaming {
  /** A DOM-safe slug of {@link symbol}, unique within one {@link ChordSpelling}. */
  readonly id: string;
  /** What a read-out PRINTS: `'Cmaj7'`, `'Am7/C'`. Tonal's `symbol`, never its `name`. */
  readonly symbol: string;
  /** The chord's root, e.g. `'C'` for `'Cmaj7/E'`. Empty only for an unparsable symbol. */
  readonly root: string;
  /**
   * {@link root}'s pitch class. A colour wheel keys on the root's CHROMA and a
   * fretboard search asks "is the root reachable", and neither can do anything
   * with the letter `'Db'` — every caller that needed this would otherwise
   * write a fourth private copy of the name-to-chroma table (`roman.ts` and
   * this file already hold two). Absent only for an unparsable symbol.
   */
  readonly rootPitchClass?: number;
  /** The symbol's slash bass, when it has one. Not the lowest SOUNDING pitch. */
  readonly bass?: string;
  /** {@link bass}'s pitch class, on the same argument as {@link rootPitchClass}. */
  readonly bassPitchClass?: number;
  /** Tonal's coarse quality: `'Major'`, `'Minor'`, `'Augmented'`, `'Diminished'`, `'Unknown'`. */
  readonly quality: string;
  /**
   * The spoken name: `'C major seventh'`, `'A minor seventh over C'`.
   *
   * Tonal builds this as `${tonic} ${type}`, so a chord it can spell but has no
   * words for comes back as `'C '` — a trailing space and nothing else, which
   * `?? symbol` and `=== ''` both sail straight past and a screen reader reads
   * as "C". `C7b13` is one. Those fall back to {@link symbol}.
   */
  readonly fullName: string;
  readonly kind: ChordNamingKind;
  /**
   * Position in {@link ChordSpelling.namings}, `0` first. ORDINAL ONLY — the
   * gap between rank 0 and rank 1 is not a measured distance, and rank 1 and
   * rank 2 are frequently equally good. Never render it as a confidence.
   */
  readonly rank: number;
}

/** Everything a read-out needs about one sounding set. */
export interface ChordSpelling {
  /** Every sounding pitch, ascending, deduped by MIDI number. */
  readonly pitches: readonly SpelledPitch[];
  /** Candidate namings, best first. Empty when nothing could be named. */
  readonly namings: readonly ChordNaming[];
  /** `namings[0]`, absent when nothing could be named. */
  readonly primary?: ChordNaming;
  /**
   * What to print, NEVER empty: the primary symbol, else the space-joined
   * pitch names (one, two and twelve-note sets are unnameable and this is the
   * honest read-out), else {@link NO_CHORD_LABEL} for silence.
   */
  readonly label: string;
}

/** How to spell and how far to look. */
export interface SpellChordOptions {
  /**
   * Which twelve-name table asks the question and fills the gaps. `'sharp'`
   * and `'flat'` force one; `'auto'` (the default) takes the key's, else
   * {@link SHARP_NAMES}.
   *
   * THE NAMING ALWAYS DECIDES THE FINAL SPELLING, under every setting. The
   * table is what `detect()` is handed, so it picks between enharmonic
   * READINGS — `['C#','F','G#']` is named `C#M` and `['Db','F','Ab']` is named
   * `DbM` — and the winning name then spells its own notes: `C#M` writes `E#`
   * and `DbM` writes `F`, a line apart on the stave. A forced table that
   * overrode the name's own letters would label a triad `C#M` and draw
   * `C#-F-G#`, a major chord written as a diminished fourth, which is the one
   * thing "spelling follows naming, staff position follows spelling" is for.
   *
   * Two tiebreaks, both deliberate:
   *  1. Only the primary naming spells. Alternates are never consulted, so two
   *     namings can never disagree about the same chroma.
   *  2. Within the primary's own note list a chroma can appear twice —
   *     `get('Em#5/C').notes` is `["C","E","G","B#"]`, and `B#` repeats `C`'s
   *     chroma. The FIRST occurrence in that list wins.
   * A chroma the primary does not cover falls back to the table.
   *
   * Ignored by {@link spellChordNotes}: a notated pitch is already spelled, and
   * throwing that away is the one thing a score must never do.
   */
  readonly spelling?: SpellingPreference;
  /** Biases the table toward the key's own accidentals, and signs `SpelledPitch.accidental`. */
  readonly key?: Key;
  /**
   * Promote this symbol to primary and recompute every role against it — what
   * a workbench does when a reader clicks an alternate name. A symbol Tonal
   * cannot parse is ignored; one it can parse but `detect()` never offered is
   * appended and then promoted.
   *
   * It must still NAME SOMETHING THAT IS SOUNDING: either its root is one of
   * the sounding pitch classes, or its tones cover all of them. A workbench
   * that carries `prefer` across a moving playhead otherwise prints `Cmaj7`
   * over a sounding D-F#-A-C#, a chord with which it shares no pitch at all.
   * A preference that fails that test is dropped and the unpreferred reading
   * is returned.
   *
   * Partial coverage is allowed and is the point: `prefer: 'C'` over a
   * sounding C-E-G-Bb names the triad and lets the seventh fall back to
   * {@link MARK_BY_SEMITONE}.
   */
  readonly prefer?: string;
  /**
   * Also look for namings whose ROOT is not sounding — the reading that hears
   * C-E-G-B as `Am9` without its A. Off by default: it costs one `detect()`
   * per absent pitch class (about 0.7 ms cold, free once memoised), which the
   * live note-on path should not pay for.
   */
  readonly includeRootless?: boolean;
  /** Cap on {@link ChordSpelling.namings}. Default `8`, minimum `1`. */
  readonly maxNamings?: number;
}

// ---------------------------------------------------------------------------
// Roles and degrees
// ---------------------------------------------------------------------------

// A chord's OWN interval list is the authority on what each of its pitches is
// doing, and a semitone count is not. `get('Bdim7').intervals` is
// `['1P','3m','5d','7d']`, so the Ab in B-D-F-Ab is a SEVENTH — nine semitones
// above the root, exactly like C6's sixth, and a different job.
// `get('Csus4').intervals` is `['1P','4P','5P']`, so the F in C-F-G is a
// suspended FOURTH — five semitones, exactly like a raised eleventh, and a
// different job again. A sus chord has no third at all, and no table can know
// that. So: ask the naming, and keep the table for what the naming leaves out.

// Simple degree (1…7) to the job it does. A compound figure answers the same
// question its simple form does — a ninth is a second an octave up — so 9, 11
// and 13 reduce onto 2, 4 and 6 and land on 'extension' together.
const ROLE_BY_DEGREE: readonly ToneRole[] = Object.freeze([
  'root', // 1
  'extension', // 2, 9
  'third', // 3
  'extension', // 4, 11
  'fifth', // 5
  'extension', // 6, 13
  'seventh', // 7
]);

// The degrees whose alteration a chord SYMBOL leaves unsaid, and which a lead
// sheet therefore figures: `b5` `#5` `b9` `#9` `#11` `b13`. The root, the third
// and the seventh are deliberately absent — `Cm`, `Cmaj7` and `Cdim7` have
// already said which they are, so their mark stays the bare degree and a
// diminished seventh prints `7`, not `bb7`. `SpelledPitch.interval` keeps the
// exact figure for anyone who needs more.
const FIGURED_DEGREES: ReadonlySet<number> = new Set([2, 4, 5, 6]);

// FALLBACK ONLY. Semitones above the root to a plausible job, for a pitch the
// naming does not cover — a caller-preferred symbol that omits it, say. The
// two coarsenesses now live only here: 6 reads as a fifth and 9 as an
// extension, because with no interval to read there is nothing to say whether
// either is a fifth, an eleventh, a sixth or a seventh.
const ROLE_BY_SEMITONE: readonly ToneRole[] = Object.freeze([
  'root',
  'extension',
  'extension',
  'third',
  'third',
  'extension',
  'fifth',
  'fifth',
  'fifth',
  'extension',
  'seventh',
  'seventh',
]);

// The MARKS for that fallback, and NOT `TONE_MARKS[role]`. A role is a coarse
// bucket on purpose — 2, 4, 6, 9, 11 and 13 all land on 'extension' — so
// reading its generic `'9'` off would print `9` on a perfect fourth and `9` on
// a major sixth, telling the reader a plain lie about an interval that is
// perfectly well known. Every entry here is a true statement about the
// semitone it sits on. The third and the seventh stay bare, exactly as
// {@link FIGURED_DEGREES} says, and the altered fifths are figured.
const MARK_BY_SEMITONE: readonly string[] = Object.freeze([
  'R', 'b9', '9', '3', '3', '4', 'b5', '5', '#5', '6', '7', '7',
]);

// Mirrors `toneMark()` in `packages/ui/src/harmony-style.ts`. ASCII only: the
// mark is what keeps a grayscale print and a colour-blind reader legible, and
// it must survive a font that has never heard of a musical symbol.
const TONE_MARKS: Readonly<Record<ToneRole, string>> = Object.freeze({
  root: 'R',
  third: '3',
  fifth: '5',
  seventh: '7',
  extension: '9',
  bass: 'B',
  other: '.',
  ghost: '.',
});

/**
 * The one-character mark for a role. Unknown roles read as `'other'`.
 *
 * This is the GENERIC answer, and it is what the kit asks for when it holds a
 * role and no chord. {@link SpelledPitch.degreeLabel} is the SPECIFIC one, read
 * off the naming's own intervals: `'4'` where this says `'9'` for a suspended
 * fourth, `'7'` where this says `'9'` for a diminished seventh.
 */
export function toneMarkFor(role: ToneRole | undefined): string {
  return TONE_MARKS[role ?? 'other'] ?? TONE_MARKS.other;
}

/** What one sounding pitch is doing, and what a read-out should print on it. */
function figureFor(
  chroma: number,
  rootPc: number | undefined,
  lowest: boolean,
  interval: string | undefined,
): {role: ToneRole; degreeLabel: string} {
  const parts = interval === undefined ? undefined : parseInterval(interval);
  const role = roleFor(chroma, rootPc, lowest, parts);
  // The bass says BOTH things, because it has two readers. Printing only `B`
  // throws away the one fact a slash chord exists to state — that the D of a
  // `C9/D` is the ninth. Printing only `9` breaks the rule the whole palette
  // rests on: a mark is the COLOUR's second channel, so a crimson `9` and a
  // gold `9` are the same glyph to anyone reading a greyscale print or a
  // screenshot, and the bass is the role a reader most wants to pick out.
  // `B9` costs one character and keeps both channels intact.
  const mark = (label: string): string => (role === 'bass' ? `B${label}` : label);
  if (parts !== undefined) return {role, degreeLabel: mark(degreeLabelFor(parts))};
  // No naming at all means no root to measure from, and `'.'` is the only
  // honest mark. A naming that simply does not cover this pitch still gives a
  // root, and a semitone count over a known root is a fact.
  if (rootPc === undefined) return {role, degreeLabel: toneMarkFor(role)};
  return {role, degreeLabel: mark(MARK_BY_SEMITONE[(chroma - rootPc + 12) % 12])};
}

function roleFor(
  chroma: number,
  rootPc: number | undefined,
  lowest: boolean,
  parts: IntervalParts | undefined,
): ToneRole {
  if (rootPc === undefined) return 'other';
  // The lowest sounding pitch is the BASS whenever it is not the root. That
  // one override is what makes a slash chord legible at a glance: in E-G-B-C
  // the E is the bass, not the third.
  if (lowest && chroma !== rootPc) return 'bass';
  if (parts !== undefined) return ROLE_BY_DEGREE[simpleDegree(parts.number) - 1];
  return ROLE_BY_SEMITONE[(chroma - rootPc + 12) % 12];
}

/**
 * The figure to print on a pitch the naming covers: `'4'` on a suspended
 * fourth, `'7'` on a diminished seventh, `'6'` on a sixth, `'b9'` / `'#9'` /
 * `'#11'` / `'b13'` on an altered extension, `'b5'` / `'#5'` on an altered
 * fifth. ASCII only, always — the mark is the second channel the whole design
 * rests on, and it has to survive a greyscale print and a font that has never
 * heard of a musical symbol.
 */
function degreeLabelFor(parts: IntervalParts): string {
  const simple = simpleDegree(parts.number);
  if (simple === 1) return TONE_MARKS.root;
  // A ninth, an eleventh and a thirteenth print as themselves; any other
  // compound (a tenth, a twelfth) prints as the simple degree it doubles.
  const shown = parts.number === 9 || parts.number === 11 || parts.number === 13 ? parts.number : simple;
  const accidental = FIGURED_DEGREES.has(simple) ? accidentalText(parts.offset) : '';
  return `${accidental}${shown}`;
}

/** 1…7 for any interval number: 9 asks what 2 asks, 13 what 6 does. */
function simpleDegree(value: number): number {
  return ((value - 1) % 7) + 1;
}

// ---------------------------------------------------------------------------
// Entry points
// ---------------------------------------------------------------------------

/**
 * Name a set of sounding MIDI numbers and give every pitch a spelling, a
 * stave position and a role.
 *
 * Non-finite inputs are dropped, the rest are rounded, sorted ascending and
 * deduped by MIDI number. Detection sees one name per PITCH CLASS, lowest
 * occurrence winning, because `detect()` reads `source[0]` as the bass —
 * `['C','E','G','A']` is `C6` and `['A','C','E','G']` is `Am7`, same notes.
 */
export function spellChord(midis: readonly number[], options: SpellChordOptions = {}): ChordSpelling {
  const pitches = normalizeMidis(midis).map((midi) => ({midi}));
  return memoized(`M|${pitches.map((p) => p.midi).join(',')}`, pitches, options);
}

/**
 * The notated sibling of {@link spellChord}: each note keeps the spelling the
 * score wrote, so F#4 and Gb4 stay different pitches on different lines and
 * `options.spelling` is ignored.
 */
export function spellChordNotes(notes: readonly Note[], options: SpellChordOptions = {}): ChordSpelling {
  const pitches = notes
    .filter(isPitchedNote)
    .map((note) => ({
      midi: Math.round(noteMidi(note)),
      step: String(note.pitch.step),
      alter: Number(note.pitch.alter),
      octave: Number(note.pitch.octave),
    }))
    .filter((pitch) => Number.isFinite(pitch.midi) && Number.isFinite(pitch.alter) && Number.isFinite(pitch.octave))
    .sort((a, b) => a.midi - b.midi);
  // Deduped BEFORE the key is built, or two calls that differ only by an
  // octave doubling take two cache entries to hold one answer.
  const kept = dedupeByMidi(pitches);
  const key = `N|${kept.map((p) => `${p.midi}:${p.step}${p.alter}:${p.octave}`).join(',')}`;
  return memoized(key, kept, options);
}

// ---------------------------------------------------------------------------
// Memoization
// ---------------------------------------------------------------------------

// Deliberately smaller than `chords.ts`'s own DETECT_CACHE_LIMIT of 10000: a
// cached value there is one string, here it is an object graph of a dozen
// frozen records. The strategy is the same — clear the whole map on overflow,
// which costs one allocation instead of an eviction order nobody reads — but
// it is a deliberate echo of that policy, not a copy of that number.
const SPELLING_CACHE_LIMIT = 4096;
const spellingCache = new Map<string, ChordSpelling>();

function memoized(inputKey: string, pitches: readonly RawPitch[], options: SpellChordOptions): ChordSpelling {
  const cacheKey = `${inputKey}|${policyKey(options)}`;
  const cached = spellingCache.get(cacheKey);
  if (cached !== undefined) return cached;
  const result = spell(pitches, options);
  if (spellingCache.size >= SPELLING_CACHE_LIMIT) spellingCache.clear();
  spellingCache.set(cacheKey, result);
  return result;
}

// JSON, not a joined string: `prefer` and `key.tonic` are caller-supplied, so
// a separator they happen to contain would alias two policies onto one cache
// entry and hand the second caller the first one's answer.
function policyKey(options: SpellChordOptions): string {
  return JSON.stringify([
    options.spelling ?? 'auto',
    options.key === undefined ? null : [options.key.tonic, options.key.mode],
    options.prefer ?? '',
    options.includeRootless === true,
    maxNamings(options),
  ]);
}

function maxNamings(options: SpellChordOptions): number {
  const value = options.maxNamings;
  if (typeof value !== 'number' || !Number.isFinite(value)) return 8;
  return Math.max(1, Math.round(value));
}

// ---------------------------------------------------------------------------
// The spelling pass
// ---------------------------------------------------------------------------

interface RawPitch {
  readonly midi: number;
  readonly step?: string;
  readonly alter?: number;
  readonly octave?: number;
}

interface Candidate {
  /** What a read-out prints. The caller's own spelling of it, when it came from `prefer`. */
  readonly symbol: string;
  /** Parsed once, here, and read by everything downstream. See {@link parseChord}. */
  readonly chord: TonalChord;
  readonly rootless: boolean;
}

/** One pass of "ask this table, see what comes back". See {@link readWith}. */
interface Reading {
  readonly table: readonly string[];
  readonly detectNames: readonly string[];
  readonly chromas: readonly number[];
  readonly candidates: Candidate[];
}

function readWith(pitches: readonly RawPitch[], table: readonly string[], options: SpellChordOptions): Reading {
  // One name per pitch class, lowest occurrence winning — the same walk as
  // `identifyChordFromMidi` in `chords.ts`, because detect() reads the first
  // entry as the bass and an octave doubling invents candidates.
  const detectNames: string[] = [];
  const chromas: number[] = [];
  const seen = new Set<number>();
  for (const pitch of pitches) {
    const chroma = pitchClass(pitch.midi);
    if (seen.has(chroma)) continue;
    seen.add(chroma);
    chromas.push(chroma);
    detectNames.push(pitch.step === undefined ? table[chroma] : notatedName(pitch));
  }
  return {table, detectNames, chromas, candidates: findCandidates(detectNames, chromas, table, options)};
}

/**
 * How many of the primary naming's notes carry a DOUBLE accidental — the one
 * measure that tells the two tables apart in a read-out with no key.
 */
function doubleAccidentals(reading: Reading): number {
  const primary = reading.candidates[0];
  if (primary === undefined) return 0;
  return primary.chord.notes.filter((name) => name.includes('##') || name.includes('bb')).length;
}

/**
 * `'auto'` with no key: ask the sharp table, and if the name that comes back
 * needs a double accidental, ask the flat one too and keep the tidier answer.
 *
 * Without this the live note-on path — the one path that has no key to go on —
 * hears D#-G-A# and writes `D#M`, spelled `D# F## A#`: a double sharp on a
 * natural key for a chord every musician reads as E-flat major. Measured over
 * all 12144 closed voicings of every 3–6 note pitch-class set the retry fires
 * 1065 times, improves 845 of those and makes 0 worse, and it cannot fire at
 * all until the first answer already has a double accidental in it.
 *
 * Skipped whenever the caller has already chosen a side (`'sharp'`, `'flat'`,
 * or a `key`), and whenever any pitch arrived notated — `spellChordNotes` is
 * not allowed to second-guess the score.
 */
function tidierReading(pitches: readonly RawPitch[], first: Reading, options: SpellChordOptions): Reading {
  const spelling = options.spelling ?? 'auto';
  if (spelling !== 'auto' || options.key !== undefined) return first;
  if (doubleAccidentals(first) === 0) return first;
  if (pitches.some((pitch) => pitch.step !== undefined)) return first;
  const other = first.table === FLAT_NAMES ? SHARP_NAMES : FLAT_NAMES;
  const second = readWith(pitches, other, options);
  return doubleAccidentals(second) < doubleAccidentals(first) ? second : first;
}

function spell(pitches: readonly RawPitch[], options: SpellChordOptions): ChordSpelling {
  const {table, detectNames, chromas, candidates} = tidierReading(
    pitches,
    readWith(pitches, fallbackTable(options), options),
    options,
  );
  const namings = buildNamings(candidates, maxNamings(options), chromaKey(chromas));
  const primary = namings[0];
  const primaryChord = primary === undefined ? undefined : candidates[0].chord;

  const spellByChroma = spellingMap(primaryChord);
  const chordIntervals = primaryChord === undefined
    ? undefined
    : intervalsByChroma(primary.symbol, primaryChord);
  const rootPc = primary?.rootPitchClass;
  const signature = options.key === undefined ? EMPTY_ALTERS : keySignatureAlters(options.key);

  const spelled: SpelledPitch[] = pitches.map((pitch, index) => {
    const chroma = pitchClass(pitch.midi);
    const {step, alter, octave} = pitch.step === undefined
      ? respell(pitch.midi, spellByChroma[chroma] ?? table[chroma])
      : {step: pitch.step, alter: pitch.alter ?? 0, octave: pitch.octave ?? 0};
    const interval = chordIntervals === undefined || rootPc === undefined
      ? undefined
      : chordIntervals.get((chroma - rootPc + 12) % 12);
    const {role, degreeLabel} = figureFor(chroma, rootPc, index === 0, interval);
    // The signature already draws this letter's alteration, so the note draws
    // nothing; anything else it draws, a natural included.
    const accidental = alter === (signature[step] ?? 0) ? undefined : accidentalForAlter(alter, true);
    return Object.freeze({
      midi: pitch.midi,
      name: `${step}${accidentalText(alter)}${octave}`,
      step,
      alter,
      octave,
      pitchClass: chroma,
      diatonic: diatonicOf(step, octave),
      role,
      degreeLabel,
      // An absent accidental and an absent figure stay ABSENT; neither may
      // become `: undefined`, which reads as a present key to anything that
      // walks the object — `'accidental' in pitch`, `Object.keys`, a diff.
      ...(accidental === undefined ? {} : {accidental}),
      ...(interval === undefined ? {} : {interval}),
    });
  });

  return Object.freeze({
    pitches: Object.freeze(spelled),
    namings: Object.freeze(namings),
    ...(primary === undefined ? {} : {primary}),
    label: primary?.symbol ?? (spelled.length > 0 ? detectNames.join(' ') : NO_CHORD_LABEL),
  });
}

// ---------------------------------------------------------------------------
// Candidates
// ---------------------------------------------------------------------------

// Chord types that exist only as a spelling artifact of rooting a set on the
// wrong pitch. `m#5` is a root, a minor third and an AUGMENTED fifth — E-G-B#
// — which is a first-inversion C major triad wearing a double accidental, and
// no lead sheet writes it. detect() ranks it first anyway, because it weights
// root position 1 and an inversion 0.5, so left alone EVERY first-inversion
// major triad in the language comes back as `Xm#5` and the stave moves with
// the spelling: `[64,67,72]` reads `Em#5` and draws E-G-B#, not C/E.
//
// Demoted, not dropped — it stays in the list as an alternate. And the list is
// short by MEASUREMENT: over all 12144 closed voicings of every 3–6 note
// pitch-class set, this is the only chord type that reaches rank 0 with an
// ordinary chord waiting behind it (16 cases: 12 first inversions and 4
// second). `D7no5/C` beating `D7/C` is NOT one of them — with
// `assumePerfectFifth` on, `no5` is the honest name of the two.
const DEMOTED_TYPES: ReadonlySet<string> = new Set(['minor augmented']);

/**
 * @internal Naming-only entry shared by the direct APIs and spelling projection.
 * Keeps caller-provided pitch names; does not compute roles, staff or fret data.
 */
export function identifyNamedChord(names: readonly string[], chromas: readonly number[]): string | undefined {
  return findCandidates(names, chromas, [], {})[0]?.symbol;
}

function findCandidates(
  detectNames: readonly string[],
  chromas: readonly number[],
  table: readonly string[],
  options: SpellChordOptions,
): Candidate[] {
  const candidates: Candidate[] = [];
  const claimed = new Set<string>();
  // Every candidate is parsed exactly once, here, and carried; nothing
  // downstream re-reads a symbol string.
  const keep = (symbol: string, rootless: boolean): void => {
    if (symbol === '') return;
    const chord = parseChordSymbol(symbol);
    if (chord.empty || !covers(chord, chromas)) return;
    const identity = chordIdentity(chord);
    if (claimed.has(identity)) return;
    claimed.add(identity);
    candidates.push({symbol: chord.symbol === '' ? symbol : chord.symbol, chord, rootless});
  };

  for (const symbol of detect([...detectNames], {assumePerfectFifth: true})) keep(symbol, false);
  // detect()'s order, with the artifacts moved to the back of it. Stable, so
  // nothing else changes place.
  candidates.sort((a, b) => Number(DEMOTED_TYPES.has(a.chord.type)) - Number(DEMOTED_TYPES.has(b.chord.type)));
  if (options.includeRootless === true) {
    for (const symbol of rootlessCandidates(detectNames, chromas, table)) keep(symbol, true);
  }

  // A preferred symbol Tonal can parse and that names something sounding always
  // makes the list, even when detect() never offered it — that is how a caller
  // forces a respelling. The CALLER's spelling of it wins: `prefer: 'C'` prints
  // `C`, and the `CM` detect() offered for the same chord is not listed twice.
  const wanted = options.prefer ?? '';
  if (wanted === '') return candidates;
  const chord = parseChordSymbol(wanted);
  if (chord.empty || !preferable(chord, chromas)) return candidates;
  const identity = chordIdentity(chord);
  const duplicate = candidates.findIndex((candidate) => chordIdentity(candidate.chord) === identity);
  if (duplicate >= 0) candidates.splice(duplicate, 1);
  candidates.unshift({symbol: chord.symbol === '' ? wanted : chord.symbol, chord, rootless: false});
  return candidates;
}

/**
 * Does this chord account for every sounding pitch class?
 *
 * SUBSET, not equality: `assumePerfectFifth` correctly names C-E-B `Cmaj7`,
 * and 742 legitimate namings in the language are that shape. What it rejects
 * is a name that leaves a sounding pitch unexplained, which in practice is
 * always the same accident — a symbol whose own accidental gets re-read as
 * part of the tonic, `Cb9sus` parsed back as a C-FLAT chord.
 */
function covers(chord: TonalChord, chromas: readonly number[]): boolean {
  const covered = new Set<number>();
  for (const name of chord.notes) {
    const chroma = nameToChroma(name);
    if (chroma !== undefined) covered.add(chroma);
  }
  return chromas.every((chroma) => covered.has(chroma));
}

/** Whether a caller-preferred symbol names anything that is actually sounding. */
function preferable(chord: TonalChord, chromas: readonly number[]): boolean {
  const rootPc = chord.tonic == null ? undefined : nameToChroma(chord.tonic);
  return (rootPc !== undefined && chromas.includes(rootPc)) || covers(chord, chromas);
}

/**
 * Two symbols name the same chord when they agree on the root, the bass and
 * the spelled notes — `'C'` and `'CM'` do, `'C7b13'` and `'C11b9'` do not,
 * though Tonal gives both of those an empty `type` and the same tonic.
 */
function chordIdentity(chord: TonalChord): string {
  return JSON.stringify([chord.tonic ?? '', chord.bass, chord.notes]);
}

/**
 * Tonal's `get()`, plus the one symbol shape its own `detect()` emits and it
 * cannot read back.
 *
 * `detect(['D#','G','B','C'])` returns `'Cm/ma7/D#'` — a slash bass appended to
 * a type whose alias already contains a slash — and `get('Cm/ma7/D#')` is
 * `empty`. Every inversion of a minor-major seventh arrives that way, so
 * without this the tonic chord of harmonic minor cannot be named in any
 * voicing but root position: 36 of its 37. Split at the LAST slash, and only
 * when the tail is a pitch class, or `'Cm/ma7'` itself would be read as a C
 * minor triad over a bass called `ma7`.
 */
/** @internal Shared parsing of Tonal detection's slash-bearing minor-major aliases. */
export function parseChordSymbol(symbol: string): TonalChord {
  const direct = tonalChord(symbol);
  if (!direct.empty) return direct;
  const head = headOf(symbol);
  if (head === undefined || head.chord.empty || head.chord.tonic == null) return direct;
  return tonalChordOfType(head.chord.type, head.chord.tonic, head.bass);
}

/** A slash symbol taken apart, when its tail really is a bass note. */
function headOf(symbol: string): {chord: TonalChord; bass: string} | undefined {
  const cut = symbol.lastIndexOf('/');
  if (cut <= 0) return undefined;
  const bass = symbol.slice(cut + 1);
  if (parseName(bass) === undefined) return undefined;
  return {chord: tonalChord(symbol.slice(0, cut)), bass};
}

/**
 * Namings whose ROOT is absent from the sounding set.
 *
 * One `detect()` per absent pitch class, with that class placed FIRST so Tonal
 * assumes it as the bass and therefore roots the chord on it. Results that
 * still carry a slash bass are dropped: a name like `Cmaj9/D` would claim a
 * bass note that is not being played, which is a lie rather than a reading.
 * What survives is exactly the rootless voicing — C-E-G-B offers `Am9`.
 *
 * Bounded to sets of 3…7 pitch classes. Below three, adding a class would be
 * guessing at most of the chord; above seven the readings stop being useful
 * and a symmetric set (a diminished seventh) sprouts one per transposition.
 */
function rootlessCandidates(
  detectNames: readonly string[],
  chromas: readonly number[],
  table: readonly string[],
): string[] {
  if (chromas.length < 3 || chromas.length > 7) return [];
  const sounding = new Set(chromas);
  const found: string[] = [];
  for (let chroma = 0; chroma < 12; chroma += 1) {
    if (sounding.has(chroma)) continue;
    for (const symbol of detect([table[chroma], ...detectNames], {assumePerfectFifth: true})) {
      const chord = parseChordSymbol(symbol);
      if (chord.bass !== '' || chord.tonic == null) continue;
      if (nameToChroma(chord.tonic) !== chroma) continue;
      found.push(symbol);
    }
  }
  return found;
}

function buildNamings(candidates: readonly Candidate[], limit: number, sounding: string): ChordNaming[] {
  const namings: ChordNaming[] = [];
  const ids = new Set<string>();

  for (const candidate of candidates.slice(0, limit)) {
    const {chord, symbol} = candidate;
    const id = uniqueId(namingId(symbol), ids);
    const rank = namings.length;
    const root = chord.tonic ?? '';
    const rootPitchClass = nameToChroma(root);
    const bass = chord.bass === '' ? undefined : chord.bass;
    const bassPitchClass = bass === undefined ? undefined : nameToChroma(bass);
    namings.push(Object.freeze({
      id,
      symbol,
      root,
      ...(rootPitchClass === undefined ? {} : {rootPitchClass}),
      ...(bass === undefined ? {} : {bass}),
      ...(bassPitchClass === undefined ? {} : {bassPitchClass}),
      quality: chord.quality,
      // `name` is `${tonic} ${type}`, so an empty type gives `'C '` — not `''`,
      // which is why the test is on the TYPE.
      fullName: chord.type.trim() === '' ? symbol : chord.name,
      kind: classify(candidate, rank, chord.bass, chord.notes, sounding),
      rank,
    }));
  }
  return namings;
}

/**
 * Which bucket a naming falls in, derived and never guessed:
 *  - `'primary'`    — it is first.
 *  - `'rootless'`   — its root is not sounding (see {@link rootlessCandidates}).
 *  - `'inversion'`  — it names a bass, i.e. its symbol carries a slash.
 *  - `'enharmonic'` — it covers exactly the same pitch classes under a
 *                     different name (`Dbmaj7` beside `C#maj7`).
 *  - `'alias'`      — anything else, which in practice is a caller-preferred
 *                     symbol that is neither an inversion nor an exact
 *                     respelling of what is sounding.
 */
function classify(
  candidate: Candidate,
  rank: number,
  bass: string,
  notes: readonly string[],
  sounding: string,
): ChordNamingKind {
  if (rank === 0) return 'primary';
  if (candidate.rootless) return 'rootless';
  if (bass !== '') return 'inversion';
  const covered = notes.map(nameToChroma).filter((chroma): chroma is number => chroma !== undefined);
  return chromaKey(covered) === sounding ? 'enharmonic' : 'alias';
}

/** A pitch-class set as one comparable string. Deduped and ascending. */
function chromaKey(chromas: readonly number[]): string {
  return [...new Set(chromas)].sort((a, b) => a - b).join(',');
}

function namingId(symbol: string): string {
  return symbol
    .replace(/#/g, 's')
    .replace(/\//g, '_')
    .replace(/[^A-Za-z0-9_]+/g, '-')
    .toLowerCase();
}

function uniqueId(base: string, taken: Set<string>): string {
  const seed = base === '' ? 'chord' : base;
  let id = seed;
  let suffix = 2;
  while (taken.has(id)) {
    id = `${seed}-${suffix}`;
    suffix += 1;
  }
  taken.add(id);
  return id;
}

// ---------------------------------------------------------------------------
// Spelling
// ---------------------------------------------------------------------------

function fallbackTable(options: SpellChordOptions): readonly string[] {
  if (options.spelling === 'flat') return FLAT_NAMES;
  if (options.spelling === 'sharp') return SHARP_NAMES;
  return options.key !== undefined && keyPrefersFlats(options.key) ? FLAT_NAMES : SHARP_NAMES;
}

// The major keys written with flats are F Bb Eb Ab Db Gb Cb. Only F has a
// natural tonic — every other one carries a `b` and is caught above — so this
// table exists for the MINOR keys, which are checked through their relative
// major three semitones up: D minor is F major and takes flats, B minor is D
// major and does not. B (chroma 11) is deliberately absent: B major signs five
// sharps, and Cb major spells its own tonic with a flat.
const FLAT_MAJOR_CHROMAS: ReadonlySet<number> = new Set([1, 3, 5, 6, 8, 10]);

function keyPrefersFlats(key: Key): boolean {
  if (key.tonic.includes('b')) return true;
  if (key.tonic.includes('#')) return false;
  const chroma = nameToChroma(key.tonic);
  if (chroma === undefined) return false;
  return FLAT_MAJOR_CHROMAS.has(key.mode === 'minor' ? (chroma + 3) % 12 : chroma);
}

/**
 * Chroma to spelling, taken from the primary naming's own note list — under
 * EVERY {@link SpellingPreference}, because the preference chooses the naming
 * and the naming spells. See {@link SpellChordOptions.spelling}.
 */
function spellingMap(primary: TonalChord | undefined): Readonly<Record<number, string>> {
  if (primary === undefined) return {};
  const map: Record<number, string> = {};
  for (const name of primary.notes) {
    const chroma = nameToChroma(name);
    // First occurrence wins: `Em#5/C` lists both `C` and `B#`, and the list's
    // own order is the only ranking Tonal offers between them.
    if (chroma !== undefined && map[chroma] === undefined) map[chroma] = name;
  }
  return map;
}

/** The signature of a read-out with no key on it: nothing is pre-altered. */
const EMPTY_ALTERS: Readonly<Record<string, number>> = Object.freeze({});

/** The letter, alteration and octave a chosen pitch-class name gives a MIDI number. */
function respell(midi: number, name: string): {step: string; alter: number; octave: number} {
  const parsed = parseName(name);
  if (parsed === undefined) return respell(midi, SHARP_NAMES[pitchClass(midi)]);
  // A spelling can cross the octave line: B#3 and C4 are one key, and Cb4 is
  // B3. Derive the octave from the LETTER's natural semitone, never from the
  // MIDI number alone, or every such pitch lands an octave out on the stave.
  const octave = (midi - parsed.alter - parsed.natural) / 12 - 1;
  if (!Number.isInteger(octave)) return respell(midi, SHARP_NAMES[pitchClass(midi)]);
  return {step: parsed.step, alter: parsed.alter, octave};
}

const NATURAL_SEMITONE: Readonly<Record<string, number>> = Object.freeze({
  C: 0,
  D: 2,
  E: 4,
  F: 5,
  G: 7,
  A: 9,
  B: 11,
});

function parseName(name: string): {step: string; alter: number; natural: number} | undefined {
  const match = /^([A-Ga-g])(#{1,3}|b{1,3})?$/.exec(name.trim());
  if (!match) return undefined;
  const step = match[1].toUpperCase();
  const accidentals = match[2] ?? '';
  // The empty case spelled out, because `-accidentals.length` on an empty
  // string is NEGATIVE ZERO — which `=== 0` accepts, `Object.is` rejects, and
  // a caller diffing two placements would see as a difference that is not one.
  const alter = accidentals === '' ? 0 : accidentals.startsWith('#') ? accidentals.length : -accidentals.length;
  return {step, alter, natural: NATURAL_SEMITONE[step]};
}

function nameToChroma(name: string): number | undefined {
  const parsed = parseName(name);
  return parsed === undefined ? undefined : (((parsed.natural + parsed.alter) % 12) + 12) % 12;
}

function accidentalText(alter: number): string {
  if (!Number.isFinite(alter) || alter === 0) return '';
  return alter > 0 ? '#'.repeat(Math.round(alter)) : 'b'.repeat(Math.round(-alter));
}

function notatedName(pitch: RawPitch): string {
  return `${pitch.step}${accidentalText(pitch.alter ?? 0)}`;
}

// ---------------------------------------------------------------------------
// Intervals
// ---------------------------------------------------------------------------

const MAJOR_STEPS = [0, 2, 4, 5, 7, 9, 11] as const;

/**
 * Semitones above the root to the figure the chord itself writes there.
 *
 * Read from the ROOT-POSITION chord: a slash symbol's own `intervals` are
 * bass-relative and compound (`get('Am7/C').intervals` is
 * `["3m","5P","7m","8P"]`), which would label the root an octave.
 */
function intervalsByChroma(symbol: string, chord: TonalChord): ReadonlyMap<number, string> {
  const map = new Map<number, string>();
  for (const interval of rootPositionIntervals(symbol, chord)) {
    const parts = parseInterval(interval);
    if (parts === undefined || parts.semitones < 0) continue;
    const chroma = parts.semitones % 12;
    if (!map.has(chroma)) map.set(chroma, interval);
  }
  return map;
}

/** The named chord's figures counted from its ROOT, whatever is in the bass. */
function rootPositionIntervals(symbol: string, chord: TonalChord): readonly string[] {
  if (chord.bass === '') return chord.intervals;
  if (chord.type !== '' && chord.tonic != null) return tonalChordOfType(chord.type, chord.tonic).intervals;
  // A chord Tonal can spell but has no type name for cannot be rebuilt from
  // one — but the symbol's own head IS the root-position chord:
  // `get('D7no5').intervals` is `['1P','3M','7m']` where `get('D7no5/C')` gives
  // the bass-relative `['7m','8P','10M']` and would call the root an octave.
  const head = headOf(symbol);
  return head !== undefined && !head.chord.empty ? head.chord.intervals : chord.intervals;
}

/** One figure, taken apart. See {@link roleFor} and {@link degreeLabelFor}. */
interface IntervalParts {
  /** The figure's number. NOT reduced: a `'13m'` stays a 13, not a 6. */
  readonly number: number;
  /** Semitones away from that number's reference — major, or perfect for 1/4/5. */
  readonly offset: number;
  /** Semitones above the root, signed. */
  readonly semitones: number;
}

function parseInterval(interval: string): IntervalParts | undefined {
  const match = /^(-?)(\d+)(P|M|m|A{1,3}|d{1,3})$/.exec(interval);
  if (!match) return undefined;
  const number = Number(match[2]);
  if (!Number.isInteger(number) || number < 1) return undefined;
  const simple = (number - 1) % 7;
  const base = MAJOR_STEPS[simple] + 12 * Math.floor((number - 1) / 7);
  const quality = match[3];
  const perfect = simple === 0 || simple === 3 || simple === 4;
  let offset: number;
  if (quality === 'P' || quality === 'M') offset = 0;
  else if (quality === 'm') offset = perfect ? Number.NaN : -1;
  else if (quality.startsWith('A')) offset = quality.length;
  else offset = perfect ? -quality.length : -(quality.length + 1);
  if (!Number.isFinite(offset)) return undefined;
  const value = base + offset;
  return {number, offset, semitones: match[1] === '-' ? -value : value};
}

// ---------------------------------------------------------------------------
// Input hygiene
// ---------------------------------------------------------------------------

function normalizeMidis(midis: readonly number[]): number[] {
  const clean = midis.filter((midi) => Number.isFinite(midi)).map((midi) => Math.round(midi));
  clean.sort((a, b) => a - b);
  return [...new Set(clean)];
}

function dedupeByMidi<T extends RawPitch>(pitches: readonly T[]): T[] {
  const seen = new Set<number>();
  return pitches.filter((pitch) => {
    if (seen.has(pitch.midi)) return false;
    seen.add(pitch.midi);
    return true;
  });
}
