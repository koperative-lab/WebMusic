import {EventEmitter, AudioDocumentApplicationError, audioSequenceTempoGrid, isAudioDocumentSource, type AudioDocumentSource, type AudioDocumentPlaybackBinding, type AudioDocumentRevision, type AudioDocumentApplicationResult, type AudioPlaybackSourceSnapshot, type AudioDocumentSnapshot, type AudioClip, type Region} from '../../core';
import {AudioDocumentBinding} from './audio-document-binding';
import {AudioSequenceEngine} from './sequence-engine';
import {createWebAudioContext} from '@webmusic/kernel/audio-context';
import {InsertChain, type Effect} from '@webmusic/kernel/effect';
import {AudioOutputPort, createConnectionLease, SOURCE_SCHEMAS, SourcePublisher, type ModuleHandle, type ModulePort} from '@webmusic/kernel/module';
import {TempoClock, createTempoGrid, type TempoGrid, type TransportClockReader} from '@webmusic/kernel/transport';
import type {SessionSchedulingBinding} from '@webmusic/kernel/session';
import type {ConnectionLease} from '@webmusic/kernel/module';
import {EXTERNAL_TIMING_CAPABILITIES, BUFFER_TIMING_CAPABILITIES, MEDIA_TIMING_CAPABILITIES, type PlaybackTimingCapabilities, type PlaybackSchedulingMode} from './engines/buffer-engine';
import {AudioClipPlayer, type AudioClipPlayerOptions, type AudioScratchSession, type PlayerTimeUpdate} from './player';
import {normalizeLoopOption} from './engines/buffer-engine';

/** Borrowed group playback. Releasing a connection never stops or disposes it. */
export interface AudioPlayerTransport {
  readonly seconds: number;
  readonly duration: number;
  readonly playing: boolean;
  /** Preparation of the selected input, excluding unrelated speculative prefetch. */
  readonly loading?: boolean;
  readonly loadError?: Error;
  readonly clip?: AudioClip;
  readonly currentClip?: AudioClip;
  readonly analyser?: AnalyserNode;
  /** The group's stable output (a queue bus or a mix master), without preparing it. */
  peekOutputPort?(): AudioOutputPort | undefined;
  /** Queue capability: the selected entry changed (DEC-068 queue source). */
  onTrackChange?(notify: () => void): () => void;
  /** Play in a scope's AudioContext so the group and its Session share one clock. */
  adoptAudioContext?(context: AudioContext): void;
  readonly clock?: TransportClockReader;
  readonly timingCapabilities?: PlaybackTimingCapabilities;
  readonly schedulingMode?: PlaybackSchedulingMode;
  readonly followsSession?: boolean;
  attachScheduling?(binding: SessionSchedulingBinding): ConnectionLease;
  activateScheduling?(): Promise<void>;
  play(when?: number): void | Promise<void>;
  pause(): void;
  stop(): void;
  seek(seconds: number): void;
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
  loadstatechange: {loading: boolean; error: Error | undefined};
  timeupdate: PlayerTimeUpdate;
  end: AudioClip | undefined;
  regionenter: Region;
  regionleave: Region;
  beat: {index: number; seconds: number};
  load: {duration: number};
  error: Error;
}

