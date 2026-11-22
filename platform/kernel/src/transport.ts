// ============================================================================
// Pure transport math shared by both families' playback engines, and the
// timeline-mapping contract that lets musical time axes (score quarters,
// audio beats) interoperate through seconds. No Web Audio, no domain types —
// numbers in, numbers out. For the imperative playback control surface a
// player exposes, see ./player.
//
// Terminology: TransportClock's "position" is a TIMELINE position (typically
// media seconds); TimelineMapping's "position" is a MUSICAL position
// (quarters, beats — the consumer defines the unit). The mapping converts
// between the two axes.
// ============================================================================

/** Immutable snapshot of a transport anchor. All numbers, unit-agnostic. */
export interface TransportClockState {
  /** Reference-clock timestamp of the anchor. */
  readonly originTime: number;
  /** Timeline position at `originTime`. */
  readonly originPosition: number;
  /** Finite and > 0; position advances `rate`× reference time. */
  readonly rate: number;
  readonly paused: boolean;
}

/**
 * Affine mapping between an external monotonic reference clock (any number
 * domain — `AudioContext.currentTime`, `performance.now()/1000`, a test
 * counter) and a timeline position. Pure: never reads a real clock unless
 * `now` is injected; every mutator takes the current reference time
 * explicitly.
 *
 *   position(t) = paused ? originPosition
 *                        : originPosition + (t - originTime) * rate
 *
 * The semantics mirror the two engines this abstracts: re-anchor math is the
 * score scheduler's retune (capture position, reset both anchors) and
 * BufferEngine's setRate; pause folds elapsed time into `originPosition`.
 * Loop/wrap is deliberately OUT of scope — consumers implement it as
 * `seekTo(loopStart, t)`, which is exactly what the engines do today.
 * Negative times and positions pass through unclamped; clamping to a
 * duration is domain policy. Every anchor mutator rejects non-finite
 * numbers: a NaN reference time or position would silently poison the
 * anchor and every later `positionAt` read, with no error at the source.
 */
export class TransportClock {
  #originTime = 0;
  #originPosition = 0;
  #rate = 1;
  #paused = true;
  #holdUntilOrigin = false;
  readonly #now?: () => number;

  /** @param now Optional reference clock enabling the zero-arg `position` getter. */
  constructor(now?: () => number) {
    this.#now = now;
  }

  get state(): TransportClockState {
    return {
      originTime: this.#originTime,
      originPosition: this.#originPosition,
      rate: this.#rate,
      paused: this.#paused,
    };
  }

  get rate(): number {
    return this.#rate;
  }

  get paused(): boolean {
    return this.#paused;
  }

