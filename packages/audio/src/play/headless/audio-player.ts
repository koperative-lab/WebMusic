import {EventEmitter, AudioDocumentApplicationError, isAudioDocumentSource, type AudioDocumentSource, type AudioDocumentPlaybackBinding, type AudioDocumentRevision, type AudioDocumentApplicationResult, type AudioPlaybackSourceSnapshot, type AudioDocumentSnapshot, type AudioClip, type Region} from '../../core';
import {AudioDocumentBinding} from './audio-document-binding';
import {AudioSequenceEngine} from './sequence-engine';
import {createWebAudioContext} from '@webmusic/kernel/audio-context';
import type {TransportClockReader} from '@webmusic/kernel/transport';
import {AudioClipPlayer, type AudioClipPlayerOptions, type AudioScratchSession, type PlayerTimeUpdate} from './player';
import {normalizeLoopOption} from './engines/buffer-engine';

/** Borrowed group playback. Releasing a connection never stops or disposes it. */
export interface AudioPlayerTransport {
  readonly seconds: number;
  readonly duration: number;
  readonly playing: boolean;
  readonly clip?: AudioClip;
  readonly currentClip?: AudioClip;
  readonly analyser?: AnalyserNode;
  readonly clock?: TransportClockReader;
  play(when?: number): void | Promise<void>;
  pause(): void;
  stop(): void;
  seek(seconds: number): void;
  setLoop?(loop: boolean | {start: number; end: number}): void;
  setRate?(rate: number): void;
  setVolume?(volume: number): void;
  setPan?(pan: number): void;
  setPreservesPitch?(preservesPitch: boolean): void;
  preload?(): void | Promise<void>;
  beginScratch?(): AudioScratchSession | undefined;
  readonly scratching?: boolean;
  /** Source or transport state changed; observers read the accepted snapshot. */
  subscribe?(notify: () => void): () => void;
  onLoad?(notify: () => void): () => void;
  onEnd?(notify: () => void): () => void;
  onError?(notify: (error: Error) => void): () => void;
}

export interface AudioPlayerOptions extends AudioClipPlayerOptions {
  /** Maximum total active/inactive sequence chunk PCM, default 64 MiB. */
  preparedBytesLimit?: number;
  /** Bounded sequence read size, default 16384 frames. */
  chunkFrames?: number;
}

export type AudioPlayerSourceDetail = AudioPlaybackSourceSnapshot;

export interface AudioPlayerEvents {
  sourcechange: AudioPlayerSourceDetail;
  documentstatechange: AudioDocumentPlaybackBinding;
  statechange: {playing: boolean};
  timeupdate: PlayerTimeUpdate;
  end: AudioClip | undefined;
  regionenter: Region;
  regionleave: Region;
  beat: {index: number; seconds: number};
  load: {duration: number};
  error: Error;
}

/**
 * Stable playback owner for a selected clip or a borrowed playlist/mixer.
 * Clip replacement stops the old owned engine and starts the new source at zero.
 * Selecting another nonempty source pauses the old transport without resetting it.
 * Detaching or disposing never pauses or disposes a borrowed transport.
 */
export class AudioPlayer {
  private readonly options: AudioPlayerOptions;
  private readonly emitter = new EventEmitter<AudioPlayerEvents>();
  private readonly documentAttachment: AudioDocumentBinding;
  private sequenceEngine?: AudioSequenceEngine;
  private appliedDocument?: AudioDocumentSnapshot;
  private announcedDocument?: AudioDocumentSnapshot;
  private selectedClip?: AudioClip;
  private engine?: AudioClipPlayer;
  private borrowed?: AudioPlayerTransport;
  private context?: AudioContext;
  private output?: AnalyserNode;
  private releases: Array<() => void> = [];
  private observer: ReturnType<typeof setInterval> | undefined;
  private generation = 0;
  private documentGeneration = 0;
  private observationRevision = 0;
  private lastPlaying = false;
  private readonly configured = new Set<string>();
  private sourceRevision = 0;
  private announcedClip?: AudioClip;
  private announcedTransport?: AudioPlayerTransport;
  private disposed = false;
  private storedVolume: number;
  private storedPan: number;
  private storedRate: number;
  private storedLoop: boolean | {start: number; end: number};
  private storedPreservesPitch: boolean;

