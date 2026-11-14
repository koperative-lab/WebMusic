import {ParamHandle, ParamSurface} from '../module/parameter';
import {resolveProcessorDefinition, type ProcessorDefinition, type ResolvedProcessorDefinition} from './definition';
import {bindProcessorParams, createProcessorNode, listenToProcessor, processorRingOf, type ProcessorNodeFactory} from './node';
import type {ProcessorRing} from './ring';
import {isProcessorPrepared} from './prepare';
import {PROCESSOR_IMMEDIATE_FRAME, type ProcessorNoteMessage} from './protocol';

export interface ProcessorInstrumentOptions {
  /**
   * Borrowed handles for the declared parameters, for a surface that outlives
   * one node (an adapter that reconnects). Each declared ID needs a handle with
   * the same modulation. The instrument binds them to its node and releases
   * only those bindings; the owner keeps them and calls `releaseAudio(context)`
   * when it leaves the context. Absent, the instrument creates and owns handles.
   */
  readonly params?: ParamSurface;
  /** Initial base values for owned handles. Ignored with borrowed `params`. */
  readonly values?: Readonly<Record<string, number>>;
  /** Structured-cloneable value handed to the processor's `create`. */
  readonly config?: unknown;
  readonly createNode?: ProcessorNodeFactory;
  /** The processor failed: it is silent from now on. Called once. */
  readonly onError?: (message: string) => void;
  /** Note changes the processor played after their frame since the previous report. */
  readonly onLateNotes?: (count: number) => void;
  /** Author-defined observations from the processor. */
  readonly onReport?: (data: unknown) => void;
}

/** `ready` until the processor fails (`error`) or the instrument is disposed (`detached`, terminal). */
export type ProcessorInstrumentState = 'ready' | 'error' | 'detached';

/**
 * A note-input processor played directly on the audio clock, for adapters
 * whose callers already speak in AudioContext seconds and note occurrences,
 * such as a synth backend. One `AudioWorkletNode`; `node` is its output, which
 * the owner connects. No ports, registry or Session: a graph member uses
 * `createProcessorModule` instead.
 *
 * Each `start` returns a new occurrence; `release` and `cancel` name it.
 * A time at or before `currentTime` applies at the next block. A later
 * `release` replaces one still queued, so a scheduled end can move earlier or
 * later until it is reached; after that the note is already releasing.
 * `cancel` before the onset withdraws the note so it never sounds.
 */
export class ProcessorInstrument {
  readonly definition: ResolvedProcessorDefinition;
  readonly node: AudioWorkletNode;
  readonly params: ParamSurface;
  readonly #audio: BaseAudioContext;
  readonly #cleanups: (() => void)[];
  #next = 1;
  #state: ProcessorInstrumentState = 'ready';
  #error?: string;
  #lateNotes = 0;

  /** @internal Use {@link createProcessorInstrument}. */
  constructor(parts: {
    audio: BaseAudioContext;
    definition: ResolvedProcessorDefinition;
    node: AudioWorkletNode;
    params: ParamSurface;
    cleanups: (() => void)[];
  }) {
    this.#audio = parts.audio;
    this.definition = parts.definition;
    this.node = parts.node;
    this.params = parts.params;
    this.#cleanups = parts.cleanups;
  }

