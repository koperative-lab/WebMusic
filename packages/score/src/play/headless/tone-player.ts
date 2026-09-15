import { createTickSource, type TickSource } from "@webmusic/kernel/tick";
import {
  EventEmitter,
  expandRepeats,
  locateSeconds,
  type Note,
  type Score,
  type TimePosition,
} from "../../core";
import type { SynthBackend, SynthOwnership } from "./audio-contracts";
import {
  ScoreTimeline,
  type ScheduledScoreNote,
} from "./score-timeline";
import {
  emitPlaybackEvent,
  emitPlaybackOperationError,
  type PlaybackListenerError,
  type PlaybackOperationError,
} from "./playback-events";

const SHARED_SCHEDULE_LEAD_SECONDS = 0.02;

/**
 * How far ahead of the transport entries are installed, and how often the
 * window is extended. Installing the whole remaining score up front made every
 * pause, seek and tempo change an O(score) teardown and rebuild — two
 * transport callbacks and a voice record per note, cleared one id at a time.
 * A window bounds all of that by the horizon instead of the score length,
 * while staying far enough ahead that Tone's own audio lookahead never
 * reaches an unscheduled note.
 */
const SCHEDULE_HORIZON_SECONDS = 2;
const SCHEDULE_PUMP_INTERVAL_MS = 100;

/**
 * Minimal structural type for the bits of Tone.js we touch. Tone is an
 * (optional) peer dependency that is *injected* — never statically imported —
 * so `@webmusic/score/play` builds and type-checks without it installed.
 */
export interface ToneTransportLike {
  bpm: { value: number };
  seconds: number;
  state: "started" | "stopped" | "paused" | string;
  start(time?: number | string, offset?: number | string): unknown;
  pause(time?: number | string): unknown;
  stop(time?: number | string): unknown;
  schedule(callback: (time: number) => void, time: number | string): number;
  clear(id: number): unknown;
  cancel(after?: number | string): unknown;
  /**
   * Tone.Transport emits these lifecycle events. They are optional so minimal
   * injected test/custom transports remain valid; without them, callers use
   * {@link TonePlayer.rearmSharedTransport} after an external reset.
   */
  on?(
    event: "start" | "pause" | "stop",
    callback: (time: number) => void,
  ): unknown;
  off?(
    event: "start" | "pause" | "stop",
    callback: (time: number) => void,
  ): unknown;
}

export interface ToneLike {
  /** Resumes the AudioContext — must be called from a user gesture. */
  start(): Promise<void>;
  /**
   * Current AudioContext time (provided by the Tone.js namespace). It is
   * optional only to keep structural test/custom adapters source-compatible;
   * a real Tone namespace exposes it and lets lifecycle cleanup release an
   * already-fired voice at the correct audio-clock instant.
   */
  now?(): number;
  /** Tone v15 context fallback for adapters that do not expose `now()` directly. */
  getContext?(): { now?: () => number };
  /** Tone v15+. */
  getTransport?(): ToneTransportLike;
  /** Tone v14 fallback. */
  Transport?: ToneTransportLike;
}

/** Whether a TonePlayer may control the injected global Tone.Transport. */
export type ToneTransportOwnership = "shared" | "owned";

/** Events actually emitted by {@link TonePlayer}. */
export interface TonePlayerEvents {
  cursor: TimePosition;
  noteOn: Note;
  noteOff: Note;
  end: Score;
  operationError: PlaybackOperationError;
  listenerError: PlaybackListenerError;
}

/**
 * Options supported by {@link TonePlayer}.
 *
 * This adapter deliberately does not accept ScorePlayer-only scheduler, graph,
 * effect, loop, or cursor-cadence options. The caller owns the injected Tone
 * graph. Transport control remains owned by this adapter by default for
 * compatibility; a host-owned global clock must opt into
 * `transportOwnership: "shared"`.
 */
export interface TonePlayerOptions {
  /** The Tone.js namespace (e.g. `import * as Tone from 'tone'`). */
  tone: ToneLike;
  /** Optional synth backend. An injected backend is borrowed and left untouched by default. */
  synth?: SynthBackend;
  synthOwnership?: SynthOwnership;
  /**
   * Ownership of the injected Tone.Transport. The default `owned` mode keeps
   * the historic self-contained transport controls. Use `shared` when the host
   * already owns Tone.Transport: it only installs and clears this player's
   * schedule entries and never starts, pauses, stops, or rewinds that clock.
   */
  transportOwnership?: ToneTransportOwnership;
  /** Override the initial score tempo while retaining internal tempo changes. */
  tempo?: number;
  /** Expand playback repeats into a linear score before scheduling. */
  expandRepeats?: boolean;
}