  /** Current position via the injected `now()` clock. Throws when none was injected. */
  get position(): number {
    if (!this.#now) throw new Error('TransportClock has no injected now() clock; use positionAt(t).');
    return this.positionAt(this.#now());
  }

  /**
   * True when a {@link startAt} start is armed. The flag is cleared by the
   * next {@link start} or {@link pause} — NOT by the origin time passing —
   * so callers combining it with {@link TransportClockState.originTime}
   * should treat "holding and origin still in the future" as the pre-roll
   * condition (positionAt handles this internally either way).
   */
  get holding(): boolean {
    return this.#holdUntilOrigin;
  }

  /**
   * Position at reference time `t`. While paused this is constant. `t` before
   * the anchor yields positions before it (possibly negative) — callers clamp
   * to their own domain — EXCEPT after {@link startAt}, where the position
   * holds at the armed origin position through the pre-roll (mirroring how a
   * scheduled `source.start(when)` sounds nothing before `when`).
   */
  positionAt(t: number): number {
    if (this.#paused) return this.#originPosition;
    if (this.#holdUntilOrigin && t < this.#originTime) return this.#originPosition;
    return this.#originPosition + (t - this.#originTime) * this.#rate;
  }

  /**
   * Inverse of {@link positionAt}. Throws RangeError while paused: no
   * reference time maps to a position when the transport is frozen — guard
   * with {@link paused} before calling. While a {@link startAt} start is
   * armed, positions before the armed origin position also throw: the
   * position holds through the pre-roll and never passes below the origin,
   * so no reference time maps to them (extrapolating backwards would return
   * a time whose {@link positionAt} is NOT the requested position).
   */
  timeAt(position: number): number {
    if (this.#paused) throw new RangeError('TransportClock is paused; no reference time maps to a position.');
    if (this.#holdUntilOrigin && position < this.#originPosition) {
      throw new RangeError(
        'TransportClock is holding a scheduled start; no reference time maps to a position before the armed origin position.',
      );
    }
    return this.#originTime + (position - this.#originPosition) / this.#rate;
  }

  /**
   * Anchor at `(t, position ?? current position)` and unpause. Re-anchoring
   * while already playing is idempotent for the position at `t`.
   */
  start(t: number, position?: number): void {
    assertFiniteAnchor('start time', t);
    if (position !== undefined) assertFiniteAnchor('start position', position);
    this.#originPosition = position ?? this.positionAt(t);
    this.#originTime = t;
    this.#paused = false;
    this.#holdUntilOrigin = false;
  }

  /**
   * Arm a SCHEDULED start: anchor at a (typically future) reference time and
   * unpause, with the position holding at `position` until `t` arrives —
   * the clock-side mirror of a sample-accurate `play(when)`. Transitions
   * during the pre-roll keep the armed origin: {@link setRate} changes the
   * slope after `t` without collapsing the hold, {@link seekTo} re-arms the
   * held position, and {@link pause} cancels the pending start.
   */
  startAt(t: number, position: number): void {
    assertFiniteAnchor('startAt time', t);
    assertFiniteAnchor('startAt position', position);
    this.#originPosition = position;
    this.#originTime = t;
    this.#paused = false;
    this.#holdUntilOrigin = true;
  }

  /** Fold elapsed time into the anchor; `positionAt()` is constant afterwards. */
  pause(t: number): void {
    assertFiniteAnchor('pause time', t);
    this.#originPosition = this.positionAt(t);
    this.#originTime = t;
    this.#paused = true;
    this.#holdUntilOrigin = false;
  }

  /**
   * Re-anchor at a new position; preserves the paused/playing state. During
   * an armed pre-roll the scheduled origin time is kept (the pending start
   * stays pending at the new position).
   */
  seekTo(position: number, t: number): void {
    assertFiniteAnchor('seek position', position);
    assertFiniteAnchor('seek time', t);
    this.#originPosition = position;
    if (!(this.#holdUntilOrigin && t < this.#originTime)) {
      this.#originTime = t;
    }
  }

  /**
   * Re-anchor so the position is continuous across the rate change:
   * `originPosition = positionAt(t); originTime = t; rate = r`.
   * Throws RangeError unless `r` is finite and > 0.
   */
  setRate(r: number, t: number): void {
    if (!Number.isFinite(r) || r <= 0) {
      throw new RangeError(`TransportClock rate must be finite and > 0, got ${r}.`);
    }
    assertFiniteAnchor('setRate time', t);
    if (this.#holdUntilOrigin && t < this.#originTime) {
      // Pre-roll: the position has not started moving; only the slope after
      // the armed origin changes. (Naively re-anchoring at `t` here is the
      // BufferEngine pre-roll setRate bug this mode exists to prevent.)
      this.#rate = r;
      return;
    }
    this.#originPosition = this.positionAt(t);
    this.#originTime = t;
    this.#rate = r;
  }
}

function assertFiniteAnchor(name: string, value: number): void {
  if (!Number.isFinite(value)) {
    throw new RangeError(`TransportClock ${name} must be a finite number, got ${value}.`);
  }
}

/**
 * Read-only view of a {@link TransportClock} — what a transport OWNER exposes
 * to consumers (the sync bridge, views) so they can anchor against the clock
 * without being able to re-anchor it.
 */
export type TransportClockReader = Pick<
  TransportClock,
  'state' | 'rate' | 'paused' | 'holding' | 'positionAt' | 'timeAt'
>;

/**
 * Monotonic non-decreasing map between a musical position axis (quarters,
 * beats — the consumer defines the unit) and media seconds. Implementations
 * should be total over all reals (extrapolate past the ends); they MAY clamp
 * negative inputs, and MAY quantize (the score family's TimeMap quantizes the
 * inverse to 1/480 quarter), so round-trips are only approximate and only on
 * `[0, duration]`.
 */
export interface TimelineMapping {
  positionToSeconds(position: number): number;
  secondsToPosition(seconds: number): number;
}

// ============================================================================
// Tempo grids: a constant-tempo beat grid on a transport position axis, and a
// TempoClock that reads beats from a transport clock. Domain-neutral — an
// audio clip, a score or an external deck supplies the grid on its own axis.
// ============================================================================

/** Upper bound on a grid tempo; beyond it beat lines are denser than any musical use. */
export const MAX_TEMPO_GRID_BPM = 1000;
/** Upper bound on beats per bar. */
export const MAX_TEMPO_GRID_BEATS_PER_BAR = 64;

/**
 * A constant-tempo beat grid on a transport position axis (typically
 * seconds). `anchor` is the position of one downbeat; every other beat lies a
 * whole number of beat lengths away, extending in both directions without
 * end. Immutable once created through {@link createTempoGrid}.
 */
export interface TempoGrid {
  /** Beats per minute of the position axis; finite, > 0 and ≤ {@link MAX_TEMPO_GRID_BPM}. */
  readonly bpm: number;
  /** Position of a downbeat (bar start), on the transport axis. */
  readonly anchor: number;
  /** Beats in one bar; an integer from 1 to {@link MAX_TEMPO_GRID_BEATS_PER_BAR}. */
  readonly beatsPerBar: number;
}

export interface TempoGridInit {
  readonly bpm: number;
  readonly anchor?: number;
  readonly beatsPerBar?: number;
}

/** Where a position falls on a {@link TempoGrid}. */
export interface TempoGridPosition {
  /** Continuous beat index from the anchor; negative before it. */
  readonly beat: number;
  /** Bar index from the anchor's bar (0); negative before it. */
  readonly bar: number;
  /** Beat inside the bar, 0 … beatsPerBar − 1. */
  readonly beatInBar: number;
  /** Fraction of the current beat already elapsed, in [0, 1). */
  readonly phase: number;
}

/** Validate and freeze a grid. Throws RangeError for an invalid tempo, anchor or meter. */
export function createTempoGrid(init: TempoGridInit): TempoGrid {
  const bpm = init?.bpm;
  const anchor = init?.anchor ?? 0;
  const beatsPerBar = init?.beatsPerBar ?? 4;
  if (typeof bpm !== 'number' || !Number.isFinite(bpm) || bpm <= 0 || bpm > MAX_TEMPO_GRID_BPM) {
    throw new RangeError(`TempoGrid bpm must be finite, > 0 and <= ${MAX_TEMPO_GRID_BPM}, got ${bpm}.`);
  }
  if (typeof anchor !== 'number' || !Number.isFinite(anchor)) throw new RangeError(`TempoGrid anchor must be finite, got ${anchor}.`);
  if (!Number.isInteger(beatsPerBar) || beatsPerBar < 1 || beatsPerBar > MAX_TEMPO_GRID_BEATS_PER_BAR) {
    throw new RangeError(`TempoGrid beatsPerBar must be an integer from 1 to ${MAX_TEMPO_GRID_BEATS_PER_BAR}, got ${beatsPerBar}.`);
  }
  return Object.freeze({bpm, anchor, beatsPerBar});
}

/** Length of one beat on the grid's position axis (60 / bpm for a seconds axis). */
export function tempoGridBeatLength(grid: TempoGrid): number {
  return 60 / grid.bpm;
}

/** Beat, bar and phase at a position. */
export function tempoGridPosition(grid: TempoGrid, position: number): TempoGridPosition {
  const beat = (position - grid.anchor) / tempoGridBeatLength(grid);
  const whole = Math.floor(beat + 1e-9);
  const phase = Math.max(0, beat - whole);
  const bar = Math.floor(whole / grid.beatsPerBar);
  return Object.freeze({beat, bar, beatInBar: whole - bar * grid.beatsPerBar, phase});
}

/** Position of a (possibly fractional) beat index. */
export function tempoGridBeatPosition(grid: TempoGrid, beat: number): number {
  return grid.anchor + beat * tempoGridBeatLength(grid);
}

export interface TempoGridSnapOptions {
  /** Grid lines per beat: 1 beats, 2 eighths in 4/4, 0.25 one line per 4 beats. Default 1. */
  readonly division?: number;
  /** `nearest` (default), `forward` (at or after) or `backward` (at or before). */
  readonly direction?: 'nearest' | 'forward' | 'backward';
}

/** The grid line nearest a position, or the next/previous one. */
export function snapToTempoGrid(grid: TempoGrid, position: number, options: TempoGridSnapOptions = {}): number {
  const division = options.division ?? 1;
  if (!Number.isFinite(division) || division <= 0) throw new RangeError(`TempoGrid division must be finite and > 0, got ${division}.`);
  const step = tempoGridBeatLength(grid) / division;
  const index = (position - grid.anchor) / step;
  const rounded = options.direction === 'forward' ? Math.ceil(index - 1e-9) :
    options.direction === 'backward' ? Math.floor(index + 1e-9) : Math.round(index);
  return grid.anchor + rounded * step;
}

/**
 * Quantized jump: the position near `to` that keeps the beat phase of
 * `from`, so a running transport lands on the beat as it would have played
 * there (the DJ "quantize" behavior). `to` is rounded to its nearest beat
 * first; the phase of `from` is then added.
 */
export function tempoGridJump(grid: TempoGrid, from: number, to: number): number {
  const length = tempoGridBeatLength(grid);
  const target = Math.round((to - grid.anchor) / length);
  return grid.anchor + (target + tempoGridPosition(grid, from).phase) * length;
}

/** Positions of the grid lines inside [start, end], with their beat index. */
export function tempoGridLines(grid: TempoGrid, start: number, end: number, division = 1):
  readonly {readonly position: number; readonly beat: number; readonly downbeat: boolean}[] {
  if (!Number.isFinite(division) || division <= 0) throw new RangeError(`TempoGrid division must be finite and > 0, got ${division}.`);
  const step = tempoGridBeatLength(grid) / division;
  const first = Math.ceil((start - grid.anchor) / step - 1e-9) || 0;
  const last = Math.floor((end - grid.anchor) / step + 1e-9);
  const lines: {position: number; beat: number; downbeat: boolean}[] = [];
  if (!(last >= first) || last - first > 100_000) return lines;
  for (let index = first; index <= last; index += 1) {
    const beat = index / division;
    lines.push({position: grid.anchor + index * step, beat,
      downbeat: Number.isInteger(beat) && ((beat % grid.beatsPerBar) + grid.beatsPerBar) % grid.beatsPerBar === 0});
  }
  return lines;
}

/** The grid as a {@link TimelineMapping} between beats and its position axis. */
export function tempoGridMapping(grid: TempoGrid): TimelineMapping {
  return Object.freeze({
    positionToSeconds: (beat: number) => tempoGridBeatPosition(grid, beat),
    secondsToPosition: (position: number) => tempoGridPosition(grid, position).beat,
  });
}

/**
 * Tempo from tap times (any monotonic seconds, such as `performance.now() / 1000`):
 * the median interval of the most recent run of taps, where a gap longer than
 * `resetSeconds` starts a new run. Undefined until a run has two taps.
 */
export function tapTempo(times: readonly number[], resetSeconds = 2): number | undefined {
  let start = times.length - 1;
  while (start > 0 && times[start] - times[start - 1] > 0 && times[start] - times[start - 1] <= resetSeconds) start -= 1;
  const run = times.slice(start).filter((time) => Number.isFinite(time));
  if (run.length < 2) return undefined;
  const intervals = run.slice(1).map((time, index) => time - run[index]).filter((value) => value > 0).sort((a, b) => a - b);
  if (!intervals.length) return undefined;
  const middle = intervals.length >> 1;
  const median = intervals.length % 2 ? intervals[middle] : (intervals[middle - 1] + intervals[middle]) / 2;
  const bpm = 60 / median;
  return bpm > 0 && bpm <= MAX_TEMPO_GRID_BPM ? bpm : undefined;
}

/**
 * Beats read from a transport clock: a {@link TransportClockReader} paired
 * with a {@link TempoGrid} on the same position axis. Read-only — it never
 * re-anchors the clock — and immutable; pair the clock with a new grid
 * through {@link withGrid}. All reference times are the clock's.
 */
export class TempoClock {
  readonly clock: TransportClockReader;
  readonly grid: TempoGrid;

  constructor(clock: TransportClockReader, grid: TempoGrid) {
    this.clock = clock;
    this.grid = createTempoGrid(grid);
    Object.freeze(this);
  }

  /** Same clock, another grid. */
  withGrid(grid: TempoGrid): TempoClock {
    return new TempoClock(this.clock, grid);
  }

  /** Beat, bar and phase at reference time `t`. */
  positionAt(t: number): TempoGridPosition {
    return tempoGridPosition(this.grid, this.clock.positionAt(t));
  }

  /** Continuous beat index at reference time `t`. */
  beatAt(t: number): number {
    return this.positionAt(t).beat;
  }

  /** Tempo heard at the current rate: grid bpm × clock rate. */
  get effectiveBpm(): number {
    return this.grid.bpm * this.clock.rate;
  }

  /**
   * Reference time of the next grid line strictly after `t` (`division`
   * lines per beat) — the instant to schedule a quantized action. Throws
   * RangeError while the clock is paused, like {@link TransportClock.timeAt}.
   */
  nextGridTime(t: number, division = 1): number {
    const position = this.clock.positionAt(t);
    let line = snapToTempoGrid(this.grid, position, {division, direction: 'forward'});
    if (line <= position + 1e-9) line += tempoGridBeatLength(this.grid) / division;
    return this.clock.timeAt(line);
  }

  /** Reference time at which a beat index plays. Throws RangeError while paused. */
  timeAtBeat(beat: number): number {
    return this.clock.timeAt(tempoGridBeatPosition(this.grid, beat));
  }
}

// ============================================================================
// Musical time (DEC-077): tempo, meter, bars:beats:ticks and Max-style time
// values such as `4n`, `8nt` and `1.2.0`. Pure arithmetic on a seconds axis;
// `bpm` always counts quarter notes, and a beat is the meter's beat unit.
// ============================================================================

/** Ticks in one quarter note, as in Max. */
export const TICKS_PER_QUARTER = 480;

export interface MusicalTempo {
  /** Quarter notes per minute; finite and > 0. */
  readonly bpm: number;
  /** Beats in a bar (time-signature numerator). */
  readonly beatsPerBar: number;
  /** The note value of one beat (time-signature denominator): 2, 4, 8 or 16. */
  readonly beatUnit: number;
}

/** A position as bars, beats and ticks, all counted from 1 except ticks (from 0). */
export interface BarsBeatsTicks { readonly bar: number; readonly beat: number; readonly tick: number }

export const DEFAULT_MUSICAL_TEMPO: MusicalTempo = Object.freeze({bpm: 120, beatsPerBar: 4, beatUnit: 4});

/** Validate and freeze a tempo. */
export function createMusicalTempo(init: Partial<MusicalTempo> = {}): MusicalTempo {
  const bpm = init.bpm ?? 120, beatsPerBar = init.beatsPerBar ?? 4, beatUnit = init.beatUnit ?? 4;
  if (!Number.isFinite(bpm) || bpm <= 0 || bpm > MAX_TEMPO_GRID_BPM) throw new RangeError(`Tempo must be finite, > 0 and <= ${MAX_TEMPO_GRID_BPM} bpm.`);
  if (!Number.isInteger(beatsPerBar) || beatsPerBar < 1 || beatsPerBar > MAX_TEMPO_GRID_BEATS_PER_BAR) throw new RangeError('Beats per bar must be an integer from 1 to 64.');
  if (![1, 2, 4, 8, 16, 32].includes(beatUnit)) throw new RangeError('The beat unit must be 1, 2, 4, 8, 16 or 32.');
  return Object.freeze({bpm, beatsPerBar, beatUnit});
}

/** Seconds per tick at a tempo. */
export const tickSeconds = (tempo: MusicalTempo): number => 60 / tempo.bpm / TICKS_PER_QUARTER;
/** Ticks in one beat of the meter. */
export const ticksPerBeat = (tempo: MusicalTempo): number => TICKS_PER_QUARTER * 4 / tempo.beatUnit;
/** Ticks in one bar. */
export const ticksPerBar = (tempo: MusicalTempo): number => ticksPerBeat(tempo) * tempo.beatsPerBar;

const NOTE_VALUE = /^(\d+)(n|nd|nt)$/;

/**
 * The length in ticks of a time value: a note value (`1n`, `4n`, `8nd`
 * dotted, `16nt` triplet), `bars.beats.ticks` as a length (`1.0.0` is one
 * bar), or `480 ticks`. Undefined for a value that is not musical (`250ms`,
 * `2hz`, a plain number of milliseconds).
 */
export function timeValueTicks(text: string, tempo: MusicalTempo = DEFAULT_MUSICAL_TEMPO): number | undefined {
  const value = text.trim().toLowerCase();
  const note = NOTE_VALUE.exec(value);
  if (note) {
    const division = Number(note[1]);
    if (division < 1 || division > 128 || (division & (division - 1)) !== 0) throw new RangeError(`${text} is not a note value: use 1n, 2n, 4n … 128n.`);
    const base = TICKS_PER_QUARTER * 4 / division;
    return note[2] === 'nd' ? base * 1.5 : note[2] === 'nt' ? base * 2 / 3 : base;
  }
  const bbt = /^(\d+)\.(\d+)\.(\d+(?:\.\d+)?)$/.exec(value);
  if (bbt) return Number(bbt[1]) * ticksPerBar(tempo) + Number(bbt[2]) * ticksPerBeat(tempo) + Number(bbt[3]);
  const ticks = /^(\d+(?:\.\d+)?)\s*ticks?$/.exec(value);
  if (ticks) return Number(ticks[1]);
  return undefined;
}

/**
 * The length in seconds of a time value at `tempo`: any musical value of
 * {@link timeValueTicks}, or `250ms`, `0.5s`, `2hz` (one period) or a plain
 * number of milliseconds.
 */
export function timeValueSeconds(text: string, tempo: MusicalTempo = DEFAULT_MUSICAL_TEMPO): number {
  const ticks = timeValueTicks(text, tempo);
  if (ticks !== undefined) return ticks * tickSeconds(tempo);
  const value = text.trim().toLowerCase();
  const match = /^(-?\d+(?:\.\d+)?)\s*(ms|s|hz)?$/.exec(value);
  if (!match) throw new SyntaxError(`${text} is not a time value: use 4n, 8nt, 1.0.0, 480 ticks, 250ms, 0.5s or 2hz.`);
  const amount = Number(match[1]);
  if (match[2] === 's') return amount;
  if (match[2] === 'hz') { if (amount <= 0) throw new RangeError('A frequency must be > 0 Hz.'); return 1 / amount; }
  return amount / 1000;
}

/** Bars, beats and ticks at `seconds` from `anchor` (where bar 1 beat 1 begins). */
export function barsBeatsTicksAt(seconds: number, tempo: MusicalTempo, anchor = 0): BarsBeatsTicks {
  const total = Math.max(0, (seconds - anchor) / tickSeconds(tempo) + 1e-6);
  const bar = Math.floor(total / ticksPerBar(tempo));
  const inBar = total - bar * ticksPerBar(tempo);
  const beat = Math.floor(inBar / ticksPerBeat(tempo));
  return Object.freeze({bar: bar + 1, beat: beat + 1, tick: Math.floor(inBar - beat * ticksPerBeat(tempo))});
}

/** Seconds at a bars:beats:ticks position. */
export function secondsAtBarsBeatsTicks(position: BarsBeatsTicks, tempo: MusicalTempo, anchor = 0): number {
  const ticks = (position.bar - 1) * ticksPerBar(tempo) + (position.beat - 1) * ticksPerBeat(tempo) + position.tick;
  return anchor + ticks * tickSeconds(tempo);
}

/** `bar.beat.tick`, as Max shows a transport position. */
export function formatBarsBeatsTicks(position: BarsBeatsTicks): string {
  return `${position.bar}.${position.beat}.${position.tick}`;
}

/** The next multiple of `interval` seconds at or after `position`, measured from `anchor`. */
export function nextGridTime(position: number, interval: number, anchor = 0): number {
  if (!(interval > 0)) throw new RangeError('A grid interval must be > 0.');
  return anchor + Math.ceil((position - anchor) / interval - 1e-9) * interval;
}
