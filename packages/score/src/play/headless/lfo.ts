/** LFO value in -1…1 for a phase in the conventional 0…1 cycle. */
export type LfoShape = 'sine' | 'triangle' | 'square' | 'saw';

export const LFO_SHAPES: readonly LfoShape[] = [
  'sine',
  'triangle',
  'square',
  'saw',
];

/** Borrowed destination. The controller never destroys or otherwise owns it. */
export interface LfoTarget {
  min: number;
  max: number;
  /** Retained for compatibility; modulation remains centred on min/max. */
  value?: number;
  unit?: string;
  /** Contextual void preserves legacy callbacks that return incidental values. */
  apply: (value: number) => void;
}

export interface LfoControllerState {
  shape: LfoShape;
  rate: number;
  depth: number;
  running: boolean;
  phase: number;
}

export interface LfoControllerConfig {
  shape?: LfoShape;
  rate?: number;
  depth?: number;
  phase?: number;
  /** Presence replaces the borrowed target; `undefined` detaches it. */
  target?: LfoTarget;
}

export type LfoFrameCallback = (timestamp: number) => void;
export type LfoRequestFrame = (callback: LfoFrameCallback) => number;
export type LfoCancelFrame = (handle: number) => void;

export interface LfoControllerOptions extends LfoControllerConfig {
  /** Injectable monotonic clock, in seconds. */
  now?: () => number;
  /** Injectable animation scheduler. Defaults to a DOM-free timer. */
  requestFrame?: LfoRequestFrame;
  cancelFrame?: LfoCancelFrame;
  /** Receives authoritative run failures, including contained Promise rejects. */
  onError?: (error: unknown) => void;
}

type FrameStatus = 'requesting' | 'armed' | 'fired' | 'cancelled';

interface FrameOwner {
  generation: number;
  status: FrameStatus;
  handle?: number;
}

const DEFAULT_SHAPE: LfoShape = 'sine';
const DEFAULT_RATE = 1;
const DEFAULT_DEPTH = 0.6;
const MIN_RATE = 0.05;
const MAX_RATE = 12;

function finite(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : fallback;
}

function clamp(
  value: unknown,
  minimum: number,
  maximum: number,
  fallback: number,
): number {
  return Math.max(minimum, Math.min(maximum, finite(value, fallback)));
}

function clamp01(value: unknown, fallback = 0): number {
  return clamp(value, 0, 1, fallback);
}

function normalizeRate(value: unknown, fallback: number): number {
  return clamp(value, MIN_RATE, MAX_RATE, fallback);
}

function wrapPhase(value: unknown, fallback = 0): number {
  const phase = finite(value, fallback);
  return ((phase % 1) + 1) % 1;
}

function normalizeShape(
  shape: LfoShape | undefined,
  fallback: LfoShape,
): LfoShape {
  return (LFO_SHAPES as readonly string[]).includes(shape ?? '')
    ? (shape as LfoShape)
    : fallback;
}

function defaultNow(): number {
  return Date.now() / 1000;
}

function defaultRequestFrame(callback: LfoFrameCallback): number {
  return globalThis.setTimeout(() => callback(Date.now()), 16) as unknown as number;
}

function defaultCancelFrame(handle: number): void {
  globalThis.clearTimeout(handle);
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    ((typeof value === 'object' && value !== null) ||
      typeof value === 'function') &&
    typeof (value as {then?: unknown}).then === 'function'
  );
}

/** Pure waveform helper shared by standalone and composed LFO surfaces. */
export function lfoWave(shape: LfoShape, phase: number): number {
  switch (shape) {
    case 'triangle':
      return 4 * Math.abs(phase - 0.5) - 1;
    case 'square':
      return phase < 0.5 ? 1 : -1;
    case 'saw':
      return 2 * phase - 1;
    default:
      return Math.sin(phase * Math.PI * 2);
  }
}

/**
 * DOM-free low-frequency modulation controller.
 *
 * Normal frame order matches the legacy controls: advance phase from the
 * injected clock, read the latest borrowed target, apply x→domain modulation,
 * publish the new state, then arm the next frame. `stop()` is reusable and
 * retains phase/configuration; `destroy()` is final and never owns the target.
 */
export class LfoController {
  private shapeValue: LfoShape;
  private rateValue: number;
  private depthValue: number;
  private phaseValue: number;
  private runningValue = false;
  private targetValue?: LfoTarget;
  private readonly now: () => number;
  private readonly requestFrame: LfoRequestFrame;
  private readonly cancelFrame: LfoCancelFrame;
  private readonly onError?: (error: unknown) => void;
  private readonly subscribers = new Set<() => void>();
  private lastTime = 0;
  private runGeneration = 0;
  private targetGeneration = 0;
  private frameOwner?: FrameOwner;
  private destroyed = false;

