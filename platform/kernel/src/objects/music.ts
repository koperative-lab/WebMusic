// Music objects (DEC-077): `transport` reads the Session's musical time,
// `makenote` turns numbers into timed notes on a note port, and the input
// objects bring gamepads, HID devices and OSC over a WebSocket into a patch.
//
// Ownership: makenote owns its note port and pending note-offs; the input
// objects own their polling timer, device handle or socket and release them
// on dispose. Browser APIs are reached only when an object is created or
// opened, so importing this file needs no DOM.

import {
  MessageInputPort, atomsOf, floatAtom, intAtom, isNumberAtom, message, numberOf,
  symbolAtom, type Atom, type Message,
} from '../module/message';
import {MUSICAL_TIME} from '../module/musical-time';
import {decodeOsc, encodeOsc, isOscBundle, type OscArgument, type OscPacket} from '../module/osc';
import {ProjectModuleUnavailableError, type ProjectFactoryRequest, type ProjectModuleInstance, type ProjectPluginFactory} from '../module/project-types';
import type {ModuleHandle} from '../module/registry';
import {messageClockFor, type MessageClock} from '../module/message';
import {NoteOutputPort} from '../module/note-port';
import {timeValueSeconds} from '../transport';
import {OBJECT_PLUGIN_PREFIX, OBJECT_PLUGIN_VERSION, parseArgs, type ObjectDefinition, type ObjectEnvironment} from './core';

const ports = (...labels: string[]) => labels.map(label => ({label}));

/** `transport`: on bang, the position as `bar beat tick`, the tempo and the seconds. */
const transport: ObjectDefinition = {
  name: 'transport',
  inlets: () => ports('bang reports the position'),
  outlets: () => ports('bar beat tick', 'tempo (bpm)', 'position (seconds)', 'playing (0 or 1)'),
  create: (context) => {
    const musical = context.scope.capabilities.get(MUSICAL_TIME);
    return {
      receive: (_index, value) => {
        if (!musical || value.selector !== 'bang') return;
        const position = musical.barsBeatsTicks();
        context.out(3, message('int', [intAtom(musical.playing() ? 1 : 0)], value.time));
        context.out(2, message('float', [floatAtom(musical.position())], value.time));
        context.out(1, message('float', [floatAtom(musical.tempo().bpm)], value.time));
        context.out(0, message('list', [intAtom(position.bar), intAtom(position.beat), intAtom(position.tick)], value.time));
      },
    };
  },
};

/**
 * `makenote velocity duration`: a pitch in the left inlet plays a note on the
 * `notes` port at the message's time and releases it `duration` later
 * (milliseconds or a time value such as `8n`). A list is pitch, velocity,
 * duration. Velocity 0 plays nothing.
 */
function makenotePlugin(environment: ObjectEnvironment): ProjectPluginFactory {
  return Object.freeze({
    id: `${OBJECT_PLUGIN_PREFIX}makenote`,
    version: OBJECT_PLUGIN_VERSION,
    create({record, context}: ProjectFactoryRequest): ProjectModuleInstance {
      const args = parseArgs(record.config);
      const number = (atom: Atom | undefined, fallback: number) => isNumberAtom(atom) ? atom.value : fallback;
      let velocity = number(args[0], 100);
      const text = (atom: Atom) => atom.type === 'symbol' ? atom.value : String(atom.value);
      let duration: string = args[1] === undefined ? '250' : text(args[1]);
      const musical = context.capabilities.get(MUSICAL_TIME);
      const notes = new NoteOutputPort({id: 'notes'});
      let clock: MessageClock | undefined;
      const clockOf = () => clock ??= (environment.clock ?? messageClockFor)(context.audio.prepare());
      const pending = new Set<() => void>();
      let sequence = 0;
      let disposed = false;
      const play = (value: Message) => {
        const atoms = atomsOf(value).filter(isNumberAtom);
        const pitch = atoms[0]?.value;
        if (pitch === undefined) return;
        if (atoms[1]) velocity = atoms[1].value;
        if (atoms[2]) duration = String(atoms[2].value);
        if (velocity <= 0 || pitch < 0 || pitch > 127) return;
        const time = value.time ?? clockOf().now();
        const seconds = timeValueSeconds(duration, musical?.tempo());
        const occurrenceId = `${record.id}-${++sequence}`;
        const base = {occurrenceId, sourceId: record.id, pitch: {midi: Math.round(pitch)}, axis: 'audio-context-seconds', epoch: 0} as const;
        notes.emit({...base, velocity: Math.min(1, velocity / 127), gate: 'on', time});
        const cancel = clockOf().schedule(time + Math.max(0.001, seconds), when => {
          pending.delete(cancel);
          if (!disposed && notes.held.some(event => event.occurrenceId === occurrenceId)) notes.emit({...base, velocity: 0, gate: 'off', time: when});
        });
        pending.add(cancel);
      };
      const inlets = [
        new MessageInputPort(value => { if (!disposed) play(value); }, {id: 'in0'}),
        new MessageInputPort(value => { const n = numberOf(value); if (n !== undefined) velocity = n; }, {id: 'in1'}),
        new MessageInputPort(value => { const atom = atomsOf(value)[0]; if (atom) duration = text(atom); }, {id: 'in2'}),
      ];
      const module: ModuleHandle = {id: record.id, ports: () => [...inlets, notes]};
      const registration = context.registry.register(module);
      return {
        module,
        ports: [
          {id: 'in0', label: 'pitch, or pitch velocity duration', kind: 'message', direction: 'input'},
          {id: 'in1', label: 'velocity', kind: 'message', direction: 'input'},
          {id: 'in2', label: 'duration (ms or a time value)', kind: 'message', direction: 'input'},
          {id: 'notes', label: 'notes', kind: 'note', direction: 'output'},
        ],
        exportConfig: () => record.config,
        dispose: () => {
          if (disposed) return;
          disposed = true;
          for (const cancel of pending) cancel();
          for (const port of inlets) port.dispose();
          notes.dispose(clock?.now());
          registration.release();
        },
      };
    },
  });
}

