/**
 * The arithmetic behind every pitch surface: where a key sits, where a step of
 * the ladder sits, and where a fret wire sits. No DOM, no tokens, no theory.
 *
 * Three surfaces draw the same pitches three ways, and each of them needs a
 * number the other two also need — the keyboard's black-key offset, the staff's
 * ledger runs, the fretboard's window. Keeping the numbers here is what lets
 * `pitch.ts` stay a DOM module and lets every one of these be tested with
 * integers.
 *
 * ## What this module is NOT allowed to know
 *
 * It never names a pitch and never decides which pitch is which degree. A
 * caller says "diatonic step 28, role 'root', label 'C4'"; this module answers
 * "y = 10, one ledger at 28". That split is the kit's whole contract, and it is
 * why `staffPlacement` takes a diatonic step rather than a MIDI number: F#4 and
 * Gb4 are the same key and different lines, and only the caller knows which
 * spelling it meant.
 *
 * `isBlackKey` / `pianoKeyLayout` moved here out of `../note` so that
 * `@webmusic/ui/pitch` can reuse the keyboard geometry without dragging
 * `PointerSurface` and `NoteSurfaceInteractions` — some 470 lines of input
 * machinery a read-out surface never runs — into its chunk. `../note`
 * re-exports both, so its published surface is unchanged.
 */

// ---------------------------------------------------------------------------
// The keyboard.
// ---------------------------------------------------------------------------

export interface NotePianoKey {
  midi: number;
  black?: boolean;
  left: number;
  width: number;
  label?: string;
}

const BLACK_PITCH_CLASSES = new Set([1, 3, 6, 8, 10]);

/** True for the five raised keys of each octave. */
export function isBlackKey(midi: number): boolean {
  return BLACK_PITCH_CLASSES.has(((midi % 12) + 12) % 12);
}

/**
 * Lay a keyboard out across the full width of its host: white keys divide the
 * width evenly, black keys straddle the boundary between the whites they sit
 * between. Positions are percentages, so the caller sizes the board with CSS
 * and the geometry follows.
 *
 * `labels` optionally names keys (e.g. the QWERTY letter that plays each one).
 *
 * A black key's `left` is the BOUNDARY it straddles, not its own left edge —
 * the centring `translateX(-50%)` lives in the stylesheet. A surface that
 * paints the box itself must re-declare it or every black key lands half a key
 * to the right.
 *
 * A range that STARTS or ENDS on a black key reserves half a white key at that
 * end. A raised key straddles the boundary between two whites, and at the edge
 * of the range one of those two whites does not exist — so without the reserve
 * `left` is `0%` or `100%`, the translate takes half the key past the board and
 * it paints outside the widget. Every white-ended range, which is every
 * default, divides exactly as it did before.
 *
 * The reserve is HERE and not in a mount's padding because three surfaces call
 * this helper — the note input, `<keyboard-view>` and the pitch keyboard — and
 * a fix that lives in one of them leaves the other two overflowing. It is also
 * why nothing downstream may inset the board again: two compensations inset a
 * black-ended range twice.
 */
export function pianoKeyLayout(
  startMidi: number,
  endMidi: number,
  labels?: ReadonlyMap<number, string>,
): NotePianoKey[] {
  const lo = Math.min(startMidi, endMidi);
  const hi = Math.max(startMidi, endMidi);
  const keys: {midi: number; black: boolean}[] = [];
  for (let midi = lo; midi <= hi; midi += 1) keys.push({midi, black: isBlackKey(midi)});
  const whites = keys.filter((key) => !key.black);
  const lead = keys[0]?.black === true ? 0.5 : 0;
  const tail = keys[keys.length - 1]?.black === true ? 0.5 : 0;
  const width = 100 / Math.max(1, whites.length + lead + tail);
  return keys.map((key) => ({
    midi: key.midi,
    black: key.black,
    left:
      (lead +
        (key.black
          ? whites.filter((white) => white.midi < key.midi).length
          : whites.findIndex((white) => white.midi === key.midi))) *
      width,
    width: key.black ? width * 0.62 : width,
    ...(labels?.get(key.midi) !== undefined ? {label: labels.get(key.midi)!} : {}),
  }));
}

