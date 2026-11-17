import {
  MessageInputPort, MessageOutputPort, assertModuleId, atomsOf, floatAtom, intAtom, isNumberAtom, message,
  type Message, type ModuleHandle, type ModulePort,
} from '@webmusic/kernel/module';
import type {MidiInputLike} from './inputs';
import type {MidiOutputLike} from './sounds/contracts';

// ============================================================================
// MIDI clock and raw MIDI output (DEC-077): follow or drive another device's
// tempo with 24 pulses per quarter note, Start, Stop, Continue and Song
// Position; send control changes, bends, program changes and system
// exclusive from messages.
// ============================================================================

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
export const MIDI_CLOCK_PPQ = 24;

export interface MidiClockSourceOptions {
  id?: string;
  /** Clock pulses averaged for the tempo estimate. Default 24 (one beat). */
  smoothing?: number;
}

/**
 * A Web MIDI input's clock as messages on its `clock` port: `start`, `stop`,
 * `continue`, `position sixteenths`, `beat n` on every quarter note and
 * `tempo bpm` as the pulses settle.
 */
export class MidiClockSource implements ModuleHandle {
  readonly id: string;
  readonly clock: MessageOutputPort;
  readonly #input: MidiInputLike;
  readonly #previous: MidiInputLike['onmidimessage'];
  readonly #handler: NonNullable<MidiInputLike['onmidimessage']>;
  readonly #ports: readonly ModulePort[];
  readonly #pulses: number[] = [];
  readonly #smoothing: number;
  #count = 0;
  #bpm = 0;
  #running = false;
  #disposed = false;

  constructor(input: MidiInputLike, options: MidiClockSourceOptions = {}) {
    this.id = options.id ?? 'midi-clock';
    assertModuleId(this.id);
    this.#smoothing = Math.max(2, Math.trunc(options.smoothing ?? MIDI_CLOCK_PPQ));
    this.#input = input;
    this.clock = new MessageOutputPort({id: 'clock'});
    this.#ports = Object.freeze([this.clock]);
    this.#previous = input.onmidimessage;
    this.#handler = event => this.#receive(event.data, (event as {timeStamp?: number}).timeStamp);
    input.onmidimessage = this.#handler;
  }