  constructor(options: LfoControllerOptions = {}) {
    this.shapeValue = normalizeShape(options.shape, DEFAULT_SHAPE);
    this.rateValue = normalizeRate(options.rate, DEFAULT_RATE);
    this.depthValue = clamp01(options.depth, DEFAULT_DEPTH);
    this.phaseValue = wrapPhase(options.phase);
    this.targetValue = options.target;
    this.now = options.now ?? defaultNow;
    this.requestFrame = options.requestFrame ?? defaultRequestFrame;
    this.cancelFrame = options.cancelFrame ?? defaultCancelFrame;
    this.onError = options.onError;
  }

  snapshot(): LfoControllerState {
    return {
      shape: this.shapeValue,
      rate: this.rateValue,
      depth: this.depthValue,
      running: this.runningValue,
      phase: this.phaseValue,
    };
  }

  subscribe(notify: () => void): () => void {
    if (this.destroyed) return () => undefined;
    this.subscribers.add(notify);
    return () => this.subscribers.delete(notify);
  }

  /** Update state or hot-swap the borrowed target without applying it. */
  configure(config: LfoControllerConfig): void {
    if (this.destroyed) return;
    const hasTarget = Object.prototype.hasOwnProperty.call(config, 'target');
    const nextShape =
      config.shape === undefined
        ? this.shapeValue
        : normalizeShape(config.shape, this.shapeValue);
    const nextRate =
      config.rate === undefined
        ? this.rateValue
        : normalizeRate(config.rate, this.rateValue);
    const nextDepth =
      config.depth === undefined
        ? this.depthValue
        : clamp01(config.depth, this.depthValue);
    const nextPhase =
      config.phase === undefined
        ? this.phaseValue
        : wrapPhase(config.phase, this.phaseValue);
    const nextTarget = hasTarget ? config.target : this.targetValue;
    const changed =
      nextShape !== this.shapeValue ||
      nextRate !== this.rateValue ||
      nextDepth !== this.depthValue ||
      nextPhase !== this.phaseValue ||
      nextTarget !== this.targetValue;
    if (!changed) return;

    this.shapeValue = nextShape;
    this.rateValue = nextRate;
    this.depthValue = nextDepth;
    this.phaseValue = nextPhase;
    if (nextTarget !== this.targetValue) this.targetGeneration += 1;
    this.targetValue = nextTarget;
    this.emit();
  }

  setTarget(target: LfoTarget | undefined): void {
    this.configure({target});
  }

  setRunning(running: boolean): void {
    if (running) this.start();
    else this.stop();
  }

  start(): void {
    if (this.destroyed || this.runningValue) return;
    const generation = ++this.runGeneration;
    this.runningValue = true;
    try {
      this.lastTime = this.readNow(this.lastTime);
      if (!this.isCurrentRun(generation)) return;
      this.emit();
      if (!this.isCurrentRun(generation)) return;
      this.arm(generation);
    } catch (error) {
      this.rollbackFailedRun(generation);
      throw error;
    }
  }

  /** Stop the reusable run while retaining phase, shape, rate, depth and target. */
  stop(): void {
    if (this.destroyed || !this.runningValue) return;
    const generation = ++this.runGeneration;
    this.runningValue = false;
    let failure: unknown;
    let failed = false;
    try {
      this.cancelOwnedFrame();
    } catch (error) {
      failure = error;
      failed = true;
    }
    if (this.runGeneration === generation && !this.runningValue) {
      try {
        this.emit();
      } catch (error) {
        if (!failed) {
          failure = error;
          failed = true;
        }
      }
    }
    if (failed) throw failure;
  }

  /** Final, idempotent cleanup. The borrowed target is left untouched. */
  dispose(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.runGeneration += 1;
    this.runningValue = false;
    let failure: unknown;
    let failed = false;
    try {
      this.cancelOwnedFrame();
    } catch (error) {
      failure = error;
      failed = true;
    }
    this.subscribers.clear();
    if (failed) throw failure;
  }

  /** Alias for integrations whose lifecycle names final cleanup `destroy`. */
  destroy(): void {
    this.dispose();
  }

  private readonly onFrame = (owner: FrameOwner): void => {
    if (
      owner.status === 'cancelled' ||
      owner.status === 'fired' ||
      this.frameOwner !== owner ||
      !this.isCurrentRun(owner.generation)
    ) {
      return;
    }
    owner.status = 'fired';
    this.frameOwner = undefined;
    this.tick(owner.generation);
  };

  private tick(generation: number): void {
    if (!this.isCurrentRun(generation)) return;
    try {
      const time = this.readNow(this.lastTime);
      if (!this.isCurrentRun(generation)) return;
      const elapsed = Math.max(0, time - this.lastTime);
      this.phaseValue = wrapPhase(
        this.phaseValue + elapsed * this.rateValue,
        this.phaseValue,
      );
      this.lastTime = time;

      const target = this.targetValue;
      if (target) {
        const targetGeneration = this.targetGeneration;
        const min = finite(target.min);
        if (this.isCurrentTarget(generation, targetGeneration, target)) {
          const max = finite(target.max, min);
          if (this.isCurrentTarget(generation, targetGeneration, target)) {
            const center = (min + max) / 2;
            const amplitude = (this.depthValue * (max - min)) / 2;
            const pending = target.apply(
              center + lfoWave(this.shapeValue, this.phaseValue) * amplitude,
            ) as unknown;
            this.observeApply(
              pending,
              generation,
              targetGeneration,
              target,
            );
          }
        }
      }

      if (!this.isCurrentRun(generation)) return;
      this.emit();
      if (!this.isCurrentRun(generation)) return;
      this.arm(generation);
    } catch (error) {
      this.containFrameFailure(generation, error);
    }
  }

