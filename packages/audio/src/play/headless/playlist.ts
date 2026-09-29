// ============================================================================
// AudioPlaylist — N clips IN SEQUENCE. The family already covered one clip
// (AudioClipPlayer) and N clips AT ONCE (AudioMixer, one shared start anchor);
// this is the third cardinality, and the one every track list, lesson sequence
// and take list needs.
//
// Two structural facts drive the design:
//   * An AudioClipPlayer binds its clip for life, so a queue cannot reuse one
//     player across entries — it builds one per entry and disposes it on the
//     way out.
//   * A player that creates its own AudioContext also closes it on dispose,
//     and browsers cap contexts at roughly six. The queue therefore owns ONE
//     context and hands it to every player and every decode, which is also
//     what keeps it alive across an advance.
//
// Loading is INJECTED rather than imported: this layer may not reach
// `play/api`, the same constraint that makes the media engine take a
// `mediaAdapterFactory` from its host. `<audio-playlist>` supplies
// `loadClipFromUrl`; a code-only host passes its own loader or pre-loaded
// clips.
// ============================================================================

import {EventEmitter, type AudioClip, type AudioFormat} from '../../core';
import {AudioClipPlayer, type PlayerEngineKind} from './player';
import type {MediaPlaybackAdapterFactory} from './engines/media-engine';
import {createWebAudioContext} from '@webmusic/kernel/audio-context';

/** One queue entry: an already-decoded clip, or a URL to resolve on demand. */
export interface AudioPlaylistEntry {
  id: string;
  label?: string;
  clip?: AudioClip;
  src?: string;
  /** Keep only the URL and stream it through the media engine (no decode). */
  streaming?: boolean;
  /** Explicit format hint, when the URL extension is missing or wrong. */
  format?: AudioFormat;
}

/** How far an entry has got. Drives per-row state in a presenter. */
export type AudioPlaylistEntryStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface AudioPlaylistOptions {
  entries?: readonly AudioPlaylistEntry[];
  /** Shared by every entry's player and decode. One is created if omitted. */
  audioContext?: AudioContext;
  destination?: AudioNode;
  /** Restart at the first entry after the last one ends. Default false. */
  loop?: boolean;
  /**
   * Resolve the NEXT entry's clip while the current one plays. Default true.
   * This covers fetch and decode — the dominant cost; the per-entry audio
   * graph is still built when that entry starts.
   */
  prefetch?: boolean;
  /** Advance past an entry that fails to load instead of stopping. Default true. */
  skipFailed?: boolean;
  volume?: number;
  rate?: number;
  engine?: PlayerEngineKind;
  mediaAdapterFactory?: MediaPlaybackAdapterFactory;
  /**
   * Resolve a `src` entry into a clip. Required for `src` entries; entries
   * that already carry a `clip` never call it. `<audio-playlist>` passes
   * `loadClipFromUrl` from `@webmusic/audio/play`, threading the queue's own
   * context so the native `decodeAudioData` path stays available.
   */
  loadEntry?: (entry: AudioPlaylistEntry, context: AudioContext) => Promise<AudioClip>;
}

export interface AudioPlaylistEvents {
  /** A different entry became current — including the first one. */
  trackchange: {id: string; index: number; entry: AudioPlaylistEntry};
  /** One entry played to its natural end. The queue advances after this. */
  trackend: {id: string; index: number};
  /** The last entry ended and the queue is not looping. */
  playlistend: void;
  timeupdate: {seconds: number; duration: number; progress: number};
  /** An entry's load state changed — repaint the row. */
  statuschange: {id: string; status: AudioPlaylistEntryStatus};
  error: Error;
}

interface EntryState {
  entry: AudioPlaylistEntry;
  status: AudioPlaylistEntryStatus;
  clip?: AudioClip;
  loading?: Promise<AudioClip | undefined>;
}

/**
 * Sequential player over an ordered set of entries. It satisfies the shared
 * `PlayerLike` surface (play/pause/stop/seek/on/dispose), so a view or meter
 * can bind to the queue itself rather than to whichever entry is current.
 */
export class AudioPlaylist {
  private readonly emitter = new EventEmitter<AudioPlaylistEvents>();
  private readonly subscribers = new Set<() => void>();
  private readonly options: AudioPlaylistOptions;
  private states: EntryState[] = [];
  private context: AudioContext | null = null;
  private ownsContext = false;
  private player: AudioClipPlayer | null = null;
  private playerOff: Array<() => void> = [];
  private currentIndex = -1;
  private wantsPlayback = false;
  private volume: number;
  private rate: number;
  private disposed = false;
  private loopEnabled: boolean;
  private prefetchEnabled: boolean;
  private skipFailed: boolean;
  /** Invalidates async work that resumes after the queue moved on. */
  private generation = 0;
  private playRequest: {generation: number; promise: Promise<void>} | null = null;
  /** Clip-relative position requested before the selected entry has a player. */
  private pendingSeek: {seconds: number} | {fraction: number} | null = null;

