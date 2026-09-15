import {noteMidi, type Note} from '../../core';
import type {HeadlessSynth, SoundfontSynthOptions} from './audio-contracts';
import {OscillatorSynth} from './oscillator-synth';
import {
  cancelBinaryResponseBody,
  decodedAudioByteLength,
  mapWithConcurrency,
  positiveSafeIntegerOption,
  readBoundedResponse,
} from './resource-loading';

interface ActiveSample {
  source: AudioBufferSourceNode;
  gain: GainNode;
  startTime: number;
}

interface SampleVoiceHandle {
  readonly kind: 'webscore-soundfont-sample';
  readonly id: number;
}

interface SoundfontLoadLimits {
  maxConcurrentLoads: number;
  maxSampleBytes: number;
  maxTotalSampleBytes: number;
  maxDecodedSampleBytes: number;
  maxTotalDecodedSampleBytes: number;
}

export const DEFAULT_SOUNDFONT_SYNTH_LOAD_LIMITS: Readonly<SoundfontLoadLimits> = Object.freeze({
  maxConcurrentLoads: 4,
  maxSampleBytes: 32 * 1024 * 1024,
  maxTotalSampleBytes: 128 * 1024 * 1024,
  maxDecodedSampleBytes: 64 * 1024 * 1024,
  maxTotalDecodedSampleBytes: 256 * 1024 * 1024,
});

export function createSoundfontSynth(
  context: AudioContext,
  options: SoundfontSynthOptions = {},
): SoundfontSynth {
  return new SoundfontSynth(context, options);
}

/** Exact-MIDI sample map with an oscillator fallback for missing notes. */
export class SoundfontSynth implements HeadlessSynth {
  private readonly output: GainNode;
  private readonly buffers = new Map<number, AudioBuffer>();
  private readonly active = new Map<number, Set<ActiveSample>>();
  /** Sources remain owned until onended, including voices in their release tail. */
  private readonly sources = new Set<ActiveSample>();
  private readonly byId = new Map<SampleVoiceHandle, {midi: number; voice: ActiveSample}>();
  private nextId = 1;
  private readonly fallback: HeadlessSynth;
  private readonly gain: number;
  private readonly attackSeconds: number;
  private readonly releaseSeconds: number;
  private readonly loadControllers = new Set<AbortController>();
  private readonly pendingLoads = new Map<number, Promise<void>>();
  private readonly loadLimits: SoundfontLoadLimits;
  private totalSourceBytes = 0;
  private totalDecodedBytes = 0;
  private loadGeneration = 0;
  private disposed = false;

  constructor(private readonly context: AudioContext, private readonly options: SoundfontSynthOptions = {}) {
    this.loadLimits = resolveSoundfontLoadLimits(options);
    this.output = context.createGain();
    this.fallback = options.fallback ?? new OscillatorSynth(context);
    this.fallback.connect?.(this.output);
    this.gain = options.gain ?? 1;
    this.attackSeconds = options.attackSeconds ?? 0.004;
    this.releaseSeconds = options.releaseSeconds ?? 0.08;
  }

  /**
   * Sample voices are cancellable themselves; an absent sample delegates to
   * the fallback, so advertise clock lookahead only when that fallback can
   * retract its own future voices as well.
   */
  get supportsScheduledCancellation(): boolean {
    return this.fallback.supportsScheduledCancellation === true &&
      typeof this.fallback.cancelScheduledNote === 'function' &&
      typeof this.fallback.noteOffById === 'function';
  }

  connect(destination: AudioNode): () => void {
    if (this.disposed) throw new Error('SoundfontSynth has been disposed.');
    this.output.connect(destination);
    return () => {
      try {
        this.output.disconnect(destination);
      } catch {
        // The route may already have been removed by an owning graph teardown.
      }
    };
  }

  disconnect(): void {
    this.output.disconnect();
  }

