import {createConnectionLease, type ConnectionLease} from './lease';
import {PortListeners, type PortMultiplicity, type PortReadiness} from './port';
import type {ParamHandle} from './parameter';

// ============================================================================
// The `message` port family (DEC-075): discrete values between objects, as in
// Max. A message is a selector and typed atoms with an optional logical time.
// Delivery is synchronous and depth first, inputs in connection order.
// ============================================================================

export type JsonValue = null | boolean | number | string | readonly JsonValue[] | {readonly [key: string]: JsonValue};

/** One element of a message. Ints and floats stay distinct, as in Max. */
export type Atom =
  | {readonly type: 'int'; readonly value: number}
  | {readonly type: 'float'; readonly value: number}
  | {readonly type: 'symbol'; readonly value: string}
  | {readonly type: 'dict'; readonly value: {readonly [key: string]: JsonValue}}
  | {readonly type: 'array'; readonly value: readonly JsonValue[]};

export interface Message {
  /** `bang`, `int`, `float`, `symbol`, `list`, or the leading word of any other message. */
  readonly selector: string;
  readonly atoms: readonly Atom[];
  /** Logical time in AudioContext seconds; absent for an untimed (immediate) event. */
  readonly time?: number;
}

const freezeAtoms = (atoms: readonly Atom[]): readonly Atom[] => Object.freeze(atoms.map(atom => Object.freeze({...atom})));

export function intAtom(value: number): Atom {
  if (!Number.isFinite(value)) throw new RangeError('An int atom requires a finite number.');
  return Object.freeze({type: 'int', value: Math.trunc(value)});
}
export function floatAtom(value: number): Atom {
  if (!Number.isFinite(value)) throw new RangeError('A float atom requires a finite number.');
  return Object.freeze({type: 'float', value});
}
export function symbolAtom(value: string): Atom {
  if (typeof value !== 'string') throw new TypeError('A symbol atom requires a string.');
  return Object.freeze({type: 'symbol', value});
}

/** A message with an explicit selector. */
export function message(selector: string, atoms: readonly Atom[] = [], time?: number): Message {
  if (typeof selector !== 'string' || !selector) throw new TypeError('A message requires a selector.');
  if (time !== undefined && !Number.isFinite(time)) throw new RangeError('Message time must be finite.');
  return Object.freeze({selector, atoms: freezeAtoms(atoms), ...(time === undefined ? {} : {time})});
}

export const bang = (time?: number): Message => message('bang', [], time);
export const intMessage = (value: number, time?: number): Message => message('int', [intAtom(value)], time);
export const floatMessage = (value: number, time?: number): Message => message('float', [floatAtom(value)], time);
export const symbolMessage = (value: string, time?: number): Message => message('symbol', [symbolAtom(value)], time);

/** A copy of `value` at `time` (or untimed when `time` is undefined). */
export function withTime(value: Message, time: number | undefined): Message {
  if (value.time === time) return value;
  return message(value.selector, value.atoms, time);
}

/**
 * The atoms a message carries, as a list would: a number, symbol or list
 * message gives its atoms; any other message gives its selector as a leading
 * symbol, then its atoms; a bang gives none.
 */
export function atomsOf(value: Message): readonly Atom[] {
  switch (value.selector) {
    case 'bang': return [];
    case 'int': case 'float': case 'symbol': case 'list': return value.atoms;
    default: return [symbolAtom(value.selector), ...value.atoms];
  }
}

/**
 * The message a list of atoms makes, as Max forms it: nothing is a bang, one
 * number is an int or float, a leading number makes a list, and a leading
 * symbol becomes the selector — alone, it is a message with no atoms.
 */
export function messageFromAtoms(atoms: readonly Atom[], time?: number): Message {
  if (!atoms.length) return bang(time);
  const [first, ...rest] = atoms;
  if (atoms.length === 1) {
    if (first.type === 'int') return message('int', atoms, time);
    if (first.type === 'float') return message('float', atoms, time);
    // A lone word is its own selector, as in Max: `stop` is the message stop, not `symbol stop`.
    if (first.type === 'symbol') return first.value === 'bang' ? bang(time) : message(first.value, [], time);
    return message('list', atoms, time);
  }
  if (first.type === 'symbol') return message(first.value, rest, time);
  return message('list', atoms, time);
}

/** The first number a message carries, or undefined. */
export function numberOf(value: Message): number | undefined {
  const atom = atomsOf(value).find(item => item.type === 'int' || item.type === 'float');
  return atom ? atom.value as number : undefined;
}