/** The lowest and highest MIDI numbers a keyboard may be asked to draw. */
export const MIDI_FLOOR = 0;
export const MIDI_CEILING = 127;

/**
 * The widest span one board draws. `pianoKeyLayout(0, 20000)` allocates 20001
 * objects and answers a question nobody asked; a surface takes untrusted
 * numbers from a snapshot, so the span is capped here rather than in each of
 * the three callers.
 */
export const MAX_KEYBOARD_SPAN = 88;

// ---------------------------------------------------------------------------
// The staff.
//
// One continuous diatonic ladder, C0 = 0, D0 = 1 … B0 = 6, C1 = 7, middle C
// (C4) = 28. Vertical positions are HALF-SPACES measured down from diatonic 38,
// which is the treble staff's top line: y = 38 - diatonic. One diatonic step is
// one half-space, so a line position is an even diatonic step and a space
// position is an odd one.
//
// The grand staff falls out of the same ladder with no special case: the treble
// lines are 38 / 36 / 34 / 32 / 30 and the bass lines are 26 / 24 / 22 / 20 /
// 18, which leaves exactly one line position (28) in the gap — middle C, on its
// own ledger, centred between the two staves.
// ---------------------------------------------------------------------------

/** Which staves a system draws, outermost first. */
export type StaffSystem = 'grand' | 'treble' | 'bass';

interface StaffRange {
  /** Diatonic step of the top line. */
  top: number;
  /** Diatonic step of the bottom line. */
  bottom: number;
}

const TREBLE: StaffRange = {top: 38, bottom: 30};
const BASS: StaffRange = {top: 26, bottom: 18};

const SYSTEMS: Readonly<Record<StaffSystem, readonly StaffRange[]>> = {
  grand: [TREBLE, BASS],
  treble: [TREBLE],
  bass: [BASS],
};

/** The staves one system draws, from the top down. */
export function staffRanges(system: StaffSystem = 'grand'): readonly StaffRange[] {
  return SYSTEMS[system] ?? SYSTEMS.grand;
}

/** Every drawn line of one system, as diatonic steps, from the top down. */
export function staffLines(system: StaffSystem = 'grand'): number[] {
  const lines: number[] = [];
  for (const range of staffRanges(system)) {
    for (let step = range.top; step >= range.bottom; step -= 2) lines.push(step);
  }
  return lines;
}

/** The half-space y of one diatonic step. Line positions are even steps. */
export function staffY(diatonic: number): number {
  return 38 - diatonic;
}

export interface StaffPlacement {
  /** Half-spaces down from diatonic 38 — the treble staff's top line. */
  y: number;
  /**
   * The diatonic steps that need a ledger, ordered from the staff outward. A
   * ledger sits only on a LINE position, so consecutive entries are two
   * diatonic steps apart and a note in a space borrows the ledger below it.
   */
  ledgers: readonly number[];
}

/**
 * Where one diatonic step sits, and what it has to stand on.
 *
 * `staffPlacement(28)` is middle C: one ledger, at 28 itself.
 * `staffPlacement(42)` is C6: two ledgers, `[40, 42]` — the treble's top line
 * is 38, so the only line positions above it up to C6 are A5 and C6.
 */
export function staffPlacement(diatonic: number, system: StaffSystem = 'grand'): StaffPlacement {
  const step = clampStep(diatonic);
  return {y: staffY(step), ledgers: staffLedgers(step, system)};
}

/**
 * The lowest and highest steps this will place: C-1 (MIDI 0) and E10, one
 * ledger past the top of anything MIDI can name.
 *
 * `Number.isFinite` catches NaN and Infinity but not a large FINITE number, and
 * a malformed MusicXML `<octave>` makes one. Every step outside a staff needs a
 * ledger LINE per line between the staff and the note, so `staffPlacement(1e6)`
 * asks for half a million of them — and `mountStaff` turns each into an SVG
 * `<line>`. Measured: 4,981 ledger nodes at diatonic 10,000, and a 4 GB heap
 * abort at 1e7. `staffPlacement` is a published export and `mountStaff` accepts
 * any finite `diatonic` from a snapshot, so the bound belongs here, once,
 * rather than in each caller.
 *
 * Nothing an instrument can play is clipped: MIDI 0 is C-1 (step -7) and MIDI
 * 127 is G9 (step 67), both inside the range with every ledger they need.
 */
