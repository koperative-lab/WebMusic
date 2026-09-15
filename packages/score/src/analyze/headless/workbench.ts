// ============================================================================
// The projections — the layer that turns an analysis into something a surface
// can draw, without ever touching a surface.
//
// This module is the hinge the redesign turns on. Listing a result is data's
// job; a Web Component's job is the performance. So every shape a workbench
// stage or dock renders is computed HERE, in plain objects, and the element
// hands them straight to a presenter. Nothing below imports `@webmusic/ui` —
// it is an optional peer, and this layer is checked for DOM-freedom down to
// the level of a type annotation.
//
// ## The one function that keeps four surfaces honest
//
// {@link projectSounding} is called ONCE per sounding set and its answer is
// shared by the name plate, the stave, the fretboard and the keyboard. That is
// why they cannot disagree about a sounding C#: not because four renderers were
// each told the same convention, but because there is one answer.
//
// ## Why the flow projections take the Score
//
// `ChordSegment` carries pitch CLASSES. A stave, a keyboard and a fretboard all
// need octaves, and inventing them from pitch classes is fake precision that a
// musician spots instantly. So the score comes in and
// {@link soundingMidisAt} reads the real notes out of it. `AnalysisResult`
// itself is untouched — it is the frozen worker payload and not a place to park
// a rendering convenience.
//
// ## Two rulers, on purpose
//
// Every band carries `start`/`end` in **nominal seconds** — the conveyor's own
// axis, so a ritardando visibly stretches a band — and `stampStart`/`stampEnd`
// in **quarters**, which is what a playhead is fed. The quarters-to-seconds
// conversion happens once here, per analysis change, and never inside a frame:
// `TimeMap.quartersToSeconds` allocates a `Rational` on every call.
//
// ## Structural compatibility, not shared types
//
// The view types below are structural twins of `@webmusic/ui`'s rendering
// types, declared separately because this layer may not import that package.
// `test/analyze/ui-contract.test.ts` assigns one to the other at compile time:
// if it still compiles, the two sides have not drifted.
// ============================================================================

import {get as tonalChord} from '@tonaljs/chord';
import {
  isPitchedNote,
  noteMidi,
  notesOverlapping,
  Pitch,
  Rational,
  type Note,
  type Score,
} from '../../core';
import {
  buildVoiceLanes,
  CLEF_GLYPHS,
  fretboardVoicing,
  keyFromHistogram,
  keyPitchClasses as coreKeyPitchClasses,
  keySignatureAccidentals,
  keyWheel,
  NO_CHORD_LABEL,
  pitchClass,
  spellChord,
  TUNINGS,
  tuningLabels,
  type ChordNaming,
  type ChordSpelling,
  type SpelledPitch,
  type SpellingPreference,
  type StaffAccidental,
  type ToneRole,
  type Tuning,
} from '../core';
import type {
  DistributionBin,
  Key,
  KeyResult,
  Motif,
} from '../core/types';
import type {AnalysisResult} from './session';

// ---------------------------------------------------------------------------
// The view types. Structural twins of the kit's; see the header.
// ---------------------------------------------------------------------------

/** One mark on a pitch surface: what to draw, and what it is doing. */
export interface PitchMarkView {
  midi: number;
  /** The spelling this analysis chose — `'Eb4'`. The kit never names a pitch. */
  label?: string;
  /** The figure to print — `'R'`, `'7'`, `'#11'`. Read off the chord's own intervals. */
  mark?: string;
  role?: ToneRole;
  weight?: number;
  active?: boolean;
  id?: string;
  /** When it started sounding, on the caller's ruler. */
  since?: number;
}

/** A mark on a stave. `diatonic` follows the SPELLING: F#4 and Gb4 are two lines. */
export interface StaffMarkView extends PitchMarkView {
  diatonic: number;
  accidental?: StaffAccidental;
  column?: number;
}

export interface StaffView {
  marks: readonly StaffMarkView[];
  system?: 'grand' | 'treble' | 'bass';
  /** Clef glyphs live in this package: the kit positions a clef, it does not know one. */
  clefs?: {upper?: string; lower?: string};
  keySignature?: readonly {diatonic: number; accidental: StaffAccidental}[];
  columns?: number;
  activeColumn?: number;
  emptyLabel?: string;
  now?: number;
}

/** One dot on a neck. Geometry the caller chose; the kit places it. */
export interface FretMarkView {
  stringIndex: number;
  fret: number;
  midi?: number;
  role?: ToneRole;
  label?: string;
  mark?: string;
  active?: boolean;
  since?: number;
  weight?: number;
  id?: string;
}

export interface FretboardBarreView {
  fret: number;
  fromString: number;
  toString: number;
}

export interface FretboardView {
  strings?: number;
  firstFret?: number | 'auto';
  fretCount?: number;
  marks: readonly FretMarkView[];
  muted?: readonly number[];
  stringLabels?: readonly string[];
  inlays?: readonly number[];
  emptyLabel?: string;
  barre?: readonly FretboardBarreView[];
  now?: number;
}

/** One reading of a sounding set, as a name plate shows it. */
export interface ChordNameView {
  symbol: string;
  full?: string;
  /** How this reading differs — `'inversion'`, `'rootless'`. */
  note?: string;
  weight?: number;
  /** Opaque identity. A change pops even when the symbol is byte-identical. */
  key?: string;
}

export interface HarmonyVoiceView {
  label?: string;
  mark?: string;
  role?: ToneRole;
}

export interface NameplateView {
  primary?: ChordNameView;
  alternates?: readonly ChordNameView[];
  voicing?: readonly HarmonyVoiceView[];
  caption?: string;
  history?: readonly string[];
  confidence?: number;
  emphasis?: 'hero' | 'display';
  emptyLabel?: string;
  next?: ChordNameView;
}

