// ============================================================================
// The transport clock — prediction, as arithmetic.
//
// A player's cursor arrives at about 20 Hz (`cursorIntervalMs ?? 50` in
// `play/headless/score-player.ts`, and the emit is throttled to that interval).
// A conveyor asks where the material is SIXTY times a second. Without a
// predictor in between, a lane stands still for two frames and jumps on the
// third, forever — which is what "static" looks like after somebody has added
// scrolling. So this module coasts between readings and corrects on arrival.
//
// Everything here is arithmetic: time goes IN as an argument and comes OUT as
// a number. It reads no clock, no global and no DOM, which is what makes the
// whole behaviour testable in whole milliseconds — and what keeps this layer
// inside the code-only contract `checkFeatureLayers` enforces.
//
// ## The five events it has to survive, and where each is answered
//
//  - **seek** — the player emits a cursor immediately, out of band. The sample
//    disagrees with the prediction by more than the coast could explain, so
//    {@link TransportReading.epoch} moves and the presenter SNAPS instead of
//    tweening across material nobody heard.
//  - **pause** — nothing is emitted at all. `pause()` sends no cursor, so
//    starvation is the only signal there is. The coast decays to a stop within
//    the cap below and reports `held`, which reads as a transport settling
//    rather than as a fault.
//  - **rate change** — `retune()` emits a cursor at the change. The rate is
//    therefore READ from the sample and never differenced: a finite difference
//    cannot tell a tempo change from a seek, and guessing wrong is wrong for a
//    whole cursor interval.
//  - **a tempo curve written into the score** — free. The axis is nominal
//    score seconds, so the score's own tempo map has already been integrated.
//  - **loop wrap** — `wrapLoop()` emits a cursor bypassing the throttle. It
//    takes the seek path: a backwards residual, an epoch bump, a snap.
//
// ## The one limit worth writing down rather than hiding
//
// The loop REGION cannot be read. `ScorePlayer` has `setLoop`/`clearLoop` and
// no getter, so this clock can DETECT a wrap and can never PREDICT one. That is
// fine — the wrap's cursor is on time — and adding a getter to the play package
// is deliberately out of scope for this series.
// ============================================================================

/** One reading off the wire, in the units the wire actually carries. */
export interface TransportSample {
  /** Nominal score seconds — the rate-independent analysis axis. */
  readonly nominalSeconds: number;
  /** Nominal seconds per real second. `1` is the speed the music was written at. */
  readonly rate: number;
  /** The wall clock when this sample was taken. Same origin as {@link TransportClock.readAt}. */
  readonly atMs: number;
}

/** Where the material is, at an instant nobody sampled. */
export interface TransportReading {
  /** Nominal seconds, interpolated to the requested instant. */
  readonly seconds: number;
  /**
   * The coast ran out: paused, stopped, scrubbed, or simply starved. A
   * presenter may show it; nothing here requires it to.
   */
  readonly held: boolean;
  /**
   * Bumped by every discontinuity — a seek, a loop wrap, a stop, a scrub.
   * A presenter SNAPS when it changes and interpolates when it does not.
   */
  readonly epoch: number;
  /** The rate of the last sample. `0` once {@link TransportClock.stop} has run. */
  readonly rate: number;
}

export interface TransportClockOptions {
  /** Clamps every reading to `[0, durationSeconds]`. Omitted, nothing is clamped. */
  readonly durationSeconds?: number;
  /**
   * A hint only. The clock re-measures the real interval with an EWMA, because
   * `cursorIntervalMs` is an option, a borrowed controller may tick at any rate
   * at all, and a throttled tab stretches whatever it was.
   */
  readonly expectedIntervalMs?: number;
}

export interface TransportClock {
  /** Where the material is at `atMs`. Pure: the same argument always answers the same. */
  readAt(atMs: number): TransportReading;
  /** A cursor arrived. Re-anchors, re-measures the interval, and judges the residual. */
  sample(next: TransportSample): void;
  /** `webscore:end`: park at rest, rate `0`, one epoch. */
  stop(atMs: number, seconds?: number): void;
  /** A drag took the position over. Every distinct position is a discontinuity. */
  hold(seconds: number): void;
  /** The drag let go. The player's echo of our own seek is ignored for a moment. */
  release(atMs: number): void;
}

