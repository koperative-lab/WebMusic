import type {ParamDescriptor, ParamHandle} from '../module/parameter';
import type {ResolvedProcessorDefinition} from './definition';
import {preparedWasm, ProcessorUnavailableError} from './prepare';
import {processorCapabilities, ProcessorRing} from './ring';
import {PROCESSOR_PROTOCOL_VERSION, type ProcessorMessage, type ProcessorNodeOptions, type ProcessorReport} from './protocol';

/** Builds the node; injectable for tests and for applications that wrap node creation. */
export type ProcessorNodeFactory = (context: BaseAudioContext, name: string, options: AudioWorkletNodeOptions) => AudioWorkletNode;

function defaultNodeFactory(context: BaseAudioContext, name: string, options: AudioWorkletNodeOptions): AudioWorkletNode {
  const Constructor = (globalThis as {AudioWorkletNode?: typeof AudioWorkletNode}).AudioWorkletNode;
  if (typeof Constructor !== 'function') throw new ProcessorUnavailableError('AudioWorkletNode is unavailable in this environment.');
  return new Constructor(context, name, options);
}

/** @internal Shared by processor modules and processor effects. */
export function createProcessorNode(
  audio: BaseAudioContext,
  definition: ResolvedProcessorDefinition,
  options: {
    readonly config?: unknown;
    readonly baseValues: Readonly<Record<string, number>>;
    readonly createNode?: ProcessorNodeFactory;
    /** Fix every input to this channel count (an insert has exactly one input bus). */
    readonly inputChannels?: number;
    /** Give the node the definition's shared ring when memory can be shared. Default true. */
    readonly ring?: boolean;
  },
): AudioWorkletNode {
  const wasm = preparedWasm(audio, definition);
  const ring = definition.sharedRing && options.ring !== false && processorCapabilities().sharedMemory
    ? ProcessorRing.create(definition.sharedRing.capacity) : undefined;
  const processorOptions: ProcessorNodeOptions = {
    protocol: PROCESSOR_PROTOCOL_VERSION, name: definition.name, config: options.config,
    ...(wasm && {wasm}), ...(ring && {ring: ring.buffer}),
  };
  const node = (options.createNode ?? defaultNodeFactory)(audio, definition.name, {
    numberOfInputs: definition.audioInputs.length,
    numberOfOutputs: definition.audioOutputs.length,
    outputChannelCount: definition.audioOutputs.map(port => port.channels),
    ...(options.inputChannels !== undefined && {
      channelCount: options.inputChannels, channelCountMode: 'explicit' as const, channelInterpretation: 'speakers' as const,
    }),
    parameterData: {...options.baseValues},
    processorOptions,
  });
  if (ring) rings.set(node, ring);
  return node;
}

const rings = new WeakMap<AudioWorkletNode, ProcessorRing>();

/** @internal The reader side of the node's shared ring, if it has one. */
export function processorRingOf(node: AudioWorkletNode): ProcessorRing | undefined { return rings.get(node); }

/** @internal Route the processor's reports; returns the cleanup that detaches and closes its port. */
export function listenToProcessor(
  node: AudioWorkletNode,
  handlers: {
    readonly fail: (message: string) => void;
    readonly data?: (data: unknown) => void;
    readonly late?: (count: number) => void;
    readonly report?: (error: unknown) => void;
  },
): () => void {
  node.port.onmessage = event => {
    const message = event.data as ProcessorReport | undefined;
    if (message?.type === 'error') handlers.fail(String(message.message));
    else if (message?.type === 'late') handlers.late?.(Number(message.count) || 0);
    else if (message?.type === 'data' && handlers.data) {
      try { handlers.data(message.data); } catch (error) {
        try { handlers.report?.(error); } catch { /* A diagnostic cannot stop delivery. */ }
      }
    }
  };
  node.onprocessorerror = () => handlers.fail('The processor stopped with an uncaught error.');
  return () => {
    // Stop the processor now; a disconnected node otherwise keeps rendering until it is collected.
    const close: ProcessorMessage = {type: 'close'};
    node.port.postMessage(close);
    node.port.onmessage = null;
    node.onprocessorerror = null;
    node.port.close();
  };
}

/** @internal The node's AudioParam for a declared parameter, or a clear mismatch error. */
export function processorParam(node: AudioWorkletNode, definition: ResolvedProcessorDefinition, id: string): AudioParam {
  const param = node.parameters.get(id);
  if (!param) throw new Error(`Processor ${definition.name} node has no AudioParam ${id}; its worklet file may use another definition.`);
  return param;
}

function nativeModulation(descriptor: ParamDescriptor): boolean {
  return descriptor.modulation === 'audio-rate' || descriptor.modulation === 'control-rate';
}

/**
 * @internal Drive the node's `AudioParam`s from their handles, pushing each
 * binding's release onto `cleanups`. Parameters declared `audio-rate` or
 * `control-rate` bind through the handle and accept modulation; others write
 * the base value directly.
 */
export function bindProcessorParams(
  audio: BaseAudioContext,
  node: AudioWorkletNode,
  definition: ResolvedProcessorDefinition,
  handles: Iterable<ParamHandle>,
  cleanups: (() => void)[],
): void {
  for (const handle of handles) {
    const param = processorParam(node, definition, handle.descriptor.id);
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
}