interface ScheduledToneNote {
  entry: ScheduledScoreNote;
  generation: number;
  /** Clipped logical start/end in this player's rate-scaled transport seconds. */
  startSeconds: number;
  endSeconds: number;
  /** Set only after this particular scheduled occurrence has fired. */
  voice?: ActiveToneVoice;
  fired: boolean;
  released: boolean;
}

/** One concrete Tone-triggered attack, bound to the synth that created it. */
interface ActiveToneVoice {
  scheduled: ScheduledToneNote;
  /** The backend at attack time; `setSynth()` must never steal its release. */
  synth?: SynthBackend;
  handle: unknown;
  /** Absolute Tone/Web Audio timestamp supplied to the attack callback. */
  onsetTime: number;
}

/**
 * Sample-accurate player backed by `Tone.Transport`.
 *
 * Unlike the zero-dependency {@link Player} (which schedules with setTimeout
 * and is meant for headless/testing use), this routes every note through the
 * Web Audio lookahead clock, so the `time` handed to a {@link SynthBackend} is
 * a precise AudioContext timestamp rather than wall-clock — no setTimeout
 * jitter. It implements the rate-aware `PlaybackTransport` surface used by
 * drivers, but it is not a full `ScorePlayer` substitute: loop controls and
 * the ScorePlayer timeupdate lifecycle remain intentionally unavailable.
 *
 * Notes are scheduled at absolute seconds (tempo already folded in by the
 * score's TimeMap); a user tempo override scales those seconds rather than
 * `Transport.bpm`, keeping internal tempo changes intact.
 */
export class TonePlayer {
  private readonly emitter = new EventEmitter<TonePlayerEvents>();
  private readonly score: Score;
  private readonly timeline: ScoreTimeline;
  private readonly tone: ToneLike;
  private readonly transport: ToneTransportLike;
  private readonly transportOwnership: ToneTransportOwnership;
  private synth?: SynthBackend;
  private synthOwnership: SynthOwnership = "owned";
  private tempoScale = 1;
  private scheduledIds: number[] = [];
  private rafId?: number;
  private scheduled = false;
  /** Invalidates stale Tone lookahead callbacks after a transport rebuild. */
  private scheduleGeneration = 0;
  /** Index into the sorted timeline of the next entry to install. */
  private scheduleCursor = 0;
  /** The affine mapping the current schedule pass installs entries through. */
  private schedulePass?: { position: number; anchor: number; generation: number };
  /** Extends the schedule window; worker-backed so a hidden tab stays fed. */
  private scheduleTicker?: TickSource;
  /**
   * Invalidates an asynchronous `tone.start()` continuation. Transport intent
   * and Tone's context-unlock promise are separate lifetimes: pausing,
   * stopping, rearming, or disposing while the browser is still resolving the
   * unlock must prevent that older continuation from installing a schedule or
   * controlling the injected transport.
   */
  private playGeneration = 0;
  /** Synchronous commands can be superseded by callbacks while releasing voices. */
  private operationGeneration = 0;
  private readonly activeVoices = new Set<ActiveToneVoice>();
  /** Best available fallback for minimal custom Tone adapters without `now()`. */
  private lastAudioTime = 0;
  /** Shared-mode local position retained while this player's pass is paused. */
  private sharedPositionSeconds = 0;
  /** Global Tone.Transport seconds corresponding to `sharedPositionSeconds`. */
  private sharedAnchorTransportSeconds = 0;
  /** This player has an armed shared-mode schedule, independent of Transport state. */
  private sharedPlaying = false;
  /** Whether this injected transport can notify us about host lifecycle changes. */
  private observesSharedTransport = false;
  private disposed = false;
  private readonly onSharedTransportStart = (): void => {
    // A host can arm this player before starting its global clock. Start the
    // visual cursor only once the caller-owned transport actually runs.
    if (this.sharedPlaying && this.scheduled) this.startCursor();
  };
  private readonly onSharedTransportPause = (): void => {
    this.invalidatePendingPlay();
    if (this.sharedPlaying) this.disarmSharedTransport(false, true);
  };
  private readonly onSharedTransportStop = (): void => {
    this.invalidatePendingPlay();
    if (this.sharedPlaying || this.scheduled) this.disarmSharedTransport(true, true);
  };

  constructor(score: Score, opts: TonePlayerOptions) {
    this.score = opts.expandRepeats ? expandRepeats(score) : score;
    this.timeline = new ScoreTimeline(this.score);
    this.tone = opts.tone;
    this.transport = resolveTransport(opts.tone);
    this.transportOwnership = opts.transportOwnership ?? "owned";
    this.synth = opts.synth;
    this.synthOwnership = opts.synth
      ? (opts.synthOwnership ?? "borrowed")
      : "owned";
    if (opts.tempo) this.setTempo(opts.tempo);
    if (this.transportOwnership === "shared") this.observeSharedTransport();
  }

