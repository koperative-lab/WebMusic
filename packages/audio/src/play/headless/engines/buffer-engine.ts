// ============================================================================
// Buffer engine — plays an AudioClip through an `AudioBufferSourceNode`. Gives
// sample-accurate seek (a fresh source is started at an offset), native gapless
// looping (loopStart/loopEnd), and `playbackRate`. Best for short clips / sample
// precision / reverse. The player owns the gain→panner→effect→analyser tail;
// this engine owns only the source and exposes a single `output` node to splice
// in. Constructing it touches no audio globals — nodes are built on `start`.
// ============================================================================

import type {AudioClip} from '../../../core';
import {TransportClock, type TransportClockReader} from '@webmusic/kernel/transport';

/** The minimal contract both engines satisfy, so the player can switch freely. */
export interface PlaybackEngine {
  /** Node to connect into the player's gain stage. */
  readonly output: AudioNode;
  /** Engine-reported current position in seconds. */
  readonly currentTime: number;
  readonly duration: number;
  readonly playing: boolean;
  /**
   * Start playback. `when` is an absolute `BaseAudioContext.currentTime` at
   * which sound should begin (sample-accurate on engines that support it);
   * omitted or already past means start immediately. Engines without a
   * future-start primitive accept and ignore it.
   *
   * `offsetSeconds` positions the START only: calling `play()` on an engine
   * that is already playing is a NO-OP on every engine, offset included. Use
   * {@link seek} to move the playhead of a running engine — that is the one
   * operation defined to relocate audio that is already sounding, and the only
   * one an engine can honour without desyncing its reported position from what
   * the listener hears.
   */
  play(offsetSeconds?: number, when?: number): Promise<void> | void;
  pause(): void;
  stop(): void;
  seek(seconds: number): void;
  setRate(rate: number): void;
  setLoop(loop: boolean | {start: number; end: number}): void;
  /** Called when natural end-of-stream is reached. */
  onEnded(cb: () => void): void;
  /**
   * Materialize whatever the first `play()` would otherwise build — the
   * decoded AudioBuffer, the media element — without starting sound. Optional
   * because it is a pure optimization: an engine without it simply pays that
   * cost at start. Callers must treat it as best-effort.
   */
  prepare?(): Promise<void> | void;
  dispose(): void;
  /**
   * Read-only view of the engine's kernel transport clock, for consumers
   * that anchor against the position axis (sync bridges). Engines without
   * a sample-accurate clock (the media engine) omit it.
   */
  readonly clock?: TransportClockReader;
}

export interface BufferEngineOptions {
  loop?: boolean | {start: number; end: number};
  rate?: number;
  preservesPitch?: boolean;
}

export class BufferEngine implements PlaybackEngine {
  readonly output: GainNode;
  private readonly context: BaseAudioContext;
  private readonly clip: AudioClip;
  private buffer: AudioBuffer | null = null;
  private source: AudioBufferSourceNode | null = null;
  private loop: boolean | {start: number; end: number};

  // Position bookkeeping lives in a kernel TransportClock anchored on the
  // context clock. Its position axis is UNWRAPPED clip seconds: under loop the
  // clock keeps advancing monotonically and `currentTime` applies the
  // loop-window modulo at read. Invariant: every stop point (pause / stop /
  // seek / natural end) normalizes the paused position to the wrapped, clamped
  // value via `seekTo`, because that position feeds the next
  // `source.start(at, offset)` and a native offset past loopEnd would never
  // re-enter the loop window.
  private readonly transport = new TransportClock(() => this.context.currentTime);
  private endedCb: (() => void) | null = null;
  private disposed = false;

  constructor(context: BaseAudioContext, clip: AudioClip, options: BufferEngineOptions = {}) {
    this.context = context;
    this.clip = clip;
    // The construction rate passes through UNCLAMPED (only `setRate` applies
    // the [0.25, 4] clamp, matching the pre-clock engine). Designed change:
    // non-finite or non-positive rates — which TransportClock rejects — are
    // coerced to 1 instead of silently poisoning the position math.
    const rate = options.rate ?? 1;
    this.transport.setRate(Number.isFinite(rate) && rate > 0 ? rate : 1, 0);
    this.loop = normalizeLoopOption(options.loop ?? false, clip.duration);
    this.output = context.createGain();
  }

  /**
   * Read-only view of the engine's transport clock, for consumers (sync
   * bridges, views) that need to anchor against the position axis without
   * being able to re-anchor it. NOTE: the clock reads the UNWRAPPED position
   * under loop — it advances monotonically past the loop end; only
   * {@link currentTime} applies the loop-window modulo (the two agree modulo
   * the loop span).
   */
  get clock(): TransportClockReader {
    return this.transport;
  }