/** True for an int or float atom. */
export const isNumberAtom = (atom: Atom | undefined): atom is Extract<Atom, {type: 'int' | 'float'}> =>
  atom?.type === 'int' || atom?.type === 'float';

/** Parse one word of message-box text into an atom. */
export function parseAtom(word: string): Atom {
  if (/^[-+]?\d+$/.test(word)) return intAtom(Number(word));
  if (/^[-+]?(\d+\.\d*|\.\d+|\d+\.?\d*[eE][-+]?\d+)$/.test(word)) return floatAtom(Number(word));
  return symbolAtom(word);
}

/**
 * Parse message-box text: space-separated atoms; a double-quoted word keeps its
 * spaces. `parseMessage('set 3 4.5')` is a `set` message with an int and a float.
 */
export function parseMessage(text: string, time?: number): Message {
  const words: string[] = [];
  const pattern = /"((?:[^"\\]|\\.)*)"|(\S+)/g;
  const quoted = new Set<number>();
  for (const match of text.matchAll(pattern)) {
    if (match[1] !== undefined) { quoted.add(words.length); words.push(match[1].replace(/\\(.)/g, '$1')); }
    else words.push(match[2]!);
  }
  const atoms = words.map((word, index) => quoted.has(index) ? symbolAtom(word) : parseAtom(word));
  // One quoted word stays a symbol: `"two words"` is data, not a command.
  if (atoms.length === 1 && quoted.has(0)) return message('symbol', atoms, time);
  return messageFromAtoms(atoms, time);
}

const formatAtom = (atom: Atom): string => {
  switch (atom.type) {
    case 'int': return String(atom.value);
    case 'float': return Number.isInteger(atom.value) ? `${atom.value}.` : String(atom.value);
    case 'symbol': return /\s|^$/.test(atom.value) || /^[-+]?[\d.]/.test(atom.value) ? JSON.stringify(atom.value) : atom.value;
    default: return JSON.stringify(atom.value);
  }
};

/** Message-box text for a message; `parseMessage(formatMessage(m))` gives an equal message for int, float and symbol atoms. */
export function formatMessage(value: Message): string {
  return atomsOf(value).map(formatAtom).join(' ') || 'bang';
}

/** Raised when nested message deliveries exceed {@link MAX_MESSAGE_DEPTH}. */
export class MessageStackOverflowError extends Error {
  constructor() {
    super(`Message delivery nested deeper than ${MAX_MESSAGE_DEPTH}; a patch is probably feeding back into itself.`);
    this.name = 'MessageStackOverflowError';
  }
}

/** Nesting limit for synchronous deliveries, shared by every message port. */
export const MAX_MESSAGE_DEPTH = 512;
let depth = 0;

export interface MessageOutputPortOptions {
  id?: string;
  /** Receives a listener's failure and stack overflows; delivery continues to the next input. */
  onListenerError?: (error: unknown) => void;
}

/** Producer side of the message family. */
export class MessageOutputPort {
  readonly id: string;
  readonly family = 'message' as const;
  readonly direction = 'output' as const;
  readonly multiplicity = 'sum' as const;
  readonly schemaVersion = 1 as const;
  readonly #listeners: PortListeners<Message>;
  readonly #onError?: (error: unknown) => void;
  #disposed = false;

  constructor(options: MessageOutputPortOptions = {}) {
    this.id = options.id ?? 'outlet';
    this.#onError = options.onListenerError;
    this.#listeners = new PortListeners(options.onListenerError);
    Object.freeze(this);
  }