  async play(): Promise<void> {
    if (this.disposed) throw new Error("TonePlayer has been disposed.");
    this.operationGeneration += 1;
    const generation = ++this.playGeneration;
    if (this.transportOwnership === "shared") {
      if (this.sharedPlaying) {
        if (!this.scheduled) {
          this.sharedPositionSeconds = this.currentSharedSeconds();
          this.scheduleSharedAt(this.sharedPositionSeconds);
          if (this.transport.state === "started") this.startCursor();
        }
        return;
      }
      if (!(await this.unlockForPlay(generation))) return;
      this.sharedPlaying = true;
      this.scheduleSharedAt(this.sharedPositionSeconds);
      if (this.transport.state === "started") this.startCursor();
      return;
    }

    // An explicitly owned player can attach after the transport was already
    // started, but still must install its own entries rather than silently
    // returning with no score scheduled.
    if (this.transport.state === "started") {
      if (!this.scheduled) this.scheduleOwnedAtCurrentPosition();
      this.startCursor();
      return;
    }
    if (!(await this.unlockForPlay(generation))) return;
    if (!this.scheduled) this.scheduleOwnedAtCurrentPosition();
    this.transport.start();
    this.startCursor();
  }

  pause(): void {
    if (this.disposed) return;
    const operation = ++this.operationGeneration;
    this.invalidatePendingPlay();
    if (this.transportOwnership === "shared") {
      this.disarmSharedTransport(false, false);
      return;
    }
    const paused = this.tryBackendCall("transport.pause", () => {
      this.transport.pause();
    });
    if (!this.isCurrentOperation(operation)) return;
    const hadSchedule = this.scheduled;
    this.clearScheduleAndReleaseVoices(this.audioNow(), true);
    if (!this.isCurrentOperation(operation)) return;
    // Tone may already have invoked a lookahead callback before pause(). Rebuild
    // only this player's entries so an old queued callback cannot attack after
    // the transport resumes.
    if (paused && hadSchedule) this.scheduleOwnedAtCurrentPosition();
    if (!this.isCurrentOperation(operation)) return;
    this.stopCursor();
  }

  /** Stop and rewind to the start. */
  stop(): void {
    if (this.disposed) return;
    const operation = ++this.operationGeneration;
    this.invalidatePendingPlay();
    if (this.transportOwnership === "shared") {
      this.disarmSharedTransport(true, true);
      return;
    }
    this.clearScheduleAndReleaseVoices(this.audioNow(), true);
    if (!this.isCurrentOperation(operation)) return;
    this.tryBackendCall("transport.stop", () => this.transport.stop());
    if (!this.isCurrentOperation(operation)) return;
    this.tryBackendCall("transport.seconds reset", () => {
      this.transport.seconds = 0;
    });
    if (!this.isCurrentOperation(operation)) return;
    this.stopCursor();
    this.emitCursor();
  }

  seek(seconds: number): void {
    if (this.disposed) return;
    const operation = ++this.operationGeneration;
    if (this.transportOwnership === "shared") {
      const wasPlaying = this.sharedPlaying;
      this.clearScheduleAndReleaseVoices(this.audioNow(), true);
      if (!this.isCurrentOperation(operation)) return;
      this.sharedPositionSeconds = Math.max(0, Math.min(this.duration, seconds));
      if (wasPlaying) this.scheduleSharedAt(this.sharedPositionSeconds);
      else this.scheduled = false;
      this.emitCursor();
      return;
    }
    // Tone.Transport itself advances in this player's rate-scaled transport
    // seconds. Do not divide a public seek value by tempoScale a second time.
    const hadSchedule = this.scheduled || this.transport.state === "started";
    this.clearScheduleAndReleaseVoices(this.audioNow(), true);
    if (!this.isCurrentOperation(operation)) return;
    this.transport.seconds = Math.max(0, Math.min(this.duration, seconds));
    if (hadSchedule) this.scheduleOwnedAtCurrentPosition();
    this.emitCursor();
  }

  /** Move by a rate-scaled, real-seconds delta. */
  scrub(deltaSeconds: number): void {
    this.seek(this.seconds + deltaSeconds);
  }

  /** Seek by a clamped fraction of the current rate-scaled duration. */
  seekFraction(fraction: number): void {
    this.seek(Math.max(0, Math.min(1, fraction)) * this.duration);
  }

