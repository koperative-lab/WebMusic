// ============================================================================
// AudioClipPlayer — the transport for a single AudioClip. The control surface
// is deliberately name-for-name identical to WebScore's ScorePlayer (play/pause/
// stop/seek/setRate/on…), so both packages expose the same implicit `PlayerLike`
// interface — the basis for cross-project mixing (§10.3). The audio graph mirrors
// ScorePlayer's:  source → gain → panner → effect → analyser → destination.
//
// The AudioContext is created lazily (first play) and resumed inside play(), so
// constructing a player is SSR-safe: it touches no audio globals.
// ============================================================================

import {EventEmitter, type AudioClip, type Region} from '../../core';
import {insertEffect, type Effect} from '../core/effect';
import {BufferEngine, normalizeLoopOption, type PlaybackEngine} from './engines/buffer-engine';
import {MediaEngine, type MediaPlaybackAdapterFactory} from './engines/media-engine';
import {ScratchEngine} from './engines/scratch-engine';
import {createWebAudioContext} from '@webmusic/kernel/audio-context';
import type {TransportClockReader} from '@webmusic/kernel/transport';

export type PlayerEngineKind = 'auto' | 'buffer' | 'media';

export interface AudioClipPlayerOptions {
  audioContext?: AudioContext;
  destination?: AudioNode;
  effect?: Effect;
  /** auto: decoded & ≤10min → buffer, else media. */
  engine?: PlayerEngineKind;
  /** Host bridge used by the streaming media engine. */
  mediaAdapterFactory?: MediaPlaybackAdapterFactory;
  preservesPitch?: boolean;
  loop?: boolean | {start: number; end: number};
  /** Cursor/timeupdate poll interval (ms). Default 50. */
  cursorIntervalMs?: number;
  volume?: number;
  pan?: number;
  rate?: number;
}

/** Exclusive, gesture-local audible scrubbing of decoded PCM. */
export interface AudioScratchSession {
  readonly active: boolean;
  /** Seek on the clip seconds axis. False commits position without sound. */
  moveToSeconds(seconds: number, audible?: boolean): void;
  /** Coast toward the prior playback state; false cancels immediately. */
  end(resume?: boolean): Promise<void>;
}

interface ScratchCoast {
  startedAt: number;
  position: number;
  fromRate: number;
  targetRate: number;
  timer: ReturnType<typeof setInterval> | null;
  promise: Promise<void>;
  resolve: () => void;
  reject: (error: unknown) => void;
}

const SCRATCH_COAST_SECONDS = 0.28;

interface ScratchState {
  session: AudioScratchSession;
  wasPlaying: boolean;
  renderer: ScratchEngine | null;
  ready: boolean;
  moved: boolean;
  coast: ScratchCoast | null;
}

export interface PlayerTimeUpdate {
  seconds: number;
  duration: number;
  progress: number;
}

export interface AudioClipPlayerEvents {
  timeupdate: PlayerTimeUpdate;
  end: AudioClip;
  regionenter: Region;
  regionleave: Region;
  beat: {index: number; seconds: number};
  load: {duration: number};
  error: Error;
}

/** Threshold for `engine: 'auto'`: clips longer than this prefer the media engine. */
const AUTO_BUFFER_MAX_SECONDS = 10 * 60;

export class AudioClipPlayer {
  /** Immutable input borrowed by playback followers; replacement requires a new player. */
  readonly clip: AudioClip;
  private readonly options: AudioClipPlayerOptions;
  private readonly emitter = new EventEmitter<AudioClipPlayerEvents>();

  private context: AudioContext | null = null;
  private engine: PlaybackEngine | null = null;
  private gainNode: GainNode | null = null;
  private pannerNode: StereoPannerNode | null = null;
  private analyserNode: AnalyserNode | null = null;
  private effectDispose: (() => void) | null = null;

