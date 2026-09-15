// ============================================================================
// The key wheel — the circle of fifths as data: order, spelling and weight.
//
// `@webmusic/ui`'s wheel cuts a circle into however many segments it is handed
// and mixes one colour per weight. It owns the geometry and nothing else,
// because everything else on that picture is theory:
//
//   ORDER    — clockwise from the REFERENCE key by fifths. The kit is TOLD the
//              order; it never derives one, which is why a five-segment wheel
//              draws just as well as this twelve-segment one.
//   SPELLING — the segment after B is G♭, not F♯ (unless the caller asked for
//              sharps, and then it is a different wheel). See "one position,
//              two names" below.
//   WEIGHT   — how well each of the 24 keys explains what has been heard.
//   RELATED  — how close each key stands to the one the ring is turned to.
//
// The last two are different questions and the wheel answers both, because the
// design asks two things of one picture. `weight` is EVIDENCE: it is measured
// from `KeyResult.scores` and says what this music sounds like. `relatedness`
// is GEOMETRY: it is measured from the reference and says what a modulation
// would cost. Collapsing them would leave a dial that either cannot show a
// reading or cannot answer "what if it were this one instead" — and a
// relatedness presented as evidence is a constant tint that says nothing about
// the music at all.
//
// ## The ring turns; it does not scroll
//
// The reference key stands at twelve o'clock and everything else is placed
// relative to it, so the same modulation looks the same wherever it happens
// and clicking a segment re-draws the relationships rather than the list.
// `outer[i].index === i` is that order; `outer[i].fifths` is still the
// SIGNATURE of the key at that stop, which rotation must never touch.
//
// The inner ring is the relative minors: `inner[i]` shares `outer[i]`'s key
// signature and sits under it on the dial, exactly as a printed circle draws
// it. That pairing is a fact about signatures, not about the picture, so it is
// decided here and the kit only has to keep the two arrays in step.
//
// ## Why the labels cannot come from `KeyResult.tonic`
//
// `detectKey` ranks 24 profiles and names the winner out of `NOTE_NAMES`
// (`pitch-class.ts:1`) — a fixed mixed table, sharps for pitch classes 1 and 6
// and flats for 3, 8 and 10. It can never say `G♭`, `D♯` or `C♭`. So a
// `KeyResult` really carries a PITCH CLASS wearing whatever name that table
// happened to hold, and this module re-spells every position from scratch
// (brief §A.2.7). It is also why the wheel's F♯ major and G♭ major are two
// different SEGMENTS — different id, different signature, different relative
// minor — and not one segment with two captions.
//
// ## One position, two names
//
// A position on the circle is one pitch class, and a pitch class has two
// spellings twelve fifths apart. Only three positions offer a choice a
// signature can actually write: five o'clock is B (5♯) or C♭ (7♭), six is F♯
// (6♯) or G♭ (6♭), seven is C♯ (7♯) or D♭ (5♭). Everywhere else the far
// spelling needs eight accidentals or more — G♯ major, F♭ major — and
// {@link KeyWheelOptions.spelling} changes nothing there.
//
// ## The duplicated table
//
// `FIFTHS_TO_MAJOR_KEY` below is a copy of the one in
// `packages/score/src/view/core/note-sequence.ts:18`. `scripts/package-policy.mjs:142`
// declares `analyze: ["core", "io"]`, so this capability may never import
// view; lifting the shared table into `packages/score/src/core/` is the clean
// fix and is a commit of its own. Until then: change one, check the other.
// `staff-placement.ts` carries the same paragraph about the diatonic ladder,
// for the same reason.
// ============================================================================

import type {SpellingPreference} from './chord-spelling';
import {toDisplayName} from './staff-placement';
import type {Key, KeyResult} from './types';

/**
 * Pitch class of the major key at each step clockwise from C.
 *
 * Duplicated from `packages/score/src/view/core/note-sequence.ts:18` — see the
 * header. Used here as the ring's pitch classes; the SPELLINGS are derived
 * from the line of fifths instead, because a pitch class cannot say whether it
 * is F♯ or G♭ and that difference is the whole point of the outer ring.
 */
const FIFTHS_TO_MAJOR_KEY: readonly number[] = Object.freeze([0, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10, 5]);