  /**
   * Rebuild this player's entries after a host-owned transport was cancelled
   * or repositioned externally. Tone.Transport exposes lifecycle events for
   * start/pause/stop, but `cancel()` and direct `seconds` assignment are not
   * observable through the minimal injected contract. This method never
   * starts, pauses, stops, or seeks the host transport.
   *
   * Omit `positionSeconds` to preserve the current local score position; pass
   * it explicitly when the host's seek should map to a different score point.
   */
  async rearmSharedTransport(positionSeconds = this.currentSharedSeconds()): Promise<void> {
    if (this.disposed) throw new Error("TonePlayer has been disposed.");
    if (this.transportOwnership !== "shared") {
      throw new Error("rearmSharedTransport() is available only with transportOwnership: 'shared'");
    }
    const position = Math.max(0, Math.min(this.duration, positionSeconds));
    if (!this.disarmSharedTransport(false, false)) return;
    this.sharedPositionSeconds = position;
    const pending = this.play();
    const generation = this.playGeneration;
    await pending;
    if (!this.isCurrentPlay(generation)) return;
    this.emitCursor();
  }

  on<TName extends keyof TonePlayerEvents>(
    event: TName,
    cb: (payload: TonePlayerEvents[TName]) => void,
  ): () => void {
    return this.emitter.on(event, cb);
  }

  private emit<TName extends keyof TonePlayerEvents>(
    event: TName,
    payload: TonePlayerEvents[TName],
  ): void {
    emitPlaybackEvent(this.emitter, "TonePlayer", event, payload);
  }

  setTempo(bpm: number): void {
    if (this.disposed) return;
    const baseTempo = this.score.timeMap.tempi[0]?.bpm ?? 120;
    const newScale = bpm / baseTempo;
    if (!Number.isFinite(newScale) || !(newScale > 0) || newScale === this.tempoScale) return;
    const operation = ++this.operationGeneration;
    // Preserve the musical position: convert this player's rate-scaled
    // transport coordinate through the old scale and back through the new one.
    const nominalSeconds = this.seconds * this.tempoScale;
    const hadSchedule = this.scheduled || this.transport.state === "started";
    this.clearScheduleAndReleaseVoices(this.audioNow(), true);
    if (!this.isCurrentOperation(operation)) return;
    this.tempoScale = newScale;
    const nextSeconds = nominalSeconds / newScale;
    if (this.transportOwnership === "shared") {
      this.sharedPositionSeconds = nextSeconds;
      if (this.sharedPlaying) this.scheduleSharedAt(nextSeconds);
    } else {
      this.transport.seconds = nextSeconds;
      if (hadSchedule) this.scheduleOwnedAtCurrentPosition();
    }
  }

  /** Set a playback-rate scale relative to the score's initial tempo. */
  setRate(rate: number): void {
    this.setTempo(
      (this.score.timeMap.tempi[0]?.bpm ?? 120) * (rate > 0 ? rate : 1),
    );
  }

  /** Current rate relative to the score's initial tempo. */
  get rate(): number {
    return this.tempoScale;
  }

  /** Nominal score-timeline position (rate-invariant), for sync consumers. */
  get nominalSeconds(): number {
    return this.seconds * this.tempoScale;
  }

  /** Seek to a nominal score-seconds position (converts to transport seconds). */
  seekNominal(nominalSeconds: number): void {
    this.seek(nominalSeconds / this.tempoScale);
  }

  /** Current rate-scaled transport position in real seconds. */
  get seconds(): number {
    const seconds = this.transportOwnership === "shared"
      ? this.currentSharedSeconds()
      : this.transport.seconds;
    return Math.max(0, Math.min(this.duration, seconds));
  }

  /** Current rate-scaled transport duration in real seconds. */
  get duration(): number {
    return this.timeline.duration / this.tempoScale;
  }

  /** Compatibility alias for transport duration. */
  get durationSeconds(): number {
    return this.duration;
  }

  get progress(): number {
    return this.duration > 0 ? Math.min(1, this.seconds / this.duration) : 0;
  }

  isPlaying(): boolean {
    return this.transportOwnership === "shared"
      ? this.sharedPlaying && this.transport.state === "started"
      : this.transport.state === "started";
  }

  setSynth(synth: SynthBackend, ownership: SynthOwnership = "borrowed"): void {
    if (this.disposed) throw new Error("TonePlayer has been disposed.");
    const operation = ++this.operationGeneration;
    const previous = this.synth;
    const previousOwnership = this.synthOwnership;
    // A callback can be already in Tone's lookahead window. Release through
    // the backend captured at note-on before replacing the public synth.
    this.releaseActiveVoices(this.audioNow(), true);
    if (!this.isCurrentOperation(operation)) return;
    this.synth = synth;
    this.synthOwnership = ownership;
    if (previous && previous !== synth && previousOwnership === "owned") {
      this.tryBackendCall("synth.dispose", () => previous.dispose?.());
    }
  }