  constructor(clip?: AudioClip, options: AudioPlayerOptions = {}) {
    this.options = {...options};
    for (const key of ['volume', 'pan', 'rate', 'loop', 'preservesPitch']) {
      if (Object.prototype.hasOwnProperty.call(options, key)) this.configured.add(key);
    }
    this.selectedClip = clip;
    this.announcedClip = clip;
    this.storedVolume = options.volume ?? 1;
    this.storedPan = options.pan ?? 0;
    this.storedRate = options.rate ?? 1;
    this.storedLoop = normalizeLoopOption(options.loop ?? false);
    this.storedPreservesPitch = options.preservesPitch ?? false;
    this.documentAttachment = new AudioDocumentBinding({
      pause: () => { this.sequenceEngine?.pause(); this.engine?.pause(); this.publishState(); },
      transport: () => ({sampleRate: this.appliedDocument?.content.sampleRate ?? 1,
        seconds: this.seconds, loop: this.sequenceEngine?.loopOption ?? this.storedLoop}),
      adopt: (snapshot, seconds, loop) => {
        if (!this.sequenceEngine) throw new AudioDocumentApplicationError('not-ready', 'No sequence transport');
        if (!this.sequenceEngine.adopt(snapshot.content, snapshot.assets, seconds, loop)) {
          throw new AudioDocumentApplicationError('not-ready', 'Sequence adoption was superseded');
        }
        this.storedLoop = this.sequenceEngine.loopOption;
        this.appliedDocument = snapshot;
      },
      notify: () => {
        const state = this.documentBinding;
        this.publishSource();
        if (this.documentBinding !== state) return;
        this.emitter.emit('documentstatechange', state);
        if (this.documentBinding === state) this.publishState();
      },
      onDetach: () => { this.releaseSource(); this.appliedDocument = undefined; this.storedLoop = false; this.publishSource(); },
      report: (error) => this.emitter.emit('error', error instanceof Error ? error : new Error(String(error))),
    });
  }

  get documentSource(): AudioDocumentSource | undefined { return this.documentAttachment.getSource(); }
  get documentBinding(): AudioDocumentPlaybackBinding { return this.documentAttachment.getState(); }
  get source(): AudioPlaybackSourceSnapshot {
    const snapshot = this.appliedDocument;
    if (snapshot && this.sequenceEngine) return Object.freeze({kind: 'sequence', clip: undefined,
      sequence: snapshot.content, assets: snapshot.assets, documentId: snapshot.documentId,
      documentRevision: snapshot.documentRevision, revision: this.sourceRevision});
    const clip = this.clip;
    return clip ? Object.freeze({kind: 'clip', clip, revision: this.sourceRevision}) :
      Object.freeze({kind: 'empty', clip: undefined, revision: this.sourceRevision});
  }
  setDocumentSource(source: AudioDocumentSource | undefined): void {
    if (this.disposed) throw new AudioDocumentApplicationError('disposed', 'AudioPlayer has been disposed');
    if (source === this.documentSource) return;
    if (source !== undefined && !isAudioDocumentSource(source)) throw new AudioDocumentApplicationError('invalid-source', 'Expected an AudioDocumentSource');
    if (source && (this.selectedClip || (this.borrowed && this.borrowed !== this.sequenceEngine))) {
      throw new AudioDocumentApplicationError('source-conflict', 'Document source conflicts with the selected clip or transport');
    }
    const generation = ++this.documentGeneration;
    if (this.documentSource) this.documentAttachment.setSource(undefined);
    if (generation !== this.documentGeneration || this.disposed) return;
    if (source) {
      const engine = new AudioSequenceEngine(() => this.audioContext, {...this.options,
        volume: this.storedVolume, pan: this.storedPan, rate: this.storedRate, loop: this.storedLoop});
      this.sequenceEngine = engine;
      this.applyTransport(engine);
      if (generation !== this.documentGeneration || this.borrowed !== engine || this.disposed) { engine.dispose(); return; }
    }
    this.documentAttachment.setSource(source);
    if (source && generation === this.documentGeneration && this.documentSource === source && this.configured.has('loop')) {
      this.documentAttachment.recordLoopIntent(this.storedLoop);
    }
  }
  waitForDocumentRevision(target: AudioDocumentRevision): Promise<AudioDocumentApplicationResult> { return this.documentAttachment.wait(target); }
  retryDocumentApplication(): Promise<AudioDocumentApplicationResult> { return this.documentAttachment.retry(); }