  private arm(generation: number): void {
    if (!this.isCurrentRun(generation)) return;
    const owner: FrameOwner = {generation, status: 'requesting'};
    this.frameOwner = owner;
    let handle: number;
    try {
      handle = this.requestFrame(() => this.onFrame(owner));
    } catch (error) {
      if (this.frameOwner === owner) this.frameOwner = undefined;
      throw error;
    }
    owner.handle = handle;

    if (owner.status === 'requesting') {
      owner.status = 'armed';
      if (this.frameOwner !== owner || !this.isCurrentRun(generation)) {
        this.cancelOwner(owner);
      }
      return;
    }
    if (owner.status === 'cancelled') this.cancelReturnedOwner(owner);
  }

  private cancelOwnedFrame(): void {
    const owner = this.frameOwner;
    if (!owner) return;
    this.frameOwner = undefined;
    this.cancelOwner(owner);
  }

  private cancelOwner(owner: FrameOwner): void {
    if (owner.status === 'cancelled' || owner.status === 'fired') return;
    if (this.frameOwner === owner) this.frameOwner = undefined;
    const wasRequesting = owner.status === 'requesting';
    owner.status = 'cancelled';
    if (!wasRequesting) this.cancelReturnedOwner(owner);
  }

  private cancelReturnedOwner(owner: FrameOwner): void {
    const handle = owner.handle;
    if (handle === undefined) return;
    // Clear before invoking caller code so re-entry can never cancel twice.
    owner.handle = undefined;
    this.cancelFrame(handle);
  }

  private isCurrentRun(generation: number): boolean {
    return (
      !this.destroyed &&
      this.runningValue &&
      this.runGeneration === generation
    );
  }

  private isCurrentTarget(
    runGeneration: number,
    targetGeneration: number,
    target: LfoTarget,
  ): boolean {
    return (
      this.isCurrentRun(runGeneration) &&
      this.targetGeneration === targetGeneration &&
      this.targetValue === target
    );
  }

  private readNow(fallback: number): number {
    return finite(this.now(), fallback);
  }

  private rollbackFailedRun(generation: number): void {
    if (!this.isCurrentRun(generation)) return;
    this.runningValue = false;
    const failureGeneration = ++this.runGeneration;
    try {
      this.cancelOwnedFrame();
    } catch {
      // The initiating synchronous failure remains authoritative.
    }
    if (!this.isCurrentFailure(failureGeneration)) return;
    try {
      this.emit();
    } catch {
      // The initiating synchronous failure remains authoritative.
    }
  }

  private containFrameFailure(generation: number, error: unknown): void {
    if (!this.isCurrentRun(generation)) return;
    this.runningValue = false;
    const failureGeneration = ++this.runGeneration;
    try {
      this.cancelOwnedFrame();
    } catch {
      // The frame failure remains authoritative.
    }
    if (this.isCurrentFailure(failureGeneration)) {
      try {
        this.emit();
      } catch {
        // The frame failure remains authoritative.
      }
    }
    if (this.isCurrentFailure(failureGeneration)) this.reportError(error);
  }

  private observeApply(
    pending: unknown,
    runGeneration: number,
    targetGeneration: number,
    target: LfoTarget,
  ): void {
    if (!isPromiseLike(pending)) return;
    void Promise.resolve(pending).then(
      () => undefined,
      (error: unknown) => {
        if (
          !this.isCurrentTarget(runGeneration, targetGeneration, target)
        ) {
          return;
        }
        this.containFrameFailure(runGeneration, error);
      },
    );
  }

  private isCurrentFailure(generation: number): boolean {
    return (
      !this.destroyed &&
      !this.runningValue &&
      this.runGeneration === generation
    );
  }

  private reportError(error: unknown): void {
    if (!this.onError) return;
    try {
      const pending = this.onError(error) as unknown;
      if (isPromiseLike(pending)) {
        void Promise.resolve(pending).then(
          () => undefined,
          () => undefined,
        );
      }
    } catch {
      // Error reporting is a terminal boundary and must not replace failures.
    }
  }

  private emit(): void {
    let failure: unknown;
    let failed = false;
    for (const notify of [...this.subscribers]) {
      if (this.destroyed || !this.subscribers.has(notify)) continue;
      try {
        notify();
      } catch (error) {
        if (!failed) {
          failure = error;
          failed = true;
        }
      }
    }
    if (failed) throw failure;
  }
}

export function createLfoController(
  options: LfoControllerOptions = {},
): LfoController {
  return new LfoController(options);
}