  get currentTime(): TimePosition {
    return locateSeconds(this.score, this.seconds * this.tempoScale);
  }

  /** Cancel transport events, stop the cursor loop, and dispose an owned synth. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.operationGeneration += 1;
    this.invalidatePendingPlay();
    const synth = this.synth;
    const synthOwnership = this.synthOwnership;
    this.synth = undefined;
    this.unobserveSharedTransport();
    this.clearSchedule();
    this.scheduleTicker?.dispose();
    this.scheduleTicker = undefined;
    this.releaseActiveVoices(this.audioNow(), true);
    this.stopCursor();
    this.scheduled = false;
    this.sharedPlaying = false;
    this.sharedPositionSeconds = 0;
    if (synthOwnership === "owned" && synth?.dispose) {
      this.tryBackendCall("synth.dispose", () => synth.dispose!());
    }
    // TonePlayer does not create a private route for an injected synth. A
    // borrowed backend can be shared with the caller's Tone graph, so even a
    // legacy no-argument disconnect would be an unsafe ownership violation.
  }

  /**
   * Schedule the immutable performed snapshot shared with ScorePlayer. This
   * makes tie merging, grace-note skipping, transposition, and recorded tails
   * identical across the two engines.
   *
   * This is the single scheduling primitive for both ownership modes. Entries
   * that end at or before `positionSeconds` are skipped, and a seek into a
   * sustained note creates one clipped attack at the local position rather
   * than scheduling its historical onset in the past — Tone.Transport never
   * fires events behind its current position, so an unclipped rebuild would
   * silently drop every note spanning the seek/resume point.
   *
   * `anchorSeconds` maps the local score position onto the transport's
   * schedule coordinates: an owned transport already advances in this player's
   * rate-scaled local seconds, so its anchor is the position itself; a shared
   * transport anchors at the caller-owned clock's current global seconds.
   */
  private scheduleFrom(positionSeconds: number, anchorSeconds: number): void {
    const position = Math.max(0, Math.min(this.duration, positionSeconds));
    const generation = ++this.scheduleGeneration;
    this.schedulePass = { position, anchor: anchorSeconds, generation };
    // Seat the cursor one maximum note duration early: an entry starting
    // before `position` can still be sounding across it, and those are the
    // notes the clip below re-attacks.
    this.scheduleCursor = this.timeline.lowerBound(
      position * this.tempoScale - this.timeline.maxNoteDuration,
    );
    this.extendSchedule(position);
    this.scheduledIds.push(
      this.transport.schedule(
        (time) => this.fireEnd(time, generation),
        anchorSeconds + Math.max(0, this.duration - position),
      ),
    );
    this.scheduled = true;
    this.startSchedulePump();
  }

  /**
   * Install every entry that starts within the horizon of `localSeconds`,
   * continuing from the cursor. The pass's `(position, anchor)` mapping is
   * affine and fixed, so a later batch lands on exactly the schedule
   * coordinates the initial one would have given it.
   */
  private extendSchedule(localSeconds: number): void {
    const pass = this.schedulePass;
    if (!pass || pass.generation !== this.scheduleGeneration) return;
    const entries = this.timeline.prepare();
    const horizon = (localSeconds + SCHEDULE_HORIZON_SECONDS) * this.tempoScale;
    while (this.scheduleCursor < entries.length) {
      const entry = entries[this.scheduleCursor];
      if (entry.start > horizon) return;
      this.scheduleCursor += 1;
      const entryStart = entry.start / this.tempoScale;
      const entryEnd = entry.end / this.tempoScale;
      if (!(entryEnd > pass.position)) continue;
      const start = Math.max(entryStart, pass.position);
      const onset = pass.anchor + (start - pass.position);
      const end = pass.anchor + (entryEnd - pass.position);
      this.scheduleEntry(entry, pass.generation, start, entryEnd, onset, end);
    }
    // The tail is installed; nothing further can enter this pass.
    this.stopSchedulePump();
  }

  /** Local, rate-scaled position the schedule window is measured against. */
  private currentLocalSeconds(): number {
    return this.transportOwnership === "shared"
      ? this.currentSharedSeconds()
      : this.transport.seconds;
  }

  private startSchedulePump(): void {
    if (this.scheduleCursor >= this.timeline.prepare().length) return;
    this.scheduleTicker ??= createTickSource({ intervalMs: SCHEDULE_PUMP_INTERVAL_MS });
    this.scheduleTicker.start(() => {
      if (this.disposed) return;
      this.extendSchedule(this.currentLocalSeconds());
    });
  }