  get duration(): number {
    return this.clip.duration;
  }

  get playing(): boolean {
    return !this.transport.paused;
  }

  get currentTime(): number {
    const pos = this.transport.paused
      ? this.transport.position
      : this.wrapIntoLoop(this.transport.position);
    return this.clampToDuration(pos);
  }

  async play(offsetSeconds?: number, when?: number): Promise<void> {
    // Early-return BEFORE resolving the offset: a `play(offset)` while already
    // playing is a no-op (mutating the anchor without restarting the source
    // would silently desync position from audio).
    if (this.disposed || !this.transport.paused) return;
    const offset = this.clampToDuration(this.wrapIntoLoop(offsetSeconds ?? this.transport.position));
    this.ensureBuffer();
    this.startSource(offset, when);
  }

  /**
   * Fold a start offset back into the loop window when it sits at or past the
   * loop end. The engine's stop points already normalize the paused position
   * for exactly this reason, but a CALLER-supplied `play(offset)` or `seek`
   * bypassed them: a native `source.start(at, offset)` past loopEnd plays out
   * to the end of the buffer and never re-enters the window, so the engine
   * reported `playing` forever while nothing sounded. The shared fold lives
   * in {@link wrapIntoLoop}.
   */

  pause(): void {
    if (this.disposed || this.transport.paused) return;
    // Capture the wrapped, clamped position FIRST; `transport.pause` folds the
    // unwrapped one, and `seekTo` then normalizes per the loop invariant.
    const pos = this.currentTime;
    this.teardownSource();
    const now = this.context.currentTime;
    this.transport.pause(now);
    this.transport.seekTo(pos, now);
  }

  stop(): void {
    if (this.disposed) return;
    this.teardownSource();
    const now = this.context.currentTime;
    this.transport.pause(now);
    this.transport.seekTo(0, now);
  }

  seek(seconds: number): void {
    if (this.disposed) return;
    const target = this.clampToDuration(this.wrapIntoLoop(seconds));
    if (!Number.isFinite(target)) throw new RangeError('Seek position must be finite.');
    if (!this.transport.paused) {
      // Relocate an armed source without releasing its future start. A seek
      // changes position, not the already accepted absolute start time.
      const now = this.context.currentTime;
      const when = this.transport.holding && this.transport.state.originTime > now
        ? this.transport.state.originTime
        : now;
      this.teardownSource();
      this.transport.pause(now);
      this.transport.seekTo(target, now);
      this.startSource(target, when);
    } else {
      this.transport.seekTo(target, this.context.currentTime);
    }
  }

  setRate(rate: number): void {
    if (this.disposed) return;
    const clamped = Math.max(0.25, Math.min(4, rate));
    // The clock re-anchors so the position stays continuous — and during an
    // armed pre-roll it changes only the post-start slope, so a rate change
    // before a scheduled `when` can no longer collapse the hold.
    this.transport.setRate(clamped, this.context.currentTime);
    if (this.source) this.source.playbackRate.value = clamped;
  }

  setLoop(loop: boolean | {start: number; end: number}): void {
    if (this.disposed) return;
    const normalized = normalizeLoopOption(loop, this.duration);
    // A live loop change is a transition point, so it owes the same position
    // normalization as pause/stop/seek: `currentTime` applies the loop-window
    // modulo of the OLD bounds, and once those bounds change the clock's
    // unwrapped position no longer maps to what is sounding. Capture the
    // audible position under the old window first, then fold it back into the
    // anchor under the new one — otherwise disabling a loop after the
    // unwrapped position ran past loopEnd made the exposed reader jump to the
    // clamped duration while the source played on.
    const wasPlaying = !this.transport.paused;
    const audible = wasPlaying ? this.currentTime : undefined;
    this.loop = normalized;
    if (this.source) this.applyLoop(this.source);
    if (audible !== undefined) {
      this.transport.seekTo(audible, this.context.currentTime);
    }
  }

  onEnded(cb: () => void): void {
    if (!this.disposed) this.endedCb = cb;
  }

  /**
   * Decode the clip into its AudioBuffer now. Without this the whole-buffer
   * copy lands inside `startSource`, so the first note of a queued track
   * arrives late; `AudioClip.toAudioBuffer` caches per (clip, context), so a
   * later `play()` reuses this work.
   */
  prepare(): void {
    if (!this.disposed) this.ensureBuffer();
  }

