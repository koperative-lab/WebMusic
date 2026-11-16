// The object framework: one object definition becomes one project plugin
// whose module exposes numbered message inlets and outlets (DEC-075).
//
// Ownership: a plugin instance owns its ports, scheduled clock events and any
// audio node it creates, and releases them on dispose. The clock is shared
// per AudioContext and borrowed.

import {createCapabilityKey, ModuleCapabilities, type CapabilityKey} from '../module/capability';
import {
  MessageInputPort, MessageOutputPort, messageClockFor, parseMessage, atomsOf,
  type Atom, type JsonValue, type Message, type MessageClock,
} from '../module/message';
import type {ControlSignal} from '../module/param-audio';
import type {ModuleHandle} from '../module/registry';
import {ProjectModuleUnavailableError} from '../module/project-types';
import type {
  ProjectFactoryRequest, ProjectJson, ProjectJsonObject, ProjectModuleInstance, ProjectPluginFactory, ProjectPortDescriptor,
} from '../module/project-types';

export const OBJECT_PLUGIN_PREFIX = 'webmusic.object.';
export const OBJECT_PLUGIN_VERSION = '1.0.0';

/** What an interface object shows and how a control acts on it, with no DOM. */
export interface ObjectInterface {
  /** The object's name, for example `toggle`. */
  readonly kind: string;
  /** The current displayed state; its shape depends on `kind` (see the Kernel reference). */
  snapshot(): JsonValue;
  /** Notified after every change of the snapshot. */
  subscribe(listener: () => void): () => void;
  /** A user action, as an untimed message into the left inlet. */
  interact(message: Message): void;
}

/** The capability key under which an object module offers its interface. */
export const OBJECT_INTERFACE: CapabilityKey<ObjectInterface> = createCapabilityKey<ObjectInterface>('webmusic.object-interface');

/** Read an object's interface from any module handle that offers one. */
export function objectInterfaceOf(module: ModuleHandle | undefined): ObjectInterface | undefined {
  return module?.capabilities?.get(OBJECT_INTERFACE);
}

/** Shared services for every object of one plugin set. */
export interface ObjectEnvironment {
  /** Defaults to the shared clock of the module context's AudioContext. */
  readonly clock?: (context: BaseAudioContext) => MessageClock;
  /** Where `print` writes. Defaults to `console.log`. */
  readonly print?: (name: string, text: string, moduleId: string) => void;
  /** A source of uniform numbers in [0, 1) for objects without a seed. Defaults to `Math.random`. */
  readonly random?: () => number;
  /** Receives failures inside object behavior and message delivery. */
  readonly onError?: (error: unknown, moduleId: string) => void;
}

/** What a behavior can do; given to {@link ObjectDefinition.create}. */
export interface ObjectContext {
  readonly id: string;
  /** The object's arguments, parsed from `config.args`. */
  readonly args: readonly Atom[];
  /** The state the object last exported, restored on a rebuild or reopen. */
  readonly state: JsonValue | undefined;
  readonly clock: MessageClock;
  readonly environment: Required<Pick<ObjectEnvironment, 'random'>> & ObjectEnvironment;
  /** The module context's AudioContext, created on first use. */
  audio(): BaseAudioContext;
  /** Send from outlet `index`. */
  out(index: number, message: Message): void;
  /** Tell interface observers that the snapshot changed. */
  changed(): void;
  /** Whether the graph holding this object has committed. */
  readonly active: boolean;
  /** Report a failure without stopping the patch. */
  fail(error: unknown): void;
}

export interface ObjectBehavior {
  /** A message arrived at inlet `index`. */
  receive(index: number, message: Message): void;
  /** The graph committed. Start timers and fire load-time output here. */
  activate?(): void;
  /** Serializable live state, saved in the record's config. */
  state?(): JsonValue;
  /** The displayed state of an interface object. */
  snapshot?(): JsonValue;
  /** A control output for modulation cords. */
  control?: ControlSignal;
  dispose?(): void;
}

export interface PortSpec { readonly label: string }

export interface ObjectDefinition {
  readonly name: string;
  /** Inlet labels; the count may depend on the arguments. */
  inlets(args: readonly Atom[]): readonly PortSpec[];
  outlets(args: readonly Atom[]): readonly PortSpec[];
  /** True for objects whose box shows a control. */
  readonly interface?: boolean;
  /** Validate arguments before any port exists; throw a readable error. */
  check?(args: readonly Atom[]): void;
  create(context: ObjectContext): ObjectBehavior;
}

/** The inlet and outlet port IDs: `in0`, `in1`… and `out0`, `out1`…. */
export const inletId = (index: number) => `in${index}`;
export const outletId = (index: number) => `out${index}`;

/** Parse an object's `config.args` text into atoms. */
export function parseArgs(config: ProjectJsonObject): readonly Atom[] {
  const args = config.args ?? '';
  if (typeof args !== 'string') throw new TypeError('Object args must be message text.');
  return args.trim() ? atomsOf(parseMessage(args)) : [];
}

