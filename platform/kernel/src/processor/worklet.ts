import {
  processorAudioParams, resolveProcessorDefinition,
  type ProcessorAudioParamDescriptor, type ProcessorDefinition, type ResolvedProcessorDefinition,
} from './definition';
import {PROCESSOR_PROTOCOL_VERSION, type ProcessorMessage, type ProcessorNodeOptions, type ProcessorReport} from './protocol';

// Audio-thread authoring kit. An author's worklet file imports this entry and
// calls defineProcessor(); the author's bundler emits the worklet file. Nothing
// here touches a global at import time, so the entry stays importable in Node,
// SSR and on the main thread.

/**
 * One render quantum. The object and its arrays are reused between calls:
 * read and write them only inside `process`, and never keep a reference.
 */
export interface ProcessorBlock {
  /** `inputs[port][channel]`; a disconnected port has no channels. */
  inputs: readonly (readonly Float32Array[])[];
  /** `outputs[port][channel]`, zero-filled before each call. */
  outputs: readonly (readonly Float32Array[])[];
  /**
   * `params[id]` holds one value for a k-rate parameter, or for an a-rate
   * parameter that is constant in this block, and one value per frame
   * otherwise. Automation and connected modulators are already summed in.
   */
  params: Readonly<Record<string, Float32Array>>;
  /** Absolute frame of the block's first sample; `frame / sampleRate` is audio reference time. */
  frame: number;
  sampleRate: number;
}

/** What `create` receives. Allocate every buffer, table and voice here. */
export interface ProcessorSetup {
  readonly definition: ResolvedProcessorDefinition;
  readonly sampleRate: number;
  /** The `config` the module was created with, if any. */
  readonly config: unknown;
  /** Post an author-defined observation to the main thread. Not for per-block use. */
  report(data: unknown): void;
}

/**
 * The author's DSP. `process` runs on the audio thread once per render
 * quantum: it must not allocate, create closures or strings, or post messages.
 */
export interface ProcessorImplementation<State> {
  create(setup: ProcessorSetup): State;
  process(state: State, block: ProcessorBlock): void;
  /** Non-real-time configuration posted by the module. */
  message?(state: State, data: unknown): void;
}

interface WorkletPort {
  onmessage: ((event: {data: unknown}) => void) | null;
  postMessage(message: unknown): void;
}

/** The part of `AudioWorkletGlobalScope` the kit uses; injectable for tests. */
export interface ProcessorWorkletScope {
  registerProcessor(name: string, processor: unknown): void;
  AudioWorkletProcessor: new () => {readonly port: WorkletPort};
  readonly currentFrame: number;
  readonly sampleRate: number;
}

function workletScope(): ProcessorWorkletScope {
  const scope = globalThis as unknown as Partial<ProcessorWorkletScope>;
  if (typeof scope.registerProcessor !== 'function' || typeof scope.AudioWorkletProcessor !== 'function') {
    throw new Error('defineProcessor must run inside an AudioWorklet module loaded by prepareProcessor.');
  }
  return scope as ProcessorWorkletScope;
}

/**
 * Register a processor for `definition` in the current worklet scope. Call it
 * once at the top level of the worklet file, with the same definition object
 * the main thread passes to `prepareProcessor`.
 *
 * If `create` or `process` throws, the processor reports the error once, goes
 * silent and stops; it does not restart itself.
 */
export function defineProcessor<State>(
  definition: ProcessorDefinition | ResolvedProcessorDefinition,
  implementation: ProcessorImplementation<State>,
  scope: ProcessorWorkletScope = workletScope(),
): void {
  const resolved = resolveProcessorDefinition(definition);
  if (typeof implementation?.create !== 'function' || typeof implementation.process !== 'function') {
    throw new TypeError('A processor implementation needs create() and process().');
  }
  const parameterDescriptors: readonly ProcessorAudioParamDescriptor[] = processorAudioParams(resolved);

  class AuthoredProcessor extends scope.AudioWorkletProcessor {
    static get parameterDescriptors(): readonly ProcessorAudioParamDescriptor[] { return parameterDescriptors; }

    #state: State | undefined;
    #failed = false;
    readonly #block: ProcessorBlock = {inputs: [], outputs: [], params: {}, frame: 0, sampleRate: scope.sampleRate};

    constructor(options?: {processorOptions?: ProcessorNodeOptions}) {
      super();
      const node = options?.processorOptions;
      const post = (report: ProcessorReport): void => this.port.postMessage(report);
      try {
        if (node && node.protocol !== PROCESSOR_PROTOCOL_VERSION) {
          throw new Error(`Processor ${resolved.name} speaks protocol ${PROCESSOR_PROTOCOL_VERSION}; its module sent ${node.protocol}.`);
        }
        this.#state = implementation.create({
          definition: resolved,
          sampleRate: scope.sampleRate,
          config: node?.config,
          report: data => post({type: 'data', data}),
        });
      } catch (error) { this.#fail(error); }
      this.port.onmessage = event => {
        const message = event.data as ProcessorMessage | undefined;
        if (this.#failed || !message || message.type !== 'config' || !implementation.message) return;
        try { implementation.message(this.#state as State, message.data); } catch (error) { this.#fail(error); }
      };
    }

    process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>): boolean {
      if (this.#failed) return false;
      const block = this.#block;
      block.inputs = inputs;
      block.outputs = outputs;
      block.params = parameters;
      block.frame = scope.currentFrame;
      try {
        implementation.process(this.#state as State, block);
      } catch (error) {
        for (const port of outputs) for (const channel of port) channel.fill(0);
        this.#fail(error);
        return false;
      }
      return true;
    }

    #fail(error: unknown): void {
      if (this.#failed) return;
      this.#failed = true;
      const report: ProcessorReport = {type: 'error', message: error instanceof Error ? error.message : String(error)};
      try { this.port.postMessage(report); } catch { /* The main thread may already be gone. */ }
    }
  }

  scope.registerProcessor(resolved.name, AuthoredProcessor);
}
