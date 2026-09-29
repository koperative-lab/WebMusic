// ============================================================================
// AudioRecorder — microphone → AudioClip, the symmetric counterpart to WebScore's
// "MIDI keyboard → Score" recorder. Captures PCM through a fixed-stereo
// `ScriptProcessor` tap (so a live waveform/level is available),
// then assembles an immutable AudioClip on `stop()`. Constructing it touches no
// audio globals; `getUserMedia` runs in `start()` and is guarded for non-browser
// environments.
// ============================================================================

import {EventEmitter, createAudioClip, type AudioClip} from '../../core';
import {createWebAudioContext} from '@webmusic/kernel/audio-context';

export interface AudioRecorderOptions {
  deviceId?: string;
  echoCancellation?: boolean;
  /** Override the sample rate (otherwise the context's rate is used). */
  sampleRate?: number;
  /** Maximum retained frames per channel. Default 30,000,000. */
  maxRecordedFrames?: number;
  /** Maximum retained Float32 PCM bytes across channels. Default 256 MiB. */
  maxRecordedBytes?: number;
}

export interface AudioRecorderEvents {
  start: void;
  stop: AudioClip;
  level: number;
  error: Error;
}

export class AudioRecorder {
  private readonly options: AudioRecorderOptions;
  private readonly emitter = new EventEmitter<AudioRecorderEvents>();

  private context: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private processor: ScriptProcessorNode | null = null;
  private analyser: AnalyserNode | null = null;
  private chunks: Float32Array[][] = []; // [channel][chunk]
  private numChannels = 1;
  private sampleRate = 44100;
  private state: 'idle' | 'starting' | 'recording' | 'disposed' = 'idle';
  private startPromise: Promise<void> | null = null;
  /** Invalidates permission requests that complete after dispose. */
  private lifecycleGeneration = 0;
  private currentLevel = 0;
  private readonly maxRecordedFrames: number;
  private readonly maxRecordedBytes: number;
  private recordedFrames = 0;
  private recordedBytes = 0;
  private recordingError: Error | null = null;

  constructor(options: AudioRecorderOptions = {}) {
    this.options = options;
    this.maxRecordedFrames = positiveSafeInteger(options.maxRecordedFrames, 30_000_000, 'maxRecordedFrames');
    this.maxRecordedBytes = positiveSafeInteger(
      options.maxRecordedBytes,
      256 * 1024 * 1024,
      'maxRecordedBytes',
    );
  }

  get level(): number {
    return this.currentLevel;
  }

  get isRecording(): boolean {
    return this.state === 'recording';
  }

  /**
   * The analyser tapping the live input, while recording. Exposed so a view
   * can draw what the microphone is hearing — the recorder already builds one
   * to compute its own level, and without a getter every live visualizer had
   * to construct a second capture graph.
   *
   * Borrowed: the recorder owns it and drops it on stop, so a consumer must
   * re-read it per take rather than holding on to one.
   */
  get inputAnalyser(): AnalyserNode | undefined {
    return this.state === 'recording' ? this.analyser ?? undefined : undefined;
  }

  start(): Promise<void> {
    if (this.state === 'disposed') {
      return Promise.reject(new Error('AudioRecorder has been disposed'));
    }
    if (this.state === 'recording') return Promise.resolve();
    // A second call while microphone permission is pending shares the first
    // request instead of opening another MediaStream.
    if (this.startPromise) return this.startPromise;

    const md = (globalThis.navigator as Navigator | undefined)?.mediaDevices;
    if (!md || typeof md.getUserMedia !== 'function') {
      return Promise.reject(new Error('AudioRecorder needs getUserMedia (no microphone access in this environment)'));
    }
    this.state = 'starting';
    this.recordingError = null;
    const generation = ++this.lifecycleGeneration;
    const pending = this.startWithMediaDevices(md, generation);
    this.startPromise = pending;
    void pending.then(
      () => {
        if (this.startPromise === pending) this.startPromise = null;
      },
      () => {
        if (this.startPromise === pending) this.startPromise = null;
        if (this.state === 'starting' && generation === this.lifecycleGeneration) this.state = 'idle';
      },
    );
    return pending;
  }

