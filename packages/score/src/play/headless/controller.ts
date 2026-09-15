import {
  EventEmitter,
  type Note,
  type Score,
  type TimePosition,
} from '../../core';
import type {PlayerTimeUpdate} from './audio-contracts';
import {ScorePlayer as Player} from './score-player';
import {
  emitPlaybackEvent,
  reportPlaybackOperationFailure,
  type PlaybackListenerError,
} from './playback-events';

export type ControllerEvent =
  | 'cursor'
  | 'noteOn'
  | 'noteOff'
  | 'end'
  | 'timeupdate'
  | 'transportchange'
  | 'error'
  | 'listenerError';

export interface PlayerTransportState {
  playing: boolean;
}

export interface ControllerEvents {
  cursor: TimePosition;
  noteOn: Note;
  noteOff: Note;
  end: Score;
  /** The same explicit score/transport snapshot emitted by `ScorePlayer`. */
  timeupdate: PlayerTimeUpdate;
  /** Emitted synchronously whenever play/pause state changes. */
  transportchange: PlayerTransportState;
  /** A play() failure (e.g. AudioContext resume rejected). */
  error: unknown;
  /** A subscriber fault; never an operational playback failure. */
  listenerError: PlaybackListenerError;
}

export class PlayerController {
  private readonly emitter = new EventEmitter<ControllerEvents>();
  private readonly baseTempo: number;
  private readonly unsubscribes: Array<() => void> = [];
  private rateValue = 1;
  private playingValue = false;
  private playGeneration = 0;
  private seekGeneration = 0;
  private rateGeneration = 0;

  constructor(private readonly player: Player, score: Score) {
    this.baseTempo = score.timeMap.tempi[0]?.bpm ?? 120;
    this.unsubscribes.push(
      player.on('cursor', (cursor) => this.emit('cursor', cursor)),
      player.on('timeupdate', (update) => this.emit('timeupdate', update)),
      player.on('noteOn', (note) => this.emit('noteOn', note)),
      player.on('noteOff', (note) => this.emit('noteOff', note)),
      player.on('end', (endedScore) => {
        this.playingValue = false;
        this.emitTransportChange();
        this.emit('end', endedScore);
      }),
    );
  }

  play(): void {
    const generation = ++this.playGeneration;
    this.playingValue = true;
    this.emitTransportChange();
    // A transportchange listener may synchronously issue a newer pause/play.
    // Only the latest operation may reach the underlying player.
    if (generation !== this.playGeneration || !this.playingValue) return;
    this.player.play().catch((error: unknown) => {
      if (generation !== this.playGeneration) return;
      this.playingValue = false;
      this.emitTransportChange();
      reportPlaybackOperationFailure('PlayerController', 'play', error);
      this.emit('error', error);
    });
  }

  pause(): void {
    const generation = ++this.playGeneration;
    this.playingValue = false;
    this.emitTransportChange();
    // Preserve the last re-entrant command instead of pausing after a listener
    // has already started a newer play generation.
    if (generation !== this.playGeneration || this.playingValue) return;
    this.player.pause();
  }

  stop(): void {
    const generation = this.playGeneration + 1;
    const seekGeneration = this.seekGeneration;
    this.pause();
    // The pause notification/backend can issue a newer play, seek or destroy.
    // That command owns the resulting position, including while still paused.
    if (generation !== this.playGeneration || seekGeneration !== this.seekGeneration) return;
    this.seek(0);
  }

  seek(seconds: number): void {
    this.seekGeneration += 1;
    this.player.seek(Math.max(0, Math.min(seconds, this.duration)));
  }

  scrub(delta: number): void {
    this.seek(this.currentTime + delta);
  }

  seekFraction(fraction: number): void {
    this.seek(Math.max(0, Math.min(1, fraction)) * this.duration);
  }

  setRate(rate: number): void {
    if (!Number.isFinite(rate)) throw new RangeError('rate must be finite');
    const generation = ++this.rateGeneration;
    const previous = this.rateValue;
    this.rateValue = Math.max(0.1, Math.min(4, rate));
    try {
      this.player.setTempo(this.baseTempo * this.rateValue);
    } catch (error) {
      if (generation === this.rateGeneration) this.rateValue = previous;
      throw error;
    }
  }

  on<TName extends keyof ControllerEvents>(
    event: TName,
    cb: (payload: ControllerEvents[TName]) => void,
  ): () => void {
    return this.emitter.on(event, cb);
  }

  private emit<TName extends keyof ControllerEvents>(
    event: TName,
    payload: ControllerEvents[TName],
  ): void {
    emitPlaybackEvent(this.emitter, 'PlayerController', event, payload);
  }

  private emitTransportChange(): void {
    this.emit('transportchange', {playing: this.playingValue});
  }

  destroy(): void {
    this.playGeneration += 1;
    this.playingValue = false;
    for (const unsubscribe of this.unsubscribes) unsubscribe();
    this.unsubscribes.length = 0;
    this.emitter.clear();
  }

  /**
   * Current playback position in *real* (wall-clock) seconds at the current
   * rate — the same domain as {@link duration}, {@link seek} and {@link scrub},
   * so `progress` stays in [0, 1] at any rate.
   */
  get currentTime(): number {
    return this.player.seconds;
  }

  get currentPosition(): TimePosition {
    return this.player.currentTime;
  }

  get duration(): number {
    return this.player.durationSeconds;
  }

  get playing(): boolean {
    return this.playingValue;
  }

  get loaded(): boolean {
    return this.player.durationSeconds > 0;
  }

  get rate(): number {
    return this.rateValue;
  }

  get progress(): number {
    return this.player.progress;
  }
}

export const MidiPlayerController = PlayerController;
