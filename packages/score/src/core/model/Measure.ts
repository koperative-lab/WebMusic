import {Rational} from '../primitives/Rational';
import type {MeasureId} from '../types/ids';
import {
  assertValidTempo,
  assertValidTimeSignature,
  type KeySignature,
  type Tempo,
  type TimeSignature,
} from '../types/meta';

/**
 * A clef, MusicXML-style: sign + staff line + octave displacement.
 * Examples: treble = `{sign: 'G', line: 2}`, bass = `{sign: 'F', line: 4}`,
 * tenor voice = `{sign: 'G', line: 2, octaveChange: -1}`.
 */
export interface Clef {
  sign: 'G' | 'F' | 'C' | 'percussion' | 'TAB';
  /** Staff line the sign sits on (1 = bottom line). */
  line?: number;
  /** Octave displacement: -1 for 8vb clefs, +1 for 8va clefs. */
  octaveChange?: number;
}

export interface MeasureRepeat {
  start?: boolean;
  end?: boolean;
  /** Non-negative safe-integer play count; expansion uses at least one pass. Default: 2. */
  times?: number;
}

/** Authored MusicXML bar-style; repeat playback remains separate metadata. */
export type BarlineStyle = 'regular' | 'dotted' | 'dashed' | 'heavy' | 'light-light' | 'light-heavy' | 'heavy-light' | 'heavy-heavy' | 'tick' | 'short' | 'none';

const BARLINE_STYLES: readonly BarlineStyle[] = ['regular', 'dotted', 'dashed', 'heavy', 'light-light', 'light-heavy', 'heavy-light', 'heavy-heavy', 'tick', 'short', 'none'];

export interface MeasureData {
  id: MeasureId;
  /** 1-based display number (may be 0 for anacrusis, or skip for cuts). */
  number: number;
  /** Start position in quarter notes from score origin. */
  onsetQuarters: Rational;
  /** Measure length in quarter notes (per its time signature). */
  durationQuarters: Rational;
  /** Set when this measure introduces a new time signature. */
  timeSignature?: TimeSignature;
  /** Set when this measure introduces a new key signature. */
  keySignature?: KeySignature;
  /** Set when this measure introduces a new tempo. */
  tempo?: Tempo;
  rehearsal?: string;
  repeat?: MeasureRepeat;
  /** Volta endings, e.g. [1, 2] for "1st and 2nd ending". */
  volta?: ReadonlyArray<number>;
  /** Set when this measure introduces a new clef (single-staff shorthand). */
  clef?: Clef;
  /** Per-staff clefs for multi-staff parts, keyed by 1-based staff number. */
  clefs?: Readonly<Record<number, Clef>>;
  barlineStart?: BarlineStyle;
  barlineEnd?: BarlineStyle;
}

function snapshotTimeSignature(value: TimeSignature | undefined): TimeSignature | undefined {
  return value && Object.freeze({...value});
}

function snapshotKeySignature(value: KeySignature | undefined): KeySignature | undefined {
  return value && Object.freeze({...value});
}

function snapshotTempo(value: Tempo | undefined): Tempo | undefined {
  return value && Object.freeze({...value});
}

function snapshotRepeat(value: MeasureRepeat | undefined): MeasureRepeat | undefined {
  return value && Object.freeze({...value});
}

function snapshotClef(value: Clef | undefined): Clef | undefined {
  return value && Object.freeze({...value});
}

function snapshotClefs(value: Readonly<Record<number, Clef>> | undefined): Readonly<Record<number, Clef>> | undefined {
  if (!value) return undefined;
  return Object.freeze(
    Object.fromEntries(Object.entries(value).map(([staff, clef]) => [staff, snapshotClef(clef)!])),
  );
}

export class Measure implements Readonly<MeasureData> {
  readonly id!: MeasureId;
  readonly number!: number;
  readonly onsetQuarters!: Rational;
  readonly durationQuarters!: Rational;
  readonly timeSignature?: TimeSignature;
  readonly keySignature?: KeySignature;
  readonly tempo?: Tempo;
  readonly rehearsal?: string;
  readonly repeat?: MeasureRepeat;
  readonly volta?: ReadonlyArray<number>;
  readonly clef?: Clef;
  readonly clefs?: Readonly<Record<number, Clef>>;
  readonly barlineStart?: BarlineStyle;
  readonly barlineEnd?: BarlineStyle;

  constructor(data: MeasureData) {
    if (!Number.isSafeInteger(data.number)) {
      throw new RangeError(`measure ${data.id}: number must be an integer`);
    }
    if (!(data.onsetQuarters instanceof Rational) || !(data.durationQuarters instanceof Rational)) {
      throw new TypeError(`measure ${data.id}: onset and duration must be Rational values`);
    }
    if (data.durationQuarters.lt(Rational.ZERO)) {
      throw new RangeError(`measure ${data.id}: duration must not be negative`);
    }
    if (data.timeSignature) assertValidTimeSignature(data.timeSignature, `measure ${data.id} time signature`);
    if (data.tempo) assertValidTempo(data.tempo, `measure ${data.id} tempo`);
    if (data.repeat?.times !== undefined && (!Number.isSafeInteger(data.repeat.times) || data.repeat.times < 0)) {
      throw new RangeError(`measure ${data.id}: repeat times must be a non-negative safe integer`);
    }
    for (const style of [data.barlineStart, data.barlineEnd]) {
      if (style !== undefined && !BARLINE_STYLES.includes(style)) throw new TypeError(`measure ${data.id}: invalid barline style`);
    }
    this.id = data.id;
    this.number = data.number;
    this.onsetQuarters = data.onsetQuarters;
    this.durationQuarters = data.durationQuarters;
    this.timeSignature = snapshotTimeSignature(data.timeSignature);
    this.keySignature = snapshotKeySignature(data.keySignature);
    this.tempo = snapshotTempo(data.tempo);
    this.rehearsal = data.rehearsal;
    this.repeat = snapshotRepeat(data.repeat);
    this.volta = data.volta && Object.freeze([...data.volta]);
    this.clef = snapshotClef(data.clef);
    this.clefs = snapshotClefs(data.clefs);
    this.barlineStart = data.barlineStart;
    this.barlineEnd = data.barlineEnd;
    Object.freeze(this);
  }

  get offsetQuarters(): Rational {
    return this.onsetQuarters.add(this.durationQuarters);
  }

  // --- Legacy tick-based accessors (480 PPQ). ---
  get startTick(): number {
    return Math.round(this.onsetQuarters.toFloat() * 480);
  }
  get durationTicks(): number {
    return Math.round(this.durationQuarters.toFloat() * 480);
  }
  get endTick(): number {
    return Math.round(this.offsetQuarters.toFloat() * 480);
  }

  toJSON() {
    return {
      id: this.id,
      number: this.number,
      onsetQuarters: this.onsetQuarters.toJSON(),
      durationQuarters: this.durationQuarters.toJSON(),
      timeSignature: this.timeSignature,
      keySignature: this.keySignature,
      tempo: this.tempo,
      rehearsal: this.rehearsal,
      repeat: this.repeat,
      volta: this.volta,
      clef: this.clef,
      clefs: this.clefs,
      barlineStart: this.barlineStart,
      barlineEnd: this.barlineEnd,
    };
  }
}