  constructor(options: AudioPlaylistOptions = {}) {
    this.options = {...options};
    this.loopEnabled = options.loop ?? false;
    this.prefetchEnabled = options.prefetch ?? true;
    this.skipFailed = options.skipFailed ?? true;
    this.volume = options.volume ?? 1;
    this.rate = options.rate ?? 1;
    this.states = normalizeEntries(options.entries ?? []);
    if (options.audioContext) this.context = options.audioContext;
    if (this.states.length > 0) this.currentIndex = 0;
  }

  // --- queue ---

  get entries(): readonly AudioPlaylistEntry[] {
    return this.states.map((state) => state.entry);
  }

  /**
   * Replace the queue. The current entry keeps playing when it survives the
   * change (matched by id), so re-rendering a list does not interrupt audio.
   */
  setEntries(entries: readonly AudioPlaylistEntry[]): void {
    if (this.disposed) return;
    const currentState = this.states[this.currentIndex];
    const currentId = currentState?.entry.id;
    const previous = new Map(this.states.map((state) => [state.entry.id, state]));
    this.states = normalizeEntries(entries).map((state) => {
      const carried = previous.get(state.entry.id);
      // Keep a resolved clip across a re-render; drop it when the source moved.
      if (carried && sameSource(carried.entry, state.entry)) {
        // Pending loads write to this object, including across label changes.
        carried.entry = state.entry;
        return carried;
      }
      return state;
    });
    const nextIndex = currentId ? this.states.findIndex((s) => s.entry.id === currentId) : -1;
    if (nextIndex >= 0 && this.states[nextIndex] === currentState) {
      this.currentIndex = nextIndex;
      this.notify();
      return;
    }
    const resume = nextIndex >= 0 && this.wantsPlayback;
    const generation = ++this.generation;
    // Changed sources replace their player; removed entries stop the queue.
    this.currentIndex = nextIndex >= 0 ? nextIndex : this.states.length > 0 ? 0 : -1;
    this.wantsPlayback = false;
    this.pendingSeek = null;
    this.teardownPlayer();
    this.notify();
    if (resume && generation === this.generation && !this.disposed) {
      void this.play().catch((error: unknown) => this.emitError(error));
    }
  }

  get index(): number {
    return this.currentIndex;
  }

  get current(): AudioPlaylistEntry | undefined {
    return this.states[this.currentIndex]?.entry;
  }

  statusOf(id: string): AudioPlaylistEntryStatus {
    return this.states.find((state) => state.entry.id === id)?.status ?? 'idle';
  }

  /** The resolved clip for an entry, once it has loaded. */
  clipOf(id: string): AudioClip | undefined {
    return this.states.find((state) => state.entry.id === id)?.clip;
  }

  /** The clip currently loaded, if any. */
  get currentClip(): AudioClip | undefined {
    return this.states[this.currentIndex]?.clip;
  }

  // --- transport ---

  play(): Promise<void> {
    if (this.disposed || this.states.length === 0) return Promise.resolve();
    this.wantsPlayback = true;
    if (this.currentIndex < 0) this.currentIndex = 0;
    if (this.playRequest?.generation === this.generation) return this.playRequest.promise;
    let resolve!: () => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<void>((onResolve, onReject) => {
      resolve = onResolve;
      reject = onReject;
    });
    const request = {generation: this.generation, promise};
    this.playRequest = request;
    // Publish before loaders or event listeners can reenter play.
    void this.playCurrent(request.generation).then(
      () => {
        if (this.playRequest === request) this.playRequest = null;
        resolve();
      },
      (error: unknown) => {
        if (this.playRequest === request) this.playRequest = null;
        reject(error);
      },
    );
    return request.promise;
  }

  pause(): void {
    this.generation++;
    this.wantsPlayback = false;
    this.player?.pause();
    this.notify();
  }

  stop(): void {
    this.generation++;
    this.wantsPlayback = false;
    this.pendingSeek = null;
    this.player?.stop();
    this.notify();
  }

  async toggle(): Promise<void> {
    if (this.playing) this.pause();
    else await this.play();
  }

  /** Move to the next entry, honouring list loop at the end. */
  async next(): Promise<void> {
    await this.goTo(this.currentIndex + 1, {wrap: this.loopEnabled});
  }

