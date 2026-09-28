import {invariant} from '../utils/invariants';

const MAX_GENERATED_BEATS = 1_000_000;

export interface BeatGridData {
  bpm: number;
  /** Seconds position of each beat, ascending. */
  beats: number[];
  /** Optional subset of `beats` that are downbeats (bar starts). */
  downbeats?: number[];
}

/**
 * Maps continuous beat position ↔ seconds for a piece of digital audio.
 *
 * The digital-audio analogue of WebScore's `TimeMap`: once tempo/beats are
 * detected, this anchors an mp3 to a beat grid so it can be synchronized with a
 * symbolic score, looped on bars, or scheduled against. Immutable.
 */
export class BeatGrid {
  readonly bpm: number;
  readonly beats: readonly number[];
  readonly downbeats?: readonly number[];

  constructor(data: BeatGridData) {
    invariant(Number.isFinite(data.bpm) && data.bpm > 0, 'BeatGrid bpm must be finite and positive');
    invariant(data.beats.length > 0, 'BeatGrid requires at least one beat');
    for (let index = 0; index < data.beats.length; index += 1) {
      const beat = data.beats[index];
      invariant(Number.isFinite(beat), `BeatGrid beat ${index} must be finite`);
      if (index > 0) {
        invariant(beat > data.beats[index - 1], `BeatGrid beats must be strictly ascending (index ${index})`);
      }
    }
    if (data.downbeats) {
      const beatSet = new Set(data.beats);
      for (let index = 0; index < data.downbeats.length; index += 1) {
        const downbeat = data.downbeats[index];
        invariant(Number.isFinite(downbeat), `BeatGrid downbeat ${index} must be finite`);
        invariant(beatSet.has(downbeat), `BeatGrid downbeat ${downbeat} must also appear in beats`);
        if (index > 0) {
          invariant(
            downbeat > data.downbeats[index - 1],
            `BeatGrid downbeats must be strictly ascending (index ${index})`,
          );
        }
      }
    }
    this.bpm = data.bpm;
    this.beats = Object.freeze([...data.beats]);
    if (data.downbeats) this.downbeats = Object.freeze([...data.downbeats]);
    Object.freeze(this);
  }

  /** Continuous beat position (with fractional interpolation) at `seconds`. */
  secondsToBeat(seconds: number): number {
    const beats = this.beats;
    if (seconds <= beats[0]) {
      const spb = this.secondsPerBeat();
      return (seconds - beats[0]) / spb;
    }
    const last = beats.length - 1;
    if (seconds >= beats[last]) {
      const spb = beats.length > 1 ? beats[last] - beats[last - 1] : this.secondsPerBeat();
      return last + (seconds - beats[last]) / spb;
    }
    // Binary search for the surrounding beat interval.
    let lo = 0;
    let hi = last;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (beats[mid] <= seconds) lo = mid;
      else hi = mid;
    }
    const span = beats[hi] - beats[lo] || this.secondsPerBeat();
    return lo + (seconds - beats[lo]) / span;
  }

  /** Seconds position of a (possibly fractional) beat. */
  beatToSeconds(beat: number): number {
    const beats = this.beats;
    const last = beats.length - 1;
    if (beat <= 0) return beats[0] + beat * this.secondsPerBeat();
    if (beat >= last) {
      const spb = beats.length > 1 ? beats[last] - beats[last - 1] : this.secondsPerBeat();
      return beats[last] + (beat - last) * spb;
    }
    const lo = Math.floor(beat);
    const frac = beat - lo;
    return beats[lo] + frac * (beats[lo + 1] - beats[lo]);
  }

  secondsPerBeat(): number {
    return 60 / this.bpm;
  }

  /**
   * Generate a uniform grid within a clip's absolute time axis.
   * `durationSeconds` is the clip endpoint, not a span added to the offset;
   * `offsetSeconds` is the first beat's timestamp on that same axis. If the
   * first beat falls at or beyond the endpoint, the grid contains that one
   * anchor beat so interpolation remains defined.
   */
  static fromTempo(bpm: number, durationSeconds: number, offsetSeconds = 0): BeatGrid {
    invariant(Number.isFinite(bpm) && bpm > 0, 'bpm must be finite and positive');
    invariant(Number.isFinite(durationSeconds) && durationSeconds >= 0, 'durationSeconds must be finite and non-negative');
    invariant(Number.isFinite(offsetSeconds), 'offsetSeconds must be finite');
    const spb = 60 / bpm;
    invariant(Number.isFinite(spb) && spb > 0, 'bpm is too small to produce a finite beat interval');
    const beats: number[] = [];
    for (let t = offsetSeconds; t < durationSeconds + spb; t += spb) {
      invariant(beats.length < MAX_GENERATED_BEATS, `BeatGrid cannot exceed ${MAX_GENERATED_BEATS} generated beats`);
      beats.push(t);
      invariant(t + spb > t, 'BeatGrid interval is too small to advance at this offset');
    }
    if (beats.length === 0) beats.push(offsetSeconds);
    return new BeatGrid({bpm, beats});
  }

  toJSON(): BeatGridData {
    return {
      bpm: this.bpm,
      beats: [...this.beats],
      ...(this.downbeats ? {downbeats: [...this.downbeats]} : {}),
    };
  }

  static fromJSON(json: BeatGridData): BeatGrid {
    return new BeatGrid(json);
  }
}
