// ============================================================================
// Fretboard voicing — where a hand can TAKE a chord, and what each dot means.
//
// Two questions live here and they are deliberately two functions.
//
// {@link fretPositionsFor} is ARITHMETIC: given one MIDI number, every
// (string, fret) inside a window that sounds it. A presenter may own that
// much, and `@webmusic/ui` publishes the same function under the same
// signature so a diagram and this search cannot disagree about what a window
// is.
//
// {@link fretboardVoicing} is THEORY, and it is why this module sits in score
// rather than in the kit: it reads a {@link ChordSpelling} — the SAME object
// the keyboard and the stave read — so a sounding C# carries one role, one
// mark and one colour on all three surfaces. A fretboard that re-derived roles
// from bare MIDI numbers would be a fourth opinion about the same chord, and
// the reader would be the one who had to reconcile them.
//
// Nothing in this repo could be reused. vexflow ships a tuning table
// (`src/tuning.js`) and it is unreachable: vexflow is a transitive of the
// OPTIONAL peer opensheetmusicdisplay and `devOptional` in the lock file, so a
// published consumer may not have it installed at all. Tables and search are
// written fresh here, with no new dependency.
//
// ## The point of a fretboard read-out is a shape a player can TAKE
//
// A shape no hand can form is worse than no shape: it is a confident wrong
// answer, and a musician spots it in one glance. So the search enumerates
// every combination of {mute, open, a fret in the window} the position offers
// and keeps only the ones a hand can actually hold. Six strings, a window five
// frets wide and thirteen positions is a small enough space to walk with
// pruning; the alternative — one greedy pass taking the lowest chord tone on
// each string — cannot express a muted string as a CHOICE, and every idiomatic
// voicing there is mutes a string that had a chord tone available.
//
// ### The rules a candidate must survive
//
// R1. Every sounding string is a chord tone of the naming. No passing tones.
// R2. The lowest sounding pitch BY MIDI — not by string index, the ukulele's
//     re-entrant G string is a fifth above its neighbour — carries the
//     naming's bass, or its root when the name plate declares no slash, unless
//     the string sounding under it is one no hand could have muted (see
//     below). This is the rule that stops `C` from answering `0-3-2-0-1-0`,
//     which is `C/E` under a name plate reading `C`.
// R3. An open or muted string may cut a finger in two, but then nothing
//     between the halves may be stopped HIGHER. `1-0-3-2-1-1` is the case: the
//     open A cuts the F barre into a finger on the low E and a finger on the
//     top two strings, with frets 3 and 2 stopped between them, and no hand
//     reaches around its own fingers like that. Two fingers at one fret with
//     an open string between and nothing higher is fine and common —
//     `x-0-2-0-2-0` is A7 — and so is one with a LOWER fret between: that
//     finger lies in front of them, which is exactly the standard D,
//     `x-x-0-2-3-2`, fingered 1-3-2.
// R4. A legal fingering must EXIST, with four fingers. That is why
//     `3-2-2-4-1-3` — the shape the first draft of this module answered Cmaj7
//     with — is not in the answer set at all. {@link FretDot.finger} stopped
//     being advice and became a checked property.
// R5. Span within one hand ({@link FretboardVoicingOptions.span}, counting its
//     own lowest fret), and the root — plus the slash bass, when there is one
//     — actually sounding.
// R6. The sounding strings are CONTIGUOUS. A hand mutes from the edges of the
//     board — it lays a finger over the low strings, or lets the picking hand
//     miss them — and damping one string in the middle of a strum is a
//     separate skill this diagram cannot teach. It is also what keeps a
//     re-entrant ukulele honest: `5-x-5-7` puts A underneath for Am and would
//     otherwise beat the `2-0-0-0` every player takes.
// R7. Only the INDEX may lie flat with other fingers standing on it. A finger
//     laid across strings stopped higher up is a barre, the hand's lowest
//     fret, and the one the wrist is built around; a MIDDLE finger barring
//     five strings with the index stranded at a lower fret on the far side of
//     it — `2-4-3-3-2-1`, which is what this search used to answer F#maj7 with
//     — is a hand shape nobody has. This is the rule that sends the black-key
//     roots up to the barre chord a player actually takes.
// R8. Two fingers holding ONE fret may not have too much standing between
//     them. The hand cannot splay around its own fingers: `4-3-1-1-1-4` asks
//     for the ring on the low E and the pinky on the high E, both at fret 4,
//     with an index barre at fret 1 and the middle in the gap. Open and muted
//     strings between are free space and cost nothing, which is why
//     `3-2-0-0-0-3` — the G every beginner learns, two fingers at fret 3 five
//     strings apart — is not caught by this; a fretted one costs, and a finger
//     tucked far in FRONT of the pair costs double. {@link handHolds} is where
//     the counting is, with the chords each threshold is set by.
//
// R2 is hard for a DECLARED slash bass: `Cmaj7/E` with a G underneath is a
// different chord printed under the same name plate, so a position that cannot
// put E at the bottom has no shape rather than a wrong one. For a plain
// symbol's ROOT it is the ranking key directly under coverage instead of a
// filter, which on a guitar is the same thing — the shapes it chooses between
// sound the same pitch classes and so tie on coverage first, and `x-3-2-0-1-0`
// beats `0-3-2-0-1-0` on that one key. It is a ranking key rather than a
// filter because of the re-entrant ukulele: its C string sounds UNDER
// everything a hand can reach, so putting the root of `Am` underneath costs
// the third and half the chord, and a rule that took that trade would answer
// the instrument beginners actually own with shapes no uke book prints.
//
// And the rule asks only for what a hand could have DONE. R6 mutes from the
// edges, so a string sounding below the root while lying INSIDE the run of
// sounding strings is not an inversion anybody chose — it is the uke's C
// string, and `2-0-0-0` counts as root-underneath because silencing it was
// never on offer. On every tuning here whose strings ascend, the lowest
// sounding string is the bottom edge of the run and that clause is dead.
//
// ### How the survivors are ranked, best first
//
//   1. more of the chord, WEIGHTED — the third and the seventh are the guide
//      tones and are worth more than the fifth, so a voicing that drops the
//      fifth to keep the seventh wins and one missing the third loses to one
//      missing the fifth. Adding a tone always adds weight, so this is still
//      "more chord tones covered", only with a tiebreak inside each count.
//      The root's and the slash bass's weights are constants: R5 requires them
//      of every survivor, so they cannot move the ranking.
//   2. R2 — the root underneath (see above).
//   3. more open strings. An open string is free, it rings, and it is what
//      makes a first-position shape the one a player reaches for. It is what
//      settles `Cmaj7/E` — `0-3-2-0-0-0` against the `0-2-2-0-1-0` a fret
//      lower — and it is why the six-string E-shape C at the 8th fret never
//      beats the open C.
//   4. lower position, measured as the highest fret the hand has to REACH —
//      not the lowest one it happens to land on. Those are different numbers
//      and the difference decides real chords: a shape holding frets 1 to 4 is
//      not "first position", it is a hand at fret 4 with a stretch back to the
//      nut, and ranking it under a clean barre at fret 4 is how the search used
//      to answer every black-key root with a shape nobody plays. A shape with
//      an open string in it is first position whatever else it holds, which is
//      the same collapse {@link FretboardVoicing.firstFret} makes and is what
//      keeps the open ukulele C at four strings rather than three. Above the
//      sounding-string count on purpose: Bm barred at the 7th fret sounds all
//      six strings and the 2nd-position shape sounds five, and the second one is
//      still the better answer, because a diagram is something a reader has to
//      find on their own neck.
//   5. more strings sounding.
//   6. lower fret sum, then the frets read left to right — an arbitrary but
//      stable last word, so one chord always draws one diagram.
//
// Open strings belong to FIRST POSITION only. A diagram whose window starts
// above the nut has no nut to draw them at, so the search does not use them
// there either — otherwise every position would quietly answer with the same
// open-string shape.
//
// ## What it deliberately does not model
//
// Hand size, and what came before this chord in the bar.
//
// WHICH finger goes where it does model, because {@link FretDot.finger} and
// {@link FretboardVoicing.barre} are printed on the diagram and a wrong number
// is worse than no number. A player spends one finger per string while there
// are fingers to spare and lays one flat only when something makes them, so
// that is the fingering {@link handFor} looks for first: same-fret strings
// share a finger only when they are ADJACENT — the small barre of
// `x-x-0-2-2-2` — and the flat-out reading, where a finger runs on until a
// lower fret stops it, is the fallback the F barre needs and gets. It is what
// keeps the standard D fingered `1-3-2` instead of being told to barre the G
// and the high E with the B string squeezed in between them.
//
// Groups are numbered from the lowest fret up. The barre is the widest of them
// at the shape's lowest fretted fret, and a shape has one lowest fret, so it
// has at most one barre; several strings sharing a HIGHER fret are an ordinary
// finger, and the A-shape barre chord (`5-7-7-7-5`) proves they have to be
// allowed.
// ============================================================================