  private volume: number;
  private pan: number;
  private rate: number;
  // Mutable like volume/pan/rate, because both can now change on a live
  // player; the engine is built lazily and reads these at construction.
  private loop: boolean | {start: number; end: number};
  private preservesPitch: boolean | undefined;
  private cursorTimer: ReturnType<typeof setInterval> | null = null;
  private readonly activeRegions = new Set<string>();
  private lastBeatIndex = -1;
  private disposed = false;
  /** Invalidates work that resumes after an asynchronous playback boundary. */
  private lifecycleGeneration = 0;
  /** Invalidates an observation batch when a listener issues a newer command. */
  private observationRevision = 0;
  private loadEmitted = false;
  private scratch: ScratchState | null = null;
  private readonly scratchReleases = new Set<ScratchEngine>();
  private scratchHandoffGain: AudioParam | null = null;

  constructor(clip: AudioClip, options: AudioClipPlayerOptions = {}) {
    this.clip = clip;
    this.options = options;
    this.volume = options.volume ?? 1;
    this.pan = options.pan ?? 0;
    this.rate = options.rate ?? 1;
    this.loop = normalizeLoopOption(options.loop ?? false);
    this.preservesPitch = options.preservesPitch;
  }

  // --- transport ---

  /**
   * Start playback. `when` is an absolute `AudioContext.currentTime` at which
   * sound should begin (sample-accurate on the buffer engine; the media
   * engine starts as soon as it can). Omitted or already past starts now.
   */
  play(when?: number): Promise<void> {
    this.cancelScratch();
    return this.startPlayback(when);
  }

  private async startPlayback(when?: number, scratchHandoff = false): Promise<void> {
    if (this.disposed) return;
    const generation = ++this.lifecycleGeneration;
    this.observationRevision++;
    try {
      const context = this.ensureContext();
      if (context.state === 'suspended') await context.resume();
      if (!this.isCurrentGeneration(generation)) return;
      this.ensureGraph();
      // Graph readiness invokes user load listeners synchronously. Their stop,
      // pause or replacement play intent must win before any source starts.
      if (!this.isCurrentGeneration(generation)) return;
      const engine = this.engine;
      if (scratchHandoff && engine) {
        // Both owned concrete engines expose a private output GainNode. Fade
        // that route, not the shared user volume/effect path used by scratch.
        const gain = (engine.output as GainNode).gain;
        const now = context.currentTime;
        this.scratchHandoffGain = gain;
        gain.cancelScheduledValues(now);
        gain.setValueAtTime(0, now);
        gain.linearRampToValueAtTime(1, now + 0.005);
      }
      await engine?.play(undefined, when);
      if (!this.isCurrentGeneration(generation) || this.engine !== engine) return;
      this.startCursor();
    } catch (error) {
      const normalized = error instanceof Error ? error : new Error(String(error));
      if (this.isCurrentGeneration(generation)) {
        this.resetScratchHandoff();
        try {
          this.emitter.emit('error', normalized);
        } catch {
          // A faulty error listener must not replace the playback failure.
        }
      }
      throw normalized;
    }
  }

  pause(): void {
    if (this.disposed) return;
    this.cancelScratch();
    this.lifecycleGeneration++;
    this.observationRevision++;
    try {
      this.engine?.pause();
    } finally {
      this.stopCursor();
    }
  }

  stop(): void {
    if (this.disposed) return;
    this.cancelScratch();
    this.lifecycleGeneration++;
    this.observationRevision++;
    try {
      this.engine?.stop();
    } finally {
      this.stopCursor();
      this.activeRegions.clear();
      this.lastBeatIndex = -1;
      this.emitTimeupdate();
    }
  }

  seek(seconds: number): void {
    if (this.disposed) return;
    this.cancelScratch();
    const revision = ++this.observationRevision;
    this.ensureGraph();
    if (!this.isCurrentObservation(revision)) return;
    this.engine?.seek(seconds);
    if (!this.isCurrentObservation(revision)) return;
    // The engine may clamp or wrap the requested position. Annotations always
    // describe the actual playhead, including a seek while paused.
    this.refreshRegions(this.seconds, revision);
    if (this.isCurrentObservation(revision)) this.emitTimeupdate();
  }

  seekFraction(fraction: number): void {
    this.seek(Math.max(0, Math.min(1, fraction)) * this.duration);
  }

