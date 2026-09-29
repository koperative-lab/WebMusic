// ============================================================================
// Synchronized score + audio playback on one AudioContext clock.
//
// Strategy: the SCORE is the master transport. `play()` proposes a shared
// audio-clock origin a lead-in ahead: a master supporting scheduled starts
// (ScorePlayer) arms itself there, and the clip joins at the very same
// instant via the buffer engine's sample-accurate `play(when)` — both
// transports make their first sound together. A master that ignores the
// proposal starts immediately and the clip joins a lead-in later, exactly
// as before. When the transport exposes its kernel TransportClock, the sync
// anchors by READING the clock — the exact affine map the scheduler plays
// by, no sampling skew; clockless transports fall back to sampled anchoring
// via a kernel MirrorClockMaster. A drift monitor re-joins the clip if the
// transports ever diverge in position OR in rate (e.g. after rate clamping);
// every join matches the follower to the master's current slope, so a
// correction converges instead of being re-issued on every check.
//
// The choreography itself — command serialization, generation guards,
// scheduled joins, drift monitoring, master-stop reconciliation — lives in
// the kernel's family-neutral TransportGroup (@webmusic/kernel/sync); this
// module is the score↔audio DOMAIN ASSEMBLY: it adapts ScorePlayer-shaped
// masters and AudioClipPlayer-shaped followers onto the kernel roles and
// keeps the established ScoreAudioSync surface.
//
// Both players MUST share one AudioContext — use createSyncedPlayback() to
// construct everything correctly, or pass the same `audioContext` option to
// both constructors yourself.
// ============================================================================

import type {TransportClockReader} from '@webmusic/kernel/transport';
import type {TickSourceOptions} from '@webmusic/kernel/tick';
import {
  MirrorClockMaster,
  TransportGroup,
  type ClocklessMasterTransport,
  type TransportCommand,
  type TransportCommit,
  type TransportEvent,
  type TransportSnapshot,
  type SyncFollowerTransport as KernelFollowerRole,
  type SyncMasterTransport as KernelMasterRole,
} from '@webmusic/kernel/sync';
import {createWebAudioContext} from '@webmusic/kernel/audio-context';
import {createAudioClip, type AudioClip} from '@webmusic/audio';
import {AudioClipPlayer} from '@webmusic/audio/play/headless';
import type {Score} from '@webmusic/score';
import {ScorePlayer} from '@webmusic/score/play/headless';
import {renderScoreToBuffer, type RenderOptions} from '@webmusic/score/play';
import {closeContext, ownContext, releaseOwnedContext} from './owned-context';
import {
  assertFactoryClipOptions,
  validatedClipOffsetSeconds,
  type FactoryClipOptions,
} from './factory-clip-options';
import {assertRenderedClipAlignment, recordRenderProvenance} from './render-provenance';

/** Read-only clock view a transport may expose (kernel TransportClockReader). */
export type SyncTransportClockView = TransportClockReader;

/**
 * Minimal structural surface the sync needs from the score-side transport.
 * Everything is on the NOMINAL score-seconds axis (the rendered-clip
 * timeline) — v2 dropped the rate-scaled members entirely.
 *
 * When `clock` is present (ScorePlayer exposes its kernel transport clock),
 * the sync anchors by READING the clock — no sampling, no skew, and an armed
 * scheduled start is visible through `holding`. Transports without a clock
 * (TonePlayer, third parties) fall back to sampled anchoring; the sync then
 * runs them behind a kernel MirrorClockMaster exactly as v1's inline mirror
 * did.
 */
