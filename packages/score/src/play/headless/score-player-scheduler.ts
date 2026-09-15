import {createTickSource, type TickSource} from '@webmusic/kernel/tick';
import {TransportClock, type TransportClockReader} from '@webmusic/kernel/transport';
import {type Note, type Score} from '../../core';
import {reportPlaybackOperationFailure} from './playback-events';
import type {HeadlessSynth} from './audio-contracts';
import {assertLiveAudioContext} from './audio-utils';
import {ScoreTimeline, type ScheduledScoreNote} from './score-timeline';

type Timer = ReturnType<typeof setTimeout>;

/**
 * Floor for a re-armed release check. A suspended context leaves the remaining
 * audio-clock gate unchanged, so without a floor the re-arm would spin on a
 * zero-delay timer for as long as the interruption lasts.
 */
const SUSPENDED_RECHECK_MS = 25;

/** One score event in the current transport pass, before or after note-on. */
interface CommittedRecord {
  entry: ScheduledScoreNote;
  /** Effective (possibly seek/loop-clipped) start in nominal score seconds. */
  start: number;
  /** Effective (possibly loop-clipped) end in nominal score seconds. */
  end: number;
  /** The synth has already received an absolute, future AudioContext time. */
  clockScheduled?: boolean;
  /**
   * Absolute AudioContext time the attack belongs at. The per-record timer is
   * the fine-grained trigger; this lets the throttle-resistant tick sweep pick
   * up an attack whose timer has not fired (background-tab clamping).
   */
  audioStart?: number;
  started: boolean;
  voiceId?: number;
  on?: Timer;
  off?: Timer;
}

interface ActiveVoice {
  midi: number;
  handle: unknown;
  synth: HeadlessSynth;
}

/** A backend that can safely retract a future AudioContext-clock attack. */
interface ScheduledCancellationSynth extends HeadlessSynth {
  supportsScheduledCancellation: true;
  cancelScheduledNote(handle: unknown, time: number): void;
  noteOffById(handle: unknown, time: number): void;
}

function supportsScheduledCancellation(synth: HeadlessSynth): synth is ScheduledCancellationSynth {
  return synth.supportsScheduledCancellation === true &&
    typeof synth.cancelScheduledNote === 'function' &&
    typeof synth.noteOffById === 'function';
}

export interface ScorePlayerTransportSnapshot {
  seconds: number;
  nominalSeconds: number;
  duration: number;
  progress: number;
}

export interface ScorePlayerSchedulerHost {
  ensureAudio(): {context: AudioContext; synth: HeadlessSynth};
  /**
   * Optionally begin backend/sample preparation after the user-gesture resume.
   * A no-op preparation returns void so ordinary playback can start in the
   * same call stack; an actual pending resource returns a Promise to await.
   */
  prepareForPlayback?(): void | Promise<void>;
  getContext(): AudioContext | undefined;
  getSynth(): HeadlessSynth | undefined;
  onCursor(snapshot: ScorePlayerTransportSnapshot): void;
  onNoteOn(note: Note, occurrence: {id: number; entry: ScheduledScoreNote}): void;
  onNoteOff(note: Note, occurrence: {id: number; entry: ScheduledScoreNote}): void;
  onEnd(): void;
  /** Route contained backend failures through the owning public player. */
  onOperationError?(operation: string, error: unknown): void;
}

export interface ScorePlayerSchedulerOptions {
  cursorIntervalMs: number;
  lookaheadSeconds: number;
  schedulerIntervalMs: number;
  /** Tick source factory; defaults to the kernel worker-backed tick source. */
  createTickSource?: (intervalMs: number) => TickSource;
}

/**
 * Mutable transport and lookahead scheduling state for ScorePlayer. The public
 * player owns the audio graph and events; this class owns clocks, timers,
 * looping, rate changes and exact per-voice release.
 */
export class ScorePlayerScheduler {
  private readonly timeline: ScoreTimeline;
  /**
   * The transport anchor. Position axis is NOMINAL score seconds; `rate` is
   * the tempo scale, so transport (wall-clock) seconds are `nominal / rate`.
   * Every mutation passes the AudioContext time explicitly; while paused,
   * `state.originPosition` is the nominal resume position.
   */
  private readonly transport = new TransportClock();
  private playing = false;
  private nextIndex = 0;
  /** Steady scheduling cadence; survives background-tab timer throttling. */
  private tickSource?: TickSource;
  /** One-shot loop-boundary timer; fires the wrap at the boundary itself. */
  private schedulerTimer?: Timer;
  private readonly records = new Set<CommittedRecord>();
  /** Entries already considered in this transport pass (reset on seek/loop). */
  private readonly committedEntries = new Set<ScheduledScoreNote>();
  private lastCursorAt = 0;
  // Keep loop endpoints in nominal score seconds. The public transport API
  // accepts rate-scaled seconds, but retaining those values here would make a
  // later setRate() silently move the musical loop region.
  private loopStartNominal?: number;
  private loopEndNominal?: number;
  private readonly activeVoices = new Map<number, ActiveVoice>();
  private nextVoiceId = 1;
  private startPromise?: Promise<void>;
  private startGeneration = 0;
  /** Invalidates synchronous scheduling work when extension callbacks re-enter. */
  private transportRevision = 0;