  /**
   * Pause normal playback and borrow the existing output route for continuous
   * bounded PCM windows. Streaming-only clips return undefined without creating a context.
   * External play/pause/stop/seek and disposal invalidate the returned owner.
   */
  beginScratch(): AudioScratchSession | undefined {
    if (this.disposed || !this.clip.hasSamples || this.clip.duration <= 0) return undefined;
    const wasPlaying = this.scratch?.wasPlaying ?? this.playing;
    this.cancelScratch();
    const generation = ++this.lifecycleGeneration;
    this.observationRevision++;
    const isActive = () => this.scratch === state && !this.disposed;
    const state: ScratchState = {
      wasPlaying,
      renderer: null,
      ready: false,
      moved: false,
      coast: null,
      session: {
        get active() { return isActive(); },
        moveToSeconds: (seconds, audible = true) => this.moveScratch(state, seconds, audible),
        end: (resume = true) => this.endScratch(state, resume),
      },
    };
    this.scratch = state;
    try {
      this.engine?.pause();
      this.stopCursor();
      const context = this.ensureContext();
      if (context.state === 'closed') throw new Error('AudioContext is closed');
      if (context.state === 'suspended') {
        // Call resume synchronously while the host still has user activation.
        // A late completion never starts a grain or restores old play intent.
        void context.resume().then(() => {
          if (this.scratch === state && this.isCurrentGeneration(generation)) state.ready = true;
        }, (error: unknown) => {
          if (this.scratch !== state || !this.isCurrentGeneration(generation)) return;
          this.cancelScratch();
          try { this.emitTimeupdate(); } catch { /* preserve the audio error */ }
          try {
            this.emitter.emit('error', error instanceof Error ? error : new Error(String(error)));
          } catch { /* contain asynchronous observer failures */ }
        });
      } else state.ready = true;
      this.ensureGraph();
      if (this.scratch !== state || !this.isCurrentGeneration(generation)) return state.session;
      state.renderer = new ScratchEngine(context, this.clip, this.gainNode!, this.seconds);
      this.emitTimeupdate();
      return state.session;
    } catch (error) {
      if (this.scratch === state) this.cancelScratch();
      throw error;
    }
  }

  scrub(deltaSeconds: number): void {
    this.seek(this.seconds + deltaSeconds);
  }

  setRate(rate: number): void {
    if (this.disposed) return;
    this.observationRevision++;
    this.rate = Math.max(0.25, Math.min(4, rate));
    this.engine?.setRate(this.rate);
    this.finishCoastForConfiguration();
  }

  setVolume(volume: number): void {
    this.volume = Math.max(0, volume);
    if (this.gainNode) this.gainNode.gain.value = this.volume;
  }

  setPan(pan: number): void {
    this.pan = Math.max(-1, Math.min(1, pan));
    if (this.pannerNode) this.pannerNode.pan.value = this.pan;
  }

  /**
   * Turn looping on or off while the clip is playing. Both engines relocate
   * their own position across the change (the buffer engine re-anchors its
   * clock, the media engine swaps the native flag for a range watcher), so
   * this replaces the only alternative a host had — building a new player,
   * which lost the playhead.
   */
  setLoop(loop: boolean | {start: number; end: number}): void {
    if (this.disposed) return;
    // Record it for an engine that does not exist yet: the graph is built on
    // first play and reads the stored value at construction.
    const normalized = normalizeLoopOption(loop);
    // A rejected engine update must not replace the facade's accepted option.
    this.engine?.setLoop(normalized);
    this.loop = normalized;
    this.observationRevision++;
    this.finishCoastForConfiguration();
  }

  /**
   * Change pitch preservation. Live on the media engine; a documented no-op on
   * the buffer engine, whose `playbackRate` transposes by construction — it
   * has no time-stretcher, and this package ships none.
   */
  setPreservesPitch(preservesPitch: boolean): void {
    if (this.disposed) return;
    this.preservesPitch = preservesPitch;
    const engine = this.engine as {setPreservesPitch?: (value: boolean) => void} | null;
    engine?.setPreservesPitch?.(preservesPitch);
  }