// --- inputs ---------------------------------------------------------------------

/**
 * `gamepad [index]`: while the component runs, each change of a button or
 * axis of that gamepad (0 by default) as `button i value` or `axis i value`.
 */
const gamepad: ObjectDefinition = {
  name: 'gamepad',
  inlets: () => ports('bang reports every button and axis'),
  outlets: () => ports('button i value, axis i value'),
  create: (context) => {
    const index = isNumberAtom(context.args[0]) ? Math.trunc(context.args[0].value) : 0;
    let previous: {buttons: number[]; axes: number[]} = {buttons: [], axes: []};
    let timer: ReturnType<typeof setInterval> | undefined;
    const read = () => {
      const pads = typeof navigator !== 'undefined' && typeof navigator.getGamepads === 'function' ? navigator.getGamepads() : [];
      const pad = pads[index];
      return pad ? {buttons: pad.buttons.map(button => button.value), axes: [...pad.axes]} : undefined;
    };
    const report = (all: boolean) => {
      const current = read();
      if (!current) return;
      current.buttons.forEach((value, i) => { if (all || previous.buttons[i] !== value) context.out(0, message('button', [intAtom(i), floatAtom(value)])); });
      current.axes.forEach((value, i) => { if (all || Math.abs((previous.axes[i] ?? 0) - value) > 0.002) context.out(0, message('axis', [intAtom(i), floatAtom(value)])); });
      previous = current;
    };
    return {
      activate: () => { timer = setInterval(() => report(false), 16); },
      receive: (_index, value) => { if (value.selector === 'bang') report(true); },
      dispose: () => { if (timer) clearInterval(timer); },
    };
  },
};

interface HidDeviceLike {
  readonly opened: boolean;
  readonly productName: string;
  open(): Promise<void>;
  close(): Promise<void>;
  addEventListener(type: 'inputreport', listener: (event: {reportId: number; data: DataView}) => void): void;
  removeEventListener(type: 'inputreport', listener: (event: {reportId: number; data: DataView}) => void): void;
}

/**
 * `hid`: `open` asks the browser for a HID device (from a click, as the
 * browser requires) and then outputs each input report as `report id bytes…`;
 * `close` releases it. The second outlet reports the device name.
 */
const hid: ObjectDefinition = {
  name: 'hid',
  inlets: () => ports('open, close'),
  outlets: () => ports('report id bytes…', 'device name'),
  create: (context) => {
    let device: HidDeviceLike | undefined;
    const listener = (event: {reportId: number; data: DataView}) => {
      const bytes = Array.from({length: event.data.byteLength}, (_, i) => intAtom(event.data.getUint8(i)));
      context.out(0, message('report', [intAtom(event.reportId), ...bytes]));
    };
    const close = () => {
      if (!device) return;
      device.removeEventListener('inputreport', listener);
      void device.close().catch(context.fail);
      device = undefined;
    };
    const open = async () => {
      const api = (globalThis.navigator as unknown as {hid?: {requestDevice(options: {filters: object[]}): Promise<HidDeviceLike[]>}} | undefined)?.hid;
      if (!api) throw new Error('This browser has no WebHID.');
      const [chosen] = await api.requestDevice({filters: []});
      if (!chosen) return;
      close();
      if (!chosen.opened) await chosen.open();
      device = chosen;
      device.addEventListener('inputreport', listener);
      context.out(1, message('symbol', [symbolAtom(chosen.productName || 'HID device')]));
    };
    return {
      receive: (_index, value) => {
        if (value.selector === 'open') void open().catch(context.fail);
        else if (value.selector === 'close') close();
      },
      dispose: close,
    };
  },
};