/** One item on the conveyor. Two rulers; see the header. */
export interface FlowBandView {
  id: string;
  /** Nominal seconds — the lane axis. */
  start: number;
  end: number;
  /** Quarters — the stamping axis a playhead is fed. */
  stampStart?: number;
  stampEnd?: number;
  spans?: readonly {start: number; end: number}[];
  track?: number;
  primary?: string;
  secondary?: string;
  trailing?: string;
  glyph?: string;
  /** A normalised contour inside the band. `y` of 1 draws at the top. */
  points?: readonly {at: number; y: number}[];
  tone?: number;
  role?: ToneRole;
  severity?: 'info' | 'warning' | 'error';
  weight?: number;
  /** Siblings that light together — every occurrence of one motif. */
  group?: string;
  disabled?: boolean;
}

export interface FlowTrackView {
  id: string;
  label?: string;
  sublabel?: string;
  muted?: boolean;
}

export interface FlowFlagView {
  id: string;
  at: number;
  track?: number;
  severity?: 'info' | 'warning' | 'error';
  label?: string;
}

export interface FlowBracketView {
  id: string;
  /** Nominal seconds — the lane axis. */
  start: number;
  end: number;
  /**
   * Quarters — the stamping axis, carried for the same reason a band carries
   * it: the readable twin is built from these brackets, and a semantic row is
   * stamped in quarters while the geometry beside it is drawn in seconds.
   */
  stampStart?: number;
  stampEnd?: number;
  from: number;
  to: number;
  severity?: 'info' | 'warning' | 'error';
  label?: string;
}

export interface FlowLaneView {
  bands: readonly FlowBandView[];
  tracks?: readonly FlowTrackView[];
  /** Which row owns the instant. Defaults to the topmost one that has bands. */
  primaryTrack?: number;
  flags?: readonly FlowFlagView[];
  brackets?: readonly FlowBracketView[];
  ruler?: readonly {at: number; label: string; major?: boolean}[];
  span?: {start: number; end: number};
  now: number;
  playing?: boolean;
  future?: boolean;
  pinned?: {primary?: string; secondary?: string};
  focusGroup?: string;
  emptyLabel?: string;
  disabled?: boolean;
}

/** One entry of a ranked, TIMELESS read-out. A strip is not a lane. */
export interface ChipItemView {
  id: string;
  start: number;
  end: number;
  primary: string;
  secondary?: string;
  roman?: string;
  trailing?: string;
  /** 0…1 — the bar. */
  meter?: number;
  /** 0…1 — the whole-piece answer, drawn behind the bar. */
  meterGhost?: number;
  occurrences?: readonly number[];
  spans?: readonly {start: number; end: number}[];
  tone?: number;
  severity?: 'info' | 'warning' | 'error';
}

export interface WheelSegmentView {
  id: string;
  label: string;
  weight?: number;
  active?: boolean;
  /**
   * The key this sector IS. Carried so a reader who clicks one can be answered
   * — the id is slugged for the DOM and cannot be parsed back into `F#`.
   */
  tonic: string;
  mode: 'major' | 'minor';
}

export interface WheelNeedleView {
  at: string | number;
  ring?: 'outer' | 'inner';
  /** Width in segments. Confidence draws the needle's WIDTH, never its position. */
  spread?: number;
  label?: string;
}

/** Both rings, the needle, and the two lines of text at the centre. */
export interface TonalityView {
  outer: readonly WheelSegmentView[];
  inner: readonly WheelSegmentView[];
  needle?: WheelNeedleView;
  /**
   * The centre read-out. Two adjacent strings and not one, because the headline
   * and its confidence are two different claims — the key is a conclusion, the
   * confidence is how far it stands out from the runner-up.
   */
  centre: {
    primary: string;
    secondary?: string;
    /** The wheel's reconciled spelling, for the same key signature on every dock. */
    key?: Key;
  };
}

// ---------------------------------------------------------------------------
// Limits. Written down rather than discovered.
// ---------------------------------------------------------------------------

/**
 * Notes the sounding roll under a chord lane will draw before it gives up.
 *
 * Beyond this the honest fix is to merge the data here, not to virtualise the
 * nodes: a recycled band is a silently dead highlight, because the playhead
 * finds its targets by querying the DOM.
 */
const MAX_ROLL_NOTES = 600;
/** Points in one voice contour. More than this is a polyline nobody can read. */
const MAX_CONTOUR_POINTS = 240;
/** Voice tracks a lane will stack before folding the rest away. */
const MAX_VOICE_TRACKS = 6;
/** Motif tracks before the tail folds into one row. */
const MAX_MOTIF_TRACKS = 4;
/** Bar numbers a ruler will print. */
const MAX_RULER_TICKS = 400;
/** Default window for the rolling key read, in quarters — two bars of 4/4. */
const DEFAULT_KEY_WINDOW_QUARTERS = 8;

// ---------------------------------------------------------------------------
// The sounding set: one answer, four surfaces.
// ---------------------------------------------------------------------------

/** What the reader has told us about the instrument and the music. */
export interface SoundingContext {
  /** Biases spelling toward the key's own accidentals, and draws its signature. */
  key?: Key;
  /** The instrument the fretboard dock is holding. Defaults to a standard guitar. */
  tuning?: Tuning;
  spelling?: SpellingPreference;
  /** Promote one naming and recompute every role against it — a reader's pick. */
  prefer?: string;
  /** When each pitch started, on the caller's own ruler. */
  since?: ReadonlyMap<number, number>;
  /** The caller's current position, on that same ruler. */
  now?: number;
}