/** Letters in fifths order, so `F` sits one flatward of `C`. Indexed by {@link nameFromFifths}. */
const FIFTHS_TO_LETTER: readonly string[] = Object.freeze(['F', 'C', 'G', 'D', 'A', 'E', 'B']);

/** A signature writes at most seven accidentals; past that a key has no signature to draw. */
const MAX_SIGNED_FIFTHS = 7;

/** Semitone of each natural letter, for reading a tonic back into a pitch class. */
const NATURAL_PITCH_CLASSES: Readonly<Record<string, number>> = Object.freeze({
  C: 0,
  D: 2,
  E: 4,
  F: 5,
  G: 7,
  A: 9,
  B: 11,
});

/**
 * What the centre prints when the key is unknown. The same em dash the chord
 * read-out uses for silence (`chord-spelling.ts`'s `NO_CHORD_LABEL`), and
 * deliberately not a sentence: this layer does not write microcopy in anyone's
 * language.
 */
const UNKNOWN_KEY_LABEL = '—';

/** Whole, whole, half… — the two scales this module models, as semitones from the tonic. */
const MAJOR_STEPS: readonly number[] = Object.freeze([0, 2, 4, 5, 7, 9, 11]);
const NATURAL_MINOR_STEPS: readonly number[] = Object.freeze([0, 2, 3, 5, 7, 8, 10]);

const EMPTY_PITCH_CLASSES: readonly number[] = Object.freeze([]);

/** Fixed at twelve because the circle closes after twelve fifths, not because the kit needs twelve. */
const WHEEL_POSITIONS = 12;

/**
 * How fast relatedness falls off per fifth. A dominant or a subdominant keeps
 * this much of the tonic's weight, its own neighbours that much again.
 */
const FIFTH_DECAY = 0.62;

/**
 * What crossing between major and minor costs, applied on top of the fifths
 * distance. It is deliberately SMALLER than {@link FIFTH_DECAY}, which is the
 * whole ordering claim: the relative minor shares every note of its major and
 * still reads as further away than the dominant, because a modulation to the
 * dominant is one accidental and a turn to the relative minor is a change of
 * centre.
 */
const MODE_FACTOR = 0.5;

/**
 * Widest the needle opens, in segments, at zero confidence. A quarter of the
 * circle: wide enough to read as "somewhere over here", narrow enough to still
 * point.
 */
const MAX_NEEDLE_SPREAD = 3;

/** The one key the wheel lights up, as the pair every segment can be compared against. */
type ActiveKey = {readonly pitchClass: number; readonly mode: Key['mode']};

/** One key on the dial: a segment of the outer (major) or inner (minor) ring. */
export interface KeyWheelSegment {
  /** Stable within one wheel: `'c-major'`, `'gb-major'`, `'fs-minor'`. Sharps become `s`. */
  readonly id: string;
  /**
   * What the segment prints. Display glyphs (`'E♭'`, not `'Eb'`), and minors
   * in lower case — the printed convention that lets a reader tell the two
   * rings apart without a legend. Lower-casing happens AFTER the glyphs go in,
   * so the flat of `'E♭'` cannot be mistaken for the `b` of `'Eb'`.
   */
  readonly label: string;
  /** The whole name, for the wheel's accessible twin and its centre: `'G♭ major'`. */
  readonly name: string;
  /** ASCII tonic (`'Gb'`, `'F#'`) — what round-trips through `keySignatureFifths`. */
  readonly tonic: string;
  readonly mode: 'major' | 'minor';
  /** The sounding pitch class. F♯ major and G♭ major share it; that is why spelling is a field. */
  readonly pitchClass: number;
  /**
   * Sharps positive, flats negative: `-6` for G♭ major AND for its relative E♭
   * minor. A fact about the key's SIGNATURE, so turning the ring never changes
   * it — only where on the dial it is drawn.
   */
  readonly fifths: number;
  /** Steps clockwise from the reference, `0`…`11`. `outer[i].index === i`. */
  readonly index: number;
  /**
   * How well this key explains what was HEARD: 0…1 across both rings — see
   * {@link keyWheel} on what the number means. Every segment weighs 0 when
   * nothing has been heard, which is the empty state and not a reading of C.
   */
  readonly weight: number;
  /**
   * How CLOSE this key stands to the one the ring is turned to, 0…1. Pure
   * geometry — see {@link keyRelatedness} — and deliberately not the same
   * number as {@link weight}: this one is what a reader is asking when they
   * click a segment, and it says nothing about the music. `0` on every segment
   * when there is no reading, for the same reason `weight` is.
   */
  readonly relatedness: number;
  /** Exactly one segment of the whole wheel is active, and none when the key is unknown. */
  readonly active: boolean;
}

