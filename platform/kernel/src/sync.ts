// ============================================================================
// Family-neutral synchronized-transport choreography: one master transport,
// N schedulable followers, all positions on the MASTER's position axis
// against one shared reference clock (typically AudioContext.currentTime).
//
// This is the sync machinery the score↔audio bridge proved out — command
// serialization, generation guards, drift monitoring, scheduled joins,
// master-self-stop reconciliation — hoisted here so every transport pairing
// (score+clip, future families, external masters) reuses one hardened
// implementation instead of re-writing it per pair. @webmusic/bridge remains
// the domain assembly: it adapts ScorePlayer/AudioClipPlayer onto these role
// contracts and keeps its public ScoreAudioSync surface.
//
// The master MUST expose a kernel TransportClockReader — the group anchors
// by READING the clock, the exact affine map the master plays by, with no
// sampling skew. A transport without a clock is wrapped in
// {@link MirrorClockMaster}, which owns the sampled mirror-clock fallback
// (dead-reckoning plus reconciliation) as ONE adapter instead of a second
// code path inside the group.
//
// The group is the session command authority: revisioned invalidation and
// settlement wrap its existing cancellation/re-entry choreography. Engines
// still own their clocks. This is not same-instance writable-clock injection;
// see platform/shared-clock-injection.md for that separate migration boundary.
// ============================================================================

import {TransportClock, type TransportClockReader} from './transport';
import {
  MAX_TIMER_DELAY_MS,
  createTickSource,
  type TickSource,
  type TickSourceOptions,
} from './tick';

/**
 * Master role: the transport whose clock is the group's timeline. Everything
 * is on the master's own position axis (for a score player: nominal score
 * seconds; for a clip player: clip seconds).
 */
export interface SyncMasterTransport {
  /**
   * Start the transport. `when` (optional, absolute reference-clock seconds)
   * proposes an ARMED start: a master supporting scheduled starts arms its
   * clock there so followers can join at the very same instant. Masters
   * without the capability ignore the argument and start immediately — the
   * group detects which happened by observing `clock.holding`, never
   * through a declared flag.
   */
  play(when?: number): Promise<void> | void;
  pause(): void;
  stop(): void;
  /**
   * Seek to a position on the master's axis. A returned promise settles
   * once the seek has been applied and any mid-playback restart attempted;
   * the group awaits it before re-anchoring followers. The promise MAY
   * resolve with the transport left paused when the restart failed — the
   * group treats that as a failed resume: it pauses the followers, settles
   * into the paused state and reports 'resume after seek' through
   * {@link TransportGroupOptions.onOperationError}. While playing, the
   * group passes a proposed re-entry time the same way {@link play} does.
   */
  seekPosition(position: number, when?: number): void | Promise<void>;
  setRate?(rate: number): void;
  /** Current position on the master's axis. */
  readonly position: number;
  /** Read-only transport clock (master position axis). REQUIRED — wrap a
   * clockless transport in {@link MirrorClockMaster}. */
  readonly clock: TransportClockReader;
  /**
   * Optional pre-drift-check reconciliation hook (adapters). Called once
   * per drift check with the current reference time; returning 'stalled'
   * tells the group the master stopped on its own (the adapter has already
   * paused its clock) — the group then wraps or settles exactly as for an
   * observed master stop.
   */
  reconcile?(now: number): 'ok' | 'stalled';
  dispose?(): void;
}

/** Follower role: a transport that can join the master's timeline. */
export interface SyncFollowerTransport {
  /**
   * Start playback. `when` (optional, absolute reference-clock seconds) is
   * the scheduled start the join dance relies on: the follower MUST honor
   * it sample-accurately for gapless joins (a follower that starts
   * immediately instead will sit one lead-in ahead and be re-corrected
   * forever by the drift monitor).
   */
  play(when?: number): Promise<void> | void;
  pause(): void;
  stop(): void;
  seek(position: number): void;
  setRate?(rate: number): void;
  /** Current position on the follower's own axis. */
  readonly position: number;
  /** Whether the follower is running, when it can say (optional). */
  readonly running?: boolean;
  /**
   * Read-only clock on the follower's own axis, when the transport has one.
   * When present, the drift monitor reads position and running state from
   * it instead of sampling `position`/`running`.
   */
  readonly clock?: TransportClockReader;
  dispose?(): void;
}

/** Per-follower registration options. */
export interface FollowerOptions {
  /** Follower position corresponding to master position zero. Default 0. */
  offsetSeconds?: number;
  /** Positive affine scale: local position = offsetSeconds + master position × positionScale.
   * The follower's playback rate is scaled by the same factor. Default 1.
   * This is a constant map, not nonlinear warping. */
  positionScale?: number;
  /** Local loop bounds for a transport ALREADY configured to loop natively.
   * The group maps join/seek positions and drift into this phase; it does not
   * configure or schedule that native loop. Positions before the loop end
   * retain their intro; at/past the end they wrap into [start, end). */
  loop?: SyncLoopRegion;
}

export interface TransportGroupOptions {
  /** Scheduling headroom before followers join, in seconds. Default 0.06. */
  leadInSeconds?: number;
  /** Re-join a follower when |follower − expected| exceeds this. Default 0.03 s. */
  driftToleranceSeconds?: number;
  /** Drift check cadence. Default 250 ms. 0 disables the monitor. */
  driftCheckIntervalMs?: number;
  /** Loop region on the master axis; also settable live via {@link TransportGroup.setLoop}. */
  loop?: SyncLoopRegion | null;
  /** Injectable tick source options (tests; custom hosting). */
  tick?: TickSourceOptions;
  /**
   * Observer for failures of the group's own fire-and-forget operations
   * (drift and rate re-joins, loop wraps, pause/stop reconciliation). Those
   * run behind the command queue with no caller promise to reject, and on
   * failure they settle the group into a paused state — without an observer
   * that settlement is silent. Observer exceptions are swallowed.
   */
  onOperationError?: (operation: string, error: unknown) => void;
}

/** A loop region on the master position axis. */
export interface SyncLoopRegion {
  startSeconds: number;
  endSeconds: number;
}