import {
  FLAT_NAMES,
  SHARP_NAMES,
  type ChordSpelling,
  type SpelledPitch,
  type SpellingPreference,
  type ToneRole,
} from './chord-spelling';
import {keyFifths} from './staff-placement';
import type {Key} from './types';

/** One instrument's open strings, plus the name a player calls the tuning. */
export interface Tuning {
  /** Stable id: a key of {@link TUNINGS}, or `'custom'` for a parsed MIDI list. */
  readonly id: string;
  /** What a player calls it — `'Standard'`, `'DADGAD'`. Never derived from {@link midis}. */
  readonly name: string;
  /**
   * Open-string MIDI numbers in PHYSICAL string order, thickest string first —
   * the string a diagram draws at its edge, and the one `stringIndex` 0 names.
   *
   * On every tuning here but one that is also ascending pitch. The ukulele is
   * RE-ENTRANT: its fourth string is G4, a FIFTH above the third string's C4,
   * so `midis` is `[67, 60, 64, 69]` and the lowest-SOUNDING string is index
   * 1. Nothing in this module may assume this array is sorted, and nothing may
   * assume six strings — a bass has four and so does a ukulele.
   */
  readonly midis: readonly number[];
  /**
   * The pitch-class name of each open string, same order: `['E','A','D','G','B','E']`.
   * DERIVED from {@link midis}, never a second table that could drift from it.
   * Every tuning below happens to be all naturals, so the sharp table never
   * shows; a custom tuning may well print `A#`.
   */
  readonly labels: readonly string[];
  /**
   * Frets carrying a position dot, ascending: `[3, 5, 7, 9, 12, …]` on a
   * guitar, `[5, 7, 10, 12]` on a ukulele.
   *
   * Strictly a fact about the INSTRUMENT and not about the tuning — a guitar
   * keeps its dots at 3, 5, 7 and 9 in DADGAD as in standard — but the
   * instrument is what this record stands for, and the presenter drawing the
   * neck has nowhere else to read them from.
   */
  readonly inlays: readonly number[];
  /**
   * Highest fret this neck HAS, never above {@link MAX_FRET}.
   *
   * Not every neck is a guitar's. A soprano ukulele stops at fifteen, so a
   * window reaching fret 24 invents an instrument: a Cmaj7 answered
   * `17-19-20-19` is a chord box for a neck nobody is holding.
   */
  readonly frets: number;
}

/**
 * A tuning a caller may hand in whole.
 *
 * The STRINGS are required and everything else is optional, because everything
 * else has an honest default: a name is derived from the strings, and a neck
 * nobody described is a guitar's. {@link Tuning} is assignable to this, so a
 * caller round-tripping one back in needs no changes. `labels` is accepted and
 * IGNORED — it is derived from `midis`, and a second table could only disagree
 * with the first.
 */
export interface TuningInput {
  readonly id?: string;
  readonly name?: string;
  readonly midis: readonly number[];
  readonly labels?: readonly string[];
  readonly inlays?: readonly number[];
  readonly frets?: number;
}

/** What a caller may hand {@link resolveTuning}. */
export type TuningSpec = string | readonly number[] | TuningInput;

/** One place a pitch can be played. */
export interface FretPosition {
  /** Index into {@link Tuning.midis}. `0` is the string drawn at the edge. */
  readonly stringIndex: number;
  /** `0` is the open string. */
  readonly fret: number;
}

/**
 * The frets a hand — or a diagram — is looking at. INCLUSIVE at both ends:
 * `{firstFret: 0, fretCount: 5}` is the open string plus frets 1 to 5, which
 * is exactly what a five-fret diagram with a nut draws.
 */
export interface FretWindow {
  /** The window's first fret. `0` includes the open string. Default `0`. */
  readonly firstFret?: number;
  /** How many frets BEYOND {@link firstFret}. Default `5`. */
  readonly fretCount?: number;
}

/** One dot on the board: where to draw it, and what it is doing in the chord. */
export interface FretDot {
  readonly stringIndex: number;
  /** `0` is the open string, drawn at the nut rather than in a fret cell. */
  readonly fret: number;
  /** What this string actually sounds — `tuning.midis[stringIndex] + fret`. */
  readonly midi: number;
  readonly pitchClass: number;
  /**
   * The chord tone's name WITHOUT an octave: `'C'`, `'F#'`, `'Eb'`. Taken from
   * the spelling, so it agrees with the stave and the key signature.
   *
   * There is no octave here on purpose. A guitar re-octavates freely — the C
   * of a low C3 in the chord may sound as C4 on the board — so the spelled
   * pitch's own octave would be a lie, and re-deriving one for a spelling like
   * `Cb` or `B#` needs the whole scientific-pitch rule for a number nobody
   * prints on a fret dot.
   */
  readonly noteName: string;
  /** Straight off the {@link SpelledPitch} for this pitch class. */
  readonly role: ToneRole;
  /** The figure to print in the dot: `SpelledPitch.degreeLabel`, ASCII. */
  readonly label: string;
  /**
   * Which finger holds this string: `'0'` on an open string, then `'1'`…`'4'`
   * for each finger the shape needs, counted from the lowest fret up.
   *
   * ONE OF WHICH the shape is guaranteed to need no more than, because R4
   * rejects a shape that needs a fifth — so every fretted dot carries a number
   * and the type stays optional only so nothing downstream reads a number off
   * an empty shape. Which finger a PLAYER would choose is still their own
   * business; this is the arithmetic of how many the shape can be held with.
   * See the module header for what counts as one finger.
   */
  readonly finger?: string;
}

/** The one finger laid flat across the shape's lowest fretted fret. */
export interface FretBarre {
  readonly fret: number;
  /** Lowest string index it covers. */
  readonly firstString: number;
  /** Highest string index it covers. Always greater than {@link firstString}. */
  readonly lastString: number;
}