  get clip(): AudioClip | undefined { return this.borrowed ? this.borrowed.clip ?? this.borrowed.currentClip : this.selectedClip; }
  get transport(): AudioPlayerTransport | undefined { return this.borrowed; }
  get seconds(): number { return this.borrowed?.seconds ?? this.engine?.seconds ?? 0; }
  get currentTime(): number { return this.seconds; }
  get duration(): number { return this.borrowed?.duration ?? this.engine?.duration ?? this.selectedClip?.duration ?? 0; }
  get progress(): number { return this.duration > 0 ? this.seconds / this.duration : 0; }
  get playing(): boolean { return this.borrowed?.playing ?? this.engine?.playing ?? false; }
  get scratching(): boolean { return this.borrowed?.scratching ?? this.engine?.scratching ?? false; }
  get clock(): TransportClockReader | undefined { return this.borrowed ? this.borrowed.clock : this.engine?.clock; }
  /** Lazily create or borrow the context shared by decoding and owned playback. */
  get audioContext(): AudioContext {
    if (this.disposed) throw new Error('AudioPlayer has been disposed');
    this.context ??= this.options.audioContext ?? createWebAudioContext('AudioContext is not available in this environment');
    return this.context;
  }
  get volume(): number { return this.storedVolume; }
  get pan(): number { return this.storedPan; }
  get rate(): number { return this.storedRate; }
  /** Stable owned output tap; a borrowed group exposes only its own supported tap. */
  get analyser(): AnalyserNode | undefined {
    if (this.disposed) return undefined;
    if (this.borrowed) return this.borrowed.analyser;
    if (!this.selectedClip) return undefined;
    return this.ensureOutput();
  }

  setClip(clip: AudioClip | undefined): void {
    if (this.documentSource && clip !== undefined) throw new AudioDocumentApplicationError('source-conflict', 'Clip conflicts with document source');
    if (this.documentSource) { this.setDocumentSource(undefined); return; }
    if (this.disposed || (!this.borrowed && clip === this.selectedClip)) return;
    const revision = ++this.generation;
    if (clip) (this.borrowed ?? this.engine)?.pause();
    if (this.disposed || revision !== this.generation) return;
    this.releaseSource();
    if (this.disposed || revision !== this.generation) return;
    this.selectedClip = clip;
    this.publishSource();
    if (revision === this.generation && !this.disposed) this.publishState();
  }

  setTransport(transport: AudioPlayerTransport | undefined): void {
    if (this.documentSource && transport) throw new AudioDocumentApplicationError('source-conflict', 'Transport conflicts with document source');
    if (this.documentSource) { this.setDocumentSource(undefined); return; }
    this.applyTransport(transport);
  }
  private applyTransport(transport: AudioPlayerTransport | undefined): void {
    if (this.disposed || transport === this.borrowed) return;
    if (transport instanceof AudioPlayer) {
      throw new TypeError('AudioPlayer cannot borrow another AudioPlayer; connect the playlist or mixer transport directly');
    }
    const revision = ++this.generation;
    if (transport) (this.borrowed ?? this.engine)?.pause();
    if (this.disposed || revision !== this.generation) return;
    this.releaseSource();
    if (this.disposed || revision !== this.generation) return;
    this.selectedClip = undefined;
    this.borrowed = transport;
    if (transport) {
      const current = () => !this.disposed && this.borrowed === transport && revision === this.generation;
      const own = (release: (() => void) | undefined) => {
        if (!release) return;
        if (current()) this.releases.push(release);
        else release();
      };
      try {
        if (this.configured.has('loop') && transport.setLoop) transport.setLoop(this.storedLoop);
        if (this.configured.has('volume')) transport.setVolume?.(this.storedVolume);
        if (current() && this.configured.has('rate')) transport.setRate?.(this.storedRate);
        if (current() && this.configured.has('pan')) transport.setPan?.(this.storedPan);
        if (current() && this.configured.has('preservesPitch')) transport.setPreservesPitch?.(this.storedPreservesPitch);
        if (!current()) return;
        own(transport.subscribe?.(() => {
          if (!current()) return;
          this.publishSource();
          if (current()) this.publishState();
        }));
        if (current()) own(transport.onEnd?.(() => {
          if (!current()) return;
          this.stopObserver();
          this.publishState();
          if (current()) this.emitter.emit('end', this.clip);
        }));
        if (current()) own(transport.onError?.((error) => { if (current()) this.emitter.emit('error', error); }));
        if (current()) own(transport.onLoad?.(() => { if (current()) this.emitter.emit('load', {duration: this.duration}); }));
      } catch (error) {
        if (current()) this.releaseSource();
        throw error;
      }
      if (!current()) return;
    }
    this.publishSource();
    if (revision === this.generation && !this.disposed) this.publishState();
  }

