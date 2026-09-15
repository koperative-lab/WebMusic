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