  dispose(): void {
    if (this.disposed) return;
    // Keep the same normalized stopped position as pause before making the
    // engine terminal; future public calls cannot rebuild its resources.
    this.pause();
    this.disposed = true;
    this.endedCb = null;
    // Designed change: freeze the clock so a disposed engine's position stops
    // advancing (previously `playing` stayed stale-true after dispose).
    this.transport.pause(this.context.currentTime);
    try {
      this.output.disconnect();
    } catch {
      /* already disconnected */
    }
    this.buffer = null;
  }

  // --- internals ---

  private ensureBuffer(): void {
    if (!this.buffer) this.buffer = this.clip.toAudioBuffer(this.context);
  }

  private startSource(offset: number, when?: number): void {
    this.ensureBuffer();
    const source = this.context.createBufferSource();
    // A `when` in the future schedules a sample-accurate start on the audio
    // clock; `startAt` arms the clock at that instant so `currentTime` holds
    // at `offset` through the pre-roll window (and a rate change during the
    // pre-roll only alters the post-start slope). For immediate starts
    // `at === now`, so the hold is vacuous — `startAt` is safe unconditionally.
    const at = Math.max(when ?? 0, this.context.currentTime);
    try {
      source.buffer = this.buffer;
      source.playbackRate.value = this.transport.rate;
      this.applyLoop(source);
      source.connect(this.output);
      source.onended = () => {
        // Native `onended` fires on stop() too; only report a true end.
        if (this.source === source && !this.transport.paused && !this.loop) {
          this.source = null;
          source.onended = null;
          try {
            source.disconnect();
          } catch {
            /* already disconnected */
          }
          const now = this.context.currentTime;
          this.transport.pause(now);
          this.transport.seekTo(this.duration, now);
          this.endedCb?.();
        }
      };
      source.start(at, Math.max(0, offset));
    } catch (error) {
      source.onended = null;
      try {
        source.stop();
      } catch {
        /* source never started */
      }
      try {
        source.disconnect();
      } catch {
        /* source never connected */
      }
      throw error;
    }
    this.source = source;
    this.transport.startAt(at, offset);
  }

  private teardownSource(): void {
    if (!this.source) return;
    const s = this.source;
    this.source = null;
    s.onended = null;
    try {
      s.stop();
    } catch {
      /* not started */
    }
    try {
      s.disconnect();
    } catch {
      /* already disconnected */
    }
  }

  private applyLoop(source: AudioBufferSourceNode): void {
    if (this.loop) {
      const {start, end} = this.loopBounds();
      source.loop = true;
      source.loopStart = start;
      source.loopEnd = end;
    } else {
      source.loop = false;
    }
  }

  /**
   * Fold an unwrapped position into the loop window. Only positions AT or
   * past `loopEnd` are folded: those are the ones a native `source.start(at,
   * offset)` would never bring back inside the loop, which is exactly what
   * the loop-normalization invariant above exists to prevent (loopEnd itself
   * wraps immediately, so it folds to loopStart). A position before
   * `loopStart` is left alone — the native source plays from there into the
   * loop, which is what asking for it means.
   */
  private wrapIntoLoop(seconds: number): number {
    if (!this.loop) return seconds;
    const {start, end} = this.loopBounds();
    const span = end - start;
    if (span > 0 && seconds >= end) return start + ((seconds - start) % span);
    return seconds;
  }

  private loopBounds(): {start: number; end: number} {
    if (this.loop && typeof this.loop === 'object') {
      return {start: Math.max(0, this.loop.start), end: Math.min(this.duration, this.loop.end)};
    }
    return {start: 0, end: this.duration};
  }

  private clampToDuration(seconds: number): number {
    return Math.max(0, Math.min(this.duration, seconds));
  }
}

/** Internal option validation, intentionally absent from public entry barrels. */
export function normalizeLoopOption(
  loop: boolean | {start: number; end: number},
  duration?: number,
): boolean | {start: number; end: number} {
  if (typeof loop === 'boolean') return loop;
  const start = Math.max(0, loop.start);
  const end = loop.end;
  if (!Number.isFinite(loop.start) || !Number.isFinite(end) || end <= start ||
      (duration !== undefined && Math.min(duration, end) <= start)) {
    throw new RangeError('Loop range must have finite bounds and a positive playable span.');
  }
  // Snapshot caller-owned options so a later in-place edit cannot bypass the
  // validation or silently change an active engine's loop metadata.
  return {start, end};
}
