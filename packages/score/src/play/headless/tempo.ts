/** Taps further apart than this many seconds start a fresh measurement. */
export const TAP_RESET_GAP = 2;

/** Average over at most this many recent intervals. */
export const TAP_WINDOW = 6;

export type TempoMode = 'tap' | 'conduct';
export type TempoConductMode = 'hold' | 'full';

/** Borrowed playback target used by conduct mode. */
export interface AdvanceTarget {
  advance: (opts?: {secondsPerBeat?: number}) => unknown;
  advanceHold?: () => unknown;
  allNotesOff?: () => unknown;
}

export interface TempoControllerOptions {
  mode?: TempoMode;
  conduct?: TempoConductMode;
  target?: AdvanceTarget;
  /** Injectable monotonic clock, in seconds. */
  now?: () => number;
  resetGap?: number;
  windowSize?: number;
}

export interface TempoControllerConfig {
  mode?: TempoMode;
  conduct?: TempoConductMode;
  target?: AdvanceTarget;
}

export interface TempoControllerState {
  mode: TempoMode;
  conduct: TempoConductMode;
  bpm: number | null;
  holding: boolean;
  /** Increments once for every accepted press. Useful to drive transient UI. */
  activation: number;
  /** Most recent interval between conduct presses, capped at two seconds. */
  secondsPerBeat?: number;
}

export type TempoPressResult =
  | {type: 'tap'; bpm: number | null}
  | {type: 'beat'; secondsPerBeat?: number};

/**
 * Append a tap timestamp to a history, applying the reset gap and rolling
 * window. Pure: the input is never mutated.
 */
export function appendTap(
  taps: readonly number[],
  time: number,
  resetGap = TAP_RESET_GAP,
  windowSize = TAP_WINDOW,
): number[] {
  const last = taps[taps.length - 1];
  const next = last != null && time - last > resetGap ? [time] : [...taps, time];
  return next.length > windowSize + 1
    ? next.slice(next.length - (windowSize + 1))
    : next;
}

/** Return the rounded BPM implied by a tap history, or null if invalid. */
export function tapBpm(taps: readonly number[]): number | null {
  if (taps.length < 2) return null;
  let sum = 0;
  for (let index = 1; index < taps.length; index += 1) {
    sum += taps[index] - taps[index - 1];
  }
  const average = sum / (taps.length - 1);
  if (!(average > 0) || !Number.isFinite(average)) return null;
  return Math.round(60 / average);
}

function defaultNow(): number {
  return (typeof performance !== 'undefined' ? performance.now() : 0) / 1000;
}

function normalizeMode(mode: TempoMode | undefined): TempoMode {
  return mode === 'conduct' ? 'conduct' : 'tap';
}

function normalizeConduct(conduct: TempoConductMode | undefined): TempoConductMode {
  return conduct === 'full' ? 'full' : 'hold';
}

function finiteAtLeast(value: number | undefined, fallback: number, minimum: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(minimum, value)
    : fallback;
}

/**
 * DOM-free tap-tempo and conducted-play controller.
 *
 * The playback target is borrowed. `dispose()` never destroys it, but it does
 * release a note that this controller is currently holding.
 */
export class TempoController {
  private modeValue: TempoMode;
  private conductValue: TempoConductMode;
  private target?: AdvanceTarget;
  private readonly now: () => number;
  private readonly resetGap: number;
  private readonly windowSize: number;
  private readonly subscribers = new Set<() => void>();
  private taps: number[] = [];
  private bpmValue: number | null = null;
  private lastConductPress?: number;
  private heldTarget?: AdvanceTarget;
  private holdingValue = false;
  private activationValue = 0;
  private secondsPerBeatValue?: number;
  private disposed = false;

  constructor(options: TempoControllerOptions = {}) {
    this.modeValue = normalizeMode(options.mode);
    this.conductValue = normalizeConduct(options.conduct);
    this.target = options.target;
    this.now = options.now ?? defaultNow;
    this.resetGap = finiteAtLeast(options.resetGap, TAP_RESET_GAP, 0);
    this.windowSize = Math.floor(finiteAtLeast(options.windowSize, TAP_WINDOW, 1));
  }

  snapshot(): TempoControllerState {
    return {
      mode: this.modeValue,
      conduct: this.conductValue,
      bpm: this.bpmValue,
      holding: this.holdingValue,
      activation: this.activationValue,
      secondsPerBeat: this.secondsPerBeatValue,
    };
  }

  subscribe(notify: () => void): () => void {
    if (this.disposed) return () => undefined;
    this.subscribers.add(notify);
    return () => this.subscribers.delete(notify);
  }