export interface SyncScoreTransport {
  /**
   * Start playback. The sync passes a proposed start time (absolute
   * AudioContext seconds, a lead-in ahead) — a master supporting scheduled
   * starts (ScorePlayer) arms its clock there so the clip can join at the
   * exact same instant. Masters without the capability simply take no
   * parameter and start immediately (a narrower signature satisfies this
   * member structurally); the sync detects the difference by observing
   * `clock.holding`, never through a declared flag.
   */
  play(when?: number): Promise<void> | void;
  pause(): void;
  stop(): void;
  /**
   * Seek to a NOMINAL score-seconds position. A returned promise settles
   * once the seek has been applied and any mid-playback restart attempted;
   * the sync awaits it before re-anchoring the clip, which is what makes
   * mid-playback seeks land sample-accurately. The promise MAY resolve with
   * the transport left paused when the restart failed (ScorePlayer swallows
   * restart errors) — the sync treats that as a failed resume: it pauses the
   * clip, settles into the paused state and reports 'resume after seek'
   * through {@link ScoreAudioSyncOptions.onOperationError}.
   *
   * While playing, the sync passes a proposed re-entry time the same way
   * {@link play} does, so a transport supporting scheduled re-anchoring
   * brings both sides back in together. Transports that ignore it resume
   * immediately and the clip re-joins a lead-in later, as before.
   */
  seekNominal(nominalSeconds: number, when?: number): void | Promise<void>;
  setRate?(rate: number): void;
  /** Nominal score-timeline position. */
  readonly nominalSeconds: number;
  /** Read-only transport clock (nominal axis), when the transport has one. */
  readonly clock?: SyncTransportClockView;
  dispose?(): void;
}

/**
 * Role-neutral names for the two participants. The sync is defined by ROLE,
 * not by family: the first constructor argument drives the transport and the
 * second follows it. The score-mastered pairing these interfaces were named
 * for is the default (see {@link createSyncedPlayback}), and the reverse —
 * a recording driving the score — is assembled by the adapters in
 * `audio-master.ts`. Prefer these names in role-generic code. They are the
 * BRIDGE's shapes; the kernel's own role contracts are adapted onto them in
 * the constructor.
 */
export type SyncMasterTransport = SyncScoreTransport;
/** @see SyncMasterTransport */
export type SyncFollowerTransport = SyncClipTransport;

/** Minimal structural surface the sync needs from the clip-side transport. */
export interface SyncClipTransport {
  play(when?: number): Promise<void> | void;
  pause(): void;
  stop(): void;
  seek(seconds: number): void;
  setRate?(rate: number): void;
  readonly seconds: number;
  readonly playing?: boolean;
  /**
   * Read-only transport clock on the clip's own seconds axis, when the
   * transport has one (AudioClipPlayer exposes the buffer engine's). When
   * present, the drift monitor reads the clip position and running state
   * from the clock instead of sampling `seconds`/`playing` — the same
   * skew-free read-through the score side gets. (AudioClipPlayer's clock is
   * unwrapped under clip-side loops, but the sync never sets one: looping
   * is driven through master seeks, so the two axes agree here.)
   */
  readonly clock?: SyncTransportClockView;
  dispose?(): void;
}

export interface ScoreAudioSyncOptions {
  /** Scheduling headroom before the clip joins, in seconds. Default 0.06. */
  leadInSeconds?: number;
  /** Clip seconds corresponding to score-seconds zero. Default 0. */
  clipOffsetSeconds?: number;
  /** Reseek the clip when |clip − expected| exceeds this. Default 0.03 s. */
  driftToleranceSeconds?: number;
  /** Drift check cadence. Default 250 ms. 0 disables drift checks; natural-stop and loop watching remain active. */
  driftCheckIntervalMs?: number;
  /** Loop region in score seconds; also settable at runtime via {@link ScoreAudioSync.setLoop}. */
  loop?: SyncLoopRegion | null;
  /** Injectable tick source options (tests; custom hosting). */
  tick?: TickSourceOptions;
  /**
   * Observer for failures of the sync's own fire-and-forget operations
   * (drift and rate re-joins, loop wraps, pause/stop reconciliation). Those
   * run behind the command queue with no caller promise to reject, and on
   * failure they settle the sync into a paused state — without an observer
   * that settlement is silent. Observer exceptions are swallowed.
   */
  onOperationError?: (operation: string, error: unknown) => void;
}

/** A loop region on the nominal score-seconds axis. */
export interface SyncLoopRegion {
  startSeconds: number;
  endSeconds: number;
}

const MIN_SHARED_PLAYBACK_RATE = 0.25;
const MAX_SHARED_PLAYBACK_RATE = 4;

/**
 * Drives a score player and a clip player as one transport. Positions are in
 * NOMINAL score seconds (the rendered-clip timeline); the clip is expected to
 * run `clipOffsetSeconds` ahead of the score's zero (use 0 for a clip
 * rendered from the same score).
 */
export class ScoreAudioSync {
  readonly #group: TransportGroup;
  readonly #score: SyncScoreTransport;
  #disposed = false;