/** One playable shape, and everything a diagram needs to draw it. */
export interface FretboardVoicing {
  /** The tuning the search actually used — the resolved one, never the spec. */
  readonly tuning: Tuning;
  /** One dot per sounding string, ascending by {@link FretDot.stringIndex}. */
  readonly marks: readonly FretDot[];
  /** String indices with nothing to play, ascending. Drawn as `x` over the nut. */
  readonly muted: readonly number[];
  /**
   * The fret a diagram should start at: `0` whenever the shape sounds an open
   * string, since a diagram that draws one needs the nut to draw it at, and
   * otherwise the shape's own lowest fretted fret.
   */
  readonly firstFret: number;
  /** Frets from the lowest FRETTED note to the highest, inclusive. `0` when every string is open. */
  readonly span: number;
  /** Present only when the lowest fret is genuinely barrable. See the module header. */
  readonly barre?: FretBarre;
  /**
   * The shape in the form players write down, lowest string first, `x` for a
   * muted string: `'x-3-2-0-1-0'`, `'1-3-3-2-1-1'`. Empty when no shape was
   * found, which is the honest answer and not a shape of six `x`s.
   */
  readonly label: string;
  /**
   * Chord tones the winning shape does NOT sound, as pitch classes, ascending.
   *
   * A six-string hand cannot always take a thirteenth, and the honest thing is
   * to say which note went rather than to draw five dots and let a reader
   * assume the sixth is in there somewhere. Empty on a shape that sounds the
   * whole chord, and empty on an empty answer — nothing was voiced, so nothing
   * is missing FROM it.
   */
  readonly missing: readonly number[];
}

/** Where to look, and on what. */
export interface FretboardVoicingOptions {
  /** A {@link TUNINGS} key, a MIDI list, or a {@link Tuning}. Unresolvable falls back to standard. */
  readonly tuning?: TuningSpec;
  /** Lowest position the search may sit at. Default `0`, which lets open strings in. */
  readonly firstFret?: number;
  /** Highest fret the search may use at all. Default `12`, clamped to `24`. */
  readonly lastFret?: number;
  /** Frets one hand covers, COUNTING its lowest. Default `4`, clamped to `1`…`5`. */
  readonly span?: number;
  /** Fewest strings a shape must sound. Default `3`, clamped to the string count. */
  readonly minStrings?: number;
}

/** The id {@link fretboardVoicing} falls back to. */
export const DEFAULT_TUNING_ID = 'standard';

// The longest neck anyone builds, and the ceiling every {@link Tuning.frets}
// is clamped to. Declared up here because {@link TUNINGS} is built at module
// load and reads it; the paragraph on what these bounds are FOR sits with
// {@link MAX_SPAN} below.
const MAX_FRET = 24;

// Where the dots go. The guitar family shares one pattern, and it is the one a
// player expects to see; a ukulele's is its own. A bass wears the guitar's.
const GUITAR_INLAYS: readonly number[] = Object.freeze([3, 5, 7, 9, 12, 15, 17, 19, 21, 24]);
const UKULELE_INLAYS: readonly number[] = Object.freeze([5, 7, 10, 12]);
const BASS_INLAYS: readonly number[] = GUITAR_INLAYS;

// A tuning is two facts about the strings — their pitches and what players call
// the set — and two about the neck they are on. Labels are derived, so adding a
// tuning is one line and cannot introduce a name that disagrees with its own
// pitches.
function freezeTuning(
  id: string,
  name: string,
  midis: readonly number[],
  inlays: readonly number[] = GUITAR_INLAYS,
  frets: number = MAX_FRET,
): Tuning {
  const values = Object.freeze(midis.map((midi) => Math.round(midi)));
  return Object.freeze({
    id,
    name,
    midis: values,
    labels: stringLabels(values),
    inlays: Object.freeze([...inlays]),
    frets: clamp(integerOr(frets, MAX_FRET), 1, MAX_FRET),
  });
}

/**
 * The tunings this repo answers for, lowest string first.
 *
 * Standard, drop D, DADGAD and open G are six-string guitar; `bass` is a
 * four-string bass in fourths; `ukulele` is the standard RE-ENTRANT high-G
 * soprano tuning, whose first entry is NOT its lowest pitch. See
 * {@link Tuning.midis}.
 */
export const TUNINGS: Readonly<Record<string, Tuning>> = Object.freeze({
  standard: freezeTuning('standard', 'Standard', [40, 45, 50, 55, 59, 64]), // E2 A2 D3 G3 B3 E4
  'drop-d': freezeTuning('drop-d', 'Drop D', [38, 45, 50, 55, 59, 64]), // D2 A2 D3 G3 B3 E4
  dadgad: freezeTuning('dadgad', 'DADGAD', [38, 45, 50, 55, 57, 62]), // D2 A2 D3 G3 A3 D4
  'open-g': freezeTuning('open-g', 'Open G', [38, 43, 50, 55, 59, 62]), // D2 G2 D3 G3 B3 D4
  // A soprano ukulele's body starts at twelve and its neck stops at fifteen.
  ukulele: freezeTuning('ukulele', 'Ukulele', [67, 60, 64, 69], UKULELE_INLAYS, 15), // G4 C4 E4 A4, re-entrant
  bass: freezeTuning('bass', 'Bass', [28, 33, 38, 43], BASS_INLAYS), // E1 A1 D2 G2
});

// An instrument nobody builds is a typo, and a MIDI number outside the piano
// is a parse that went wrong. Both are better reported as "unresolvable" than
// drawn: the element warns once and falls back, which a thrown error would
// turn into a blank card.
const MIN_TUNING_STRINGS = 2;
const MAX_TUNING_STRINGS = 12;
const LOWEST_MIDI = 0;
const HIGHEST_MIDI = 127;

const DEFAULT_FRET_COUNT = 5;
const DEFAULT_SPAN = 4;
const DEFAULT_LAST_FRET = 12;
const DEFAULT_MIN_STRINGS = 3;

// Where the neck ends and where the hand does. Both are bounds on nonsense the
// way `minStrings` is bounded by the string count, and the fret one also stops
// an attribute typo from walking a range nobody meant: the position loop runs
// every fret from `firstFret` to `lastFret`, so `last-fret="10000000"` would
// walk ten million of them. 24 is the longest neck anyone builds; five frets is
// the most a hand takes at a stretch, and the answer is still described as a
// shape one takes.
//
// They bound the RANGE, not the WORK, and those are different numbers: the walk
// is exponential in the string count, so a twelve-string tuning — which
// {@link MAX_TUNING_STRINGS} allows and {@link Tuning.midis} invites — over a
// dense chord costs minutes with every option at its default. {@link NODE_BUDGET}
// is the bound on the work.
const MAX_SPAN = 5;

// How many branches one search may open before it settles for the best shape it
// has already found. The walk multiplies by roughly five per added string, so
// no bound on the inputs bounds the work: a six-string tuning at defaults opens
// a few thousand nodes and a twelve-string one opens billions, on the main
// thread, on every chord change during playback.
//
// Abandoning is safe because the incumbent is always a LEGAL shape — every rule
// runs before a candidate becomes one — so a search that runs out of budget
// answers a worse shape, never a wrong one, and the six tunings this repo ships
// never come near it. It is deliberately far above them: the widest real ask
// measured here, a twelve-note cluster on eight strings at `span: 5`, is the
// one that spends it.
const NODE_BUDGET = 200000;