  private stopSchedulePump(): void {
    this.scheduleTicker?.stop();
  }

  /**
   * (Re)install an owned transport's entries from its current position.
   * Play-from-start passes position 0, which clips nothing; seek, tempo
   * changes, and pause→resume clip notes spanning the current position so a
   * sustained note re-attacks instead of being silently dropped.
   */
  private scheduleOwnedAtCurrentPosition(): void {
    const position = this.transport.seconds;
    this.scheduleFrom(position, position);
  }

  /**
   * Install only this player's future segment on a caller-owned transport.
   * Timeline coordinates remain local to the player; schedule coordinates are
   * offset from the caller's current global Tone.Transport position.
   */
  private scheduleSharedAt(positionSeconds: number): void {
    const anchor = this.nextSharedAnchor();
    this.sharedAnchorTransportSeconds = anchor;
    this.scheduleFrom(positionSeconds, anchor);
  }

  private scheduleEntry(
    entry: ScheduledScoreNote,
    generation: number,
    startSeconds: number,
    endSeconds: number,
    onset: number,
    end: number,
  ): void {
    // Keep a distinct voice record for every scheduled occurrence. Two
    // overlapping C4s must not accidentally release one another by pitch.
    const scheduled: ScheduledToneNote = {
      entry,
      generation,
      startSeconds,
      endSeconds,
      fired: false,
      released: false,
    };
    this.scheduledIds.push(
      this.transport.schedule((time) => this.fireOn(scheduled, time), onset),
    );
    this.scheduledIds.push(
      this.transport.schedule(
        (time) => this.fireOff(scheduled, time),
        Math.max(onset, end),
      ),
    );
  }

  private nextSharedAnchor(): number {
    return this.transport.seconds + (
      this.transport.state === "started" ? SHARED_SCHEDULE_LEAD_SECONDS : 0
    );
  }

  private currentSharedSeconds(): number {
    if (!this.sharedPlaying) {
      return this.sharedPositionSeconds;
    }
    return this.sharedPositionSeconds + Math.max(
      0,
      this.transport.seconds - this.sharedAnchorTransportSeconds,
    );
  }

  private clearSchedule(): void {
    // Tone may already have placed a callback in its own audio lookahead.
    // `clear()` removes the transport entry, while this generation prevents a
    // callback that has escaped that queue from reaching the backend.
    this.scheduleGeneration += 1;
    this.schedulePass = undefined;
    this.stopSchedulePump();
    const ids = this.scheduledIds;
    this.scheduledIds = [];
    for (const id of ids) {
      this.tryBackendCall("transport.clear", () => this.transport.clear(id));
    }
  }

  /** Release and remove only this shared player's resources, never the host clock. */
  private disarmSharedTransport(resetPosition: boolean, emitCursor: boolean): boolean {
    if (this.disposed) return false;
    const operation = ++this.operationGeneration;
    this.invalidatePendingPlay();
    const position = resetPosition ? 0 : this.currentSharedSeconds();
    this.clearScheduleAndReleaseVoices(this.audioNow(), true);
    if (!this.isCurrentOperation(operation)) return false;
    this.scheduled = false;
    this.sharedPlaying = false;
    this.sharedPositionSeconds = position;
    this.stopCursor();
    if (emitCursor) this.emitCursor();
    return this.isCurrentOperation(operation);
  }

  /** Resume Tone's context only for the still-current playback intent. */
  private async unlockForPlay(generation: number): Promise<boolean> {
    try {
      await this.tone.start();
    } catch (error) {
      // A rejected browser unlock still belongs to its caller while current.
      // Once pause/stop/dispose supersedes it, it is a cancelled operation and
      // must not surface later as an unrelated unhandled rejection.
      if (!this.isCurrentPlay(generation)) return false;
      throw error;
    }
    return this.isCurrentPlay(generation);
  }

  private isCurrentPlay(generation: number): boolean {
    return !this.disposed && generation === this.playGeneration;
  }

  private isCurrentOperation(generation: number): boolean {
    return !this.disposed && generation === this.operationGeneration;
  }

  private invalidatePendingPlay(): void {
    this.playGeneration += 1;
  }

  /** Subscribe only when the caller's injected transport supports cleanup too. */
  private observeSharedTransport(): void {
    if (
      typeof this.transport.on !== "function" ||
      typeof this.transport.off !== "function"
    ) {
      return;
    }
    try {
      this.transport.on("start", this.onSharedTransportStart);
      this.transport.on("pause", this.onSharedTransportPause);
      this.transport.on("stop", this.onSharedTransportStop);
      this.observesSharedTransport = true;
    } catch (error) {
      // A non-Tone structural adapter may advertise unusable event hooks. Do
      // not make the injected adapter unusable; the explicit rearm API remains
      // the safe fallback.
      this.reportOperationError("transport.observe", error);
      this.removeSharedTransportListeners();
    }
  }