const LOWEST_STEP = -7;
const HIGHEST_STEP = 70;

/** Middle C, the step a non-finite one falls back to. */
const FALLBACK_STEP = 28;

/** A step this can actually draw. See {@link LOWEST_STEP}. */
function clampStep(diatonic: number): number {
  if (!Number.isFinite(diatonic)) return FALLBACK_STEP;
  return Math.min(HIGHEST_STEP, Math.max(LOWEST_STEP, Math.round(diatonic)));
}

function staffLedgers(step: number, system: StaffSystem): number[] {
  const ranges = staffRanges(system);
  for (const range of ranges) {
    if (step <= range.top && step >= range.bottom) return [];
  }
  const highest = ranges[0]!;
  const lowest = ranges[ranges.length - 1]!;
  if (step > highest.top) return runUp(highest.top + 2, step);
  if (step < lowest.bottom) return runDown(lowest.bottom - 2, step);
  // Between two staves, the note leans on whichever staff it is nearer; a tie
  // is middle C, and both branches answer with the one line position it needs.
  for (let index = 0; index + 1 < ranges.length; index += 1) {
    const upper = ranges[index]!;
    const lower = ranges[index + 1]!;
    if (step < upper.bottom && step > lower.top) {
      return step - lower.top <= upper.bottom - step
        ? runUp(lower.top + 2, step)
        : runDown(upper.bottom - 2, step);
    }
  }
  return [];
}

/** Line positions from `first` up to and including `limit`. */
function runUp(first: number, limit: number): number[] {
  const run: number[] = [];
  for (let step = first; step <= limit; step += 2) run.push(step);
  return run;
}

/** Line positions from `first` down to and including `limit`. */
function runDown(first: number, limit: number): number[] {
  const run: number[] = [];
  for (let step = first; step >= limit; step -= 2) run.push(step);
  return run;
}

/**
 * The staff's own drawing constants, in half-spaces. They are constants and not
 * tokens on purpose: a `--wui-*` custom property does not inherit in jsdom and
 * reading a number back out of `getComputedStyle` would make every geometry
 * assertion vacuously true. Themes move colour; the shapes stay put.
 */
export const NOTEHEAD_RX = 1.25;
export const NOTEHEAD_RY = 0.95;
/** Half the width of one ledger line. */
export const LEDGER_REACH = 1.9;
/** How far the upper head of a second is pushed right, so the two do not overlap. */
export const SECOND_OFFSET = 2.4;
/**
 * How far above and below its own step one drawn mark reaches: the notehead is
 * the shorter of the two and an accidental the taller. Used to grow the frame
 * around what was actually drawn, so a note far outside the staff is FRAMED
 * rather than clipped away by the viewport.
 */
export const NOTE_REACH = 2;
/**
 * The left edge of the drawing, in half-spaces. Negative on purpose: the
 * brace's belly and the leftmost accidental of a dense column both reach a
 * little past the origin, and a frame that started at 0 would slice them.
 */
export const STAFF_LEFT = -1;
/** Where a clef glyph is placed, when the caller supplies one. */
export const STAFF_CLEF_X = 3;
/** Where a key signature starts — clear of the clef, whether or not one is drawn. */
export const STAFF_SIGNATURE_X = 8;
/**
 * The narrowest gutter before the first column. A key signature widens it by
 * its own accidentals' widths: a fixed lead-in put seven flats through the
 * first chord and off the right-hand edge.
 */
export const STAFF_LEAD_IN = 9;
/** How wide one chord column is. */
export const STAFF_COLUMN_WIDTH = 8;
/** Padding above the top line and below the bottom line. */
export const STAFF_MARGIN = 6;
/**
 * The most columns one staff draws. A snapshot is untrusted input, and a
 * `column` of two million runs the draw loop two million times and writes a
 * `viewBox` sixteen million units wide, which scales the whole staff to
 * nothing. Capped here beside the keyboard's span and the neck's fret count.
 */
export const MAX_STAFF_COLUMNS = 256;

