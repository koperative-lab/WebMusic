// Nested components (DEC-076): a component inside a component, as a Max
// subpatch. Its edges carry messages and audio (DEC-076), notes and sources
// (DEC-089), so a component made of objects has every port family a
// component written in code has. The project already nests contexts; a `component` object owns a
// child context whose modules are its contents. It lends that context a
// boundary — one channel per inlet and outlet — and the `inlet`, `outlet`,
// `inlet~` and `outlet~` objects inside connect to it. Nothing is flattened:
// the inner modules are ordinary records of the same project.
//
// Ownership: the shell owns its ports, relay nodes and the boundary; inner
// objects borrow a channel and release their own connection to it.

import {createCapabilityKey, type CapabilityKey} from '../module/capability';
import {AudioOutputPort} from '../module/audio-port';
import {createConnectionLease, type ConnectionLease} from '../module/lease';
import {MessageInputPort, MessageOutputPort, isNumberAtom, type Atom, type Message} from '../module/message';
import {NoteInputPort, NoteOutputPort, type NoteEvent} from '../module/note-port';
import {SourceRelay} from '../module/source-relay';
import {VoiceAllocator} from '../module/voices';
import type {ModuleHandle} from '../module/registry';
import {routeModuleOutput} from '../module/context';
import {
  ProjectModuleUnavailableError,
  type ProjectFactoryRequest, type ProjectModuleInstance, type ProjectPluginFactory, type ProjectPortDescriptor,
} from '../module/project-types';
import {OBJECT_PLUGIN_PREFIX, OBJECT_PLUGIN_VERSION, inletId, outletId, objectPlugin, parseArgs, type ObjectDefinition, type ObjectEnvironment} from './core';

export type BoundaryKind = 'message' | 'audio' | 'note' | 'source';
const BOUNDARY_KINDS: readonly BoundaryKind[] = ['message', 'audio', 'note', 'source'];

/** One inlet channel, seen from inside the component. */
export interface BoundaryInlet {
  readonly kind: BoundaryKind;
  /** Messages arriving at the component's inlet. */
  readonly messages?: MessageOutputPort;
  /** Audio arriving at the component's inlet. */
  readonly audio?: AudioOutputPort;
  /** Notes arriving at the component's inlet. */
  readonly notes?: NoteOutputPort;
  /** The module cabled into the component's source inlet, as a relay. */
  readonly source?: SourceRelay;
}
/** One outlet channel, seen from inside the component. */
export interface BoundaryOutlet {
  readonly kind: BoundaryKind;
  /** Send a message out of the component's outlet. */
  send?(message: Message): void;
  /** Connect audio here to leave through the component's outlet. */
  readonly input?: AudioNode;
  /** Play notes out of the component's outlet. */
  readonly notes?: NoteInputPort;
  /** The relay a source outlet carries: it follows whatever is cabled to `outlet.source` inside. */
  readonly source?: SourceRelay;
}
/** What a component lends its child context. */
export interface ComponentBoundary {
  inlet(index: number): BoundaryInlet | undefined;
  outlet(index: number): BoundaryOutlet | undefined;
}

export const COMPONENT_BOUNDARY: CapabilityKey<ComponentBoundary> = createCapabilityKey<ComponentBoundary>('webmusic.component-boundary');
export const COMPONENT_PLUGIN = `${OBJECT_PLUGIN_PREFIX}component`;
export const POLY_PLUGIN = `${OBJECT_PLUGIN_PREFIX}poly`;

/** What a `poly` lends each voice's context (DEC-077): its index and the notes allocated to it. */
export interface PolyVoice {
  readonly index: number;
  readonly voices: number;
  readonly notes: NoteOutputPort;
}
export const POLY_VOICE: CapabilityKey<PolyVoice> = createCapabilityKey<PolyVoice>('webmusic.poly-voice');

function kinds(value: unknown, name: string): BoundaryKind[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some(item => !BOUNDARY_KINDS.includes(item as BoundaryKind))) {
    throw new ProjectModuleUnavailableError(`component ${name} must list message, audio, note or source channels.`);
  }
  return value as BoundaryKind[];
}