  private async startWithMediaDevices(md: MediaDevices, generation: number): Promise<void> {
    const constraints: MediaStreamConstraints = {
      audio: {
        ...(this.options.deviceId ? {deviceId: this.options.deviceId} : {}),
        echoCancellation: this.options.echoCancellation ?? true,
      },
    };
    let stream: MediaStream | null = null;
    let context: AudioContext | null = null;
    let source: MediaStreamAudioSourceNode | null = null;
    let analyser: AnalyserNode | null = null;
    let processor: ScriptProcessorNode | null = null;
    let committed = false;
    try {
      stream = await md.getUserMedia(constraints);
      if (this.state !== 'starting' || generation !== this.lifecycleGeneration) {
        throw new Error('AudioRecorder start was cancelled');
      }

      context = createWebAudioContext(
        'AudioContext is not available in this environment',
        this.options.sampleRate ? {sampleRate: this.options.sampleRate} : undefined,
      );
      source = context.createMediaStreamSource(stream);
      analyser = context.createAnalyser();
      analyser.fftSize = 1024;
      source.connect(analyser);

      // ScriptProcessor is deprecated but universally available and gives raw PCM
      // without shipping a worklet file. Buffer size 4096 keeps callbacks cheap.
      processor = context.createScriptProcessor(4096, 2, 2);
      // Native ScriptProcessor input is fixed at two channels (mono is upmixed).
      // The accumulator also tolerates lower-channel host adapters defensively.
      this.numChannels = 1;
      this.chunks = [[], []];
      this.recordedFrames = 0;
      this.recordedBytes = 0;
      processor.onaudioprocess = (event: AudioProcessingEvent) => {
        if (this.state !== 'recording') return;
        try {
          const input = event.inputBuffer;
          const channelCount = Math.min(2, input.numberOfChannels);
          const nextFrames = this.recordedFrames + input.length;
          const retainedChannels = Math.max(this.numChannels, channelCount);
          // A promoted stereo take retains a full-length second channel,
          // including silence before promotion and during later mono blocks.
          const nextBytes = nextFrames * retainedChannels * Float32Array.BYTES_PER_ELEMENT;
          if (!Number.isSafeInteger(nextFrames) || nextFrames > this.maxRecordedFrames) {
            throw new RangeError(
              `AudioRecorder exceeded maxRecordedFrames (${this.maxRecordedFrames.toLocaleString()})`,
            );
          }
          if (!Number.isSafeInteger(nextBytes) || nextBytes > this.maxRecordedBytes) {
            throw new RangeError(
              `AudioRecorder exceeded maxRecordedBytes (${this.maxRecordedBytes.toLocaleString()})`,
            );
          }
          if (retainedChannels > this.numChannels) {
            this.chunks[1].push(new Float32Array(this.recordedFrames));
          }
          let sumSquares = 0;
          for (let c = 0; c < retainedChannels; c++) {
            const copy = c < channelCount
              ? Float32Array.from(input.getChannelData(c))
              : new Float32Array(input.length);
            this.chunks[c].push(copy);
            for (let i = 0; i < copy.length; i++) sumSquares += copy[i] * copy[i];
          }
          this.numChannels = retainedChannels;
          this.recordedFrames = nextFrames;
          this.recordedBytes = nextBytes;
          const rms = Math.sqrt(sumSquares / Math.max(1, input.length * retainedChannels));
          this.currentLevel = rms;
          this.emitter.emit('level', rms);
        } catch (error) {
          this.failRecording(error);
        }
      };
      source.connect(processor);
      // ScriptProcessor only ticks when connected to a destination.
      processor.connect(context.destination);

      this.stream = stream;
      this.context = context;
      this.source = source;
      this.analyser = analyser;
      this.processor = processor;
      this.sampleRate = context.sampleRate;
      // Publish ownership while readiness is pending so dispose can immediately
      // stop the device and close a context whose resume Promise has not settled.
      committed = true;
      if (context.state !== 'running') await context.resume();
      if (this.state !== 'starting' || generation !== this.lifecycleGeneration) {
        throw new Error('AudioRecorder start was cancelled');
      }
      if (context.state !== 'running') throw new Error('AudioRecorder context did not start');
      this.state = 'recording';
      this.emitter.emit('start', undefined);
    } catch (error) {
      // A start listener can throw after the resources have been published.
      // Roll back that committed state as well as pre-commit setup failures.
      if (committed) {
        if (this.context === context) {
          this.state = 'idle';
          this.teardown();
        }
      } else {
        cleanupRecorderResources({stream, context, source, analyser, processor});
      }
      throw error;
    }
  }