/** Where the wheel points, and how sure it is. */
export interface KeyWheelNeedle {
  /**
   * Fractional segment index, `0` at twelve o'clock — the {@link
   * KeyWheelSegment.index} of the active segment. Always a whole number here;
   * the fraction exists because a presenter's needle accepts one, and a caller
   * interpolating between two readings needs somewhere to put it.
   */
  readonly at: number;
  readonly ring: 'outer' | 'inner';
  /**
   * Half-angle in SEGMENTS, `0` for a hairline. Confidence draws the needle's
   * WIDTH and not its position: an uncertain reading gets a wedge, because a
   * thin line that happens to be wrong is a lie and a fat one is a doubt.
   */
  readonly spread: number;
}

/** The text in the hole at the middle of the wheel. */
export interface KeyWheelCentre {
  /** The active key's {@link KeyWheelSegment.name}, or `'—'` when nothing was detected. */
  readonly primary: string;
  /**
   * The same key, as the pair a stave or a chord read-out is signed from.
   * Absent exactly when {@link primary} is `'—'`.
   *
   * This field is the reconciliation, not a convenience. The wheel re-spells
   * every position (see the header), so `KeyResult.tonic` and the segment the
   * dial lights up can be two names for one sound: a detected `F#` major shows
   * as `G♭ major` here. A caller that signed the stave from `KeyResult` while
   * printing this centre would draw six sharps under a flat key name. Drive
   * both from this.
   */
  readonly key?: Key;
  /**
   * `KeyResult.confidence` as a percentage — how far the winner stands out
   * from the runner-up. The ring weights cannot say this: they are relative,
   * so the best segment is 1 whether it won by a nose or by a mile. Absent
   * when the key is unknown.
   */
  readonly secondary?: string;
}

/** The whole dial. `outer[i]` and `inner[i]` are a relative pair. */
export interface KeyWheel {
  /** The twelve major keys, clockwise by fifths, the reference's own segment first. */
  readonly outer: readonly KeyWheelSegment[];
  /** Each one the relative minor of the major above it: same index, same signature. */
  readonly inner: readonly KeyWheelSegment[];
  readonly centre: KeyWheelCentre;
  /**
   * Absent exactly when {@link KeyWheelCentre.primary} is `'—'`. A wheel with
   * no needle still has twenty-four segments: the shape stands up first and the
   * reading arrives into it.
   */
  readonly needle?: KeyWheelNeedle;
}

export interface KeyWheelOptions {
  /**
   * How the three two-named positions are spelled. `'auto'` (default) takes
   * the signature with fewer accidentals and gives the six-and-six tie to G♭,
   * which is what a printed circle shows; `'sharp'` and `'flat'` force the
   * side. The other nine positions have one writable signature each and ignore
   * this. Shares its vocabulary with `spellChord` so one `spelling` attribute
   * can drive the whole workbench.
   */
  spelling?: SpellingPreference;
  /**
   * The key the ring is TURNED to, when a reader has asked "what if it were
   * this one instead". It stands at twelve o'clock and every
   * {@link KeyWheelSegment.relatedness} is measured from it. Defaults to the
   * detected key, which is the only orientation a wheel has until someone
   * clicks it — and to C when there is nothing detected either, because a
   * wheel anchored at the wrong stop is wrong about its orientation while a
   * wheel with no shape is wrong about everything.
   *
   * A reference whose tonic cannot be read is ignored whole, falling back to
   * the detected key: a caller's junk turns nothing rather than silently
   * turning the ring to C, which is the same standard {@link keyPitchClasses}
   * and `weigh` hold their inputs to.
   *
   * Turning the ring never moves the NEEDLE. The needle stays on what was
   * actually heard, which is the whole point of asking the question.
   */
  reference?: Key;
}

