import type {ModuleContext} from '../module/context';
import {routeModuleOutput} from '../module/context';
import {AudioInputPort, AudioOutputPort} from '../module/audio-port';
import {createControlPort, type ControlPort} from '../module/control-port';
import type {ConnectionLease} from '../module/lease';
import {ParamHandle, ParamSurface, type ParamDescriptor} from '../module/parameter';
import {PortListeners} from '../module/port';
import type {ModuleHandle, ModulePort} from '../module/registry';
import {resolveProcessorDefinition, type ProcessorDefinition, type ResolvedProcessorDefinition} from './definition';
import {isProcessorPrepared, ProcessorUnavailableError} from './prepare';
import {PROCESSOR_PROTOCOL_VERSION, type ProcessorMessage, type ProcessorNodeOptions, type ProcessorReport} from './protocol';

/** Builds the node; injectable for tests and for applications that wrap node creation. */
export type ProcessorNodeFactory = (context: BaseAudioContext, name: string, options: AudioWorkletNodeOptions) => AudioWorkletNode;

export interface ProcessorModuleOptions {
  /** Module ID; immutable for the module's life and unique in its registry. */
  readonly id: string;
  /** Structured-cloneable value handed to the processor's `create` as `setup.config`. */
  readonly config?: unknown;
  /** Initial base values by parameter ID; omitted parameters start at their default. */
  readonly params?: Readonly<Record<string, number>>;
  /**
   * `default` (the default) routes the first audio output through the
   * context's admission or default destination. `none` leaves every output
   * unrouted for explicit patching.
   */
  readonly route?: 'default' | 'none';
  readonly createNode?: ProcessorNodeFactory;
  /** Author-defined observations the processor posts through `setup.report`. */
  readonly onReport?: (data: unknown) => void;
  readonly onCleanupError?: (error: unknown) => void;
}

/** `ready` until the processor fails (`error`) or the module is disposed (`detached`, terminal). */
export type ProcessorModuleState = 'ready' | 'error' | 'detached';

function defaultNodeFactory(context: BaseAudioContext, name: string, options: AudioWorkletNodeOptions): AudioWorkletNode {
  const Constructor = (globalThis as {AudioWorkletNode?: typeof AudioWorkletNode}).AudioWorkletNode;
  if (typeof Constructor !== 'function') throw new ProcessorUnavailableError('AudioWorkletNode is unavailable in this environment.');
  return new Constructor(context, name, options);
}

function nativeModulation(descriptor: ParamDescriptor): boolean {
  return descriptor.modulation === 'audio-rate' || descriptor.modulation === 'control-rate';
}

/**
 * An authored DSP processor as a module: one `AudioWorkletNode`, typed audio
 * input and output ports, and a parameter surface whose handles drive the
 * node's `AudioParam`s. The module owns its node, ports, parameter handles,
 * route and registration; it borrows the context and never closes it.
 *
 * Create it with {@link createProcessorModule} after `prepareProcessor` has
 * resolved in the same audio context.
 */
export class ProcessorModule implements ModuleHandle {
  readonly id: string;
  readonly definition: ResolvedProcessorDefinition;
  readonly node: AudioWorkletNode;
  readonly params: ParamSurface;
  /** Declared processing latency, `latencySamples / sampleRate`; never measured. */
  readonly latencySeconds: number;
  readonly #inputs: readonly AudioInputPort[];
  readonly #outputs: readonly AudioOutputPort[];
  readonly #ports: readonly ModulePort[];
  readonly #cleanups: (() => void)[];
  readonly #listeners: PortListeners<void>;
  readonly #onCleanupError?: (error: unknown) => void;
  #state: ProcessorModuleState = 'ready';
  #error?: string;

