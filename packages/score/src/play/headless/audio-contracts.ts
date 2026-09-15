import type {TickSource} from '@webmusic/kernel/tick';
import type {Note, Score, TimePosition} from '../../core';
import type {Effect} from './effects';
import type {PlaybackListenerError, PlaybackOperationError} from './playback-events';

/** Releases exactly the audio route created by one `connect()` call. */
export type SynthRouteCleanup = () => void;

export interface HeadlessSynth {
  /**
   * Attach this synth to one destination. A borrowed synth may return a route
   * cleanup callback; players invoke only that callback on disposal, rather
   * than calling its global `disconnect()` and disrupting other caller-owned
   * routes.
   */
  connect?(destination: AudioNode): void | SynthRouteCleanup;
  disconnect?(): void;
  noteOn(midi: number, velocity: number, time: number, durationSeconds: number): unknown;
  noteOff?(midi: number, time: number): void;
  noteOffById?(handle: unknown, time: number): void;
  /**
   * Opt in to AudioContext-clock lookahead. A synth which sets this to `true`
   * must return one unique, non-null handle from every `noteOn()` call and
   * implement both `noteOffById()` and `cancelScheduledNote()`. The latter
   * must guarantee that a voice whose scheduled onset is after `time` will
   * never become audible.
   *
   * The player deliberately leaves this opt-in: timer/MIDI-style backends that
   * cannot retract an already queued attack keep just-in-time dispatch, so a
   * pause, seek, loop edit, or rate edit cannot leak a stale future note.
   */
  supportsScheduledCancellation?: boolean;
  cancelScheduledNote?(handle: unknown, time: number): void;
  /**
   * Retarget the hard source end for an already-started exact voice. `time`
   * is the logical AudioContext note-off time; a backend which has a release
   * tail remains responsible for placing its physical source stop after it.
   * This lets live playback-rate changes lengthen as well as shorten a note.
   */
  retimeScheduledNote?(handle: unknown, time: number): void;
  dispose?(): void;
}

/** Ownership of a synth supplied to a player or an interactive voice. */
export type SynthOwnership = 'borrowed' | 'owned';

/** Optional readiness capability implemented by Sound-like backends. */
export interface PreloadableHeadlessSynth extends HeadlessSynth {
  /** Playback projects sounding pitches (including part transposition), retaining note ids and other data. */
  preload?(notes?: ReadonlyArray<Note>): Promise<void>;
}

/**
 * A cursor update from {@link ScorePlayer}. Score and transport time remain
 * deliberately distinct: changing the playback rate preserves the former
 * musical point while rescaling the latter wall-clock coordinate.
 */
export interface PlayerTimeUpdate {
  /** Position on the unscaled score timeline, in nominal score seconds. */
  nominalSeconds: number;
  /** Position on the rate-scaled playback transport, in real seconds. */
  transportSeconds: number;
  /** Total rate-scaled playback duration, in real seconds. */
  transportDurationSeconds: number;
  /** `transportSeconds / transportDurationSeconds`, clamped to `[0, 1]`. */
  progress: number;
  /**
   * @deprecated Use `transportSeconds`. This preserves the historic direct
   * `ScorePlayer` event field and is always in the transport domain.
   */
  seconds: number;
  /** @deprecated Use `transportDurationSeconds`. */
  duration: number;
}

export interface ScorePlayerEvents {
  cursor: TimePosition;
  noteOn: Note;
  noteOff: Note;
  end: Score;
  timeupdate: PlayerTimeUpdate;
  /** A contained synth, graph, or lifecycle operation failure. */
  operationError: PlaybackOperationError;
  /** A subscriber fault, separate from operational playback failures. */
  listenerError: PlaybackListenerError;
}

export interface ReverbOptions {
  seconds?: number;
  decay?: number;
  wet?: number;
  dry?: number;
}

export interface ScorePlayerOptions {
  /** Borrow this context. When destination is also supplied, both identities must match. */
  audioContext?: AudioContext;
  /** Borrow this route target; without audioContext, its destination.context is the graph context. */
  destination?: AudioNode;
  /**
   * Synth used by this player. It is borrowed by default: disposal invokes
   * only the route cleanup returned by `connect()`, never its global
   * `disconnect()` or `dispose()`. Pass `synthOwnership: 'owned'` to transfer
   * full teardown responsibility to the player.
   */
  synth?: HeadlessSynth;
  synthOwnership?: SynthOwnership;
  tempo?: number;
  reverb?: false | ReverbOptions;
  effect?: Effect;
  cursorIntervalMs?: number;
  lookaheadSeconds?: number;
  schedulerIntervalMs?: number;
  /**
   * Injectable scheduler tick source factory (tests; custom hosting). Called
   * once per player with the effective `schedulerIntervalMs`; the player owns
   * the returned source's lifecycle. Defaults to the kernel tick source:
   * worker-backed where possible, so lookahead scheduling survives background
   * tab timer throttling; main-thread interval otherwise.
   */
  createTickSource?: (intervalMs: number) => TickSource;
  expandRepeats?: boolean;
}

export interface OscillatorSynthOptions {
  type?: OscillatorType;
  attackSeconds?: number;
  releaseSeconds?: number;
  gain?: number;
  detune?: number;
  cutoff?: number;
  resonance?: number;
}

export type SoundfontSample = string | ArrayBuffer | AudioBuffer;

export interface SoundfontSynthOptions {
  samples?: Record<number | string, SoundfontSample>;
  resolveSample?: (midi: number) => SoundfontSample | undefined;
  fallback?: HeadlessSynth;
  gain?: number;
  attackSeconds?: number;
  releaseSeconds?: number;
  /** Maximum simultaneous sample fetch/decode operations. Default 4. */
  maxConcurrentLoads?: number;
  /** Maximum source bytes accepted for one URL/ArrayBuffer sample. Default 32 MiB. */
  maxSampleBytes?: number;
  /** Maximum total source bytes accepted across loaded samples. Default 128 MiB. */
  maxTotalSampleBytes?: number;
  /** Maximum decoded Float32 PCM bytes accepted for one sample. Default 64 MiB. */
  maxDecodedSampleBytes?: number;
  /** Maximum decoded Float32 PCM bytes retained across samples. Default 256 MiB. */
  maxTotalDecodedSampleBytes?: number;
}

export type SynthBackend = HeadlessSynth;
export type PlayerOptions = ScorePlayerOptions;
export type PlayerEvents = ScorePlayerEvents;