/**
 * The circle of fifths, weighted by how well each key explains what was heard.
 *
 * Weights are MIN-MAX normalised across all 24 candidates at once — the best
 * key is 1, the worst is 0, everything else lands in between. Two consequences
 * worth knowing before reading a ring:
 *
 *  * The rings are comparable. Normalising each separately would give the
 *    inner ring a 1 of its own and make A minor look as strong as C major.
 *  * The number is RELATIVE. It says how a key ranks among the other 23, never
 *    how well it fits in absolute terms; `KeyResult.confidence`, which the
 *    centre prints, is the one that answers that.
 *
 * Degenerate inputs answer with zeros rather than with a divide: an unknown
 * key (`scores: []`, the shape `keyFromHistogram` returns for a silent score)
 * and a flat tie where every candidate scored the same both give a dial of
 * empty segments, which is the empty state the design asks for — the shape
 * stands up before there is anything to say. A candidate the caller left
 * out of `scores` weighs 0; a non-finite score is dropped rather than spread
 * across the ring, so every weight is finite whatever arrives.
 *
 * Memoised on the READING — the `result` object itself, plus the spelling and
 * the reference — because a live workbench re-reads its wheel on every frame
 * and every field of the answer is frozen. A presenter that skips work on
 * `previous === next` gets to skip it, and nothing allocates twenty-five
 * objects a frame. The cache is keyed on the object rather than on a string
 * digest of it, because the weights depend on the whole `scores` array and no
 * short key can stand for that.
 */
export function keyWheel(result: KeyResult, options: KeyWheelOptions = {}): KeyWheel {
  const spelling = options.spelling ?? 'auto';
  const reference = options.reference;
  if (typeof result !== 'object' || result === null) return buildWheel(result, spelling, reference);
  const variantKey = `${spelling}|${reference === undefined ? '' : `${reference.tonic}:${reference.mode}`}`;
  let variants = wheelCache.get(result);
  if (variants === undefined) {
    variants = new Map<string, KeyWheel>();
    wheelCache.set(result, variants);
  }
  const cached = variants.get(variantKey);
  if (cached !== undefined) return cached;
  const wheel = buildWheel(result, spelling, reference);
  // Same strategy as `chord-spelling.ts`'s spelling cache: clear the whole map
  // on overflow rather than keep an eviction order nobody reads. One reading is
  // one spelling times however many references a reader clicks through, so the
  // map is small and warm within a bar or two.
  if (variants.size >= WHEEL_VARIANT_LIMIT) variants.clear();
  variants.set(variantKey, wheel);
  return wheel;
}

/** Per-reading, so a reading that goes out of scope takes its wheels with it. */
const wheelCache = new WeakMap<KeyResult, Map<string, KeyWheel>>();
const WHEEL_VARIANT_LIMIT = 64;

function buildWheel(
  result: KeyResult,
  spelling: SpellingPreference,
  reference: Key | undefined,
): KeyWheel {
  const weights = weigh(result);
  // A ring on which nothing outweighs anything is the empty state, and a
  // centre naming a key over it would be the only thing on the dial making a
  // claim. The tie is decided once, here, so the three cannot disagree.
  const heard = [...weights.values()].some((weight) => weight > 0);
  const active = heard ? activeKeyOf(result) : undefined;

  // Which key stands at twelve o'clock: the one a reader turned the ring to,
  // else the one that was heard, else C. A reference whose tonic cannot be read
  // is not a turn of the ring but junk, and it is ignored WHOLE — orientation
  // and mode together — rather than half-applied, which would leave the dial
  // measured from one key and turned to another.
  const turned = reference === undefined ? undefined : stepOfKey(reference);
  const origin =
    turned ?? (active !== undefined ? stepOfPitchClass(active.pitchClass, active.mode) : undefined) ?? 0;
  // No reading, no relatedness: a wheel that has heard nothing must not claim
  // that C is the likeliest key of a piece it has not been given. With a
  // reading, the mode measured FROM is the reference's when a reader chose one.
  const measureMode =
    active === undefined
      ? undefined
      : turned === undefined
        ? active.mode
        : (modeOf(reference?.mode) ?? 'major');

  const outer: KeyWheelSegment[] = [];
  const inner: KeyWheelSegment[] = [];
  for (let index = 0; index < WHEEL_POSITIONS; index += 1) {
    // The ring turns; a segment's signature does not. `position` is where the
    // key stands on the circle and decides its spelling and its `fifths`;
    // `index` is only where on the dial it is drawn.
    const position = (origin + index) % WHEEL_POSITIONS;
    const fifths = fifthsAt(position, spelling);
    const majorPitchClass = FIFTHS_TO_MAJOR_KEY[position];
    outer.push(
      segmentOf(nameFromFifths(fifths), 'major', majorPitchClass, fifths, index, weights, active, measureMode),
    );
    inner.push(
      // Three fifths above the major tonic is its relative minor — A above C —
      // which is nine semitones up and the SAME signature, not a new one.
      segmentOf(
        nameFromFifths(fifths + 3),
        'minor',
        (majorPitchClass + 9) % 12,
        fifths,
        index,
        weights,
        active,
        measureMode,
      ),
    );
  }

  const current = outer.find(isActive) ?? inner.find(isActive);
  return Object.freeze({
    outer: Object.freeze(outer),
    inner: Object.freeze(inner),
    centre: centreOf(result, current),
    // Gated on the same `current` as the centre and the active flag, so silence
    // and a flat tie get NO needle rather than a full-width one over C.
    ...(current === undefined
      ? {}
      : {
          needle: Object.freeze({
            at: current.index,
            ring: current.mode === 'minor' ? ('inner' as const) : ('outer' as const),
            spread: needleSpread(result.confidence),
          }),
        }),
  });
}