/** One sounding set, answered once, for every dock at once. */
export interface SoundingProjection {
  /**
   * The naming itself, so a caller reading `.chord` off an element does not
   * pay for a second {@link spellChord}.
   */
  readonly spelling: ChordSpelling;
  readonly marks: readonly PitchMarkView[];
  readonly staff: StaffView;
  readonly fret: FretboardView;
  readonly naming: NameplateView;
  /** One line of prose for a status bar or a live region. */
  readonly description: string;
}

/**
 * The hinge: name a sounding set once, and hand the same answer to the name
 * plate, the stave, the fretboard and the keyboard.
 *
 * ```ts
 * const sounding = projectSounding([43, 59, 62, 65], {key: {tonic: 'C', mode: 'major'}});
 * sounding.naming.primary?.symbol;  // 'G7'
 * ```
 */
export function projectSounding(
  midis: readonly number[],
  context: SoundingContext = {},
): SoundingProjection {
  const spelling = spellChord(midis, {
    spelling: context.spelling,
    key: context.key,
    prefer: context.prefer,
  });
  const since = context.since;
  const marks: PitchMarkView[] = spelling.pitches.map((pitch) => ({
    midi: pitch.midi,
    label: pitch.name,
    mark: pitch.degreeLabel,
    role: pitch.role,
    active: true,
    id: `pitch-${pitch.midi}`,
    since: since?.get(pitch.midi),
  }));

  const staff: StaffView = {
    marks: spelling.pitches.map((pitch, index) => ({
      ...marks[index],
      diatonic: pitch.diatonic,
      accidental: pitch.accidental,
      column: 0,
    })),
    system: 'grand',
    clefs: {upper: CLEF_GLYPHS.treble, lower: CLEF_GLYPHS.bass},
    keySignature: context.key ? keySignatureAccidentals(context.key, 'treble') : [],
    columns: 1,
    activeColumn: 0,
    emptyLabel: NO_CHORD_LABEL,
    now: context.now,
  };

  return {
    spelling,
    marks,
    staff,
    fret: projectFretboard(spelling, context),
    naming: projectNameplate(spelling),
    description: describe(spelling),
  };
}

/**
 * The real notes sounding at a metrical position — octaves included.
 *
 * It reads the score, so what comes back is what was written, never a pitch
 * class dressed up as a pitch.
 *
 * **The window looks BACKWARDS, and that is the whole design of it.** A
 * position is an instant and a chord is not, so a playhead landing in the gap
 * between two attacks would report silence in the middle of a held chord; the
 * window is what covers that gap. But a window opening FORWARD reads across the
 * next barline for its whole width, and then the last beat of every chord hands
 * the docks both chords at once — eight pitches under a name plate that goes
 * blank because no chord is called G7-and-C. Looking back instead answers with
 * the notes whose onset the playhead has actually passed, which is the only set
 * a listener has heard.
 */
export function soundingMidisAt(
  score: Score,
  quarters: number,
  options: {windowQuarters?: number} = {},
): number[] {
  const window = Math.max(0.0625, options.windowQuarters ?? 0.25);
  const at = Math.max(0, Number.isFinite(quarters) ? quarters : 0);
  const from = Math.max(0, at - window);
  // The query range is only a superset — a `Rational` quantises to 1/480, so an
  // epsilon-wide range is not expressible. The `onset <= at` filter below is
  // what makes the answer a backward read rather than a forward one.
  const notes = notesOverlapping(score, Rational.from(from), Rational.from(at + window));
  const held = new Set<number>();
  const latest = new Map<number, number>();
  let latestOnset = -1;
  for (const note of notes) {
    if (!isPitchedNote(note)) continue;
    const onset = note.onsetQuarters.toFloat();
    const offset = note.offsetQuarters.toFloat();
    if (onset > at) continue;
    if (offset > at) held.add(noteMidi(note));
    // The fallback for an instant that lands in a rest: the attack the reader
    // last heard, and only that one, so a rest reads as the chord before it
    // rather than as everything the window happened to touch.
    if (onset > latestOnset) {
      latestOnset = onset;
      latest.clear();
    }
    if (onset === latestOnset) latest.set(noteMidi(note), onset);
  }
  const midis = held.size > 0 ? held : new Set(latest.keys());
  return [...midis].sort((left, right) => left - right);
}

// ---------------------------------------------------------------------------
// The conveyors.
// ---------------------------------------------------------------------------

/** How much of the material a projection draws. */
export interface FlowProjectionOptions {
  /** Draw the sounding roll under the chord bands. Defaults to true. */
  roll?: boolean;
}

/**
 * The harmonic rhythm itself.
 *
 * `'chords'` lays each segment out at its REAL duration — the width of a band
 * is the length of the chord, which is the one thing a list can never say — and
 * draws the sounding notes underneath it as a miniature piano roll, so the name
 * has its evidence directly below it.
 *
 * `'roman'` stacks three coupled rows on one reel: the key, the harmonic
 * function with adjacent same-function segments MERGED (which is what turns
 * eight equal chips into the phrase's breathing), and the numerals themselves.
 */
export function projectProgression(
  result: AnalysisResult,
  score: Score,
  mode: 'chords' | 'roman',
  options: FlowProjectionOptions = {},
): FlowLaneView {
  const clock = secondsClock(score);
  const span = spanOf(score, clock);
  return mode === 'roman'
    ? romanLane(result, score, clock, span)
    : chordLane(result, score, clock, span, options);
}