  ports(): readonly ModulePort[] { return this.#ports; }
  /** The tempo the pulses show, in quarter notes per minute; 0 before enough pulses. */
  get bpm(): number { return this.#bpm; }
  get running(): boolean { return this.#running; }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    if (this.#input.onmidimessage === this.#handler) this.#input.onmidimessage = this.#previous;
    this.clock.dispose();
  }

  #receive(data: Uint8Array | number[], timeStamp?: number): void {
    if (this.#disposed || !data.length) return;
    switch (data[0]) {
      case 0xf8: {
        const time = timeStamp ?? now();
        this.#pulses.push(time);
        if (this.#pulses.length > this.#smoothing + 1) this.#pulses.shift();
        if (this.#pulses.length > this.#smoothing / 2) {
          const span = (this.#pulses[this.#pulses.length - 1]! - this.#pulses[0]!) / (this.#pulses.length - 1);
          const bpm = span > 0 ? 60000 / (span * MIDI_CLOCK_PPQ) : 0;
          if (bpm && Math.abs(bpm - this.#bpm) >= 0.05) { this.#bpm = bpm; this.clock.send(message('tempo', [floatAtom(Math.round(bpm * 100) / 100)])); }
        }
        if (this.#running && this.#count++ % MIDI_CLOCK_PPQ === 0) this.clock.send(message('beat', [intAtom(Math.floor((this.#count - 1) / MIDI_CLOCK_PPQ) + 1)]));
        return;
      }
      case 0xfa: this.#running = true; this.#count = 0; this.clock.send(message('start', [])); return;
      case 0xfb: this.#running = true; this.clock.send(message('continue', [])); return;
      case 0xfc: this.#running = false; this.clock.send(message('stop', [])); return;
      case 0xf2:
        if (data.length >= 3) {
          const sixteenths = (data[2]! & 0x7f) << 7 | (data[1]! & 0x7f);
          this.#count = sixteenths * (MIDI_CLOCK_PPQ / 4);
          this.clock.send(message('position', [intAtom(sixteenths)]));
        }
    }
  }
}

/** What a clock sink follows: a tempo, whether it plays, and its position in seconds. */
export interface MidiClockTransport {
  tempo(): {bpm: number};
  playing(): boolean;
  position(): number;
  subscribe(listener: () => void): () => void;
}

export interface MidiClockSinkOptions {
  /** Polling period in milliseconds. Default 5. */
  interval?: number;
}

/**
 * Drive a Web MIDI output's clock from a transport: Start or Continue when it
 * plays, Stop when it pauses, Song Position on a jump, and 24 pulses per
 * quarter note while it plays. Pulses go out on a main-thread timer, so they
 * jitter by about one polling period.
 */
export class MidiClockSink {
  readonly #output: MidiOutputLike;
  readonly #transport: MidiClockTransport;
  readonly #release: () => void;
  readonly #timer: ReturnType<typeof setInterval>;
  #playing = false;
  #sent = 0;
  #disposed = false;

  constructor(output: MidiOutputLike, transport: MidiClockTransport, options: MidiClockSinkOptions = {}) {
    this.#output = output;
    this.#transport = transport;
    this.#release = transport.subscribe(() => this.#sync());
    this.#timer = setInterval(() => this.#pulse(), options.interval ?? 5);
    this.#sync();
  }

  /** Pulses due since the start of the song at the transport's position. */
  #due(): number {
    const seconds = Math.max(0, this.#transport.position());
    return Math.floor(seconds * this.#transport.tempo().bpm / 60 * MIDI_CLOCK_PPQ + 1e-6);
  }

  #sync(): void {
    if (this.#disposed) return;
    const playing = this.#transport.playing();
    const due = this.#due();
    if (playing && !this.#playing) {
      const sixteenths = Math.floor(due / (MIDI_CLOCK_PPQ / 4));
      this.#send([0xf2, sixteenths & 0x7f, (sixteenths >> 7) & 0x7f]);
      this.#send([due === 0 ? 0xfa : 0xfb]);
      this.#sent = sixteenths * (MIDI_CLOCK_PPQ / 4);
    } else if (!playing && this.#playing) this.#send([0xfc]);
    else if (playing && Math.abs(due - this.#sent) > MIDI_CLOCK_PPQ) {
      // A jump: tell the device where the song is now.
      const sixteenths = Math.floor(due / (MIDI_CLOCK_PPQ / 4));
      this.#send([0xfc]); this.#send([0xf2, sixteenths & 0x7f, (sixteenths >> 7) & 0x7f]); this.#send([0xfb]);
      this.#sent = sixteenths * (MIDI_CLOCK_PPQ / 4);
    }
    this.#playing = playing;
  }

  #pulse(): void {
    if (this.#disposed || !this.#playing) return;
    const due = this.#due();
    // Never burst more than a beat's pulses after a stall.
    if (due - this.#sent > MIDI_CLOCK_PPQ) this.#sent = due - 1;
    while (this.#sent < due) { this.#send([0xf8]); this.#sent++; }
  }

  #send(bytes: number[]): void { try { this.#output.send(bytes); } catch { /* A closed port stops sending. */ } }

  dispose(): void {
    if (this.#disposed) return;
    if (this.#playing) this.#send([0xfc]);
    this.#disposed = true;
    clearInterval(this.#timer);
    this.#release();
  }
}

/** Check and send one system exclusive message: it must start with F0, end with F7 and hold 7-bit data between. */
export function sendSysex(output: MidiOutputLike, bytes: readonly number[]): void {
  if (bytes[0] !== 0xf0 || bytes[bytes.length - 1] !== 0xf7 || bytes.slice(1, -1).some(byte => !Number.isInteger(byte) || byte < 0 || byte > 0x7f)) {
    throw new RangeError('A system exclusive message starts with 240 (F0), ends with 247 (F7) and holds bytes 0–127 between.');
  }
  output.send(bytes as number[]);
}

/** The MIDI bytes a message names: `cc c v [ch]`, `bend v [ch]`, `program p [ch]`, `pressure v [ch]`, `sysex …` or a raw byte list. */
export function midiBytes(value: Message): number[] | undefined {
  const numbers = atomsOf(value).filter(isNumberAtom).map(atom => Math.trunc(atom.value));
  const channel = (index: number) => Math.max(0, Math.min(15, numbers[index] ?? 0));
  const seven = (n: number | undefined) => Math.max(0, Math.min(127, n ?? 0));
  switch (value.selector) {
    case 'cc': return [0xb0 | channel(2), seven(numbers[0]), seven(numbers[1])];
    case 'bend': { const bend = Math.max(0, Math.min(16383, (numbers[0] ?? 0) + 8192)); return [0xe0 | channel(1), bend & 0x7f, bend >> 7]; }
    case 'program': return [0xc0 | channel(1), seven(numbers[0])];
    case 'pressure': return [0xd0 | channel(1), seven(numbers[0])];
    case 'sysex': return numbers;
    case 'list': case 'int': return numbers.every(byte => byte >= 0 && byte <= 255) && numbers.length ? numbers : undefined;
    default: return undefined;
  }
}

/** A Web MIDI output as a message sink: each message on its `midi` port goes out as the bytes it names. */
export class MidiMessageSink implements ModuleHandle {
  readonly id: string;
  readonly midi: MessageInputPort;
  readonly #ports: readonly ModulePort[];

  constructor(output: MidiOutputLike, options: {id?: string; onError?: (error: unknown) => void} = {}) {
    this.id = options.id ?? 'midi-out';
    assertModuleId(this.id);
    this.midi = new MessageInputPort(value => {
      const bytes = midiBytes(value);
      if (!bytes) return;
      try { if (bytes[0] === 0xf0) sendSysex(output, bytes); else output.send(bytes); } catch (error) { options.onError?.(error); }
    }, {id: 'midi'});
    this.#ports = Object.freeze([this.midi]);
  }

  ports(): readonly ModulePort[] { return this.#ports; }
  dispose(): void { this.midi.dispose(); }
}
