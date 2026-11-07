import {
  ModuleCapabilities,
  NoteInputPort,
  SOURCE_SCHEMAS,
  SourcePublisher,
  createControlPort,
  moduleScopeChange,
  routeModuleOutput,
  type ConnectionLease,
  type ControlPort,
  type ModuleContext,
  type ModuleHandle,
  type ModulePort,
  type AudioOutputPort,
  type NoteEvent,
} from '@webmusic/kernel/module';
import type {InsertChain} from '@webmusic/kernel/effect';
import type {ModuleSession} from '@webmusic/kernel/session';
import type {SyncFollowerTransport} from '@webmusic/kernel/session';
import type {Score, ScoreDocumentSource, ScorePlaybackSource} from '../../core';
import type {HeadlessSynth} from './audio-contracts';
import type {NoteInputTarget} from '../core/note-input-model';
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

/**
 * One real score engine attached to a module scope and optional Session. Its
 * ports: audio `main` (once prepared), note input `notes`, source `source`
 * (the player's `webmusic.score` playback source), the scope's borrowed
 * `transport`, and control `params` when the synth has parameters.
 */
export class ScorePlayerModule implements ModuleHandle {
  readonly id: string;
  readonly player: ScorePlayer;
  readonly capabilities: ModuleCapabilities;
  /** Note input; events reach this player's exact voices. */
  readonly notes: NoteInputPort;
  /** Source port publishing the player's playback source. */
  readonly source: SourcePublisher<ScorePlaybackSource>;
  private readonly heldNotes = new Set<string>();
  private readonly portNotes = new Map<string, {active: boolean}>();
  private readonly noteTarget: NoteInputTarget;
  private readonly ownsPlayer: boolean;
  private context: ModuleContext;
  private control?: ControlPort;
  private portList: readonly ModulePort[] = Object.freeze([]);
  private readonly onError?: (error: unknown) => void;
  private readonly listeners = new Set<() => void>();
  private readonly registration: ConnectionLease;
  private participant?: ReturnType<ModuleSession['register']>;
  private sessionUnsubscribe?: () => void;
  private route?: ConnectionLease;
  private preparing?: Promise<void>;
  private disposed = false;