  /** Assemble completed 4096-frame callbacks; no partial-block flush is available. */
  async stop(): Promise<AudioClip> {
    if (this.state !== 'recording') {
      if (this.recordingError) throw this.recordingError;
      throw new Error('AudioRecorder.stop() called while not recording');
    }
    this.state = 'idle';
    let clip: AudioClip;
    try {
      const channelData: Float32Array[] = [];
      for (let c = 0; c < this.numChannels; c++) {
        channelData.push(concat(this.chunks[c] ?? []));
      }
      // Pad shorter channels (a late-promoted stereo channel) to equal length.
      const length = Math.max(0, ...channelData.map((ch) => ch.length));
      for (let c = 0; c < channelData.length; c++) {
        if (channelData[c].length < length) {
          const padded = new Float32Array(length);
          padded.set(channelData[c]);
          channelData[c] = padded;
        }
      }

      clip = createAudioClip({
        sampleRate: this.sampleRate,
        channelData: channelData.length > 0 && length > 0 ? channelData : [new Float32Array(0)],
      });
    } catch (error) {
      const normalized = error instanceof Error ? error : new Error(String(error));
      this.recordingError = normalized;
      try {
        this.emitter.emit('error', normalized);
      } catch {
        // Preserve the assembly failure.
      }
      throw normalized;
    } finally {
      this.teardown();
    }
    this.emitter.emit('stop', clip);
    return clip;
  }

  dispose(): void {
    if (this.state === 'disposed') return;
    this.state = 'disposed';
    this.lifecycleGeneration++;
    this.teardown();
    this.emitter.removeAllListeners();
  }

  on<K extends keyof AudioRecorderEvents>(event: K, listener: (data: AudioRecorderEvents[K]) => void): () => void {
    return this.emitter.on(event, listener);
  }
  once<K extends keyof AudioRecorderEvents>(event: K, listener: (data: AudioRecorderEvents[K]) => void): () => void {
    return this.emitter.once(event, listener);
  }
  off<K extends keyof AudioRecorderEvents>(event: K, listener: (data: AudioRecorderEvents[K]) => void): void {
    this.emitter.off(event, listener);
  }

  private teardown(): void {
    cleanupRecorderResources({
      stream: this.stream,
      context: this.context,
      source: this.source,
      analyser: this.analyser,
      processor: this.processor,
    });
    this.processor = null;
    this.source = null;
    this.analyser = null;
    this.stream = null;
    this.context = null;
    this.chunks = [];
    this.recordedFrames = 0;
    this.recordedBytes = 0;
    this.currentLevel = 0;
  }

  private failRecording(error: unknown): void {
    const normalized = error instanceof Error ? error : new Error(String(error));
    this.recordingError = normalized;
    this.state = 'idle';
    this.lifecycleGeneration++;
    this.teardown();
    try {
      this.emitter.emit('error', normalized);
    } catch {
      // Audio callbacks cannot allow a listener fault to restart capture.
    }
  }
}

interface RecorderResources {
  stream: MediaStream | null;
  context: AudioContext | null;
  source: MediaStreamAudioSourceNode | null;
  analyser: AnalyserNode | null;
  processor: ScriptProcessorNode | null;
}

function cleanupRecorderResources(resources: RecorderResources): void {
  if (resources.processor) {
    resources.processor.onaudioprocess = null;
    try {
      resources.processor.disconnect();
    } catch {
      /* already disconnected */
    }
  }
  try {
    resources.source?.disconnect();
  } catch {
    /* already disconnected */
  }
  try {
    resources.analyser?.disconnect();
  } catch {
    /* already disconnected */
  }
  let tracks: MediaStreamTrack[] = [];
  try {
    tracks = resources.stream?.getTracks() ?? [];
  } catch {
    /* a broken host stream must not prevent context cleanup */
  }
  for (const track of tracks) {
    try {
      track.stop();
    } catch {
      /* continue stopping the remaining tracks */
    }
  }
  if (resources.context) {
    try {
      void resources.context.close().catch(() => {});
    } catch {
      /* context already closed */
    }
  }
}

/** Build an {@link AudioRecorder} (the `createX` convention). */
export function createAudioRecorder(options?: AudioRecorderOptions): AudioRecorder {
  return new AudioRecorder(options);
}

/** Concatenate a list of Float32Array chunks into one contiguous array. */
function concat(chunks: Float32Array[]): Float32Array {
  let total = 0;
  for (const c of chunks) {
    total += c.length;
    if (!Number.isSafeInteger(total)) throw new RangeError('Recorded sample length is too large');
  }
  const out = new Float32Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

function positiveSafeInteger(value: number | undefined, fallback: number, name: string): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < 1) {
    throw new RangeError(`${name} must be a positive safe integer`);
  }
  return resolved;
}
