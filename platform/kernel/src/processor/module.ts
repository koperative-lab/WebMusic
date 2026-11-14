import type {ModuleContext} from '../module/context';
import {routeModuleOutput} from '../module/context';
import {AudioInputPort, AudioOutputPort} from '../module/audio-port';
import {createControlPort, type ControlPort} from '../module/control-port';
import type {ConnectionLease} from '../module/lease';
import {ParamHandle, ParamSurface} from '../module/parameter';
import {NoteInputPort, type NoteEvent, type NoteInputHandler} from '../module/note-port';
import {PortListeners} from '../module/port';
import type {ModuleHandle, ModulePort} from '../module/registry';
import {resolveProcessorDefinition, type ProcessorDefinition, type ResolvedProcessorDefinition} from './definition';
import {bindProcessorParams, createProcessorNode, listenToProcessor, type ProcessorNodeFactory} from './node';
import {isProcessorPrepared} from './prepare';
import type {SessionSchedulingBinding, SessionSchedulingEvent} from '../session-scheduling';
import {PROCESSOR_IMMEDIATE_FRAME, type ProcessorMessage, type ProcessorNoteMessage} from './protocol';

export type {ProcessorNodeFactory} from './node';

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
  /**
   * Places a note event on the audio clock: audio-context seconds, `'now'` for
   * a live gesture with no scheduled time, or undefined when the event's axis
   * has no mapping (the event is rejected). The default accepts
   * `audio-context-seconds` as is and plays `performance-seconds` gestures now.
   */
  readonly noteTime?: ProcessorNoteTime;
  /**
   * `context` (the default) borrows the scope's Session scheduling binding when
   * the definition declares note input or transport; `none` ignores it. The
   * Session must use this module's audio context as its reference clock.
   */
  readonly session?: 'context' | 'none';
  /** Author-defined observations the processor posts through `setup.report`. */
  readonly onReport?: (data: unknown) => void;
  readonly onCleanupError?: (error: unknown) => void;
}

/** Where a note event falls on the audio clock; see {@link ProcessorModuleOptions.noteTime}. */
export type ProcessorNoteTime = (event: NoteEvent) => number | 'now' | undefined;

/** Accepts scheduled `audio-context-seconds` notes and plays live `performance-seconds` gestures at once. */
export const defaultProcessorNoteTime: ProcessorNoteTime = event =>
  event.axis === 'audio-context-seconds' ? event.time : event.axis === 'performance-seconds' ? 'now' : undefined;

/**
 * Main-thread side of a processor's note input: string occurrence IDs become
 * small integers, times become frames, and every change is posted ahead of
 * its frame. It keeps only the occurrences it has started, so a release for
 * anything else is ignored.
 */
class ProcessorNoteBridge implements NoteInputHandler {
  readonly #occurrences = new Map<string, {readonly occurrence: number; readonly scheduled: boolean}>();
  #next = 1;
  #closed = false;

  constructor(
    private readonly node: AudioWorkletNode,
    private readonly sampleRate: number,
    private readonly time: ProcessorNoteTime,
    private readonly name: string,
  ) {}

  accept(event: NoteEvent): void {
    if (this.#closed) return;
    const at = this.time(event);
    if (at === undefined) throw new TypeError(`Processor ${this.name} cannot place notes on the ${event.axis} axis; supply noteTime.`);
    if (at !== 'now' && !Number.isFinite(at)) throw new RangeError(`Processor ${this.name} note time must be finite seconds or 'now'.`);
    const key = `${event.sourceId}\u0000${event.occurrenceId}`;
    let occurrence = this.#occurrences.get(key)?.occurrence;
    if (event.gate === 'on') {
      if (occurrence !== undefined) return;
      occurrence = this.#next++;
      this.#occurrences.set(key, {occurrence, scheduled: at !== 'now'});
    } else {
      if (occurrence === undefined) return;
      this.#occurrences.delete(key);
    }
    this.#post({
      type: 'note', gate: event.gate, occurrence,
      midi: event.pitch.midi, cents: event.pitch.cents ?? 0, velocity: event.velocity,
      frame: at === 'now' ? PROCESSOR_IMMEDIATE_FRAME : Math.max(0, Math.round(at * this.sampleRate)),
      epoch: event.epoch,
    });
  }

  /**
   * The Session invalidated its schedule: forget scheduled occurrences (the
   * processor cancels them) so a producer's later release of one is ignored.
   */
  flush(epoch: number): void {
    if (this.#closed) return;
    for (const [key, entry] of this.#occurrences) if (entry.scheduled) this.#occurrences.delete(key);
    this.node.port.postMessage({type: 'flush', epoch} satisfies ProcessorMessage);
  }

  /** Cancel every note this bridge started, then stop accepting. */
  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    for (const {occurrence} of this.#occurrences.values()) {
      this.#post({type: 'note', gate: 'cancel', occurrence, midi: 0, cents: 0, velocity: 0, frame: PROCESSOR_IMMEDIATE_FRAME, epoch: 0});
    }
    this.#occurrences.clear();
  }

  #post(message: ProcessorNoteMessage): void { this.node.port.postMessage(message); }
}

/**
 * Follow one Session scheduling binding for a processor: flush scheduled
 * notes on invalidation and copy each anchor to the audio thread. Borrowed
 * read-only, like Session-relative automation; the processor is not a Session
 * participant because it owns no content with a duration.
 */