  /**
   * Warm everything the first `play()` would otherwise build: the context, the
   * graph, and — through the engine's own `prepare` — the decoded buffer or
   * the media element. Building the graph alone left the whole-buffer copy to
   * land at start, which is exactly the hitch a queue's prefetch exists to
   * avoid.
   */
  async preload(): Promise<void> {
    if (this.disposed) return;
    this.ensureContext();
    this.ensureGraph();
    // Await only a genuinely asynchronous warm-up. Both built-in engines
    // prepare synchronously, and an unconditional `await` would add a
    // microtask to every aligned start (the mixer schedules its shared `when`
    // right after preloading every member).
    const warming = this.engine?.prepare?.();
    if (warming) await warming;
  }

  dispose(): void {
    if (!this.disposed) {
      this.disposed = true;
      this.lifecycleGeneration++;
      this.observationRevision++;
    }
    // Deliberately run cleanup on repeated calls as well. Public methods guard
    // against resurrection, and idempotent cleanup makes the terminal state
    // robust even if a custom engine/effect completes unusually late.
    let firstError: unknown;
    this.cancelScratch();
    this.stopCursor();
    try {
      this.effectDispose?.();
    } catch (error) {
      firstError = error;
    }
    this.effectDispose = null;
    try {
      this.engine?.dispose();
    } catch (error) {
      firstError ??= error;
    }
    this.engine = null;
    disconnectNode(this.gainNode);
    disconnectNode(this.pannerNode);
    disconnectNode(this.analyserNode);
    this.gainNode = null;
    this.pannerNode = null;
    this.analyserNode = null;
    this.emitter.removeAllListeners();
    // Close a context only if we created it.
    if (this.context && !this.options.audioContext) {
      try {
        void this.context.close().catch(() => {});
      } catch (error) {
        firstError ??= error;
      }
    }
    this.context = null;
    if (firstError !== undefined) throw firstError;
  }

  // --- getters ---

  get seconds(): number {
    return this.engine?.currentTime ?? 0;
  }

  get duration(): number {
    return this.engine?.duration ?? this.clip.duration;
  }

  get progress(): number {
    const d = this.duration;
    return d > 0 ? this.seconds / d : 0;
  }

  /** Whether an exclusive scratch gesture currently owns audible playback. */
  get scratching(): boolean {
    return this.scratch !== null;
  }

  get playing(): boolean {
    return this.engine?.playing ?? false;
  }

  /**
   * Read-only view of the active engine's transport clock, when it owns one
   * (the buffer engine does; the media engine has none). Lets sync bridges
   * and views anchor against the clip's position axis without being able to
   * re-anchor it — the audio-side mirror of ScorePlayer's `clock`.
   * `undefined` until the engine exists (built on first play) and on
   * clock-less engines. NOTE: under loop the clock reads the UNWRAPPED
   * position; only `seconds` applies the loop-window modulo.
   */
  get clock(): TransportClockReader | undefined {
    return this.engine?.clock;
  }

  get analyser(): AnalyserNode {
    if (this.disposed) throw new Error('AudioClipPlayer has been disposed');
    this.ensureContext();
    this.ensureGraph();
    return this.analyserNode as AnalyserNode;
  }

  // --- events ---

  on<K extends keyof AudioClipPlayerEvents>(event: K, listener: (data: AudioClipPlayerEvents[K]) => void): () => void {
    return this.emitter.on(event, listener);
  }
  once<K extends keyof AudioClipPlayerEvents>(event: K, listener: (data: AudioClipPlayerEvents[K]) => void): () => void {
    return this.emitter.once(event, listener);
  }
  off<K extends keyof AudioClipPlayerEvents>(event: K, listener: (data: AudioClipPlayerEvents[K]) => void): void {
    this.emitter.off(event, listener);
  }

  // --- internals ---

  private resetScratchHandoff(): void {
    const gain = this.scratchHandoffGain;
    this.scratchHandoffGain = null;
    if (!gain) return;
    const now = this.context?.currentTime ?? 0;
    try { gain.cancelScheduledValues(now); } catch { /* continue terminal cleanup */ }
    try { gain.setValueAtTime(1, now); } catch {
      try { gain.value = 1; } catch { /* context or route already released */ }
    }
  }

