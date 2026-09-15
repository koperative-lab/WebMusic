import {Duration} from '../primitives/Duration';
import {Pitch} from '../primitives/Pitch';
import {Rational} from '../primitives/Rational';
import type {NoteId, VoiceId} from '../types/ids';
import type {Step} from '../types/pitch';
import {assert} from '../utils/invariants';

export type Articulation = 'staccato' | 'accent' | 'tenuto' | 'marcato' | 'staccatissimo';
export type Ornament = 'trill' | 'mordent' | 'turn' | 'fermata';
export type Tie = 'start' | 'continue' | 'stop';
export type Slur = 'start' | 'continue' | 'stop';

/** Staff position for a rest glyph; it does not give the rest a sounding pitch. */
export interface RestDisplay {
  step: Step;
  octave: number;
}

/** One authored MusicXML beam level; a hook is a partial beam. */
export interface BeamMark {
  number: number;
  type: 'begin' | 'continue' | 'end' | 'forward hook' | 'backward hook';
}

export type StemDirection = 'up' | 'down' | 'none' | 'double';

/** Explicit tuplet endpoints; the duration carries its actual/normal ratio. */
export interface TupletMark {
  type: 'start' | 'stop';
  /** Independent nesting level (1..16); defaults to 1 in MusicXML. */
  number?: number;
  bracket?: boolean;
  placement?: 'above' | 'below';
  showNumber?: 'actual' | 'both' | 'none';
}

/**
 * A single slur endpoint with an optional MusicXML-style slur number,
 * allowing nested/overlapping slurs to be distinguished
 * (e.g. `{type: 'start', number: 2}` opens inner slur #2).
 */
export interface SlurMark {
  type: Slur;
  /** MusicXML slur level (1..6). Slurs sharing a number pair up. */
  number?: number;
  /** Authored side of the staff; absent lets the renderer choose. */
  placement?: 'above' | 'below';
}

/**
 * Accepted shapes for `NoteData.slur`. The bare string form is the original
 * (single, unnumbered) shape and remains fully supported; an object or an
 * array of objects carries slur numbers for nesting.
 */
export type SlurValue = Slur | SlurMark | ReadonlyArray<SlurMark>;

/**
 * Grace-note attributes. `grace: true` is shorthand for `{}` (an unslashed
 * grace note with unspecified steal time).
 */
export interface GraceNote {
  /** True for a slashed (acciaccatura-style) grace note. */
  slash?: boolean;
  /** Performance hint: how many quarters to steal from the neighbouring note. */
  stealQuarters?: number;
}

export interface PerformedAttributes {
  /** Onset in seconds, from start of piece. */
  onsetSec: number;
  /** Duration in seconds. */
  durationSec: number;
  /** MIDI velocity 1..127. */
  velocity: number;
}

/**
 * A single note (or chord member, or pitched percussion hit).
 *
 * Holds BOTH notated and performed information. Either may be missing
 * depending on the source — MusicXML carries rich notation, MIDI carries
 * exact micro-timing.
 */
export interface NoteData {
  id: NoteId;

  // --- Pitch ---
  /**
   * Notated pitch. Required for sounding notes; may be omitted ONLY when
   * `rest` is true (enforced by a runtime invariant in the Note constructor).
   */
  pitch?: Pitch;
  /** True for non-pitched percussion. */
  unpitched?: boolean;
  /**
   * True for an explicit rest. Rest notes have onset/duration like sounding
   * notes but no pitch. Queries exclude rests by default
   * (see `NoteQueryOptions.includeRests`).
   */
  rest?: boolean;
  restDisplay?: RestDisplay;
  /**
   * Grace-note marker. Grace notes typically carry a zero notated duration;
   * `notesAt` still returns them at their exact onset (see
   * `NoteQueryOptions.includeGrace`).
   */
  grace?: GraceNote | boolean;