  /** Move to the previous entry, honouring list loop at the start. */
  async previous(): Promise<void> {
    await this.goTo(this.currentIndex - 1, {wrap: this.loopEnabled});
  }

  /** Jump to an entry by id (or index). Keeps playing if it was playing. */
  async select(target: string | number): Promise<void> {
    if (this.disposed) return;
    const index =
      typeof target === 'number'
        ? target
        : this.states.findIndex((state) => state.entry.id === target);
    if (!Number.isInteger(index) || index < 0 || index >= this.states.length) {
      throw new RangeError(`Playlist selection does not exist: ${String(target)}`);
    }
    await this.goTo(index, {wrap: false});
  }

  seek(seconds: number): void {
    if (this.disposed || this.currentIndex < 0) return;
    if (this.player) this.player.seek(seconds);
    else this.pendingSeek = {seconds};
    this.notify();
  }

  seekFraction(fraction: number): void {
    if (this.disposed || this.currentIndex < 0) return;
    if (this.player) this.player.seekFraction(fraction);
    else this.pendingSeek = {fraction: Math.max(0, Math.min(1, fraction))};
    this.notify();
  }

  setVolume(volume: number): void {
    this.volume = Math.max(0, volume);
    this.player?.setVolume(this.volume);
  }

  setRate(rate: number): void {
    this.rate = Math.max(0.25, Math.min(4, rate));
    this.player?.setRate(this.rate);
  }

  /** Change list looping without replacing the active entry or its cache. */
  setLoop(loop: boolean): void {
    if (this.disposed) return;
    this.loopEnabled = loop;
    if (this.playing) this.schedulePrefetch();
  }

  /** Disabling affects future prefetches; an in-flight load may still cache its result. */
  setPrefetch(prefetch: boolean): void {
    if (this.disposed) return;
    this.prefetchEnabled = prefetch;
    if (prefetch && this.playing) this.schedulePrefetch();
  }

  /** The next failed load follows this policy, including a currently pending load. */
  setSkipFailed(skipFailed: boolean): void {
    if (this.disposed) return;
    this.skipFailed = skipFailed;
  }

  // --- getters ---

  get playing(): boolean {
    return this.player?.playing ?? false;
  }

  get seconds(): number {
    if (this.player) return this.player.seconds;
    if (this.pendingSeek) return 'seconds' in this.pendingSeek
      ? this.pendingSeek.seconds : this.pendingSeek.fraction * this.duration;
    return 0;
  }

  get duration(): number {
    return this.player?.duration ?? this.states[this.currentIndex]?.clip?.duration ?? 0;
  }

  get progress(): number {
    const duration = this.duration;
    return duration > 0 ? this.seconds / duration : 0;
  }

  /** The entry's player, while one exists. Borrowed — never dispose it. */
  get activePlayer(): AudioClipPlayer | undefined {
    return this.player ?? undefined;
  }

  /** Data and graph borrowed by the central AudioPlayer and its followers. */
  get clip(): AudioClip | undefined { return this.currentClip; }
  get analyser(): AnalyserNode | undefined { return this.player?.analyser; }
  get clock() { return this.player?.clock; }

  /** Observe existing queue state without creating another player or timer. */
  subscribe(notify: () => void): () => void {
    if (this.disposed) return () => {};
    this.subscribers.add(notify);
    return () => { this.subscribers.delete(notify); };
  }
  onEnd(notify: () => void): () => void { return this.on('playlistend', notify); }
  onError(notify: (error: Error) => void): () => void { return this.on('error', notify); }

  // --- events ---

  on<K extends keyof AudioPlaylistEvents>(
    event: K,
    listener: (data: AudioPlaylistEvents[K]) => void,
  ): () => void {
    return this.emitter.on(event, listener);
  }

  off<K extends keyof AudioPlaylistEvents>(
    event: K,
    listener: (data: AudioPlaylistEvents[K]) => void,
  ): void {
    this.emitter.off(event, listener);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.generation++;
    this.wantsPlayback = false;
    this.teardownPlayer();
    this.notify();
    this.subscribers.clear();
    this.emitter.removeAllListeners();
    if (this.context && this.ownsContext) {
      try {
        void this.context.close().catch(() => {});
      } catch {
        // A context that refuses to close must not block teardown.
      }
    }
    this.context = null;
  }

  // --- internals ---

  private ensureContext(): AudioContext {
    if (this.context) return this.context;
    this.context = createWebAudioContext('AudioContext is not available in this environment');
    this.ownsContext = true;
    return this.context;
  }

