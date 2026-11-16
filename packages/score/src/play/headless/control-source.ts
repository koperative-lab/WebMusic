import {
  MessageOutputPort, assertModuleId, intAtom, message,
  type ControlEvent, type ModuleHandle, type ModulePort,
} from '@webmusic/kernel/module';
import type {MidiInputLike} from './inputs';

export interface MidiControlSourceOptions {
  id?: string;
  /** Accept only this MIDI channel (0–15); default all channels. */
  channel?: number;
}

/**
 * A Web MIDI input as a control source (DEC-076): control changes, pitch
 * bend and program changes. Each arrives as a Kernel `ControlEvent` for
 * listeners such as `ControlMappings`, and as a message on the `controls`
 * port: `cc controller value channel`, `bend value channel` (−8192…8191) or
 * `program number channel`, so a patch can use it too. Disposal restores the
 * input's previous handler if it is still the installed one.
 */
export class MidiControlSource implements ModuleHandle {
  readonly id: string;
  readonly controls: MessageOutputPort;
  readonly #input: MidiInputLike;
  readonly #channel?: number;
  readonly #previous: MidiInputLike['onmidimessage'];
  readonly #handler: NonNullable<MidiInputLike['onmidimessage']>;
  readonly #listeners = new Set<(event: ControlEvent) => void>();
  readonly #ports: readonly ModulePort[];
  #disposed = false;

  constructor(input: MidiInputLike, options: MidiControlSourceOptions = {}) {
    this.id = options.id ?? 'midi-controls';
    assertModuleId(this.id);
    if (options.channel !== undefined && (!Number.isInteger(options.channel) || options.channel < 0 || options.channel > 15)) {
      throw new RangeError('MIDI channel must be an integer within 0–15');
    }
    this.#input = input;
    this.#channel = options.channel;
    this.controls = new MessageOutputPort({id: 'controls'});
    this.#ports = Object.freeze([this.controls]);
    this.#previous = input.onmidimessage;
    this.#handler = event => this.#receive(event.data);
    input.onmidimessage = this.#handler;
  }

  ports(): readonly ModulePort[] { return this.#ports; }

  /** Listen to every control event; returns an unsubscribe function. */
  onControl(listener: (event: ControlEvent) => void): () => void {
    this.#listeners.add(listener);
    return () => { this.#listeners.delete(listener); };
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    if (this.#input.onmidimessage === this.#handler) this.#input.onmidimessage = this.#previous;
    this.controls.dispose();
    this.#listeners.clear();
  }

  #receive(data: Uint8Array | number[]): void {
    if (this.#disposed || data.length < 2) return;
    const status = data[0]! & 0xf0;
    const channel = data[0]! & 0x0f;
    if (this.#channel !== undefined && channel !== this.#channel) return;
    let event: ControlEvent | undefined;
    if (status === 0xb0 && data.length >= 3) event = {kind: 'cc', controller: data[1]! & 0x7f, value: data[2]! & 0x7f, channel};
    else if (status === 0xe0 && data.length >= 3) event = {kind: 'pitchbend', value: ((data[2]! & 0x7f) << 7 | (data[1]! & 0x7f)) - 8192, channel};
    else if (status === 0xc0) event = {kind: 'program', value: data[1]! & 0x7f, channel};
    if (!event) return;
    for (const listener of [...this.#listeners]) {
      try { listener(event); } catch { /* One listener cannot stop the others. */ }
    }
    if (event.kind === 'cc') this.controls.send(message('cc', [intAtom(event.controller), intAtom(event.value), intAtom(channel)]));
    else if (event.kind === 'pitchbend') this.controls.send(message('bend', [intAtom(event.value), intAtom(channel)]));
    else if (event.kind === 'program') this.controls.send(message('program', [intAtom(event.value), intAtom(channel)]));
  }
}