/**
 * The accidental glyphs, drawn rather than typed.
 *
 * Every one is a stroked path in half-spaces around its own centre, so the kit
 * can place a sharp or a flat without a font and without a notation character
 * ever appearing in this package. Clefs are the deliberate exception: their
 * shapes are not reducible to four strokes, so `mountStaff` positions a glyph
 * STRING the caller supplies and draws nothing when the caller supplies none.
 */
export type StaffAccidental = 'sharp' | 'flat' | 'natural' | 'double-sharp' | 'double-flat';

export interface AccidentalGlyph {
  path: string;
  /**
   * Half-spaces of horizontal room this shape occupies, drawn around its own
   * centre. It is the STEP a column's accidentals stack by and the width a key
   * signature advances by — a single constant step instead would overlap a
   * double flat with its neighbour and leave a hole beside a double sharp.
   */
  width: number;
}

const ACCIDENTALS: Readonly<Record<StaffAccidental, AccidentalGlyph>> = {
  sharp: {
    path: 'M-0.5,-1.75 L-0.5,1.45 M0.5,-1.45 L0.5,1.75 M-1,-0.35 L1,-0.75 M-1,0.85 L1,0.45',
    width: 2.2,
  },
  flat: {path: 'M-0.5,-2 L-0.5,1.4 M-0.5,0.25 C0.75,-0.45 0.85,0.75 -0.5,1.4', width: 2},
  natural: {
    path: 'M-0.5,-1.8 L-0.5,1.2 M0.5,-1.2 L0.5,1.8 M-0.5,-0.5 L0.5,-0.9 M-0.5,0.9 L0.5,0.5',
    width: 2,
  },
  'double-sharp': {path: 'M-0.7,-0.7 L0.7,0.7 M-0.7,0.7 L0.7,-0.7', width: 1.8},
  'double-flat': {
    path: 'M-1.35,-2 L-1.35,1.4 M-1.35,0.25 C-0.1,-0.45 0,0.75 -1.35,1.4 M0.15,-2 L0.15,1.4 M0.15,0.25 C1.4,-0.45 1.5,0.75 0.15,1.4',
    width: 3.4,
  },
};

/** The stroked shape for one accidental, or nothing when the name is unknown. */
export function accidentalGlyph(name: string | undefined): AccidentalGlyph | undefined {
  if (!name) return undefined;
  return ACCIDENTALS[name as StaffAccidental];
}

// ---------------------------------------------------------------------------
// The fretboard.
// ---------------------------------------------------------------------------

/** Where one pitch can be stopped on one string. */
export interface FretPosition {
  stringIndex: number;
  fret: number;
}

export interface FretWindow {
  firstFret: number;
  fretCount: number;
}

/** The default window: five frets from the nut. */
export const DEFAULT_FRET_COUNT = 5;
/** Beyond this a neck stops being a neck and the drawing stops being legible. */
export const MAX_FRET_COUNT = 24;
export const MAX_FIRST_FRET = 24;

