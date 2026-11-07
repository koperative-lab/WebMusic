import {
  NoteInputPort,
  NoteOutputPort,
  assertModuleId,
  createConnectionLease,
  type ConnectionLease,
  type ModuleHandle,
  type ModulePort,
  type NoteEvent,
} from '@webmusic/kernel/module';
import type {MidiInputLike} from './inputs';
import type {MidiOutputLike} from './sounds/contracts';
import type {ScoreRecorderSession} from './recorder';

const MIDI_AXIS = 'performance-seconds';
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;

/** Shared lifecycle for the note modules: fixed ports, idempotent disposal. */
abstract class NoteModule implements ModuleHandle {
  readonly id: string;
  #listeners = new Set<() => void>();
  protected disposed = false;

  constructor(id: string) {
    assertModuleId(id);
    this.id = id;
  }

  abstract ports(): readonly ModulePort[];
  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => { this.#listeners.delete(listener); };
  }
  protected notify(): void {
    for (const listener of [...this.#listeners]) {
      try { listener(); } catch { /* Observers cannot undo committed note state. */ }
    }
  }
  protected finish(): void {
    this.notify();
    this.#listeners.clear();
  }
}

export interface MidiNoteSourceOptions {
  id?: string;
  /** Accept only this MIDI channel (0–15); default all channels. */
  channel?: number;
}

/**
 * A Web MIDI input as a note source (DEC-068). Each note-on opens an
 * occurrence owned by this source; the matching note-off on the same channel
 * and pitch closes exactly that occurrence. Disposal cancels held notes and
 * restores the input's previous handler if it is still the installed one.
 */
export class MidiNoteSource extends NoteModule {
  readonly notes: NoteOutputPort;
  readonly #input: MidiInputLike;
  readonly #channel?: number;
  readonly #previous: MidiInputLike['onmidimessage'];
  readonly #handler: NonNullable<MidiInputLike['onmidimessage']>;
  readonly #held = new Map<string, string>();
  readonly #ports: readonly ModulePort[];
  #sequence = 0;

  constructor(input: MidiInputLike, options: MidiNoteSourceOptions = {}) {
    super(options.id ?? 'midi-in');
    if (options.channel !== undefined && (!Number.isInteger(options.channel) || options.channel < 0 || options.channel > 15)) {
      throw new RangeError('MIDI channel must be an integer within 0–15');
    }
    this.#input = input;
    this.#channel = options.channel;
    this.notes = new NoteOutputPort({id: 'notes'});
    this.#ports = Object.freeze([this.notes]);
    this.#previous = input.onmidimessage;
    this.#handler = (event) => this.#receive(event.data, (event as {timeStamp?: number}).timeStamp);
    input.onmidimessage = this.#handler;
  }

  ports(): readonly ModulePort[] { return this.#ports; }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.#input.onmidimessage === this.#handler) this.#input.onmidimessage = this.#previous;
    this.notes.dispose(now());
    this.#held.clear();
    this.finish();
  }

  #receive(data: Uint8Array | number[], timeStamp?: number): void {
    if (this.disposed || data.length < 3) return;
    const status = data[0] & 0xf0;
    const channel = data[0] & 0x0f;
    if (status !== 0x90 && status !== 0x80) return;
    if (this.#channel !== undefined && channel !== this.#channel) return;
    const midi = data[1] & 0x7f;
    const velocity = data[2] & 0x7f;
    const key = `${channel}:${midi}`;
    const time = timeStamp !== undefined ? timeStamp / 1000 : now();
    const base = {sourceId: this.id, pitch: {midi}, axis: MIDI_AXIS, time, epoch: 0};
    if (status === 0x90 && velocity > 0) {
      // A repeated note-on without a release closes the earlier occurrence first.
      const open = this.#held.get(key);
      if (open) this.notes.emit({...base, occurrenceId: open, velocity: 0, gate: 'off'});
      const occurrenceId = `${this.id}-${++this.#sequence}`;
      this.#held.set(key, occurrenceId);
      this.notes.emit({...base, occurrenceId, velocity: velocity / 127, gate: 'on'});
      return;
    }
    const occurrenceId = this.#held.get(key);
    if (!occurrenceId) return;
    this.#held.delete(key);
    this.notes.emit({...base, occurrenceId, velocity: velocity / 127, gate: 'off'});
  }
}

export interface MidiNoteSinkOptions {
  id?: string;
  /** MIDI channel 0–15. Default 0. */
  channel?: number;
}

/**
 * Send note events to a Web MIDI output (DEC-068's MIDI-out sink). Each
 * occurrence keeps its own pitch; a `cancel` sends a note-off immediately. The
 * device's timing is external to any Session.
 */
export class MidiNoteSink extends NoteModule {
  readonly notes: NoteInputPort;
  readonly #output: MidiOutputLike;
  readonly #channel: number;
  readonly #held = new Map<string, number>();
  readonly #ports: readonly ModulePort[];

  constructor(output: MidiOutputLike, options: MidiNoteSinkOptions = {}) {
    super(options.id ?? 'midi-out');
    const channel = options.channel ?? 0;
    if (!Number.isInteger(channel) || channel < 0 || channel > 15) throw new RangeError('MIDI channel must be an integer within 0–15');
    this.#output = output;
    this.#channel = channel;
    this.notes = new NoteInputPort({accept: (event) => this.#send(event)}, {id: 'notes'});
    this.#ports = Object.freeze([this.notes]);
  }

  ports(): readonly ModulePort[] { return this.#ports; }

  dispose(): void {
    if (this.disposed) return;
    let failure: unknown;
    try { this.notes.dispose(); } catch (error) { failure = error; }
    for (const midi of this.#held.values()) {
      try { this.#output.send([0x80 | this.#channel, midi, 0]); } catch (error) { failure ??= error; }
    }
    this.#held.clear();
    this.disposed = true;
    this.finish();
    if (failure !== undefined) throw failure;
  }

  #send(event: NoteEvent): void {
    if (this.disposed) return;
    const key = `${event.sourceId}:${event.occurrenceId}`;
    if (event.gate === 'on') {
      const midi = Math.max(0, Math.min(127, Math.round(event.pitch.midi)));
      this.#held.set(key, midi);
      this.#output.send([0x90 | this.#channel, midi, Math.max(1, Math.min(127, Math.round(event.velocity * 127)))]);
      return;
    }
    const midi = this.#held.get(key);
    if (midi === undefined) return;
    this.#held.delete(key);
    this.#output.send([0x80 | this.#channel, midi, event.gate === 'off' ? Math.round(event.velocity * 127) : 0]);
  }
}

/**
 * Capture a note source into a recorder take. Each occurrence pairs its own
 * on and off. A `cancel` (a disconnect or a disposed source) discards the
 * take's unmatched presses, as {@link ScoreRecorderSession.discardPending}
 * does. Releasing the lease stops capturing without finishing the take.
 */
export function recordNoteOutput(recorder: ScoreRecorderSession, notes: NoteOutputPort): ConnectionLease {
  const open = new Map<string, number>();
  let active = true;
  const stop = notes.subscribe((event) => {
    if (!active) return;
    const midi = Math.round(event.pitch.midi);
    if (event.gate === 'on') {
      open.set(event.occurrenceId, midi);
      recorder.capture(midi, Math.max(1, Math.round(event.velocity * 127)), true);
      return;
    }
    if (!open.delete(event.occurrenceId)) return;
    if (event.gate === 'off') recorder.capture(midi, 0, false);
    else recorder.discardPending();
  });
  return createConnectionLease(() => { active = false; open.clear(); stop(); });
}