  /** The reader side of the node's shared ring; absent unless the definition requests one and memory can be shared. */
  get ring(): ProcessorRing | undefined { return processorRingOf(this.node); }
  get state(): ProcessorInstrumentState { return this.#state; }
  get error(): string | undefined { return this.#error; }
  /** Note changes played after their frame, as reported so far. */
  get lateNotes(): number { return this.#lateNotes; }

  /** Start a note at `time` (AudioContext seconds) and return its occurrence. */
  start(midi: number, velocity: number, time: number, cents = 0): number {
    if (!Number.isFinite(midi) || midi < 0 || midi > 127) throw new RangeError('midi must be within 0–127');
    if (!Number.isFinite(velocity) || velocity < 0 || velocity > 1) throw new RangeError('velocity must be within 0–1');
    if (!Number.isFinite(cents)) throw new RangeError('cents must be finite');
    const occurrence = this.#next++;
    this.#post('on', occurrence, time, midi, cents, velocity);
    return occurrence;
  }

  /** Release `occurrence` at `time`, replacing a release still queued. */
  release(occurrence: number, time: number): void { this.#post('off', occurrence, time); }

  /** Stop `occurrence` at `time` without a release phase; before its onset, it never sounds. */
  cancel(occurrence: number, time: number): void { this.#post('cancel', occurrence, time); }

  /**
   * Stop the processor and release its node and parameter bindings, in
   * reverse order of acquisition. Continues after an individual failure,
   * rethrows the first, and is safe to repeat. The audio context stays open.
   */
  dispose(): void {
    if (this.#state === 'detached') return;
    this.#state = 'detached';
    this.#error = undefined;
    let failure: unknown;
    for (const cleanup of this.#cleanups.splice(0).reverse()) {
      try { cleanup(); } catch (error) { failure ??= error; }
    }
    if (failure !== undefined) throw failure;
  }

  /** @internal */
  fail(message: string): boolean {
    if (this.#state !== 'ready') return false;
    this.#state = 'error';
    this.#error = message;
    return true;
  }

  /** @internal */
  late(count: number): boolean {
    if (this.#state === 'detached' || count <= 0) return false;
    this.#lateNotes += count;
    return true;
  }

  #post(gate: ProcessorNoteMessage['gate'], occurrence: number, time: number, midi = 0, cents = 0, velocity = 0): void {
    if (this.#state === 'detached') throw new Error('Processor instrument is disposed.');
    if (!Number.isInteger(occurrence) || occurrence < 1) throw new TypeError('occurrence must be one returned by start()');
    if (!Number.isFinite(time)) throw new RangeError('time must be finite');
    const audio = this.#audio;
    const message: ProcessorNoteMessage = {
      type: 'note', gate, occurrence, midi, cents, velocity, epoch: 0,
      frame: time <= audio.currentTime ? PROCESSOR_IMMEDIATE_FRAME : Math.round(time * audio.sampleRate),
    };
    this.node.port.postMessage(message);
  }
}

/**
 * Create a processor instrument in `audio`. The definition must declare
 * `noteInput` and already be prepared in that context (`prepareProcessor`
 * resolved); otherwise this throws without creating a node. Declared audio
 * inputs stay unconnected; `block.transport`, if declared, reports stopped.
 */
export function createProcessorInstrument(
  audio: BaseAudioContext,
  definition: ProcessorDefinition | ResolvedProcessorDefinition,
  options: ProcessorInstrumentOptions = {},
): ProcessorInstrument {
  const resolved = resolveProcessorDefinition(definition);
  if (!resolved.noteInput) throw new TypeError(`Processor ${resolved.name} has no note input, so it cannot be an instrument.`);
  if (!isProcessorPrepared(audio, resolved)) {
    throw new Error(`Processor ${resolved.name} is not prepared in this audio context; await prepareProcessor first.`);
  }
  const borrowed = options.params;
  const handles: ParamHandle[] = [];
  const cleanups: (() => void)[] = [];
  if (borrowed) {
    for (const descriptor of resolved.params) {
      const handle = borrowed.get(descriptor.id);
      if (!handle) throw new TypeError(`Processor ${resolved.name} parameter ${descriptor.id} has no handle in params.`);
      if ((handle.descriptor.modulation ?? 'none') !== (descriptor.modulation ?? 'none')) {
        throw new TypeError(`Processor ${resolved.name} parameter ${descriptor.id} needs a handle with ${descriptor.modulation ?? 'no'} modulation.`);
      }
      handles.push(handle);
    }
  } else {
    const values = options.values ?? {};
    for (const key of Object.keys(values)) {
      if (!resolved.params.some(param => param.id === key)) throw new TypeError(`Processor ${resolved.name} has no parameter ${key}.`);
    }
    for (const descriptor of resolved.params) {
      const handle = new ParamHandle(descriptor, {baseValue: values[descriptor.id]});
      handles.push(handle);
      cleanups.push(() => handle.dispose());
    }
  }
  try {
    const node = createProcessorNode(audio, resolved, {
      config: options.config, createNode: options.createNode,
      baseValues: Object.fromEntries(handles.map(handle => [handle.descriptor.id, handle.snapshot.baseValue])),
    });
    cleanups.push(() => node.disconnect());
    const owner: {instrument?: ProcessorInstrument} = {};
    cleanups.push(listenToProcessor(node, {
      fail: message => { if (owner.instrument?.fail(message)) options.onError?.(message); },
      late: count => { if (owner.instrument?.late(count)) options.onLateNotes?.(count); },
      data: options.onReport,
    }));
    bindProcessorParams(audio, node, resolved, handles, cleanups);
    const instrument = new ProcessorInstrument({
      audio, definition: resolved, node, cleanups,
      params: borrowed ?? new ParamSurface(handles),
    });
    owner.instrument = instrument;
    return instrument;
  } catch (error) {
    for (const cleanup of cleanups.splice(0).reverse()) {
      try { cleanup(); } catch { /* Preserve the construction failure. */ }
    }
    throw error;
  }
}
