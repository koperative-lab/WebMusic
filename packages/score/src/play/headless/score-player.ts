// ============================================================================
// ScorePlayer — the stable public API and audio-graph coordinator. Immutable
// score preparation lives in score-timeline.ts; mutable clock and lookahead
// scheduling state lives in score-player-scheduler.ts.
// ============================================================================

import type {TransportClockReader} from '@webmusic/kernel/transport';
import {
  EventEmitter,
  expandRepeats,
  type Score,
  type ScorePlaybackNote,
  type ScorePlaybackSource,
  type ScorePlaybackState,
  type TimePosition,
} from '../../core';
// Type-only import keeps file parsers out of the engine's static dependency
// graph; URL loading remains lazy.
import type {ScoreFormat as ImportedScoreFormat} from '../../io/load';
import {insertEffect, resolveEffect} from './effects';
import {emitPlaybackEvent, emitPlaybackOperationError} from './playback-events';
import type {
  HeadlessSynth,
  PreloadableHeadlessSynth,
  ScorePlayerEvents,
  ScorePlayerOptions,
  SynthOwnership,
} from './audio-contracts';
import {locateSecondsCompat, resolveAudioGraphContext} from './audio-utils';
import {OscillatorSynth} from './oscillator-synth';
import {ScorePlayerScheduler} from './score-player-scheduler';
import {PlaybackPublisher} from './playback-source';

export function createScorePlayer(score: Score, options: ScorePlayerOptions = {}): ScorePlayer {
  return new ScorePlayer(score, options);
}

/**
 * Create and start autonomous score playback in one code-only operation.
 *
 * The returned player remains under the caller's control and must eventually
 * be disposed. If startup fails before the player can be returned, its owned
 * audio resources are released automatically.
 */
export async function playScore(score: Score, options: ScorePlayerOptions = {}): Promise<ScorePlayer> {
  const player = new ScorePlayer(score, options);
  try {
    await player.play();
    return player;
  } catch (error) {
    player.dispose();
    throw error;
  }
}

/** Load a score file lazily, then create its autonomous player. */
export async function createScorePlayerFromUrl(
  url: string,
  options: ScorePlayerOptions & {format?: ImportedScoreFormat} = {},
): Promise<ScorePlayer> {
  const {loadScoreFromUrl} = await import('../../io/load');
  const {format, ...playerOptions} = options;
  const score = await loadScoreFromUrl(url, {format});
  return new ScorePlayer(score, playerOptions);
}

/** Load a score file lazily and start it in one code-only operation. */
export async function playScoreFromUrl(
  url: string,
  options: ScorePlayerOptions & {format?: ImportedScoreFormat} = {},
): Promise<ScorePlayer> {
  const player = await createScorePlayerFromUrl(url, options);
  try {
    await player.play();
    return player;
  } catch (error) {
    player.dispose();
    throw error;
  }
}

/**
 * Autonomous push-clock playback engine. It exposes transport state, owns the
 * lazily-created audio graph, and forwards timing work to an internal rolling
 * lookahead scheduler. Construction remains safe in Node and SSR environments.
 */