  /** @internal Use {@link createProcessorModule}. */
  constructor(parts: {
    id: string;
    definition: ResolvedProcessorDefinition;
    node: AudioWorkletNode;
    params: ParamSurface;
    latencySeconds: number;
    inputs: readonly AudioInputPort[];
    outputs: readonly AudioOutputPort[];
    control?: ControlPort;
    cleanups: (() => void)[];
    onCleanupError?: (error: unknown) => void;
  }) {
    this.id = parts.id;
    this.definition = parts.definition;
    this.node = parts.node;
    this.params = parts.params;
    this.latencySeconds = parts.latencySeconds;
    this.#inputs = parts.inputs;
    this.#outputs = parts.outputs;
    this.#ports = Object.freeze([...parts.inputs, ...parts.outputs, ...(parts.control ? [parts.control] : [])]);
    this.#cleanups = parts.cleanups;
    this.#onCleanupError = parts.onCleanupError;
    this.#listeners = new PortListeners<void>(parts.onCleanupError);
  }

  get state(): ProcessorModuleState { return this.#state; }
  /** The processor's failure message while `state` is `error`. */
  get error(): string | undefined { return this.#error; }

  /** Every port, in definition order: audio inputs, audio outputs, then `params` when the definition has parameters. */
  ports(): readonly ModulePort[] { return this.#ports; }
  /** An audio output by its definition ID. */
  getPort(name: string): AudioOutputPort | undefined { return this.#outputs.find(port => port.id === name); }
  /** An audio input by its definition ID. */
  getInput(name: string): AudioInputPort | undefined { return this.#inputs.find(port => port.id === name); }

  /** Post configuration to the processor's `message` callback. Not for per-block control; use parameters. */
  configure(data: unknown): void {
    if (this.#state === 'detached') throw new Error('Processor module is disposed.');
    const message: ProcessorMessage = {type: 'config', data};
    this.node.port.postMessage(message);
  }

  /** Called after a state change. */
  subscribe(listener: () => void): () => void {
    if (this.#state === 'detached') return () => {};
    return this.#listeners.add(listener);
  }

  /**
   * Release routes, registration, ports, parameter bindings and the node, in
   * reverse order of acquisition. Continues after an individual failure and is
   * safe to repeat. The audio context stays open.
   */
  dispose(): void {
    if (this.#state === 'detached') return;
    this.#state = 'detached';
    this.#error = undefined;
    for (const cleanup of this.#cleanups.splice(0).reverse()) {
      try { cleanup(); } catch (error) { this.#report(error); }
    }
    this.#listeners.emit();
    this.#listeners.clear();
  }

  /** @internal Processor failure; routes stay so the graph remains valid and silent on this branch. */
  fail(message: string): void {
    if (this.#state !== 'ready') return;
    this.#state = 'error';
    this.#error = message;
    this.#listeners.emit();
  }

  #report(error: unknown): void {
    try { this.#onCleanupError?.(error); } catch { /* Cleanup continues. */ }
  }
}

/**
 * Create a processor module in `context`. The definition must already be
 * prepared in the context's audio environment (`prepareProcessor` resolved);
 * otherwise this throws without creating a node.
 *
 * Each audio input gets a stable entry node with the declared channel count,
 * so producers are up- or down-mixed explicitly. Each output gets its own port.
 * Parameters declared `audio-rate` or `control-rate` bind to the node's
 * `AudioParam`s through their handles and accept modulation; other parameters
 * write the `AudioParam` directly.
 *
 * Note input and transport are not available on processor modules yet; a
 * definition requesting either is rejected.
 */
export function createProcessorModule(
  context: ModuleContext,
  definition: ProcessorDefinition | ResolvedProcessorDefinition,
  options: ProcessorModuleOptions,
): ProcessorModule {
  const resolved = resolveProcessorDefinition(definition);
  if (resolved.noteInput) throw new TypeError(`Processor ${resolved.name} requests note input, which processor modules do not support yet.`);
  if (resolved.transport) throw new TypeError(`Processor ${resolved.name} requests transport, which processor modules do not support yet.`);
  if (typeof options?.id !== 'string') throw new TypeError('Processor module needs an id.');
  const route = options.route ?? 'default';
  if (route !== 'default' && route !== 'none') throw new TypeError(`Unknown processor route: ${String(route)}`);
  const audio = context.audio.peek();
  if (!audio) throw new Error('Processor module needs a prepared audio context; prepare the environment and the processor first.');
  if (!isProcessorPrepared(audio, resolved)) {
    throw new Error(`Processor ${resolved.name} is not prepared in this audio context; await prepareProcessor first.`);
  }
  const initial = options.params ?? {};
  for (const key of Object.keys(initial)) {
    if (!resolved.params.some(param => param.id === key)) throw new TypeError(`Processor ${resolved.name} has no parameter ${key}.`);
  }
  const handles: ParamHandle[] = [];
  const cleanups: (() => void)[] = [];
  const rollback = (error: unknown): never => {
    for (const cleanup of cleanups.splice(0).reverse()) {
      try { cleanup(); } catch { /* Preserve the construction failure. */ }
    }
    throw error;
  };
  try {
    for (const descriptor of resolved.params) {
      const handle = new ParamHandle(descriptor, {baseValue: initial[descriptor.id]});
      handles.push(handle);
      cleanups.push(() => handle.dispose());
    }
    const nodeOptions: ProcessorNodeOptions = {protocol: PROCESSOR_PROTOCOL_VERSION, name: resolved.name, config: options.config};
    const node = (options.createNode ?? defaultNodeFactory)(audio, resolved.name, {
      numberOfInputs: resolved.audioInputs.length,
      numberOfOutputs: resolved.audioOutputs.length,
      outputChannelCount: resolved.audioOutputs.map(port => port.channels),
      parameterData: Object.fromEntries(handles.map(handle => [handle.descriptor.id, handle.snapshot.baseValue])),
      processorOptions: nodeOptions,
    });
    cleanups.push(() => node.disconnect());
    cleanups.push(() => {
      node.port.onmessage = null;
      node.onprocessorerror = null;
      node.port.close();
    });

    for (const handle of handles) {
      const param = node.parameters.get(handle.descriptor.id);
      if (!param) throw new Error(`Processor ${resolved.name} node has no AudioParam ${handle.descriptor.id}; its worklet file may use another definition.`);
      if (nativeModulation(handle.descriptor)) {
        const lease = handle.bindAudioParam(audio, param, {lazy: true});
        cleanups.push(() => lease.release());
      } else {
        param.value = handle.snapshot.baseValue;
        const stop = handle.subscribe(snapshot => {
          if (!snapshot.disposed) param.setValueAtTime(snapshot.baseValue, audio.currentTime);
        });
        cleanups.push(stop);
      }
    }

    const latencySeconds = resolved.latencySamples / audio.sampleRate;
    const inputs = resolved.audioInputs.map((port, index) => {
      const entry = audio.createGain();
      entry.channelCount = port.channels;
      entry.channelCountMode = 'explicit';
      entry.channelInterpretation = 'speakers';
      entry.connect(node, 0, index);
      cleanups.push(() => entry.disconnect());
      const input = new AudioInputPort(entry, {id: port.id, latencySeconds});
      cleanups.push(() => input.dispose());
      return input;
    });
    const outputs = resolved.audioOutputs.map((port, index) => {
      const exit = audio.createGain();
      node.connect(exit, index, 0);
      cleanups.push(() => exit.disconnect());
      const output = new AudioOutputPort(exit, {id: port.id, onCleanupError: options.onCleanupError});
      cleanups.push(() => output.dispose());
      return output;
    });
    const params = new ParamSurface(handles);
    const created = new ProcessorModule({
      id: options.id, definition: resolved, node, params, latencySeconds, inputs, outputs,
      control: handles.length ? createControlPort(params) : undefined,
      cleanups, onCleanupError: options.onCleanupError,
    });

    node.port.onmessage = event => {
      const report = event.data as ProcessorReport | undefined;
      if (report?.type === 'error') created.fail(String(report.message));
      else if (report?.type === 'data') {
        try { options.onReport?.(report.data); } catch (error) {
          try { options.onCleanupError?.(error); } catch { /* A diagnostic cannot stop delivery. */ }
        }
      }
    };
    node.onprocessorerror = () => created.fail('The processor stopped with an uncaught error.');

    const registration: ConnectionLease = context.registry.register(created);
    cleanups.push(() => registration.release());
    if (route === 'default') {
      const lease = routeModuleOutput(context, created, outputs[0]);
      cleanups.push(() => lease.release());
    }
    return created;
  } catch (error) {
    // The module shares this cleanup list, so a late failure also releases what it holds.
    return rollback(error);
  }
}