  /**
   * Reconfigure the borrowed target or interaction mode. A held note is
   * atomically detached and released during any transition that could
   * otherwise orphan it, before observers see the new configuration.
   */
  configure(config: TempoControllerConfig): void {
    if (this.disposed) return;
    const nextMode = config.mode === undefined ? this.modeValue : normalizeMode(config.mode);
    const nextConduct =
      config.conduct === undefined ? this.conductValue : normalizeConduct(config.conduct);
    const hasTarget = Object.prototype.hasOwnProperty.call(config, 'target');
    const nextTarget = hasTarget ? config.target : this.target;
    const invalidatesHold =
      this.holdingValue &&
      (nextMode !== this.modeValue ||
        nextConduct !== this.conductValue ||
        nextTarget !== this.target);
    const modeChanged = nextMode !== this.modeValue;

    // Detach the old hold before exposing any transition callback. Commit the
    // new configuration before calling the borrowed target so even a
    // reentrant allNotesOff()/subscriber press observes only the new mode.
    const releasedTarget = invalidatesHold ? this.heldTarget : undefined;
    if (invalidatesHold) {
      this.heldTarget = undefined;
      this.holdingValue = false;
    }
    this.modeValue = nextMode;
    this.conductValue = nextConduct;
    this.target = nextTarget;
    if (modeChanged) {
      this.lastConductPress = undefined;
      this.secondsPerBeatValue = undefined;
    }
    let failure: unknown;
    if (invalidatesHold) {
      try {
        releasedTarget?.allNotesOff?.();
      } catch (error) {
        failure = error;
      }
    }
    try {
      this.emit();
    } catch (error) {
      failure ??= error;
    }
    if (failure !== undefined) throw failure;
  }

  /** Record a tap or advance the borrowed conduct target once. */
  press(atSeconds = this.now()): TempoPressResult | undefined {
    if (this.disposed) return undefined;
    const time = Number.isFinite(atSeconds) ? atSeconds : this.now();
    this.activationValue += 1;
    const activation = this.activationValue;

    if (this.modeValue === 'tap') {
      this.taps = appendTap(this.taps, time, this.resetGap, this.windowSize);
      this.bpmValue = tapBpm(this.taps);
      this.emit();
      return {type: 'tap', bpm: this.bpmValue};
    }

    if (this.holdingValue) {
      const mode = this.modeValue;
      const conduct = this.conductValue;
      const targetAtRelease = this.target;
      this.release();
      // release() intentionally notifies synchronously. A listener or the
      // borrowed target may issue a newer press/configure/dispose command;
      // that command wins and the outer press must not revive the old mode.
      if (
        this.disposed ||
        this.activationValue !== activation ||
        this.modeValue !== mode ||
        this.conductValue !== conduct ||
        this.target !== targetAtRelease ||
        this.holdingValue
      ) {
        return undefined;
      }
    }
    const elapsed =
      this.lastConductPress === undefined ? undefined : time - this.lastConductPress;
    const secondsPerBeat =
      elapsed !== undefined && elapsed > 0 && Number.isFinite(elapsed)
        ? Math.min(2, elapsed)
        : undefined;
    this.lastConductPress = time;
    this.secondsPerBeatValue = secondsPerBeat;

    const target = this.target;
    if (this.conductValue === 'hold') {
      this.holdingValue = true;
      this.heldTarget = target;
    }
    let failure: unknown;
    try {
      if (this.conductValue === 'hold') {
        if (target?.advanceHold) target.advanceHold();
        else target?.advance(secondsPerBeat === undefined ? {} : {secondsPerBeat});
      } else {
        target?.advance(secondsPerBeat === undefined ? {} : {secondsPerBeat});
      }
    } catch (error) {
      failure = error;
    }
    // Publish only after the domain command has run. This lets a synchronous
    // subscriber release a hold without the outer press re-starting it, while
    // still reporting state when the borrowed target throws.
    try {
      this.emit();
    } catch (error) {
      failure ??= error;
    }
    if (failure !== undefined) throw failure;
    return {type: 'beat', secondsPerBeat};
  }

  /** Release the exact target that was active when hold mode was pressed. */
  release(): void {
    if (this.disposed || !this.holdingValue) return;
    const heldTarget = this.heldTarget;
    this.heldTarget = undefined;
    this.holdingValue = false;
    let failure: unknown;
    try {
      heldTarget?.allNotesOff?.();
    } catch (error) {
      failure = error;
    }
    try {
      this.emit();
    } catch (error) {
      failure ??= error;
    }
    if (failure !== undefined) throw failure;
  }

  /** Release held sound and make this controller inert. Idempotent. */
  dispose(): void {
    if (this.disposed) return;
    // Seal the public command surface first. A release subscriber (or the
    // borrowed target itself) must not be able to press a new held note while
    // disposal is in progress.
    this.disposed = true;
    const heldTarget = this.heldTarget;
    const wasHolding = this.holdingValue;
    this.heldTarget = undefined;
    this.holdingValue = false;
    let failure: unknown;
    if (wasHolding) {
      try {
        heldTarget?.allNotesOff?.();
      } catch (error) {
        failure = error;
      }
      try {
        this.emit();
      } catch (error) {
        failure ??= error;
      }
    }
    this.subscribers.clear();
    if (failure !== undefined) throw failure;
  }

  private emit(): void {
    let failure: unknown;
    for (const notify of [...this.subscribers]) {
      try {
        notify();
      } catch (error) {
        failure ??= error;
      }
    }
    if (failure !== undefined) throw failure;
  }
}