  private setStatus(state: EntryState, status: AudioPlaylistEntryStatus): void {
    if (state.status === status) return;
    state.status = status;
    if (this.isActiveState(state)) this.emit('statuschange', {id: state.entry.id, status});
  }

  /** Share each entry's load; a later playback request may retry a failure. */
  private async resolveClip(state: EntryState): Promise<AudioClip | undefined> {
    if (!this.isActiveState(state)) return undefined;
    if (state.clip) return state.clip;
    if (state.entry.clip) {
      state.clip = state.entry.clip;
      this.setStatus(state, 'ready');
      return state.clip;
    }
    if (state.loading) return state.loading;
    const pending = Promise.resolve().then(async () => {
      try {
        if (!this.isActiveState(state)) return undefined;
        const loadEntry = this.options.loadEntry;
        if (!state.entry.src) {
          throw new Error(`Playlist entry "${state.entry.id}" has neither clip nor src`);
        }
        if (!loadEntry) {
          throw new Error(
            `Playlist entry "${state.entry.id}" needs a loader: pass options.loadEntry, or give the entry a clip`,
          );
        }
        const clip = await loadEntry(state.entry, this.ensureContext());
        if (!this.isActiveState(state)) return undefined;
        state.clip = clip;
        this.setStatus(state, 'ready');
        return clip;
      } catch (error) {
        if (this.isActiveState(state)) {
          this.setStatus(state, 'error');
          if (this.isActiveState(state)) this.emitError(error);
        }
        return undefined;
      } finally {
        if (state.loading === pending) state.loading = undefined;
      }
    });
    state.loading = pending;
    this.setStatus(state, 'loading');
    return pending;
  }

  private isActiveState(state: EntryState): boolean {
    return !this.disposed && this.states.includes(state);
  }

  private isCurrentPlayback(generation: number): boolean {
    return !this.disposed && generation === this.generation && this.wantsPlayback;
  }

  private async playCurrent(generation: number): Promise<void> {
    // A failed pass is bounded even for a looping queue. Retrying is an
    // explicit new play request, rather than an endless microtask chain.
    let remaining = this.states.length;
    while (remaining-- > 0 && this.isCurrentPlayback(generation)) {
      const player = await this.ensurePlayer();
      if (!this.isCurrentPlayback(generation)) return;
      if (player && player === this.player) {
        await this.guard(() => player.play());
        this.notify();
        if (this.isCurrentPlayback(generation) && this.player === player) this.schedulePrefetch();
        return;
      }
      if (!this.skipFailed) {
        this.wantsPlayback = false;
        return;
      }
      const nextIndex = this.currentIndex + 1;
      if (nextIndex >= this.states.length && !this.loopEnabled) {
        await this.advance();
        return;
      }
      if (remaining > 0) this.currentIndex = nextIndex < this.states.length ? nextIndex : 0;
    }
    if (this.isCurrentPlayback(generation)) this.wantsPlayback = false;
  }

  /** Build (or reuse) the player for the current entry. */
  private async ensurePlayer(): Promise<AudioClipPlayer | undefined> {
    if (this.player) return this.player;
    const state = this.states[this.currentIndex];
    if (!state) return undefined;
    const generation = this.generation;
    const clip = await this.resolveClip(state);
    if (generation !== this.generation || this.disposed || this.states[this.currentIndex] !== state) return undefined;
    if (!clip) return undefined;
    if (this.player) return this.player;

    const player = new AudioClipPlayer(clip, {
      audioContext: this.ensureContext(),
      volume: this.volume,
      rate: this.rate,
      ...(this.options.destination ? {destination: this.options.destination} : {}),
      ...(this.options.engine ? {engine: this.options.engine} : {}),
      ...(this.options.mediaAdapterFactory
        ? {mediaAdapterFactory: this.options.mediaAdapterFactory}
        : {}),
      // Deliberately NO loop: the buffer engine suppresses its ended callback
      // while looping, so a looping track player would never let the queue
      // advance. List loop is this controller's job.
    });
    this.player = player;
    this.playerOff = [
      player.on('timeupdate', (data) => this.emit('timeupdate', data)),
      player.on('end', () => void this.onTrackEnd()),
      player.on('error', (error) => this.emitError(error)),
    ];
    const pendingSeek = this.pendingSeek;
    this.pendingSeek = null;
    if (pendingSeek) {
      if ('seconds' in pendingSeek) player.seek(pendingSeek.seconds);
      else player.seekFraction(pendingSeek.fraction);
      if (this.player !== player || generation !== this.generation) return undefined;
    }
    this.emit('trackchange', {
      id: state.entry.id,
      index: this.currentIndex,
      entry: state.entry,
    });
    return player;
  }

