import {
  ModuleCapabilities,
  routeModuleOutput,
  type ConnectionLease,
  type ModuleContext,
  type ModuleHandle,
  type AudioOutputPort,
} from '@webmusic/kernel/module';
import type {InsertChain} from '@webmusic/kernel/effect';
import type {SessionTransport} from '@webmusic/kernel/session';
import type {SyncFollowerTransport} from '@webmusic/kernel/sync';
import type {Score} from '../../core';
import type {ScorePlayerOptions} from './audio-contracts';
import {ScorePlayer} from './score-player';
import {SCORE_NOTE_INPUT} from './note-input';

let nextModuleId = 0;

export interface ScorePlayerModuleOptions extends ScorePlayerOptions {
  context: ModuleContext;
  id?: string;
  /** Borrow an existing engine instead of creating one from the supplied score. */
  player?: ScorePlayer;
  onError?: (error: unknown) => void;
  /** Explicit affine mapping from Session seconds into nominal Score seconds. */
  offsetSeconds?: number;
  positionScale?: number;
}

/** One real score engine attached to a module scope and optional Session. */
export class ScorePlayerModule implements ModuleHandle {
  readonly id: string;
  readonly player: ScorePlayer;
  readonly capabilities: ModuleCapabilities;
  private readonly heldNotes = new Set<string>();
  private readonly ownsPlayer: boolean;
  private readonly context: ModuleContext;
  private readonly onError?: (error: unknown) => void;
  private readonly listeners = new Set<() => void>();
  private readonly registration: ConnectionLease;
  private participant?: ReturnType<SessionTransport['register']>;
  private route?: ConnectionLease;
  private preparing?: Promise<void>;
  private disposed = false;

  constructor(score: Score, options: ScorePlayerModuleOptions) {
    this.id = options.id ?? `score-module-${++nextModuleId}`;
    this.context = options.context;
    this.onError = options.onError;
    this.ownsPlayer = !options.player;
    this.player = options.player ?? new ScorePlayer(score, options);
    this.capabilities = new ModuleCapabilities().with(SCORE_NOTE_INPUT, {
      prepare: async () => {
        await this.prepare();
        const audio = this.player.preparedContext!;
        if (audio.state === 'suspended') await audio.resume();
        if (this.disposed) throw new Error('Score module preparation was cancelled.');
      },
      noteOn: (note) => {
        if (this.disposed) throw new Error('Score module has been disposed.');
        if (this.heldNotes.has(note.id)) throw new Error(`Live note occurrence already exists: ${note.id}`);
        this.heldNotes.add(note.id);
        try { this.player.noteOnOccurrence(note); } catch (error) { this.heldNotes.delete(note.id); throw error; }
      },
      noteOff: (id) => {
        if (!this.heldNotes.delete(id)) return;
        this.player.noteOffOccurrence(id);
      },
    });
    this.registration = this.context.registry.register(this);
    try {
      const session = this.context.session;
      if (session) {
        let pendingSeek: Promise<void> = Promise.resolve();
        const player = this.player;
        const follower: SyncFollowerTransport = {
          play: async (when) => { await pendingSeek; await player.play(when); },
          pause: () => player.pause(),
          stop: () => player.stop(),
          seek: (position) => {
            pendingSeek = player.seekNominal(position);
            void pendingSeek.catch((error) => this.onError?.(error));
          },
          setRate: (rate) => player.setRate(rate),
          get position() { return player.nominalSeconds; },
          get running() { return player.isPlaying(); },
          get clock() { return player.clock; },
        };
        this.participant = session.register(follower, {
          axis: 'score-nominal-seconds',
          offsetSeconds: options.offsetSeconds,
          positionScale: options.positionScale,
          attachScheduling: (binding) => player.attachScheduling(binding),
          identity: player,
          durationSeconds: () => player.durationSeconds * player.rate,
          ended: () => player.playback.snapshot().state === 'ended',
          prepare: () => this.prepare(),
          activate: async () => {
            const audio = player.preparedContext;
            if (!audio || audio.state === 'closed') throw new Error('Score Session requires a live prepared AudioContext.');
            if (audio.state !== 'running') await audio.resume();
            if (this.disposed || audio.state !== 'running') throw new Error('Score Session activation was cancelled or the AudioContext is not running.');
          },
        });
      }
    } catch (error) {
      this.registration.release();
      if (this.ownsPlayer) this.player.dispose();
      throw error;
    }
  }

  get inserts(): InsertChain | undefined { return this.player.inserts; }
  get params() { return this.player.params; }

  getPort(name: string): AudioOutputPort | undefined {
    return name === 'output' || name === 'main' ? this.player.audioOutput : undefined;
  }

  prepare(): Promise<void> {
    if (this.disposed) return Promise.reject(new Error('Score module has been disposed.'));
    if (this.preparing) return this.preparing;
    // Publish the in-flight task before invoking user-provided graph factories.
    const task = Promise.resolve().then(() => this.prepareCurrent());
    this.preparing = task;
    void task.catch(() => { if (this.preparing === task) this.preparing = undefined; });
    return task;
  }

  private async prepareCurrent(): Promise<void> {
    if (this.disposed) throw new Error('Score module preparation was cancelled.');
    const audio = this.context.audio.prepare() as AudioContext;
    this.player.configureAudio(audio);
    await this.player.preload();
    if (this.disposed) throw new Error('Score module preparation was cancelled.');
    const port = this.player.audioOutput!;
    if (!this.route) {
      const route = routeModuleOutput(this.context, this, port);
      if (this.disposed || !route.active) {
        route.release();
        throw new Error('Score module admission was cancelled.');
      }
      this.route = route;
    }
    this.notify();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    for (const listener of [...this.listeners]) {
      if (this.disposed) break;
      try { listener(); } catch (error) {
        try { this.onError?.(error); } catch { /* Observers cannot undo a committed module. */ }
      }
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    let failure: unknown;
    const clean = (callback: () => void) => { try { callback(); } catch (error) { failure ??= error; } };
    for (const id of this.heldNotes) clean(() => this.player.noteOffOccurrence(id));
    this.heldNotes.clear();
    clean(() => this.participant?.release());
    clean(() => this.route?.release());
    clean(() => this.registration.release());
    if (this.ownsPlayer) clean(() => this.player.dispose());
    this.listeners.clear();
    if (failure !== undefined) throw failure;
  }
}
