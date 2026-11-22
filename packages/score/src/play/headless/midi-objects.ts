// MIDI objects (DEC-077): Web MIDI devices as project plugins, so a component
// can take notes, controls and clock from a device and send them back out.
//
// One device input can feed several objects: a hub installs one handler on
// the real input and fans each message out to every object's own input. The
// objects never touch the device's handler themselves, so removing one leaves
// the others listening.
//
// Ownership: the access request is shared per `MidiAccessSource`; a hub lives
// while an object uses its input and restores the device's previous handler
// with its last user. Each object owns the Score class it wraps.

import {
  MUSICAL_TIME, ProjectModuleUnavailableError, isNumberAtom,
  type ModuleHandle, type ProjectFactoryRequest, type ProjectModuleInstance, type ProjectPluginFactory,
} from '@webmusic/kernel/module';
import {OBJECT_PLUGIN_PREFIX, OBJECT_PLUGIN_VERSION, parseArgs} from '@webmusic/kernel/objects';
import {MidiControlSource} from './control-source';
import {MidiClockSink, MidiClockSource, MidiMessageSink} from './midi-clock';
import {MidiNoteSink, MidiNoteSource} from './note-modules';
import type {MidiInputLike} from './inputs';
import type {MidiOutputLike} from './sounds/contracts';

/** A Web MIDI port as Studio and objects see it. */
export interface MidiPortLike {
  readonly id: string;
  readonly name?: string | null;
  readonly manufacturer?: string | null;
}
export type MidiDeviceInput = MidiPortLike & MidiInputLike;
export type MidiDeviceOutput = MidiPortLike & MidiOutputLike;

/** The part of `MIDIAccess` the objects use. */
export interface MidiAccessLike {
  readonly inputs: {values(): Iterable<MidiDeviceInput>};
  readonly outputs: {values(): Iterable<MidiDeviceOutput>};
  onstatechange?: ((event: unknown) => void) | null;
}

/** A device for a picker: its id, and the name objects store. */
export interface MidiDeviceInfo { readonly id: string; readonly name: string; readonly direction: 'input' | 'output' }

/**
 * Where MIDI objects get devices. `request` asks for access once and shares
 * it; pass a fake `MidiAccessLike` in tests or a page that already has one.
 */
export class MidiAccessSource {
  readonly #request: () => Promise<MidiAccessLike>;
  #access?: Promise<MidiAccessLike>;
  readonly #hubs = new Map<MidiDeviceInput, {handler: NonNullable<MidiInputLike['onmidimessage']>; previous: MidiInputLike['onmidimessage']; users: Set<MidiInputLike>}>();

  constructor(request?: () => Promise<MidiAccessLike>) {
    this.#request = request ?? (() => {
      const nav = typeof navigator !== 'undefined' ? navigator as Navigator & {requestMIDIAccess?: (options?: {sysex?: boolean}) => Promise<unknown>} : undefined;
      if (!nav?.requestMIDIAccess) return Promise.reject(new ProjectModuleUnavailableError('This browser has no Web MIDI.'));
      return nav.requestMIDIAccess({sysex: true}).catch(() => nav.requestMIDIAccess!()) as Promise<MidiAccessLike>;
    });
  }

  /**
   * The shared access; a refusal is not cached, so a later object can ask
   * again. A refusal leaves objects unresolved with the reason, never fails
   * the graph around them.
   */
  access(): Promise<MidiAccessLike> {
    this.#access ??= this.#request().catch(error => {
      this.#access = undefined;
      if (error instanceof ProjectModuleUnavailableError) throw error;
      throw new ProjectModuleUnavailableError(`MIDI access was not granted: ${error instanceof Error ? error.message : String(error)}`, {cause: error});
    });
    return this.#access;
  }

  /** The devices now present, inputs first. */
  async devices(): Promise<readonly MidiDeviceInfo[]> {
    const access = await this.access();
    const list = (ports: Iterable<MidiPortLike>, direction: 'input' | 'output') => [...ports].map(port => ({id: port.id, name: port.name || port.id, direction}));
    return Object.freeze([...list(access.inputs.values(), 'input'), ...list(access.outputs.values(), 'output')]);
  }

  /** The input named `device` (by name or id), or the first one. */
  async input(device?: string): Promise<MidiDeviceInput> {
    const inputs = [...(await this.access()).inputs.values()];
    const found = device ? inputs.find(port => port.name === device || port.id === device) : inputs[0];
    if (!found) throw new ProjectModuleUnavailableError(device ? `No MIDI input named ${device}.` : 'No MIDI input is connected.');
    return found;
  }

  async output(device?: string): Promise<MidiDeviceOutput> {
    const outputs = [...(await this.access()).outputs.values()];
    const found = device ? outputs.find(port => port.name === device || port.id === device) : outputs[0];
    if (!found) throw new ProjectModuleUnavailableError(device ? `No MIDI output named ${device}.` : 'No MIDI output is connected.');
    return found;
  }

  /** A private input fed by `device`; release it to stop listening. */
  listen(device: MidiDeviceInput): {readonly input: MidiInputLike; release(): void} {
    let hub = this.#hubs.get(device);
    if (!hub) {
      const users = new Set<MidiInputLike>();
      const created = {
        users, previous: device.onmidimessage,
        handler: (event: {data: Uint8Array | number[]}) => { for (const user of [...users]) user.onmidimessage?.(event); },
      };
      device.onmidimessage = created.handler;
      this.#hubs.set(device, created);
      hub = created;
    }
    const input: MidiInputLike = {onmidimessage: null};
    hub.users.add(input);
    let released = false;
    return {input, release: () => {
      if (released) return;
      released = true;
      const current = this.#hubs.get(device);
      if (!current) return;
      current.users.delete(input);
      if (current.users.size) return;
      this.#hubs.delete(device);
      if (device.onmidimessage === current.handler) device.onmidimessage = current.previous;
    }};
  }
}