function chordLane(
  result: AnalysisResult,
  score: Score,
  clock: (quarters: number) => number,
  span: {start: number; end: number},
  options: FlowProjectionOptions,
): FlowLaneView {
  const bands: FlowBandView[] = result.chords.map((segment, index) => ({
    id: `chord-${index}`,
    start: clock(segment.startQuarters),
    end: clock(segment.endQuarters),
    stampStart: segment.startQuarters,
    stampEnd: segment.endQuarters,
    track: 0,
    primary: segment.chord,
    tone: chordRootChroma(segment.chord) ?? segment.pitchClasses[0],
    weight: 1,
  }));

  const tracks: FlowTrackView[] = [{id: 'chords', label: 'Chords'}];
  if (options.roll !== false) {
    const roll = rollBands(score, clock);
    if (roll.length > 0) {
      tracks.push({id: 'sounding', label: 'Sounding'});
      bands.push(...roll);
    }
  }

  return {
    bands,
    tracks,
    ruler: rulerFor(score, clock),
    span,
    now: 0,
    pinned: {secondary: formatMetricalPosition(score, 0)},
  };
}

/**
 * The sounding roll: one hairline per note, placed by pitch.
 *
 * These bands carry no text on purpose — a two-pixel row is a picture, and the
 * chord bands above already say the names. The consequence is that the lane's
 * semantic twin lists them by id, which is the right trade: the meaning is in
 * the row above, and a screen reader should not have to walk five hundred
 * hairlines to reach it. Past {@link MAX_ROLL_NOTES} the roll is dropped whole
 * rather than truncated, because half a roll reads as a piece that stops.
 */
function rollBands(score: Score, clock: (quarters: number) => number): FlowBandView[] {
  const notes = score.notes.filter(isPitchedNote);
  if (notes.length === 0 || notes.length > MAX_ROLL_NOTES) return [];
  const midis = notes.map(noteMidi);
  const low = Math.min(...midis);
  const high = Math.max(...midis);
  const range = high - low || 1;
  return notes.map((note, index) => {
    const start = note.onsetQuarters.toFloat();
    const end = note.offsetQuarters.toFloat();
    return {
      id: `roll-${index}`,
      start: clock(start),
      end: clock(end),
      stampStart: start,
      stampEnd: end,
      track: 1,
      tone: pitchClass(noteMidi(note)),
      // The band's height is its pitch: a hairline near the top of the row is a
      // high note. The kit knows nothing about that; it draws a fraction.
      weight: 0.08 + 0.9 * ((noteMidi(note) - low) / range),
    };
  });
}

function romanLane(
  result: AnalysisResult,
  score: Score,
  clock: (quarters: number) => number,
  span: {start: number; end: number},
): FlowLaneView {
  const key = result.key;
  const keyed = key.confidence > 0;
  const bands: FlowBandView[] = [];
  // Where the numerals sit, and therefore which row the pinned read-out and the
  // readable twin answer from. Three coupled rows when there is a key to hang
  // them on; one row when there is not, because §5.4 hides the function strip
  // at zero confidence and an empty labelled row is the static this redesign
  // exists to remove.
  const numeralTrack = keyed ? 2 : 0;

  // Row 0 — the key. One band, because `AnalysisResult` holds one key for the
  // whole piece; the rolling read that can show a modulation is projectKeyFlow.
  //
  // Only when there IS a key. At zero confidence the caption already says the
  // numerals are relative to C major, and a band printing `C major` beside it
  // would answer the reader's question twice, once with a guess and once with
  // an admission.
  if (result.roman.length > 0 && keyed) {
    bands.push({
      id: 'key-0',
      start: span.start,
      end: span.end,
      stampStart: 0,
      stampEnd: score.durationQuarters.toFloat(),
      track: 0,
      primary: keyLabel(key),
      tone: chordRootChroma(key.tonic) ?? 0,
      weight: 1,
    });
  }

  // Row 1 — harmonic function, adjacent same-function segments merged. This is
  // the row that turns a chip wall into a phrase: `T—— S— D— T—`.
  if (keyed) {
    for (const run of mergeRuns(result.roman.map((entry) => ({
      start: entry.startQuarters,
      end: entry.endQuarters,
      value: harmonicFunctionOf(entry.roman),
    })))) {
      if (!run.value) continue;
      bands.push({
        id: `function-${run.start}`,
        start: clock(run.start),
        end: clock(run.end),
        stampStart: run.start,
        stampEnd: run.end,
        track: 1,
        primary: run.value,
        weight: 1,
      });
    }
  }

  // The last row — the numerals, with the chord symbol beside each one.
  result.roman.forEach((entry, index) => {
    bands.push({
      id: `roman-${index}`,
      start: clock(entry.startQuarters),
      end: clock(entry.endQuarters),
      stampStart: entry.startQuarters,
      stampEnd: entry.endQuarters,
      track: numeralTrack,
      primary: entry.roman,
      secondary: entry.chord,
      tone: chordRootChroma(entry.chord),
      weight: 1,
    });
  });

  const tracks: FlowTrackView[] = keyed
    ? [
        {id: 'key', label: 'Key'},
        {id: 'function', label: 'Function'},
        {id: 'roman', label: 'Numerals'},
      ]
    : [{id: 'roman', label: 'Numerals'}];

  return {
    bands,
    tracks,
    // The numerals own the instant: the key strip spans the whole piece and the
    // function row is a merged summary, so pinning either of them under the now
    // line answers a question the reader did not ask. Without this the lane
    // takes the topmost row, and the pinned read-out says `C major` above a
    // caption already saying `in C major`.
    primaryTrack: numeralTrack,
    ruler: rulerFor(score, clock),
    span,
    now: 0,
    // The caption is the largest thing this read-out can report, so it says
    // which key the numerals are relative to — including when it does not know.
    pinned: {
      secondary: keyed
        ? `in ${keyLabel(key)}`
        : 'Key unknown — numerals are relative to C major.',
    },
  };
}