/**
 * Read a tuning from whatever an attribute or a caller supplied.
 *
 * Accepts a {@link TUNINGS} key (case-insensitive, trimmed), a comma-separated
 * MIDI list such as `'40,45,50,55,59,64'`, an array of MIDI numbers, or a
 * {@link Tuning} to be normalised and frozen.
 *
 * Returns `undefined` — and NEVER throws — for anything else, so an element
 * reading `tuning="drop-e"` can warn once and fall back rather than render an
 * exception. Numeric arrays round to the nearest MIDI integer; string entries
 * must be integers. Empty entries, non-finite numbers, rounded pitches outside
 * MIDI, fewer than two strings and more than twelve are all "anything else".
 */
export function resolveTuning(spec?: TuningSpec): Tuning | undefined {
  if (typeof spec === 'string') {
    const text = spec.trim();
    if (text === '') return undefined;
    // OWN properties only. A plain lookup walks the prototype, so
    // `tuning="constructor"` would resolve to `Object` and the caller would
    // read `.midis` off a function — an exception on the one path this
    // function promises never to throw on. `TUNING_ALIASES` is a Map for the
    // same reason.
    const key = text.toLowerCase().replace(/[\s_]+/g, '-');
    const named = ownTuning(TUNING_ALIASES.get(key) ?? key);
    if (named !== undefined) return named;
    return customTuning(text.split(','));
  }
  if (Array.isArray(spec)) return customTuning(spec as readonly number[]);
  if (spec !== undefined && typeof spec === 'object' && Array.isArray((spec as TuningInput).midis)) {
    const given = spec as TuningInput;
    return customTuning(given.midis, given.id, given.name, given.inlays, given.frets);
  }
  return undefined;
}

// What a reader is likely to type for a tuning that already has a name here.
// A Map and not an object literal: `TUNING_ALIASES['constructor']` on a plain
// object walks the prototype and answers `Object`, which would send the lookup
// straight back into the branch `ownTuning` exists to guard.
const TUNING_ALIASES: ReadonlyMap<string, string> = new Map<string, string>([
  ['guitar', 'standard'],
  ['uke', 'ukulele'],
  ['dropd', 'drop-d'],
  ['openg', 'open-g'],
]);

/**
 * What to print at the edge of a diagram, one name per string.
 *
 * Separate from {@link Tuning.labels}, which is the tuning's own sharp-spelled
 * record of itself, because a printed name is not a fact about a string — it is
 * a fact about the MUSIC being played on it. An E-flat-tuned guitar is
 * `Eb Ab Db Gb Bb Eb` on every chart in print, and the fixed sharp table would
 * print `D# G# C# F# A# D#` beside a nameplate reading `Eb`: two panels in one
 * frame, two spellings of one note. That is the failure the first paragraph of
 * `chord-spelling.ts` exists to prevent, so this reads the same two tables that
 * module exports.
 *
 * `'auto'` spells from {@link TuningLabelOptions.key} — a key on the flat side
 * of the circle gets flats. It asks {@link keyFifths} and never
 * `keySignatureFifths`, because the clamped answer erases the sign and would
 * silently spell F-flat major sharp. With no key it spells SHARPS and says so
 * rather than pretending to have chosen: there is no fact inside a tuning that
 * prefers `Eb` to `D#`, only the music played on it.
 */
export function tuningLabels(tuning: Tuning, options: TuningLabelOptions = {}): readonly string[] {
  const spelling = options.spelling ?? 'auto';
  const flat =
    spelling === 'flat' ||
    (spelling === 'auto' && options.key !== undefined && keyFifths(options.key) < 0);
  const names = flat ? FLAT_NAMES : SHARP_NAMES;
  return Object.freeze(
    tuning.midis.map((midi) => (Number.isFinite(midi) ? names[chromaOf(midi)] : '')),
  );
}

/** How {@link tuningLabels} decides between `Eb` and `D#`. */
export interface TuningLabelOptions {
  /** Default `'auto'`. See {@link tuningLabels} for what `'auto'` reads. */
  readonly spelling?: SpellingPreference;
  /** The key the music is in. `'auto'` spells from ITS position on the circle. */
  readonly key?: Key;
}

/**
 * Every (string, fret) in the window that sounds this exact MIDI number.
 *
 * ARITHMETIC, not theory: which of these a hand would actually take is
 * {@link fretboardVoicing}'s answer. Positions come back ascending by string
 * index, at most one per string — a fret is a semitone, so a string sounds a
 * given pitch at exactly one place.
 *
 * Returns `[]` rather than throwing for a non-finite or unreachable pitch, and
 * a window that starts above the nut excludes the open strings: `firstFret: 1`
 * never returns `fret: 0`.
 */
export function fretPositionsFor(
  midi: number,
  tuning: readonly number[],
  options: FretWindow = {},
): readonly FretPosition[] {
  if (!Number.isFinite(midi)) return [];
  const target = Math.round(midi);
  const {lowest, highest} = fretWindow(options);
  const found: FretPosition[] = [];
  for (let stringIndex = 0; stringIndex < tuning.length; stringIndex += 1) {
    const open = tuning[stringIndex];
    if (!Number.isFinite(open)) continue;
    const fret = target - Math.round(open);
    if (fret >= lowest && fret <= highest) found.push({stringIndex, fret});
  }
  return found;
}

/**
 * The shape a hand would TAKE for this chord, in this tuning.
 *
 * Every survivor of the six rules in the module header is ranked, and the
 * best one is dressed: every dot carries the role and the figure the
 * {@link ChordSpelling} already gave that pitch class, so the board, the
 * keyboard and the stave say the same thing about the same sounding note.
 * Where two sounding pitches share a pitch class the LOWEST one supplies the
 * role — the same rule detection itself uses when it reads the bass off
 * `source[0]`.
 *
 * Returns an empty {@link FretboardVoicing.marks} when no shape in the window
 * sounds the root, cannot put a declared slash bass at the bottom, or needs a
 * fifth finger to hold: an empty answer, never a wrong one. It does not throw
 * for silence, for a single note, for a tuning it cannot resolve or for a
 * window one fret wide.
 */
