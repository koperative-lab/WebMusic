import type {ConnectionLease} from './module/lease';
import {SessionSchedulingAuthority, type SessionSchedulingBinding} from './session-scheduling';
export type {SessionSchedulingBinding, SessionSchedulingSnapshot, SessionSchedulingEvent, SessionScheduleSegment} from './session-scheduling';
import {TransportClock, type TransportClockReader} from './transport';
import {
  TransportGroup,
  type FollowerOptions,
  type SyncFollowerTransport,
  type SyncLoopRegion,
  type TransportCommand,
  type TransportCommit,
  type TransportEvent,
  type TransportGroupOptions,
  type TransportSnapshot,
} from './sync';

/** Domain adapters name their stable local seconds axis explicitly. */
export interface SessionParticipantOptions extends FollowerOptions {
  axis: string;
  /** Local endpoint in the declared axis. null is unknown; Infinity is live. */
  durationSeconds: number | null | (() => number | null);
  /** Actual engine completion, never inferred from a paused transport. */
  ended?: () => boolean;
  /** Opt in to completion at the mapped finite endpoint when no ended signal exists. */
  endPolicy?: 'participant' | 'position';
  /** The borrowed engine itself; prevents duplicates through different adapters. */
  identity?: object;
  /** Prepare resources before establishing a shared start origin. */
  prepare?: () => void | Promise<void>;
  /** Resume reference-clock resources only when playback is explicitly requested. */
  activate?: () => void | Promise<void>;
  /** Opt into one shared scheduling authority instead of legacy follower commands. */
  attachScheduling?: (binding: SessionSchedulingBinding) => ConnectionLease;
}

export interface SessionParticipantLease {
  readonly token: symbol;
  readonly active: boolean;
  /** Resolves after explicit play/preload preparation and registration (or release).
   * Merely discovering a member in a paused Session does not prepare resources.
   * After a rejected attempt, a retried preparation exposes a fresh promise. */
  readonly ready: Promise<void>;
  /** Resolves after release and cancellation of late preparation/play work. */
  readonly settled: Promise<void>;
  /** A failed cancellation blocks reuse until a later release() succeeds. */
  readonly cancellationError: unknown;
  /** Unregister first, then cancel only this member; never disposes its engine. */
  release(): void;
}

/** A pending data load, never a fabricated transport participant. */
export interface SessionPendingSourceLease {
  readonly token: symbol;
  readonly active: boolean;
  readonly ready: Promise<void>;
  /** Complete only after registering the actual loaded participant. */
  resolve(): void;
  /** Keep failed readiness explicit until retry/replacement/cancellation releases it. */
  reject(error: unknown): void;
  /** Cancel this reservation and unblock waiters; stale completions are ignored. */
  release(): void;
}

export interface SessionTransportOptions extends TransportGroupOptions {
  /** Explicit Session-seconds bounds override inferred member duration/end policy. */
  range?: SyncLoopRegion;
}

export interface SessionTransportSnapshot extends TransportSnapshot {
  readonly axis: 'session-seconds';
  readonly durationSeconds: number | null;
  readonly participantCount: number;
  readonly pendingSourceCount: number;
  readonly membershipRevision: number;
  readonly ended: boolean;
  readonly range: Readonly<SyncLoopRegion> | null;
  readonly schedulingEpoch: number;
  readonly schedulingMode: 'shared-anchor' | 'mixed' | 'legacy';
}

type WithSessionSnapshot<Event> = Event extends {snapshot: TransportSnapshot}
  ? Omit<Event, 'snapshot'> & {readonly snapshot: SessionTransportSnapshot}
  : never;

export type SessionTransportEvent = WithSessionSnapshot<TransportEvent>
  | {readonly type: 'participants'; readonly snapshot: SessionTransportSnapshot}
  | {readonly type: 'source-error'; readonly error: unknown; readonly snapshot: SessionTransportSnapshot}
  | {readonly type: 'participant-error'; readonly error: unknown; readonly snapshot: SessionTransportSnapshot};