/** `cursorIntervalMs ?? 50` in the score player: 20 Hz, not one per frame. */
const DEFAULT_INTERVAL_MS = 50;
/** The coast cap floor and ceiling. Twice the observed interval, held between these. */
const COAST_MIN_MS = 60;
const COAST_MAX_MS = 140;
/** Intervals outside this are a stall or a glitch, not a measurement. */
const MIN_OBSERVED_MS = 8;
const MAX_OBSERVED_MS = 400;
/** How fast the interval estimate follows a real change. One subtraction per sample. */
const EWMA_ALPHA = 0.2;
/** Floor under the residual tolerance, so a rounding wobble is never a seek. */
const MIN_TOLERANCE_SECONDS = 0.02;
/** After a drag, how long the player may still be echoing where it used to be. */
const RELEASE_GRACE_MS = 250;

/**
 * The rate, read rather than differenced.
 *
 * `webscore:timeupdate` carries the rate-scaled transport duration, and the
 * nominal duration is the score's own. Their ratio is exact and — unlike
 * `nominalSeconds / transportSeconds` — is defined at position `0`, where both
 * positions are `0` and the quotient is not.
 *
 * Anything unusable answers `1`, which is the only safe guess: it makes a
 * rate-aware caller behave exactly like the rate-unaware one it replaced.
 */
export function rateFromDurations(
  nominalDurationSeconds: number,
  transportDurationSeconds: number,
): number {
  if (!isFiniteNumber(nominalDurationSeconds) || !isFiniteNumber(transportDurationSeconds)) return 1;
  if (nominalDurationSeconds <= 0 || transportDurationSeconds <= 0) return 1;
  const rate = nominalDurationSeconds / transportDurationSeconds;
  return isFiniteNumber(rate) && rate > 0 ? rate : 1;
}

/**
 * A predictor for one transport.
 *
 * ```ts
 * const clock = createTransportClock({durationSeconds: score.durationSeconds});
 * // 20 Hz, from the player:
 * clock.sample({nominalSeconds: 12.5, rate: 1, atMs: performanceNow});
 * // 60 Hz, from the frame loop:
 * const {seconds, epoch, held} = clock.readAt(frameAtMs);
 * ```
 */
