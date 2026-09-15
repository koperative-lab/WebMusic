export interface Key {
  readonly tonic: string;
  readonly mode: 'major' | 'minor';
}

export interface KeyResult extends Key {
  readonly confidence: number;
  readonly scores: ReadonlyArray<Readonly<Key & {score: number}>>;
}

/** Options for the chord-window analyses (`segmentChords`, `romanNumerals`). */
export interface ChordWindowOptions {
  /** Finite maximum piece length in quarters before equal labels merge. Default `2`, minimum `0.125`. */
  windowQuarters?: number;
}

/** Options for motif search (`findMotifs`). */
export interface MotifOptions {
  /** Notes per motif. Default `4`. */
  length?: number;
  /** Minimum number of repeats to report a motif. Default `2`. */
  minOccurrences?: number;
}

export interface ChordSegment {
  /** Window start in quarter notes. */
  readonly startQuarters: number;
  /** Window end in quarter notes. */
  readonly endQuarters: number;
  /** Sounding pitch classes (0–11), low to high. */
  readonly pitchClasses: ReadonlyArray<number>;
  /** Chord label, e.g. `CM`, `G7`. */
  readonly chord: string;
}

export interface RNAResult {
  readonly startQuarters: number;
  readonly endQuarters: number;
  readonly chord: string;
  readonly roman: string;
}

export interface Motif {
  readonly id: string;
  /** Melodic intervals in semitones. */
  readonly intervals: ReadonlyArray<number>;
  /** Note durations in quarter notes. */
  readonly rhythm: ReadonlyArray<number>;
  readonly occurrences: ReadonlyArray<
    Readonly<{
      partId: string;
      startQuarters: number;
      noteIndexes: ReadonlyArray<number>;
    }>
  >;
}

export interface RhythmPattern {
  /** Note durations in quarter notes. */
  pattern: number[];
  count: number;
  /** Onset positions of each occurrence, in quarter notes. */
  onsets: number[];
}

export interface VoiceLeadingIssue {
  readonly type: 'parallel-fifth' | 'parallel-octave' | 'large-leap' | 'voice-crossing';
  readonly startQuarters: number;
  readonly endQuarters: number;
  readonly voices: ReadonlyArray<string>;
  /** Part identifiers paired by index with `voices`; absent on legacy results. */
  readonly voiceParts?: ReadonlyArray<string>;
  readonly severity: 'info' | 'warning' | 'error';
}

/** One bar of a distribution: a display label, its count/weight, and a sort key. */
export interface DistributionBin {
  readonly label: string;
  readonly value: number;
  /** Pitch class 0–11, interval in semitones, or duration in quarter notes. */
  readonly key: number;
}

export interface Distributions {
  /** Duration-weighted, one bin per pitch class in chromatic order. */
  readonly pitchClasses: ReadonlyArray<DistributionBin>;
  /** Melodic intervals in semitones, ascending; rests break the chain. */
  readonly intervals: ReadonlyArray<DistributionBin>;
  /** Note durations in quarter notes, ascending. */
  readonly durations: ReadonlyArray<DistributionBin>;
}