  async preload(notes?: ReadonlyArray<Note>): Promise<void> {
    if (this.disposed) throw new Error('SoundfontSynth has been disposed.');
    const generation = this.loadGeneration;
    const midis = notes ? [...new Set(notes.map(noteMidi))] : this.configuredMidis();
    try {
      await mapWithConcurrency(
        midis,
        this.loadLimits.maxConcurrentLoads,
        async (midi) => this.loadSampleOnce(midi, generation),
      );
    } catch (error) {
      if (this.isLoadCurrent(generation)) this.invalidateLoads();
      throw error;
    }
  }

  noteOn(midi: number, velocity: number, time: number, durationSeconds: number): unknown {
    if (this.disposed) throw new Error('SoundfontSynth has been disposed.');
    const buffer = this.buffers.get(midi);
    if (!buffer) return this.fallback.noteOn(midi, velocity, time, durationSeconds);

    const source = this.context.createBufferSource();
    const gain = this.context.createGain();
    const voice = {source, gain, startTime: time};
    source.buffer = buffer;
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.01, (velocity / 127) * this.gain), time + this.attackSeconds);
    source.connect(gain).connect(this.output);
    source.start(time);
    source.stop(time + durationSeconds + this.releaseSeconds);

    let voices = this.active.get(midi);
    if (!voices) {
      voices = new Set();
      this.active.set(midi, voices);
    }
    voices.add(voice);
    this.sources.add(voice);
    // Object identity cannot collide with an arbitrary handle returned by an
    // injected fallback synth (numbers/strings are common there).
    const handle = Object.freeze({
      kind: 'webscore-soundfont-sample' as const,
      id: this.nextId++,
    });
    this.byId.set(handle, {midi, voice});
    source.onended = () => {
      voices?.delete(voice);
      this.sources.delete(voice);
      if (voices?.size === 0) this.active.delete(midi);
      this.byId.delete(handle);
    };
    return handle;
  }

  noteOff(midi: number, time: number): void {
    const voices = this.active.get(midi);
    if (voices) {
      for (const voice of voices) this.releaseVoice(voice, time);
      voices.clear();
      this.active.delete(midi);
      for (const [id, record] of this.byId) if (record.midi === midi) this.byId.delete(id);
    }
    // A fallback voice may predate a sample that finished loading for the same
    // pitch, so generic pitch release must quiet both possible stores.
    this.fallback.noteOff?.(midi, time);
  }

  noteOffById(handle: unknown, time: number): void {
    const record = this.byId.get(handle as SampleVoiceHandle);
    if (!record) {
      this.fallback.noteOffById?.(handle, time);
      return;
    }
    this.byId.delete(handle as SampleVoiceHandle);
    this.active.get(record.midi)?.delete(record.voice);
    this.releaseVoice(record.voice, time);
  }

  /** Retract a future sample attack without allowing its envelope to begin. */
  cancelScheduledNote(handle: unknown, time: number): void {
    const record = this.byId.get(handle as SampleVoiceHandle);
    if (!record) {
      this.fallback.cancelScheduledNote?.(handle, time);
      return;
    }
    this.byId.delete(handle as SampleVoiceHandle);
    this.active.get(record.midi)?.delete(record.voice);
    this.releaseVoice(record.voice, time);
  }

  /** Move the hard sample-source stop while an active transport is retimed. */
  retimeScheduledNote(handle: unknown, time: number): void {
    const record = this.byId.get(handle as SampleVoiceHandle);
    if (!record) {
      this.fallback.retimeScheduledNote?.(handle, time);
      return;
    }
    try {
      // As with OscillatorNode, a later stop() call replaces the previous
      // request, while the existing note-off timer still creates the release
      // envelope at the logical endpoint.
      record.voice.source.stop(time + this.releaseSeconds);
    } catch {
      // An ended sample cannot be retimed and is already silent.
    }
  }

  private releaseVoice(voice: ActiveSample, time: number): void {
    if (time <= voice.startTime) {
      this.hardStopVoice(voice, time);
      return;
    }
    this.fadeOut(voice, time);
  }

  private fadeOut(voice: ActiveSample, time: number): void {
    voice.gain.gain.cancelScheduledValues(time);
    voice.gain.gain.setValueAtTime(Math.max(voice.gain.gain.value, 0.0001), time);
    const stopTime = time + this.releaseSeconds;
    voice.gain.gain.exponentialRampToValueAtTime(0.0001, stopTime);
    try {
      voice.source.stop(stopTime);
    } catch {
      // The source has already ended.
    }
  }

  private hardStopVoice(voice: ActiveSample, time: number): void {
    voice.gain.gain.cancelScheduledValues(time);
    voice.gain.gain.setValueAtTime(0, time);
    try {
      voice.source.stop(time);
    } catch {
      // The source has already ended.
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.invalidateLoads();
    const now = Number.isFinite(this.context.currentTime) ? this.context.currentTime : 0;
    for (const voice of this.sources) this.hardStopVoice(voice, now);
    this.active.clear();
    this.sources.clear();
    this.byId.clear();
    this.buffers.clear();
    this.totalSourceBytes = 0;
    this.totalDecodedBytes = 0;
    try {
      this.fallback.dispose?.();
    } finally {
      this.disconnect();
    }
  }

  private configuredMidis(): number[] {
    return Object.keys(this.options.samples ?? {})
      .map(Number)
      .filter((midi) => Number.isFinite(midi));
  }

  private async loadSampleOnce(midi: number, generation: number): Promise<void> {
    if (this.buffers.has(midi)) return;
    const existing = this.pendingLoads.get(midi);
    if (existing) return existing;
    const pending = this.loadSample(midi, generation);
    this.pendingLoads.set(midi, pending);
    try {
      await pending;
    } finally {
      if (this.pendingLoads.get(midi) === pending) this.pendingLoads.delete(midi);
    }
  }

  private async loadSample(midi: number, generation: number): Promise<void> {
    const sample = this.options.resolveSample?.(midi) ?? this.options.samples?.[midi] ?? this.options.samples?.[String(midi)];
    if (!sample) return;
    if (isAudioBuffer(sample)) {
      if (this.isLoadCurrent(generation)) this.commitDecodedSample(midi, sample);
      return;
    }
    try {
      let bytes: ArrayBuffer;
      if (typeof sample === 'string') {
        const controller = new AbortController();
        this.loadControllers.add(controller);
        try {
          const response = await fetch(sample, {signal: controller.signal});
          if (!response.ok) {
            cancelBinaryResponseBody(response.body, `Soundfont sample request failed for ${sample}`);
            throw new Error(`Soundfont sample request failed for ${sample} (${response.status})`);
          }
          bytes = await readBoundedResponse(
            response,
            this.loadLimits.maxSampleBytes,
            `Soundfont sample ${sample}`,
            'maxSampleBytes',
            controller.signal,
          );
        } finally {
          this.loadControllers.delete(controller);
        }
      } else {
        bytes = sample;
      }
      if (!this.isLoadCurrent(generation)) return;
      this.assertSourceSampleBytes(bytes.byteLength);
      this.reserveTotalSourceBytes(bytes.byteLength);
      let decodedReservation = 0;
      let decodedReserved = false;
      let committed = false;
      try {
        const buffer = await this.context.decodeAudioData(bytes.slice(0));
        if (!this.isLoadCurrent(generation)) return;
        decodedReservation = this.assertDecodedSampleBytes(buffer);
        this.reserveTotalDecodedBytes(decodedReservation);
        decodedReserved = true;
        this.buffers.set(midi, buffer);
        committed = true;
      } finally {
        if (!committed) {
          this.totalSourceBytes = Math.max(0, this.totalSourceBytes - bytes.byteLength);
          if (decodedReserved) this.totalDecodedBytes = Math.max(0, this.totalDecodedBytes - decodedReservation);
        }
      }
    } catch (error) {
      // Aborting a disposed generation is teardown, not a late load failure.
      if (!this.isLoadCurrent(generation)) return;
      throw error;
    }
  }

  private isLoadCurrent(generation: number): boolean {
    return !this.disposed && generation === this.loadGeneration;
  }

  private invalidateLoads(): void {
    this.loadGeneration += 1;
    for (const controller of this.loadControllers) controller.abort();
    this.loadControllers.clear();
    this.pendingLoads.clear();
  }

  private assertSourceSampleBytes(bytes: number): void {
    if (bytes > this.loadLimits.maxSampleBytes) {
      throw new RangeError(
        `Soundfont sample is ${bytes.toLocaleString()} bytes, exceeding maxSampleBytes (${this.loadLimits.maxSampleBytes.toLocaleString()})`,
      );
    }
  }

  private reserveTotalSourceBytes(bytes: number): void {
    if (this.totalSourceBytes + bytes > this.loadLimits.maxTotalSampleBytes) {
      throw new RangeError(
        `Soundfont samples exceed maxTotalSampleBytes (${this.loadLimits.maxTotalSampleBytes.toLocaleString()})`,
      );
    }
    this.totalSourceBytes += bytes;
  }

  private assertDecodedSampleBytes(buffer: AudioBuffer): number {
    const bytes = decodedAudioByteLength(buffer, 'Soundfont resource limit exceeded');
    if (bytes > this.loadLimits.maxDecodedSampleBytes) {
      throw new RangeError(
        `Decoded Soundfont sample is ${bytes.toLocaleString()} bytes, exceeding maxDecodedSampleBytes (${this.loadLimits.maxDecodedSampleBytes.toLocaleString()})`,
      );
    }
    return bytes;
  }

  private reserveTotalDecodedBytes(bytes: number): void {
    if (this.totalDecodedBytes + bytes > this.loadLimits.maxTotalDecodedSampleBytes) {
      throw new RangeError(
        `Decoded Soundfont samples exceed maxTotalDecodedSampleBytes (${this.loadLimits.maxTotalDecodedSampleBytes.toLocaleString()})`,
      );
    }
    this.totalDecodedBytes += bytes;
  }

  private commitDecodedSample(midi: number, buffer: AudioBuffer): void {
    const bytes = this.assertDecodedSampleBytes(buffer);
    this.reserveTotalDecodedBytes(bytes);
    this.buffers.set(midi, buffer);
  }
}

