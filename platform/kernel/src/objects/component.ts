// Nested components (DEC-076): a component inside a component, as a Max
// subpatch. The project already nests contexts; a `component` object owns a
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
import type {ModuleHandle} from '../module/registry';
import {routeModuleOutput} from '../module/context';
import {
  ProjectModuleUnavailableError,
  type ProjectFactoryRequest, type ProjectModuleInstance, type ProjectPluginFactory, type ProjectPortDescriptor,
} from '../module/project-types';
import {OBJECT_PLUGIN_PREFIX, OBJECT_PLUGIN_VERSION, inletId, outletId, objectPlugin, parseArgs, type ObjectDefinition, type ObjectEnvironment} from './core';

export type BoundaryKind = 'message' | 'audio';

/** One inlet channel, seen from inside the component. */
export interface BoundaryInlet {
  readonly kind: BoundaryKind;
  /** Messages arriving at the component's inlet. */
  readonly messages?: MessageOutputPort;
  /** Audio arriving at the component's inlet. */
  readonly audio?: AudioOutputPort;
}
/** One outlet channel, seen from inside the component. */
export interface BoundaryOutlet {
  readonly kind: BoundaryKind;
  /** Send a message out of the component's outlet. */
  send?(message: Message): void;
  /** Connect audio here to leave through the component's outlet. */
  readonly input?: AudioNode;
}
/** What a component lends its child context. */
export interface ComponentBoundary {
  inlet(index: number): BoundaryInlet | undefined;
  outlet(index: number): BoundaryOutlet | undefined;
}

export const COMPONENT_BOUNDARY: CapabilityKey<ComponentBoundary> = createCapabilityKey<ComponentBoundary>('webmusic.component-boundary');
export const COMPONENT_PLUGIN = `${OBJECT_PLUGIN_PREFIX}component`;

function kinds(value: unknown, name: string): BoundaryKind[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some(item => item !== 'message' && item !== 'audio')) {
    throw new ProjectModuleUnavailableError(`component ${name} must list message or audio channels.`);
  }
  return value as BoundaryKind[];
}

/**
 * The component shell. `config.inlets` and `config.outlets` list each
 * channel's kind in order; the editor keeps them in step with the `inlet`
 * and `outlet` objects inside. The record that owns the child context is the
 * component; its contents are the modules of that context.
 */
export function componentPlugin(): ProjectPluginFactory {
  return Object.freeze({
    id: COMPONENT_PLUGIN,
    version: OBJECT_PLUGIN_VERSION,
    create({record, context}: ProjectFactoryRequest): ProjectModuleInstance {
      const inletKinds = kinds(record.config.inlets, 'inlets');
      const outletKinds = kinds(record.config.outlets, 'outlets');
      const leases: ConnectionLease[] = [];
      const disposers: (() => void)[] = [];
      let audioContext: BaseAudioContext | undefined;
      const audio = () => audioContext ??= context.audio.prepare();

      const inlets = inletKinds.map((kind, index) => {
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
        ...inlets.flatMap(item => 'port' in item && item.port ? [item.port] : []),
        ...outlets.flatMap(item => item.kind === 'message' && 'port' in item ? [item.port as MessageOutputPort] : []),
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
        ...inletKinds.map((kind, index) => ({id: inletId(index), label: `${kind} in ${index + 1}`, kind, direction: 'input' as const})),
        ...outletKinds.map((kind, index) => ({id: outletId(index), label: `${kind} out ${index + 1}`, kind, direction: 'output' as const})),
      ];
      return {
        module,
        ports: descriptors,
        getInput: name => inlets.find((item, index) => item.kind === 'audio' && inletId(index) === name)?.node,
        // Inner modules keep the parent's destination and admission, so an
        // object not wired to an outlet~ sounds through the parent's default route.
        childContext: child => child.derive({id: child.id, registry: child.registry, capabilities: child.capabilities.with(COMPONENT_BOUNDARY, boundary)}),
        exportConfig: () => record.config,
        dispose: () => {
          if (disposed) return;
          disposed = true;
          for (const lease of leases.splice(0)) lease.release();
          registration.release();
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

/** The component shell, its message and audio boundary objects. */
export function createComponentPlugins(environment: ObjectEnvironment = {}): readonly ProjectPluginFactory[] {
  return Object.freeze([
    componentPlugin(),
    ...BOUNDARY_DEFINITIONS.map(definition => objectPlugin(definition, environment)),
    audioBoundary('inlet'),
    audioBoundary('outlet'),
  ]);
}