  get disposed(): boolean { return this.#disposed; }
  get readiness(): PortReadiness { return this.#disposed ? 'detached' : 'ready'; }

  /** Deliver to every connected input in connection order, each depth first. A disposed port drops the message. */
  send(value: Message): void {
    if (this.#disposed) return;
    if (depth >= MAX_MESSAGE_DEPTH) {
      try { this.#onError?.(new MessageStackOverflowError()); } catch { /* Diagnostics never re-enter delivery. */ }
      return;
    }
    depth++;
    try { this.#listeners.emit(value); } finally { depth--; }
  }

  subscribe(listener: (value: Message) => void): () => void {
    if (this.#disposed) throw new Error('MessageOutputPort is disposed');
    return this.#listeners.add(listener);
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#listeners.clear();
  }
}

export interface MessageInputPortOptions {
  id?: string;
  multiplicity?: PortMultiplicity;
}

/** Consumer side of the message family. */
export class MessageInputPort {
  readonly id: string;
  readonly family = 'message' as const;
  readonly direction = 'input' as const;
  readonly multiplicity: PortMultiplicity;
  readonly schemaVersion = 1 as const;
  readonly #handler: (value: Message) => void;
  readonly #connections = new Map<MessageOutputPort, ConnectionLease>();
  #disposed = false;

  constructor(handler: (value: Message) => void, options: MessageInputPortOptions = {}) {
    if (typeof handler !== 'function') throw new TypeError('Message input needs a handler.');
    const multiplicity = options.multiplicity ?? 'sum';
    if (multiplicity !== 'single' && multiplicity !== 'sum') throw new TypeError(`Unknown port multiplicity: ${String(multiplicity)}`);
    this.#handler = handler;
    this.id = options.id ?? 'inlet';
    this.multiplicity = multiplicity;
    Object.freeze(this);
  }

  get disposed(): boolean { return this.#disposed; }
  get readiness(): PortReadiness { return this.#disposed ? 'detached' : 'ready'; }
  get connectionCount(): number { return this.#connections.size; }

  /** Deliver a message directly, as an untimed or programmatic event. */
  receive(value: Message): void {
    if (this.#disposed) return;
    this.#handler(value);
  }

  /** Connect one output. Releasing the lease stops delivery from that output. */
  connect(source: MessageOutputPort): ConnectionLease {
    if (this.#disposed) throw new Error('MessageInputPort is disposed');
    if (!(source instanceof MessageOutputPort) || source.disposed) throw new TypeError('A message input connects to a live message output.');
    if (this.#connections.has(source)) throw new Error('That message output is already connected to this input.');
    if (this.multiplicity === 'single' && this.#connections.size) throw new Error('This message input accepts one connection.');
    const unsubscribe = source.subscribe(value => this.receive(value));
    const lease = createConnectionLease(() => {
      unsubscribe();
      this.#connections.delete(source);
    });
    this.#connections.set(source, lease);
    return lease;
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    for (const lease of [...this.#connections.values()]) lease.release();
    this.#connections.clear();
  }
}

// ----------------------------------------------------------------------------
// Clocks: timed events are delivered ahead of their time and carry it.
// ----------------------------------------------------------------------------

/** Schedules timed message events on an AudioContext-seconds axis. */
export interface MessageClock {
  /** Current time on the clock's axis. */
  now(): number;
  /** Call `callback(time)` once, no later than `time` and at most the clock's lookahead early. Returns a cancel function. */
  schedule(time: number, callback: (time: number) => void): () => void;
}

interface ScheduledEvent { time: number; order: number; callback: (time: number) => void; cancelled: boolean }

/** How deep the message being delivered now is: 0 outside delivery, 1 for a first send. */
export function currentMessageDepth(): number { return depth; }

/** Shared queue logic for clocks: events run in time order, then scheduling order. */
abstract class QueueClock implements MessageClock {
  readonly #events: ScheduledEvent[] = [];
  #order = 0;
  #running = false;
  protected readonly onError?: (error: unknown) => void;

  constructor(onError?: (error: unknown) => void) { this.onError = onError; }

  abstract now(): number;

  schedule(time: number, callback: (time: number) => void): () => void {
    if (!Number.isFinite(time)) throw new RangeError('A clock event requires a finite time.');
    if (typeof callback !== 'function') throw new TypeError('A clock event requires a callback.');
    const event: ScheduledEvent = {time, order: this.#order++, callback, cancelled: false};
    let index = this.#events.length;
    while (index > 0 && (this.#events[index - 1]!.time > time)) index--;
    // New events keep time order while held; resume shifts them with the rest.
    this.#events.splice(index, 0, event);
    this.wake();
    return () => { event.cancelled = true; };
  }

  #heldAt: number | undefined;

  /** True while the clock holds its events (a debugger's break). */
  get held(): boolean { return this.#heldAt !== undefined; }

  /**
   * Stop delivering scheduled events; they stay queued. The event running now
   * finishes its depth-first delivery first. Untimed messages still flow.
   */
  hold(): void { if (this.#heldAt === undefined) this.#heldAt = this.now(); }

  /**
   * Deliver again. Held events move later by the time spent holding, so a
   * metro resumes its rhythm instead of catching up in a burst.
   */
  resume(): void {
    const heldAt = this.#heldAt;
    if (heldAt === undefined) return;
    this.#heldAt = undefined;
    const shift = Math.max(0, this.now() - heldAt);
    for (const event of this.#events) event.time += shift;
    this.wake();
  }

  /** While held, deliver the next queued event now; false when none is queued. */
  step(): boolean {
    if (this.#heldAt === undefined || this.#running) return false;
    let event: ScheduledEvent | undefined;
    while ((event = this.#events.shift()) && event.cancelled);
    if (!event) return false;
    this.#running = true;
    try { event.callback(this.now()); } catch (error) { try { this.onError?.(error); } catch { /* Keep the clock running. */ } }
    finally { this.#running = false; }
    // Time passes while stepping; events made since keep their places relative to now.
    this.#heldAt = this.now();
    return true;
  }

  /** Run every event due by `horizon`, including events they schedule within it. */
  protected flush(horizon: number): void {
    if (this.#running || this.#heldAt !== undefined) return;
    this.#running = true;
    try {
      // A break during delivery holds the rest of the queue.
      while (this.#heldAt === undefined && this.#events.length && this.#events[0]!.time <= horizon) {
        const event = this.#events.shift()!;
        if (event.cancelled) continue;
        try { event.callback(event.time); } catch (error) { try { this.onError?.(error); } catch { /* Keep the clock running. */ } }
      }
    } finally { this.#running = false; }
  }

  protected get pending(): number { return this.#events.filter(event => !event.cancelled).length; }
  protected wake(): void {}
}

/** A clock advanced by hand, for tests and offline rendering. */
export class ManualMessageClock extends QueueClock {
  #now: number;
  constructor(start = 0, onError?: (error: unknown) => void) { super(onError); this.#now = start; }
  now(): number { return this.#now; }
  /** Move to `time`, running every event due by then in order. */
  advance(time: number): void {
    if (!Number.isFinite(time) || time < this.#now) throw new RangeError('A manual clock only moves forward.');
    this.#now = time;
    this.flush(time);
  }
  get pendingEvents(): number { return this.pending; }
}

export interface AudioMessageClockOptions {
  /** How early events are delivered, in seconds. Defaults to 0.05. */
  readonly lookahead?: number;
  /** Polling period in milliseconds. Defaults to 15. */
  readonly interval?: number;
  readonly onError?: (error: unknown) => void;
}

/** A clock on an AudioContext's `currentTime`, polled on the main thread while events are pending. */
export class AudioMessageClock extends QueueClock {
  readonly context: BaseAudioContext;
  readonly lookahead: number;
  readonly #interval: number;
  #timer?: ReturnType<typeof setInterval>;
  #disposed = false;

  constructor(context: BaseAudioContext, options: AudioMessageClockOptions = {}) {
    super(options.onError);
    this.context = context;
    this.lookahead = options.lookahead ?? 0.05;
    this.#interval = options.interval ?? 15;
    if (!(this.lookahead >= 0) || !(this.#interval > 0)) throw new RangeError('Clock lookahead and interval must be positive.');
  }

  now(): number { return this.context.currentTime; }

  protected override wake(): void {
    if (this.#disposed || this.#timer !== undefined) return;
    this.#timer = setInterval(() => this.#tick(), this.#interval);
    queueMicrotask(() => this.#tick());
  }

  #tick(): void {
    if (this.#disposed) return;
    this.flush(this.now() + this.lookahead);
    if (!this.pending && this.#timer !== undefined) { clearInterval(this.#timer); this.#timer = undefined; }
  }

  dispose(): void {
    this.#disposed = true;
    if (this.#timer !== undefined) clearInterval(this.#timer);
    this.#timer = undefined;
  }
}

const sharedClocks = new WeakMap<BaseAudioContext, AudioMessageClock>();

/** The one shared message clock of an AudioContext. */
export function messageClockFor(context: BaseAudioContext): AudioMessageClock {
  let clock = sharedClocks.get(context);
  if (!clock) { clock = new AudioMessageClock(context); sharedClocks.set(context, clock); }
  return clock;
}

/**
 * Set a parameter's base value from each message's first number, clamped to
 * its legal range, at the message's time: an untimed message applies at once,
 * a timed one on a main-thread timer when it falls due. Releasing the lease
 * stops delivery and drops pending timed values.
 */
export function connectMessageToParameter(source: MessageOutputPort, handle: ParamHandle, context: BaseAudioContext): ConnectionLease {
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const {min, max} = handle.descriptor.range;
  const apply = (value: number) => {
    if (handle.snapshot.disposed) return;
    handle.setBaseValue(Math.min(max, Math.max(min, value)));
  };
  const unsubscribe = source.subscribe(value => {
    const number = numberOf(value);
    if (number === undefined) return;
    const wait = value.time === undefined ? 0 : value.time - context.currentTime;
    if (wait <= 0.002) { apply(number); return; }
    const timer = setTimeout(() => { timers.delete(timer); apply(number); }, wait * 1000);
    timers.add(timer);
  });
  return createConnectionLease(() => {
    unsubscribe();
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
  });
}