  private teardownPlayer(): void {
    for (const off of this.playerOff) {
      try {
        off();
      } catch {
        // Unsubscribing must never block teardown.
      }
    }
    this.playerOff = [];
    const player = this.player;
    this.player = null;
    if (!player) return;
    try {
      player.dispose();
    } catch (error) {
      // dispose() rethrows its first cleanup failure; one bad entry must not
      // stop the queue from moving on.
      this.emitError(error);
    }
  }

  private async onTrackEnd(): Promise<void> {
    const generation = this.generation;
    const state = this.states[this.currentIndex];
    if (state) this.emit('trackend', {id: state.entry.id, index: this.currentIndex});
    if (this.isCurrentPlayback(generation) && this.states[this.currentIndex] === state) await this.advance();
  }

  /** Auto-advance after an end: next entry, list loop, or stop. */
  private async advance(): Promise<void> {
    const nextIndex = this.currentIndex + 1;
    if (nextIndex < this.states.length) {
      await this.goTo(nextIndex, {wrap: false});
      return;
    }
    if (this.loopEnabled && this.states.length > 0) {
      await this.goTo(0, {wrap: false});
      return;
    }
    // End the old request before notifying observers; a playlistend listener
    // may explicitly retry now that its loader or source has recovered.
    this.generation++;
    this.wantsPlayback = false;
    this.pendingSeek = null;
    this.teardownPlayer();
    this.emit('playlistend', undefined);
  }

  private async goTo(index: number, {wrap}: {wrap: boolean}): Promise<void> {
    if (this.disposed || this.states.length === 0) return;
    let target = index;
    if (target < 0) target = wrap ? this.states.length - 1 : 0;
    if (target >= this.states.length) {
      if (!wrap) return;
      target = 0;
    }
    const resume = this.wantsPlayback || this.playing;
    const generation = ++this.generation;
    this.currentIndex = target;
    this.wantsPlayback = resume;
    this.pendingSeek = null;
    this.teardownPlayer();
    if (generation !== this.generation || this.disposed) return;
    if (!resume) {
      // Still announce the move so a list repaints its current row.
      const state = this.states[target];
      if (state) {
        this.emit('trackchange', {id: state.entry.id, index: target, entry: state.entry});
      }
      return;
    }
    await this.play();
  }

  /** Resolve the next entry's clip while the current one plays. */
  private schedulePrefetch(): void {
    if (!this.prefetchEnabled) return;
    const next = this.states[this.currentIndex + 1] ?? (this.loopEnabled ? this.states[0] : undefined);
    if (!next || next.clip || next.status === 'loading' || next.status === 'error') return;
    // Best-effort: a prefetch failure is reported through statuschange and is
    // retried when the entry actually becomes current.
    void this.resolveClip(next).catch(() => {});
  }

  private async guard(work: () => Promise<void> | void): Promise<void> {
    try {
      await work();
    } catch (error) {
      this.emitError(error);
    }
  }

  private emit<K extends keyof AudioPlaylistEvents>(
    event: K,
    data: AudioPlaylistEvents[K],
  ): void {
    try {
      this.emitter.emit(event, data);
    } catch {
      // A faulty listener must not break the queue's own state machine.
    }
    this.notify();
  }

  private notify(): void {
    for (const notify of [...this.subscribers]) {
      if (!this.subscribers.has(notify)) continue;
      try { notify(); } catch { /* One observer cannot break queue state. */ }
    }
  }

  private emitError(error: unknown): void {
    const normalized = error instanceof Error ? error : new Error(String(error));
    try {
      this.emitter.emit('error', normalized);
    } catch {
      // Same rule as above: listeners never break the queue.
    }
  }
}

function normalizeEntries(entries: readonly AudioPlaylistEntry[]): EntryState[] {
  const seen = new Set<string>();
  const states: EntryState[] = [];
  for (const entry of entries) {
    if (!entry?.id || seen.has(entry.id)) continue;
    seen.add(entry.id);
    states.push({entry, status: entry.clip ? 'ready' : 'idle', clip: entry.clip});
  }
  return states;
}

function sameSource(a: AudioPlaylistEntry, b: AudioPlaylistEntry): boolean {
  return a.src === b.src && a.clip === b.clip && a.streaming === b.streaming && a.format === b.format;
}

/** Create a sequential player over an ordered set of entries. */
export function createAudioPlaylist(options: AudioPlaylistOptions = {}): AudioPlaylist {
  return new AudioPlaylist(options);
}