  // --- Notated time (musical position) ---
  /** Offset from start of part, in quarter notes. */
  onsetQuarters: Rational;
  duration: Duration;
  /** Optional tuplet group identifier; notes sharing this string are in the same tuplet. */
  tupletId?: string;
  /** Explicit tuplet endpoints, including nested groups. */
  tupletMarks?: ReadonlyArray<TupletMark>;

  // --- Performed (optional override; otherwise derived from TempoMap). ---
  performed?: PerformedAttributes;

  // --- Voice / grouping ---
  voice: VoiceId;
  /** If true, this note sounds simultaneously with the previous note in the same voice (chord member). */
  chord?: boolean;
  /** Authored beam levels; absent means the renderer may group automatically. */
  beams?: ReadonlyArray<BeamMark>;
  /** Authored stem direction; absent means the renderer chooses. */
  stem?: StemDirection;
  /** False hides the notation while retaining its musical time and playback. */
  printObject?: boolean;

  // --- Articulation / expression ---
  articulations?: ReadonlyArray<Articulation>;
  ornaments?: ReadonlyArray<Ornament>;
  tie?: Tie;
  /** Authored tie side; absent lets the renderer choose. */
  tiePlacement?: 'above' | 'below';
  /** Slur marker(s); plain 'start'/'continue'/'stop' or numbered marks for nesting. */
  slur?: SlurValue;
  dynamic?: string;
  lyric?: string;

  // --- Misc ---
  /** Staff number for multi-staff instruments (piano: 1=treble, 2=bass). */
  staff?: number;
  /** Free-form tags for analysis or UI state. */
  tags?: ReadonlyArray<string>;
}

// Lazy memo for offsetQuarters: Note instances are frozen, so the cache lives
// in a module-level WeakMap instead of an own property.
const offsetCache = new WeakMap<Note, Rational>();

function snapshotGrace(value: GraceNote | boolean | undefined): GraceNote | boolean | undefined {
  return typeof value === 'object' ? Object.freeze({...value}) : value;
}

function assertValidPerformed(value: PerformedAttributes | undefined): void {
  if (value === undefined) return;
  if (!value || typeof value !== 'object') {
    throw new TypeError('note performed timing must be an object');
  }
  if (!Number.isFinite(value.onsetSec) || value.onsetSec < 0) {
    throw new RangeError('note performed onsetSec must be a finite non-negative number');
  }
  if (!Number.isFinite(value.durationSec) || value.durationSec < 0) {
    throw new RangeError('note performed durationSec must be a finite non-negative number');
  }
  if (!Number.isSafeInteger(value.velocity) || value.velocity < 1 || value.velocity > 127) {
    throw new RangeError('note performed velocity must be an integer from 1 to 127');
  }
}

function snapshotPerformed(value: PerformedAttributes | undefined): PerformedAttributes | undefined {
  return value && Object.freeze({...value});
}

function snapshotSlur(value: SlurValue | undefined): SlurValue | undefined {
  for (const mark of typeof value === 'object' ? Array.isArray(value) ? value : [value] : []) {
    if (mark?.placement !== undefined && mark.placement !== 'above' && mark.placement !== 'below') {
      throw new TypeError('note slur placement must be above or below');
    }
  }
  if (Array.isArray(value)) return Object.freeze(value.map((mark) => Object.freeze({...mark})));
  return typeof value === 'object' ? Object.freeze({...value}) : value;
}

function snapshotBeams(value: ReadonlyArray<BeamMark> | undefined): ReadonlyArray<BeamMark> | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new TypeError('note beams must be an array');
  const numbers = new Set<number>();
  return Object.freeze(value.map((mark) => {
    if (!mark || !Number.isSafeInteger(mark.number) || mark.number < 1 || mark.number > 8) {
      throw new RangeError('note beam number must be an integer from 1 to 8');
    }
    if (numbers.has(mark.number)) throw new RangeError('note beam numbers must be unique');
    numbers.add(mark.number);
    if (!['begin', 'continue', 'end', 'forward hook', 'backward hook'].includes(mark.type)) {
      throw new TypeError('note beam type is invalid');
    }
    return Object.freeze({...mark});
  }));
}

