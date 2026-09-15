export interface TimeSignature {
  numerator: number;
  denominator: number;
}

export type Mode =
  | 'major'
  | 'minor'
  | 'dorian'
  | 'phrygian'
  | 'lydian'
  | 'mixolydian'
  | 'aeolian'
  | 'locrian';

export interface KeySignature {
  /** Number of sharps (positive) or flats (negative). -7..+7 */
  fifths: number;
  mode?: Mode;
}

export interface Tempo {
  /** Beats per minute. */
  bpm: number;
  /** What note value the bpm refers to, in quarters. Default 1 (quarter note). */
  unit?: number;
}

/** @internal Runtime guard shared by model and time-map constructors. */
export function assertValidTimeSignature(timeSignature: TimeSignature, label = 'time signature'): void {
  if (!timeSignature || typeof timeSignature !== 'object') {
    throw new RangeError(`${label} must be an object`);
  }
  if (!Number.isSafeInteger(timeSignature.numerator) || timeSignature.numerator <= 0) {
    throw new RangeError(`${label} numerator must be a positive integer`);
  }
  if (!Number.isSafeInteger(timeSignature.denominator) || timeSignature.denominator <= 0) {
    throw new RangeError(`${label} denominator must be a positive integer`);
  }
}

/** @internal Runtime guard shared by model and time-map constructors. */
export function assertValidTempo(tempo: Tempo, label = 'tempo'): void {
  if (!tempo || typeof tempo !== 'object') {
    throw new RangeError(`${label} must be an object`);
  }
  if (!Number.isFinite(tempo.bpm) || tempo.bpm <= 0) {
    throw new RangeError(`${label} bpm must be a finite positive number`);
  }
  if (tempo.unit !== undefined && (!Number.isFinite(tempo.unit) || tempo.unit <= 0)) {
    throw new RangeError(`${label} unit must be a finite positive number`);
  }
}

export interface ScoreMetadata {
  title?: string;
  composer?: string;
  arranger?: string;
  lyricist?: string;
  copyright?: string;
  source?: string;
  encoding?: {software?: string; date?: string};
  custom?: Record<string, unknown>;
}