/**
 * The component shell. `config.inlets` and `config.outlets` list each
 * channel's kind in order; the editor keeps them in step with the `inlet`
 * and `outlet` objects inside. The record that owns the child context is the
 * component; its contents are the modules of that context.
 */
export function componentPlugin(options: {poly?: boolean} = {}): ProjectPluginFactory {
  return Object.freeze({
    id: options.poly ? POLY_PLUGIN : COMPONENT_PLUGIN,
    version: OBJECT_PLUGIN_VERSION,
    create({record, context}: ProjectFactoryRequest): ProjectModuleInstance {
      const inletKinds = kinds(record.config.inlets, 'inlets');
      const outletKinds = kinds(record.config.outlets, 'outlets');
      // A poly owns one child context per voice, each a copy of the same contents;
      // notes into its `notes` inlet go to one voice at a time.
      const voiceCount = options.poly ? Math.trunc(Number(record.config.voices ?? 4)) : 0;
      if (options.poly && !(voiceCount >= 1 && voiceCount <= 64)) throw new ProjectModuleUnavailableError('poly needs 1 to 64 voices.');
      const voicePorts = Array.from({length: voiceCount}, (_, index) => new NoteOutputPort({id: `voice-${index}`}));
      const allocator = options.poly ? new VoiceAllocator(voiceCount) : undefined;
      const heldEvents = new Map<string, NoteEvent>();
      const notesIn = options.poly ? new NoteInputPort({accept: event => {
        if (!allocator) return;
        if (event.gate === 'on') {
          const {voice, stolen} = allocator.noteOn(event.occurrenceId);
          if (voice === undefined) return;
          if (stolen) {
            const previous = heldEvents.get(stolen);
            heldEvents.delete(stolen);
            const port = voicePorts[voice]!;
            if (previous && port.held.some(held => held.occurrenceId === stolen)) port.emit({...previous, gate: 'cancel', time: event.time, axis: event.axis});
          }
          heldEvents.set(event.occurrenceId, event);
          voicePorts[voice]!.emit(event);
          return;
        }
        const voice = allocator.noteOff(event.occurrenceId);
        heldEvents.delete(event.occurrenceId);
        const port = voice === undefined ? undefined : voicePorts[voice];
        if (port?.held.some(held => held.occurrenceId === event.occurrenceId)) port.emit(event);
      }}, {id: 'notes'}) : undefined;
      let voicesLent = 0;
      const leases: ConnectionLease[] = [];
      const disposers: (() => void)[] = [];
      let audioContext: BaseAudioContext | undefined;
      const audio = () => audioContext ??= context.audio.prepare();

      // Repeat notes onto `relay`; a release the relay never started is dropped (a rebuild can lose a press).
      const repeat = (relay: NoteOutputPort) => (event: NoteEvent) => {
        if (relay.disposed) return;
        if (event.gate !== 'on' && !relay.held.some(held => held.occurrenceId === event.occurrenceId)) return;
        relay.emit(event);
      };
      const inlets = inletKinds.map((kind, index) => {
        if (kind === 'note') {
          const relay = new NoteOutputPort({id: `inner-${inletId(index)}`});
          const port = new NoteInputPort({accept: repeat(relay)}, {id: inletId(index), multiplicity: 'sum'});
          disposers.push(() => { port.dispose(); relay.dispose(); });
          return {kind, port, channel: {kind, notes: relay} as BoundaryInlet};
        }
        if (kind === 'source') {
          const relay = new SourceRelay(`${record.id}:${inletId(index)}`);
          disposers.push(() => relay.dispose());
          return {kind, relay, channel: {kind, source: relay} as BoundaryInlet};
        }
        if (kind === 'message') {
          const relay = new MessageOutputPort({id: `inner-${inletId(index)}`});
          const port = new MessageInputPort(value => relay.send(value), {id: inletId(index)});
          disposers.push(() => { port.dispose(); relay.dispose(); });
          return {kind, port, channel: {kind, messages: relay} as BoundaryInlet};
        }
        const node = audio().createGain();
        const relay = new AudioOutputPort(node, {id: `inner-${inletId(index)}`});
        disposers.push(() => { relay.dispose(); node.disconnect(); });
        return {kind, node, channel: {kind, audio: relay} as BoundaryInlet};
      });
      const outlets = outletKinds.map((kind, index) => {
        if (kind === 'note') {
          const port = new NoteOutputPort({id: outletId(index)});
          const inner = new NoteInputPort({accept: repeat(port)}, {id: `inner-${outletId(index)}`, multiplicity: 'sum'});
          disposers.push(() => { inner.dispose(); port.dispose(); });
          return {kind, port, channel: {kind, notes: inner} as BoundaryOutlet};
        }
        if (kind === 'source') {
          const relay = new SourceRelay(`${record.id}:${outletId(index)}`);
          disposers.push(() => relay.dispose());
          return {kind, relay, channel: {kind, source: relay} as BoundaryOutlet};
        }
        if (kind === 'message') {
          const port = new MessageOutputPort({id: outletId(index)});
          disposers.push(() => port.dispose());
          return {kind, port, channel: {kind, send: (value: Message) => port.send(value)} as BoundaryOutlet};
        }
        const node = audio().createGain();
        const port = new AudioOutputPort(node, {id: outletId(index)});
        disposers.push(() => { port.dispose(); node.disconnect(); });
        return {kind, node, port, channel: {kind, input: node} as BoundaryOutlet};
      });
      const boundary: ComponentBoundary = Object.freeze({
        inlet: (index: number) => inlets[index]?.channel,
        outlet: (index: number) => outlets[index]?.channel,
      });
      const ports = [
        ...(notesIn ? [notesIn] : []),
        ...inlets.flatMap(item => 'port' in item && item.port ? [item.port] : []),
        ...outlets.flatMap(item => (item.kind === 'message' || item.kind === 'note') && 'port' in item ? [item.port as MessageOutputPort | NoteOutputPort] : []),
      ];
      let disposed = false;
      const module: ModuleHandle = {
        id: record.id,
        ports: () => ports,
        getPort: name => outlets.find((item, index) => item.kind === 'audio' && outletId(index) === name)?.port as AudioOutputPort | undefined,
        // The first audio outlet follows the context's default route, like any other audio object.
        prepare: () => {
          if (disposed) return;
          const first = outlets.find(item => item.kind === 'audio');
          if (first && !leases.length) leases.push(routeModuleOutput(context, module, first.port as AudioOutputPort));
        },
      };
      const registration = context.registry.register(module);
      const descriptors: ProjectPortDescriptor[] = [
        ...(notesIn ? [{id: 'notes', label: 'notes, one voice each', kind: 'note' as const, direction: 'input' as const}] : []),
        ...inletKinds.map((kind, index) => ({id: inletId(index), label: `${kind} in ${index + 1}`, kind, direction: 'input' as const})),
        ...outletKinds.map((kind, index) => ({id: outletId(index), label: `${kind} out ${index + 1}`, kind, direction: 'output' as const})),
      ];
      return {
        module,
        ports: descriptors,
        getInput: name => inlets.find((item, index) => item.kind === 'audio' && inletId(index) === name)?.node,
        // A source cord into an inlet is followed by that inlet's relay; one from an outlet carries the outlet's relay.
        connectSource: (name, upstream) => inlets.find((item, index) => item.kind === 'source' && inletId(index) === name)?.relay?.follow(upstream),
        sourceOutput: name => outlets.find((item, index) => item.kind === 'source' && outletId(index) === name)?.relay,
        // Inner modules keep the parent's destination and admission, so an
        // object not wired to an outlet~ sounds through the parent's default route.
        childContext: child => {
          let capabilities = child.capabilities.with(COMPONENT_BOUNDARY, boundary);
          if (options.poly) {
            // Child contexts are prepared in document order: the first is voice 0.
            const index = voicesLent++;
            const port = voicePorts[index];
            // A context beyond the voice count gets no notes.
            if (port) capabilities = capabilities.with(POLY_VOICE, Object.freeze({index, voices: voiceCount, notes: port}));
          }
          return child.derive({id: child.id, registry: child.registry, capabilities});
        },
        exportConfig: () => record.config,
        dispose: () => {
          if (disposed) return;
          disposed = true;
          for (const lease of leases.splice(0)) lease.release();
          registration.release();
          notesIn?.dispose();
          for (const port of voicePorts) port.dispose();
          for (const dispose of disposers.splice(0)) dispose();
        },
      };
    },
  });
}