function snapshotTupletMarks(value: ReadonlyArray<TupletMark> | undefined): ReadonlyArray<TupletMark> | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new TypeError('note tupletMarks must be an array');
  return Object.freeze(value.map((mark) => {
    if (!mark || (mark.type !== 'start' && mark.type !== 'stop')) {
      throw new TypeError('note tuplet mark type must be start or stop');
    }
    if (mark.number !== undefined && (!Number.isSafeInteger(mark.number) || mark.number < 1 || mark.number > 16)) {
      throw new RangeError('note tuplet mark number must be an integer from 1 to 16');
    }
    if (mark.bracket !== undefined && typeof mark.bracket !== 'boolean') {
      throw new TypeError('note tuplet mark bracket must be a boolean');
    }
    if (mark.placement !== undefined && mark.placement !== 'above' && mark.placement !== 'below') {
      throw new TypeError('note tuplet mark placement must be above or below');
    }
    if (mark.showNumber !== undefined && !['actual', 'both', 'none'].includes(mark.showNumber)) throw new TypeError('note tuplet showNumber is invalid');
    return Object.freeze({...mark});
  }));
}

export class Note implements Readonly<NoteData> {
  readonly id!: NoteId;
  /**
   * Notated pitch. Declared non-optional for backward compatibility with
   * existing consumers, but `undefined` at runtime when `rest` is true —
   * check the `rest` flag before reading it on potentially-rest notes.
   */
  readonly pitch!: Pitch;
  readonly unpitched?: boolean;
  readonly rest?: boolean;
  readonly restDisplay?: RestDisplay;
  readonly grace?: GraceNote | boolean;
  readonly onsetQuarters!: Rational;
  readonly duration!: Duration;
  readonly tupletId?: string;
  readonly tupletMarks?: ReadonlyArray<TupletMark>;
  readonly performed?: PerformedAttributes;
  readonly voice!: VoiceId;
  readonly chord?: boolean;
  readonly beams?: ReadonlyArray<BeamMark>;
  readonly stem?: StemDirection;
  readonly printObject?: boolean;
  readonly articulations?: ReadonlyArray<Articulation>;
  readonly ornaments?: ReadonlyArray<Ornament>;
  readonly tie?: Tie;
  readonly tiePlacement?: 'above' | 'below';
  readonly slur?: SlurValue;
  readonly dynamic?: string;
  readonly lyric?: string;
  readonly staff?: number;
  readonly tags?: ReadonlyArray<string>;