/** Make the project plugin for one definition. */
export function objectPlugin(definition: ObjectDefinition, environment: ObjectEnvironment = {}): ProjectPluginFactory {
  const env = {random: Math.random, ...environment};
  return Object.freeze({
    id: `${OBJECT_PLUGIN_PREFIX}${definition.name}`,
    version: OBJECT_PLUGIN_VERSION,
    create(request: ProjectFactoryRequest): ProjectModuleInstance {
      const {record, context} = request;
      // Bad arguments leave the object unresolved with the reason, keeping its
      // record and cords, instead of failing the whole graph.
      let args: readonly Atom[];
      try {
        args = parseArgs(record.config);
        definition.check?.(args);
        definition.inlets(args); definition.outlets(args);
      } catch (error) {
        throw new ProjectModuleUnavailableError(error instanceof Error ? error.message : String(error), {cause: error});
      }
      const fail = (error: unknown) => {
        if (env.onError) { try { env.onError(error, record.id); } catch { /* Reporting never stops a patch. */ } }
        else queueMicrotask(() => { throw error; });
      };
      const inletSpecs = definition.inlets(args), outletSpecs = definition.outlets(args);
      const outlets = outletSpecs.map((_, index) => new MessageOutputPort({id: outletId(index), onListenerError: fail}));
      // Created after the ports, whose handlers read it through the holder.
      const holder: {behavior?: ObjectBehavior} = {};
      let active = false;
      let disposed = false;
      let clock: MessageClock | undefined;
      const listeners = new Set<() => void>();
      const scheduled = new Set<() => void>();
      const audio = () => context.audio.prepare();
      const ownClock = (): MessageClock => {
        const shared = clock ??= (env.clock ?? messageClockFor)(audio());
        // Cancel everything this object scheduled when it is disposed.
        return {
          now: () => shared.now(),
          schedule: (time, callback) => {
            if (disposed) return () => {};
            const entry = {cancel: () => {}};
            const stop = () => { entry.cancel(); scheduled.delete(stop); };
            entry.cancel = shared.schedule(time, at => { scheduled.delete(stop); if (!disposed) guard(() => callback(at)); });
            scheduled.add(stop);
            return stop;
          },
        };
      };
      const guard = (work: () => void) => { try { work(); } catch (error) { fail(error); } };
      const inlets = inletSpecs.map((_, index) => new MessageInputPort(value => {
        if (!disposed && holder.behavior) guard(() => holder.behavior!.receive(index, value));
      }, {id: inletId(index)}));
      let objectClock: MessageClock | undefined;
      const objectContext: ObjectContext = {
        id: record.id,
        args,
        state: record.config.state as JsonValue | undefined,
        get clock() { return objectClock ??= ownClock(); },
        environment: env,
        audio,
        out: (index, value) => { if (!disposed) outlets[index]?.send(value); },
        changed: () => { for (const listener of [...listeners]) guard(listener); },
        get active() { return active; },
        fail,
      };
      const behavior = definition.create(objectContext);
      holder.behavior = behavior;
      const iface: ObjectInterface | undefined = definition.interface ? Object.freeze({
        kind: definition.name,
        snapshot: () => behavior.snapshot?.() ?? null,
        subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
        interact: (value: Message) => { if (!disposed) guard(() => behavior.receive(0, value)); },
      }) : undefined;
      const ports = [...inlets, ...outlets];
      const module: ModuleHandle = {
        id: record.id,
        ports: () => ports,
        ...(iface ? {capabilities: new ModuleCapabilities().with(OBJECT_INTERFACE, iface)} : {}),
      };
      const descriptors: ProjectPortDescriptor[] = [
        ...inletSpecs.map((spec, index) => ({id: inletId(index), label: spec.label, kind: 'message' as const, direction: 'input' as const})),
        ...outletSpecs.map((spec, index) => ({id: outletId(index), label: spec.label, kind: 'message' as const, direction: 'output' as const})),
        ...(behavior.control ? [{id: 'output', label: 'signal', kind: 'control' as const, direction: 'output' as const}] : []),
      ];
      return {
        module,
        ports: descriptors,
        ...(behavior.control ? {getControl: (name: string) => name === 'output' ? behavior.control : undefined} : {}),
        exportConfig: () => {
          const state = behavior.state?.();
          const {state: _previous, ...rest} = record.config;
          return state === undefined ? rest : {...rest, state: state as ProjectJson};
        },
        activate: () => { if (disposed || active) return; active = true; guard(() => behavior.activate?.()); },
        dispose: () => {
          if (disposed) return;
          disposed = true;
          for (const cancel of [...scheduled]) cancel();
          scheduled.clear();
          guard(() => behavior.dispose?.());
          for (const port of ports) port.dispose();
          listeners.clear();
        },
      };
    },
  });
}