/**
 * How closely two keys stand, `0`…`1`, with the ordering this design rests on:
 *
 * | relation to C major | weight |
 * |---|---|
 * | C major, itself | `1` |
 * | G major, F major — dominant and subdominant | `FIFTH_DECAY` |
 * | A minor — the relative minor | `MODE_FACTOR` |
 * | E minor, D minor | `FIFTH_DECAY × MODE_FACTOR` |
 * | C minor — the parallel minor, three flats away | `FIFTH_DECAY³ × MODE_FACTOR` |
 *
 * Falls off monotonically with the fifths distance, which is the shortest way
 * ROUND the circle, so F♯ and G♭ are the same six steps away in either
 * direction — and are the same distance as each other, because they are the
 * same stop.
 *
 * These are relatednesses, not probabilities. They do not sum to one and
 * nothing here should make them: turning twenty-four affinities into a
 * distribution would invent a claim about how likely each key is, which is
 * `detectKey`'s question and is answered with evidence, not with geometry.
 * That evidence is {@link KeyWheelSegment.weight}, and it is a different field
 * for exactly this reason.
 */
export function keyRelatedness(from: Key, to: Key): number {
  const delta = Math.abs(fifthsStepOf(from) - fifthsStepOf(to));
  return relatednessAt(Math.min(delta, WHEEL_POSITIONS - delta), modeOf(from.mode) === modeOf(to.mode));
}

/** The one definition of the curve, shared by {@link keyRelatedness} and every segment. */
function relatednessAt(distance: number, sameMode: boolean): number {
  return Math.pow(FIFTH_DECAY, distance) * (sameMode ? 1 : MODE_FACTOR);
}

/**
 * Steps clockwise from C, `0`…`11`, for any key.
 *
 * A minor key answers with its relative major's step, because they sign the
 * same accidentals and stand at the same place on the circle. A key past seven
 * accidentals is seated where it BELONGS and never where a signature stops:
 * reading G♯ major (eight sharps) off a clamped signature would seat it on D♭
 * and turn the whole wheel to a key four stops away — not an enharmonic
 * respelling, a different key. Answers `0` for a tonic it cannot parse.
 */
export function fifthsStepOf(key: Key): number {
  return stepOfKey(key) ?? 0;
}

/** The same, but `undefined` rather than `0` when the tonic cannot be read. */
function stepOfKey(key: Key): number | undefined {
  const pitchClass = pitchClassOfName(key.tonic);
  if (pitchClass === undefined) return undefined;
  return stepOfPitchClass(pitchClass, modeOf(key.mode) ?? 'major');
}

/**
 * Where a sounding tonic stands on the circle. A minor tonic is three
 * semitones under its relative major's, and it is the MAJOR that names the
 * stop, because a stop is a signature.
 */
function stepOfPitchClass(pitchClass: number, mode: 'major' | 'minor'): number | undefined {
  const major = mode === 'minor' ? (pitchClass + 3) % 12 : pitchClass;
  const step = FIFTHS_TO_MAJOR_KEY.indexOf(major);
  return step < 0 ? undefined : step;
}

