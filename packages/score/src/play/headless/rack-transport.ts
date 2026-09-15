import {EventEmitter} from '../../core';
import {reportPlaybackOperationFailure} from './playback-events';
import type {Rack} from './rack';
import type {ScorePlayer} from './score-player';

export interface RackTransportState {
  playing: boolean;
  progress: number;
  currentTime: number;
  duration: number;
}

export interface RackTransportEvents {
  timeupdate: RackTransportState;
  transportchange: RackTransportState;
  end: RackTransportState;
  error: unknown;
}

export interface RackTransportOptions {
  /** Override the animation clock in tests or non-window runtimes. */
  requestFrame?: (callback: (timestamp: number) => void) => number;
  cancelFrame?: (handle: number) => void;
}

type TimelinePlayer = Pick<ScorePlayer, 'durationSeconds' | 'progress' | 'seconds' | 'seek'>;

function finite(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function clamp01(value: unknown): number {
  return Math.max(0, Math.min(1, finite(value)));
}

function defaultRequestFrame(callback: (timestamp: number) => void): number {
  if (typeof globalThis.requestAnimationFrame === 'function') {
    return globalThis.requestAnimationFrame(callback);
  }
  return globalThis.setTimeout(() => callback(Date.now()), 16) as unknown as number;
}

function defaultCancelFrame(handle: number): void {
  if (typeof globalThis.cancelAnimationFrame === 'function') {
    globalThis.cancelAnimationFrame(handle);
    return;
  }
  globalThis.clearTimeout(handle);
}

/**
 * DOM-free transport state for a borrowed {@link Rack}.
 *
 * It owns the play-generation race, longest-member clock, progress polling,
 * end handling and lockstep seek policy. It never disposes the rack; destroying
 * the controller only stops transport work started through this controller.
 */
export class RackTransportController {
  private readonly emitter = new EventEmitter<RackTransportEvents>();
  private readonly requestFrame: (callback: (timestamp: number) => void) => number;
  private readonly cancelFrame: (handle: number) => void;
  private readonly rackUnsubscribes: Array<() => void> = [];
  private playingValue = false;
  private playGeneration = 0;
  private frame: number | undefined;
  private destroyed = false;

  constructor(
    private readonly rack: Rack,
    options: RackTransportOptions = {},
  ) {
    this.requestFrame = options.requestFrame ?? defaultRequestFrame;
    this.cancelFrame = options.cancelFrame ?? defaultCancelFrame;
    // The snapshot recomputes the current member set on every read/tick, so a
    // second memberschange subscription is unnecessary. Keeping only the end
    // listener also preserves the Rack facade's historic listener footprint.
    this.rackUnsubscribes.push(rack.on('end', () => this.handleEnd()));
  }

  get snapshot(): RackTransportState {
    const leader = this.transportLeader();
    return {
      playing: this.playingValue,
      progress: clamp01(leader?.progress),
      currentTime: Math.max(0, finite(leader?.seconds)),
      duration: Math.max(0, finite(leader?.durationSeconds)),
    };
  }

  get playing(): boolean {
    return this.playingValue;
  }

  async play(): Promise<void> {
    if (this.destroyed || this.playingValue) return;
    const generation = ++this.playGeneration;
    this.playingValue = true;
    this.emit('transportchange', this.snapshot);
    // A synchronous subscriber may issue a newer pause/stop/destroy command.
    // Only the last command is allowed to reach the borrowed Rack backend.
    if (generation !== this.playGeneration || !this.playingValue || this.destroyed) return;
    try {
      await this.rack.play();
      if (generation !== this.playGeneration || this.destroyed) {
        if (!this.playingValue) this.pauseStaleStart();
        return;
      }
      this.startTicker();
    } catch (error) {
      if (generation !== this.playGeneration || this.destroyed) {
        if (!this.playingValue) this.pauseStaleStart();
        return;
      }
      this.playingValue = false;
      this.stopTicker();
      try {
        this.rack.pause();
      } catch (pauseError) {
        reportPlaybackOperationFailure('RackTransportController', 'pause after play failure', pauseError);
      }
      this.emit('transportchange', this.snapshot);
      this.emit('error', error);
      throw error;
    }
  }

  pause(): void {
    if (this.destroyed || !this.playingValue) return;
    this.playGeneration += 1;
    this.playingValue = false;
    let pauseError: unknown;
    try {
      this.stopTicker();
    } catch (error) {
      pauseError = error;
    }
    try {
      this.rack.pause();
    } catch (error) {
      pauseError ??= error;
    }
    this.emit('transportchange', this.snapshot);
    if (pauseError !== undefined) throw pauseError;
  }

  stop(): void {
    if (this.destroyed) return;
    const changed = this.playingValue;
    this.playGeneration += 1;
    this.playingValue = false;
    let stopError: unknown;
    try {
      this.stopTicker();
    } catch (error) {
      stopError = error;
    }
    try {
      this.rack.stop();
    } catch (error) {
      stopError ??= error;
    }
    if (changed) this.emit('transportchange', this.snapshot);
    this.emit('timeupdate', this.snapshot);
    if (stopError !== undefined) throw stopError;
  }

  seekFraction(fraction: number): void {
    this.seek(clamp01(fraction) * this.snapshot.duration);
  }

  /** Seek every timeline member to one transport position, clamped per member. */
  seek(seconds: number): void {
    if (this.destroyed) return;
    const duration = this.snapshot.duration;
    const target = Math.max(0, Math.min(duration, finite(seconds)));
    for (const player of this.timelinePlayers()) {
      try {
        void Promise.resolve(player.seek(Math.min(target, Math.max(0, finite(player.durationSeconds))))).catch(
          (error: unknown) => this.emit('error', error),
        );
      } catch (error) {
        this.emit('error', error);
      }
    }
    this.emit('timeupdate', this.snapshot);
  }

  on<TName extends keyof RackTransportEvents>(
    event: TName,
    listener: (payload: RackTransportEvents[TName]) => void,
  ): () => void {
    return this.emitter.on(event, listener);
  }

  destroy(): void {
    if (this.destroyed) return;
    const shouldStopBackend = this.playingValue;
    this.destroyed = true;
    this.playGeneration += 1;
    this.playingValue = false;

    let cleanupError: unknown;
    try {
      this.stopTicker();
    } catch (error) {
      cleanupError = error;
    }
    if (shouldStopBackend) {
      try {
        this.rack.stop();
      } catch (error) {
        cleanupError ??= error;
      }
    }
    for (const unsubscribe of this.rackUnsubscribes.splice(0)) {
      try {
        unsubscribe();
      } catch (error) {
        cleanupError ??= error;
      }
    }
    this.emitter.clear();
    if (cleanupError !== undefined) throw cleanupError;
  }

  private timelinePlayers(): TimelinePlayer[] {
    const players: TimelinePlayer[] = [];
    for (const {player} of this.rack.list()) {
      if (!player || typeof player !== 'object') continue;
      if (
        'durationSeconds' in player &&
        'progress' in player &&
        'seconds' in player &&
        typeof (player as {seek?: unknown}).seek === 'function'
      ) {
        players.push(player as unknown as TimelinePlayer);
      }
    }
    return players;
  }

  private transportLeader(): TimelinePlayer | undefined {
    return this.timelinePlayers().reduce<TimelinePlayer | undefined>(
      (leader, player) =>
        !leader || finite(player.durationSeconds) > finite(leader.durationSeconds) ? player : leader,
      undefined,
    );
  }

  private startTicker(): void {
    this.stopTicker();
    this.frame = this.requestFrame(this.tick);
  }

  private stopTicker(): void {
    const frame = this.frame;
    this.frame = undefined;
    if (frame !== undefined) this.cancelFrame(frame);
  }

  private readonly tick = (_timestamp: number): void => {
    this.frame = undefined;
    if (!this.playingValue || this.destroyed) return;
    this.emit('timeupdate', this.snapshot);
    // A synchronous listener may pause, stop or destroy the controller. Do not
    // resurrect the polling loop after that newer command has won.
    if (!this.playingValue || this.destroyed) return;
    this.frame = this.requestFrame(this.tick);
  };

  private handleEnd(): void {
    if (this.destroyed) return;
    this.playGeneration += 1;
    this.playingValue = false;
    let tickerError: unknown;
    try {
      this.stopTicker();
    } catch (error) {
      tickerError = error;
    }
    const snapshot = this.snapshot;
    this.emit('transportchange', snapshot);
    this.emit('timeupdate', snapshot);
    this.emit('end', snapshot);
    if (tickerError !== undefined) this.emit('error', tickerError);
  }

  private pauseStaleStart(): void {
    try {
      this.rack.pause();
    } catch (error) {
      reportPlaybackOperationFailure('RackTransportController', 'pause stale start', error);
    }
  }

  private emit<TName extends keyof RackTransportEvents>(event: TName, payload: RackTransportEvents[TName]): void {
    this.emitter.emitSafely(event, payload, (error) => {
      reportPlaybackOperationFailure('RackTransportController', `${String(event)} listener`, error);
    });
  }
}

export function createRackTransportController(rack: Rack, options: RackTransportOptions = {}): RackTransportController {
  return new RackTransportController(rack, options);
}