/**
 * The key as it accumulates: a band per stable reading, not an event per note.
 *
 * A long confident band, a short scrambled stretch, then another long band IS
 * the tonal narrative of the piece, and one line of text cannot give it. The
 * band's height is the confidence, so an uncertain patch is visibly thin.
 */
export function projectKeyFlow(
  score: Score,
  options: {windowQuarters?: number} = {},
): FlowLaneView {
  const clock = secondsClock(score);
  const span = spanOf(score, clock);
  const window = Math.max(1, options.windowQuarters ?? DEFAULT_KEY_WINDOW_QUARTERS);
  const duration = score.durationQuarters.toFloat();
  const readings: {start: number; end: number; value: string}[] = [];
  const readingAt = new Map<number, KeyResult>();

  for (let start = 0; start < duration; start += window) {
    const end = Math.min(duration, start + window);
    const histogram = new Array<number>(12).fill(0);
    let total = 0;
    for (const note of notesOverlapping(score, Rational.from(start), Rational.from(end))) {
      if (!isPitchedNote(note)) continue;
      const weight = Math.max(
        0,
        Math.min(end, note.offsetQuarters.toFloat()) - Math.max(start, note.onsetQuarters.toFloat()),
      );
      if (weight <= 0) continue;
      histogram[pitchClass(noteMidi(note))] += weight;
      total += weight;
    }
    if (total <= 0) continue;
    const result = keyFromHistogram(histogram, total);
    readings.push({start, end, value: `${result.tonic}|${result.mode}`});
    readingAt.set(start, result);
  }

  // A run takes the reading of the window it STARTED in: every window it
  // swallowed agreed with that one, which is what made it a run.
  const bands: FlowBandView[] = mergeRuns(readings).map((run, index) => {
    const reading = readingAt.get(run.start)!;
    return {
      id: `key-${index}`,
      start: clock(run.start),
      end: clock(run.end),
      stampStart: run.start,
      stampEnd: run.end,
      track: 0,
      primary: keyLabel(reading),
      secondary: `${Math.round(reading.confidence * 100)}%`,
      tone: chordRootChroma(reading.tonic) ?? 0,
      // Never fully flat: a reading held at 5% confidence is still a reading,
      // and a band of zero height is indistinguishable from no band at all.
      weight: Math.max(0.25, reading.confidence),
    };
  });

  return {
    bands,
    tracks: [{id: 'key', label: 'Key'}],
    ruler: rulerFor(score, clock),
    span,
    now: 0,
  };
}

/**
 * Recurrence, drawn as recurrence: one row per motif, one band per appearance.
 *
 * Every appearance of one motif shares a `group`, which is the whole point —
 * when one crosses the now line the presenter can light the others, including
 * the ones that have not happened yet. A list can print `×3`; it cannot show
 * you that you are about to hear bar 1 again.
 */
export function projectMotifFlow(result: AnalysisResult, score: Score): FlowLaneView {
  const clock = secondsClock(score);
  const span = spanOf(score, clock);
  const ranked = [...result.motifs].sort(
    (left, right) => right.occurrences.length - left.occurrences.length,
  );
  const shown = ranked.slice(0, MAX_MOTIF_TRACKS);
  const folded = ranked.slice(MAX_MOTIF_TRACKS);

  const tracks: FlowTrackView[] = shown.map((motif, index) => ({
    id: motif.id,
    label: `M${index + 1}`,
    sublabel: `×${motif.occurrences.length}`,
  }));
  if (folded.length > 0) tracks.push({id: 'more', label: `+${folded.length} more`, muted: true});

  const bands: FlowBandView[] = [];
  const push = (motif: Motif, track: number, label: string): void => {
    const contour = contourOf(motif);
    for (const [index, occurrence] of motif.occurrences.entries()) {
      const start = occurrence.startQuarters;
      // Notated durations do not include gaps and may overlap. The actual
      // occurrence references are the authority for its time extent.
      const part = score.parts.find((entry) => entry.id === occurrence.partId);
      const notes = occurrence.noteIndexes.map((index) => part?.notes[index]).filter(
        (note): note is Note => note !== undefined,
      );
      const end = notes.length > 0
        ? notes.reduce((end, note) => Math.max(end, note.offsetQuarters.toFloat()), start)
        : start + motif.rhythm.reduce((sum, value) => sum + value, 0);
      bands.push({
        id: `${motif.id}-${index}`,
        start: clock(start),
        end: clock(end),
        stampStart: start,
        stampEnd: end,
        track,
        primary: label,
        group: motif.id,
        points: contour,
        weight: 1,
      });
    }
  };
  shown.forEach((motif, index) => push(motif, index, `M${index + 1}`));
  for (const motif of folded) push(motif, shown.length, motif.id);

  return {
    bands,
    tracks,
    ruler: rulerFor(score, clock),
    span,
    now: 0,
  };
}

/**
 * The voices themselves, with the mistakes drawn ON the counterpoint.
 *
 * Each voice is one band carrying its own contour; each issue is a bracket
 * spanning the two rows it implicates. A twelve-row list of issues cannot say
 * "two of the three are crammed into bar 3", and a picture says it at a glance.
 */