  constructor(
    score: SyncScoreTransport,
    clip: SyncClipTransport,
    context: BaseAudioContext,
    options: ScoreAudioSyncOptions = {},
  ) {
    this.#score = score;
    const clipOffset = validatedClipOffsetSeconds(options.clipOffsetSeconds);
    const now = () => context.currentTime;
    const commands: ClocklessMasterTransport = {
      play: (when?: number) => score.play(when),
      pause: () => score.pause(),
      stop: () => score.stop(),
      seekPosition: (position: number, when?: number) => score.seekNominal(position, when),
      setRate: (rate: number) => score.setRate?.(rate),
      get position() {
        return score.nominalSeconds;
      },
      dispose: () => score.dispose?.(),
    };
    // A master's clock can APPEAR after construction: AudioClipPlayer only
    // builds its buffer-engine clock on first play, and `clipAsMaster` reads
    // it through live. Snapshotting the clock here would pin such a master to
    // the sampled mirror for its whole life and silently give up the
    // sample-accurate clock it grows — so every read goes back to the
    // transport, and the mirror is kept warm underneath purely as the
    // fallback for a master that never grows one (TonePlayer, third parties).
    const mirror = new MirrorClockMaster(commands, now, {
      reconcileToleranceSeconds: options.driftToleranceSeconds ?? 0.03,
    });
    const master: KernelMasterRole = {
      play: (when?: number) => mirror.play(when),
      pause: () => mirror.pause(),
      stop: () => mirror.stop(),
      seekPosition: (position: number, when?: number) => mirror.seekPosition(position, when),
      setRate: (rate: number) => mirror.setRate(rate),
      get position() {
        return score.nominalSeconds;
      },
      get clock() {
        return score.clock ?? mirror.clock;
      },
      // Dead reckoning is only meaningful while the transport has no clock of
      // its own; once it exposes one the group reads the truth directly and
      // the group's own master-stop check covers the stall case.
      reconcile: (at: number) => (score.clock ? 'ok' : mirror.reconcile(at)),
      dispose: () => mirror.dispose(),
    };
    const follower: KernelFollowerRole = {
      play: (when?: number) => clip.play(when),
      pause: () => clip.pause(),
      stop: () => clip.stop(),
      seek: (position: number) => clip.seek(position),
      setRate: (rate: number) => clip.setRate?.(rate),
      get position() {
        return clip.seconds;
      },
      get running() {
        return clip.playing;
      },
      get clock() {
        return clip.clock;
      },
      dispose: () => clip.dispose?.(),
    };
    this.#group = new TransportGroup(master, now, {
      leadInSeconds: options.leadInSeconds,
      driftToleranceSeconds: options.driftToleranceSeconds,
      driftCheckIntervalMs: options.driftCheckIntervalMs,
      loop: options.loop,
      tick: options.tick,
      onOperationError: options.onOperationError,
    });
    this.#group.addFollower(follower, {offsetSeconds: clipOffset});
  }

  /**
   * The shared transport clock (nominal score seconds): a read-through to the
   * score transport's own clock when it has one, else the kernel mirror. The
   * sync never mutates a transport-owned clock.
   */
  get clock(): SyncTransportClockView {
    return this.#group.clock;
  }

  /** Coherent state on the nominal master-seconds axis. */
  get snapshot(): TransportSnapshot {
    return this.#group.snapshot;
  }

  /** Subscribe before receiving the current snapshot. Detaching the observer
   * does not stop either player. Subsequent events describe command invalidation,
   * committed/superseded settlement, errors and disposal. */
  subscribe(listener: (event: TransportEvent) => void): () => void {
    this.#assertActive();
    return this.#group.subscribe(listener);
  }

  /** Await a command's participant settlement. Seek positions and loop bounds
   * are nominal master seconds; rate never changes that coordinate system.
   * The shared 0.25–4 rate range also applies to this command surface. */
  dispatch(command: TransportCommand): Promise<TransportCommit> {
    this.#assertActive();
    if (command.type === 'rate') assertSharedRate(command.rate);
    return this.#group.dispatch(command);
  }

  /**
   * Set (or clear) a loop region on the score-seconds axis, live. The wrap
   * runs through {@link seek}, so it inherits the shared re-entry origin:
   * both transports leave the boundary together on one audio-clock instant,
   * with no score-only opening on each cycle. A worker-backed tick watcher
   * detects the boundary, so the wrap INSTANT still trails the true boundary
   * by watcher delivery, preparation and lead-in delays; browser throttling
   * prevents a fixed upper bound. Landing the wrap on
   * the boundary itself needs the scheduler to commit notes across it (or
   * the clip to loop natively), which is a separate design.
   */
  setLoop(loop: SyncLoopRegion | null): void {
    this.#assertActive();
    this.#group.setLoop(loop);
  }

  get loop(): SyncLoopRegion | null {
    return this.#group.loop;
  }

  /** Current transport position in nominal score seconds. */
  get seconds(): number {
    return this.#score.nominalSeconds;
  }

  /**
   * Start both transports on one shared audio-clock origin. The sync
   * proposes `now + leadInSeconds` to the score master; one that supports
   * scheduled starts arms there and the clip joins at that very instant, so
   * with buffer-engine playback both make their first sound together. A
   * master that ignores the proposal starts immediately and the clip joins
   * a lead-in later, offset-matched to its anchor, exactly as before.
   */
  async play(): Promise<void> {
    this.#assertActive();
    return this.#group.play();
  }

  pause(): void {
    if (this.#disposed) return;
    this.#group.pause();
  }

  stop(): void {
    if (this.#disposed) return;
    this.#group.stop();
  }

  /**
   * Seek both transports to a score-seconds position. While playing, the
   * sync proposes a shared re-entry origin exactly as {@link play} does and
   * then re-joins the clip there, so both sides come back in together
   * instead of the score resuming a lead-in ahead of the clip. Loop wraps
   * run through this path and inherit the same shared origin.
   */
  async seek(scoreSeconds: number): Promise<void> {
    this.#assertActive();
    if (!Number.isFinite(scoreSeconds) || scoreSeconds < 0) {
      throw new RangeError('scoreSeconds must be finite and >= 0.');
    }
    return this.#group.seek(scoreSeconds);
  }

  /**
   * Set the shared playback rate on both transports. The score scheduler's
   * retune is synchronous, so the clip re-joins immediately on the audio
   * clock. The group owns the session command; each engine retains its own
   * transport clock until shared-instance injection is implemented.
   */
  setRate(rate: number): void {
    this.#assertActive();
    assertSharedRate(rate);
    this.#group.setRate(rate);
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    try {
      this.#group.dispose();
    } finally {
      releaseOwnedContext(this);
    }
  }

  /**
   * One drift check. Corrections re-join on the audio clock (the same
   * scheduled-start dance as {@link play}) rather than command-level seeking,
   * so a correction lands sample-accurately instead of chasing the score by
   * one JS-tick each time.
   */
  checkDrift(): number {
    this.#assertActive();
    return this.#group.checkDrift();
  }

  #assertActive(): void {
    if (this.#disposed) throw new Error('ScoreAudioSync has been disposed.');
  }
}

export interface CreateSyncedPlaybackOptions extends ScoreAudioSyncOptions {
  /** Shared AudioContext. If omitted, the factory creates one and sync.dispose() closes it. */
  context?: AudioContext;
  /** ScorePlayer options. An initial tempo must imply a shared rate within 0.25–4×. */
  scoreOptions?: ConstructorParameters<typeof ScorePlayer>[1];
  /**
   * Options forwarded to the AudioClipPlayer constructor. The engine is not
   * selectable here: only the buffer engine can join sample-accurately, so
   * the sync always builds a buffer-engine player ('buffer' is accepted,
   * anything else throws). The media adapter and clip-side loop/rate
   * overrides are rejected; use the sync's setLoop()/setRate() instead.
   * Construct the players and a {@link ScoreAudioSync} directly to pair a
   * score with other clip transports.
   */
  clipOptions?: FactoryClipOptions;
}

/**
 * Construct a score player, a clip player and a {@link ScoreAudioSync} on one
 * shared AudioContext — the safe way to get synchronized playback. The clip
 * must carry decoded samples (streaming/URL-only clips cannot feed the
 * buffer engine). To pair a clip from {@link renderScoreToClip} here, render
 * with `tailSeconds: 0`; otherwise use {@link createAudioMasteredPlayback} so
 * the clip can finish after the score's natural end.
 */
export function createSyncedPlayback(
  score: Score,
  clip: AudioClip,
  options: CreateSyncedPlaybackOptions = {},
): {sync: ScoreAudioSync; scorePlayer: ScorePlayer; clipPlayer: AudioClipPlayer} {
  const clipOptions = options.clipOptions;
  assertFactoryClipOptions('createSyncedPlayback', clip, clipOptions);
  const clipOffsetSeconds = validatedClipOffsetSeconds(options.clipOffsetSeconds);
  const scoreOptions = options.scoreOptions;
  assertRenderedClipAlignment('createSyncedPlayback', score, clip, scoreOptions?.expandRepeats);
  assertInitialScoreTempo(score, scoreOptions?.tempo);
  const context = options.context ??
    createWebAudioContext('Web Audio is not available. Pass an existing AudioContext in options.context.');
  let scorePlayer: ScorePlayer | undefined;
  let clipPlayer: AudioClipPlayer | undefined;
  try {
    scorePlayer = new ScorePlayer(score, {...scoreOptions, audioContext: context});
    clipPlayer = new AudioClipPlayer(clip, {
      ...clipOptions,
      audioContext: context,
      // Only the buffer engine can join sample-accurately.
      engine: 'buffer',
    });
    const sync = new ScoreAudioSync(scorePlayer, clipPlayer, context, {
      ...options,
      clipOffsetSeconds,
    });
    if (!options.context) ownContext(sync, context, options.onOperationError);
    return {sync, scorePlayer, clipPlayer};
  } catch (error) {
    for (const player of [clipPlayer, scorePlayer]) {
      try { player?.dispose(); } catch { /* Preserve the construction failure. */ }
    }
    if (!options.context) closeContext(context, options.onOperationError);
    throw error;
  }
}

/**
 * Render a score offline into an {@link AudioClip}. With the default positive
 * tail, use the clip as master so its final samples are not cut off when the
 * score stops; `tailSeconds: 0` permits a score-mastered pairing. A tempo
 * override that differs from the score's base tempo changes the clip's
 * content axis and cannot be paired by either fixed-offset factory.
 */
export async function renderScoreToClip(score: Score, options?: RenderOptions): Promise<AudioClip> {
  const baseTempo = score.timeMap.tempi[0]?.bpm ?? 120;
  const tempo = options?.tempo;
  if (tempo !== undefined && (!Number.isFinite(tempo) || tempo <= 0)) {
    throw new RangeError('renderScoreToClip tempo must be finite and > 0.');
  }
  const tail = options?.tailSeconds;
  if (tail !== undefined && (!Number.isFinite(tail) || tail < 0)) {
    throw new RangeError('renderScoreToClip tailSeconds must be finite and >= 0.');
  }
  const buffer = await renderScoreToBuffer(score, options);
  const channelData: Float32Array[] = [];
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    channelData.push(buffer.getChannelData(channel));
  }
  const clip = createAudioClip({channelData, sampleRate: buffer.sampleRate});
  recordRenderProvenance(clip, score, tempo === undefined ? 1 : tempo / baseTempo, tail === undefined || tail > 0);
  return clip;
}

/** Validate the Score master's initial rate before acquiring a context. */
function assertInitialScoreTempo(score: Score, tempo: number | undefined): void {
  if (tempo === undefined) return;
  const baseTempo = score.timeMap.tempi[0]?.bpm ?? 120;
  const rate = tempo / baseTempo;
  if (!Number.isFinite(rate) || rate < MIN_SHARED_PLAYBACK_RATE || rate > MAX_SHARED_PLAYBACK_RATE) {
    throw new RangeError(
      `scoreOptions.tempo must set an initial shared rate between ` +
        `${MIN_SHARED_PLAYBACK_RATE} and ${MAX_SHARED_PLAYBACK_RATE} times the score tempo.`,
    );
  }
}

function assertSharedRate(rate: number): void {
  if (!Number.isFinite(rate) || rate < MIN_SHARED_PLAYBACK_RATE || rate > MAX_SHARED_PLAYBACK_RATE) {
    throw new RangeError(`rate must be finite and between ${MIN_SHARED_PLAYBACK_RATE} and ${MAX_SHARED_PLAYBACK_RATE}.`);
  }
}