interface Member {
  readonly identity: object;
  readonly transport: SyncFollowerTransport;
  readonly options: SessionParticipantOptions;
  proxy: SyncFollowerTransport;
  ready: Promise<void>;
  active: boolean;
  preparing: boolean;
  attached: boolean;
  scheduling?: SessionSchedulingBinding;
  schedulingLease?: ConnectionLease;
  pendingStarts: number;
  cancellationFailed: boolean;
  cancellationError: unknown;
  prepare(): Promise<void>;
  cancelPreparationWait(): void;
  settle(): void;
}

// An inactive lease with an unresolved start retains its identity until its
// late start has been cancelled. Old cleanup cannot pause a replacement owner.
const owners = new WeakMap<object, Member>();

/**
 * A source-free conductor on Session seconds. It owns a clock and the existing
 * TransportGroup command authority, borrowing engines through leaf adapters.
 * It creates no audio resources and never elects a member as a hidden master.
 * All adapters must use the same reference clock supplied by `now`.
 */
export class SessionTransport {
  readonly #now: () => number;
  readonly #clock: TransportClock;
  readonly #reader: TransportClockReader;
  readonly #scheduling: SessionSchedulingAuthority;
  readonly scheduling: SessionSchedulingBinding;
  readonly #group: TransportGroup;
  readonly #members = new Set<Member>();
  readonly #pendingSources = new Set<SessionPendingSourceLease>();
  readonly #listeners = new Set<(event: SessionTransportEvent) => void>();
  readonly #range: Readonly<SyncLoopRegion> | null;
  readonly #leadIn: number;
  #membershipRevision = 0;
  #generation = 0;
  #ended = false;
  #disposed = false;