/** A Max message from an OSC message: the address is the selector. */
function fromOsc(packet: OscPacket, out: (value: Message) => void): void {
  if (isOscBundle(packet)) { for (const element of packet.elements) fromOsc(element, out); return; }
  const atoms = packet.args.flatMap((arg): Atom[] => {
    switch (arg.type) {
      case 'i': return [intAtom(arg.value)];
      case 'f': return [floatAtom(arg.value)];
      case 's': return [symbolAtom(arg.value)];
      case 'T': return [intAtom(1)];
      case 'F': return [intAtom(0)];
      default: return [];
    }
  });
  out(message(packet.address, atoms));
}

/** An OSC message from a Max message whose selector is an address. */
export function toOsc(value: Message): OscPacket | undefined {
  if (!value.selector.startsWith('/')) return undefined;
  const args = value.atoms.flatMap((atom): OscArgument[] => {
    if (atom.type === 'int') return [{type: 'i', value: atom.value}];
    if (atom.type === 'float') return [{type: 'f', value: atom.value}];
    if (atom.type === 'symbol') return [{type: 's', value: atom.value}];
    return [];
  });
  return {address: value.selector, args};
}

/** A WebSocket carrying binary OSC packets, shared by the oscin and oscout objects. */
function oscSocket(url: string, onPacket: ((packet: OscPacket) => void) | undefined, onStatus: (status: string) => void, fail: (error: unknown) => void) {
  if (typeof WebSocket === 'undefined') throw new ProjectModuleUnavailableError('This environment has no WebSocket.');
  if (!/^wss?:\/\//.test(url)) throw new ProjectModuleUnavailableError('An OSC bridge address starts with ws:// or wss://.');
  let socket: WebSocket | undefined;
  let closed = false;
  let retry: ReturnType<typeof setTimeout> | undefined;
  const connect = () => {
    if (closed) return;
    socket = new WebSocket(url);
    socket.binaryType = 'arraybuffer';
    socket.onopen = () => onStatus('open');
    socket.onclose = () => { onStatus('closed'); if (!closed) retry = setTimeout(connect, 2000); };
    socket.onerror = () => onStatus('error');
    socket.onmessage = event => {
      if (!onPacket || !(event.data instanceof ArrayBuffer)) return;
      try { onPacket(decodeOsc(event.data)); } catch (error) { fail(error); }
    };
  };
  connect();
  return {
    send(packet: OscPacket) { if (socket?.readyState === 1) socket.send(encodeOsc(packet)); },
    close() { closed = true; if (retry) clearTimeout(retry); socket?.close(); },
  };
}

/** `oscin ws://host:port`: each OSC message arriving through the bridge, as a message named by its address. */
const oscin: ObjectDefinition = {
  name: 'oscin',
  inlets: () => [],
  outlets: () => ports('/address arguments…', 'connection: open, closed, error'),
  check: args => { if (args[0]?.type !== 'symbol') throw new TypeError('oscin needs a ws:// or wss:// bridge address.'); },
  create: (context) => {
    let socket: ReturnType<typeof oscSocket> | undefined;
    return {
      activate: () => {
        socket = oscSocket((context.args[0] as {value: string}).value, packet => fromOsc(packet, value => context.out(0, value)),
          status => context.out(1, message('symbol', [symbolAtom(status)])), context.fail);
      },
      receive: () => {},
      dispose: () => socket?.close(),
    };
  },
};

/** `oscout ws://host:port`: messages named by an address go out through the bridge as OSC. */
const oscout: ObjectDefinition = {
  name: 'oscout',
  inlets: () => ports('/address arguments…'),
  outlets: () => ports('connection: open, closed, error'),
  check: args => { if (args[0]?.type !== 'symbol') throw new TypeError('oscout needs a ws:// or wss:// bridge address.'); },
  create: (context) => {
    let socket: ReturnType<typeof oscSocket> | undefined;
    return {
      activate: () => {
        socket = oscSocket((context.args[0] as {value: string}).value, undefined, status => context.out(0, message('symbol', [symbolAtom(status)])), context.fail);
      },
      receive: (_index, value) => { const packet = toOsc(value); if (packet) socket?.send(packet); },
      dispose: () => socket?.close(),
    };
  },
};

export const MUSIC_DEFINITIONS: readonly ObjectDefinition[] = Object.freeze([transport, gamepad, hid, oscin, oscout]);

/** Plugins for the music objects that are not message-only definitions. */
export function createMusicPlugins(environment: ObjectEnvironment = {}): readonly ProjectPluginFactory[] {
  return Object.freeze([makenotePlugin(environment)]);
}