  constructor(score: Score, options: ScorePlayerModuleOptions) {
    this.id = options.id ?? `score-module-${++nextModuleId}`;
    this.context = options.context;
    this.onError = options.onError;
    this.ownsPlayer = !options.player;
    this.player = options.player ?? new ScorePlayer(score, options);
    this.noteTarget = {
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
    };
    this.capabilities = new ModuleCapabilities().with(SCORE_NOTE_INPUT, this.noteTarget);
    this.notes = new NoteInputPort({accept: (event) => this.acceptNote(event)}, {id: 'notes'});
    this.source = new SourcePublisher<ScorePlaybackSource>(SOURCE_SCHEMAS.score, {id: 'source'});
    this.source.ready(this.player.playback);
    this.refreshPorts();
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
        const scale = options.positionScale ?? 1;
        const offset = options.offsetSeconds ?? 0;
        // Before the engine follows the Session's scheduling (it attaches on
        // preparation), mirror committed paused seeks and stops into it so its
        // own playback source shows the Session position.
        this.sessionUnsubscribe = session.subscribe((event) => {
          if (event.type !== 'commit' || player.followsSession || this.disposed) return;
          const command = event.commit.command.type;
          if (command !== 'seek' && command !== 'stop') return;
          const local = Math.max(0, event.snapshot.position * scale + offset);
          void player.seekNominal(local).catch((error) => this.onError?.(error));
        });
        this.participant = session.register(follower, {
          axis: 'score-nominal-seconds',
          offsetSeconds: options.offsetSeconds,
          positionScale: options.positionScale,
          attachScheduling: (binding) => player.attachScheduling(binding),
          timing: player.sessionTiming,
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
      this.sessionUnsubscribe?.();
      this.registration.release();
      this.notes.dispose();
      this.source.dispose();
      if (this.ownsPlayer) this.player.dispose();
      throw error;
    }
  }

  ports(): readonly ModulePort[] { return this.portList; }

  /**
   * Follow a republished scope in place (DEC-065): when only the destination
   * resolver changed, re-route the prepared output and keep the engine, its
   * Session membership and its voices. Returns false when the change needs a
   * rebind (a new Session, registry, admission or environment).
   */
  retarget(next: ModuleContext): boolean {
    if (this.disposed) throw new Error('Score module has been disposed.');
    const change = moduleScopeChange(this.context, next);
    if (change === 'scope') return false;
    this.context = next;
    if (change === 'destination' && this.route) {
      const port = this.player.audioOutput!;
      const previous = this.route;
      this.route = undefined;
      previous.release();
      this.route = routeModuleOutput(next, this, port);
      this.notify();
    }
    return true;
  }

  /**
   * Play another score in place: the engine, its route, voices' synth and
   * Session membership stay. The Session (when present) stops first, so every
   * member restarts from the origin with the new timeline.
   */
  async replaceScore(score: Score): Promise<void> {
    if (this.disposed) throw new Error('Score module has been disposed.');
    await this.context.session?.stop();
    if (this.disposed) return;
    await this.player.replaceScore(score);
    if (this.disposed) return;
    this.source.ready(this.player.playback);
    // The Session re-reads this member's duration and end in place.
    this.participant?.refresh();
    this.notify();
  }

  /**
   * Replace the instrument in place; false when the timing class would change
   * (the caller rebuilds). The control port follows the new synth's parameters.
   */
  replaceSynth(synth: HeadlessSynth | undefined): boolean {
    if (this.disposed) throw new Error('Score module has been disposed.');
    if (!this.player.replaceSynth(synth)) return false;
    this.notify();
    return true;
  }

  /** Play a borrowed document in place of the constructed score; the engine and clock stay. */
  setDocumentSource(source: ScoreDocumentSource | undefined): void {
    if (this.disposed) throw new Error('Score module has been disposed.');
    this.player.setDocumentSource(source);
    this.source.ready(this.player.playback);
    this.notify();
  }

  private acceptNote(event: NoteEvent): void {
    if (this.disposed) return;
    const id = `${event.sourceId}:${event.occurrenceId}`;
    if (event.gate === 'on') {
      if (this.portNotes.has(id)) return;
      const held = {active: true};
      this.portNotes.set(id, held);
      const velocity = Math.max(1, Math.min(127, Math.round(event.velocity * 127)));
      void this.noteTarget.prepare().then(() => {
        if (!held.active || this.disposed) return;
        this.noteTarget.noteOn({id, midi: Math.round(event.pitch.midi), velocity});
        // A release that arrived during the start already removed the record.
        if (!held.active) this.noteTarget.noteOff(id);
      }, (error) => {
        if (this.portNotes.get(id) === held) this.portNotes.delete(id);
        try { this.onError?.(error); } catch { /* Report only. */ }
      });
      return;
    }
    const held = this.portNotes.get(id);
    if (held) { held.active = false; this.portNotes.delete(id); }
    this.noteTarget.noteOff(id);
  }

  private refreshPorts(): void {
    const ports: ModulePort[] = [];
    const audio = this.player.audioOutput;
    if (audio && this.route) ports.push(audio);
    ports.push(this.notes, this.source);
    const transport = this.context.transport;
    if (transport) ports.push(transport);
    const params = this.player.params;
    if (params && this.control?.params !== params) this.control = createControlPort(params);
    if (params && this.control) ports.push(this.control);
    this.portList = Object.freeze(ports);
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
    // A pending or conflicting document fails before any audio is requested.
    this.player.assertDocumentPlayable();
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
    return () => { this.listeners.delete(listener); };
  }

  private notify(): void {
    this.refreshPorts();
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
    for (const held of this.portNotes.values()) held.active = false;
    this.portNotes.clear();
    for (const id of this.heldNotes) clean(() => this.player.noteOffOccurrence(id));
    this.heldNotes.clear();
    clean(() => this.notes.dispose());
    clean(() => this.source.dispose());
    clean(() => this.sessionUnsubscribe?.());
    clean(() => this.participant?.release());
    clean(() => this.route?.release());
    clean(() => this.registration.release());
    if (this.ownsPlayer) clean(() => this.player.dispose());
    this.listeners.clear();
    if (failure !== undefined) throw failure;
  }
}