  /** @internal Lets the event owner discard a superseded cursor notification. */
  get revision(): number {
    return this.transportRevision;
  }

  /** @internal Retained as a read-only diagnostic view for scheduler probes. */
  private get committed(): readonly CommittedRecord[] {
    return [...this.records];
  }

  constructor(
    private readonly score: Score,
    private readonly host: ScorePlayerSchedulerHost,
    private readonly options: ScorePlayerSchedulerOptions,
  ) {
    this.timeline = new ScoreTimeline(score);
  }

  /** Build and cache the immutable score snapshot before the first play. */
  prepare(): readonly Note[] {
    return this.timeline.preloadNotes;
  }

  /**
   * Coalesce simultaneous play() calls while an AudioContext is resuming. A
   * single start generation also lets pause()/stop() cancel an in-flight start.
   *
   * `when` requests a SCHEDULED start: the transport arms at that AudioContext
   * time via the kernel clock's startAt, the position holds at the resume
   * point through the pre-roll, and the lookahead pipeline places the first
   * attacks exactly at `when` — the score-side mirror of the buffer engine's
   * sample-accurate `play(when)`. A `when` already in the past (the context
   * resume or a sample preload consumed the headroom) clamps to an immediate
   * start rather than skipping material. Concurrent calls coalesce onto the
   * first pending start, including its `when`.
   */
  play(when?: number): Promise<void> {
    if (this.playing) return Promise.resolve();
    if (this.startPromise) return this.startPromise;

    const generation = ++this.startGeneration;
    const promise = this.beginPlay(generation, when);
    // Extension code can synchronously cancel this generation before
    // beginPlay returns. Avoid caching a stale promise that would swallow an
    // immediate retry until the next microtask.
    if (generation === this.startGeneration && !this.playing) {
      this.startPromise = promise;
    }
    const clear = () => {
      if (this.startPromise === promise) this.startPromise = undefined;
    };
    void promise.then(clear, clear);
    return promise;
  }

  pause(): void {
    this.cancelPendingStart();
    if (!this.playing) return;
    // Capture the position before pausing the clock: with no live context the
    // fallback `now = 0` would otherwise fold garbage into the anchor.
    const now = this.host.getContext()?.currentTime ?? 0;
    const position = this.nominalNow();
    this.transport.pause(now);
    this.transport.seekTo(this.wrapNominal(position), now);
    this.stopTicking();
    // Publish the completed transition before releasing voices: a backend or
    // noteOff listener may synchronously issue the next transport command.
    this.playing = false;
    this.committedEntries.clear();
    this.cancelRecords(true);
  }

  stop(): void {
    this.cancelPendingStart();
    this.stopTicking();
    this.playing = false;
    const now = this.host.getContext()?.currentTime ?? 0;
    this.transport.pause(now);
    this.transport.seekTo(0, now);
    this.committedEntries.clear();
    this.cancelRecords(true);
    this.emitCursor();
  }

  /**
   * Seek the transport. The returned promise settles once the transport
   * anchor is live again — immediately when paused, or after the async
   * restart (context resume, preload) when seeking during playback. Restart
   * errors are reported through the operation-error hook and do not reject.
   *
   * `when` makes the mid-playback restart a SCHEDULED one (see
   * {@link play}): the transport arms at that AudioContext time instead of
   * resuming at once, so a caller driving a second transport can have both
   * re-enter on one shared origin. It is ignored while paused — a seek never
   * starts playback — and an expired `when` resumes immediately.
   */
  seek(seconds: number, when?: number, rejectRestartFailure = false): Promise<void> {
    const wasPlaying = this.playing;
    const generation = this.startGeneration + 1;
    this.pause();
    // pause() releases voices through application callbacks. A newer command
    // issued there takes precedence over this seek's remaining work.
    if (generation !== this.startGeneration) return Promise.resolve();
    const now = this.host.getContext()?.currentTime ?? 0;
    const clamped = Math.max(0, Math.min(this.duration, seconds));
    this.transport.seekTo(this.wrapNominal(clamped * this.transport.rate), now);
    this.emitCursor();
    if (wasPlaying && generation === this.startGeneration) {
      return this.play(when).catch((error: unknown) => {
        this.reportOperationError('resume after seek', error);
        if (rejectRestartFailure) throw error;
      });
    }
    return Promise.resolve();
  }

  seekFraction(fraction: number, when?: number): Promise<void> {
    return this.seek(Math.max(0, Math.min(1, fraction)) * this.duration, when);
  }

  /**
   * Seek in nominal (unscaled) score seconds. Clamped to the score timeline;
   * the promise settles under the same contract as {@link seek}.
   */
  seekNominal(nominalSeconds: number, when?: number, rejectRestartFailure = false): Promise<void> {
    const clamped = Math.max(0, Math.min(this.timeline.duration, nominalSeconds));
    return this.seek(clamped / this.transport.rate, when, rejectRestartFailure);
  }

  scrub(deltaSeconds: number): Promise<void> {
    return this.seek(this.currentSeconds() + deltaSeconds);
  }

  setTempo(bpm: number): void {
    const baseTempo = this.score.timeMap.tempi[0]?.bpm ?? 120;
    this.applyTempoScale(bpm / baseTempo);
  }