  private unobserveSharedTransport(): void {
    if (!this.observesSharedTransport) return;
    this.removeSharedTransportListeners();
    this.observesSharedTransport = false;
  }

  /** Event teardown is best-effort for arbitrary structural adapters. */
  private removeSharedTransportListeners(): void {
    try {
      this.transport.off?.("start", this.onSharedTransportStart);
    } catch (error) {
      // The caller still owns its transport. A broken optional hook must not
      // make this player's dispose path throw or control that host.
      this.reportOperationError("transport.off start", error);
    }
    try {
      this.transport.off?.("pause", this.onSharedTransportPause);
    } catch (error) {
      // See the start-listener cleanup above.
      this.reportOperationError("transport.off pause", error);
    }
    try {
      this.transport.off?.("stop", this.onSharedTransportStop);
    } catch (error) {
      // See the start-listener cleanup above.
      this.reportOperationError("transport.off stop", error);
    }
  }

  private fireOn(scheduled: ScheduledToneNote, time: number): void {
    if (scheduled.generation !== this.scheduleGeneration || scheduled.released)
      return;
    this.rememberAudioTime(time);
    // A malformed/third-party transport can invoke one entry twice. One score
    // occurrence has exactly one attack and one matching release.
    if (scheduled.fired) return;
    const { entry } = scheduled;
    const now = this.audioNow();
    const logicalGateSeconds = scheduled.endSeconds - scheduled.startSeconds;
    const onsetTime = Math.max(time, now);
    const durationSeconds = logicalGateSeconds - Math.max(0, now - time);
    // Tone normally invokes callbacks ahead of their AudioContext timestamp,
    // but a starved/custom transport may be late. Preserve the score endpoint:
    // shorten a still-live gate and drop it once that endpoint has passed.
    if (!(durationSeconds > 0)) {
      scheduled.released = true;
      return;
    }
    const synth = this.synth;
    let handle: unknown;
    try {
      handle = synth?.noteOn(
        entry.midi,
        entry.velocity,
        onsetTime,
        durationSeconds,
      );
    } catch (error) {
      scheduled.released = true;
      this.reportOperationError("noteOn", error);
      return;
    }

    if (
      this.disposed ||
      scheduled.generation !== this.scheduleGeneration ||
      scheduled.released ||
      this.synth !== synth
    ) {
      scheduled.released = true;
      this.releaseUncommittedVoice(synth, handle, entry.midi, onsetTime);
      return;
    }
    const voice: ActiveToneVoice = {
      scheduled,
      synth,
      handle,
      onsetTime,
    };
    scheduled.voice = voice;
    scheduled.fired = true;
    this.activeVoices.add(voice);
    this.emit("noteOn", entry.note);
  }

  private fireOff(scheduled: ScheduledToneNote, time: number): void {
    if (
      scheduled.generation !== this.scheduleGeneration ||
      !scheduled.fired ||
      scheduled.released
    )
      return;
    this.rememberAudioTime(time);
    if (scheduled.voice) {
      this.releaseVoice(scheduled.voice, time, false);
      return;
    }
    // `fireOn()` always creates a voice, including for a missing synth. Keep
    // this defensive branch event-correct if a custom callback mutates state.
    scheduled.released = true;
    this.emit("noteOff", scheduled.entry.note);
  }

  private fireEnd(time: number, generation: number): void {
    if (this.disposed || generation !== this.scheduleGeneration) return;
    const operation = ++this.operationGeneration;
    this.rememberAudioTime(time);
    this.clearScheduleAndReleaseVoices(time, false);
    if (!this.isCurrentOperation(operation)) return;
    if (this.transportOwnership === "shared") {
      if (!this.disarmSharedTransport(true, false)) return;
      this.emit("end", this.score);
      return;
    }
    this.tryBackendCall("transport.pause", () => this.transport.pause());
    if (!this.isCurrentOperation(operation)) return;
    this.tryBackendCall("transport.seconds reset", () => {
      this.transport.seconds = 0;
    });
    if (!this.isCurrentOperation(operation)) return;
    this.stopCursor();
    this.emit("end", this.score);
  }

  /** Release/cancel every attack that has already reached Tone's callback path. */
  private releaseActiveVoices(time: number, cancelFuture: boolean): void {
    for (const voice of [...this.activeVoices]) {
      this.releaseVoice(voice, time, cancelFuture);
    }
  }

