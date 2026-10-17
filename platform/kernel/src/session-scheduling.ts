import type {TransportClockReader} from './transport';
import type {SyncLoopRegion, TransportCommand} from './sync';

export interface SessionSchedulingSnapshot {
  readonly epoch: number;
  readonly phase: 'invalidated' | 'ready' | 'disposed';
  readonly referenceTime: number;
  readonly originTime: number;
  readonly originPosition: number;
  readonly rate: number;
  readonly paused: boolean;
  readonly holding: boolean;
  readonly loop: Readonly<SyncLoopRegion> | null;
}

export interface SessionScheduleSegment {
  readonly epoch: number;
  /** Zero includes the intro and first pass; later loop passes increment it. */
  readonly iteration: number;
  readonly referenceStart: number;
  readonly referenceEnd: number;
  readonly positionStart: number;
  readonly positionEnd: number;
  readonly rate: number;
}

export interface SessionSchedulingEvent {
  readonly type: 'invalidate' | 'anchor' | 'dispose';
  readonly snapshot: SessionSchedulingSnapshot;
  readonly cause?: TransportCommand['type'];
}

/** A borrowed read-only view of one authority, mapped into one named local axis. */
export interface SessionSchedulingBinding {
  readonly authority: object;
  readonly axis: string;
  readonly epoch: number;
  /** Continuous unwrapped position; use segments to schedule wrapped passes. */
  readonly clock: TransportClockReader;
  readonly snapshot: SessionSchedulingSnapshot;
  positionAt(referenceTime: number): number;
  segments(fromReferenceTime: number, toReferenceTime: number): readonly SessionScheduleSegment[];
  /** Initial delivery is synchronous. Scheduling callbacks must be synchronous. */
  subscribe(listener: (event: SessionSchedulingEvent) => void): () => void;
}

interface BindingRecord {
  binding: SessionSchedulingBinding;
  alive: boolean;
  listeners: Set<(event: SessionSchedulingEvent) => void>;
}

/** Internal write side, owned only by SessionTransport. */
export class SessionSchedulingAuthority {
  readonly identity = Object.freeze({});
  private generation = 0;
  private cause?: TransportCommand['type'];
  private phase: SessionSchedulingSnapshot['phase'] = 'ready';
  private readonly records = new Set<BindingRecord>();

  constructor(private readonly clock: TransportClockReader, private readonly now: () => number,
    private readonly loop: () => Readonly<SyncLoopRegion> | null) {}

  get epoch(): number { return this.generation; }

