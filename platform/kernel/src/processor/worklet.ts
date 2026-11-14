import {
  processorAudioParams, resolveProcessorDefinition,
  type ProcessorAudioParamDescriptor, type ProcessorDefinition, type ResolvedProcessorDefinition,
} from './definition';
import {
  PROCESSOR_IMMEDIATE_FRAME, PROCESSOR_PROTOCOL_VERSION,
  type ProcessorMessage, type ProcessorNodeOptions, type ProcessorNoteMessage, type ProcessorReport,
} from './protocol';

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

/**
 * One gate change of one note occurrence, delivered just before the `process`
 * call of the block it falls in. The object is reused: copy what you keep.
 */
export interface ProcessorNoteEvent {
  gate: 'on' | 'off' | 'cancel';
  /** Small integer, stable while the note is held; `off` and `cancel` name the `on` they end. */
  occurrence: number;
  midi: number;
  cents: number;
  /** Normalized 0–1. */
  velocity: number;
  /** Frame within the coming block (0 to block length − 1) at which the change applies. */
  frameOffset: number;
  epoch: number;
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
 * The author's DSP. `process` and `note` run on the audio thread once per
 * render quantum: they must not allocate, create closures or strings, or post
 * messages.
 */
export interface ProcessorImplementation<State> {
  create(setup: ProcessorSetup): State;
  process(state: State, block: ProcessorBlock): void;
  /**
   * Required when the definition declares `noteInput`. Called in time order
   * for every note change in the coming block, before `process`. `cancel`
   * means stop at once, without a release phase.
   */
  note?(state: State, event: ProcessorNoteEvent): void;
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

/** Render quantum length when a processor has no output channel to measure. */
const QUANTUM = 128;

/**
 * Pending note changes in frame order. All allocation happens on message
 * arrival; dispatch inside `process` only advances an index and touches a Set.
 */
class NoteQueue {
  #events: ProcessorNoteMessage[] = [];
  #head = 0;
  /** The newest scheduling epoch seen; older `on` changes are stale. */
  #epoch = 0;

  /** Admit one change. Returns false when it is stale or ends nothing. */
  admit(message: ProcessorNoteMessage, active: ReadonlySet<number>): boolean {
    if (this.#head > 0) {
      this.#events.splice(0, this.#head);
      this.#head = 0;
    }
    if (message.epoch > this.#epoch) {
      this.#epoch = message.epoch;
      // Withdraw onsets from older epochs that have not sounded. Releases stay:
      // they only end notes, and a released note must not hang.
      this.#events = this.#events.filter(event => event.gate !== 'on' || event.epoch >= message.epoch);
    }
    if (message.gate === 'on') {
      if (message.epoch < this.#epoch) return false;
    } else if (message.gate === 'cancel' && !active.has(message.occurrence)) {
      // Cancelled before its onset: withdraw it entirely, so it never sounds.
      this.#events = this.#events.filter(event => event.occurrence !== message.occurrence);
      return false;
    }
    if (message.gate !== 'on') {
      // A release never overtakes its own onset, even with an earlier time:
      // it takes the onset's frame instead.
      for (let last = this.#events.length - 1; last >= 0; last--) {
        const onset = this.#events[last];
        if (onset.occurrence !== message.occurrence) continue;
        if (onset.frame > message.frame) message = {...message, frame: onset.frame};
        break;
      }
    }
    let index = this.#events.length;
    while (index > 0 && this.#events[index - 1].frame > message.frame) index--;
    this.#events.splice(index, 0, message);
    return true;
  }

  /** The next change due before `end`, or undefined. */
  next(end: number): ProcessorNoteMessage | undefined {
    const event = this.#events[this.#head];
    if (event === undefined || event.frame >= end) return undefined;
    this.#head++;
    return event;
  }
}

/**
 * Register a processor for `definition` in the current worklet scope. Call it
 * once at the top level of the worklet file, with the same definition object
 * the main thread passes to `prepareProcessor`.
 *
 * If `create`, `note` or `process` throws, the processor reports the error
 * once, goes silent and stops; it does not restart itself.
 *
 * With `noteInput`, the kit keeps a queue of note changes sorted by frame and
 * delivers each one to `note` before the `process` call of its block, with
 * its frame offset. A change that arrives after its frame plays at the start
 * of the next block and is counted (a late `cancel` is not counted: it means
 * stop now); the counts reach the main thread at most
 * four times a second. A newer epoch withdraws older onsets that have not
 * sounded; `cancel` before an onset withdraws that note entirely.
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
  if (resolved.noteInput && typeof implementation.note !== 'function') {
    throw new TypeError(`Processor ${resolved.name} declares note input, so its implementation needs note().`);
  }
  const parameterDescriptors: readonly ProcessorAudioParamDescriptor[] = processorAudioParams(resolved);
  const lateInterval = Math.max(QUANTUM, Math.floor(scope.sampleRate / 4));

  class AuthoredProcessor extends scope.AudioWorkletProcessor {
    static get parameterDescriptors(): readonly ProcessorAudioParamDescriptor[] { return parameterDescriptors; }

    #state: State | undefined;
    #failed = false;
    readonly #block: ProcessorBlock = {inputs: [], outputs: [], params: {}, frame: 0, sampleRate: scope.sampleRate};
    readonly #notes = new NoteQueue();
    readonly #active = new Set<number>();
    readonly #event: ProcessorNoteEvent = {gate: 'on', occurrence: 0, midi: 0, cents: 0, velocity: 0, frameOffset: 0, epoch: 0};
    #late = 0;
    #lateReported = -Infinity;

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
        if (this.#failed || !message) return;
        if (message.type === 'note') {
          if (resolved.noteInput) this.#notes.admit(message, this.#active);
        } else if (message.type === 'config' && implementation.message) {
          try { implementation.message(this.#state as State, message.data); } catch (error) { this.#fail(error); }
        }
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
        if (resolved.noteInput) this.#dispatch(block.frame, outputs[0]?.[0]?.length ?? QUANTUM);
        implementation.process(this.#state as State, block);
      } catch (error) {
        for (const port of outputs) for (const channel of port) channel.fill(0);
        this.#fail(error);
        return false;
      }
      return true;
    }

    #dispatch(frame: number, length: number): void {
      const event = this.#event;
      for (let message = this.#notes.next(frame + length); message; message = this.#notes.next(frame + length)) {
        if (message.gate === 'on') {
          if (this.#active.has(message.occurrence)) continue;
          this.#active.add(message.occurrence);
        } else if (!this.#active.delete(message.occurrence)) continue;
        if (message.frame === PROCESSOR_IMMEDIATE_FRAME) event.frameOffset = 0;
        else if (message.frame < frame) {
          event.frameOffset = 0;
          // A cancel means "stop now"; a producer releasing its held notes
          // sends them with past times, which is not a scheduling failure.
          if (message.gate !== 'cancel') this.#late++;
        } else event.frameOffset = message.frame - frame;
        event.gate = message.gate;
        event.occurrence = message.occurrence;
        event.midi = message.midi;
        event.cents = message.cents;
        event.velocity = message.velocity;
        event.epoch = message.epoch;
        implementation.note!(this.#state as State, event);
      }
      if (this.#late > 0 && frame - this.#lateReported >= lateInterval) {
        const report: ProcessorReport = {type: 'late', count: this.#late};
        this.port.postMessage(report);
        this.#late = 0;
        this.#lateReported = frame;
      }
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