function resolveSoundfontLoadLimits(options: SoundfontSynthOptions): SoundfontLoadLimits {
  return {
    maxConcurrentLoads: positiveSafeIntegerOption(
      'SoundfontSynth',
      'maxConcurrentLoads',
      options.maxConcurrentLoads,
      DEFAULT_SOUNDFONT_SYNTH_LOAD_LIMITS.maxConcurrentLoads,
    ),
    maxSampleBytes: positiveSafeIntegerOption(
      'SoundfontSynth',
      'maxSampleBytes',
      options.maxSampleBytes,
      DEFAULT_SOUNDFONT_SYNTH_LOAD_LIMITS.maxSampleBytes,
    ),
    maxTotalSampleBytes: positiveSafeIntegerOption(
      'SoundfontSynth',
      'maxTotalSampleBytes',
      options.maxTotalSampleBytes,
      DEFAULT_SOUNDFONT_SYNTH_LOAD_LIMITS.maxTotalSampleBytes,
    ),
    maxDecodedSampleBytes: positiveSafeIntegerOption(
      'SoundfontSynth',
      'maxDecodedSampleBytes',
      options.maxDecodedSampleBytes,
      DEFAULT_SOUNDFONT_SYNTH_LOAD_LIMITS.maxDecodedSampleBytes,
    ),
    maxTotalDecodedSampleBytes: positiveSafeIntegerOption(
      'SoundfontSynth',
      'maxTotalDecodedSampleBytes',
      options.maxTotalDecodedSampleBytes,
      DEFAULT_SOUNDFONT_SYNTH_LOAD_LIMITS.maxTotalDecodedSampleBytes,
    ),
  };
}

function isAudioBuffer(value: unknown): value is AudioBuffer {
  const AudioBufferCtor = globalThis.AudioBuffer;
  if (typeof AudioBufferCtor === 'function' && value instanceof AudioBufferCtor) return true;
  // AudioBuffer may have been created in another realm, where instanceof is
  // false. These capabilities distinguish it from the other accepted sample
  // forms (URL and ArrayBuffer).
  return typeof value === 'object' && value !== null &&
    typeof (value as AudioBuffer).getChannelData === 'function' &&
    typeof (value as AudioBuffer).numberOfChannels === 'number';
}