  createBinding(axis: string, offset = 0, scale = 1): SessionSchedulingBinding {
    if (!axis.trim() || !Number.isFinite(offset) || !Number.isFinite(scale) || scale <= 0) throw new RangeError('Scheduling binding requires an axis and finite affine mapping with positive scale.');
    const owner = () => this;
    const mapped: TransportClockReader = Object.freeze({
      get state() { const state = owner().clock.state; return Object.freeze({...state, paused: !record.alive || state.paused, originPosition: offset + state.originPosition * scale, rate: state.rate * scale}); },
      get rate() { return owner().clock.rate * scale; },
      get paused() { return !record.alive || owner().clock.paused; },
      get holding() { return owner().clock.holding; },
      positionAt: (time: number) => offset + owner().clock.positionAt(time) * scale,
      timeAt: (position: number) => owner().clock.timeAt((position - offset) / scale),
    });
    const snapshot = (): SessionSchedulingSnapshot => {
      const state = mapped.state, loop = owner().loop();
      return Object.freeze({...state, epoch: owner().generation,
        phase: record.alive ? owner().phase : 'disposed', referenceTime: owner().now(),
        paused: mapped.paused, holding: mapped.holding,
        loop: loop ? Object.freeze({startSeconds: offset + loop.startSeconds * scale, endSeconds: offset + loop.endSeconds * scale}) : null});
    };
    const binding: SessionSchedulingBinding = Object.freeze({
      authority: this.identity, axis,
      get epoch() { return owner().generation; },
      clock: mapped,
      get snapshot() { return snapshot(); },
      positionAt(time: number) { return fold(mapped.positionAt(time), snapshot().loop); },
      segments(from: number, to: number): readonly SessionScheduleSegment[] {
        if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) throw new RangeError('Scheduling windows require finite ordered reference times.');
        const state = snapshot();
        if (state.phase !== 'ready' || state.paused || from === to) return Object.freeze([]);
        let start = Math.max(from, state.holding ? state.originTime : from);
        if (start >= to) return Object.freeze([]);
        const results: SessionScheduleSegment[] = [];
        const loop = state.loop;
        const raw = mapped.positionAt(start);
        const period = loop ? loop.endSeconds - loop.startSeconds : 0;
        let iteration = loop && raw >= loop.endSeconds ? Math.floor((raw - loop.startSeconds) / period) : 0;
        let position = loop ? raw - iteration * period : raw;
        while (start < to) {
          if (results.length >= 10000) throw new RangeError('Scheduling window exceeds 10000 loop segments; request a smaller window.');
          // Compute every boundary from the unchanged authority anchor. Adding
          // durations then folding the accumulated position can leave a value
          // one ULP below a boundary and create a spurious zero-length pass.
          let boundary = loop ? state.originTime + (loop.endSeconds + iteration * period - state.originPosition) / state.rate : Infinity;
          if (loop && boundary <= start) {
            iteration++;
            position = loop.startSeconds;
            boundary = state.originTime + (loop.endSeconds + iteration * period - state.originPosition) / state.rate;
          }
          const end = Math.min(to, boundary);
          if (!(end > start)) throw new RangeError('Loop is too small for the reference-clock precision.');
          results.push(Object.freeze({epoch: state.epoch, iteration, referenceStart: start, referenceEnd: end,
            positionStart: position, positionEnd: end === boundary && loop ? loop.endSeconds : position + (end - start) * state.rate, rate: state.rate}));
          start = end;
          if (loop && end === boundary) {
            iteration++;
            position = loop.startSeconds;
          }
        }
        return Object.freeze(results);
      },
      subscribe(listener: (event: SessionSchedulingEvent) => void): () => void {
        if (!record.alive || owner().phase === 'disposed') throw new Error('Scheduling binding is disposed.');
        const registration = (event: SessionSchedulingEvent) => listener(event);
        record.listeners.add(registration);
        try { deliver(registration, {type: owner().phase === 'invalidated' ? 'invalidate' : 'anchor', snapshot: snapshot(), cause: owner().cause}); }
        catch (error) { record.listeners.delete(registration); throw error; }
        return () => { record.listeners.delete(registration); };
      },
    });
    const record: BindingRecord = {binding, alive: true, listeners: new Set()};
    this.records.add(record);
    return binding;
  }

  invalidate(cause?: TransportCommand['type']): void {
    if (this.phase === 'disposed') return;
    ++this.generation;
    this.cause = cause;
    this.phase = 'invalidated';
    this.publish('invalidate');
  }

  anchor(): void {
    if (this.phase === 'disposed') return;
    this.phase = 'ready';
    this.publish('anchor');
  }

  release(binding: SessionSchedulingBinding): void {
    const record = [...this.records].find(candidate => candidate.binding === binding);
    if (!record || !record.alive) return;
    record.alive = false;
    this.records.delete(record);
    try { this.publishRecord(record, 'dispose', this.generation); } finally { record.listeners.clear(); }
  }

  dispose(): void {
    if (this.phase === 'disposed') return;
    ++this.generation;
    this.phase = 'disposed';
    let failure: unknown;
    for (const record of [...this.records]) {
      try { this.release(record.binding); } catch (error) { failure ??= error; }
    }
    if (failure) throw failure;
  }

  private publish(type: SessionSchedulingEvent['type']): void {
    const epoch = this.generation;
    let failure: unknown;
    for (const record of [...this.records]) {
      if (epoch !== this.generation) break;
      if (!record.alive) continue;
      try { this.publishRecord(record, type, epoch); } catch (error) { failure ??= error; }
    }
    if (failure) throw failure;
  }

  private publishRecord(record: BindingRecord, type: SessionSchedulingEvent['type'], epoch: number): void {
    const event = Object.freeze({type, snapshot: record.binding.snapshot, cause: this.cause});
    let failure: unknown;
    for (const listener of [...record.listeners]) {
      // A released record can never receive another event. Finish terminal
      // cancellation even if an earlier listener sends a new Session command.
      if (type !== 'dispose' && epoch !== this.generation) break;
      if (!record.listeners.has(listener)) continue;
      try { deliver(listener, event); } catch (error) { failure ??= error; }
    }
    if (failure) throw failure;
  }
}

function deliver(listener: (event: SessionSchedulingEvent) => void, event: SessionSchedulingEvent): void {
  const result: unknown = listener(event);
  if (result && typeof (result as PromiseLike<unknown>).then === 'function') {
    void Promise.resolve(result).catch(() => {});
    throw new TypeError('Scheduling callbacks must complete synchronously.');
  }
}

function fold(position: number, loop: Readonly<SyncLoopRegion> | null): number {
  if (!loop || position < loop.endSeconds) return position;
  return loop.startSeconds + (position - loop.startSeconds) % (loop.endSeconds - loop.startSeconds);
}