const words = (request: ProjectFactoryRequest) => parseArgs(request.record.config as never);
const deviceOf = (request: ProjectFactoryRequest) => typeof request.record.config.device === 'string' && request.record.config.device ? request.record.config.device : undefined;
function channelOf(request: ProjectFactoryRequest): number | undefined {
  const atom = words(request).find(isNumberAtom);
  if (atom === undefined) return undefined;
  // Channels count from 0, as in the messages ctlin sends and midiout reads.
  if (!(Number.isInteger(atom.value) && atom.value >= 0 && atom.value <= 15)) throw new ProjectModuleUnavailableError('A MIDI channel is 0 to 15.');
  return atom.value;
}

type Wrapped = ModuleHandle & {dispose(): void};
function instance(request: ProjectFactoryRequest, module: Wrapped, ports: ProjectModuleInstance['ports'], release: () => void = () => {}): ProjectModuleInstance {
  const registration = request.context.registry.register(module);
  return {
    module, ports,
    exportConfig: () => request.record.config,
    dispose: () => { registration.release(); try { module.dispose(); } finally { release(); } },
  };
}

/**
 * Project plugins for the MIDI objects. Each takes `config.device` (a device
 * name; the first device when absent) and `config.args`:
 *
 * - `notein [channel] [mpe]` — notes from a device, MPE detuned with `mpe`.
 * - `ctlin [channel]` — `cc`, `bend`, `program`, `pressure`, `polypressure`
 *   and `sysex` messages.
 * - `midiclock` — `start`, `stop`, `continue`, `position`, `beat` and `tempo`
 *   from a device's clock.
 * - `noteout [channel]` — notes to a device.
 * - `midiout` — `cc`, `bend`, `program`, `note`, `sysex` and raw byte lists
 *   to a device.
 * - `midiclockout` — the component's musical time as MIDI clock.
 */
export function createMidiPlugins(access: MidiAccessSource = new MidiAccessSource()): readonly ProjectPluginFactory[] {
  const plugin = (name: string, create: (request: ProjectFactoryRequest) => Promise<ProjectModuleInstance>): ProjectPluginFactory =>
    Object.freeze({id: `${OBJECT_PLUGIN_PREFIX}${name}`, version: OBJECT_PLUGIN_VERSION, create});
  const listening = async (request: ProjectFactoryRequest) => access.listen(await access.input(deviceOf(request)));
  return Object.freeze([
    plugin('notein', async request => {
      const channel = channelOf(request);
      const mpe = words(request).some(atom => atom.type === 'symbol' && atom.value === 'mpe');
      const lease = await listening(request);
      const module = new MidiNoteSource(lease.input, {id: request.record.id, ...(channel === undefined ? {} : {channel}), ...(mpe ? {mpe: {}} : {})});
      return instance(request, module, [{id: 'notes', label: 'notes', kind: 'note', direction: 'output'}], lease.release);
    }),
    plugin('ctlin', async request => {
      const channel = channelOf(request);
      const lease = await listening(request);
      const module = new MidiControlSource(lease.input, {id: request.record.id, ...(channel === undefined ? {} : {channel})});
      return instance(request, module, [{id: 'controls', label: 'cc, bend, program, pressure, sysex', kind: 'message', direction: 'output'}], lease.release);
    }),
    plugin('midiclock', async request => {
      const lease = await listening(request);
      const module = new MidiClockSource(lease.input, {id: request.record.id});
      return instance(request, module, [{id: 'clock', label: 'start, stop, continue, position, beat, tempo', kind: 'message', direction: 'output'}], lease.release);
    }),
    plugin('noteout', async request => {
      const channel = channelOf(request) ?? 0;
      const module = new MidiNoteSink(await access.output(deviceOf(request)), {id: request.record.id, channel});
      return instance(request, module, [{id: 'notes', label: 'notes', kind: 'note', direction: 'input'}]);
    }),
    plugin('midiout', async request => {
      const module = new MidiMessageSink(await access.output(deviceOf(request)), {id: request.record.id});
      return instance(request, module, [{id: 'midi', label: 'cc, bend, program, note, sysex or bytes', kind: 'message', direction: 'input'}]);
    }),
    plugin('midiclockout', async request => {
      const output = await access.output(deviceOf(request));
      const musical = request.context.capabilities.get(MUSICAL_TIME);
      if (!musical) throw new ProjectModuleUnavailableError('MIDI clock out needs the component\'s musical time.');
      const sink = new MidiClockSink(output, musical);
      const module: Wrapped = {id: request.record.id, dispose: () => sink.dispose()};
      return instance(request, module, []);
    }),
  ]);
}