/** Commands accepted by the group's single authority. Positions use the master's
 * stable content axis, never a duration divided by the current playback rate. */
export type TransportCommand =
  | {readonly type: 'play' | 'pause' | 'stop'}
  | {readonly type: 'seek'; readonly position: number}
  | {readonly type: 'rate'; readonly rate: number}
  | {readonly type: 'loop'; readonly loop: SyncLoopRegion | null};

/** Coherent observation at one reference-clock instant. This is a snapshot,
 * not a display timer; read again or use clock.positionAt for moving positions. */
export interface TransportSnapshot {
  readonly revision: number;
  readonly referenceTime: number;
  readonly position: number;
  readonly rate: number;
  readonly paused: boolean;
  readonly holding: boolean;
  readonly loop: Readonly<SyncLoopRegion> | null;
  readonly pending: boolean;
  readonly disposed: boolean;
}

export interface TransportCommit {
  readonly revision: number;
  readonly command: TransportCommand;
  /** A newer command or disposal supersedes this operation's authority. */
  readonly status: 'committed' | 'superseded';
  readonly snapshot: TransportSnapshot;
}

/** Invalidation precedes participant commands, settlement follows their
 * asynchronous work. Engines retract/re-arm through their existing commands;
 * this observer protocol does not inject a shared writable clock. */
export type TransportEvent =
  | {readonly type: 'snapshot'; readonly snapshot: TransportSnapshot}
  | {readonly type: 'reconcile'; readonly operation: string; readonly phase: 'invalidate' | 'settled'; readonly snapshot: TransportSnapshot}
  | {readonly type: 'operation-error'; readonly operation: string; readonly error: unknown; readonly snapshot: TransportSnapshot}
  | {readonly type: 'invalidate'; readonly revision: number; readonly command: TransportCommand; readonly snapshot: TransportSnapshot}
  | {readonly type: 'commit'; readonly commit: TransportCommit; readonly snapshot: TransportSnapshot}
  | {readonly type: 'error'; readonly revision: number; readonly command: TransportCommand; readonly error: unknown; readonly snapshot: TransportSnapshot};

/**
 * How many consecutive drift corrections may fail before the group stops
 * re-joining a follower and reports instead. Each correction restarts the
 * follower audibly, so a mismatch the corrections cannot fix must not
 * stutter forever.
 */
const MAX_CONSECUTIVE_DRIFT_JOINS = 3;

/**
 * Relative slope error before {@link MirrorClockMaster} re-learns a
 * clockless transport's rate. Loose enough to ignore the quantization noise
 * of a transport whose position updates on a frame boundary, tight enough
 * that a refused or clamped rate is caught on the first reconcile that has
 * two samples.
 */
const MIRROR_RATE_TOLERANCE = 0.02;

interface FollowerRecord {
  transport: SyncFollowerTransport;
  offset: number;
  scale: number;
  loop: SyncLoopRegion | null;
  /** Reference time a scheduled join is armed for; drift holds off until then. */
  joinAt: number;
  /**
   * Last rate handed to this follower. Only consulted for followers without
   * a clock to read back; `undefined` until the first application, so a
   * follower constructed at its own rate is corrected rather than assumed.
   */
  lastRate?: number;
  /** Consecutive corrections that did not bring this follower into tolerance. */
  consecutiveDriftJoins: number;
  /** Set once corrections are proven not to converge; cleared by any command. */
  driftJoinsSuppressed: boolean;
}

/**
 * Drives one master transport and N schedulable followers as a single
 * transport. Positions are on the MASTER's axis; each follower runs
 * `offsetSeconds` ahead of the master's zero. The reference clock is
 * injected (`now`), so the group itself is Web-Audio-free and testable
 * against any monotonic time source.
 */
export class TransportGroup {
  #master: SyncMasterTransport;
  readonly #followers: FollowerRecord[] = [];
  readonly #now: () => number;
  #leadIn: number;
  #driftTolerance: number;
  #driftIntervalMs: number;
  #ticker: TickSource | null = null;
  #tickOptions: TickSourceOptions;
  #ticksPerDriftCheck: number;
  #tickCount = 0;
  #loop: SyncLoopRegion | null = null;
  #wrapping = false;
  #generation = 0;
  #revision = 0;
  readonly #pendingCommands = new Set<number>();
  readonly #observers = new Set<(event: TransportEvent) => void>();
  #lastSnapshot?: TransportSnapshot;
  #pendingTransitions = 0;
  /** Serializes transport commands so late async settlements cannot reorder state. */
  #commandActive = false;
  #queuedCommands: Array<() => void> = [];
  #intent: 'playing' | 'paused' | 'stopped' | 'disposed' = 'paused';
  #disposed = false;
  readonly #onOperationError: ((operation: string, error: unknown) => void) | undefined;