function windowOf(options: Partial<FretWindow> | undefined): FretWindow {
  const fretCount = Math.max(
    1,
    Math.min(MAX_FRET_COUNT, Math.round(numberOr(options?.fretCount, DEFAULT_FRET_COUNT))),
  );
  const firstFret = Math.max(
    0,
    Math.min(MAX_FIRST_FRET, Math.round(numberOr(options?.firstFret, 0))),
  );
  return {firstFret, fretCount};
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/**
 * Every place inside the window that sounds this pitch. Arithmetic, not theory:
 * WHICH of them a hand should take is the caller's answer, and this only says
 * which ones exist.
 *
 * The window is CLOSED AT BOTH ENDS: `firstFret … firstFret + fretCount`, which
 * is `fretCount + 1` distinct fret numbers. At the nut that is the open string
 * plus `fretCount` stopped frets — the five-fret box every chord chart draws —
 * and `mountFretboard` frames exactly the same span, so a position this
 * function admits is always a position the neck has room to draw.
 *
 * `tuning[i]` is the open pitch of string `i`, counting from the string drawn
 * at the edge of the board.
 */
export function fretPositionsFor(
  midi: number,
  tuning: readonly number[],
  options?: Partial<FretWindow>,
): FretPosition[] {
  if (!Number.isFinite(midi)) return [];
  const {firstFret, fretCount} = windowOf(options);
  const last = firstFret + fretCount;
  const positions: FretPosition[] = [];
  for (let stringIndex = 0; stringIndex < tuning.length; stringIndex += 1) {
    const open = tuning[stringIndex]!;
    if (!Number.isFinite(open)) continue;
    const fret = Math.round(midi) - Math.round(open);
    if (fret < firstFret || fret > last) continue;
    positions.push({stringIndex, fret});
  }
  return positions;
}

/**
 * Neck space: one fret is one unit, one string gap is one unit, and both are
 * absolute — measured from the nut and from the edge string, not from whatever
 * window happens to be in view.
 *
 * Uniform spacing, deliberately, rather than the `1 - 2^(-n/12)` a real neck
 * has. A window that slides has to be ONE transform write on a group whose
 * contents did not change; a proportional neck makes the window's own width a
 * function of where it sits, so moving it means a redraw and a scale, and a
 * scale drags the dot sizes with it. A five-fret box with even spacing is also
 * what every chord chart already draws.
 */
export const FRET_UNIT = 16;
export const STRING_GAP = 12;

/** Where the wire below fret `n` sits. Wire 0 is the nut. */
export function fretWireX(fret: number): number {
  return (Number.isFinite(fret) ? fret : 0) * FRET_UNIT;
}

/**
 * Where a stopped fret's dot sits — halfway between its own wire and the one
 * below it. An open string has no space of its own, so its marker sits just
 * clear of the nut.
 */
export function fretDotX(fret: number): number {
  const value = Number.isFinite(fret) ? fret : 0;
  return value <= 0 ? -FRET_UNIT * 0.55 : (value - 0.5) * FRET_UNIT;
}

export interface FretWindowRequest {
  /** The frets that have to be visible. Non-finite entries are ignored. */
  frets: readonly number[];
  fretCount?: number;
  /** The window in force, so a settled hand is not made to move. */
  previous?: number;
}

/**
 * Where the window should start so every given fret is inside it.
 *
 * Hysteresis, and it is the whole point: a window that still holds every mark
 * DOES NOT MOVE. Without that rule a shape alternating between the low and high
 * end of a window drags the neck back and forth once per chord, which reads as
 * a fault rather than as a hand.
 *
 * An open string (fret 0) never forces the window off the nut on its own — it
 * is playable from any position — but a window already at the nut stays there.
 */
export function resolveFretWindow(request: FretWindowRequest): number {
  const {fretCount} = windowOf({fretCount: request.fretCount});
  const stopped = request.frets.filter((fret) => Number.isFinite(fret) && fret > 0);
  if (stopped.length === 0) return 0;
  const lowest = Math.min(...stopped);
  const highest = Math.max(...stopped);

  const settled =
    typeof request.previous === 'number' && Number.isFinite(request.previous)
      ? Math.max(0, Math.round(request.previous))
      : undefined;
  if (settled !== undefined && lowest >= settled && highest <= settled + fretCount) return settled;

  // The window has to start at or below the lowest stopped fret and at or above
  // the point where the highest one would leave the top.
  const latest = Math.max(0, highest - fretCount);
  const earliest = Math.max(0, lowest);
  // A shape wider than the window cannot be framed; show it from its low end,
  // which is where its bass is.
  if (latest > earliest) return Math.max(0, lowest - 1);
  // One fret of air below the shape, so the lowest stopped fret is not sitting
  // on the nut line — unless a window is already in force, in which case moving
  // as little as possible beats re-centring.
  //
  // A surface with no marks yet IS at the nut: it draws the nut, the open
  // strings and the first frets, so `previous: 0` on the very first snapshot is
  // a true statement about what is on screen, not a placeholder. That is why a
  // shape at the sixth fret slides up to the third and stops there rather than
  // jumping to the fifth — the open position is the reference a guitarist reads
  // from, and the neck gives up as little of it as the shape demands.
  const preferred = settled ?? Math.max(0, lowest - 1);
  return Math.min(earliest, Math.max(latest, preferred));
}