  constructor(data: NoteData) {
    if (!data || typeof data !== 'object') throw new TypeError('note data must be an object');
    if (!(data.onsetQuarters instanceof Rational)) {
      throw new TypeError(`note ${data.id}: onsetQuarters must be a Rational value`);
    }
    if (!(data.duration instanceof Duration) || !(data.duration.quarters instanceof Rational)) {
      throw new TypeError(`note ${data.id}: duration must be a Duration value`);
    }
    if (data.duration.quarters.lt(Rational.ZERO)) {
      throw new RangeError(`note ${data.id}: duration must not be negative`);
    }
    if (data.pitch != null && !(data.pitch instanceof Pitch)) {
      throw new TypeError(`note ${data.id}: pitch must be a Pitch value`);
    }
    assertValidPerformed(data.performed);
    if (data.restDisplay !== undefined) {
      if (!data.rest || !data.restDisplay || !['A', 'B', 'C', 'D', 'E', 'F', 'G'].includes(data.restDisplay.step) ||
          !Number.isSafeInteger(data.restDisplay.octave) || data.restDisplay.octave < 0 || data.restDisplay.octave > 9) {
        throw new TypeError('note restDisplay requires a rest with a valid step and octave from 0 to 9');
      }
    }
    if (data.tiePlacement !== undefined && data.tiePlacement !== 'above' && data.tiePlacement !== 'below') throw new TypeError('note tiePlacement must be above or below');
    if (data.stem !== undefined && !['up', 'down', 'none', 'double'].includes(data.stem)) {
      throw new TypeError('note stem direction is invalid');
    }
    if (data.printObject !== undefined && typeof data.printObject !== 'boolean') {
      throw new TypeError('note printObject must be a boolean');
    }
    assert(
      data.rest === true || data.pitch != null,
      `note ${data.id}: non-rest notes must have a pitch`,
    );
    this.id = data.id;
    this.pitch = data.pitch!;
    this.unpitched = data.unpitched;
    this.rest = data.rest;
    this.restDisplay = data.restDisplay && Object.freeze({...data.restDisplay});
    this.grace = snapshotGrace(data.grace);
    this.onsetQuarters = data.onsetQuarters;
    this.duration = data.duration;
    this.tupletId = data.tupletId;
    this.tupletMarks = snapshotTupletMarks(data.tupletMarks);
    this.performed = snapshotPerformed(data.performed);
    this.voice = data.voice;
    this.chord = data.chord;
    this.beams = snapshotBeams(data.beams);
    this.stem = data.stem;
    this.printObject = data.printObject;
    this.articulations = data.articulations && Object.freeze([...data.articulations]);
    this.ornaments = data.ornaments && Object.freeze([...data.ornaments]);
    this.tie = data.tie;
    this.tiePlacement = data.tiePlacement;
    this.slur = snapshotSlur(data.slur);
    this.dynamic = data.dynamic;
    this.lyric = data.lyric;
    this.staff = data.staff;
    this.tags = data.tags && Object.freeze([...data.tags]);
    Object.freeze(this);
  }

  /** Notated offset (onset + duration) in quarters. Computed once and memoized. */
  get offsetQuarters(): Rational {
    let offset = offsetCache.get(this);
    if (!offset) {
      offset = this.onsetQuarters.add(this.duration.quarters);
      offsetCache.set(this, offset);
    }
    return offset;
  }

  // --- Legacy tick-based accessors (480 PPQ). ---

  /** Onset in ticks at 480 PPQ. */
  get onset(): number {
    return Math.round(this.onsetQuarters.toFloat() * 480);
  }

  /** Offset (onset + duration) in ticks at 480 PPQ. */
  get endTick(): number {
    return Math.round(this.offsetQuarters.toFloat() * 480);
  }

  /** Duration in ticks at 480 PPQ. */
  get durationTicks(): number {
    return Math.round(this.duration.quarters.toFloat() * 480);
  }

  /** MIDI velocity (defaults to 80 when not performed). */
  get velocity(): number {
    return this.performed?.velocity ?? 80;
  }

  /** Functional update — returns a new Note. */
  with(patch: Partial<NoteData>): Note {
    return new Note({...(this as NoteData), ...patch});
  }

  toJSON() {
    return {
      id: this.id,
      pitch: this.pitch?.toJSON(),
      unpitched: this.unpitched,
      rest: this.rest,
      restDisplay: this.restDisplay,
      grace: this.grace,
      onsetQuarters: this.onsetQuarters.toJSON(),
      duration: this.duration.toJSON(),
      tupletId: this.tupletId,
      tupletMarks: this.tupletMarks,
      performed: this.performed,
      voice: this.voice,
      chord: this.chord,
      beams: this.beams,
      stem: this.stem,
      printObject: this.printObject,
      articulations: this.articulations,
      ornaments: this.ornaments,
      tie: this.tie,
      tiePlacement: this.tiePlacement,
      slur: this.slur,
      dynamic: this.dynamic,
      lyric: this.lyric,
      staff: this.staff,
      tags: this.tags,
    };
  }
}