export function fretboardVoicing(
  spelling: ChordSpelling,
  options: FretboardVoicingOptions = {},
): FretboardVoicing {
  const tuning = resolveTuning(options.tuning) ?? TUNINGS[DEFAULT_TUNING_ID];
  const strings = tuning.midis.length;
  const span = clamp(integerOr(options.span, DEFAULT_SPAN), 1, MAX_SPAN);
  // The neck this instrument actually has, not the longest one anybody builds.
  // A ukulele stops at fifteen, and a window reaching 24 on one would answer a
  // Cmaj7 with `17-19-20-19` — a chord box for a neck nobody is holding.
  const neck = Math.min(MAX_FRET, tuning.frets);
  const firstFret = clamp(integerOr(options.firstFret, 0), 0, neck);
  const lastFret = clamp(integerOr(options.lastFret, DEFAULT_LAST_FRET), firstFret, neck);
  const minStrings = Math.min(strings, Math.max(1, integerOr(options.minStrings, DEFAULT_MIN_STRINGS)));
  const nothing: FretboardVoicing = {
    tuning,
    marks: [],
    muted: [],
    firstFret,
    span: 0,
    label: '',
    missing: [],
  };
  if (strings === 0) return nothing;

  // One memo, and its key carries EVERY input that can move the answer: the
  // spelling itself (by identity — `spellChord` memoises, so the hot path hands
  // the same frozen object back for the same sounding set) and the numbers that
  // describe the window and the hand. A `WeakMap` rather than a bounded `Map`
  // because the spelling is already the cached thing: when `spellChord` drops
  // it, the shapes drawn from it are dead too, and nothing here has to guess an
  // eviction limit. This runs on every chord change during playback.
  //
  // The tuning is in the key TWICE OVER — its strings, which move the shape,
  // and its id and name, which do not but are HANDED BACK on
  // {@link FretboardVoicing.tuning}. Key on the strings alone and the first
  // caller's instrument is served to every later one: `tuning="40,45,50,55,59,64"`
  // comes back labelled `Standard`, and a diagram printing `tuning.name` prints
  // the wrong instrument, differently depending on which call ran first.
  //
  // `windowKey`, not `window`: this module never touches the DOM, and a local
  // shadowing that global is a grep away from looking like it does.
  const windowKey = JSON.stringify([
    tuning.id, tuning.name, tuning.midis, tuning.inlays, tuning.frets,
    firstFret, lastFret, span, minStrings,
  ]);
  let byWindow = voicingCache.get(spelling);
  if (byWindow === undefined) {
    byWindow = new Map<string, FretboardVoicing>();
    voicingCache.set(spelling, byWindow);
  }
  const cached = byWindow.get(windowKey);
  if (cached !== undefined) return cached;

  const byChroma = new Map<number, SpelledPitch>();
  for (const pitch of spelling.pitches) {
    const chroma = chromaOf(pitch.midi);
    if (!byChroma.has(chroma)) byChroma.set(chroma, pitch);
  }
  const answer = byChroma.size === 0
    ? nothing
    : searchFor(spelling, tuning, byChroma, {
      span,
      firstFret,
      lastFret,
      minStrings,
    }) ?? nothing;
  byWindow.set(windowKey, answer);
  return answer;
}

// One cache for this module, keyed on the object `spellChord` already
// memoises. See the comment in {@link fretboardVoicing}.
const voicingCache = new WeakMap<ChordSpelling, Map<string, FretboardVoicing>>();

// ---------------------------------------------------------------------------
// Tunings
// ---------------------------------------------------------------------------

const hasOwn = Object.prototype.hasOwnProperty;

function ownTuning(id: string): Tuning | undefined {
  return hasOwn.call(TUNINGS, id) ? TUNINGS[id] : undefined;
}

// A tuning is entered as MIDI numbers because that is the only lossless form —
// `'D'` is four different strings on a guitar. The labels come back out of
// them so a diagram has letters to print.
function stringLabels(midis: readonly number[]): readonly string[] {
  return Object.freeze(midis.map((midi) => SHARP_NAMES[chromaOf(midi)]));
}

// `Number('')` is 0 and `Number(' ')` is 0, so a list with a hole in it —
// `'40,,45'` — would otherwise resolve to a tuning with a low C in the middle
// of it. Match the digits instead of coercing.
const MIDI_TEXT = /^-?\d+$/;

function customTuning(
  values: readonly (number | string)[],
  id = 'custom',
  name?: string,
  inlays?: readonly number[],
  frets?: number,
): Tuning | undefined {
  if (values.length < MIN_TUNING_STRINGS || values.length > MAX_TUNING_STRINGS) return undefined;
  const midis: number[] = [];
  for (const value of values) {
    let midi: number;
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) return undefined;
      midi = Math.round(value);
    } else {
      const text = String(value).trim();
      if (!MIDI_TEXT.test(text)) return undefined;
      midi = Number(text);
    }
    if (midi < LOWEST_MIDI || midi > HIGHEST_MIDI) return undefined;
    midis.push(midi);
  }
  // A tuning nobody named is a guitar until told otherwise: the dot pattern
  // and the neck length a caller did not supply are the ones most necks have.
  return freezeTuning(
    id,
    name ?? stringLabels(midis).join(' '),
    midis,
    Array.isArray(inlays) ? inlays.filter((fret) => Number.isFinite(fret)) : GUITAR_INLAYS,
    frets,
  );
}

// ---------------------------------------------------------------------------
// The search
// ---------------------------------------------------------------------------

/** A string with nothing on it. Not a fret, so it never enters the arithmetic. */
const MUTED = -1;

/**
 * What each role is worth to a shape's coverage — the weighted key 1 of the
 * ranking in the module header.
 *
 * The THIRD and the SEVENTH are the guide tones: they are what tells a major
 * seventh from a minor one, and dropping either loses more of the chord than
 * dropping the fifth, which the ear supplies for itself. Every weight is
 * positive, so a shape that sounds one more chord tone always scores higher
 * than the same shape without it — "more of the chord" first, guide tones as
 * the tiebreak inside one count.
 *
 * `root` and `bass` are here for completeness only: R5 requires both of every
 * survivor, so their weight is a constant added to every candidate and cannot
 * move the ranking. `ghost` never reaches a sounding pitch.
 */
const ROLE_VALUE: Readonly<Record<ToneRole, number>> = Object.freeze({
  root: 3,
  bass: 3,
  third: 4,
  seventh: 4,
  extension: 3,
  fifth: 2,
  other: 1,
  ghost: 0,
});

/** A hand has four fingers to fret with. R4 is not advice, it is a filter. */
const FINGERS = 4;

/** The window and the hand, already clamped by {@link fretboardVoicing}. */
interface SearchWindow {
  readonly span: number;
  readonly firstFret: number;
  readonly lastFret: number;
  readonly minStrings: number;
}

/** Everything the walk needs about the chord, in the form it is asked about. */
interface SearchChord {
  /** By chroma: is this a chord tone at all? R1 reads nothing else. */
  readonly tone: readonly boolean[];
  /** By chroma: {@link ROLE_VALUE} of the pitch sounding it, `0` for a non-tone. */
  readonly value: readonly number[];
  /** Bitmask of the chromas R5 demands: the root, plus a declared slash bass. */
  readonly requiredMask: number;
  /** The chroma R2 wants underneath. */
  readonly anchor: number;
  /** Set only when the NAME PLATE declares a slash, in which case R2 is a filter. */
  readonly bass: number | undefined;
}

/** One shape, scored on every key the ranking reads. Frets are lowest string first. */
interface Candidate {
  readonly frets: readonly number[];
  readonly value: number;
  readonly anchored: number;
  readonly opens: number;
  /** The ranking's position key: the highest fret the hand has to REACH. */
  readonly reach: number;
  /** The fret the DIAGRAM starts at. Not a ranking key. */
  readonly position: number;
  readonly sounding: number;
  readonly fretSum: number;
  readonly span: number;
}

// The whole search: every position on the neck, every combination of
// {mute, open, a fret in the window} at each, the six rules applied and the
// survivors ranked. A position's window is `span` frets wide starting at its
// own base, which is also why open strings belong to first position alone.
function searchFor(
  spelling: ChordSpelling,
  tuning: Tuning,
  byChroma: ReadonlyMap<number, SpelledPitch>,
  window: SearchWindow,
): FretboardVoicing | undefined {
  const chord = chordFacts(spelling, byChroma);
  const budget: Budget = {left: NODE_BUDGET};
  let best: Candidate | undefined;
  for (let base = window.firstFret; base <= window.lastFret; base += 1) {
    best = walkPosition(base, tuning.midis, chord, window, best, budget);
  }
  if (best === undefined) return undefined;
  return dressShape(best, tuning, byChroma);
}