  private cancelScratch(release = false): void {
    this.resetScratchHandoff();
    if (!release) {
      for (const renderer of this.scratchReleases) renderer.dispose();
      this.scratchReleases.clear();
    }
    const state = this.scratch;
    if (!state) return;
    this.scratch = null;
    this.stopScratchCoast(state)?.resolve();
    const renderer = state.renderer;
    state.renderer = null;
    if (!renderer) return;
    if (release) {
      this.scratchReleases.add(renderer);
      renderer.release(() => this.scratchReleases.delete(renderer));
    } else renderer.dispose();
  }

  private moveScratch(state: ScratchState, seconds: number, audible: boolean): void {
    if (this.scratch !== state || this.disposed) return;
    if (!Number.isFinite(seconds)) throw new RangeError('Scratch position must be finite');
    this.stopScratchCoast(state)?.resolve();
    const revision = ++this.observationRevision;
    this.engine?.seek(seconds);
    if (this.scratch !== state || !this.isCurrentObservation(revision)) return;
    try {
      state.renderer?.move(seconds, this.seconds, audible && state.ready, normalizeLoopOption(this.loop, this.clip.duration));
      if (!audible) state.moved = false;
      else if (state.ready && Math.abs(state.renderer?.velocity ?? 0) > 0.001) state.moved = true;
    } catch (error) {
      if (this.scratch === state) {
        this.cancelScratch();
        try { this.emitTimeupdate(); } catch { /* preserve the rendering failure */ }
      }
      throw error;
    }
    this.refreshRegions(this.seconds, revision);
    if (this.scratch === state && this.isCurrentObservation(revision)) this.emitTimeupdate();
  }

  private async endScratch(state: ScratchState, resume: boolean): Promise<void> {
    if (this.scratch !== state || this.disposed) return;
    if (!resume) return this.finishScratch(state, false);
    if (state.coast) return state.coast.promise;
    const fromRate = state.renderer?.velocity ?? 0;
    if (!state.moved || !state.ready || this.context?.state !== 'running' ||
        Math.abs(fromRate) < 0.001) return this.finishScratch(state, true);
    let resolve!: () => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<void>((done, fail) => { resolve = done; reject = fail; });
    const coast: ScratchCoast = {
      startedAt: this.context.currentTime,
      position: this.seconds,
      fromRate,
      targetRate: state.wasPlaying ? this.rate : 0,
      timer: null, promise, resolve, reject,
    };
    state.coast = coast;
    coast.timer = setInterval(() => this.tickScratchCoast(state, coast), 16);
    this.tickScratchCoast(state, coast);
    return promise;
  }

  private stopScratchCoast(state: ScratchState): ScratchCoast | null {
    const coast = state.coast;
    if (!coast) return null;
    state.coast = null;
    if (coast.timer !== null) clearInterval(coast.timer);
    coast.timer = null;
    return coast;
  }

  private tickScratchCoast(state: ScratchState, coast: ScratchCoast): void {
    if (this.scratch !== state || state.coast !== coast || this.disposed) return;
    // Suspending an audio context must not leave a completion promise, timer or
    // audible owner pending indefinitely. New user activation may begin again.
    if (this.context?.state !== 'running') {
      this.cancelScratch();
      try { this.emitTimeupdate(); } catch { /* cancellation is already committed */ }
      return;
    }
    const elapsed = Math.max(0, Math.min(SCRATCH_COAST_SECONDS, this.context.currentTime - coast.startedAt));
    const acceleration = (coast.targetRate - coast.fromRate) / SCRATCH_COAST_SECONDS;
    const position = coast.position + coast.fromRate * elapsed + acceleration * elapsed * elapsed / 2;
    const velocity = coast.fromRate + acceleration * elapsed;
    const revision = ++this.observationRevision;
    try {
      this.engine?.seek(position);
      if (this.scratch !== state || state.coast !== coast || !this.isCurrentObservation(revision)) return;
      state.renderer?.drive(this.seconds, velocity, normalizeLoopOption(this.loop, this.clip.duration));
      this.refreshRegions(this.seconds, revision);
      if (this.scratch !== state || state.coast !== coast || !this.isCurrentObservation(revision)) return;
      this.emitTimeupdate();
      if (this.scratch !== state || state.coast !== coast || !this.isCurrentObservation(revision)) return;
      if (elapsed >= SCRATCH_COAST_SECONDS) {
        this.stopScratchCoast(state);
        void this.finishScratch(state, true).then(coast.resolve, coast.reject);
      }
    } catch (error) {
      if (this.scratch === state && state.coast === coast) {
        this.stopScratchCoast(state);
        this.cancelScratch();
        try { this.emitTimeupdate(); } catch { /* preserve the coast failure */ }
        coast.reject(error);
      }
    }
  }