/** `'Minor'` is minor; anything this cannot read is nothing at all. */
function modeOf(mode: unknown): 'major' | 'minor' | undefined {
  if (typeof mode !== 'string') return undefined;
  const normalised = mode.trim().toLowerCase();
  return normalised === 'minor' ? 'minor' : normalised === 'major' ? 'major' : undefined;
}

/**
 * An absent or nonsense confidence is not a claim of doubt, so it draws a
 * hairline rather than a NaN angle.
 */
function needleSpread(confidence: number): number {
  if (!Number.isFinite(confidence)) return 0;
  return MAX_NEEDLE_SPREAD * (1 - clamp01(confidence));
}

/**
 * The pitch classes that BELONG to a key, in scale order from the tonic.
 *
 * This is the ghost layer's source (design §3.2 `ghostPitchClasses`): the
 * keyboard paints these faintly so a reader sees the notes the key offers next
 * to the notes actually sounding.
 *
 * Minor means NATURAL minor. The raised seventh of a harmonic minor is a
 * chromatic event that the sounding layer already shows in full colour;
 * ghosting G♯ in A minor would paint a note the key signature does not carry
 * and turn the hint into a claim.
 *
 * The same standard decides the two ways a caller can arrive off-contract. An
 * unparseable tonic gets an empty list, and so does a mode this module does
 * not model — `Key['mode']` admits only the two, but a JavaScript caller can
 * hand over `'dorian'` or `'harmonic minor'`, and reading those as major would
 * ghost C♯, F♯ and G♯ over an A harmonic minor passage: three notes the key
 * does not have, which is the very claim the paragraph above refuses to make.
 * No ghosts is honest. Case is not off-contract, though — `'Minor'` is the
 * minor scale, not a silent flip to the parallel major.
 */
export function keyPitchClasses(key: Key): readonly number[] {
  const tonic = pitchClassOfName(key.tonic);
  if (tonic === undefined) return EMPTY_PITCH_CLASSES;
  const mode = modeOf(key.mode);
  if (mode === 'major') return scaleFrom(tonic, MAJOR_STEPS);
  if (mode === 'minor') return scaleFrom(tonic, NATURAL_MINOR_STEPS);
  return EMPTY_PITCH_CLASSES;
}

function scaleFrom(tonic: number, steps: readonly number[]): readonly number[] {
  return Object.freeze(steps.map((step) => (tonic + step) % 12));
}

/**
 * Which spelling a position takes. `sharp` counts fifths clockwise from C;
 * `flat` is the same pitch class reached the other way round, twelve fifths
 * down. A side is only on offer when its signature is writable at all, which
 * is what leaves nine of the twelve positions with no choice to make.
 */
function fifthsAt(position: number, spelling: SpellingPreference): number {
  const sharp = position;
  const flat = position - WHEEL_POSITIONS;
  if (-flat > MAX_SIGNED_FIFTHS) return sharp;
  if (sharp > MAX_SIGNED_FIFTHS) return flat;
  if (spelling === 'sharp') return sharp;
  if (spelling === 'flat') return flat;
  return -flat <= sharp ? flat : sharp;
}

/**
 * The note this many fifths from C: `1` is G, `-1` is F, `6` is F♯, `-6` is
 * G♭. Seven fifths is one accidental, which is the whole rule: the letters
 * come round every seven steps, one sharper each time round.
 */
function nameFromFifths(fifths: number): string {
  const letter = FIFTHS_TO_LETTER[(((fifths + 1) % 7) + 7) % 7];
  const alter = Math.floor((fifths + 1) / 7);
  const marks = alter > 0 ? '#'.repeat(alter) : 'b'.repeat(-alter);
  return `${letter}${marks}`;
}

function segmentOf(
  tonic: string,
  mode: 'major' | 'minor',
  pitchClass: number,
  fifths: number,
  index: number,
  weights: ReadonlyMap<string, number>,
  active: ActiveKey | undefined,
  measureMode: 'major' | 'minor' | undefined,
): KeyWheelSegment {
  const display = toDisplayName(tonic);
  return Object.freeze({
    id: `${tonic.toLowerCase().replace(/#/g, 's')}-${mode}`,
    label: mode === 'minor' ? display.toLowerCase() : display,
    name: `${display} ${mode}`,
    tonic,
    mode,
    pitchClass,
    fifths,
    index,
    weight: weights.get(candidateKey(pitchClass, mode)) ?? 0,
    // `index` IS the fifths distance from the reference, which is what turning
    // the ring bought: the shortest way round is measured on the dial itself.
    relatedness:
      measureMode === undefined
        ? 0
        : relatednessAt(Math.min(index, WHEEL_POSITIONS - index), mode === measureMode),
    active: active !== undefined && active.pitchClass === pitchClass && active.mode === mode,
  });
}