// Read the chord once, into the lookups the walk actually asks: is this chroma
// a tone, what is it worth, what must sound at all, and what goes underneath.
function chordFacts(
  spelling: ChordSpelling,
  byChroma: ReadonlyMap<number, SpelledPitch>,
): SearchChord {
  const tone: boolean[] = new Array<boolean>(12).fill(false);
  const value: number[] = new Array<number>(12).fill(0);
  for (const [chroma, pitch] of byChroma) {
    tone[chroma] = true;
    value[chroma] = ROLE_VALUE[pitch.role];
  }
  let requiredMask = 0;
  for (const chroma of requiredChromas(spelling, byChroma)) requiredMask |= 1 << chroma;
  const bass = slashBassChroma(spelling, byChroma);
  return {tone, value, requiredMask, anchor: bass ?? rootChroma(spelling, byChroma), bass};
}

/** What is left of {@link NODE_BUDGET}, shared by every position of one search. */
interface Budget {
  left: number;
}

// One position, walked exhaustively. Each string offers the frets in the
// window that sound a chord tone, plus the mute — a CHOICE the greedy this
// replaced could not make, and the choice every idiomatic voicing turns on.
//
// Three prunes keep the walk small enough to run on every chord change:
// a branch that can no longer reach `minStrings`; a branch whose remaining
// strings cannot add enough coverage to beat the shape already in hand; and,
// above the nut, a branch that can no longer touch the position's own first
// fret — a shape whose lowest fret is higher than `base` belongs to that
// higher position and is walked there, so walking it twice is only work.
//
// And a budget, because the prunes are proportional and the walk is not: see
// {@link NODE_BUDGET}.
function walkPosition(
  base: number,
  openMidis: readonly number[],
  chord: SearchChord,
  window: SearchWindow,
  incumbent: Candidate | undefined,
  budget: Budget,
): Candidate | undefined {
  const strings = openMidis.length;
  const highest = Math.min(base + window.span - 1, window.lastFret);
  const choices: number[][] = [];
  // Coverage still reachable from string i onward, and whether the position's
  // own base fret is still reachable there. Both are suffix sums over the
  // per-string option lists, so a prune costs one comparison.
  const reachable: number[] = new Array<number>(strings + 1).fill(0);
  const touchesBase: boolean[] = new Array<boolean>(strings + 1).fill(false);
  for (let stringIndex = 0; stringIndex < strings; stringIndex += 1) {
    const open = Math.round(openMidis[stringIndex]);
    const list: number[] = [];
    for (let fret = base; fret <= highest; fret += 1) {
      if (chord.tone[chromaOf(open + fret)]) list.push(fret);
    }
    list.push(MUTED);
    choices.push(list);
  }
  for (let stringIndex = strings - 1; stringIndex >= 0; stringIndex -= 1) {
    let mask = 0;
    let hasBase = false;
    for (const fret of choices[stringIndex]) {
      if (fret === MUTED) continue;
      mask |= 1 << chromaOf(Math.round(openMidis[stringIndex]) + fret);
      if (fret === base) hasBase = true;
    }
    reachable[stringIndex] = reachable[stringIndex + 1] + maskValue(mask, chord.value);
    touchesBase[stringIndex] = hasBase || touchesBase[stringIndex + 1];
  }

  const frets: number[] = new Array<number>(strings).fill(MUTED);
  let best = incumbent;

  function walk(
    stringIndex: number,
    mask: number,
    value: number,
    sounding: number,
    opens: number,
    lowestFret: number,
    highestFret: number,
    fretSum: number,
    tookBase: boolean,
  ): void {
    if (budget.left <= 0) return;
    budget.left -= 1;
    if (sounding + (strings - stringIndex) < window.minStrings) return;
    if (best !== undefined && value + reachable[stringIndex] < best.value) return;
    if (base > 0 && !tookBase && !touchesBase[stringIndex]) return;
    if (stringIndex === strings) {
      if (base > 0 && !tookBase) return;
      // No `sounding < minStrings` check here: the prefix prune above is that
      // same comparison one branch earlier, and at the leaf `stringIndex` IS
      // `strings`, so the two are the identical test.
      if ((mask & chord.requiredMask) !== chord.requiredMask) return;
      // One pass for the four facts only a finished shape has: where its run
      // of sounding strings starts and ends, and which string is carrying its
      // lowest PITCH — on a re-entrant tuning that is not the first of them.
      let first = -1;
      let last = -1;
      let lowestMidi = Number.POSITIVE_INFINITY;
      let lowestString = -1;
      for (let index = 0; index < strings; index += 1) {
        if (frets[index] === MUTED) continue;
        if (first < 0) first = index;
        last = index;
        const midi = Math.round(openMidis[index]) + frets[index];
        if (midi >= lowestMidi) continue;
        lowestMidi = midi;
        lowestString = index;
      }
      if (sounding !== last - first + 1) return; // R6
      const onTheBottom = chromaOf(lowestMidi) === chord.anchor;
      if (chord.bass !== undefined && !onTheBottom) return;
      const anchored = rootUnderneath(onTheBottom, lowestString, first, last);
      const position = opens > 0 || lowestFret === Number.POSITIVE_INFINITY ? 0 : lowestFret;
      // Same collapse the diagram's own `position` makes, reading the TOP of
      // the hand instead of the bottom: a shape with an open string in it is
      // first position whatever else it holds, and every other shape is ranked
      // by the fret it makes the hand reach for.
      const reach = opens > 0 || highestFret === Number.NEGATIVE_INFINITY ? 0 : highestFret;
      if (!outranks(value, anchored, opens, reach, sounding, fretSum, frets, best)) return;
      if (handFor(frets) === undefined) return; // R3, R4, R7, R8
      best = {
        frets: frets.slice(),
        value,
        anchored,
        opens,
        reach,
        position,
        sounding,
        fretSum,
        span: highestFret >= lowestFret ? highestFret - lowestFret + 1 : 0,
      };
      return;
    }
    const open = Math.round(openMidis[stringIndex]);
    for (const fret of choices[stringIndex]) {
      frets[stringIndex] = fret;
      if (fret === MUTED) {
        walk(stringIndex + 1, mask, value, sounding, opens, lowestFret, highestFret, fretSum, tookBase);
        continue;
      }
      const chroma = chromaOf(open + fret);
      const seen = (mask & (1 << chroma)) !== 0;
      walk(
        stringIndex + 1,
        mask | (1 << chroma),
        seen ? value : value + chord.value[chroma],
        sounding + 1,
        fret === 0 ? opens + 1 : opens,
        fret > 0 && fret < lowestFret ? fret : lowestFret,
        fret > highestFret ? fret : highestFret,
        fretSum + fret,
        tookBase || fret === base,
      );
    }
    frets[stringIndex] = MUTED;
  }

  walk(0, 0, 0, 0, 0, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 0, false);
  return best;
}

// The ranking, in one place and in one direction: true when the candidate on
// the left is the better ANSWER. The keys and why they sit in this order are
// the numbered list in the module header; the last of them compares the frets
// themselves, so two shapes that are equal in every musical way still settle,
// and one chord always draws one diagram.
function outranks(
  value: number,
  anchored: number,
  opens: number,
  reach: number,
  sounding: number,
  fretSum: number,
  frets: readonly number[],
  best: Candidate | undefined,
): boolean {
  if (best === undefined) return true;
  if (value !== best.value) return value > best.value;
  if (anchored !== best.anchored) return anchored > best.anchored;
  if (opens !== best.opens) return opens > best.opens;
  if (reach !== best.reach) return reach < best.reach;
  if (sounding !== best.sounding) return sounding > best.sounding;
  if (fretSum !== best.fretSum) return fretSum < best.fretSum;
  for (let index = 0; index < frets.length; index += 1) {
    if (frets[index] !== best.frets[index]) return frets[index] < best.frets[index];
  }
  return false;
}