let audioPlayerModuleSequence = 0;

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
  /** Latest requested document, set before the binding exists so reentrant requests compare with it. */
  private documentTarget?: AudioDocumentSource;
  private appliedDocument?: AudioDocumentSnapshot;
  private announcedDocument?: AudioDocumentSnapshot;
  private selectedClip?: AudioClip;
  private engine?: AudioClipPlayer;
  private borrowed?: AudioPlayerTransport;
  private scheduling?: ConnectionLease;
  private context?: AudioContext;
  private output?: AnalyserNode;
  private inserts?: InsertChain;
  private port?: AudioOutputPort;
  private preparingOutput = false;
  private readonly moduleListeners = new Set<() => void>();
  /** The clip this player plays, as a `webmusic.audio-clip` source port (DEC-068). */
  private readonly sourcePort = new SourcePublisher<AudioClip>(SOURCE_SCHEMAS.audioClip, {id: 'source'});
  /** Stable nonvisual identity. Capability reads never prepare audio. */
  readonly module: ModuleHandle;
  private releases: Array<() => void> = [];
  private observer: ReturnType<typeof setInterval> | undefined;
  private generation = 0;
  private documentGeneration = 0;
  private observationRevision = 0;
  private lastPlaying = false;
  private lastLoading = false;
  private lastLoadError?: Error;
  private readonly configured = new Set<string>();
  private sourceRevision = 0;
  private announcedClip?: AudioClip;
  private announcedTransport?: AudioPlayerTransport;
  private disposed = false;
  private storedVolume: number;
  private storedPan: number;
  private storedRate: number;
  /** Configured loop intent; the sequence engine separately holds the mapped loop it accepted. */
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
    const readInserts = () => this.inserts;
    this.module = {
      id: `audio-player-${++audioPlayerModuleSequence}`,
      get inserts() { return readInserts(); },
      getPort: (name) => name === 'output' || name === 'main' ? this.currentOutputPort() : undefined,
      ports: () => this.modulePorts(),
      prepare: () => this.preload(),
      subscribe: (listener) => {
        this.moduleListeners.add(listener);
        const off = this.on('sourcechange', listener);
        return () => { this.moduleListeners.delete(listener); off(); };
      },
    };
    this.documentAttachment = new AudioDocumentBinding({
      pause: () => { this.sequenceEngine?.pause(); this.engine?.pause(); this.publishState(); },
      transport: () => ({sampleRate: this.appliedDocument?.content.sampleRate ?? 1,
        seconds: this.seconds, loop: this.sequenceEngine?.loopOption ?? this.storedLoop}),
      adopt: (snapshot, seconds, loop) => {
        if (!this.sequenceEngine) throw new AudioDocumentApplicationError('not-ready', 'No sequence transport');
        if (!this.sequenceEngine.adopt(snapshot.content, snapshot.assets, seconds, loop)) {
          throw new AudioDocumentApplicationError('not-ready', 'Sequence adoption was superseded');
        }
        this.appliedDocument = snapshot;
      },
      retag: (snapshot) => {
        if (!this.sequenceEngine || !this.appliedDocument || this.appliedDocument.assets !== snapshot.assets) return false;
        if (!this.sequenceEngine.retag(snapshot.content, snapshot.assets)) return false;
        this.appliedDocument = snapshot;
        return true;
      },
      notify: () => {
        const state = this.documentBinding;
        this.publishSource();
        if (this.documentBinding !== state) return;
        this.emitter.emit('documentstatechange', state);
        if (this.documentBinding === state) this.publishState();
      },
      onDetach: () => { this.releaseSource(); this.appliedDocument = undefined; this.publishSource(); },
      report: (error) => this.emitter.emit('error', error instanceof Error ? error : new Error(String(error))),
    });
    this.syncSourcePort();
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
    if (source === this.documentTarget) return;
    if (source !== undefined && !isAudioDocumentSource(source)) throw new AudioDocumentApplicationError('invalid-source', 'Expected an AudioDocumentSource');
    if (source && (this.selectedClip || (this.borrowed && this.borrowed !== this.sequenceEngine))) {
      throw new AudioDocumentApplicationError('source-conflict', 'Document source conflicts with the selected clip or transport');
    }
    const generation = ++this.documentGeneration;
    this.documentTarget = source;
    if (this.documentSource) this.documentAttachment.setSource(undefined);
    // A source callback can supersede an attachment whose engine is selected but not yet bound.
    else if (this.sequenceEngine && this.borrowed === this.sequenceEngine) { this.releaseSource(); this.publishSource(); }
    if (generation !== this.documentGeneration || this.disposed) return;
    // A detach listener's newer clip/transport selection wins over this request.
    if (source && (this.selectedClip || this.borrowed)) { this.documentTarget = undefined; return; }
    if (source) {
      let engine: AudioSequenceEngine;
      try {
        // Document playback flows through this player's own inserts and module
        // output, so it is routed, patched and tapped like a clip (DEC-068).
        const engineOptions = {...this.options,
          volume: this.storedVolume, pan: this.storedPan, rate: this.storedRate, loop: this.storedLoop,
          // A module scope's environment delivers lookahead ticks (rendered
          // time in an offline render).
          ...(this.options.moduleContext?.audio.createTickSource ? {createTickSource: this.options.moduleContext.audio.createTickSource} : {})};
        Object.defineProperty(engineOptions, 'destination', {enumerable: true, get: () => this.documentOutputInput()});
        engine = new AudioSequenceEngine(() => this.audioContext, engineOptions);
      } catch (error) {
        // Invalid sequence limits reject this request; the same source can be retried.
        if (generation === this.documentGeneration) this.documentTarget = this.documentSource;
        throw error;
      }
      this.sequenceEngine = engine;
      const abandon = () => {
        if (generation === this.documentGeneration) this.documentTarget = this.documentSource;
        if (this.sequenceEngine === engine && this.borrowed !== engine) this.sequenceEngine = undefined;
        if (this.borrowed !== engine) engine.dispose();
      };
      try { this.applyTransport(engine); } catch (error) { abandon(); throw error; }
      if (generation !== this.documentGeneration || this.borrowed !== engine || this.disposed) { abandon(); return; }
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
  get loading(): boolean { return this.borrowed?.loading ?? false; }
  get loadError(): Error | undefined { return this.borrowed?.loadError; }
  get scratching(): boolean { return this.borrowed?.scratching ?? this.engine?.scratching ?? false; }
  get clock(): TransportClockReader | undefined { return this.borrowed ? this.borrowed.clock : this.engine?.clock; }
  /**
   * Constant-tempo grid of the playing content on the clock's seconds axis:
   * the applied document's beat grid, else the selected clip's `beatGrid`
   * (its tempo, anchored at its first downbeat or beat). Undefined without one.
   */
  get tempoGrid(): TempoGrid | undefined {
    if (this.appliedDocument) return audioSequenceTempoGrid(this.appliedDocument.content);
    const grid = this.borrowed ? undefined : this.clip?.beatGrid;
    return grid ? createTempoGrid({bpm: grid.bpm, anchor: grid.downbeats?.[0] ?? grid.beats[0]}) : undefined;
  }
  /** The player clock read in beats of {@link tempoGrid}; undefined without a clock or grid. */
  get tempoClock(): TempoClock | undefined {
    const clock = this.clock, grid = this.tempoGrid;
    return clock && grid ? new TempoClock(clock, grid) : undefined;
  }
  /** Lazily create or borrow the context shared by decoding and owned playback. */
  get audioContext(): AudioContext {
    if (this.disposed) throw new Error('AudioPlayer has been disposed');
    this.context ??= this.options.audioContext ?? (this.options.moduleContext?.audio.prepare() as AudioContext | undefined) ?? createWebAudioContext('AudioContext is not available in this environment');
    return this.context;
  }
  peekAudioContext(): AudioContext | undefined {
    return this.context ?? this.options.audioContext ?? this.options.moduleContext?.audio.peek() as AudioContext | undefined;
  }
  get volume(): number { return this.storedVolume; }
  get pan(): number { return this.storedPan; }
  get rate(): number { return this.engine?.playbackRate ?? this.storedRate; }
  get timingCapabilities(): PlaybackTimingCapabilities {
    if (this.borrowed) return this.borrowed.timingCapabilities ?? EXTERNAL_TIMING_CAPABILITIES;
    if (this.engine) return this.engine.timingCapabilities;
    if (!this.selectedClip) return EXTERNAL_TIMING_CAPABILITIES;
    const kind = this.options.engine ?? 'auto';
    return kind === 'media' || kind === 'auto' && this.selectedClip.sourceUrl && (!this.selectedClip.hasSamples || this.selectedClip.duration > 600)
      ? MEDIA_TIMING_CAPABILITIES : BUFFER_TIMING_CAPABILITIES;
  }
  get followsSession(): boolean { return this.scheduling?.active || this.borrowed?.followsSession || this.engine?.followsSession || false; }
  get schedulingMode(): PlaybackSchedulingMode {
    return this.borrowed?.schedulingMode ?? this.engine?.schedulingMode ?? (this.timingCapabilities.engine === 'media' ? 'approximate-media' : 'independent');
  }

  async activateScheduling(): Promise<void> {
    if (this.disposed) throw new Error('AudioPlayer has been disposed');
    const generation = this.generation;
    const target = this.borrowed ?? this.ensureEngine();
    if (!target?.activateScheduling) throw new Error('The selected transport cannot activate shared Session scheduling.');
    await target.activateScheduling();
    if (this.disposed || generation !== this.generation) throw new Error('AudioPlayer activation was cancelled');
  }

  attachScheduling(binding: SessionSchedulingBinding): ConnectionLease {
    if (this.disposed) throw new Error('AudioPlayer has been disposed');
    if (this.scheduling?.active) throw new Error('AudioPlayer already follows a Session.');
    const generation = this.generation;
    const target = this.borrowed ?? this.ensureEngine();
    if (!target?.attachScheduling) throw new Error('The selected transport does not support shared Session scheduling.');
    const attachment = target.attachScheduling(binding);
    if (this.disposed || generation !== this.generation) {
      attachment.release();
      throw new Error('AudioPlayer scheduling attachment was cancelled');
    }
    const cleanup = createConnectionLease(() => {
      if (this.scheduling === lease) this.scheduling = undefined;
      attachment.release();
    });
    const lease: ConnectionLease = Object.freeze({
      get active() { return cleanup.active && attachment.active; },
      release: () => cleanup.release(),
    });
    this.scheduling = lease;
    return lease;
  }
  /**
   * Whether this player owns its output chain: a selected clip or an attached
   * document. A borrowed group (playlist, mixer) keeps its own.
   */
  private get ownsOutput(): boolean {
    return !this.disposed && (!this.borrowed ? !!this.selectedClip : !!this.sequenceEngine && this.borrowed === this.sequenceEngine);
  }

  /** The input of this player's output chain, for the document sequence engine. */
  private documentOutputInput(): AudioNode | undefined {
    this.ensureOutput();
    return this.inserts?.input;
  }

  /** Source-local post-fader processing. A borrowed group retains its own effects. */
  setEffect(effect: Effect | undefined): void {
    if (this.disposed) return;
    if (this.borrowed && !this.ownsOutput) throw new Error('Configure effects on the borrowed transport or its master bus');
    this.inserts?.setCompatibility(effect);
    this.options.effect = effect;
  }
  get insertChain(): InsertChain | undefined {
    if (!this.ownsOutput) return undefined;
    this.ensureOutput();
    return this.inserts;
  }
  /** Explicit preparation of a source output; aggregate transports have no synthetic port. */
  get outputPort(): AudioOutputPort | undefined {
    if (!this.ownsOutput) return undefined;
    this.ensureOutput();
    return this.port;
  }
  peekOutputPort(): AudioOutputPort | undefined { return this.ownsOutput ? this.port : undefined; }
  /** Stable owned output tap; a borrowed group exposes only its own supported tap. */
  get analyser(): AnalyserNode | undefined {
    if (this.disposed) return undefined;
    if (this.ownsOutput) return this.ensureOutput();
    if (this.borrowed) return this.borrowed.analyser;
    return undefined;
  }

  setClip(clip: AudioClip | undefined): void {
    if (this.documentSource && clip !== undefined) throw new AudioDocumentApplicationError('source-conflict', 'Clip conflicts with document source');
    if (this.documentSource) { this.setDocumentSource(undefined); return; }
    if (this.disposed || (!this.borrowed && clip === this.selectedClip)) return;
    const revision = ++this.generation;
    if (clip && !this.followsSession) (this.borrowed ?? this.engine)?.pause();
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
    if (transport && !this.followsSession) (this.borrowed ?? this.engine)?.pause();
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
        if (this.configured.has('volume')) transport.setVolume?.(this.storedVolume);
        if (current() && this.configured.has('rate')) transport.setRate?.(this.storedRate);
        if (current() && this.configured.has('pan')) transport.setPan?.(this.storedPan);
        if (current() && this.configured.has('preservesPitch')) transport.setPreservesPitch?.(this.storedPreservesPitch);
        if (!current()) return;
        let borrowedPort = transport.peekOutputPort?.();
        own(transport.subscribe?.(() => {
          if (!current()) return;
          this.publishSource();
          if (current()) this.publishState();
          const port = transport.peekOutputPort?.();
          if (current() && port !== borrowedPort) {
            borrowedPort = port;
            this.notifyModuleListeners();
          }
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
    const scope = this.options.moduleContext;
    // A borrowed group plays in the scope's context, whose clock the Session reads.
    if (this.borrowed?.adoptAudioContext && scope) this.borrowed.adoptAudioContext(scope.audio.prepare() as AudioContext);
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
    // Only the owned document transport accepts clip loops; a queue's list loop is a different policy.
    if (this.borrowed && this.borrowed !== this.sequenceEngine) throw new Error('The selected audio transport does not support setLoop; configure its queue or mix directly');
    (this.borrowed ? this.sequenceEngine : this.engine)?.setLoop(accepted);
    this.storedLoop = accepted;
    this.configured.add('loop');
    this.documentAttachment.recordLoopIntent(accepted);
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
    this.documentTarget = undefined;
    try { this.documentAttachment.dispose(); } catch (error) { failure = error; }
    try { this.releaseSource(); } catch (error) { failure = error; }
    try { this.inserts?.dispose(); } catch (error) { failure ??= error; }
    this.inserts = undefined;
    try { this.port?.dispose(); } catch (error) { failure ??= error; }
    this.port = undefined;
    try { this.sourcePort.dispose(); } catch (error) { failure ??= error; }
    this.output = undefined;
    const context = this.context;
    this.context = undefined;
    if (context && !this.options.audioContext && !this.options.moduleContext) {
      try { void context.close().catch(() => {}); } catch (error) { failure ??= error; }
    }
    this.selectedClip = undefined;
    this.announcedClip = undefined;
    this.announcedTransport = undefined;
    this.lastPlaying = false;
    const hadReadiness = this.lastLoading || this.lastLoadError !== undefined;
    this.lastLoading = false;
    this.lastLoadError = undefined;
    // Commit terminal emptiness before notifying. One faulty subscriber must
    // not prevent other followers from releasing their borrowed source/tap.
    const observerFailed = (error: unknown, mode: 'throw' | 'rejection') => {
      if (mode === 'throw') failure ??= error;
    };
    this.emitter.emitSafely('sourcechange', {kind: 'empty', clip: undefined, revision: ++this.sourceRevision}, observerFailed);
    if (hadReadiness) this.emitter.emitSafely('loadstatechange', {loading: false, error: undefined}, observerFailed);
    this.emitter.emitSafely('statechange', {playing: false}, observerFailed);
    this.emitter.emitSafely('timeupdate', {seconds: 0, duration: 0, progress: 0}, observerFailed);
    this.emitter.removeAllListeners();
    this.moduleListeners.clear();
    if (failure !== undefined) throw failure;
  }

  private ensureOutput(): AnalyserNode | undefined {
    if (this.output) return this.output;
    if (this.preparingOutput) throw new Error('AudioPlayer output preparation cannot re-enter');
    this.preparingOutput = true;
    const generation = this.generation;
    const current = () => !this.disposed && generation === this.generation && this.ownsOutput;
    let output: AnalyserNode | undefined;
    let inserts: InsertChain | undefined;
    let port: AudioOutputPort | undefined;
    let committed = false;
    try {
      const context = this.audioContext;
      output = context.createAnalyser();
      output.fftSize = 2048;
      output.smoothingTimeConstant = 0.8;
      inserts = new InsertChain(context);
      inserts.setCompatibility(this.options.effect);
      if (!current()) return undefined;
      inserts.output.connect(output);
      port = new AudioOutputPort(output, {defaultDestination: this.options.moduleContext ? undefined : this.options.destination ?? context.destination});
      if (!current()) return undefined;
      this.output = output;
      this.inserts = inserts;
      this.port = port;
      committed = true;
    } finally {
      this.preparingOutput = false;
      if (!committed) {
        try { port?.dispose(); } catch { /* release all candidate resources */ }
        try { inserts?.dispose(); } catch { /* release all candidate resources */ }
        try { output?.disconnect(); } catch { /* release the candidate output */ }
      }
    }
    this.notifyModuleListeners(current);
    return current() ? output : undefined;
  }

  /** Module port lists changed: an output was prepared or a borrowed group published its own. */
  private notifyModuleListeners(current: () => boolean = () => !this.disposed): void {
    for (const listener of [...this.moduleListeners]) {
      if (!current()) break;
      if (!this.moduleListeners.has(listener)) continue;
      try { listener(); } catch (error) {
        this.emitter.emitSafely('error', error instanceof Error ? error : new Error(String(error)), () => {});
      }
    }
  }

  private ensureEngine(): AudioClipPlayer | undefined {
    if (this.engine || !this.selectedClip || this.disposed || this.borrowed) return this.engine;
    const generation = this.generation;
    this.ensureOutput();
    // Readiness observers can replace/dispose the source or prepare its engine
    // themselves. Keep that newer ownership instead of installing over it.
    if (this.disposed || generation !== this.generation || this.borrowed || !this.selectedClip) return undefined;
    if (this.engine) return this.engine;
    const destination = this.inserts!.input;
    const engine = new AudioClipPlayer(this.selectedClip, {
      ...this.options,
      effect: undefined,
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
    const scheduling = this.scheduling;
    this.scheduling = undefined;
    const sequence = this.borrowed === this.sequenceEngine ? this.sequenceEngine : undefined;
    if (sequence) this.sequenceEngine = undefined;
    this.releases = [];
    this.engine = undefined;
    this.borrowed = undefined;
    let failure: unknown;
    for (const release of releases) {
      try { release(); } catch (error) { failure ??= error; }
    }
    try { scheduling?.release(); } catch (error) { failure ??= error; }
    try { engine?.dispose(); } catch (error) { failure ??= error; }
    try { sequence?.dispose(); } catch (error) { failure ??= error; }
    if (failure !== undefined) throw failure;
  }

  /**
   * The output a tap follows: the owned chain, or a borrowed queue's or mix's
   * own stable output. A borrowed port is observed only; this player never
   * reroutes the group that owns it.
   */
  private currentOutputPort(): AudioOutputPort | undefined {
    if (this.disposed) return undefined;
    if (this.ownsOutput) return this.port;
    const borrowed = this.borrowed?.peekOutputPort?.();
    return borrowed && !borrowed.disposed ? borrowed : undefined;
  }

  /** Audio output (owned once prepared, or the borrowed group's), the clip source and a borrowed transport. */
  private modulePorts(): readonly ModulePort[] {
    const ports: ModulePort[] = [];
    const output = this.currentOutputPort();
    if (output) ports.push(output);
    if (!this.disposed) ports.push(this.sourcePort);
    const transport = this.options.moduleContext?.transport;
    if (transport) ports.push(transport);
    return Object.freeze(ports);
  }

  /** Mirror clip and load state into the source port; repeated equal states commit nothing. */
  private syncSourcePort(): void {
    if (this.disposed) return;
    const current = this.sourcePort.snapshot();
    const error = this.loadError;
    const clip = this.clip;
    if (error) { if (current.readiness !== 'error' || current.error !== error) this.sourcePort.fail(error); }
    else if (this.loading) { if (current.readiness !== 'loading') this.sourcePort.loading(); }
    else if (clip) { if (current.readiness !== 'ready' || current.value !== clip) this.sourcePort.ready(clip); }
    else if (current.readiness !== 'empty') this.sourcePort.clear();
  }

  private publishSource(): void {
    this.syncSourcePort();
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
    const loading = this.loading;
    const error = this.loadError;
    if (loading !== this.lastLoading || error !== this.lastLoadError) {
      this.lastLoading = loading;
      this.lastLoadError = error;
      this.syncSourcePort();
      this.emitter.emit('loadstatechange', {loading, error});
    }
    if (this.disposed || generation !== this.generation || revision !== this.observationRevision) return;
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