export function projectVoiceFlow(result: AnalysisResult, score: Score): FlowLaneView {
  const clock = secondsClock(score);
  const span = spanOf(score, clock);
  const lanes: {partId: string; voice: string; notes: readonly Note[]}[] = [];
  for (const part of score.parts) {
    for (const lane of buildVoiceLanes(part)) {
      if (lanes.length >= MAX_VOICE_TRACKS) break;
      lanes.push({partId: part.id, voice: lane.voice, notes: lane.notes});
    }
  }

  const rowOf = (voice: string, partId?: string): number | undefined => {
    const matches = lanes.flatMap((lane, index) =>
      lane.voice === voice && (partId === undefined || lane.partId === partId) ? [index] : []);
    // Legacy results may omit the part. An ambiguous name cannot identify a row.
    return matches.length === 1 ? matches[0] : undefined;
  };
  const bands: FlowBandView[] = lanes.map((lane, index) => {
    const start = lane.notes[0].onsetQuarters.toFloat();
    const end = lane.notes.reduce((offset, note) => Math.max(offset, note.offsetQuarters.toFloat()), start);
    return {
      id: `voice-${index}`,
      start: clock(start),
      end: clock(end),
      stampStart: start,
      stampEnd: end,
      track: index,
      // The ROW's name, not the internal voice id. `P1-2` and
      // `p_45ogs6get_0-v1` are addresses inside the parser's own bookkeeping,
      // and printing one in the gutter while the bracket beside it says
      // "voice 2" makes the reader do the join.
      primary: voiceRowLabel(index),
      points: voiceContour(lane.notes, start, end),
      weight: 1,
    };
  });

  // An issue whose voices are not both on a drawn row is DROPPED, not pinned to
  // row 0. The whole thesis of this view is that the mistake is drawn on the
  // counterpoint rather than beside it, and a bracket defaulting to the top row
  // draws it on a voice that did nothing — which is worse than the table it
  // replaced, because it is legible and wrong. Past `MAX_VOICE_TRACKS` the
  // honest read-out is fewer brackets, and the full list is one
  // `voiceLeading(score)` call away.
  const brackets: FlowBracketView[] = [];
  result.issues.forEach((issue, index) => {
    const from = rowOf(issue.voices[0], issue.voiceParts?.[0]);
    const to = rowOf(issue.voices[1] ?? issue.voices[0], issue.voiceParts?.[1] ?? issue.voiceParts?.[0]);
    if (from === undefined || to === undefined) return;
    brackets.push({
      id: `issue-${index}`,
      start: clock(issue.startQuarters),
      end: clock(Math.max(issue.endQuarters, issue.startQuarters + 0.25)),
      stampStart: issue.startQuarters,
      stampEnd: Math.max(issue.endQuarters, issue.startQuarters + 0.25),
      from,
      to,
      severity: issue.severity,
      label: `${issue.type.replace(/-/g, ' ')} · ${
        from === to ? voiceRowLabel(from) : `${voiceRowLabel(from)} / ${voiceRowLabel(to)}`
      }`,
    });
  });

  return {
    bands,
    tracks: lanes.map((lane, index) => ({id: `voice-${index}`, label: voiceRowLabel(index)})),
    brackets,
    ruler: rulerFor(score, clock),
    span,
    now: 0,
  };
}

// ---------------------------------------------------------------------------
// The read-outs with no time axis.
// ---------------------------------------------------------------------------

/**
 * The circle of fifths, turned so the reading sits at twelve o'clock.
 *
 * `undefined` is a real argument: a workbench with a player and no score has
 * nothing to read yet and still has to draw a wheel. That one gets twelve
 * segments, no weights and no needle — the shape stands up first, and the
 * reading arrives into it.
 */
export function projectTonality(
  key: KeyResult | undefined,
  options: {reference?: Key; spelling?: SpellingPreference} = {},
): TonalityView {
  const wheel = keyWheel(key ?? keyFromHistogram([], 0), {
    spelling: options.spelling,
    reference: options.reference,
  });
  const segment = (entry: {
    id: string;
    label: string;
    weight: number;
    active: boolean;
    tonic: string;
    mode: 'major' | 'minor';
  }): WheelSegmentView => ({
    id: entry.id,
    label: entry.label,
    weight: entry.weight,
    active: entry.active,
    tonic: entry.tonic,
    mode: entry.mode,
  });
  return {
    outer: wheel.outer.map(segment),
    inner: wheel.inner.map(segment),
    needle: wheel.needle
      ? {at: wheel.needle.at, ring: wheel.needle.ring, spread: wheel.needle.spread}
      : undefined,
    centre: {
      primary: wheel.centre.primary,
      secondary: wheel.centre.secondary ? `confidence ${wheel.centre.secondary}` : undefined,
      key: wheel.centre.key,
    },
  };
}

/**
 * The ranked key candidates — a league table, and honestly one.
 *
 * It has no time axis, so it belongs on a chip strip and not on a lane. The
 * full table is `KeyResult.scores`: all twenty-four, already sorted, which is
 * strictly more than any component ever printed.
 */
export function projectKeyCandidates(
  key: KeyResult | undefined,
  options: {limit?: number} = {},
): ChipItemView[] {
  if (!key || key.scores.length === 0) return [];
  const limit = Math.max(1, options.limit ?? 5);
  const best = key.scores[0].score;
  return key.scores.slice(0, limit).map((candidate, index) => ({
    id: `${candidate.tonic}-${candidate.mode}`,
    start: index,
    end: index + 1,
    primary: keyLabel(candidate),
    secondary: `${Math.round(candidate.score * 100)}%`,
    meter: best > 0 ? Math.max(0, Math.min(1, candidate.score / best)) : 0,
    tone: chordRootChroma(candidate.tonic) ?? 0,
  }));
}

/**
 * The pitch-class weight column: twelve bars, in chromatic order, ALWAYS.
 *
 * The order is fixed at the bin's own pitch class rather than sorted by weight,
 * because a bar chart whose rows swap places while a piece plays cannot be
 * read. `heard` fills the bar and the whole-score answer stays behind it as a
 * ghost — one axis, and both bars measured the same way (duration-weighted),
 * which is the mismatch a count-weighted tracker would have introduced.
 */