// R2, as the ranking reads it. The anchor is underneath — or the string
// sounding below it is one NO HAND COULD HAVE SILENCED, because it lies inside
// the run of sounding strings and R6 mutes only from the edges.
//
// On every ascending tuning that second clause is dead: the lowest-sounding
// string is the bottom edge of the run, so the rule is the plain one and
// `0-3-2-0-1-0` — `C/E` under a name plate reading `C` — loses to
// `x-3-2-0-1-0`. On the re-entrant ukulele it is the whole story: the C string
// sounds under both its neighbours, so `Am` played `2-0-0-0` has a C
// underneath that no player can do anything about, and a rule that scored it
// as an inversion would send the search up to the 7th fret for a shape no uke
// book prints.
function rootUnderneath(onTheBottom: boolean, lowestString: number, first: number, last: number): number {
  if (onTheBottom) return 1;
  return lowestString > first && lowestString < last ? 1 : 0;
}

// The weight of a set of chromas, for the coverage bound the walk prunes on.
function maskValue(mask: number, value: readonly number[]): number {
  let total = 0;
  for (let chroma = 0; chroma < 12; chroma += 1) if ((mask & (1 << chroma)) !== 0) total += value[chroma];
  return total;
}

// Which pitch classes a shape MUST sound. The primary naming answers it when
// there is one; a preferred or rootless naming can name a root that is not
// sounding at all, and requiring a chroma no string can produce would reject
// every shape, so only sounding chromas survive the filter. The slash bass
// arrives through the `pitches` loop, which carries the `bass` role whenever a
// naming has one. With nothing named — two notes held, a twelve-note cluster —
// the lowest sounding pitch is what the ear anchors on and it stands in for
// the root.
function requiredChromas(
  spelling: ChordSpelling,
  byChroma: ReadonlyMap<number, SpelledPitch>,
): ReadonlySet<number> {
  const wanted: number[] = [];
  const primary = spelling.primary;
  if (primary?.rootPitchClass !== undefined) wanted.push(chromaOf(primary.rootPitchClass));
  for (const pitch of spelling.pitches) {
    if (pitch.role === 'root' || pitch.role === 'bass') wanted.push(chromaOf(pitch.midi));
  }
  const sounding = wanted.filter((chroma) => byChroma.has(chroma));
  if (sounding.length > 0) return new Set(sounding);
  return new Set([chromaOf(spelling.pitches[0].midi)]);
}

// The chroma R2 wants at the bottom when the name plate declares no slash.
// The primary naming's root, and for a pile nothing could name — a dyad, a
// twelve-note cluster — the lowest sounding pitch, which is what the ear
// anchors on and the same note `requiredChromas` falls back to.
function rootChroma(
  spelling: ChordSpelling,
  byChroma: ReadonlyMap<number, SpelledPitch>,
): number {
  const root = spelling.primary?.rootPitchClass;
  if (root !== undefined && byChroma.has(chromaOf(root))) return chromaOf(root);
  return chromaOf(spelling.pitches[0].midi);
}

// The chroma a slash puts underneath — and ONLY a slash, because for a slash
// R2 is a FILTER and not a ranking key: `Cmaj7/E` with a G at the bottom is a
// different chord printed under the same name plate, so a window that cannot
// put E underneath has no shape rather than a wrong one. A bass no string can
// sound is dropped for the same reason `requiredChromas` drops one: an
// impossible demand rejects every shape and blanks the board.
function slashBassChroma(
  spelling: ChordSpelling,
  byChroma: ReadonlyMap<number, SpelledPitch>,
): number | undefined {
  const declared = spelling.primary?.bassPitchClass;
  if (declared === undefined) return undefined;
  const bass = chromaOf(declared);
  return byChroma.has(bass) ? bass : undefined;
}


// ---------------------------------------------------------------------------
// Dressing the winner
// ---------------------------------------------------------------------------

function dressShape(
  shape: Candidate,
  tuning: Tuning,
  byChroma: ReadonlyMap<number, SpelledPitch>,
): FretboardVoicing {
  // Never `undefined` here: the winner passed this same check to become one.
  const groups = handFor(shape.frets) ?? [];
  const fingers = numberFingers(shape.frets, groups);
  const marks: FretDot[] = [];
  const muted: number[] = [];
  for (let stringIndex = 0; stringIndex < shape.frets.length; stringIndex += 1) {
    const fret = shape.frets[stringIndex];
    if (fret === MUTED) {
      muted.push(stringIndex);
      continue;
    }
    const midi = Math.round(tuning.midis[stringIndex]) + fret;
    const pitchClass = chromaOf(midi);
    const pitch = byChroma.get(pitchClass);
    const finger = fret === 0 ? '0' : fingers.get(stringIndex);
    marks.push({
      stringIndex,
      fret,
      midi,
      pitchClass,
      noteName: pitch === undefined ? SHARP_NAMES[pitchClass] : octavelessName(pitch),
      role: pitch?.role ?? 'other',
      label: pitch?.degreeLabel ?? '.',
      ...(finger === undefined ? {} : {finger}),
    });
  }
  const barre = barreOf(groups);
  // Asked of the SPELLING and not of the naming's own interval list, so the
  // answer is in the same pitch classes every dot carries.
  const sounded = new Set(marks.map((mark) => mark.pitchClass));
  const missing = [...byChroma.keys()].filter((chroma) => !sounded.has(chroma)).sort((a, b) => a - b);
  return {
    tuning,
    marks,
    muted,
    firstFret: shape.position,
    span: shape.span,
    ...(barre === undefined ? {} : {barre}),
    label: shape.frets.map((fret: number) => (fret === MUTED ? 'x' : String(fret))).join('-'),
    missing,
  };
}

// The spelled name minus its octave. Stripping the digits is exact and cannot
// drift from the spelling, which re-deriving a letter from the pitch class
// could: `Cb` and `B#` are one chroma apart from the name the stave drew.
function octavelessName(pitch: SpelledPitch): string {
  return pitch.name.replace(/-?\d+$/, '');
}

/** One finger's whole job: the run of strings it lies across, all at one fret. */
interface FingerGroup {
  readonly fret: number;
  readonly first: number;
  readonly last: number;
}

/**
 * The fingering a hand would take for this shape, or `undefined` when no hand
 * takes it at all. R3, R4, R7 and R8 are all this function, and it is the same
 * answer the search filters on and the diagram prints, so a shape can never be
 * accepted under one reading of the hand and drawn under another.
 *
 * Two readings are tried, in the order a player thinks of them. The NATURAL one
 * spends a finger per string and shares one only between ADJACENT strings at
 * one fret — the small barre of `x-x-0-2-2-2` — and it is what keeps the
 * standard D fingered `1-3-2` rather than being told to lay a finger across the
 * G and the high E with the B string stopped higher in between. The FLAT one,
 * where a finger runs on until a lower fret stops it, is what an F needs: six
 * strings is two more than a hand has, and the index has to carry three of
 * them.
 *
 * A shape only ever reaches the flat reading because the natural one failed, so
 * a barre is reported when a barre is what the shape costs, and not merely when
 * two dots happen to share a fret.
 */
