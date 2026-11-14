import {
  processorSignature, resolveProcessorDefinition,
  type ProcessorDefinition, type ResolvedProcessorDefinition,
} from './definition';
import {processorCapabilities} from './ring';

/** A WebAssembly binary: its URL, its bytes, or an already compiled module. */
export type ProcessorWasmSource = string | URL | ArrayBuffer | ArrayBufferView | WebAssembly.Module;

/**
 * Where a processor's code comes from. `module` is the URL of the author's
 * worklet file, supplied by the application or its bundler; Kernel never
 * guesses it. `register` is for applications that load worklets themselves
 * and is called once per context. `wasm` is compiled on the main thread during
 * preparation and handed to every node; each processor instantiates it with
 * its own memory.
 */
export type ProcessorSource =
  | {readonly module: string | URL; readonly wasm?: ProcessorWasmSource}
  | {readonly register: (context: BaseAudioContext) => void | Promise<void>; readonly wasm?: ProcessorWasmSource};

/** The context cannot host a processor: it has no `audioWorklet`. */
export class ProcessorUnavailableError extends Error {
  constructor(message = 'AudioWorklet is unavailable in this audio context.') {
    super(message);
    this.name = 'ProcessorUnavailableError';
  }
}

interface Preparation {
  readonly signature: string;
  readonly promise: Promise<void>;
  ready: boolean;
  wasm?: WebAssembly.Module;
}

// Web Audio registers processors per context and cannot unregister them, so
// the cache follows the context's lifetime and holds no strong reference to it.
const preparations = new WeakMap<BaseAudioContext, Map<string, Preparation>>();

async function compileWasm(input: ProcessorWasmSource): Promise<WebAssembly.Module> {
  const wasm = (globalThis as {WebAssembly?: typeof WebAssembly}).WebAssembly;
  if (!wasm) throw new ProcessorUnavailableError('WebAssembly is unavailable in this environment.');
  if (input instanceof wasm.Module) return input;
  if (typeof input === 'string' || input instanceof URL) {
    const response = await fetch(String(input));
    if (!response.ok) throw new Error(`Processor WebAssembly ${String(input)} failed to load (${response.status}).`);
    return wasm.compile(await response.arrayBuffer());
  }
  return wasm.compile(input as BufferSource);
}

async function load(context: BaseAudioContext, definition: ResolvedProcessorDefinition, source: ProcessorSource, entry: Preparation): Promise<void> {
  if (definition.sharedRing?.required && !processorCapabilities().sharedMemory) {
    throw new ProcessorUnavailableError(`Processor ${definition.name} requires a shared ring, which needs a cross-origin isolated page.`);
  }
  if (definition.wasm && source?.wasm === undefined) {
    throw new TypeError(`Processor ${definition.name} declares wasm, so its source needs wasm.`);
  }
  // Compile first: a broken binary must not leave a registered processor behind.
  if (source?.wasm !== undefined) entry.wasm = await compileWasm(source.wasm);
  if ('register' in source) {
    if (typeof source.register !== 'function') throw new TypeError('Processor source register must be a function.');
    await source.register(context);
    return;
  }
  if (!(typeof source?.module === 'string' && source.module) && !(source?.module instanceof URL)) {
    throw new TypeError('Processor source needs a module URL or a register function.');
  }
  const worklet = (context as {audioWorklet?: {addModule?(url: string): Promise<void>}}).audioWorklet;
  if (typeof worklet?.addModule !== 'function') throw new ProcessorUnavailableError();
  await worklet.addModule(String(source.module));
}

/**
 * Load and register a processor in one audio context. Call it before creating
 * nodes or editing an insert chain: graph edits stay synchronous, and all
 * waiting happens here.
 *
 * - Repeated and concurrent calls for the same definition share one load.
 * - A different definition under the same `id@version` rejects without loading.
 * - A failed load is forgotten, so a retry is an explicit new call. It creates
 *   and resumes no context and leaves the existing graph untouched.
 */
export function prepareProcessor(
  context: BaseAudioContext,
  definition: ProcessorDefinition | ResolvedProcessorDefinition,
  source: ProcessorSource,
): Promise<void> {
  let resolved: ResolvedProcessorDefinition, signature: string;
  try {
    if (!context || typeof context !== 'object') throw new TypeError('prepareProcessor needs an audio context.');
    resolved = resolveProcessorDefinition(definition);
    signature = processorSignature(resolved);
  } catch (error) { return Promise.reject(error); }
  const byName = preparations.get(context) ?? new Map<string, Preparation>();
  preparations.set(context, byName);
  const existing = byName.get(resolved.name);
  if (existing) {
    return existing.signature === signature ? existing.promise : Promise.reject(new Error(
      `Processor ${resolved.name} is already prepared in this context with a different definition; change its version.`,
    ));
  }
  // The entry exists before loading starts, so the load can record its compiled module.
  const entry = {signature, ready: false, wasm: undefined} as {-readonly [K in keyof Preparation]: Preparation[K]};
  entry.promise = load(context, resolved, source, entry).then(
    () => { entry.ready = true; },
    (error: unknown) => {
      if (byName.get(resolved.name) === entry) byName.delete(resolved.name);
      throw error;
    },
  );
  byName.set(resolved.name, entry);
  return entry.promise;
}

/** Whether this exact definition finished preparing in this context. */
export function isProcessorPrepared(context: BaseAudioContext, definition: ProcessorDefinition | ResolvedProcessorDefinition): boolean {
  const resolved = resolveProcessorDefinition(definition);
  const entry = preparations.get(context)?.get(resolved.name);
  return entry?.ready === true && entry.signature === processorSignature(resolved);
}

/** @internal The compiled module prepared for this definition in this context. */
export function preparedWasm(context: BaseAudioContext, definition: ResolvedProcessorDefinition): WebAssembly.Module | undefined {
  return preparations.get(context)?.get(definition.name)?.wasm;
}
