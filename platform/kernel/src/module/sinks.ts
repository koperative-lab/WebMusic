import {AudioInputPort} from './audio-port';
import {ModuleAudioEnvironment} from './context';
import {assertModuleId, type ModuleHandle, type ModulePort} from './registry';

/** Shared lifecycle of the sink modules: lazily prepared input, idempotent disposal. */
abstract class AudioSink implements ModuleHandle {
  readonly id: string;
  protected readonly environment: ModuleAudioEnvironment;
  #input?: AudioInputPort;
  #ports: readonly ModulePort[] = Object.freeze([]);
  #listeners = new Set<() => void>();
  #disposed = false;

  constructor(environment: ModuleAudioEnvironment, id: string) {
    assertModuleId(id);
    this.id = id;
    this.environment = environment;
  }

  get disposed(): boolean { return this.#disposed; }
  /** Present after {@link prepare}; producers connect to it. */
  get input(): AudioInputPort | undefined { return this.#input; }
  ports(): readonly ModulePort[] { return this.#ports; }

  prepare(): void {
    if (this.#disposed) throw new Error(`${this.constructor.name} is disposed`);
    if (this.#input) return;
    const context = this.environment.prepare();
    this.#input = new AudioInputPort(this.createInput(context), {id: 'input'});
    this.#ports = Object.freeze([this.#input]);
    this.notify();
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => { this.#listeners.delete(listener); };
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    let failure: unknown;
    try { this.#input?.dispose(); } catch (error) { failure = error; }
    try { this.release(); } catch (error) { failure ??= error; }
    this.notify();
    this.#listeners.clear();
    if (failure !== undefined) throw failure;
  }

  protected abstract createInput(context: BaseAudioContext): AudioNode;
  protected release(): void {}
  protected notify(): void {
    for (const listener of [...this.#listeners]) {
      try { listener(); } catch { /* A sink observer cannot undo a committed edge. */ }
    }
  }
}

interface SinkSelectable { setSinkId?(deviceId: string): Promise<void>; readonly sinkId?: string }

/**
 * The environment's device output as a sink module. Its input is the context
 * destination, so every unpatched default route ends here. Device selection
 * uses `AudioContext.setSinkId` where the browser offers it.
 */
export class DeviceSink extends AudioSink {
  constructor(environment: ModuleAudioEnvironment, options: {id?: string} = {}) {
    super(environment, options.id ?? 'device');
  }

  get supportsDeviceSelection(): boolean {
    const context = this.environment.peek() as (BaseAudioContext & SinkSelectable) | undefined;
    return typeof context?.setSinkId === 'function';
  }

  /** Route the whole environment to another output device; rejects where unsupported. */
  async selectDevice(deviceId: string): Promise<void> {
    this.prepare();
    const context = this.environment.peek() as BaseAudioContext & SinkSelectable;
    if (typeof context.setSinkId !== 'function') throw new Error('Output device selection is unavailable in this environment');
    await context.setSinkId(deviceId);
    this.notify();
  }

  protected createInput(context: BaseAudioContext): AudioNode { return context.destination; }
}

interface RecorderLike {
  readonly state: string;
  start(): void;
  stop(): void;
  addEventListener(type: 'dataavailable', listener: (event: {data: Blob}) => void): void;
  addEventListener(type: 'stop' | 'error', listener: (event: Event) => void): void;
}
type RecorderConstructor = new (stream: MediaStream, options?: {mimeType?: string}) => RecorderLike;

export interface CaptureSinkOptions {
  id?: string;
  mimeType?: string;
  /** Injected recorder for environments without `MediaRecorder`. */
  recorder?: RecorderConstructor;
}

/**
 * Record whatever producers connect to its input. Capture uses a
 * MediaStream destination in the same context, so it never opens a device or
 * a second AudioContext. `stop()` resolves with the encoded take.
 */
export class CaptureSink extends AudioSink {
  readonly #options: CaptureSinkOptions;
  #node?: MediaStreamAudioDestinationNode;
  #recorder?: RecorderLike;
  #take?: Promise<Blob>;

  constructor(environment: ModuleAudioEnvironment, options: CaptureSinkOptions = {}) {
    super(environment, options.id ?? 'capture');
    this.#options = options;
  }

  get recording(): boolean { return this.#recorder?.state === 'recording'; }

  start(): void {
    this.prepare();
    if (this.recording) throw new Error('CaptureSink is already recording');
    const Recorder = this.#options.recorder ?? (globalThis as {MediaRecorder?: RecorderConstructor}).MediaRecorder;
    if (!Recorder) throw new Error('MediaRecorder is unavailable in this environment');
    const recorder = new Recorder(this.#node!.stream, this.#options.mimeType ? {mimeType: this.#options.mimeType} : undefined);
    const chunks: Blob[] = [];
    this.#take = new Promise<Blob>((resolve, reject) => {
      recorder.addEventListener('dataavailable', (event) => { if (event.data.size > 0) chunks.push(event.data); });
      recorder.addEventListener('stop', () => resolve(new Blob(chunks, this.#options.mimeType ? {type: this.#options.mimeType} : undefined)));
      recorder.addEventListener('error', (event) => reject((event as Event & {error?: unknown}).error ?? new Error('Capture failed')));
    });
    void this.#take.catch(() => {});
    this.#recorder = recorder;
    recorder.start();
    this.notify();
  }

  /** Finish the current take. */
  stop(): Promise<Blob> {
    const recorder = this.#recorder;
    const take = this.#take;
    if (!recorder || !take) return Promise.reject(new Error('CaptureSink is not recording'));
    this.#recorder = undefined;
    this.#take = undefined;
    if (recorder.state !== 'inactive') recorder.stop();
    this.notify();
    return take;
  }

  protected createInput(context: BaseAudioContext): AudioNode {
    const create = (context as AudioContext).createMediaStreamDestination;
    if (typeof create !== 'function') throw new Error('Audio capture requires a live AudioContext');
    this.#node = create.call(context);
    return this.#node;
  }

  protected override release(): void {
    const recorder = this.#recorder;
    this.#recorder = undefined;
    this.#take = undefined;
    if (recorder && recorder.state !== 'inactive') recorder.stop();
  }
}

export interface OfflineEnvironmentOptions {
  sampleRate: number;
  /** Rendered length in seconds; ignored when `length` is given. */
  durationSeconds?: number;
  /** Rendered length in sample frames. */
  length?: number;
  channels?: number;
  /** Injected constructor for environments without `OfflineAudioContext`. */
  create?: (channels: number, length: number, sampleRate: number) => OfflineAudioContext;
}

/** An offline environment for realizing a module graph and rendering it once. */
export interface OfflineModuleEnvironment {
  readonly environment: ModuleAudioEnvironment;
  readonly context: OfflineAudioContext;
  /** Render everything connected to the offline destination. */
  render(): Promise<AudioBuffer>;
}

/**
 * Create the offline audio environment that render and export paths realize
 * module graphs in. The environment owns the offline context; modules borrow
 * it exactly as they borrow a live environment.
 */
export function createOfflineModuleEnvironment(options: OfflineEnvironmentOptions): OfflineModuleEnvironment {
  const channels = options.channels ?? 2;
  if (!Number.isInteger(channels) || channels < 1) throw new RangeError('channels must be a positive integer');
  if (!Number.isFinite(options.sampleRate) || options.sampleRate <= 0) throw new RangeError('sampleRate must be positive');
  let length = options.length;
  if (length === undefined) {
    const seconds = options.durationSeconds;
    if (seconds === undefined || !Number.isFinite(seconds) || seconds <= 0) throw new RangeError('durationSeconds must be positive');
    length = Math.ceil(seconds * options.sampleRate);
  }
  if (!Number.isInteger(length) || length < 1) throw new RangeError('length must be a positive integer number of frames');
  const create = options.create ?? ((count: number, frames: number, rate: number) => {
    const Offline = (globalThis as {OfflineAudioContext?: typeof OfflineAudioContext}).OfflineAudioContext;
    if (!Offline) throw new Error('OfflineAudioContext is unavailable in this environment');
    return new Offline(count, frames, rate);
  });
  const context = create(channels, length, options.sampleRate);
  const environment = new ModuleAudioEnvironment({context});
  let rendered: Promise<AudioBuffer> | undefined;
  return Object.freeze({
    environment, context,
    render: () => (rendered ??= context.startRendering()),
  });
}
