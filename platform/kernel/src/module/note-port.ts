import {createConnectionLease, type ConnectionLease} from './lease';
import {PortListeners, type PortMultiplicity, type PortReadiness} from './port';

/** MIDI note number plus an optional detune; no other pitch unit is implied. */
export interface NotePitch {
  readonly midi: number;
  readonly cents?: number;
}

/**
 * One gate change of one note occurrence. `off` and `cancel` target the
 * occurrence, never "whatever plays this pitch": two sources may hold the same
 * pitch at once, and releasing one must not release the other.
 */
export interface NoteEvent {
  readonly occurrenceId: string;
  readonly sourceId: string;
  readonly pitch: NotePitch;
  /** Normalized 0–1. Ignored by `off`/`cancel` consumers that do not use release velocity. */
  readonly velocity: number;
  /** `cancel` withdraws scheduled or sounding work without a release phase. */
  readonly gate: 'on' | 'off' | 'cancel';
  /** Named time axis of `time`, for example `audio-context-seconds` or `session-seconds`. */
  readonly axis: string;
  readonly time: number;
  /** Scheduling epoch the event was produced in; consumers drop stale epochs. */
  readonly epoch: number;
}

function nonempty(value: unknown, name: string): void {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${name} must be a nonempty string`);
}

/** Reject malformed events before any consumer sees them. */
export function assertNoteEvent(event: NoteEvent): void {
  if (!event || typeof event !== 'object') throw new TypeError('Note event must be an object');
  nonempty(event.occurrenceId, 'occurrenceId');
  nonempty(event.sourceId, 'sourceId');
  nonempty(event.axis, 'axis');
  const {midi, cents} = event.pitch ?? ({} as NotePitch);
  if (!Number.isFinite(midi) || midi < 0 || midi > 127) throw new RangeError('pitch.midi must be within 0–127');
  if (cents !== undefined && !Number.isFinite(cents)) throw new RangeError('pitch.cents must be finite');
  if (!Number.isFinite(event.velocity) || event.velocity < 0 || event.velocity > 1) throw new RangeError('velocity must be within 0–1');
  if (event.gate !== 'on' && event.gate !== 'off' && event.gate !== 'cancel') throw new TypeError(`Unknown note gate: ${String(event.gate)}`);
  if (!Number.isFinite(event.time)) throw new RangeError('time must be finite');
  if (!Number.isInteger(event.epoch) || event.epoch < 0) throw new RangeError('epoch must be a nonnegative integer');
}

export interface NoteOutputPortOptions {
  id?: string;
  onListenerError?: (error: unknown) => void;
}

/**
 * Producer side of the note family. It tracks held occurrences so that a
 * disconnect or disposal can release exactly what this producer started.
 */
export class NoteOutputPort {
  readonly id: string;
  readonly family = 'note' as const;
  readonly direction = 'output' as const;
  readonly multiplicity = 'sum' as const;
  readonly schemaVersion = 1 as const;
  readonly #listeners: PortListeners<NoteEvent>;
  readonly #held = new Map<string, NoteEvent>();
  #disposed = false;

  constructor(options: NoteOutputPortOptions = {}) {
    this.id = options.id ?? 'notes';
    this.#listeners = new PortListeners(options.onListenerError);
    Object.freeze(this);
  }

  get disposed(): boolean { return this.#disposed; }
  get readiness(): PortReadiness { return this.#disposed ? 'detached' : 'ready'; }
  /** Occurrences whose `on` has not yet been followed by `off` or `cancel`. */
  get held(): readonly NoteEvent[] { return Object.freeze([...this.#held.values()]); }

  /** Commit the gate change, then notify. An `off`/`cancel` for an unknown occurrence is rejected. */
  emit(event: NoteEvent): void {
    if (this.#disposed) throw new Error('NoteOutputPort is disposed');
    assertNoteEvent(event);
    const frozen = Object.freeze({...event, pitch: Object.freeze({...event.pitch})});
    if (frozen.gate === 'on') {
      if (this.#held.has(frozen.occurrenceId)) throw new Error(`Note occurrence is already held: ${frozen.occurrenceId}`);
      this.#held.set(frozen.occurrenceId, frozen);
    } else if (!this.#held.delete(frozen.occurrenceId)) {
      throw new Error(`Unknown note occurrence: ${frozen.occurrenceId}`);
    }
    this.#listeners.emit(frozen);
  }

  subscribe(listener: (event: NoteEvent) => void): () => void {
    if (this.#disposed) throw new Error('NoteOutputPort is disposed');
    return this.#listeners.add(listener);
  }

  /** Cancel every held occurrence at `time` on its own axis, then detach all consumers. */
  dispose(time?: number): void {
    if (this.#disposed) return;
    for (const event of [...this.#held.values()]) {
      this.emit({...event, gate: 'cancel', time: time ?? event.time});
    }
    this.#disposed = true;
    this.#listeners.clear();
  }
}

/** What an instrument or note sink does with admitted events. */
export interface NoteInputHandler {
  accept(event: NoteEvent): void;
}

export interface NoteInputPortOptions {
  id?: string;
  multiplicity?: PortMultiplicity;
}

/**
 * Consumer side of the note family. Each connection remembers the occurrences
 * it delivered, so releasing the connection cancels only those.
 */
export class NoteInputPort {
  readonly id: string;
  readonly family = 'note' as const;
  readonly direction = 'input' as const;
  readonly multiplicity: PortMultiplicity;
  readonly schemaVersion = 1 as const;
  readonly #handler: NoteInputHandler;
  readonly #connections = new Map<NoteOutputPort, ConnectionLease>();
  #disposed = false;

  constructor(handler: NoteInputHandler, options: NoteInputPortOptions = {}) {
    if (!handler || typeof handler.accept !== 'function') throw new TypeError('Note input needs a handler with accept()');
    const multiplicity = options.multiplicity ?? 'sum';
    if (multiplicity !== 'single' && multiplicity !== 'sum') throw new TypeError(`Unknown port multiplicity: ${String(multiplicity)}`);
    this.#handler = handler;
    this.id = options.id ?? 'notes';
    this.multiplicity = multiplicity;
    Object.freeze(this);
  }

  get disposed(): boolean { return this.#disposed; }
  get readiness(): PortReadiness { return this.#disposed ? 'detached' : 'ready'; }
  get producers(): readonly NoteOutputPort[] { return Object.freeze([...this.#connections.keys()]); }

  /** Deliver one event directly, for a producer that is not a port (for example a test or a UI). */
  accept(event: NoteEvent): void {
    if (this.#disposed) throw new Error('NoteInputPort is disposed');
    assertNoteEvent(event);
    this.#handler.accept(event);
  }

  connect(output: NoteOutputPort): ConnectionLease {
    if (this.#disposed) throw new Error('NoteInputPort is disposed');
    if (output.disposed) throw new Error('NoteOutputPort is disposed');
    if (this.#connections.has(output)) throw new Error(`Note output is already connected to input: ${this.id}`);
    if (this.multiplicity === 'single' && this.#connections.size > 0) {
      throw new Error(`Note input accepts a single producer: ${this.id}`);
    }
    const delivered = new Map<string, NoteEvent>();
    const unsubscribe = output.subscribe((event) => {
      if (!lease.active) return;
      if (event.gate === 'on') delivered.set(event.occurrenceId, event);
      else if (!delivered.delete(event.occurrenceId)) return;
      this.#handler.accept(event);
    });
    const lease = createConnectionLease(() => {
      if (this.#connections.get(output) === lease) this.#connections.delete(output);
      unsubscribe();
      let failure: unknown;
      for (const event of [...delivered.values()]) {
        try { this.#handler.accept({...event, gate: 'cancel'}); } catch (error) { failure ??= error; }
      }
      delivered.clear();
      if (failure !== undefined) throw failure;
    });
    this.#connections.set(output, lease);
    return lease;
  }

  /** Release every connection; each cancels only the occurrences it delivered. */
  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    let failure: unknown;
    for (const lease of [...this.#connections.values()]) {
      try { lease.release(); } catch (error) { failure ??= error; }
    }
    this.#connections.clear();
    if (failure !== undefined) throw failure;
  }
}