  private finishCoastForConfiguration(): void {
    const state = this.scratch;
    if (!state?.coast) return;
    const coast = this.stopScratchCoast(state)!;
    void this.finishScratch(state, true).then(coast.resolve, coast.reject);
  }

  private async finishScratch(state: ScratchState, resume: boolean): Promise<void> {
    if (this.scratch !== state || this.disposed) return;
    const coast = this.stopScratchCoast(state);
    this.cancelScratch(resume);
    const generation = ++this.lifecycleGeneration;
    const revision = ++this.observationRevision;
    // A canceled coast settles without restoring playback, including re-grab.
    coast?.resolve();
    this.emitTimeupdate();
    if (!resume || !state.wasPlaying || !this.isCurrentGeneration(generation) || !this.isCurrentObservation(revision) || this.scratch) return;
    const resumed = this.startPlayback(undefined, true);
    await resumed;
    if (this.isCurrentGeneration(generation + 1) && !this.scratch) this.emitTimeupdate();
  }

  private ensureContext(): AudioContext {
    if (this.disposed) throw new Error('AudioClipPlayer has been disposed');
    if (this.context) return this.context;
    if (this.options.audioContext) {
      this.context = this.options.audioContext;
      return this.context;
    }
    this.context = createWebAudioContext('AudioContext is not available in this environment');
    return this.context;
  }

  private chooseEngineKind(): Exclude<PlayerEngineKind, 'auto'> {
    const requested = this.options.engine ?? 'auto';
    if (requested === 'buffer') return 'buffer';
    if (requested === 'media') return 'media';
    // auto: decoded short clips → buffer; streaming or very long → media.
    if (this.clip.hasSamples && this.clip.duration <= AUTO_BUFFER_MAX_SECONDS) return 'buffer';
    if (this.clip.sourceUrl) return 'media';
    return 'buffer';
  }

  private ensureGraph(): void {
    if (this.disposed) throw new Error('AudioClipPlayer has been disposed');
    if (this.engine) return;
    const context = this.ensureContext();

    let gain: GainNode | null = null;
    let panner: StereoPannerNode | null = null;
    let analyser: AnalyserNode | null = null;
    let engine: PlaybackEngine | null = null;
    let effectDispose: (() => void) | null = null;
    try {
      gain = context.createGain();
      gain.gain.value = this.volume;
      panner = context.createStereoPanner();
      panner.pan.value = this.pan;
      analyser = context.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.8;

      const kind = this.chooseEngineKind();
      engine =
        kind === 'media'
          ? new MediaEngine(context, this.clip, {
              loop: this.loop,
              rate: this.rate,
              preservesPitch: this.preservesPitch,
              adapterFactory: this.options.mediaAdapterFactory,
            })
          : new BufferEngine(context, this.clip, {
            loop: this.loop,
            rate: this.rate,
            preservesPitch: this.preservesPitch,
          });

      // source(engine.output) → gain → panner → [effect] → analyser → destination
      engine.output.connect(gain);
      gain.connect(panner);
      const inserted = insertEffect(context, panner, analyser, this.options.effect);
      effectDispose = inserted.dispose ?? null;
      analyser.connect(this.options.destination ?? context.destination);

      const installedEngine = engine;
      engine.onEnded(() => {
        if (this.disposed || this.engine !== installedEngine) return;
        this.lifecycleGeneration++;
        this.observationRevision++;
        this.stopCursor();
        this.emitter.emit('end', this.clip);
      });

      this.engine = engine;
      this.gainNode = gain;
      this.pannerNode = panner;
      this.analyserNode = analyser;
      this.effectDispose = effectDispose;
    } catch (error) {
      // Preserve the graph-construction failure while releasing every
      // candidate resource. A disposer may itself fail; it must not prevent
      // the other graph nodes from being disconnected.
      try {
        effectDispose?.();
      } catch {
        /* continue releasing the candidate graph */
      }
      try {
        engine?.dispose();
      } catch {
        /* continue releasing the candidate graph */
      }
      disconnectNode(gain);
      disconnectNode(panner);
      disconnectNode(analyser);
      throw error;
    }

    if (!this.loadEmitted) {
      this.loadEmitted = true;
      this.emitter.emit('load', {duration: this.duration});
    }
  }