export function projectPitchClassMeters(
  bins: readonly DistributionBin[],
  options: {heard?: readonly DistributionBin[]} = {},
): ChipItemView[] {
  const heard = options.heard;
  const peak = Math.max(
    1e-9,
    ...bins.map((bin) => bin.value),
    ...(heard ?? []).map((bin) => bin.value),
  );
  return bins.map((bin, index) => {
    const sounded = heard?.find((entry) => entry.key === bin.key)?.value;
    return {
      id: `pc-${bin.key}`,
      start: index,
      end: index + 1,
      primary: bin.label,
      meter: (sounded ?? bin.value) / peak,
      meterGhost: heard ? bin.value / peak : undefined,
      tone: bin.key,
    };
  });
}

/**
 * `bar 12 · beat 3` — where a position sits in the written music.
 *
 * The score's own measure grid answers it, so a pickup bar and an irregular
 * measure are right rather than approximately right.
 */
export function formatMetricalPosition(score: Score, quarters: number): string {
  const at = Math.max(0, Number.isFinite(quarters) ? quarters : 0);
  const mbs = score.timeMap.quartersToMBS(Rational.from(at));
  const beat = mbs.beat + mbs.subbeat.toFloat();
  const label = Number.isInteger(beat) ? String(beat) : beat.toFixed(1);
  return `bar ${mbs.measure} · beat ${label}`;
}

// ---------------------------------------------------------------------------
// Internals.
// ---------------------------------------------------------------------------

/**
 * Quarters to nominal seconds, memoised across one projection.
 *
 * Band boundaries repeat — one segment's end is the next one's start — and
 * every call to `quartersToSeconds` allocates a `Rational` and quantises to
 * 1/480. Once per projection is affordable; once per band per frame is not, and
 * this is the seam where somebody would otherwise be tempted.
 */
function secondsClock(score: Score): (quarters: number) => number {
  const cache = new Map<number, number>();
  return (quarters) => {
    const at = Number.isFinite(quarters) ? quarters : 0;
    const cached = cache.get(at);
    if (cached !== undefined) return cached;
    const seconds = score.timeMap.quartersToSeconds(Rational.from(Math.max(0, at)));
    cache.set(at, seconds);
    return seconds;
  };
}

function spanOf(score: Score, clock: (quarters: number) => number): {start: number; end: number} {
  return {start: 0, end: clock(score.durationQuarters.toFloat())};
}

/**
 * Bar numbers along the lane, in the lane's own units.
 *
 * The authored measure grid answers it when there is one — pickups and
 * irregular bars included. A score assembled from notes alone has no grid at
 * all, and a conveyor with no bar numbers is a conveyor nobody can navigate, so
 * the meter map draws a nominal one rather than nothing.
 */
function rulerFor(
  score: Score,
  clock: (quarters: number) => number,
): {at: number; label: string; major?: boolean}[] {
  const tick = (quarters: number, number: number) => ({
    at: clock(quarters),
    label: String(number),
    major: number % 4 === 1,
  });
  if (score.measures.length > 0) {
    return score.measures
      .slice(0, MAX_RULER_TICKS)
      .map((measure) => tick(measure.onsetQuarters.toFloat(), measure.number));
  }

  const duration = score.durationQuarters.toFloat();
  const meters = score.timeMap.meters;
  const ticks: {at: number; label: string; major?: boolean}[] = [];
  for (const [index, meter] of meters.entries()) {
    const from = meter.atQuarters.toFloat();
    const to = index + 1 < meters.length ? meters[index + 1].atQuarters.toFloat() : duration;
    const bar = (meter.timeSignature.numerator * 4) / meter.timeSignature.denominator;
    if (!(bar > 0)) continue;
    for (let at = from, number = meter.measureNumber; at < to; at += bar, number += 1) {
      if (ticks.length >= MAX_RULER_TICKS) return ticks;
      ticks.push(tick(at, number));
    }
  }
  return ticks;
}

/** Adjacent entries carrying the same value become one run. */
function mergeRuns<T extends {start: number; end: number; value: string}>(
  entries: readonly T[],
): {start: number; end: number; value: string}[] {
  const runs: {start: number; end: number; value: string}[] = [];
  for (const entry of entries) {
    const previous = runs[runs.length - 1];
    if (previous && previous.value === entry.value && previous.end >= entry.start) {
      previous.end = Math.max(previous.end, entry.end);
      continue;
    }
    runs.push({start: entry.start, end: entry.end, value: entry.value});
  }
  return runs;
}

/**
 * Tonic, subdominant or dominant — the three jobs a numeral can hold.
 *
 * Deliberately coarse and deliberately here: the point of the row is the SHAPE
 * of the phrase, and a taxonomy with nine categories draws no shape at all.
 *
 * An ALTERED numeral answers nothing rather than answering wrongly. Stripping
 * the accidental turns `♭VII` into `VII` and draws an F major in G as a
 * dominant — a phrase shape nobody wrote, and the kind of confident mistake
 * that is harder to spot than a gap. A gap in the row is honest: the numeral
 * itself is still on the row below it.
 */