const channelIndex = (args: readonly Atom[]) => {
  const first = args[0];
  return isNumberAtom(first) ? Math.max(0, Math.trunc(first.value)) : 0;
};

/** `inlet n`: messages arriving at the enclosing component's inlet n. */
const inlet: ObjectDefinition = {
  name: 'inlet',
  inlets: () => [],
  outlets: () => [{label: 'messages from outside'}],
  create: (context) => {
    const channel = context.scope.capabilities.get(COMPONENT_BOUNDARY)?.inlet(channelIndex(context.args));
    const release = channel?.messages?.subscribe(value => context.out(0, value));
    return {receive: () => {}, dispose: () => release?.()};
  },
};

/** `outlet n`: messages leaving through the enclosing component's outlet n. */
const outlet: ObjectDefinition = {
  name: 'outlet',
  inlets: () => [{label: 'messages to send outside'}],
  outlets: () => [],
  create: (context) => {
    const channel = context.scope.capabilities.get(COMPONENT_BOUNDARY)?.outlet(channelIndex(context.args));
    return {receive: (_index, value) => channel?.send?.(value)};
  },
};

/** `inlet~ n` and `outlet~ n`: audio crossing the component's boundary. */
function audioBoundary(direction: 'inlet' | 'outlet'): ProjectPluginFactory {
  return Object.freeze({
    id: `${OBJECT_PLUGIN_PREFIX}${direction}~`,
    version: OBJECT_PLUGIN_VERSION,
    create({record, context}: ProjectFactoryRequest): ProjectModuleInstance {
      const index = channelIndex(parseArgs(record.config));
      const boundary = context.capabilities.get(COMPONENT_BOUNDARY);
      const node = context.audio.prepare().createGain();
      const lease: ConnectionLease = direction === 'inlet'
        ? (boundary?.inlet(index)?.audio?.send(node) ?? createConnectionLease(() => {}))
        : (() => {
          const target = boundary?.outlet(index)?.input;
          if (!target) return createConnectionLease(() => {});
          node.connect(target);
          return createConnectionLease(() => { try { node.disconnect(target); } catch { /* Already disconnected. */ } });
        })();
      const port = direction === 'inlet' ? new AudioOutputPort(node, {id: 'out0'}) : undefined;
      const module: ModuleHandle = {id: record.id, getPort: name => name === 'out0' ? port : undefined};
      const registration = context.registry.register(module);
      return {
        module,
        ports: [direction === 'inlet'
          ? {id: 'out0', label: 'audio from outside', kind: 'audio', direction: 'output'}
          : {id: 'in0', label: 'audio to send outside', kind: 'audio', direction: 'input'}],
        ...(direction === 'outlet' ? {getInput: (name: string) => name === 'in0' ? node : undefined} : {}),
        exportConfig: () => record.config,
        dispose: () => { lease.release(); registration.release(); port?.dispose(); node.disconnect(); },
      };
    },
  });
}