function handFor(frets: readonly number[]): readonly FingerGroup[] | undefined {
  const natural = fingerGroups(frets, true);
  if (handHolds(natural, frets)) return natural;
  // When nothing merges, this is the same grouping again and the same answer;
  // when something does, it is the barre the natural reading could not make.
  const flat = fingerGroups(frets, false);
  return handHolds(flat, frets) ? flat : undefined;
}

// Can four fingers actually be put here? R4 counts them; R7 asks that the one
// lying under the others is the index, which is the hand's lowest fret and the
// only finger the wrist is behind; R3 and R8 read the gap between two fingers
// holding one fret.
//
// R8 asks how much is standing in that gap, and answers it in one number. An
// OPEN or MUTED string costs nothing — it is space the fingers splay over,
// which is why `3-2-0-0-0-3`, the G every beginner learns with two fingers at
// fret 3 five strings apart, is not caught here. A string stopped at or above
// the pair's own fret, or ONE fret in front of it, costs one: that is a finger
// beside or on top of them and is ordinary, the standard D `x-x-0-2-3-2` and
// B7's index at fret 1 between two fingers at fret 2. TWO frets in front costs
// two, because it is a real tuck — one is the jazz Cm9 `x-3-1-3-3-3`, whose
// index sits at fret 1 between the middle and a three-string ring barre at fret
// 3, and two of them is a hand splayed the wrong way. THREE frets in front is a
// backwards reach nobody makes at all: `4-2-1-4-4-4` wants a ring on the low E
// and a pinky barre on the top three, both at fret 4, with the index down at
// fret 1 in the gap.
//
// {@link CROWDED} is where the gap stops being reachable through, and it is
// also what sends an F to the barre: three strings stopped above fret 1 cost
// three, so one finger per string does not hold and the index takes all six.
function handHolds(groups: readonly FingerGroup[], frets: readonly number[]): boolean {
  if (groups.length === 0) return true;
  if (groups.length > FINGERS) return false; // R4
  const lowest = groups[0].fret;
  for (const group of groups) {
    if (group.last === group.first || group.fret === lowest) continue;
    for (let between = group.first + 1; between < group.last; between += 1) {
      if (frets[between] > group.fret) return false; // R7
    }
  }
  for (let index = 1; index < groups.length; index += 1) {
    const left = groups[index - 1];
    const right = groups[index];
    if (left.fret !== right.fret) continue;
    let cut = false;
    let above = false;
    let crowd = 0;
    for (let between = left.last + 1; between < right.first; between += 1) {
      const held = frets[between];
      if (held <= 0) {
        cut = true;
        continue;
      }
      if (held > left.fret) above = true;
      const front = left.fret - held;
      if (front > IN_FRONT) return false; // R8
      crowd += front === IN_FRONT ? IN_FRONT : 1;
    }
    if (cut && above) return false; // R3
    if (crowd >= CROWDED) return false; // R8
    // A fingertip steps over another finger — that is the D, and B7. A finger
    // laid FLAT does not: it needs the length of the fret, so two of them at
    // one fret with a finger standing between is a hand that has to barre
    // instead. `1-1-3-3-1-1` is the case, an Fsus4 whose index takes all six.
    if (above && (left.last > left.first || right.last > right.first)) return false; // R8
  }
  return true;
}

/** R8's gap: what a hand can reach through, and how far in front of itself a finger goes. */
const CROWDED = 3;
const IN_FRONT = 2;

// One entry per finger, in the order a hand takes them: lowest fret first, then
// by string, which is also the order they are numbered in.
//
// `adjacentOnly` is the difference between the two readings {@link handFor}
// tries. Under it a finger covers a run of strings all at its own fret and
// stops at the first that is not, so `x-x-0-2-3-2` is three fingers. Without
// it a finger lying flat keeps going until something stops it, and what stops
// it is a string needing a LOWER fret, an open string, or a mute — all three
// are "the finger must not be here". A string at a HIGHER fret is not a stop:
// another finger takes it further up the neck and the flat one underneath is
// inaudible, which is the whole of what a barre is.
//
// Either way `2-0-0-2-2-2` is TWO fingers at fret 2 (string 0, then strings 3
// to 5), not one finger asked to be in two places with two open strings in
// between.
function fingerGroups(frets: readonly number[], adjacentOnly: boolean): readonly FingerGroup[] {
  const groups: FingerGroup[] = [];
  const taken = frets.map(() => false);
  for (let first = 0; first < frets.length; first += 1) {
    const fret = frets[first];
    if (fret <= 0 || taken[first]) continue;
    let last = first;
    for (let index = first + 1; index < frets.length; index += 1) {
      if (frets[index] < fret) break;
      if (frets[index] === fret) last = index;
      else if (adjacentOnly) break;
    }
    for (let index = first; index <= last; index += 1) if (frets[index] === fret) taken[index] = true;
    groups.push({fret, first, last});
  }
  return groups.sort((a, b) => a.fret - b.fret || a.first - b.first);
}

// Fingers 1…4 across the groups, lowest fret first. The bound is belt and
// braces: R4 rejected every shape with a fifth group before it got here, so
// this loop never runs out — and if a future rule ever let one through, an
// unnumbered dot is a better diagram than an invented finger.
function numberFingers(
  frets: readonly number[],
  groups: readonly FingerGroup[],
): ReadonlyMap<number, string> {
  const fingers = new Map<number, string>();
  for (let index = 0; index < groups.length && index < FINGERS; index += 1) {
    const group = groups[index];
    for (let stringIndex = group.first; stringIndex <= group.last; stringIndex += 1) {
      if (frets[stringIndex] === group.fret) fingers.set(stringIndex, String(index + 1));
    }
  }
  return fingers;
}

// The barre is the WIDEST group at the shape's lowest fretted fret — widest,
// not first-to-last, because `x-1-0-1-3-1` barres its top three strings and
// nothing else: the open D string ends the finger, it does not abolish it.
// A shape has one lowest fret and this reports one finger across it, which is
// the invariant a diagram draws; two equally wide groups there settle by
// string, so the answer never depends on which was found first.
function barreOf(groups: readonly FingerGroup[]): FretBarre | undefined {
  if (groups.length === 0) return undefined;
  const fret = groups[0].fret;
  let best: FingerGroup | undefined;
  for (const group of groups) {
    if (group.fret !== fret) break;
    if (group.last === group.first) continue;
    if (best === undefined || group.last - group.first > best.last - best.first) best = group;
  }
  if (best === undefined) return undefined;
  return {fret, firstString: best.first, lastString: best.last};
}

// ---------------------------------------------------------------------------
// Small shared arithmetic
// ---------------------------------------------------------------------------

function fretWindow(options: FretWindow): {lowest: number; highest: number} {
  const lowest = Math.max(0, integerOr(options.firstFret, 0));
  const count = Math.max(0, integerOr(options.fretCount, DEFAULT_FRET_COUNT));
  return {lowest, highest: lowest + count};
}

/** Pitch class of a MIDI number, negative and fractional inputs included. */
function chromaOf(midi: number): number {
  if (!Number.isFinite(midi)) return 0;
  return ((Math.round(midi) % 12) + 12) % 12;
}

function integerOr(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : fallback;
}

function clamp(value: number, lowest: number, highest: number): number {
  return Math.min(highest, Math.max(lowest, value));
}