export function createTransportClock(options: TransportClockOptions = {}): TransportClock {
  const duration = isFiniteNumber(options.durationSeconds) && options.durationSeconds >= 0
    ? options.durationSeconds
    : undefined;

  let anchorSeconds = 0;
  let anchorAtMs = 0;
  let rate = 1;
  let epoch = 0;
  let intervalMs = isFiniteNumber(options.expectedIntervalMs) && options.expectedIntervalMs > 0
    ? clamp(options.expectedIntervalMs, MIN_OBSERVED_MS, MAX_OBSERVED_MS)
    : DEFAULT_INTERVAL_MS;
  let lastSampleAtMs: number | undefined;
  let scrubSeconds: number | undefined;
  let graceUntilMs: number | undefined;
  // Parked: hold this position until a sample says otherwise. A stop, and the
  // moment after a drag lets go — both are positions we know and velocities we
  // do not, and coasting on a velocity nobody reported is inventing motion.
  let parked = true;
  let seeded = false;

  const clampSeconds = (seconds: number): number => {
    if (!isFiniteNumber(seconds)) return anchorSeconds;
    if (seconds < 0) return 0;
    return duration !== undefined && seconds > duration ? duration : seconds;
  };

  const reading = (seconds: number, held: boolean): TransportReading =>
    ({seconds: clampSeconds(seconds), held, epoch, rate});

  const readAt = (atMs: number): TransportReading => {
    if (scrubSeconds !== undefined) return reading(scrubSeconds, true);
    if (parked || rate === 0) return reading(anchorSeconds, true);
    if (!isFiniteNumber(atMs)) return reading(anchorSeconds, false);
    const elapsed = atMs - anchorAtMs;
    if (elapsed <= 0) return reading(anchorSeconds, false);
    const coast = travel(elapsed, intervalMs);
    return reading(anchorSeconds + (coast.travelled / 1000) * rate, coast.exhausted);
  };

  const anchorAt = (seconds: number, atMs: number): void => {
    anchorSeconds = clampSeconds(seconds);
    anchorAtMs = atMs;
  };

  const measureInterval = (atMs: number): void => {
    if (lastSampleAtMs !== undefined) {
      const gap = atMs - lastSampleAtMs;
      if (gap >= MIN_OBSERVED_MS && gap <= MAX_OBSERVED_MS) {
        intervalMs += EWMA_ALPHA * (gap - intervalMs);
      }
    }
    lastSampleAtMs = atMs;
  };

  /**
   * How far a sample may sit from the prediction and still be the same motion.
   *
   * Forward gets the starvation added: a clock that coasted for 75 ms of a
   * 400 ms gap cannot tell catch-up from a jump, and calling catch-up a seek
   * would snap a lane on every throttled frame. Backward gets no such credit —
   * material never runs backwards on its own.
   */
  const tolerate = (residual: number, atMs: number): boolean => {
    const slack = (coastCap(intervalMs) / 1000) * Math.max(rate, 0) + MIN_TOLERANCE_SECONDS;
    if (residual < 0) return -residual <= slack;
    const elapsed = Math.max(0, atMs - anchorAtMs);
    const starvedMs = parked ? elapsed : elapsed - travel(elapsed, intervalMs).travelled;
    return residual <= slack + (starvedMs / 1000) * Math.max(rate, 0);
  };

  return {
    readAt,

    sample(next) {
      if (!next || !isFiniteNumber(next.nominalSeconds) || !isFiniteNumber(next.atMs)) return;

      // A drag owns the position outright; the player is only reporting where
      // it used to be. Keep measuring the interval, ignore the position.
      if (scrubSeconds !== undefined) {
        measureInterval(next.atMs);
        return;
      }

      // Just released: the next cursor or two are usually the echo of the seek
      // we asked for, arriving from wherever the transport was BEFORE it. Take
      // the first one that agrees with where the reader put it, and let the
      // grace period end the standoff if none ever does.
      if (graceUntilMs !== undefined) {
        if (next.atMs < graceUntilMs && !tolerate(next.nominalSeconds - anchorSeconds, next.atMs)) {
          measureInterval(next.atMs);
          return;
        }
        graceUntilMs = undefined;
      }

      if (seeded) {
        const residual = next.nominalSeconds - readAt(next.atMs).seconds;
        if (!tolerate(residual, next.atMs)) epoch += 1;
      }

      anchorAt(next.nominalSeconds, next.atMs);
      // Read, never differenced — see the header. A missing or absurd rate
      // leaves the last known one standing rather than stopping the lane.
      if (isFiniteNumber(next.rate) && next.rate >= 0) rate = next.rate;
      parked = false;
      seeded = true;
      measureInterval(next.atMs);
    },

    stop(atMs, seconds) {
      anchorAt(seconds ?? readAt(atMs).seconds, isFiniteNumber(atMs) ? atMs : anchorAtMs);
      rate = 0;
      scrubSeconds = undefined;
      graceUntilMs = undefined;
      parked = true;
      seeded = true;
      epoch += 1;
    },

    hold(seconds) {
      const next = clampSeconds(seconds);
      if (scrubSeconds === next) return;
      scrubSeconds = next;
      anchorSeconds = next;
      graceUntilMs = undefined;
      seeded = true;
      epoch += 1;
    },

    release(atMs) {
      if (scrubSeconds === undefined) return;
      anchorAt(scrubSeconds, isFiniteNumber(atMs) ? atMs : anchorAtMs);
      scrubSeconds = undefined;
      parked = true;
      graceUntilMs = (isFiniteNumber(atMs) ? atMs : anchorAtMs) + RELEASE_GRACE_MS;
    },
  };
}

/**
 * How long a coast may last: twice the observed interval, held between 60 and
 * 140 ms. A hard stop at the expected interval hiccups on every late tick; no
 * cap at all runs away in a backgrounded tab.
 */
function coastCap(intervalMs: number): number {
  return clamp(intervalMs * 2, COAST_MIN_MS, COAST_MAX_MS);
}

/**
 * The coast itself: full speed while a tick is still due, then a velocity
 * falling linearly to zero at the cap.
 *
 * Linear decay and not a hard stop, because the handover is then C1-continuous
 * and the overshoot is bounded by half the decay window — 25 ms of nominal time
 * at a 50 ms interval, which at 120 bpm and 64 px per quarter is 3.2 px, still
 * decelerating. That reads as a transport settling. A hard stop reads as a
 * stutter, and no cap at all reads as a runaway.
 */
function travel(elapsedMs: number, intervalMs: number): {travelled: number; exhausted: boolean} {
  const cap = coastCap(intervalMs);
  const fresh = Math.min(intervalMs, cap);
  if (elapsedMs <= fresh) return {travelled: elapsedMs, exhausted: false};
  const span = cap - fresh;
  if (span <= 0 || elapsedMs >= cap) return {travelled: fresh + span / 2, exhausted: true};
  const past = elapsedMs - fresh;
  return {travelled: fresh + past - (past * past) / (2 * span), exhausted: false};
}

function clamp(value: number, low: number, high: number): number {
  return value < low ? low : value > high ? high : value;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}
