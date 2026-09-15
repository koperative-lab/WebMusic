import {Duration} from '../primitives/Duration';
import {Rational} from '../primitives/Rational';
import type {Clef} from './Measure';

/** An authored clef declaration on one staff, including changes within a bar. */
export interface PartClefChange {
  onsetQuarters: Rational;
  staff: number;
  clef: Clef;
}

/** Position is absolute musical time; optional engraving offsets use MusicXML tenths. */
export interface DirectionPosition {
  onsetQuarters: Rational;
  /** Omitted staff applies to the part's first staff. */
  staff?: number;
  placement?: 'above' | 'below';
  printObject?: boolean;
  defaultX?: number;
  defaultY?: number;
  relativeX?: number;
  relativeY?: number;
}

export type PartDirection = DirectionPosition & (
  | {kind: 'words' | 'rehearsal'; text: string; fontStyle?: 'normal' | 'italic'; fontWeight?: 'normal' | 'bold'; fontSize?: number}
  | {kind: 'dynamics'; values: readonly string[]}
  | {kind: 'metronome'; beatUnit: Duration; perMinute: number; parentheses?: boolean}
  | {kind: 'pedal'; type: 'start' | 'stop' | 'change' | 'continue' | 'resume' | 'discontinue'; number?: number; line?: boolean; sign?: boolean}
  | {kind: 'wedge'; type: 'crescendo' | 'diminuendo' | 'stop' | 'continue'; number?: number; spread?: number; niente?: boolean}
);

function position(value: {onsetQuarters: Rational; staff?: number}, what: string): void {
  if (!value || !(value.onsetQuarters instanceof Rational)) throw new TypeError(`${what} onsetQuarters must be a Rational`);
  if (value.staff !== undefined && (!Number.isSafeInteger(value.staff) || value.staff < 1)) {
    throw new RangeError(`${what} staff must be a positive safe integer`);
  }
}

/** Validate, copy and freeze caller-owned notation values at the model boundary. */
export function snapshotClefChange(value: PartClefChange): PartClefChange {
  position(value, 'clef change');
  if (value.staff === undefined) throw new TypeError('clef change requires a staff');
  const clef = value.clef;
  if (!clef || !['G', 'F', 'C', 'percussion', 'TAB'].includes(clef.sign)) throw new TypeError('clef change sign is invalid');
  if (clef.line !== undefined && (!Number.isSafeInteger(clef.line) || clef.line < 1 || clef.line > 5)) {
    throw new RangeError('clef change line must be an integer from 1 to 5');
  }
  if (clef.octaveChange !== undefined && !Number.isSafeInteger(clef.octaveChange)) throw new RangeError('clef octaveChange must be a safe integer');
  return Object.freeze({...value, clef: Object.freeze({...clef})});
}

export function snapshotDirection(value: PartDirection): PartDirection {
  position(value, 'direction');
  if (value.placement !== undefined && value.placement !== 'above' && value.placement !== 'below') throw new TypeError('direction placement must be above or below');
  for (const field of ['defaultX', 'defaultY', 'relativeX', 'relativeY'] as const) {
    if (value[field] !== undefined && !Number.isFinite(value[field])) throw new TypeError(`direction ${field} must be finite`);
  }
  if (value.printObject !== undefined && typeof value.printObject !== 'boolean') throw new TypeError('direction printObject must be boolean');
  switch (value.kind) {
    case 'words': case 'rehearsal':
      if (typeof value.text !== 'string') throw new TypeError('direction text must be a string');
      if (value.fontStyle !== undefined && !['normal', 'italic'].includes(value.fontStyle)) throw new TypeError('direction fontStyle is invalid');
      if (value.fontWeight !== undefined && !['normal', 'bold'].includes(value.fontWeight)) throw new TypeError('direction fontWeight is invalid');
      if (value.fontSize !== undefined && (!Number.isFinite(value.fontSize) || value.fontSize <= 0)) throw new RangeError('direction fontSize must be positive');
      break;
    case 'dynamics':
      if (!Array.isArray(value.values) || value.values.some((mark) => typeof mark !== 'string')) throw new TypeError('direction dynamics values must be a string array');
      return Object.freeze({...value, values: Object.freeze([...value.values])});
    case 'metronome':
      if (!(value.beatUnit instanceof Duration) || !value.beatUnit.quarters.gt(Rational.ZERO)) throw new TypeError('metronome beatUnit must be a positive Duration');
      if (!Number.isFinite(value.perMinute) || value.perMinute <= 0) throw new RangeError('metronome perMinute must be positive');
      if (value.parentheses !== undefined && typeof value.parentheses !== 'boolean') throw new TypeError('metronome parentheses must be boolean');
      break;
    case 'pedal': case 'wedge': {
      const allowed = value.kind === 'pedal' ? ['start', 'stop', 'change', 'continue', 'resume', 'discontinue'] : ['crescendo', 'diminuendo', 'stop', 'continue'];
      if (!allowed.includes(value.type)) throw new TypeError(`${value.kind} direction type is invalid`);
      if (value.number !== undefined && (!Number.isSafeInteger(value.number) || value.number < 1 || value.number > 16)) throw new RangeError('direction number must be an integer from 1 to 16');
      if (value.kind === 'wedge' && value.spread !== undefined && (!Number.isFinite(value.spread) || value.spread < 0)) throw new RangeError('wedge spread must be nonnegative');
      const flags = value.kind === 'pedal' ? [value.line, value.sign] : [value.niente];
      if (flags.some((flag) => flag !== undefined && typeof flag !== 'boolean')) throw new TypeError('direction flags must be boolean');
      break;
    }
    default: throw new TypeError('direction kind is invalid');
  }
  return Object.freeze({...value});
}

export function snapshotNotationList<T extends {onsetQuarters: Rational}>(values: readonly T[] | undefined, snapshot: (value: T) => T): readonly T[] | undefined {
  if (values === undefined) return undefined;
  if (!Array.isArray(values)) throw new TypeError('part notation events must be arrays');
  return Object.freeze(values.map(snapshot).sort((a, b) => a.onsetQuarters.cmp(b.onsetQuarters)));
}