export class ScorePlayer {
  private readonly emitter = new EventEmitter<ScorePlayerEvents>();
  private readonly score: Score;
  private readonly options: ScorePlayerOptions;
  private readonly scheduler: ScorePlayerScheduler;
  private _context?: AudioContext;
  private output?: GainNode;
  private panner?: StereoPannerNode;
  private synth?: HeadlessSynth;
  private masterVolume = 1;
  private panValue = 0;
  private ownsContext = false;
  private synthOwnership: SynthOwnership = 'owned';
  private synthRouteCleanup?: () => void;
  private preloadPromise?: Promise<void>;
  private effectDispose?: () => void;
  private disposed = false;
  private graphBuildSerial = 0;
  private activeGraphBuild?: number;
  private playbackState: ScorePlaybackState = 'stopped';
  private readonly activeNotes = new Map<number, ScorePlaybackNote>();
  private readonly playbackPublisher = new PlaybackPublisher(
    () => {
      const nominalSeconds = this.scheduler.nominalSeconds;
      const rate = this.scheduler.rate;
      const duration = this.scheduler.duration;
      return {
      sourceRevision: 1,
      readiness: this.disposed ? 'disposed' : 'ready',
      state: this.scheduler.isPlaying ? 'playing' : this.playbackState === 'playing' ? 'paused' : this.playbackState,
      score: this.score,
      nominalSeconds,
      nominalDurationSeconds: duration * rate,
      transportSeconds: nominalSeconds / rate,
      transportDurationSeconds: duration,
      rate,
      activeNotes: Object.freeze(this.scheduler.isPlaying ? [...this.activeNotes.values()] : []),
      };
    },
    (seconds) => {
      if (this.disposed) return Promise.reject(new Error('ScorePlayer has been disposed.'));
      if (!Number.isFinite(seconds)) return Promise.reject(new RangeError('Seek position must be finite.'));
      const result = this.scheduler.seekNominal(seconds, undefined, true);
      void result.then(() => this.playbackPublisher.notify(), () => this.playbackPublisher.notify());
      return result;
    },
  );

  /** Borrow musical data, state and note occurrences without DOM or audio ownership. */
  get playback(): ScorePlaybackSource {
    return this.playbackPublisher;
  }

  constructor(score: Score, options: ScorePlayerOptions = {}) {
    this.score = options.expandRepeats ? expandRepeats(score) : score;
    this.options = options;
    this.scheduler = new ScorePlayerScheduler(
      this.score,
      {
        ensureAudio: () => {
          const {context, synth} = this.ensureAudio();
          return {context, synth};
        },
        prepareForPlayback: () => this.prepareForPlayback(),
        getContext: () => this._context,
        getSynth: () => this.synth,
        onCursor: ({nominalSeconds, seconds: transportSeconds, duration: transportDurationSeconds, progress}) => {
          const revision = this.scheduler.revision;
          this.playbackPublisher.notify();
          if (revision !== this.scheduler.revision) return;
          this.emit('cursor', locateSecondsCompat(this.score, nominalSeconds));
          // cursor observers may seek, change rate or dispose synchronously.
          // Never follow the newer notification with this stale snapshot.
          if (revision !== this.scheduler.revision) return;
          this.emit('timeupdate', {
            nominalSeconds,
            transportSeconds,
            transportDurationSeconds,
            progress,
            // Compatibility aliases retain the old direct ScorePlayer event
            // semantics: both are rate-scaled transport values.
            seconds: transportSeconds,
            duration: transportDurationSeconds,
          });
        },
        onNoteOn: (note, {id, entry}) => {
          this.activeNotes.set(id, Object.freeze({
            occurrenceId: String(id), noteId: note.id, partId: entry.partId,
            midi: entry.midi, nominalStartSeconds: entry.start, nominalEndSeconds: entry.end,
          }));
          this.playbackPublisher.notify();
          if (this.activeNotes.has(id)) this.emit('noteOn', note);
        },
        onNoteOff: (note, {id}) => {
          this.activeNotes.delete(id);
          this.playbackPublisher.notify();
          this.emit('noteOff', note);
        },
        onEnd: () => {
          this.playbackState = 'ended';
          this.activeNotes.clear();
          this.playbackPublisher.notify();
          this.emit('end', this.score);
        },
        onOperationError: (operation, error) => this.reportOperationError(operation, error),
      },
      {
        cursorIntervalMs: options.cursorIntervalMs ?? 50,
        lookaheadSeconds: Math.max(0.02, options.lookaheadSeconds ?? 0.1),
        schedulerIntervalMs: Math.max(5, options.schedulerIntervalMs ?? 25),
        createTickSource: options.createTickSource,
      },
    );
    if (options.tempo) this.scheduler.setTempo(options.tempo);
  }

  /** Lazily created Web Audio context. */
  get context(): AudioContext {
    return this.ensureAudio().context;
  }

  /** Master output volume (linear 0..1+). Applies live. */
  setVolume(volume: number): void {
    this.masterVolume = Math.max(0, volume);
    if (this.output) this.output.gain.value = this.masterVolume;
  }