  constructor(
    master: SyncMasterTransport,
    now: () => number,
    options: TransportGroupOptions = {},
  ) {
    this.#master = master;
    this.#now = now;
    this.#leadIn = options.leadInSeconds ?? 0.06;
    this.#driftTolerance = options.driftToleranceSeconds ?? 0.03;
    this.#driftIntervalMs = options.driftCheckIntervalMs ?? 250;
    this.#onOperationError = options.onOperationError;
    this.#tickOptions = {intervalMs: 25, ...options.tick};
    assertFiniteNonNegative('leadInSeconds', this.#leadIn);
    assertFiniteNonNegative('driftToleranceSeconds', this.#driftTolerance);
    assertFiniteNonNegative('driftCheckIntervalMs', this.#driftIntervalMs);
    const tickInterval = this.#tickOptions.intervalMs ?? 25;
    if (!Number.isSafeInteger(tickInterval) || tickInterval < 1 || tickInterval > MAX_TIMER_DELAY_MS) {
      throw new RangeError(
        `tick.intervalMs must be a positive safe integer no greater than ${MAX_TIMER_DELAY_MS}.`,
      );
    }
    this.#ticksPerDriftCheck = Math.max(1, Math.round(this.#driftIntervalMs / (this.#tickOptions.intervalMs ?? 25)));
    if (options.loop) {
      assertValidLoop(options.loop);
      this.#loop = {...options.loop};
    }
  }

  /** The group timeline: a read-through to the master's own clock. */
  get clock(): TransportClockReader {
    return this.#master.clock;
  }

  /** Current position on the master axis. */
  get position(): number {
    return this.#master.position;
  }

  /** Read one coherent state on the master's stable position axis. */
  get snapshot(): TransportSnapshot {
    if (this.#disposed && this.#lastSnapshot) {
      return Object.freeze({...this.#lastSnapshot, revision: this.#revision, pending: false, disposed: true});
    }
    const referenceTime = this.#now();
    const clock = this.clock;
    const loop = this.loop;
    const snapshot: TransportSnapshot = Object.freeze({
      revision: this.#revision,
      referenceTime,
      position: clock.positionAt(referenceTime),
      rate: clock.rate,
      paused: clock.paused,
      holding: clock.holding && clock.state.originTime > referenceTime,
      loop: loop ? Object.freeze(loop) : null,
      pending: this.#pendingCommands.size > 0 || this.#pendingTransitions > 0,
      disposed: this.#disposed,
    });
    this.#lastSnapshot = snapshot;
    return snapshot;
  }

  /** Register before synchronously delivering the initial snapshot. Observer
   * failures are contained. Unsubscribe never stops borrowed playback. */
  subscribe(listener: (event: TransportEvent) => void): () => void {
    this.#assertActive();
    this.#observers.add(listener);
    try { listener({type: 'snapshot', snapshot: this.snapshot}); } catch {
      // A failed initial delivery must not leave an orphan subscription.
      this.#observers.delete(listener);
    }
    return () => { this.#observers.delete(listener); };
  }

  /** Submit a command and await its actual participant settlement. Failures
   * reject and emit an error; superseded work cannot claim a committed result.
   * Pause/stop take effect synchronously and await any late-start reconciliation.
   * Call this authority exclusively while coordinating a session. */
  dispatch(command: TransportCommand): Promise<TransportCommit> {
    return this.#dispatch(command, true);
  }

  #dispatch(input: TransportCommand, strict: boolean): Promise<TransportCommit> {
    this.#assertActive();
    validateCommand(input);
    const command = Object.freeze(input.type === 'loop'
      ? {...input, loop: input.loop ? Object.freeze({...input.loop}) : null}
      : {...input});
    const revision = ++this.#revision;
    this.#pendingCommands.add(revision);
    this.#publish({type: 'invalidate', revision, command, snapshot: this.snapshot});
    let operation: Promise<void> | void = undefined;
    try {
      // An observer may synchronously replace this command or dispose us.
      if (revision === this.#revision && !this.#disposed) {
        switch (command.type) {
          case 'play': operation = this.#play(strict); break;
          case 'pause': operation = this.#pause(); break;
          case 'stop': operation = this.#stop(); break;
          case 'seek': operation = this.#seek(command.position, strict); break;
          case 'rate': operation = this.#setRate(command.rate, strict, revision); break;
          case 'loop': operation = this.#setLoop(command.loop); break;
        }
      }
    } catch (error) {
      operation = Promise.reject(error);
    }
    return Promise.resolve(operation).then(() => {
      this.#pendingCommands.delete(revision);
      const snapshot = this.snapshot;
      const commit: TransportCommit = Object.freeze({
        revision, command,
        status: revision === this.#revision && !this.#disposed ? 'committed' : 'superseded',
        snapshot,
      });
      this.#publish({type: 'commit', commit, snapshot});
      return commit;
    }, (error: unknown) => {
      if (strict && revision === this.#revision && !this.#disposed) this.#rollbackFailedPlay();
      this.#pendingCommands.delete(revision);
      this.#publish({type: 'error', revision, command, error, snapshot: this.snapshot});
      throw error;
    });
  }

  #publish(event: TransportEvent): void {
    for (const listener of [...this.#observers]) {
      if (!this.#observers.has(listener)) continue;
      try { listener(event); } catch { /* Observers cannot interrupt transport cleanup. */ }
      // A reentrant command publishes its newer state first; do not then
      // deliver this stale snapshot to the remaining observers.
      if (event.snapshot.revision !== this.#revision) break;
    }
  }

  /**
   * Register a follower. While the group is playing, the follower joins the
   * running timeline on the next scheduled join.
   */
  addFollower(transport: SyncFollowerTransport, options: FollowerOptions = {}): void {
    this.#assertActive();
    const offset = options.offsetSeconds ?? 0;
    assertFiniteNonNegative('offsetSeconds', offset);
    const scale = options.positionScale ?? 1;
    if (!Number.isFinite(scale) || scale <= 0) throw new RangeError('positionScale must be finite and > 0.');
    if (scale !== 1 && !transport.setRate) throw new Error('A scaled follower must support setRate.');
    if (options.loop) assertValidLoop(options.loop);
    const record: FollowerRecord = {
      transport,
      offset,
      scale,
      loop: options.loop ? {...options.loop} : null,
      joinAt: 0,
      consecutiveDriftJoins: 0,
      driftJoinsSuppressed: false,
    };
    this.#followers.push(record);
    if (!this.clock.paused) {
      this.#observeReconciliation('follower join', () => this.#queueJoin(this.#generation, 'follower join', [record]));
    }
  }

  /**
   * Remove a follower from the group (the transport itself is left as-is,
   * still playing if it was; the caller owns its lifecycle from here).
   * Returns false when the transport was not a member.
   */
  removeFollower(transport: SyncFollowerTransport): boolean {
    const index = this.#followers.findIndex((record) => record.transport === transport);
    if (index < 0) return false;
    this.#followers.splice(index, 1);
    return true;
  }

  /** Number of registered followers. */
  get followerCount(): number {
    return this.#followers.length;
  }

  /**
   * Set (or clear) a loop region on the master axis, live. The wrap runs
   * through {@link seek}, so it inherits the shared re-entry origin; the
   * boundary is detected by a worker-backed tick watcher, so the wrap
   * instant may trail the boundary by the watcher/preparation delay and lead-in.
   * Browser throttling means this is not a bounded timing guarantee.
   */
  setLoop(loop: SyncLoopRegion | null): void {
    this.#assertActive();
    if (loop) assertValidLoop(loop);
    void this.#dispatch({type: 'loop', loop}, false).catch((error: unknown) => this.#reportOperationError('loop', error));
  }

  #setLoop(loop: SyncLoopRegion | null): void {
    this.#assertActive();
    if (loop) assertValidLoop(loop);
    this.#loop = loop ? {...loop} : null;
    if (this.clock.paused) {
      if (!this.#needsMonitor()) this.#stopDriftMonitor();
    } else if (this.#needsMonitor()) {
      this.#startDriftMonitor();
    } else {
      this.#stopDriftMonitor();
    }
  }

  get loop(): SyncLoopRegion | null {
    return this.#loop ? {...this.#loop} : null;
  }

  /**
   * Start master and followers on one shared origin. The group proposes
   * `now + leadInSeconds` to the master; one that supports scheduled starts
   * arms there and every follower joins at that very instant. A master that
   * ignores the proposal starts immediately and followers join a lead-in
   * later, offset-matched to its anchor.
   */
  async play(): Promise<void> {
    await this.#dispatch({type: 'play'}, false);
  }

  async #play(strict: boolean): Promise<void> {
    this.#assertActive();
    const generation = ++this.#generation;
    this.#pendingTransitions += 1;
    this.#intent = 'playing';
    this.#resetDriftConvergence();
    return this.#enqueueCommand(async () => {
      try {
        if (!this.#isCurrent(generation)) return;
        await this.#master.play(this.#now() + this.#leadIn);
        if (!this.#isCurrent(generation)) {
          this.#reapplySynchronousIntent();
          return;
        }
        if (strict && this.clock.paused) throw new Error('Master transport did not start.');
        await this.#joinFollowers(generation, this.#followers, strict);
        if (this.#isCurrent(generation)) this.#startDriftMonitor();
      } catch (error) {
        if (this.#isCurrent(generation)) this.#rollbackFailedPlay();
        throw error;
      } finally {
        this.#pendingTransitions -= 1;
      }
    });
  }

  pause(): void {
    if (this.#disposed) return;
    void this.#dispatch({type: 'pause'}, false).catch((error: unknown) => this.#reportOperationError('pause', error));
  }

  #pause(): Promise<void> | void {
    if (this.#disposed) return;
    const hadPendingTransition = this.#pendingTransitions > 0;
    ++this.#generation;
    this.#intent = 'paused';
    this.#resetDriftConvergence();
    this.#stopDriftMonitor();
    this.#applyPause();
    if (hadPendingTransition) {
      return this.#enqueueCommand(() => {
        if (!this.#disposed) this.#applyPause();
      });
    }
  }

  stop(): void {
    if (this.#disposed) return;
    void this.#dispatch({type: 'stop'}, false).catch((error: unknown) => this.#reportOperationError('stop', error));
  }

  #stop(): Promise<void> | void {
    if (this.#disposed) return;
    const hadPendingTransition = this.#pendingTransitions > 0;
    ++this.#generation;
    this.#intent = 'stopped';
    this.#resetDriftConvergence();
    this.#stopDriftMonitor();
    this.#applyStop();
    if (hadPendingTransition) {
      return this.#enqueueCommand(() => {
        if (!this.#disposed) this.#applyStop();
      });
    }
  }

  /**
   * Seek master and followers to a master-axis position. While playing, the
   * group proposes a shared re-entry origin exactly as {@link play} does
   * and re-joins the followers there, so all sides come back in together.
   * Loop wraps run through this path and inherit the same shared origin.
   */
  async seek(position: number): Promise<void> {
    await this.#dispatch({type: 'seek', position}, false);
  }

  async #seek(position: number, strict: boolean): Promise<void> {
    this.#assertActive();
    assertFiniteNonNegative('position', position);
    this.#pendingTransitions += 1;
    this.#resetDriftConvergence();
    return this.#enqueueCommand(async () => {
      try {
        if (this.#disposed) return;
        const generation = this.#generation;
        const wasRunning = !this.clock.paused;
        // Propose a shared re-entry origin only for a mid-playback seek: a
        // seek while paused must not start playback.
        await this.#master.seekPosition(
          position,
          wasRunning ? this.#now() + this.#leadIn : undefined,
        );
        const settled = this.#readSettledMasterPosition();
        if (!this.#isCurrent(generation)) {
          this.#reconcileStaleSeek(settled);
          this.#reapplySynchronousIntent();
          return;
        }
        if (this.clock.paused) {
          // A master that was running but comes back paused failed to
          // resume (seekPosition resolves even then) — mirror the stop
          // instead of seeking still-running followers out from under it.
          if (wasRunning && this.#intent === 'playing') {
            this.#settleFailedResume();
            if (strict) throw new Error('Master transport stayed paused after seek.');
            this.#reconcileStaleSeek(settled);
            return;
          }
          for (const record of [...this.#followers]) {
            if (!this.#isCurrent(generation)) break;
            if (!this.#followers.includes(record)) continue;
            record.transport.seek(this.#localPosition(record, settled));
          }
        } else {
          await this.#joinFollowers(generation, this.#followers, strict);
        }
      } finally {
        this.#pendingTransitions -= 1;
      }
    });
  }

  /**
   * Set the playback rate on the master and every follower. Followers
   * re-join immediately on the shared clock. NOTE: the group does not clamp
   * the rate beyond finite-and-positive — a domain wrapper owns any shared
   * range its transports require.
   */
  setRate(rate: number): void {
    this.#assertActive();
    validateCommand({type: 'rate', rate});
    void this.#dispatch({type: 'rate', rate}, false).catch((error: unknown) => this.#reportOperationError('rate', error));
  }

  #setRate(rate: number, strict: boolean, revision: number, queued = false): Promise<void> | void {
    if (strict && !queued) {
      this.#pendingTransitions += 1;
      return this.#enqueueCommand(async () => {
        try {
          if (revision !== this.#revision || this.#disposed) return;
          await this.#setRate(rate, strict, revision, true);
        } finally {
          this.#pendingTransitions -= 1;
        }
      });
    }
    this.#assertActive();
    if (!Number.isFinite(rate) || rate <= 0) {
      throw new RangeError(`rate must be finite and > 0, got ${rate}.`);
    }
    const generation = this.#generation;
    this.#resetDriftConvergence();
    try {
      this.#master.setRate?.(rate);
    } catch (error) {
      if (strict) throw error;
      this.#reportOperationError('master rate match', error);
    }
    if (revision !== this.#revision || this.#disposed) return;
    if (strict && this.clock.rate !== rate) throw new Error('Master transport did not accept the requested rate.');
    for (const record of [...this.#followers]) {
      if (revision !== this.#revision || this.#disposed) return;
      if (!this.#followers.includes(record)) continue;
      this.#applyFollowerRate(record, rate, strict);
    }
    if (revision !== this.#revision || this.#disposed) return;
    if (!this.clock.paused) {
      return queued
        ? this.#joinFollowers(generation, this.#followers, strict)
        : this.#queueJoin(generation, 'rate re-join', this.#followers, strict);
    }
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#lastSnapshot = this.snapshot;
    this.#disposed = true;
    ++this.#revision;
    ++this.#generation;
    this.#intent = 'disposed';
    const ticker = this.#ticker;
    this.#ticker = null;
    const errors: unknown[] = [];
    const releases: Array<() => void> = [() => ticker?.dispose()];
    for (const record of this.#followers) {
      releases.push(() => record.transport.dispose?.());
    }
    releases.push(() => this.#master.dispose?.());
    for (const release of releases) {
      try {
        release();
      } catch (error) {
        errors.push(error);
      }
    }
    this.#publish({type: 'snapshot', snapshot: this.snapshot});
    this.#observers.clear();
    if (errors.length > 0) throw errors[0];
  }

  /**
   * One drift check: every follower is measured against the master clock,
   * and each one out of tolerance is re-joined on the shared clock (the
   * same scheduled-start dance as {@link play}). Returns the largest
   * absolute drift observed (0 with no followers or while holding off).
   */
  checkDrift(): number {
    this.#assertActive();
    if (this.#pendingTransitions > 0) return 0;
    const now = this.#now();
    if (this.#master.reconcile) {
      const verdict = this.#master.reconcile(now);
      if (verdict === 'stalled' && this.#intent === 'playing') {
        this.#handleMasterStopped();
        return 0;
      }
    }
    let worst = 0;
    const stragglers: FollowerRecord[] = [];
    for (const record of this.#followers) {
      // Hold off while a scheduled join is still pending — the follower's
      // position deliberately parks at its offset through the pre-roll.
      if (now < record.joinAt) continue;
      const expected = this.#localPosition(record, this.clock.positionAt(now));
      // Prefer the follower's own clock over sampling: exact read at `now`,
      // and `paused` is authoritative where the optional `running` getter
      // may be absent entirely.
      const followerClock = record.transport.clock;
      // A follower's own pre-roll may extend past the common join instant.
      // Its parked position is not drift until that actual start arrives.
      if (followerClock?.holding && now < followerClock.state.originTime) continue;
      const followerPosition = followerClock
        ? followerClock.positionAt(now)
        : record.transport.position;
      const followerRunning = followerClock
        ? !followerClock.paused
        : record.transport.running !== false;
      let localDrift = this.#wrapLocal(record, followerPosition) - expected;
      if (record.loop && followerPosition >= record.loop.startSeconds && expected >= record.loop.startSeconds) {
        const period = record.loop.endSeconds - record.loop.startSeconds;
        localDrift = ((localDrift + period / 2) % period + period) % period - period / 2;
      }
      const drift = localDrift / record.scale;
      // Drift is REPORTED for every member, running or not — a follower whose
      // clock reports paused (ended, torn down) is a real divergence a caller
      // may want to see. It is simply never corrected into a re-join thrash.
      if (Math.abs(drift) > Math.abs(worst)) worst = drift;
      if (!followerRunning) continue;
      // A slope mismatch counts as divergence in its own right: re-joining on
      // position alone re-diverges immediately, which is a re-join every
      // check forever rather than convergence. Both axes carry the same rate
      // scalar after applying the explicit local-axis scale, so an
      // inequality here is real divergence, not a unit difference.
      const rateMismatch = followerClock !== undefined && followerClock.rate !== this.clock.rate * record.scale;
      if (Math.abs(drift) <= this.#driftTolerance && !rateMismatch) {
        // In tolerance on both axes: whatever the last correction did, it stuck.
        record.consecutiveDriftJoins = 0;
        record.driftJoinsSuppressed = false;
        continue;
      }
      if (record.driftJoinsSuppressed) continue;
      record.consecutiveDriftJoins += 1;
      if (record.consecutiveDriftJoins > MAX_CONSECUTIVE_DRIFT_JOINS) {
        // Every correction so far re-anchored this follower and the drift
        // came straight back, so it cannot hold the master's slope (an
        // unclampable master rate, a follower without setRate). Re-joining
        // forever would just restart it once per check with no prospect of
        // converging; stop and say so instead. A check that lands back in
        // tolerance, or any explicit command, re-arms corrections.
        record.driftJoinsSuppressed = true;
        this.#reportOperationError(
          'drift re-join',
          new Error(
            `TransportGroup: ${record.consecutiveDriftJoins} consecutive drift corrections failed to ` +
              `converge (drift ${drift.toFixed(4)}s, master rate ${this.clock.rate}). The follower ` +
              'cannot follow the master rate; automatic re-joins are paused until they agree again.',
          ),
        );
        continue;
      }
      stragglers.push(record);
    }
    if (stragglers.length > 0) {
      this.#observeReconciliation('drift re-join', () => this.#queueJoin(this.#generation, 'drift re-join', stragglers));
    }
    return worst;
  }

  #wrapLocal(record: FollowerRecord, position: number): number {
    const loop = record.loop;
    if (!loop || position < loop.endSeconds) return position;
    return loop.startSeconds + (position - loop.startSeconds) % (loop.endSeconds - loop.startSeconds);
  }

  #localPosition(record: FollowerRecord, masterPosition: number): number {
    return this.#wrapLocal(record, record.offset + masterPosition * record.scale);
  }

  /**
   * Schedule followers to (re)join the running master: one reference-clock
   * read, the seek target exact-by-construction for `when` — the same
   * affine map the master plays by. A holding (scheduled-start) master
   * clock whose origin is still in the future is taken as-is, even inside
   * the lead-in horizon: the master has not made a sound yet, so joining
   * exactly at the armed origin is what makes the shared start gapless.
   */
  async #joinFollowers(generation: number, targets: readonly FollowerRecord[], strict = false): Promise<void> {
    if (!this.#isCurrent(generation)) return;
    // External callbacks may remove members while this operation is visiting
    // them. Preserve the visit order without skipping the next live member.
    const members = [...targets];
    for (const record of members) {
      if (!this.#isCurrent(generation)) return;
      if (this.#followers.includes(record)) record.transport.pause();
    }
    const clock = this.clock;
    if (clock.paused) return;
    const now = this.#now();
    const armedOrigin = clock.holding ? clock.state.originTime : -Infinity;
    const when = armedOrigin > now ? armedOrigin : now + this.#leadIn;
    const position = clock.positionAt(when);
    const starts: Array<Promise<void> | void> = [];
    for (const record of members) {
      if (!this.#isCurrent(generation)) break;
      if (!this.#followers.includes(record)) continue;
      try {
        record.joinAt = when;
        // Align the local slope before seeking the mapped future phase.
        this.#applyFollowerRate(record, clock.rate, strict);
        // Rate callbacks can detach a follower or synchronously replace
        // the command. Its old join must not mutate either lifetime.
        if (!this.#isCurrent(generation) || !this.#followers.includes(record)) continue;
        record.transport.seek(this.#localPosition(record, position));
        if (!this.#isCurrent(generation) || !this.#followers.includes(record)) continue;
        starts.push(record.transport.play(when));
      } catch (error) {
        starts.push(Promise.reject(error));
        break;
      }
    }
    // A rejected participant must not leave a still-pending sibling able to
    // restart after failure cleanup has already been reported as complete.
    const settled = await Promise.allSettled(starts);
    if (!this.#isCurrent(generation)) this.#reapplySynchronousIntent();
    const failure = settled.find((result) => result.status === 'rejected');
    if (failure?.status === 'rejected') throw failure.reason;
    if (strict && this.#isCurrent(generation)) {
      for (const record of members) {
        if (!this.#followers.includes(record)) continue;
        const followerClock = record.transport.clock;
        const running = followerClock ? !followerClock.paused : record.transport.running;
        if (running === false) throw new Error('Follower transport did not start.');
      }
    }
  }

  /**
   * Hand a follower a rate, skipping the call when it already runs at it.
   * A follower with a clock is asked directly; for one without, the last
   * applied value is remembered. Best-effort by contract: `setRate` is
   * optional on {@link SyncFollowerTransport}, and a transport that has one
   * may still clamp or refuse it — the convergence check below is what
   * surfaces a mismatch neither side can resolve.
   */
  #applyFollowerRate(record: FollowerRecord, rate: number, strict = false): void {
    rate *= record.scale;
    if (!record.transport.setRate) {
      if (strict && (record.transport.clock?.rate ?? 1) !== rate) {
        throw new Error('Follower transport cannot accept the requested rate.');
      }
      return;
    }
    if (!Number.isFinite(rate) || rate <= 0) return;
    const current = record.transport.clock?.rate ?? record.lastRate;
    if (current === rate) return;
    try {
      record.transport.setRate(rate);
      if (strict && record.transport.clock && record.transport.clock.rate !== rate) {
        throw new Error('Follower transport did not accept the requested rate.');
      }
      record.lastRate = rate;
    } catch (error) {
      if (strict) throw error;
      this.#reportOperationError('follower rate match', error);
    }
  }

  /** Re-arm drift corrections; any explicit command counts as a fresh start. */
  #resetDriftConvergence(): void {
    for (const record of this.#followers) {
      record.consecutiveDriftJoins = 0;
      record.driftJoinsSuppressed = false;
    }
  }

  /**
   * One watcher drives every concern off a kernel tick source (worker-backed
   * where the platform allows, so background-tab throttling does not starve
   * it): master-stop reconciliation and the loop boundary every tick, drift
   * every `driftCheckIntervalMs` worth of ticks.
   */
  #onTick(): void {
    if (this.#disposed) return;
    const revision = this.#revision;
    try {
      this.#reconcileMasterStop();
      this.#checkLoop();
      this.#tickCount += 1;
      if (this.#driftIntervalMs > 0 && this.#tickCount % this.#ticksPerDriftCheck === 0) {
        this.checkDrift();
      }
    } catch (error) {
      // There is no awaiting caller for a timer callback. Report its failure
      // after settling the current session, without pausing a newer command
      // that an adapter may have synchronously dispatched before throwing.
      if (this.#disposed) return;
      if (revision === this.#revision) this.#rollbackFailedPlay();
      this.#reportOperationError('transport monitor', error);
    }
  }

  /**
   * The master can stop on its own (a score player finishing at its natural
   * end pauses and rewinds its clock, racing the group's boundary watcher
   * tick-for-tick). A self-stopped clock while the group means to play
   * either wraps (loop active — the loop's continuation intent outranks the
   * master's own finish) or settles into the paused state.
   */
  #reconcileMasterStop(): void {
    if (this.#intent !== 'playing' || this.#wrapping || this.#pendingTransitions > 0) return;
    if (!this.clock.paused) return;
    this.#handleMasterStopped();
  }

  #handleMasterStopped(): void {
    if (this.#loop && !this.#wrapping) {
      this.#wrap(this.#loop.startSeconds);
    } else {
      this.#settleMasterStopped();
    }
  }

  #checkLoop(): void {
    const loop = this.#loop;
    if (!loop || this.clock.paused || this.#wrapping || this.#pendingTransitions > 0) return;
    if (this.clock.positionAt(this.#now()) >= loop.endSeconds) {
      this.#wrap(loop.startSeconds);
    }
  }

  /**
   * Wrap to the loop start. A running master re-joins inside seek(); a
   * master that stopped on its own (natural finish at or past the loop end)
   * is restarted afterwards. A failed wrap settles into the paused state
   * instead of retrying every tick, and is reported as 'loop wrap'.
   */
  #wrap(startSeconds: number): void {
    this.#wrapping = true;
    void this.seek(startSeconds)
      .then(() => {
        if (!this.#disposed && this.#intent === 'playing' && this.clock.paused) {
          return this.play();
        }
      })
      .catch((error: unknown) => {
        this.#reportOperationError('loop wrap', error);
        if (!this.#disposed && this.#intent === 'playing') this.#settleMasterStopped();
      })
      .finally(() => {
        this.#wrapping = false;
      });
  }

  #startDriftMonitor(): void {
    if (!this.#needsMonitor()) {
      this.#stopDriftMonitor();
      return;
    }
    this.#ticker ??= createTickSource(this.#tickOptions);
    this.#ticker.start(() => this.#onTick());
  }

  #stopDriftMonitor(): void {
    this.#ticker?.stop();
    this.#tickCount = 0;
  }

  #needsMonitor(): boolean {
    return this.#loop !== null || this.#driftIntervalMs > 0;
  }

  #isCurrent(generation: number): boolean {
    return !this.#disposed && generation === this.#generation;
  }

  #reportOperationError(operation: string, error: unknown): void {
    this.#publish({type: 'operation-error', operation, error, snapshot: this.snapshot});
    try {
      this.#onOperationError?.(operation, error);
    } catch {
      // The observer must never disturb transport-state handling.
    }
  }

  /**
   * The master stopped although the group meant to be playing (a swallowed
   * restart failure, or the master ending on its own): pause the followers
   * and settle, exactly as an explicit pause() would.
   */
  #settleMasterStopped(): void {
    this.pause();
  }

  #settleFailedResume(): void {
    this.#settleMasterStopped();
    this.#reportOperationError(
      'resume after seek',
      new Error('TransportGroup: the master transport stayed paused after a mid-playback seek.'),
    );
  }

  #assertActive(): void {
    if (this.#disposed) throw new Error('TransportGroup has been disposed.');
  }

  #observeReconciliation(operation: string, apply: () => Promise<void>): void {
    const revision = ++this.#revision;
    this.#pendingCommands.add(revision);
    this.#publish({type: 'reconcile', operation, phase: 'invalidate', snapshot: this.snapshot});
    const pending = revision === this.#revision && !this.#disposed ? apply() : Promise.resolve();
    void pending.catch((error: unknown) => this.#reportOperationError(operation, error)).finally(() => {
      this.#pendingCommands.delete(revision);
      this.#publish({type: 'reconcile', operation, phase: 'settled', snapshot: this.snapshot});
    });
  }

  /**
   * Queue an independent re-join as a visible transition. Public pause/stop
   * calls can then schedule one final reconciliation behind it, preventing
   * a late follower play() settlement from reviving playback.
   */
  #queueJoin(generation: number, operation: string, targets: readonly FollowerRecord[], strict = false): Promise<void> {
    const revision = this.#revision;
    this.#pendingTransitions += 1;
    return this.#enqueueCommand(async () => {
      try {
        await this.#joinFollowers(generation, targets, strict);
      } finally {
        this.#pendingTransitions -= 1;
      }
    }).catch((error: unknown) => {
      // The FIFO may already have begun a newer seek/rate command before
      // this rejection handler runs. Old failure must not pause that owner.
      if (this.#isCurrent(generation) && revision === this.#revision) this.#rollbackFailedPlay();
      if (!this.#disposed) this.#reportOperationError(operation, error);
      if (strict) throw error;
    });
  }

  /**
   * Run the first idle command immediately so master.play() remains inside
   * the browser's transient user-activation stack. Only commands that
   * actually have an async predecessor wait in the FIFO.
   */
  #enqueueCommand<Result>(operation: () => Result | PromiseLike<Result>): Promise<Result> {
    return new Promise<Result>((resolve, reject) => {
      const run = () => {
        let result: Result | PromiseLike<Result>;
        try {
          result = operation();
        } catch (error) {
          reject(error);
          this.#finishCommand();
          return;
        }
        Promise.resolve(result).then(
          (value) => {
            resolve(value);
            this.#finishCommand();
          },
          (error: unknown) => {
            reject(error);
            this.#finishCommand();
          },
        );
      };

      if (this.#commandActive) {
        this.#queuedCommands.push(run);
      } else {
        this.#commandActive = true;
        run();
      }
    });
  }

  #finishCommand(): void {
    const next = this.#queuedCommands.shift();
    if (next) {
      next();
    } else {
      this.#commandActive = false;
    }
  }

  /** Read the master's actual post-seek position (it may clamp). */
  #readSettledMasterPosition(): number {
    const position = this.#master.position;
    if (!Number.isFinite(position) || position < 0) {
      throw new RangeError('Master transport returned an invalid position after seek.');
    }
    return position;
  }

  /** Preserve the completed seek position when pause superseded it. */
  #reconcileStaleSeek(position: number): void {
    if (this.#disposed || this.#intent !== 'paused') return;
    const generation = this.#generation;
    for (const record of [...this.#followers]) {
      if (!this.#isCurrent(generation)) break;
      if (!this.#followers.includes(record)) continue;
      record.transport.seek(this.#localPosition(record, position));
    }
  }

  /** Re-apply pause/stop after an older async master command settles late. */
  #reapplySynchronousIntent(): void {
    if (this.#disposed) return;
    if (this.#intent === 'paused') {
      this.#applyPause();
    } else if (this.#intent === 'stopped') {
      this.#applyStop();
    }
  }

  #applyPause(): void {
    const generation = this.#generation;
    const errors: unknown[] = [];
    for (const record of [...this.#followers]) {
      if (!this.#isCurrent(generation)) break;
      if (!this.#followers.includes(record)) continue;
      try { record.transport.pause(); } catch (error) { errors.push(error); }
    }
    if (this.#isCurrent(generation)) {
      try { this.#master.pause(); } catch (error) { errors.push(error); }
    }
    if (errors.length > 0) throw errors[0];
  }

  #applyStop(): void {
    const generation = this.#generation;
    const errors: unknown[] = [];
    for (const record of [...this.#followers]) {
      if (!this.#isCurrent(generation)) break;
      if (!this.#followers.includes(record)) continue;
      try { record.transport.stop(); } catch (error) { errors.push(error); }
    }
    if (this.#isCurrent(generation)) {
      try { this.#master.stop(); } catch (error) { errors.push(error); }
    }
    if (errors.length > 0) throw errors[0];
  }

  #rollbackFailedPlay(): void {
    ++this.#generation;
    this.#intent = 'paused';
    this.#stopDriftMonitor();
    try {
      this.#applyPause();
    } catch {
      // Preserve the original failure while respecting callback re-entry.
    }
  }
}

/**
 * Minimal command surface a clockless transport must offer so
 * {@link MirrorClockMaster} can adapt it into the master role.
 */
export interface ClocklessMasterTransport {
  play(when?: number): Promise<void> | void;
  pause(): void;
  stop(): void;
  seekPosition(position: number, when?: number): void | Promise<void>;
  setRate?(rate: number): void;
  readonly position: number;
  dispose?(): void;
}

/**
 * Adapts a transport WITHOUT a readable clock into the required-clock
 * master role by dead-reckoning a mirror TransportClock across the command
 * surface, and reconciling the reckoning against the transport's actual
 * position on every drift check:
 *
 * - two identical position samples while the mirror advanced past the
 *   tolerance mean the transport stopped on its own (ended, clamped at its
 *   duration, paused out of band) — the adapter pauses the mirror and
 *   reports 'stalled', which the group treats as a master stop;
 * - a moving transport that diverged from the extrapolation (refused or
 *   clamped rate, tempo automation) re-anchors the mirror so drift is
 *   measured against the transport, not the reckoning.
 *
 * This is the ONE home of the sampled fallback the score↔audio bridge used
 * to interleave through its clocked path.
 */
export class MirrorClockMaster implements SyncMasterTransport {
  readonly #inner: ClocklessMasterTransport;
  readonly #mirror: TransportClock;
  readonly #now: () => number;
  #tolerance: number;
  #lastSample: {position: number; mirrorPosition: number; time: number} | null = null;

  constructor(inner: ClocklessMasterTransport, now: () => number, options: {reconcileToleranceSeconds?: number} = {}) {
    this.#inner = inner;
    this.#now = now;
    this.#tolerance = options.reconcileToleranceSeconds ?? 0.03;
    assertFiniteNonNegative('reconcileToleranceSeconds', this.#tolerance);
    this.#mirror = new TransportClock(now);
  }

  get clock(): TransportClockReader {
    return this.#mirror;
  }

  get position(): number {
    return this.#inner.position;
  }

  async play(when?: number): Promise<void> {
    await this.#inner.play(when);
    this.#lastSample = null;
    this.#mirror.start(this.#now(), this.#inner.position);
  }

  pause(): void {
    this.#inner.pause();
    this.#lastSample = null;
    this.#mirror.pause(this.#now());
  }

  stop(): void {
    this.#inner.stop();
    this.#lastSample = null;
    const now = this.#now();
    this.#mirror.pause(now);
    this.#mirror.seekTo(0, now);
  }

  async seekPosition(position: number, when?: number): Promise<void> {
    await this.#inner.seekPosition(position, when);
    this.#lastSample = null;
    this.#mirror.seekTo(this.#inner.position, this.#now());
  }

  setRate(rate: number): void {
    this.#inner.setRate?.(rate);
    this.#lastSample = null;
    this.#mirror.setRate(rate, this.#now());
  }

  reconcile(now: number): 'ok' | 'stalled' {
    const actual = this.#inner.position;
    if (!Number.isFinite(actual) || actual < 0) return 'ok';
    const mirrorPosition = this.#mirror.positionAt(now);
    const sample = this.#lastSample;
    this.#lastSample = {position: actual, mirrorPosition, time: now};
    if (
      sample !== null &&
      actual === sample.position &&
      mirrorPosition - sample.mirrorPosition > this.#tolerance &&
      !this.#mirror.paused
    ) {
      this.#lastSample = null;
      this.#mirror.pause(now);
      return 'stalled';
    }
    // Correct the reckoning's SLOPE, not only its intercept. A transport
    // that clamped or refused the shared rate advances at a rate the mirror
    // does not know; re-anchoring the position alone leaves the mirror
    // drifting away again before the next check, which is what turns a rate
    // mismatch into an endless correction loop. The next join then hands the
    // followers the rate the transport actually runs at.
    if (sample !== null && !this.#mirror.paused) {
      const elapsed = now - sample.time;
      const advanced = actual - sample.position;
      if (elapsed > 0 && advanced > 0) {
        const measured = advanced / elapsed;
        const current = this.#mirror.rate;
        if (
          Number.isFinite(measured) &&
          measured > 0 &&
          Math.abs(measured - current) > MIRROR_RATE_TOLERANCE * current
        ) {
          this.#mirror.setRate(measured, now);
        }
      }
    }
    if (Math.abs(mirrorPosition - actual) > this.#tolerance) {
      this.#mirror.seekTo(actual, now);
    }
    return 'ok';
  }

  dispose(): void {
    this.#inner.dispose?.();
  }
}

function assertFiniteNonNegative(name: string, value: number): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${name} must be finite and >= 0.`);
  }
}

function assertValidLoop(loop: SyncLoopRegion): void {
  if (
    !Number.isFinite(loop.startSeconds) || loop.startSeconds < 0 ||
    !Number.isFinite(loop.endSeconds) || !(loop.endSeconds > loop.startSeconds)
  ) {
    throw new RangeError('Loop bounds must be finite, non-negative, and endSeconds must be greater than startSeconds.');
  }
}

/** Validate before changing revision or touching participants. */
function validateCommand(command: TransportCommand): void {
  switch (command.type) {
    case 'play': case 'pause': case 'stop': return;
    case 'seek': assertFiniteNonNegative('position', command.position); return;
    case 'rate':
      if (!Number.isFinite(command.rate) || command.rate <= 0) throw new RangeError('rate must be finite and > 0.');
      return;
    case 'loop': if (command.loop) assertValidLoop(command.loop); return;
    default: throw new TypeError('Unknown transport command.');
  }
}