  private startCursor(): void {
    if (this.disposed) return;
    if (this.cursorTimer != null) return;
    this.cursorTimer = setInterval(() => this.tick(), this.options.cursorIntervalMs ?? 50);
  }

  private stopCursor(): void {
    if (this.cursorTimer != null) {
      clearInterval(this.cursorTimer);
      this.cursorTimer = null;
    }
  }

  private tick(): void {
    const revision = this.observationRevision;
    const seconds = this.seconds;
    this.emitTimeupdate();
    if (!this.isCurrentObservation(revision)) return;
    this.refreshRegions(seconds, revision);
    if (this.isCurrentObservation(revision)) this.emitBeats(seconds);
  }

  private emitTimeupdate(): void {
    const duration = this.duration;
    const seconds = this.seconds;
    this.emitter.emit('timeupdate', {seconds, duration, progress: duration > 0 ? seconds / duration : 0});
  }

  /** Diff the regions containing `seconds` against the last set; emit enter/leave. */
  private refreshRegions(seconds: number, revision: number): void {
    const inside = new Set<string>();
    const entered: Region[] = [];
    const left: Region[] = [];
    for (const region of this.clip.regions) {
      const start = region.startSeconds;
      const end = region.endSeconds ?? start;
      if (seconds >= start && seconds <= end) {
        inside.add(region.id);
        if (!this.activeRegions.has(region.id)) entered.push(region);
      } else if (this.activeRegions.has(region.id)) {
        left.push(region);
      }
    }
    // Commit before notifying: a listener may seek into this same region.
    // Committing after callbacks would recursively re-enter it and overwrite
    // the newer command's region set when this batch finally returned.
    this.activeRegions.clear();
    for (const id of inside) this.activeRegions.add(id);
    for (const region of entered) {
      if (!this.isCurrentObservation(revision)) return;
      this.emitter.emit('regionenter', region);
    }
    for (const region of left) {
      if (!this.isCurrentObservation(revision)) return;
      this.emitter.emit('regionleave', region);
    }
  }

  /** Emit a `beat` event whenever the playhead crosses a new beat boundary. */
  private emitBeats(seconds: number): void {
    const grid = this.clip.beatGrid;
    if (!grid) return;
    const index = Math.floor(grid.secondsToBeat(seconds));
    if (index !== this.lastBeatIndex && index >= 0) {
      this.lastBeatIndex = index;
      this.emitter.emit('beat', {index, seconds: grid.beatToSeconds(index)});
    }
  }

  private isCurrentObservation(revision: number): boolean {
    return !this.disposed && revision === this.observationRevision;
  }

  private isCurrentGeneration(generation: number): boolean {
    return !this.disposed && generation === this.lifecycleGeneration;
  }
}

/** Build an {@link AudioClipPlayer} (the `createX` convention). */
export function createAudioClipPlayer(clip: AudioClip, options?: AudioClipPlayerOptions): AudioClipPlayer {
  return new AudioClipPlayer(clip, options);
}

function disconnectNode(node: AudioNode | null): void {
  try {
    node?.disconnect();
  } catch {
    /* already disconnected or only partially connected */
  }
}

// Re-export seam: the playback control contract lives in the shared kernel and
// is resolved at runtime from the @webmusic/kernel peer (externalized; one
// shared instance).
export type {PlayerLike} from '@webmusic/kernel/player';
