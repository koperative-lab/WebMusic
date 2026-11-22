import type {Message} from './message';
import type {NoteEvent} from './note-port';
import type {ProjectEndpoint} from './project-types';

// ============================================================================
// Observing a running project (DEC-078), as Max's probes, watchpoints and
// console: what crosses each cord, without changing what is delivered or when.
// ============================================================================

interface ProbeEventBase {
  /** The project connection the value crossed. */
  readonly connectionId: string;
  readonly from: ProjectEndpoint;
  readonly to: ProjectEndpoint;
  /** Increases by one per observed delivery of the runtime, in delivery order. */
  readonly sequence: number;
}

/** A message about to be delivered along a message cord. */
export interface MessageProbeEvent extends ProbeEventBase {
  readonly kind: 'message';
  readonly message: Message;
  /** Nesting of the delivery: 1 for a message sent from outside any delivery. */
  readonly depth: number;
}

/** A note event about to be delivered along a note cord. */
export interface NoteProbeEvent extends ProbeEventBase {
  readonly kind: 'note';
  readonly event: NoteEvent;
}

export type ProbeEvent = MessageProbeEvent | NoteProbeEvent;

/** A signal probe: an analyser that listens to one output across rebuilds. */
export interface SignalProbe {
  /** Owned by the probe; read it, never connect it elsewhere. */
  readonly analyser: AnalyserNode;
  /** True while the endpoint exists in the active graph and the analyser hears it. */
  readonly connected: boolean;
  release(): void;
}

/** What a debugger needs from a runtime. */
export interface ObservableRuntime {
  observe(listener: (event: ProbeEvent) => void): () => void;
}

/** What a debugger needs from a message clock: `AudioMessageClock` and `ManualMessageClock` fit. */
export interface HoldableClock {
  readonly held: boolean;
  hold(): void;
  resume(): void;
  step(): boolean;
}

export interface Watchpoint {
  readonly id: string;
  readonly connectionId: string;
  /** `trace` reports each hit; `break` also holds the message clock. */
  readonly mode: 'trace' | 'break';
  /** Hit only when this returns true; every message hits without one. */
  readonly condition?: (event: ProbeEvent) => boolean;
}

export interface WatchpointHit {
  readonly watchpoint: Watchpoint;
  readonly event: ProbeEvent;
}

/**
 * Watchpoints over a runtime's cords. A `break` hit holds the message clock
 * after the delivery in progress, so timed objects stop while audio keeps
 * running; `continue()` resumes and `step()` delivers one held event. Ownership:
 * the debugger observes the runtime and borrows the clock; `dispose` releases
 * the observation and resumes a clock it held.
 */
export class MessageDebugger {
  readonly #clock: HoldableClock;
  readonly #watchpoints = new Map<string, Watchpoint>();
  readonly #listeners = new Set<(hit: WatchpointHit) => void>();
  readonly #stop: () => void;
  #holding = false;
  #last?: WatchpointHit;
  #disposed = false;

  constructor(runtime: ObservableRuntime, clock: HoldableClock) {
    this.#clock = clock;
    this.#stop = runtime.observe(event => this.#check(event));
  }

  get watchpoints(): readonly Watchpoint[] { return [...this.#watchpoints.values()]; }
  /** True while a break holds the clock. */
  get paused(): boolean { return this.#holding && this.#clock.held; }
  /** The latest hit, for a debugger view. */
  get lastHit(): WatchpointHit | undefined { return this.#last; }

  set(watchpoint: Watchpoint): void {
    if (this.#disposed) throw new Error('The debugger is disposed.');
    if (watchpoint.mode !== 'trace' && watchpoint.mode !== 'break') throw new TypeError('A watchpoint traces or breaks.');
    this.#watchpoints.set(watchpoint.id, Object.freeze({...watchpoint}));
  }

  remove(id: string): void { this.#watchpoints.delete(id); }

  onHit(listener: (hit: WatchpointHit) => void): () => void {
    this.#listeners.add(listener);
    return () => { this.#listeners.delete(listener); };
  }

  continue(): void {
    if (!this.#holding) return;
    this.#holding = false;
    this.#clock.resume();
  }

  /** Deliver one held event; false when none is waiting. */
  step(): boolean { return this.paused ? this.#clock.step() : false; }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#stop();
    this.continue();
    this.#listeners.clear();
    this.#watchpoints.clear();
  }

  #check(event: ProbeEvent): void {
    for (const watchpoint of this.#watchpoints.values()) {
      if (watchpoint.connectionId !== event.connectionId) continue;
      let hit: boolean;
      try { hit = watchpoint.condition ? watchpoint.condition(event) === true : true; } catch { hit = false; }
      if (!hit) continue;
      const found = Object.freeze({watchpoint, event});
      this.#last = found;
      if (watchpoint.mode === 'break' && !this.#clock.held) { this.#holding = true; this.#clock.hold(); }
      for (const listener of [...this.#listeners]) { try { listener(found); } catch { /* A view cannot stop delivery. */ } }
    }
  }
}