export const BOUNDARY_DEFINITIONS: readonly ObjectDefinition[] = Object.freeze([inlet, outlet]);

/** `voice`: inside a poly, the notes allocated to this voice, on its `notes` port. */
function voicePlugin(): ProjectPluginFactory {
  return Object.freeze({
    id: `${OBJECT_PLUGIN_PREFIX}voice`,
    version: OBJECT_PLUGIN_VERSION,
    create({record, context}: ProjectFactoryRequest): ProjectModuleInstance {
      const notes = new NoteOutputPort({id: 'notes'});
      const voice = context.capabilities.get(POLY_VOICE);
      // Forward this voice's notes; a release the port never started is dropped.
      const release = voice?.notes.subscribe(event => {
        if (notes.disposed) return;
        if (event.gate !== 'on' && !notes.held.some(held => held.occurrenceId === event.occurrenceId)) return;
        notes.emit(event);
      });
      const module: ModuleHandle = {id: record.id, ports: () => [notes]};
      const registration = context.registry.register(module);
      return {
        module,
        ports: [{id: 'notes', label: `notes for voice ${voice ? voice.index + 1 : '—'}`, kind: 'note', direction: 'output'}],
        exportConfig: () => record.config,
        dispose: () => { release?.(); notes.dispose(); registration.release(); },
      };
    },
  });
}