  /** Stereo pan (-1 = left, 0 = centre, +1 = right). Applies live. */
  setPan(pan: number): void {
    this.panValue = Math.max(-1, Math.min(1, pan));
    if (this.panner) this.panner.pan.value = this.panValue;
  }

  /** Warm both the immutable scheduling snapshot and any synth samples. */
  async preload(): Promise<void> {
    const preparation = this.prepareForPlayback();
    if (preparation) await preparation;
  }

  /**
   * Prepare the immutable timeline synchronously and return a Promise only
   * when the active synth has actual asynchronous work to do. This lets the
   * scheduler preserve synchronous seek/resume behavior for oscillator-like
   * backends while still awaiting sampled/worklet-backed instruments.
   */
  private prepareForPlayback(): void | Promise<void> {
    const notes = this.scheduler.prepare();
    const {synth} = this.ensureAudio();
    const preload = (synth as PreloadableHeadlessSynth).preload;
    if (!preload) return;

    if (!this.preloadPromise) {
      const pending = Promise.resolve(preload.call(synth, notes)).then(() => undefined);
      this.preloadPromise = pending;
      void pending.catch(() => {
        // Leave a failed source retryable: callers may repair a transient
        // network/worklet condition before invoking play again.
        if (this.preloadPromise === pending) this.preloadPromise = undefined;
      });
    }
    return this.preloadPromise;
  }

  /**
   * Start playback. With `when` (an absolute AudioContext time in the
   * future), the transport arms a scheduled start: the clock holds at the
   * resume position (visible through {@link clock} as `holding`) and the
   * first attacks land exactly at `when` on the audio clock — the score-side
   * counterpart of the buffer engine's sample-accurate `play(when)`. A
   * `when` that has already passed starts immediately without skipping
   * material; omitting it preserves the classic immediate start.
   */
  play(when?: number): Promise<void> {
    if (!this.scheduler.isPlaying) this.playbackState = 'starting';
    const result = this.scheduler.play(when);
    this.playbackPublisher.notify();
    void result.then(() => {
      if (this.playbackState === 'starting') this.playbackState = this.scheduler.isPlaying ? 'playing' : 'paused';
      this.playbackPublisher.notify();
    }, () => {
      if (this.playbackState === 'starting') this.playbackState = 'paused';
      this.playbackPublisher.notify();
    });
    return result;
  }

  pause(): void {
    this.playbackState = 'paused';
    this.scheduler.pause();
    this.playbackPublisher.notify();
  }

  stop(): void {
    this.playbackState = 'stopped';
    this.scheduler.stop();
    this.playbackPublisher.notify();
  }

  /**
   * Seek in rate-scaled, real seconds; the promise settles once the transport
   * anchor is live again. With `when` (an absolute AudioContext time) a
   * mid-playback seek arms its restart at that instant instead of resuming
   * immediately — the re-anchor counterpart of {@link play}'s scheduled
   * start. Ignored while paused; an expired `when` resumes immediately.
   */
  seek(seconds: number, when?: number): Promise<void> {
    const result = this.scheduler.seek(seconds, when);
    void result.then(() => this.playbackPublisher.notify(), () => this.playbackPublisher.notify());
    return result;
  }

  seekFraction(fraction: number, when?: number): Promise<void> {
    return this.scheduler.seekFraction(fraction, when);
  }

  /**
   * Seek in nominal (unscaled) score seconds. Clamped to the score timeline;
   * the promise settles under the same contract as {@link seek}.
   */
  seekNominal(nominalSeconds: number, when?: number): Promise<void> {
    const result = this.scheduler.seekNominal(nominalSeconds, when);
    void result.then(() => this.playbackPublisher.notify(), () => this.playbackPublisher.notify());
    return result;
  }

  scrub(deltaSeconds: number): Promise<void> {
    return this.scheduler.scrub(deltaSeconds);
  }

  setTempo(bpm: number): void {
    this.scheduler.setTempo(bpm);
    this.playbackPublisher.notify();
  }