function harmonicFunctionOf(roman: string): string {
  if (/^[b♭#♯]/.test(roman.trim())) return '';
  const degree = roman.replace(/[^ivxIVX]/g, '').toUpperCase();
  if (degree === 'I' || degree === 'VI' || degree === 'III') return 'T';
  if (degree === 'IV' || degree === 'II') return 'S';
  if (degree === 'V' || degree === 'VII') return 'D';
  return '';
}

/**
 * What a voice row is called on screen.
 *
 * One function so the gutter, the bracket label and the readable twin cannot
 * drift into three vocabularies for one row — which is exactly what happened
 * when the gutter printed the parser's voice id and the list beside it counted
 * rows from one.
 */
function voiceRowLabel(row: number): string {
  return `voice ${Math.max(0, Math.round(row)) + 1}`;
}

function keyLabel(key: Key): string {
  return `${key.tonic} ${key.mode}`;
}

/** A motif's shape, normalised so every appearance of it draws identically. */
function contourOf(motif: Motif): {at: number; y: number}[] {
  const steps = [0];
  for (const interval of motif.intervals) steps.push(steps[steps.length - 1] + interval);
  const low = Math.min(...steps);
  const high = Math.max(...steps);
  const range = high - low || 1;
  const last = steps.length - 1 || 1;
  return steps.map((step, index) => ({at: index / last, y: (step - low) / range}));
}

/** One voice's line, normalised to ITS OWN range and thinned to a readable count. */
function voiceContour(
  notes: readonly Note[],
  startQuarters: number,
  endQuarters: number,
): {at: number; y: number}[] {
  const span = endQuarters - startQuarters || 1;
  const stride = Math.max(1, Math.ceil(notes.length / MAX_CONTOUR_POINTS));
  const sampled = notes.filter((_note, index) => index % stride === 0);
  const midis = sampled.map(noteMidi);
  const low = Math.min(...midis);
  const high = Math.max(...midis);
  const range = high - low || 1;
  return sampled.map((note, index) => ({
    at: Math.max(0, Math.min(1, (note.onsetQuarters.toFloat() - startQuarters) / span)),
    y: (midis[index] - low) / range,
  }));
}

function projectFretboard(spelling: ChordSpelling, context: SoundingContext): FretboardView {
  const instrument = context.tuning ?? TUNINGS.standard;
  const frame: FretboardView = {
    marks: [],
    strings: instrument.midis.length,
    stringLabels: tuningLabels(instrument, {spelling: context.spelling, key: context.key}),
    inlays: instrument.inlays,
    firstFret: 'auto',
    emptyLabel: NO_CHORD_LABEL,
    now: context.now,
  };
  if (spelling.pitches.length === 0) return frame;

  const byChroma = new Map(spelling.pitches.map((pitch) => [pitch.pitchClass, pitch]));
  // The corrected domain search reads the selected naming itself: declared
  // slash bass, guide-tone coverage and a physically possible fingering must
  // survive projection instead of being reconstructed from pitch classes.
  const voicing = fretboardVoicing(spelling, {tuning: instrument});
  if (voicing.marks.length === 0) return frame;

  return {
    ...frame,
    firstFret: voicing.firstFret,
    marks: voicing.marks.map((mark) => {
      const pitch = byChroma.get(mark.pitchClass);
      return {
        stringIndex: mark.stringIndex,
        fret: mark.fret,
        midi: mark.midi,
        role: pitch?.role,
        label: pitch ? fretLabel(pitch, mark.midi) : undefined,
        mark: pitch?.degreeLabel,
        active: true,
        id: `fret-${mark.stringIndex}-${mark.fret}`,
        since: context.since?.get(mark.midi),
      };
    }),
    muted: voicing.muted,
    barre: voicing.barre ? [{
      fret: voicing.barre.fret,
      fromString: voicing.barre.firstString,
      toString: voicing.barre.lastString,
    }] : [],
  };
}

/**
 * The chord's spelling, at the octave the hand is actually at.
 *
 * A shape is searched for pitch CLASSES, so the dot on the second string is not
 * the written note it was matched against: printing `E5` on a dot that sounds
 * `E3` is a wrong fact drawn on a right shape. The letter and the accidental
 * still come from the chord — the neck does not get its own opinion about
 * spelling — and only the octave follows the string.
 */
function fretLabel(pitch: SpelledPitch, midi: number): string {
  const shift = Math.round((midi - pitch.midi) / 12);
  if (!Number.isFinite(shift) || shift === 0) return pitch.name;
  return `${pitch.name.replace(/-?\d+$/, '')}${pitch.octave + shift}`;
}

/**
 * Which pitch classes belong to a key but are not sounding.
 *
 * The ghost row is what makes a keyboard with nothing pressed still say
 * something: §2.5.1's listening state draws the compass of the music before the
 * first note arrives, and a surface that answers "nothing" before playback is
 * the blank box this redesign is replacing.
 */
export function keyPitchClasses(key: Key | undefined): number[] {
  return key ? [...coreKeyPitchClasses(key)] : [];
}

/** Read a chord or key's root for a colour, using the existing pitch parser. */
function chordRootChroma(symbol: string): number | undefined {
  const root = tonalChord(symbol).tonic || symbol;
  try {
    return pitchClass(Pitch.parse(`${root}4`).midi);
  } catch {
    return undefined;
  }
}

/** Project one chord spelling into a reusable nameplate, without pitch diagrams. */
export function projectNameplate(spelling: ChordSpelling): NameplateView {
  const candidate = (naming: ChordNaming): ChordNameView => ({
    symbol: naming.symbol,
    full: naming.fullName,
    note: naming.kind === 'primary' ? undefined : naming.kind,
    key: naming.id,
  });
  return {
    primary: spelling.primary ? candidate(spelling.primary) : undefined,
    alternates: spelling.namings.slice(1).map(candidate),
    voicing: spelling.pitches.map((pitch) => ({
      label: pitch.name,
      mark: pitch.degreeLabel,
      role: pitch.role,
    })),
    emptyLabel: NO_CHORD_LABEL,
  };
}

function describe(spelling: ChordSpelling): string {
  if (spelling.primary) return `${spelling.primary.symbol} — ${spelling.primary.fullName}`;
  return spelling.label;
}