/**
 * `inlet.note n` and `outlet.note n`: notes crossing the component's boundary;
 * `inlet.source n` and `outlet.source n`: a source (DEC-089). Inside, an
 * `inlet.source` carries whatever is cabled into the component's inlet, and
 * an `outlet.source` passes on whatever is cabled into it.
 */
function edgeBoundary(direction: 'inlet' | 'outlet', kind: 'note' | 'source'): ProjectPluginFactory {
  return Object.freeze({
    id: `${OBJECT_PLUGIN_PREFIX}${direction}.${kind}`,
    version: OBJECT_PLUGIN_VERSION,
    create({record, context}: ProjectFactoryRequest): ProjectModuleInstance {
      const index = channelIndex(parseArgs(record.config));
      const boundary = context.capabilities.get(COMPONENT_BOUNDARY);
      const inlet = direction === 'inlet' ? boundary?.inlet(index) : undefined;
      const outlet = direction === 'outlet' ? boundary?.outlet(index) : undefined;
      const port = direction === 'inlet' ? 'out0' : 'in0';
      const label = `${kind === 'note' ? 'notes' : 'a source'} ${direction === 'inlet' ? 'from' : 'to send'} outside`;
      const descriptor: ProjectPortDescriptor = {id: port, label, kind, direction: direction === 'inlet' ? 'output' : 'input'};
      const releases: (() => void)[] = [];
      let module: ModuleHandle;
      let extra: Partial<ProjectModuleInstance> = {};
      if (kind === 'note') {
        if (direction === 'inlet') {
          const notes = new NoteOutputPort({id: port});
          const release = inlet?.kind === 'note' ? inlet.notes?.subscribe(event => {
            if (notes.disposed) return;
            if (event.gate !== 'on' && !notes.held.some(held => held.occurrenceId === event.occurrenceId)) return;
            notes.emit(event);
          }) : undefined;
          releases.push(() => { release?.(); notes.dispose(); });
          module = {id: record.id, ports: () => [notes]};
        } else {
          const target = outlet?.kind === 'note' ? outlet.notes : undefined;
          const notes = new NoteInputPort({accept: event => target?.accept(event)}, {id: port, multiplicity: 'sum'});
          releases.push(() => notes.dispose());
          module = {id: record.id, ports: () => [notes]};
        }
      } else {
        module = {id: record.id};
        // An inlet carries the component's inlet relay; an outlet hands what reaches it to the outlet relay.
        extra = direction === 'inlet'
          ? {sourceOutput: name => name === port && inlet?.kind === 'source' ? inlet.source : undefined}
          : {connectSource: (name, upstream) => name === port && outlet?.kind === 'source' ? outlet.source?.follow(upstream) : undefined};
      }
      const registration = context.registry.register(module);
      return {
        module, ports: [descriptor], ...extra,
        exportConfig: () => record.config,
        dispose: () => { for (const release of releases) release(); registration.release(); },
      };
    },
  });
}

/** The component shell, its message and audio boundary objects. */
export function createComponentPlugins(environment: ObjectEnvironment = {}): readonly ProjectPluginFactory[] {
  return Object.freeze([
    componentPlugin(),
    componentPlugin({poly: true}),
    voicePlugin(),
    ...BOUNDARY_DEFINITIONS.map(definition => objectPlugin(definition, environment)),
    audioBoundary('inlet'),
    audioBoundary('outlet'),
    edgeBoundary('inlet', 'note'),
    edgeBoundary('outlet', 'note'),
    edgeBoundary('inlet', 'source'),
    edgeBoundary('outlet', 'source'),
  ]);
}