  setRate(rate: number): void {
    this.scheduler.setRate(rate);
    this.playbackPublisher.notify();
  }

  get rate(): number {
    return this.scheduler.rate;
  }

  /**
   * Read-only transport clock: position axis is nominal score seconds against
   * AudioContext time, `rate` is the tempo scale. Lets bridges and views
   * anchor against this player's clock without being able to re-anchor it.
   */
  get clock(): TransportClockReader {
    return this.scheduler.clock;
  }

  setLoop(startSeconds: number, endSeconds: number): void {
    this.scheduler.setLoop(startSeconds, endSeconds);
    this.playbackPublisher.notify();
  }

  clearLoop(): void {
    this.scheduler.clearLoop();
    this.playbackPublisher.notify();
  }

  on<TName extends keyof ScorePlayerEvents>(
    event: TName,
    callback: (payload: ScorePlayerEvents[TName]) => void,
  ): () => void {
    return this.emitter.on(event, callback);
  }

  private emit<TName extends keyof ScorePlayerEvents>(
    event: TName,
    payload: ScorePlayerEvents[TName],
  ): void {
    emitPlaybackEvent(this.emitter, 'ScorePlayer', event, payload);
  }

  isPlaying(): boolean {
    return this.scheduler.isPlaying;
  }

  /** Musical position at the current transport point. */
  get currentTime(): TimePosition {
    return locateSecondsCompat(this.score, this.scheduler.nominalSeconds);
  }

  /** Current rate-scaled wall-clock position. */
  get seconds(): number {
    return this.scheduler.seconds;
  }

  /** Position on the unscaled score timeline, in nominal score seconds. */
  get nominalSeconds(): number {
    return this.scheduler.nominalSeconds;
  }

  get durationSeconds(): number {
    return this.scheduler.duration;
  }

  get duration(): number {
    return this.scheduler.duration;
  }

  get progress(): number {
    return this.scheduler.progress;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.playbackState = 'stopped';
    this.scheduler.dispose();
    this.activeNotes.clear();
    this.playbackPublisher.notify();
    const synth = this.synth;
    const synthRouteCleanup = this.synthRouteCleanup;
    const output = this.output;
    const effectDispose = this.effectDispose;
    const context = this._context;
    const ownsContext = this.ownsContext;

    // Invalidate externally visible ownership before invoking backend code.
    // A reentrant dispose() or a noteOn() currently unwinding cannot reinstall
    // a voice into this player afterward.
    this.synthRouteCleanup = undefined;
    this.effectDispose = undefined;
    this.ownsContext = false;
    this._context = undefined;
    this.output = undefined;
    this.panner = undefined;
    this.synth = undefined;
    this.preloadPromise = undefined;

    if (synth) {
      if (this.synthOwnership === 'owned') {
        if (synth.dispose) this.tryCleanup('synth.dispose', () => synth.dispose!());
        else if (synth.disconnect) {
          this.tryCleanup('synth.disconnect', () => synth.disconnect!());
        }
      } else if (synthRouteCleanup) {
        // A no-argument disconnect() belongs to the caller: it could sever
        // every route of a shared synth. A backend can opt into precise cleanup
        // by returning a disposer from connect().
        this.tryCleanup('synth route cleanup', synthRouteCleanup);
      }
    }
    if (output) this.tryCleanup('output.disconnect', () => output.disconnect());
    if (effectDispose) this.tryCleanup('effect.dispose', effectDispose);
    if (ownsContext && context) {
      try {
        const closing = context.close?.();
        void (closing as Promise<void> | undefined)?.catch((error: unknown) => {
          this.reportOperationError('context.close', error);
        });
      } catch (error) {
        this.reportOperationError('context.close', error);
      }
    }
  }

  private tryCleanup(operation: string, callback: () => void): void {
    try {
      callback();
    } catch (error) {
      this.reportOperationError(operation, error);
    }
  }