  /** Invalidate the old pass before callbacks; finish only its captured voices. */
  private clearScheduleAndReleaseVoices(time: number, cancelFuture: boolean): void {
    const voices = [...this.activeVoices];
    this.scheduled = false;
    this.clearSchedule();
    for (const voice of voices) this.releaseVoice(voice, time, cancelFuture);
  }

  /**
   * Release exactly one concrete attack through the synth that created it.
   * A backend without exact handles gets a conservative pitch release only
   * after its final overlapping same-MIDI voice has left this player.
   */
  private releaseVoice(
    voice: ActiveToneVoice,
    time: number,
    cancelFuture: boolean,
  ): void {
    if (!this.activeVoices.delete(voice)) return;
    const { scheduled, synth, handle } = voice;
    if (scheduled.voice === voice) scheduled.voice = undefined;
    if (scheduled.released) return;
    scheduled.released = true;

    this.releaseBackendVoice(
      synth,
      handle,
      scheduled.entry.midi,
      time,
      cancelFuture && time <= voice.onsetTime,
      true,
    );

    this.emit("noteOff", scheduled.entry.note);
  }

  private releaseUncommittedVoice(
    synth: SynthBackend | undefined,
    handle: unknown,
    midi: number,
    onsetTime: number,
  ): void {
    const now = this.audioNow();
    this.releaseBackendVoice(synth, handle, midi, now, now <= onsetTime, false);
  }

  private releaseBackendVoice(
    synth: SynthBackend | undefined,
    handle: unknown,
    midi: number,
    time: number,
    cancelFuture: boolean,
    respectOverlaps: boolean,
  ): void {
    if (!synth) return;
    if (
      cancelFuture &&
      handle != null &&
      synth.supportsScheduledCancellation === true &&
      typeof synth.cancelScheduledNote === "function" &&
      this.tryBackendCall("cancelScheduledNote", () => {
        synth.cancelScheduledNote!(handle, time);
      })
    ) {
      return;
    }
    if (
      handle != null &&
      synth.noteOffById &&
      this.tryBackendCall("noteOffById", () => synth.noteOffById!(handle, time))
    ) {
      return;
    }
    if (
      synth.noteOff &&
      (!respectOverlaps || !this.hasOverlappingPitch(synth, midi))
    ) {
      this.tryBackendCall("noteOff", () => synth.noteOff!(midi, time));
    }
  }

  private tryBackendCall(operation: string, callback: () => unknown): boolean {
    try {
      callback();
      return true;
    } catch (error) {
      this.reportOperationError(operation, error);
      return false;
    }
  }

  private reportOperationError(operation: string, error: unknown): void {
    emitPlaybackOperationError(this.emitter, "TonePlayer", operation, error);
  }

  private hasOverlappingPitch(synth: SynthBackend, midi: number): boolean {
    for (const active of this.activeVoices) {
      if (active.synth === synth && active.scheduled.entry.midi === midi)
        return true;
    }
    return false;
  }

  /** Best-effort AudioContext now for lifecycle calls outside Tone callbacks. */
  private audioNow(): number {
    const direct = this.tone.now?.();
    if (isAudioTime(direct)) return direct;
    const contextNow = this.tone.getContext?.().now?.();
    if (isAudioTime(contextNow)) return contextNow;
    return this.lastAudioTime;
  }

  private rememberAudioTime(time: number): void {
    if (isAudioTime(time)) this.lastAudioTime = time;
  }

  // Cursor runs on requestAnimationFrame for smooth visuals, decoupled from the
  // audio lookahead so it tracks the audible position rather than scheduled-ahead time.
  private startCursor(): void {
    if (typeof requestAnimationFrame === "undefined" || this.rafId != null) return;
    const tick = (): void => {
      // The callback has consumed this id. A host start event that arrives
      // after a stopped/paused probe must be able to schedule a new frame.
      this.rafId = undefined;
      this.emitCursor();
      const active = this.transportOwnership === "shared"
        ? this.sharedPlaying && this.transport.state === "started"
        : this.transport.state === "started";
      if (active)
        this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  private stopCursor(): void {
    if (this.rafId != null && typeof cancelAnimationFrame !== "undefined")
      cancelAnimationFrame(this.rafId);
    this.rafId = undefined;
  }

  private emitCursor(): void {
    this.emit("cursor", this.currentTime);
  }
}

function resolveTransport(tone: ToneLike): ToneTransportLike {
  const transport = tone.getTransport?.() ?? tone.Transport;
  if (!transport) {
    throw new Error(
      "Tone transport not found — pass a Tone.js v14 or v15 namespace as `tone`.",
    );
  }
  return transport;
}

function isAudioTime(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}