function followSession(
  binding: SessionSchedulingBinding,
  node: AudioWorkletNode,
  audio: BaseAudioContext,
  definition: ResolvedProcessorDefinition,
  notes: ProcessorNoteBridge | undefined,
): () => void {
  const post = (message: ProcessorMessage) => node.port.postMessage(message);
  const held = (): number => {
    try { return binding.positionAt(audio.currentTime); } catch { return binding.snapshot.originPosition; }
  };
  return binding.subscribe((event: SessionSchedulingEvent) => {
    const {snapshot} = event;
    if (event.type === 'invalidate') notes?.flush(snapshot.epoch);
    if (!definition.transport) return;
    const running = event.type === 'anchor' && snapshot.phase === 'ready' && !snapshot.paused;
    post({
      type: 'transport',
      originFrame: Math.round(snapshot.originTime * audio.sampleRate),
      originSeconds: running ? snapshot.originPosition : held(),
      rate: snapshot.rate,
      running,
      loop: snapshot.loop ? {startSeconds: snapshot.loop.startSeconds, endSeconds: snapshot.loop.endSeconds} : null,
      epoch: snapshot.epoch,
    });
  });
}

/** `ready` until the processor fails (`error`) or the module is disposed (`detached`, terminal). */
export type ProcessorModuleState = 'ready' | 'error' | 'detached';

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
  /** The `notes` input when the definition declares note input. */
  readonly notes?: NoteInputPort;
  readonly #inputs: readonly AudioInputPort[];
  readonly #outputs: readonly AudioOutputPort[];
  readonly #ports: readonly ModulePort[];
  readonly #cleanups: (() => void)[];
  readonly #listeners: PortListeners<void>;
  readonly #onCleanupError?: (error: unknown) => void;
  #state: ProcessorModuleState = 'ready';
  #error?: string;
  #lateNotes = 0;

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
    notes?: NoteInputPort;
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
    this.notes = parts.notes;
    this.#ports = Object.freeze([
      ...parts.inputs, ...(parts.notes ? [parts.notes] : []), ...parts.outputs, ...(parts.control ? [parts.control] : []),
    ]);
    this.#cleanups = parts.cleanups;
    this.#onCleanupError = parts.onCleanupError;
    this.#listeners = new PortListeners<void>(parts.onCleanupError);
  }

  get state(): ProcessorModuleState { return this.#state; }
  /** The processor's failure message while `state` is `error`. */
  get error(): string | undefined { return this.#error; }
  /** Note changes the processor played after their frame, as reported so far. Zero means every note was on time. */
  get lateNotes(): number { return this.#lateNotes; }

  /** Every port: audio inputs, `notes` with note input, audio outputs, then `params` when the definition has parameters. */
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

  /** Called after a state change and after a late-note report. */
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

  /** @internal Late-note report from the processor. */
  late(count: number): void {
    if (this.#state === 'detached' || count <= 0) return;
    this.#lateNotes += count;
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
 * With note input, the module exposes a `notes` input port. Each event is
 * placed on the audio clock with `noteTime` and posted ahead of its frame; the
 * processor plays it at that frame, or at the next block and counts it in
 * {@link ProcessorModule.lateNotes} when it arrives too late. Disconnecting a
 * producer or disposing the module cancels the notes it started.
 *
 * In a scope with a Session, a module with note input or transport borrows
 * the Session's scheduling binding: when the Session invalidates its
 * schedule (seek, pause, stop, loop or rate change), queued scheduled notes
 * are withdrawn and sounding ones cancelled, while live gestures continue; a
 * `transport` definition receives each anchor and reads the Session position
 * in `block.transport`. Without a Session, `block.transport` reports stopped.
 */
export function createProcessorModule(
  context: ModuleContext,
  definition: ProcessorDefinition | ResolvedProcessorDefinition,
  options: ProcessorModuleOptions,
): ProcessorModule {
  const resolved = resolveProcessorDefinition(definition);
  if (typeof options?.id !== 'string') throw new TypeError('Processor module needs an id.');
  const route = options.route ?? 'default';
  const sessionMode = options.session ?? 'context';
  if (sessionMode !== 'context' && sessionMode !== 'none') throw new TypeError(`Unknown processor session mode: ${String(sessionMode)}`);
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
    const node = createProcessorNode(audio, resolved, {
      config: options.config, createNode: options.createNode,
      baseValues: Object.fromEntries(handles.map(handle => [handle.descriptor.id, handle.snapshot.baseValue])),
    });
    cleanups.push(() => node.disconnect());
    // The module does not exist yet; reports arriving first have nothing to fail.
    const owner: {module?: ProcessorModule} = {};
    cleanups.push(listenToProcessor(node, {
      fail: message => owner.module?.fail(message), late: count => owner.module?.late(count),
      data: options.onReport, report: options.onCleanupError,
    }));

    bindProcessorParams(audio, node, resolved, handles, cleanups);

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
    let notes: NoteInputPort | undefined;
    let bridge: ProcessorNoteBridge | undefined;
    if (resolved.noteInput) {
      const created = new ProcessorNoteBridge(node, audio.sampleRate, options.noteTime ?? defaultProcessorNoteTime, resolved.name);
      bridge = created;
      cleanups.push(() => created.close());
      const port = new NoteInputPort(created, {id: 'notes'});
      // Runs before the bridge closes, so released connections still post their cancels.
      cleanups.push(() => port.dispose());
      notes = port;
    }
    const binding = sessionMode === 'context' && (resolved.noteInput || resolved.transport) ? context.session?.scheduling : undefined;
    if (binding) cleanups.push(followSession(binding, node, audio, resolved, bridge));
    const params = new ParamSurface(handles);
    const created = new ProcessorModule({
      id: options.id, definition: resolved, node, params, latencySeconds, inputs, outputs,
      control: handles.length ? createControlPort(params) : undefined,
      notes, cleanups, onCleanupError: options.onCleanupError,
    });
    owner.module = created;

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