  private ensureAudio(): {context: AudioContext; output: GainNode; synth: HeadlessSynth} {
    if (this.disposed) throw new Error('ScorePlayer has been disposed.');
    if (this._context && this.output && this.synth) {
      return {context: this._context, output: this.output, synth: this.synth};
    }
    const build = this.beginGraphBuild();
    const suppliedSynth = this.options.synth;
    const synthOwnership = suppliedSynth
      ? this.options.synthOwnership ?? 'borrowed'
      : 'owned';
    let context: AudioContext | undefined;
    let destination: AudioNode | undefined;
    let ownsContext = false;
    let output: GainNode | undefined;
    let panner: StereoPannerNode | undefined;
    let synth: HeadlessSynth | undefined;
    let synthRouteCleanup: (() => void) | undefined;
    let effectDispose: (() => void) | undefined;
    try {
      const resolved = resolveAudioGraphContext(
        this.options.audioContext,
        this.options.destination,
      );
      context = resolved.context;
      destination = resolved.destination;
      ownsContext = resolved.ownsContext;
      this.assertGraphBuildCurrent(build);

      output = context.createGain();
      output.gain.value = this.masterVolume;
      this.assertGraphBuildCurrent(build);
      panner = context.createStereoPanner();
      panner.pan.value = this.panValue;
      output.connect(panner);
      this.assertGraphBuildCurrent(build);
      const effect = resolveEffect(this.options.effect, this.options.reverb);
      effectDispose = insertEffect(context, panner, destination, effect).dispose;
      this.assertGraphBuildCurrent(build);
      synth = suppliedSynth ?? new OscillatorSynth(context);
      const route = synth.connect?.(output);
      synthRouteCleanup = typeof route === 'function' ? route : undefined;
      // Effect factories and injected synth.connect() are arbitrary extension
      // code. They may synchronously dispose this player; never resurrect a
      // graph after that terminal mutation.
      this.assertGraphBuildCurrent(build);

      // Publish ownership only after every node and route has committed and the
      // construction generation is still current.
      this.ownsContext = ownsContext;
      this.synthOwnership = synthOwnership;
      this.synthRouteCleanup = synthRouteCleanup;
      this.effectDispose = effectDispose;
      this._context = context;
      this.output = output;
      this.panner = panner;
      this.synth = synth;
      return {context, output, synth};
    } catch (error) {
      if (synthRouteCleanup) {
        this.tryCleanup('failed synth route cleanup', synthRouteCleanup);
      }
      // Ownership of an injected synth transfers only when the graph commits.
      // A default synth was created by this transaction and must be released.
      if (!suppliedSynth && synth) {
        if (synth.dispose) this.tryCleanup('failed synth.dispose', () => synth!.dispose!());
        else if (synth.disconnect) {
          this.tryCleanup('failed synth.disconnect', () => synth!.disconnect!());
        }
      }
      if (effectDispose) this.tryCleanup('failed effect.dispose', effectDispose);
      if (panner) this.tryCleanup('failed panner.disconnect', () => panner!.disconnect());
      if (output) this.tryCleanup('failed output.disconnect', () => output!.disconnect());
      if (ownsContext && context) this.closeContext(context, 'failed context.close');
      throw error;
    } finally {
      if (this.activeGraphBuild === build) this.activeGraphBuild = undefined;
    }
  }

  private beginGraphBuild(): number {
    if (this.activeGraphBuild !== undefined) {
      throw new Error('ScorePlayer audio graph construction cannot be re-entered.');
    }
    const build = ++this.graphBuildSerial;
    this.activeGraphBuild = build;
    return build;
  }

  private assertGraphBuildCurrent(build: number): void {
    if (this.disposed || this.activeGraphBuild !== build) {
      throw new Error('ScorePlayer was disposed during audio graph construction.');
    }
  }

  private closeContext(context: AudioContext, operation: string): void {
    try {
      const closing = context.close?.();
      void (closing as Promise<void> | undefined)?.catch((error: unknown) => {
        this.reportOperationError(operation, error);
      });
    } catch (error) {
      this.reportOperationError(operation, error);
    }
  }

  private reportOperationError(operation: string, error: unknown): void {
    emitPlaybackOperationError(
      this.emitter,
      'ScorePlayer',
      operation,
      error,
    );
  }
}