  async play(when?: number): Promise<void> {
    if (this.disposed) return;
    this.documentAttachment.assertPlayable();
    const generation = this.generation;
    const target = this.borrowed ?? this.ensureEngine();
    if (!target) return;
    await target.play(when);
    if (!this.disposed && generation === this.generation) this.publishState();
  }
  pause(): void {
    if (this.disposed) return;
    const generation = this.generation;
    (this.borrowed ?? this.engine)?.pause();
    if (!this.disposed && generation === this.generation) this.publishState();
  }
  stop(): void {
    if (this.disposed) return;
    const generation = this.generation;
    this.documentAttachment.recordPositionIntent(0, true);
    (this.borrowed ?? this.engine)?.stop();
    if (!this.disposed && generation === this.generation) this.publishState();
  }
  seek(seconds: number): void {
    if (this.disposed) return;
    if (!Number.isFinite(seconds)) throw new RangeError('Seek position must be finite');
    const generation = this.generation;
    this.documentAttachment.recordPositionIntent(seconds);
    (this.borrowed ?? this.ensureEngine())?.seek(seconds);
    if (!this.disposed && generation === this.generation) this.publishState();
  }
  seekFraction(fraction: number): void { this.seek(Math.max(0, Math.min(1, fraction)) * this.duration); }
  scrub(deltaSeconds: number): void { this.seek(this.seconds + deltaSeconds); }
  beginScratch(): AudioScratchSession | undefined {
    if (this.disposed || (!this.borrowed && !this.selectedClip?.hasSamples)) return undefined;
    return (this.borrowed ?? this.ensureEngine())?.beginScratch?.();
  }
  async preload(): Promise<void> {
    if (this.disposed) return;
    await (this.borrowed ?? this.ensureEngine())?.preload?.();
  }
  setRate(rate: number): void {
    if (this.disposed) return;
    const accepted = finite(rate, 0.25, 4);
    this.requireCapability('setRate');
    (this.borrowed ?? this.engine)?.setRate?.(accepted);
    this.storedRate = accepted;
    this.configured.add('rate');
  }
  setVolume(volume: number): void {
    if (this.disposed) return;
    const accepted = finite(volume, 0, Infinity);
    this.requireCapability('setVolume');
    (this.borrowed ?? this.engine)?.setVolume?.(accepted);
    this.storedVolume = accepted;
    this.configured.add('volume');
  }
  setPan(pan: number): void {
    if (this.disposed) return;
    const accepted = finite(pan, -1, 1);
    this.requireCapability('setPan');
    (this.borrowed ?? this.engine)?.setPan?.(accepted);
    this.storedPan = accepted;
    this.configured.add('pan');
  }
  setLoop(loop: boolean | {start: number; end: number}): void {
    if (this.disposed) return;
    const accepted = normalizeLoopOption(loop);
    this.requireCapability('setLoop');
    (this.borrowed ?? this.engine)?.setLoop?.(accepted);
    this.storedLoop = this.sequenceEngine?.loopOption ?? accepted;
    this.configured.add('loop');
    this.documentAttachment.recordLoopIntent(this.storedLoop);
  }
  setPreservesPitch(preservesPitch: boolean): void {
    if (this.disposed) return;
    this.requireCapability('setPreservesPitch');
    (this.borrowed ?? this.engine)?.setPreservesPitch?.(preservesPitch);
    this.storedPreservesPitch = preservesPitch;
    this.configured.add('preservesPitch');
  }
  private requireCapability(method: keyof AudioPlayerTransport): void {
    if (this.borrowed && typeof this.borrowed[method] !== 'function') {
      throw new Error(`The selected audio transport does not support ${method}`);
    }
  }
  on<K extends keyof AudioPlayerEvents>(event: K, listener: (data: AudioPlayerEvents[K]) => void): () => void { return this.emitter.on(event, listener); }
  once<K extends keyof AudioPlayerEvents>(event: K, listener: (data: AudioPlayerEvents[K]) => void): () => void { return this.emitter.once(event, listener); }
  off<K extends keyof AudioPlayerEvents>(event: K, listener: (data: AudioPlayerEvents[K]) => void): void { this.emitter.off(event, listener); }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.generation++;
    let failure: unknown;
    try { this.documentAttachment.dispose(); } catch (error) { failure = error; }
    try { this.releaseSource(); } catch (error) { failure = error; }
    try { this.output?.disconnect(); } catch (error) { failure ??= error; }
    this.output = undefined;
    const context = this.context;
    this.context = undefined;
    if (context && !this.options.audioContext) {
      try { void context.close().catch(() => {}); } catch (error) { failure ??= error; }
    }
    this.selectedClip = undefined;
    this.announcedClip = undefined;
    this.announcedTransport = undefined;
    this.lastPlaying = false;
    // Commit terminal emptiness before notifying. One faulty subscriber must
    // not prevent other followers from releasing their borrowed source/tap.
    const observerFailed = (error: unknown, mode: 'throw' | 'rejection') => {
      if (mode === 'throw') failure ??= error;
    };
    this.emitter.emitSafely('sourcechange', {kind: 'empty', clip: undefined, revision: ++this.sourceRevision}, observerFailed);
    this.emitter.emitSafely('statechange', {playing: false}, observerFailed);
    this.emitter.emitSafely('timeupdate', {seconds: 0, duration: 0, progress: 0}, observerFailed);
    this.emitter.removeAllListeners();
    if (failure !== undefined) throw failure;
  }

  private ensureOutput(): AnalyserNode {
    if (this.output) return this.output;
    const context = this.audioContext;
    const output = context.createAnalyser();
    try {
      output.fftSize = 2048;
      output.smoothingTimeConstant = 0.8;
      output.connect(this.options.destination ?? context.destination);
    } catch (error) {
      try { output.disconnect(); } catch { /* release the candidate output */ }
      throw error;
    }
    this.output = output;
    return output;
  }

  private ensureEngine(): AudioClipPlayer | undefined {
    if (this.engine || !this.selectedClip || this.disposed || this.borrowed) return this.engine;
    const destination = this.ensureOutput();
    const engine = new AudioClipPlayer(this.selectedClip, {
      ...this.options,
      audioContext: this.context,
      destination,
      volume: this.storedVolume,
      pan: this.storedPan,
      rate: this.storedRate,
      loop: this.storedLoop,
      preservesPitch: this.storedPreservesPitch,
    });
    this.engine = engine;
    const current = () => !this.disposed && this.engine === engine;
    const events = ['timeupdate', 'end', 'regionenter', 'regionleave', 'beat', 'load', 'error'] as const;
    for (const event of events) {
      this.releases.push(engine.on(event, (detail) => {
        if (!current()) return;
        // A callback can replace the source; every subsequent callback checks identity.
        this.emitter.emit(event, detail);
        if (current() && event === 'end') this.publishState();
      }));
    }
    return engine;
  }

  private releaseSource(): void {
    this.stopObserver();
    const releases = this.releases;
    const engine = this.engine;
    const sequence = this.borrowed === this.sequenceEngine ? this.sequenceEngine : undefined;
    if (sequence) this.sequenceEngine = undefined;
    this.releases = [];
    this.engine = undefined;
    this.borrowed = undefined;
    let failure: unknown;
    for (const release of releases) {
      try { release(); } catch (error) { failure ??= error; }
    }
    try { engine?.dispose(); } catch (error) { failure ??= error; }
    try { sequence?.dispose(); } catch (error) { failure ??= error; }
    if (failure !== undefined) throw failure;
  }

  private publishSource(): void {
    const clip = this.clip;
    const transport = this.borrowed;
    if (clip === this.announcedClip && transport === this.announcedTransport && this.appliedDocument === this.announcedDocument) return;
    this.announcedDocument = this.appliedDocument;
    this.announcedClip = clip;
    this.announcedTransport = transport;
    this.sourceRevision++;
    this.emitter.emit('sourcechange', this.source);
  }

  private publishState(): void {
    const generation = this.generation;
    const revision = ++this.observationRevision;
    const playing = this.playing;
    if (playing !== this.lastPlaying) {
      this.lastPlaying = playing;
      this.emitter.emit('statechange', {playing});
    }
    if (this.disposed || generation !== this.generation || revision !== this.observationRevision) return;
    this.emitter.emit('timeupdate', {seconds: this.seconds, duration: this.duration, progress: this.progress});
    if (this.disposed || generation !== this.generation || revision !== this.observationRevision) return;
    if (this.borrowed && this.playing && this.observer === undefined) {
      // Observation only: positions always come from the borrowed authority.
      this.observer = setInterval(() => {
        if (this.disposed || generation !== this.generation) return;
        this.publishSource();
        if (!this.disposed && generation === this.generation) this.publishState();
      }, this.options.cursorIntervalMs ?? 50);
    } else if (!this.borrowed || !playing) this.stopObserver();
  }
  private stopObserver(): void {
    if (this.observer !== undefined) clearInterval(this.observer);
    this.observer = undefined;
  }
}

export function createAudioPlayer(clip?: AudioClip, options?: AudioPlayerOptions): AudioPlayer {
  return new AudioPlayer(clip, options);
}

function finite(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) throw new RangeError('Audio player setting must be finite');
  return Math.max(min, Math.min(max, value));
}