  constructor(now: () => number, options: SessionTransportOptions = {}) {
    this.#now = now;
    this.#clock = new TransportClock(now);
    this.#range = options.range ? Object.freeze({...options.range}) : null;
    if (this.#range && (!Number.isFinite(this.#range.startSeconds) || this.#range.startSeconds < 0
      || !Number.isFinite(this.#range.endSeconds) || this.#range.endSeconds <= this.#range.startSeconds)) {
      throw new RangeError('Session range requires finite 0 <= startSeconds < endSeconds.');
    }
    if (this.#range) this.#clock.seekTo(this.#range.startSeconds, now());
    const clock = this.#clock;
    this.#reader = Object.freeze({
      get state() { return clock.state; },
      get rate() { return clock.rate; },
      get paused() { return clock.paused; },
      get holding() { return clock.holding; },
      positionAt: (time: number) => clock.positionAt(time),
      timeAt: (position: number) => clock.timeAt(position),
    });
    this.#scheduling = new SessionSchedulingAuthority(this.#reader, now, () => this.#group ? this.#group.loop : options.loop ?? null);
    this.scheduling = this.#scheduling.createBinding('session-seconds');
    this.#leadIn = options.leadInSeconds ?? 0.06;
    this.#group = new TransportGroup({
      clock: this.#reader,
      get position() { return clock.positionAt(now()); },
      continuousLoop: true,
      invalidate: command => this.#scheduling.invalidate(command.type),
      loopChanged: (_loop, isCurrent) => { if (isCurrent?.() !== false) this.#scheduling.anchor(); },
      play: () => this.#start(),
      pause: () => { ++this.#generation; clock.pause(now()); this.#scheduling.anchor(); },
      stop: () => {
        ++this.#generation;
        this.#ended = false;
        clock.pause(now());
        clock.seekTo(this.#range?.startSeconds ?? 0, now());
        this.#scheduling.anchor();
      },
      seekPosition: (position, when, isCurrent) => {
        this.#ended = false;
        const target = this.#range
          ? Math.max(this.#range.startSeconds, Math.min(this.#range.endSeconds, position))
          : position;
        if (!clock.paused && when !== undefined) clock.startAt(when, target);
        else clock.seekTo(target, now());
        // Preserve FIFO position changes (for example seek then rate), but a
        // superseded command cannot arm native work in the newer epoch.
        if (isCurrent?.() !== false) this.#scheduling.anchor();
      },
      setRate: (rate) => { clock.setRate(rate, now()); this.#scheduling.anchor(); },
      reconcile: (time) => this.#reconcile(time),
      dispose: () => { ++this.#generation; clock.pause(now()); this.#scheduling.dispose(); },
    }, now, options);
    this.#group.subscribe((event) => this.#publish({...event, snapshot: this.#extend(event.snapshot)}));
  }

  get clock(): TransportClockReader { return this.#reader; }
  get position(): number { return this.scheduling.positionAt(this.#now()); }
  get snapshot(): SessionTransportSnapshot { return this.#extend(this.#group.snapshot); }
  get participantCount(): number { return this.#members.size; }

  holdPendingSource(): SessionPendingSourceLease {
    this.#assertActive();
    let state: 'pending' | 'failed' | 'released' = 'pending';
    let resolve!: () => void;
    let reject!: (error: unknown) => void;
    const ready = new Promise<void>((done, fail) => { resolve = done; reject = fail; });
    // Loading can fail before any play caller starts awaiting readiness.
    void ready.catch(() => {});
    const release = () => {
      if (state === 'released') return;
      state = 'released';
      this.#pendingSources.delete(lease);
      ++this.#membershipRevision;
      resolve();
      if (!this.#disposed) this.#publish({type: 'participants', snapshot: this.snapshot});
    };
    const lease: SessionPendingSourceLease = Object.freeze({
      token: Symbol('pending-source'),
      get active() { return state !== 'released'; },
      ready,
      resolve: () => { if (state === 'pending') release(); },
      reject: (error: unknown) => {
        if (state !== 'pending') return;
        state = 'failed';
        reject(error);
        ++this.#membershipRevision;
        this.#publish({type: 'source-error', error, snapshot: this.snapshot});
      },
      release,
    });
    this.#pendingSources.add(lease);
    ++this.#membershipRevision;
    this.#publish({type: 'participants', snapshot: this.snapshot});
    return lease;
  }

  subscribe(listener: (event: SessionTransportEvent) => void): () => void {
    this.#assertActive();
    const registration = (event: SessionTransportEvent) => listener(event);
    this.#listeners.add(registration);
    this.#deliver(registration, {type: 'snapshot', snapshot: this.snapshot});
    return () => { this.#listeners.delete(registration); };
  }

  register(transport: SyncFollowerTransport, options: SessionParticipantOptions): SessionParticipantLease {
    this.#assertActive();
    if (!options.axis?.trim()) throw new TypeError('A participant must name its local seconds axis.');
    readDuration(options);
    const offset = options.offsetSeconds ?? 0;
    const scale = options.positionScale ?? 1;
    if (!Number.isFinite(offset) || (offset < 0 && !options.attachScheduling) || !Number.isFinite(scale) || scale <= 0) {
      throw new RangeError('Participant mapping requires finite offsetSeconds (negative offsets need shared scheduling) and positionScale > 0.');
    }
    if (scale !== 1 && !transport.setRate && !options.attachScheduling) throw new Error('A scaled participant must support setRate.');
    if (options.loop && (!Number.isFinite(options.loop.startSeconds) || options.loop.startSeconds < 0
      || !Number.isFinite(options.loop.endSeconds) || options.loop.endSeconds <= options.loop.startSeconds)) {
      throw new RangeError('Participant loop requires finite 0 <= startSeconds < endSeconds.');
    }
    const identity = options.identity ?? transport;
    if (owners.has(identity)) throw new Error('Participant engine already has an active or settling Session lease.');
    let settle!: () => void;
    const settled = new Promise<void>((resolve) => { settle = resolve; });
    let readyResolve!: () => void;
    let readyReject!: (error: unknown) => void;
    let readyState: 'pending' | 'resolved' | 'rejected' = 'pending';
    // Readiness describes the latest attempt. A rejected attempt is replaced
    // by a fresh promise when preparation is retried, so recovery is observable.
    const deferReady = (): Promise<void> => {
      readyState = 'pending';
      const promise = new Promise<void>((resolve, reject) => {
        readyResolve = () => { if (readyState === 'pending') { readyState = 'resolved'; resolve(); } };
        readyReject = (error) => { if (readyState === 'pending') { readyState = 'rejected'; reject(error); } };
      });
      // Preparation can fail before any caller awaits readiness.
      void promise.catch(() => {});
      return promise;
    };
    const ready = deferReady();
    let releasedResolve!: () => void;
    const released = new Promise<void>((resolve) => { releasedResolve = resolve; });
    let preparation: Promise<void> | undefined;
    const member: Member = {
      identity, transport, options: {...options, loop: options.loop ? {...options.loop} : undefined},
      proxy: transport, ready, active: true, preparing: false, attached: false,
      pendingStarts: 0, cancellationFailed: false, cancellationError: undefined, settle,
      cancelPreparationWait: () => { releasedResolve(); readyResolve(); },
      prepare: () => {
        if (!member.active) return Promise.resolve();
        if (member.preparing) return preparation!;
        if (member.attached && !member.options.prepare) return member.ready;
        member.preparing = true;
        if (readyState === 'rejected') member.ready = deferReady();
        let preparedResolve!: () => void;
        let preparedReject!: (error: unknown) => void;
        const progress = new Promise<void>((resolve, reject) => { preparedResolve = resolve; preparedReject = reject; });
        preparation = Promise.race([progress, released]);
        let prepared: Promise<void> | void;
        try { prepared = member.options.prepare?.(); } catch (error) { prepared = Promise.reject(error); }
        const task = Promise.resolve(prepared).then(async () => {
          if (member.active && !this.#clock.paused) await member.options.activate?.();
          if (member.active && !member.attached) {
            if (member.options.attachScheduling) {
              const binding = this.#scheduling.createBinding(member.options.axis, offset, scale);
              member.scheduling = binding;
              try {
                member.schedulingLease = member.options.attachScheduling(binding);
                if (!member.schedulingLease.active) throw new Error('Participant scheduling attachment was released during preparation.');
                if (!member.active) this.#cancel(member);
              } catch (error) {
                this.#scheduling.release(binding);
                member.scheduling = undefined;
                throw error;
              }
            } else this.#group.addFollower(member.proxy, member.options);
            member.attached = member.active;
          }
          readyResolve();
        }).catch((error: unknown) => {
          readyReject(error);
          throw error;
        }).finally(() => {
          try { if (!member.active) this.#cancel(member); } finally {
            member.preparing = false;
            this.#settleReleased(member);
          }
        });
        void task.then(preparedResolve, preparedReject);
        void task.catch((error: unknown) => this.#participantError(error));
        return preparation;
      },
    };
    member.proxy = {
      play: async (when) => {
        if (!member.active) return;
        ++member.pendingStarts;
        try {
          await transport.play(when);
        } catch (error) {
          if (member.active) throw error;
        } finally {
          try {
            if (!member.active) this.#cancel(member);
          } catch (error) {
            this.#participantError(error);
          } finally {
            --member.pendingStarts;
            this.#settleReleased(member);
          }
        }
      },
      pause: () => { if (member.active) transport.pause(); },
      stop: () => { if (member.active) transport.stop(); },
      seek: (position) => { if (member.active) transport.seek(position); },
      ...(transport.setRate ? {setRate: (rate: number) => { if (member.active) transport.setRate!(rate); }} : {}),
      get position() { return transport.position; },
      get running() { return transport.running; },
      get clock() { return transport.clock; },
    };
    owners.set(identity, member);
    this.#members.add(member);
    ++this.#membershipRevision;
    if (!member.options.prepare || !this.#clock.paused) void member.prepare().catch(() => {});
    this.#publish({type: 'participants', snapshot: this.snapshot});
    return Object.freeze({
      token: Symbol(options.axis),
      get active() { return member.active; },
      get ready() { return member.ready; },
      settled,
      get cancellationError() { return member.cancellationError; },
      release: () => this.#release(member),
    });
  }

  dispatch(command: TransportCommand): Promise<TransportCommit> {
    this.#assertActive();
    return this.#group.dispatch(command).then(commit => Object.freeze({...commit, snapshot: this.#extend(commit.snapshot)}));
  }
  play(): Promise<TransportCommit> { return this.dispatch({type: 'play'}); }
  pause(): Promise<TransportCommit> { return this.dispatch({type: 'pause'}); }
  stop(): Promise<TransportCommit> { return this.dispatch({type: 'stop'}); }
  seek(position: number): Promise<TransportCommit> { return this.dispatch({type: 'seek', position}); }
  setRate(rate: number): Promise<TransportCommit> { return this.dispatch({type: 'rate', rate}); }
  setLoop(loop: SyncLoopRegion | null): Promise<TransportCommit> { return this.dispatch({type: 'loop', loop}); }
  checkDrift(): number { return this.#group.checkDrift(); }

  /** Explicit resource preparation; registration alone cannot allocate audio. */
  async preload(): Promise<void> {
    this.#assertActive();
    let observed = -1;
    while (observed !== this.#membershipRevision) {
      observed = this.#membershipRevision;
      await Promise.all([
        ...[...this.#members].map((member) => member.prepare()),
        ...[...this.#pendingSources].map((source) => source.ready),
      ]);
      if (this.#disposed) return;
    }
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    ++this.#generation;
    const errors: unknown[] = [];
    for (const source of [...this.#pendingSources]) source.release();
    for (const member of [...this.#members]) {
      try { this.#release(member); } catch (error) { errors.push(error); }
    }
    try { this.#group.dispose(); } catch (error) { errors.push(error); }
    this.#listeners.clear();
    if (errors.length) throw errors[0];
  }

  async #start(): Promise<void> {
    const generation = ++this.#generation;
    const epoch = this.#scheduling.epoch;
    // New members may arrive during preparation; include them before anchoring.
    await this.preload();
    let observed = -1;
    while (!this.#disposed && generation === this.#generation && observed !== this.#membershipRevision) {
      observed = this.#membershipRevision;
      await Promise.all([...this.#members].map(async member => {
        if (!member.active) return;
        ++member.pendingStarts;
        try { await member.options.activate?.(); } finally {
          --member.pendingStarts;
          if (!member.active) this.#settleReleased(member);
        }
      }));
      if (observed !== this.#membershipRevision) await this.preload();
    }
    if (this.#disposed || generation !== this.#generation) return;
    const time = this.#now();
    const position = this.#ended ? this.#range?.startSeconds ?? 0 : this.#clock.positionAt(time);
    this.#ended = false;
    this.#clock.startAt(time + this.#leadIn, position);
    // A queued newer seek/rate/loop command owns the next scheduling commit.
    // The clock may be prepared for it, but old play work must not arm voices.
    if (epoch === this.#scheduling.epoch) this.#scheduling.anchor();
  }

  #release(member: Member): void {
    if (owners.get(member.identity) !== member) return;
    if (member.active) {
      member.active = false;
      this.#members.delete(member);
      this.#group.removeFollower(member.proxy);
      ++this.#membershipRevision;
      member.cancelPreparationWait();
    } else if (!member.cancellationFailed) return;
    try { this.#cancel(member); } finally {
      this.#settleReleased(member);
      if (!this.#disposed) this.#publish({type: 'participants', snapshot: this.snapshot});
    }
  }

  #settleReleased(member: Member): void {
    if (member.active || member.preparing || member.pendingStarts > 0 || member.cancellationFailed) return;
    if (owners.get(member.identity) === member) owners.delete(member.identity);
    member.settle();
  }

  #cancel(member: Member): void {
    try {
      if (member.options.attachScheduling) {
        let failure: unknown;
        if (member.scheduling) {
          try { this.#scheduling.release(member.scheduling); } catch (error) { failure = error; }
          member.scheduling = undefined;
        }
        try { member.schedulingLease?.release(); } catch (error) { failure ??= error; }
        if (failure) throw failure;
      } else member.transport.pause();
      member.cancellationFailed = false;
      member.cancellationError = undefined;
    } catch (error) {
      member.cancellationFailed = true;
      member.cancellationError = error;
      throw error;
    }
  }

  #participantError(error: unknown): void {
    if (!this.#disposed) this.#publish({type: 'participant-error', error, snapshot: this.snapshot});
  }

  #duration(): number | null {
    if (this.#pendingSources.size > 0) return null;
    if (this.#range) return this.#range.endSeconds;
    if (!this.#members.size) return null;
    let duration = 0;
    let unknown = false;
    for (const {options} of this.#members) {
      const local = readDuration(options);
      if (local === Infinity || options.loop) return Infinity;
      if (local === null) { unknown = true; continue; }
      duration = Math.max(duration, (local - (options.offsetSeconds ?? 0)) / (options.positionScale ?? 1));
    }
    return unknown ? null : duration;
  }

  #reconcile(time: number): 'ok' | 'stalled' {
    if (this.#pendingSources.size > 0) return 'ok';
    if (this.#clock.paused || this.#group.loop || this.#clock.holding && time < this.#clock.state.originTime) return 'ok';
    const position = this.#clock.positionAt(time);
    const duration = this.#duration();
    const complete = this.#range ? position >= this.#range.endSeconds
      : duration !== null && Number.isFinite(duration) && this.#members.size > 0
        && [...this.#members].every(({options, preparing}) => !preparing && (options.endPolicy === 'position'
          ? position * (options.positionScale ?? 1) + (options.offsetSeconds ?? 0) >= readDuration(options)!
          : options.ended?.() === true));
    if (!complete) return 'ok';
    this.#ended = true;
    const epoch = this.#scheduling.epoch + 1;
    this.#scheduling.invalidate();
    // Cancellation observers may replace this completion with a command or
    // dispose the Session. Only its own invalidation can still commit an end.
    if (this.#disposed || this.#scheduling.epoch !== epoch) return 'ok';
    this.#clock.pause(time);
    if (duration !== null && position > duration) this.#clock.seekTo(duration, time);
    this.#scheduling.anchor();
    // Terminal-anchor observers have the same right to restart or reposition.
    return !this.#disposed && this.#scheduling.epoch === epoch ? 'stalled' : 'ok';
  }

  #extend(snapshot: TransportSnapshot): SessionTransportSnapshot {
    const scheduled = [...this.#members].filter(member => member.options.attachScheduling).length;
    return Object.freeze({...snapshot, position: this.scheduling.positionAt(snapshot.referenceTime), axis: 'session-seconds', durationSeconds: this.#duration(),
      schedulingEpoch: this.#scheduling.epoch, schedulingMode: scheduled === this.#members.size ? 'shared-anchor' : scheduled === 0 ? 'legacy' : 'mixed',
      participantCount: this.#members.size, pendingSourceCount: this.#pendingSources.size,
      membershipRevision: this.#membershipRevision,
      ended: this.#ended, range: this.#range});
  }

  #publish(event: SessionTransportEvent): void {
    for (const listener of [...this.#listeners]) {
      if (!this.#listeners.has(listener)) continue;
      this.#deliver(listener, event);
      if (event.snapshot.membershipRevision !== this.#membershipRevision
        || event.snapshot.revision !== this.#group.snapshot.revision) break;
    }
  }

  #deliver(listener: (event: SessionTransportEvent) => void, event: SessionTransportEvent): void {
    try {
      const result: unknown = listener(event);
      if (result && typeof (result as PromiseLike<unknown>).then === 'function') {
        void Promise.resolve(result).catch(() => { this.#listeners.delete(listener); });
      }
    } catch { this.#listeners.delete(listener); }
  }

  #assertActive(): void {
    if (this.#disposed) throw new Error('SessionTransport has been disposed.');
  }
}

function readDuration(options: SessionParticipantOptions): number | null {
  const duration = typeof options.durationSeconds === 'function' ? options.durationSeconds() : options.durationSeconds;
  if (duration !== null && duration !== Infinity && (!Number.isFinite(duration) || duration < 0)) {
    throw new RangeError('Participant durationSeconds must be nonnegative finite seconds, null, or Infinity.');
  }
  return duration;
}

export {attachSessionAutomation, SessionLFO} from './session-modulation';
export type {SessionAutomationPoint, SessionAutomationLease, SessionAutomationOptions, SessionModulationOptions, SessionLFOOptions} from './session-modulation';
