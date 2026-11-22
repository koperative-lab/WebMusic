import type {ParamSurface} from '@webmusic/kernel/module';
import {
  createProcessorInstrument, isProcessorPrepared, prepareProcessor,
  type ProcessorInstrument, type ProcessorNodeFactory, type ProcessorSource, type ResolvedProcessorDefinition,
} from '@webmusic/kernel/processor';
import type {SoundBackend, SoundOptions} from './contracts';

export interface ProcessorSoundOptions extends SoundOptions {
  /**
   * Where to load the processor when it is not yet prepared in the player's
   * context. Without it, the processor must be prepared before the Sound
   * connects (`await prepareProcessor(context, definition, source)`).
   */
  source?: ProcessorSource;
  /** Initial base values of the definition's parameters. */
  values?: Readonly<Record<string, number>>;
  /** Structured-cloneable value handed to the processor's `create`. */
  config?: unknown;
  createNode?: ProcessorNodeFactory;
  /** The processor failed and is silent; called once per connection. */
  onError?: (message: string) => void;
  /** Notes the processor played after their frame since the previous report. */
  onLateNotes?: (count: number) => void;
  /** Author-defined observations from the processor. */
  onReport?: (data: unknown) => void;
}

interface Voice {
  readonly occurrence: number;
  readonly midi: number;
  readonly start: number;
  /** Scheduled release time; Infinity while open-ended. */
  end: number;
}

/** Swept on attack once this many voices are remembered. */
const SWEEP_AT = 64;

/**
 * `Sound.processor` backend: one processor instrument per route, driven on
 * the audio clock. Every attack returns its occurrence; a finite duration
 * schedules the release with the onset, and a later release, retime or
 * cancellation replaces it while it is still queued.
 */
export class ProcessorSoundBackend implements SoundBackend {
  readonly supportsNoteOccurrences = true;
  readonly supportsScheduledCancellation = true;
  readonly supportsScheduledDuration = true;
  readonly supportsScheduledRetiming = true;
  #instrument?: ProcessorInstrument;
  #ready?: Promise<void>;
  #route = 0;
  #connected = false;
  readonly #voices = new Map<number, Voice>();
  /** Handles for attacks made before the instrument existed: unique and silent. */
  #silent = -1;

  constructor(
    private readonly context: AudioContext,
    private readonly definition: ResolvedProcessorDefinition,
    readonly params: ParamSurface,
    private readonly options: ProcessorSoundOptions,
  ) {}

  connect(destination: AudioNode): () => void {
    if (this.#connected) throw new Error('Sound.processor backend is already connected.');
    const route = ++this.#route;
    if (isProcessorPrepared(this.context, this.definition)) {
      this.#realize(destination);
    } else if (this.options.source) {
      const pending = prepareProcessor(this.context, this.definition, this.options.source).then(() => {
        if (this.#route === route && this.#connected) this.#realize(destination);
      });
      this.#ready = pending;
    } else {
      throw new Error(
        `Sound.processor: ${this.definition.name} is not prepared in this audio context. ` +
        'Await prepareProcessor(context, definition, source) first, or pass source.',
      );
    }
    this.#connected = true;
    return () => this.#release(route);
  }

  /** Resolves once the processor is prepared and its node exists; rejects with the preparation failure. */
  preload(): Promise<void> { return this.#ready ?? Promise.resolve(); }

  noteOn(midi: number, velocity: number, time: number, durationSeconds: number): number {
    const instrument = this.#instrument;
    if (!instrument) return this.#silent--;
    if (this.#voices.size >= SWEEP_AT) this.#sweep();
    const occurrence = instrument.start(midi, Math.max(0, Math.min(1, velocity / 127)), time);
    const voice: Voice = {occurrence, midi, start: time, end: Infinity};
    if (Number.isFinite(durationSeconds)) {
      voice.end = time + Math.max(0, durationSeconds);
      instrument.release(occurrence, voice.end);
    }
    this.#voices.set(occurrence, voice);
    return occurrence;
  }

  /** Release every open voice of this pitch, for pitch-only callers. */
  noteOff(midi: number, time: number): void {
    for (const voice of [...this.#voices.values()]) if (voice.midi === midi && voice.end > time) this.#releaseAt(voice, time);
  }

  /** Release one voice early; a time at or after its scheduled end leaves that end in place. */
  noteOffById(handle: unknown, time: number): void {
    const voice = this.#voice(handle);
    if (voice && time < voice.end) this.#releaseAt(voice, time);
  }

  /** Before its onset the voice never sounds; once sounding it releases at `time`, like other backends. */
  cancelScheduledNote(handle: unknown, time: number): void {
    const voice = this.#voice(handle);
    if (!voice) return;
    if (time <= voice.start) {
      this.#voices.delete(voice.occurrence);
      this.#instrument?.cancel(voice.occurrence, time);
    } else if (time < voice.end) this.#releaseAt(voice, time);
  }

  /** Move the scheduled release, earlier or later, while it has not been reached. */
  retimeScheduledNote(handle: unknown, time: number): void {
    const voice = this.#voice(handle);
    if (!voice || voice.end <= this.context.currentTime) return;
    this.#releaseAt(voice, time);
  }

  dispose(): void { this.#release(this.#route); }

  #realize(destination: AudioNode): void {
    const {onError, onLateNotes, onReport, config, createNode} = this.options;
    const instrument = createProcessorInstrument(this.context, this.definition, {
      params: this.params, config, createNode, onError, onLateNotes, onReport,
    });
    try {
      instrument.node.connect(destination);
    } catch (error) {
      try { instrument.dispose(); } catch { /* Preserve the connection failure. */ }
      throw error;
    }
    this.#instrument = instrument;
  }

  #release(route: number): void {
    if (route !== this.#route || !this.#connected) return;
    this.#connected = false;
    this.#ready = undefined;
    this.#voices.clear();
    const instrument = this.#instrument;
    this.#instrument = undefined;
    let failure: unknown;
    try { instrument?.dispose(); } catch (error) { failure = error; }
    for (const handle of this.params.handles) {
      try { handle.releaseAudio(this.context); } catch (error) { failure ??= error; }
    }
    if (failure !== undefined) throw failure;
  }

  #releaseAt(voice: Voice, time: number): void {
    voice.end = time;
    this.#instrument?.release(voice.occurrence, time);
  }

  #voice(handle: unknown): Voice | undefined {
    return typeof handle === 'number' ? this.#voices.get(handle) : undefined;
  }

  /** Forget voices whose release has passed; they can no longer be changed. */
  #sweep(): void {
    const now = this.context.currentTime;
    for (const [occurrence, voice] of this.#voices) if (voice.end <= now) this.#voices.delete(occurrence);
  }
}