function isActive(segment: KeyWheelSegment): boolean {
  return segment.active;
}

/**
 * `KeyResult.scores` ranked into 0…1. Keyed by pitch class rather than by
 * tonic string, because the caller's names and the wheel's names are spelled
 * by different rules and only the chroma is common ground.
 */
function weigh(result: KeyResult): ReadonlyMap<string, number> {
  const raw = new Map<string, number>();
  const scores: KeyResult['scores'] = Array.isArray(result.scores) ? result.scores : [];
  for (const entry of scores) {
    if (!Number.isFinite(entry.score)) continue;
    const pitchClass = pitchClassOfName(entry.tonic);
    if (pitchClass === undefined) continue;
    const id = candidateKey(pitchClass, entry.mode);
    const prior = raw.get(id);
    // Two spellings of one key can arrive as two entries. The better score is
    // what that pitch class is worth; the loser is the same key spelled worse.
    if (prior === undefined || entry.score > prior) raw.set(id, entry.score);
  }

  let low = Number.POSITIVE_INFINITY;
  let high = Number.NEGATIVE_INFINITY;
  for (const score of raw.values()) {
    low = Math.min(low, score);
    high = Math.max(high, score);
  }

  // One candidate is not a tie: it is a caller who trimmed `scores` to the
  // winner, and the one key on the ring IS the whole ranking. Every candidate
  // scoring the same is the flat tie, and that ring says nothing at all.
  const spread = high - low;
  const flat = spread <= 0;
  const sole = flat && raw.size === 1 ? 1 : 0;
  const weights = new Map<string, number>();
  for (const [id, score] of raw) {
    weights.set(id, flat ? sole : clamp01((score - low) / spread));
  }
  return weights;
}

/**
 * Which segment lights up. An empty `scores` list is `keyFromHistogram`'s
 * documented shape for "nothing to detect" — its `tonic` and `mode` are
 * placeholders, so lighting up C major there would invent a reading of
 * silence.
 */
function activeKeyOf(result: KeyResult): ActiveKey | undefined {
  if (!Array.isArray(result.scores) || result.scores.length === 0) return undefined;
  const pitchClass = pitchClassOfName(result.tonic);
  if (pitchClass === undefined) return undefined;
  return {pitchClass, mode: result.mode === 'minor' ? 'minor' : 'major'};
}

function centreOf(result: KeyResult, current: KeyWheelSegment | undefined): KeyWheelCentre {
  if (current === undefined) return Object.freeze({primary: UNKNOWN_KEY_LABEL});
  const confidence = Number.isFinite(result.confidence) ? clamp01(result.confidence) : 0;
  return Object.freeze({
    primary: current.name,
    // The SEGMENT's tonic, never the result's: they are two spellings of one
    // sound whenever the wheel re-spells, and this is the one the centre printed.
    key: Object.freeze({tonic: current.tonic, mode: current.mode}),
    secondary: `${Math.round(confidence * 100)}%`,
  });
}

function candidateKey(pitchClass: number, mode: Key['mode']): string {
  return `${pitchClass}:${mode}`;
}

/**
 * A tonic back into a pitch class. `NOTE_NAMES.indexOf` cannot do this: that
 * table holds one name per pitch class, so it fails on every spelling it does
 * not happen to hold — `Gb`, `D#`, `Cb` — which is most of what this file
 * produces. Anything unparseable answers `undefined` rather than 0, so a
 * caller's junk cannot silently become C.
 */
function pitchClassOfName(name: string): number | undefined {
  if (typeof name !== 'string') return undefined;
  const match = /^([A-Ga-g])(#{1,2}|b{1,2})?$/.exec(name.trim());
  if (!match) return undefined;
  const natural = NATURAL_PITCH_CLASSES[match[1].toUpperCase()];
  if (natural === undefined) return undefined;
  const marks = match[2] ?? '';
  const alter = marks.startsWith('#') ? marks.length : -marks.length;
  return (((natural + alter) % 12) + 12) % 12;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