  setRate(rate: number): void {
    this.applyTempoScale(rate > 0 ? rate : 1);
  }

  get rate(): number {
    return this.transport.rate;
  }

  /**
   * Read-only view of the owned transport clock: position axis is nominal
   * score seconds against AudioContext time, `rate` is the tempo scale.
   * Consumers can anchor against it but never re-anchor it.
   */
  get clock(): TransportClockReader {
    return this.transport;
  }

  get seconds(): number {
    return this.currentSeconds();
  }

  get nominalSeconds(): number {
    return this.nominalNow();
  }

  get duration(): number {
    return this.timeline.duration / this.transport.rate;
  }

  get progress(): number {
    const duration = this.duration;
    return duration > 0 ? Math.min(1, this.currentSeconds() / duration) : 0;
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  /**
   * Loop endpoints use the same rate-scaled transport-seconds domain as
   * seek(). They are converted to the scheduler's nominal-score clock when
   * stored, so a playback-rate change preserves the musical loop region.
   */
  setLoop(startSeconds: number, endSeconds: number): void {
    const duration = this.duration;
    const rawStart = Math.min(startSeconds, endSeconds);
    const rawEnd = Math.max(startSeconds, endSeconds);
    const start = Math.max(0, Math.min(duration, rawStart));
    const end = Math.max(0, Math.min(duration, rawEnd));
    if (!(end > start)) {
      this.clearLoop();
      return;
    }
    this.loopStartNominal = start * this.transport.rate;
    this.loopEndNominal = end * this.transport.rate;
    this.transportRevision += 1;
    this.rebuildAfterLoopChange();
  }

  clearLoop(): void {
    const changed = this.loopStartNominal != null || this.loopEndNominal != null;
    this.loopStartNominal = undefined;
    this.loopEndNominal = undefined;
    if (changed) {
      this.transportRevision += 1;
      this.rebuildAfterLoopChange();
    }
  }

  dispose(): void {
    this.cancelPendingStart();
    this.stopTicking();
    this.playing = false;
    this.committedEntries.clear();
    this.cancelRecords(true);
    this.tickSource?.dispose();
    this.tickSource = undefined;
  }

  private async beginPlay(generation: number, when?: number): Promise<void> {
    const {context} = this.host.ensureAudio();
    assertLiveAudioContext(context);
    // WebKit may expose the non-standard live `interrupted` state. Treat every
    // non-running, non-closed live state as resumable, matching Rack and
    // InteractivePlayer rather than rejecting a recoverable user gesture.
    if (context.state !== 'running') await context.resume();
    assertLiveAudioContext(context);
    if (context.state !== 'running') {
      throw new Error(`AudioContext is ${context.state} and cannot start live playback.`);
    }
    // Resume synchronously from the user gesture before awaiting remote samples
    // or worklet setup. Otherwise an async preload can lose autoplay authority.
    // Do not await a no-op hook: `await undefined` still defers playback by a
    // microtask, which makes an ordinary seek/resume needlessly asynchronous.
    const preparation = this.host.prepareForPlayback?.();
    if (preparation) await preparation;
    if (generation !== this.startGeneration || this.playing) return;

    // Preparation may take long enough for application code or the browser to
    // suspend/close the context. Never publish `playing = true` against a
    // frozen clock; a non-running live context gets one final resume.
    assertLiveAudioContext(context);
    const stateAfterPreparation = context.state as AudioContextState;
    if (stateAfterPreparation !== 'running') {
      await context.resume();
      if (generation !== this.startGeneration || this.playing) return;
      assertLiveAudioContext(context);
    }
    const readyState = context.state as AudioContextState;
    if (readyState !== 'running') {
      throw new Error(`AudioContext is ${readyState} and cannot start live playback.`);
    }

    this.timeline.prepare();
    this.playing = true;
    const now = context.currentTime;
    const resumeNominal = this.wrapNominal(this.transport.state.originPosition);
    if (when !== undefined && when > now) {
      // Arm the scheduled start. The lookahead pipeline needs no special
      // casing: positionAt() holds at the resume position through the
      // pre-roll and timeAt() maps it to the armed origin, so scheduleOn()
      // hands the backend audio timestamps at/after `when` by construction.
      // pause() during the pre-roll cancels the pending start and the kernel
      // clock folds the held position back into the anchor, so nothing is
      // lost or skipped.
      this.transport.startAt(when, resumeNominal);
    } else {
      // No `when`, or one that has already passed: start immediately at the
      // resume position instead of dropping the material before `now`.
      this.transport.start(now, resumeNominal);
    }
    this.beginTransportPass(resumeNominal);
    this.lastCursorAt = now - this.options.cursorIntervalMs / 1000;
    // Start the cadence before the synchronous first tick: a zero-length
    // timeline finishes inside that tick and must leave the source stopped.
    this.ensureTickSource().start(() => this.scheduleTick());
    this.scheduleTick();
  }

  private cancelPendingStart(): void {
    // play() enters beginPlay() before it can publish startPromise. Graph and
    // preload extension hooks are allowed to re-enter pause()/stop()
    // synchronously, so generation invalidation cannot depend on that cache
    // already being assigned.
    this.startGeneration += 1;
    this.transportRevision += 1;
    this.startPromise = undefined;
  }

  private applyTempoScale(scale: number): void {
    if (!(Number.isFinite(scale) && scale > 0) || scale === this.transport.rate) return;
    if (this.playing && this.host.getContext()) {
      this.retune(scale);
      return;
    }
    // While paused the clock position is anchor-constant, so a bare rate
    // change preserves the nominal position; re-wrap it into any loop region.
    const now = this.host.getContext()?.currentTime ?? 0;
    this.transportRevision += 1;
    this.transport.setRate(scale, now);
    this.transport.seekTo(this.wrapNominal(this.transport.state.originPosition), now);
  }

  /** Re-anchor pending work and every active release at a new rate. */
  private retune(scale: number): void {
    const context = this.host.getContext();
    if (!context) {
      // Defensive: applyTempoScale guards the context. Re-anchoring at the
      // origin time keeps the frozen nominal position across the rate change.
      this.transport.setRate(scale, this.transport.state.originTime);
      return;
    }

    const now = context.currentTime;
    const scorePosition = this.nominalNow();
    const revision = ++this.transportRevision;
    this.clearSchedulerTimer();

    // Future starts are tied to the old clock and must be built again. Keep
    // sounding voices, then move their exact release to the new clock.
    for (const record of [...this.records]) {
      if (!record.started) {
        this.committedEntries.delete(record.entry);
        this.cancelRecord(record, false, now);
        if (revision !== this.transportRevision) return;
      }
    }

    this.transport.setRate(scale, now);
    // A bare setRate would re-anchor at the unclamped position; the explicit
    // seek keeps the duration clamp applied by nominalNow().
    this.transport.seekTo(scorePosition, now);

    const segmentEnd = this.segmentEndNominal();
    for (const record of [...this.records]) {
      record.end = Math.min(record.entry.end, segmentEnd);
      if (record.end <= scorePosition) {
        this.cancelRecord(record, true, now);
      } else {
        this.retimeVoice(
          record.voiceId,
          now + (record.end - scorePosition) / this.transport.rate,
        );
        if (revision !== this.transportRevision) return;
        this.scheduleOff(record, now, scorePosition);
      }
      if (revision !== this.transportRevision) return;
    }

    // Revisit the active-duration window safely: committedEntries prevents a
    // duplicate attack while allowing an uncommitted event exactly at `now`.
    this.nextIndex = this.timeline.lowerBound(scorePosition - this.timeline.maxNoteDuration);
    this.emitCursor();
    if (revision === this.transportRevision) this.scheduleTick();
  }

  /**
   * Rebuild the scheduling pass after the loop region changed, mirroring
   * {@link retune}: only the commitments the edit actually invalidates are
   * dropped. Releasing every voice would retrigger each sounding note's
   * envelope and churn a spurious noteOff/noteOn pair through the public
   * events — and LoopPlayer's loopIn/loopOut setters land here on every drag.
   */
  private rebuildAfterLoopChange(): void {
    if (!this.playing) return;
    const context = this.host.getContext();
    if (!context) return;
    const now = context.currentTime;
    const revision = this.transportRevision;
    this.clearSchedulerTimer();

    const currentNominal = this.nominalNow();
    const resumeNominal = this.wrapNominal(currentNominal);
    // A new region that does not contain the playhead moves it. That is a
    // jump, not a re-clip: nothing currently sounding belongs at the
    // destination, so the pass restarts from scratch there.
    const moved = resumeNominal !== currentNominal;

    // Future commitments were built against the old segment either way.
    for (const record of [...this.records]) {
      if (!record.started) {
        this.committedEntries.delete(record.entry);
        this.cancelRecord(record, false, now);
        if (revision !== this.transportRevision) return;
      }
    }
    if (moved) this.cancelRecords(true, now);
    if (revision !== this.transportRevision) return;

    this.transport.seekTo(resumeNominal, now);

    if (moved) {
      this.beginTransportPass(resumeNominal);
      this.scheduleTick();
      return;
    }

    // In place: keep the sounding voices, re-clip them to the new segment and
    // move their exact release. `committedEntries` is deliberately NOT cleared
    // — it is what stops the next tick re-attacking a note already sounding.
    const segmentEnd = this.segmentEndNominal();
    for (const record of [...this.records]) {
      record.end = Math.min(record.entry.end, segmentEnd);
      if (record.end <= resumeNominal) {
        this.cancelRecord(record, true, now);
      } else {
        this.retimeVoice(record.voiceId, now + (record.end - resumeNominal) / this.transport.rate);
        if (revision !== this.transportRevision) return;
        this.scheduleOff(record, now, resumeNominal);
      }
      if (revision !== this.transportRevision) return;
    }
    this.nextIndex = this.timeline.lowerBound(resumeNominal - this.timeline.maxNoteDuration);
    this.scheduleTick();
  }

  private scheduleTick(): void {
    const context = this.host.getContext();
    if (!this.playing || !context) return;
    const now = context.currentTime;

    if (this.loopEndNominal != null && this.transport.positionAt(now) >= this.loopEndNominal) {
      this.wrapLoop(now);
      // The wrap emits a cursor, and application code is allowed to pause or
      // stop the player from that notification. Everything below this point
      // reads the clock through timeAt(), which throws on a paused clock —
      // and the throw would unwind into the tick source's callback.
      if (!this.playing) return;
    }

    const nominalPosition = this.nominalNow();
    const revision = this.transportRevision;
    const resumeNominal = this.transport.state.originPosition;
    const segmentEnd = this.segmentEndNominal();
    const horizonNominal = Math.min(
      nominalPosition + this.options.lookaheadSeconds * this.transport.rate,
      segmentEnd,
    );
    const notes = this.timeline.prepare();

    while (this.nextIndex < notes.length) {
      const entry = notes[this.nextIndex];
      // A loop is half-open: an attack at loopEnd belongs to neither pass.
      if (entry.start >= segmentEnd || entry.start > horizonNominal) break;
      this.nextIndex += 1;
      if (this.committedEntries.has(entry) || entry.end <= resumeNominal) continue;
      this.committedEntries.add(entry);
      this.commitNote(entry, resumeNominal, segmentEnd, now);
      // A backend's noteOn is third-party code and may have stopped the
      // transport from under this pass; the next commit would read a frozen
      // clock.
      if (!this.playing || revision !== this.transportRevision) return;
    }

    this.startDueRecords(now);
    if (!this.playing || revision !== this.transportRevision) return;

    if (now - this.lastCursorAt >= this.options.cursorIntervalMs / 1000) {
      this.emitCursor();
      // Same contract as the wrap above: a cursor listener may have paused us.
      if (!this.playing || revision !== this.transportRevision) return;
      this.lastCursorAt = now;
    }

    if (
      this.loopEndNominal == null &&
      this.nextIndex >= notes.length &&
      this.records.size === 0 &&
      nominalPosition >= this.timeline.duration
    ) {
      this.finish();
      return;
    }

    this.armBoundaryTimer(now);
  }

  /**
   * Rescue attacks whose per-record timer was starved. Main-thread timers are
   * clamped to >=1s in a hidden tab (and to once a minute under intensive
   * throttling), which is exactly the starvation the worker-backed tick source
   * exists to avoid — but the attack itself still crossed a `setTimeout`.
   * Backends that accept a future AudioContext timestamp sound on time
   * regardless (only their note-on event waits); for every other synth this
   * sweep is what actually plays the note, bounding the worst case at one tick
   * interval instead of the throttled timer grid.
   *
   * The margin keeps the timer the primary trigger: only a record whose onset
   * passed a whole tick ago is late enough to prove its timer did not fire, so
   * ordinary foreground scheduling keeps its existing timing exactly.
   */
  private startDueRecords(now: number): void {
    const revision = this.transportRevision;
    const lateBy = now - this.options.schedulerIntervalMs / 1000;
    for (const record of [...this.records]) {
      if (record.started || record.audioStart == null) continue;
      if (record.audioStart <= lateBy) this.startRecord(record);
      if (revision !== this.transportRevision) return;
    }
  }

  private commitNote(
    entry: ScheduledScoreNote,
    segmentStart: number,
    segmentEnd: number,
    now: number,
  ): void {
    const start = Math.max(entry.start, segmentStart);
    const end = Math.min(entry.end, segmentEnd);
    if (!(end > start)) return;

    const record: CommittedRecord = {entry, start, end, started: false};
    this.records.add(record);
    this.scheduleOn(record, now);
  }

  private scheduleOn(record: CommittedRecord, now: number): void {
    const context = this.host.getContext();
    const synth = this.host.getSynth();
    if (!context || !synth) {
      this.cancelRecord(record, false, now);
      return;
    }

    const nominalNow = this.nominalNow();
    const actualStart = Math.max(record.start, nominalNow);
    const end = Math.min(record.end, this.segmentEndNominal());
    if (!(end > actualStart)) {
      this.cancelRecord(record, false, context.currentTime);
      return;
    }

    // Re-entrant application code (a cursor listener, an earlier backend
    // callback in this same pass) may have frozen the clock between the
    // commit decision and here. timeAt() throws while paused, so retire the
    // record rather than letting the throw escape the scheduler.
    if (!this.playing || this.transport.paused) {
      this.cancelRecord(record, false, context.currentTime);
      return;
    }

    const audioStart = Math.max(context.currentTime, this.transport.timeAt(actualStart));

    if (supportsScheduledCancellation(synth)) {
      // `durationSeconds` is the logical gate, so preserve even very short
      // notes and clip unavoidable lateness instead of extending their end.
      const durationSeconds = (end - actualStart) / this.transport.rate;
      let handle: unknown;
      try {
        // This is the actual lookahead: the backend receives the future
        // AudioContext timestamp now, rather than when a JavaScript timer
        // eventually happens to wake up.
        handle = synth.noteOn(record.entry.midi, record.entry.velocity, audioStart, durationSeconds);
      } catch (error) {
        this.reportOperationError('noteOn', error);
        this.cancelRecord(record, false, context.currentTime);
        return;
      }

      // noteOn() is third-party code and may synchronously stop/dispose the
      // player. Never publish or retain a voice after its record/synth owner
      // was invalidated while the backend call was on the stack.
      if (
        !this.records.has(record) ||
        !this.playing ||
        this.host.getSynth() !== synth
      ) {
        this.releaseUncommittedVoice(
          synth,
          record.entry.midi,
          handle,
          context.currentTime,
          true,
        );
        return;
      }

      // A backend which opted in but did not return a handle violated the
      // contract. Fail closed for player events rather than inventing a MIDI
      // note-off which could affect another overlapping voice.
      if (handle == null) {
        this.cancelRecord(record, false, context.currentTime);
        return;
      }

      record.start = actualStart;
      record.end = end;
      record.clockScheduled = true;
      const voiceId = this.nextVoiceId++;
      record.voiceId = voiceId;
      this.activeVoices.set(voiceId, {midi: record.entry.midi, handle, synth});
    }

    record.audioStart = audioStart;
    const timer = setTimeout(() => {
      if (record.on === timer) record.on = undefined;
      this.startRecord(record);
    }, Math.max(0, (audioStart - now) * 1000));
    record.on = timer;
  }

  private startRecord(record: CommittedRecord): void {
    // The tick sweep and the per-record timer can both reach a due attack;
    // whichever arrives first owns it.
    if (record.started || !this.records.has(record) || !this.playing) return;
    if (record.on) {
      clearTimeout(record.on);
      record.on = undefined;
    }
    const context = this.host.getContext();
    const synth = this.host.getSynth();
    if (!context || !synth) {
      this.cancelRecord(record, false, 0);
      return;
    }

    // Attack timers run on the wall clock, which keeps advancing during an
    // audio interruption. Keep both JIT attacks and public noteOn events on
    // the audio clock, just like releaseWhenDue does for note endings.
    if (context.state === 'closed') {
      this.cancelRecord(record, false, context.currentTime);
      return;
    }
    const remaining = (record.audioStart ?? context.currentTime) - context.currentTime;
    if (context.state !== 'running' || remaining > 0) {
      const timer = setTimeout(() => {
        if (record.on === timer) record.on = undefined;
        this.startRecord(record);
      }, Math.max(1, Math.min(remaining > 0 ? remaining * 1000 : SUSPENDED_RECHECK_MS, SUSPENDED_RECHECK_MS)));
      record.on = timer;
      return;
    }

    // A timer can fire just after a loop boundary. Let the boundary pass clear
    // it rather than starting an out-of-range note on the previous cycle.
    if (this.loopEndNominal != null && this.nominalNow() >= this.loopEndNominal) {
      this.scheduleTick();
      return;
    }

    const nominalNow = this.nominalNow();
    const actualStart = Math.max(record.start, nominalNow);
    const end = Math.min(record.end, this.segmentEndNominal());
    if (!(end > actualStart)) {
      this.cancelRecord(record, false, context.currentTime);
      return;
    }

    record.end = end;
    if (record.clockScheduled) {
      // The sound has already been placed on the audio clock. Keep public
      // note events tied to the logical transport onset, not to lookahead
      // commitment. Arm the logical release before invoking application code:
      // a faulty notification boundary must never strand this voice.
      record.started = true;
      this.scheduleOff(record, context.currentTime, Math.max(record.start, nominalNow));
      this.host.onNoteOn(record.entry.note, {id: record.voiceId!, entry: record.entry});
      return;
    }

    // A JIT timer can wake after the intended onset. Keep the original logical
    // endpoint by passing only the remaining gate; never invent a 10ms tail.
    const durationSeconds = (end - actualStart) / this.transport.rate;
    const audioStart = context.currentTime;
    let handle: unknown;
    try {
      handle = synth.noteOn(record.entry.midi, record.entry.velocity, audioStart, durationSeconds);
    } catch (error) {
      this.reportOperationError('noteOn', error);
      // A third-party synth must not leave the transport permanently playing.
      this.cancelRecord(record, false, context.currentTime);
      return;
    }

    if (
      !this.records.has(record) ||
      !this.playing ||
      this.host.getSynth() !== synth
    ) {
      this.releaseUncommittedVoice(
        synth,
        record.entry.midi,
        handle,
        audioStart,
        false,
      );
      return;
    }

    const voiceId = this.nextVoiceId++;
    record.started = true;
    record.voiceId = voiceId;
    this.activeVoices.set(voiceId, {midi: record.entry.midi, handle, synth});
    this.scheduleOff(record, audioStart, nominalNow);
    this.host.onNoteOn(record.entry.note, {id: voiceId, entry: record.entry});
  }

  private scheduleOff(record: CommittedRecord, now: number, nominalNow: number): void {
    if (!this.records.has(record)) return;
    if (record.off) {
      clearTimeout(record.off);
      record.off = undefined;
    }
    const remainingSeconds = (record.end - nominalNow) / this.transport.rate;
    if (!(remainingSeconds > 0)) {
      this.cancelRecord(record, true, now);
      return;
    }
    const timer = setTimeout(() => {
      if (record.off === timer) record.off = undefined;
      this.releaseWhenDue(record, now + remainingSeconds);
    }, remainingSeconds * 1000);
    record.off = timer;
  }

  /**
   * Release a record only once the AUDIO clock has actually reached its end.
   * The gate is defined on the audio clock (the backend received an absolute
   * timestamp and a duration), but the timer that wakes us runs on the wall
   * clock — and the two diverge whenever the context stops advancing: an iOS
   * audio interruption, an OS route change, an explicit suspend. Releasing on
   * timer arrival would then cut a voice that has not finished sounding, and
   * the whole committed lookahead window would be dropped at once. Re-arm
   * against the remaining audio-clock gate instead; the release lands when the
   * context resumes.
   */
  private releaseWhenDue(record: CommittedRecord, fallbackTime: number): void {
    if (!this.records.has(record)) return;
    const context = this.host.getContext();
    if (!context || !this.playing) {
      this.cancelRecord(record, true, context?.currentTime ?? fallbackTime);
      return;
    }
    const now = context.currentTime;
    const remainingSeconds = (record.end - this.nominalNow()) / this.transport.rate;
    if (!(remainingSeconds > 0)) {
      this.cancelRecord(record, true, now);
      return;
    }
    // Reaching this point at all means the wall clock already ran the full
    // gate while the audio clock did not, so the remaining gate is not a
    // usable delay — it would be re-measured against a clock that is still
    // frozen. Poll instead, which bounds how late the release lands once the
    // context resumes.
    const timer = setTimeout(() => {
      if (record.off === timer) record.off = undefined;
      this.releaseWhenDue(record, now + remainingSeconds);
    }, Math.max(1, Math.min(remainingSeconds * 1000, SUSPENDED_RECHECK_MS)));
    record.off = timer;
  }

  /**
   * Wrap to the loop start, preserving PHASE. The boundary is detected after
   * the fact (a timer or cadence tick wakes at or just past it), so restarting
   * flat at `loopStart` would discard the overshoot and fold every wake's
   * lateness into the next cycle — a loop that slips a little further behind
   * the audio clock on every pass. Folding the current position through the
   * loop region instead keeps the wrapped pass exactly as far into the loop as
   * the transport really is, so lateness stays bounded by one wake instead of
   * accumulating. (The modulo also absorbs a multi-cycle overshoot from a
   * throttled background tab in one step.)
   */
  private wrapLoop(now: number): void {
    const revision = this.transportRevision;
    this.cancelRecords(true, now);
    if (revision !== this.transportRevision) return;
    const wrapped = this.wrapNominal(this.transport.positionAt(now));
    this.transport.seekTo(wrapped, now);
    this.beginTransportPass(wrapped);
    this.emitCursor();
  }

  private beginTransportPass(nominal: number): void {
    this.transportRevision += 1;
    this.committedEntries.clear();
    this.nextIndex = this.timeline.lowerBound(nominal - this.timeline.maxNoteDuration);
  }

  private finish(): void {
    this.cancelPendingStart();
    this.stopTicking();
    this.playing = false;
    const now = this.host.getContext()?.currentTime ?? 0;
    this.transport.pause(now);
    this.transport.seekTo(0, now);
    this.committedEntries.clear();
    this.cancelRecords(true);
    this.host.onEnd();
    this.emitCursor();
  }

  private emitCursor(): void {
    const nominalSeconds = this.nominalNow();
    const seconds = nominalSeconds / this.transport.rate;
    const duration = this.duration;
    this.host.onCursor({
      seconds,
      nominalSeconds,
      duration,
      progress: duration > 0 ? Math.min(1, seconds / duration) : 0,
    });
  }

  /** Current rate-scaled transport position, in real seconds. */
  private currentSeconds(): number {
    return this.nominalNow() / this.transport.rate;
  }

  /** Current nominal score position, clamped to the timeline duration. */
  private nominalNow(): number {
    const context = this.host.getContext();
    const nominal = this.playing && context
      ? this.transport.positionAt(context.currentTime)
      : this.transport.state.originPosition;
    return Math.min(this.timeline.duration, nominal);
  }

  private segmentEndNominal(): number {
    return this.loopEndNominal ?? Number.POSITIVE_INFINITY;
  }

  /** Fold a nominal score position into the active loop region, if any. */
  private wrapNominal(nominal: number): number {
    if (this.loopStartNominal == null || this.loopEndNominal == null) return nominal;
    const span = this.loopEndNominal - this.loopStartNominal;
    if (!(span > 0)) return nominal;
    if (nominal < this.loopStartNominal) return this.loopStartNominal;
    if (nominal < this.loopEndNominal) return nominal;
    return this.loopStartNominal + ((nominal - this.loopStartNominal) % span);
  }

  private ensureTickSource(): TickSource {
    this.tickSource ??= (
      this.options.createTickSource ?? ((intervalMs) => createTickSource({intervalMs}))
    )(this.options.schedulerIntervalMs);
    return this.tickSource;
  }

  /** Stop cadence ticks and any pending boundary shot; restartable by play(). */
  private stopTicking(): void {
    this.tickSource?.stop();
    this.clearSchedulerTimer();
  }

  /**
   * The persistent tick source covers the steady cadence. Arm a one-shot
   * timer only when the loop boundary lands before the next cadence tick, so
   * the wrap is detected at the boundary rather than up to one interval late.
   */
  private armBoundaryTimer(now: number): void {
    this.clearSchedulerTimer();
    if (this.loopEndNominal == null) return;
    // A paused clock maps no reference time to a position (timeAt throws),
    // and a pause can arrive re-entrantly from any host notification in this
    // tick. Nothing to arm against a frozen transport anyway.
    if (this.transport.paused) return;
    const untilBoundaryMs = (this.transport.timeAt(this.loopEndNominal) - now) * 1000;
    if (untilBoundaryMs >= this.options.schedulerIntervalMs) return;
    this.schedulerTimer = setTimeout(() => this.scheduleTick(), Math.max(1, untilBoundaryMs));
  }

  private clearSchedulerTimer(): void {
    if (!this.schedulerTimer) return;
    clearTimeout(this.schedulerTimer);
    this.schedulerTimer = undefined;
  }

  private cancelRecords(release: boolean, time = this.host.getContext()?.currentTime ?? 0): void {
    for (const record of [...this.records]) this.cancelRecord(record, release, time);
    // cancelRecord removes each owned voice. Do not clear the whole map:
    // release callbacks may already have committed voices for a newer pass.
  }

  private cancelRecord(record: CommittedRecord, release: boolean, time: number): void {
    if (!this.records.delete(record)) return;
    if (record.on) clearTimeout(record.on);
    if (record.off) clearTimeout(record.off);
    record.on = undefined;
    record.off = undefined;

    if (record.voiceId != null) {
      if (record.clockScheduled && !record.started) {
        // A pause/seek/loop/rate change may happen after the backend accepted
        // a future timestamp but before its JS-side note-on event. Retract it
        // exactly; emitting noteOff here would describe a note the transport
        // never logically started.
        this.cancelScheduledVoice(record.voiceId, time);
      } else if (release && record.started) {
        this.releaseVoice(record.voiceId, time);
      }
    }

    if (!release || !record.started) return;
    this.host.onNoteOff(record.entry.note, {id: record.voiceId!, entry: record.entry});
    record.started = false;
  }

  private cancelScheduledVoice(voiceId: number, time: number): void {
    const voice = this.activeVoices.get(voiceId);
    if (!voice) return;
    this.activeVoices.delete(voiceId);
    this.releaseBackendVoice(voice, time, true);
  }

  private releaseVoice(voiceId: number, time: number): void {
    const voice = this.activeVoices.get(voiceId);
    if (!voice) return;
    this.activeVoices.delete(voiceId);
    this.releaseBackendVoice(voice, time, false);
  }

  private releaseBackendVoice(
    voice: ActiveVoice,
    time: number,
    preferCancellation: boolean,
  ): void {
    const {synth, handle, midi} = voice;
    if (
      preferCancellation &&
      handle != null &&
      supportsScheduledCancellation(synth) &&
      this.tryBackendCall('cancelScheduledNote', () => {
        synth.cancelScheduledNote(handle, time);
      })
    ) {
      return;
    }
    if (
      handle != null &&
      synth.noteOffById &&
      this.tryBackendCall('noteOffById', () => synth.noteOffById!(handle, time))
    ) {
      return;
    }
    // A pitch-only backend cannot distinguish overlapping C4 attacks. Keep a
    // later same-pitch voice alive until it is the final active instance.
    if (!this.hasActivePitch(midi, synth) && synth.noteOff) {
      this.tryBackendCall('noteOff', () => synth.noteOff!(midi, time));
    }
  }

  private releaseUncommittedVoice(
    synth: HeadlessSynth,
    midi: number,
    handle: unknown,
    time: number,
    preferCancellation: boolean,
  ): void {
    if (
      preferCancellation &&
      handle != null &&
      supportsScheduledCancellation(synth) &&
      this.tryBackendCall('cancelScheduledNote', () => {
        synth.cancelScheduledNote(handle, time);
      })
    ) {
      return;
    }
    if (
      handle != null &&
      synth.noteOffById &&
      this.tryBackendCall('noteOffById', () => synth.noteOffById!(handle, time))
    ) {
      return;
    }
    if (synth.noteOff) {
      this.tryBackendCall('noteOff', () => synth.noteOff!(midi, time));
    }
  }

  private tryBackendCall(operation: string, callback: () => void): boolean {
    try {
      callback();
      return true;
    } catch (error) {
      this.reportOperationError(operation, error);
      return false;
    }
  }

  private reportOperationError(operation: string, error: unknown): void {
    if (this.host.onOperationError) {
      this.host.onOperationError(operation, error);
      return;
    }
    // Internal scheduler probes and third-party harnesses which predate the
    // callback retain the same best-effort fallback.
    reportPlaybackOperationFailure('ScorePlayer', operation, error);
  }

  private hasActivePitch(midi: number, synth: HeadlessSynth): boolean {
    for (const voice of this.activeVoices.values()) {
      if (voice.midi === midi && voice.synth === synth) return true;
    }
    return false;
  }

  private retimeVoice(voiceId: number | undefined, time: number): void {
    if (voiceId == null) return;
    const voice = this.activeVoices.get(voiceId);
    if (!voice || voice.handle == null) return;
    if (voice.synth.retimeScheduledNote) {
      this.tryBackendCall('retimeScheduledNote', () => {
        voice.synth.retimeScheduledNote!(voice.handle, time);
      });
    }
  }
}
