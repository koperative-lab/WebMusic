// ============================================================================
// LoopPlayer — a headless transport with an A–B loop region. Built on
// `ScorePlayer.setLoop()` / `clearLoop()`: arm a loop over [in, out] (fractions
// of the piece), optionally repeat a fixed number of times, then release the
// loop and play through to the end. The DOM-free counterpart of the former
// `<loop-player>` element — bring your own UI (or none).
//
//   const lp = new LoopPlayer(score, {loopIn: 0.25, loopOut: 0.75, loopCount: 4});
//   lp.player.on('timeupdate', ({transportSeconds}) => draw(transportSeconds));
//   await lp.play();
// ============================================================================

import type {Score} from '../../core';
import type {HeadlessSynth} from './audio-contracts';
import {ScorePlayer} from './score-player';
import type {Effect} from './effects';

export interface LoopPlayerOptions {
  /** Timbre passed to the internally-built `ScorePlayer`. */
  synth?: HeadlessSynth;
  /** Post-processing effect chain passed to the internally-built `ScorePlayer`. */
  effect?: Effect;
  /** Loop-in point as a fraction `0..1` of the piece. Default `0.25`. */
  loopIn?: number;
  /** Loop-out point as a fraction `0..1` of the piece. Default `0.75`. */
  loopOut?: number;
  /** Whether the A–B loop is armed. Default `true`. */
  loop?: boolean;
  /** Repeats before the loop releases and plays through (`Infinity` = forever). Default `Infinity`. */
  loopCount?: number;
}

/**
 * A {@link ScorePlayer} wrapped with A–B loop orchestration: it pushes the loop
 * region into the engine, counts finite repeats from backward transport-progress
 * jumps, and releases the loop after `loopCount` passes so the piece finishes.
 * Re-arms itself on `end`.
 */
export class LoopPlayer {
  /** The underlying push engine — subscribe to `timeupdate` / `end`, read its transport getters, etc. */
  readonly player: ScorePlayer;

  private inFrac: number;
  private outFrac: number;
  private loopOn: boolean;
  private count: number;
  private iterations = 0;
  private lastProgress = 0;
  private positionChanges = 0;
  private offs: Array<() => void> = [];

  constructor(score: Score, options: LoopPlayerOptions = {}) {
    this.inFrac = clamp01(options.loopIn ?? 0.25);
    this.outFrac = clamp01(options.loopOut ?? 0.75);
    this.loopOn = options.loop ?? true;
    this.count = options.loopCount ?? Infinity;
    this.player = new ScorePlayer(score, {synth: options.synth, effect: options.effect});
    this.offs.push(this.player.on('timeupdate', ({progress}) => this.onTransportUpdate(progress)));
    this.offs.push(this.player.on('end', () => this.onEnd()));
    this.applyLoop();
  }

  /** The piece duration in seconds. */
  get duration(): number {
    return this.player.durationSeconds;
  }

  /** Loop-in point (fraction `0..1`). */
  get loopIn(): number {
    return this.inFrac;
  }
  set loopIn(frac: number) {
    this.setLoopRegion(frac, this.outFrac);
  }

  /** Loop-out point (fraction `0..1`). */
  get loopOut(): number {
    return this.outFrac;
  }
  set loopOut(frac: number) {
    this.setLoopRegion(this.inFrac, frac);
  }

  /** Whether the A–B loop is armed. Toggling resets the repeat counter. */
  get loop(): boolean {
    return this.loopOn;
  }
  set loop(on: boolean) {
    this.loopOn = on;
    this.iterations = 0;
    this.applyLoop();
  }

  /** Repeats before the loop releases (`Infinity` = forever). Resets the counter. */
  get loopCount(): number {
    return this.count;
  }
  set loopCount(count: number) {
    this.count = count;
    this.iterations = 0;
  }

  /** Set both loop points at once (fractions `0..1`; kept ordered). */
  setLoopRegion(inFrac: number, outFrac: number): void {
    const a = clamp01(inFrac);
    const b = clamp01(outFrac);
    this.inFrac = Math.min(a, b);
    this.outFrac = Math.max(a, b);
    this.applyLoop();
  }

  /** Start playback (resumes the audio context). */
  play(): Promise<void> {
    return this.player.play();
  }

  /** Pause playback. */
  pause(): void {
    this.player.pause();
  }

  /** Seek to an absolute time in seconds. */
  seek(seconds: number): void {
    this.withPositionChange(() => {
      this.player.seek(seconds);
    });
  }

  /** Seek to a fraction `0..1` of the piece. */
  seekFraction(frac: number): void {
    this.seek(clamp01(frac) * this.duration);
  }

  /** Tear down the engine and listeners. */
  dispose(): void {
    for (const off of this.offs) off();
    this.offs = [];
    this.player.dispose();
  }

  /** Push the current loop region / on-off into the engine. */
  private applyLoop(): void {
    this.withPositionChange(() => {
      if (this.loopOn) this.player.setLoop(this.inFrac * this.duration, this.outFrac * this.duration);
      else this.player.clearLoop();
    });
  }

  /** A seek or region edit may synchronously move the underlying playhead. */
  private withPositionChange(change: () => void): void {
    this.positionChanges += 1;
    try {
      change();
    } finally {
      this.positionChanges -= 1;
      // A region edit can re-anchor without emitting until the next cursor
      // tick. Seed that tick from the new position, not the old region.
      this.lastProgress = this.player.progress;
    }
  }

  /** Detect a loop wrap from a backward jump in transport progress. */
  private onTransportUpdate(progress: number): void {
    // Transport seconds rescale when the rate changes, but progress remains
    // stable. It is therefore the safe loop-wrap signal in this time domain.
    const movedBackward = progress + 0.0001 < this.lastProgress;
    // Commit before clearLoop: rebuilding can synchronously emit another
    // cursor update, which must not count the same wrap twice.
    this.lastProgress = progress;
    if (this.positionChanges > 0) return;
    if (this.loopOn && movedBackward) {
      this.iterations += 1;
      if (this.iterations >= this.count) {
        this.iterations = 0;
        this.player.clearLoop(); // enough repeats — play through to the end
      }
    }
  }

  private onEnd(): void {
    this.iterations = 0;
    this.seek(0);
    this.lastProgress = 0;
    this.applyLoop(); // re-arm the loop for the next play
  }
}

/** Build a {@link LoopPlayer} for a score. */
export function createLoopPlayer(score: Score, options?: LoopPlayerOptions): LoopPlayer {
  return new LoopPlayer(score, options);
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}
