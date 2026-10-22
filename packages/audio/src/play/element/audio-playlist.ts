// ============================================================================
// <audio-playlist> — N clips IN SEQUENCE. <audio-player> controls the queue
// and <audio-mixer> plays several at once; this is the queue: auto-advance on
// end, previous/next/select, list loop, and prefetch of the next entry. One
// AudioContext serves the whole queue, which stacked player tags cannot do.
//
// Attributes: src loop autoplay volume rate prefetch engine skip-failed
// Properties: .entries .playlist .player (central owner) .activePlayer .clip .analyser .currentTime
// Events (webaudio:*, {bubbles, composed}):
//   trackchange {id, index}  trackend {id, index}  playlistend
//   timeupdate {seconds, duration, progress}  seek {seconds, progress}  error
// CSS vars: --wapl-bg --wapl-fg --wapl-accent --wapl-active --wapl-radius
// ============================================================================

import type {AudioClip} from '../../core';
import {
  AudioPlaylist,
  type AudioPlaylistEntry,
} from '../headless/playlist';
import type {AudioClipPlayer, PlayerEngineKind} from '../headless/player';
import type {AudioPlayer} from '../headless/audio-player';
import {AudioPlayerConnection, type AudioPlayerTarget} from './internal/player-connection';
import {loadClipFromUrl} from '../api/load';
import {formatTime} from '../core/format';
import {browserMediaAdapterFactory} from './internal/browser-media-adapter';
import {
  WebMusicElement,
  boolAttr,
  defineOnce,
  numAttr,
  upgradeProperties,
} from './internal/base';
import {
  mountPlaylist,
  type PlaylistHandle,
  type PlaylistItem,
} from '@webmusic/ui/playlist';

const ENGINES: ReadonlySet<string> = new Set(['auto', 'buffer', 'media']);

/** Detail of `webaudio:trackchange` and `webaudio:trackend`. */
export interface AudioPlaylistTrackDetail {
  id: string;
  index: number;
}

/**
 * Read entries from light-DOM children. Any element carrying `data-src` (or an
 * `<a href>`) is an entry, so the markup degrades to a plain list of links for
 * a reader without JavaScript:
 *
 * ```html
 * <audio-playlist>
 *   <li data-src="intro.mp3">Intro</li>
 *   <li data-src="verse.mp3" data-streaming>Verse</li>
 * </audio-playlist>
 * ```
 */
function entriesFromChildren(host: Element): AudioPlaylistEntry[] {
  const entries: AudioPlaylistEntry[] = [];
  for (const child of Array.from(host.children)) {
    const node = child as HTMLElement;
    const src = node.dataset?.src ?? node.getAttribute('href') ?? undefined;
    if (!src) continue;
    const label = node.dataset?.label ?? node.textContent?.trim();
    entries.push({
      // `||`, not `??`: an element with no id attribute reports '' rather
      // than undefined, which would otherwise become the entry's id.
      id: node.dataset?.id || node.id || src,
      ...(label ? {label} : {}),
      src,
      ...(node.dataset?.streaming !== undefined ? {streaming: true} : {}),
    });
  }
  return entries;
}

/** Read entries from the `src` attribute: a comma or whitespace separated list. */
function entriesFromSrc(value: string): AudioPlaylistEntry[] {
  return value
    .split(/[,\s]+/)
    .map((url) => url.trim())
    .filter(Boolean)
    .map((url) => ({id: url, src: url}));
}

/** Fall back to the file name so a row is never blank. */
function labelFor(entry: AudioPlaylistEntry): string {
  if (entry.label) return entry.label;
  const src = entry.src;
  if (!src) return entry.id;
  const name = src.split(/[?#]/)[0]!.split('/').pop();
  return name && name.length > 0 ? name : entry.id;
}

export class AudioPlaylistElement extends WebMusicElement {
  static get observedAttributes(): string[] {
    return ['player', 'src', 'loop', 'autoplay', 'volume', 'rate', 'prefetch', 'engine', 'skip-failed'];
  }

  protected root?: ShadowRoot;
  private queue?: AudioPlaylist;
  private owner?: AudioPlayer;
  private readonly connection = new AudioPlayerConnection(
    this, (player) => this.attachPlayer(player), (error) => this.dispatch('error', error),
  );
  private ui?: PlaylistHandle;
  private explicitEntries?: readonly AudioPlaylistEntry[];
  private compatibilityStyle?: HTMLStyleElement;
  private readonly subscribers = new Set<() => void>();
  private offFns: Array<() => void> = [];

  protected override onMount(): void {
    this.own(() => { this.connection.disconnect(); this.teardown(); });
    upgradeProperties(this, ['entries', 'player']);
    if (!this.root) this.root = this.attachShadow({mode: 'open'});
    this.build();
    this.connection.connect();
    if (boolAttr(this, 'autoplay')) this.startAutoplay();
  }

  attributeChangedCallback(name?: string): void {
    if (!this.isConnected) return;
    if (name === 'player') { this.connection.refresh(); this.render(); return; }
    const queue = this.queue;
    if (!queue) return;
    // Only the inputs that define the queue itself rebuild it; the live knobs
    // apply in place so a change cannot interrupt playback.
    if (name === 'volume') queue.setVolume(numAttr(this, 'volume', 1));
    else if (name === 'rate') queue.setRate(numAttr(this, 'rate', 1));
    else if (name === 'loop') queue.setLoop(boolAttr(this, 'loop'));
    else if (name === 'prefetch') queue.setPrefetch(boolAttr(this, 'prefetch', true));
    else if (name === 'skip-failed') queue.setSkipFailed(boolAttr(this, 'skip-failed', true));
    else if (name === 'autoplay') {
      if (boolAttr(this, 'autoplay')) this.startAutoplay();
    } else if (name === 'src') this.applyEntries();
    else this.build();
  }

  // --- inputs ---

  /** Assign entries programmatically. Overrides `src` and light-DOM children. */
  set entries(entries: readonly AudioPlaylistEntry[] | undefined) {
    this.explicitEntries = entries;
    if (this.isConnected) this.applyEntries();
  }

  get entries(): readonly AudioPlaylistEntry[] {
    return this.queue?.entries ?? this.explicitEntries ?? [];
  }

  /** The controller, for hosts that want the full queue API. Borrowed. */
  get playlist(): AudioPlaylist | undefined {
    return this.queue;
  }

  /** The central playback owner; assignment borrows it without transferring disposal. */
  set player(player: AudioPlayerTarget | undefined) {
    this.connection.set(player);
    if (this.isConnected) this.render();
  }
  get player(): AudioPlayer | undefined { return this.connection.player; }

  /** The queue's current clip engine, retained for low-level integrations. */
  get activePlayer(): AudioClipPlayer | undefined { return this.queue?.activePlayer; }

  // --- PlayerLike facade (what <audio-view player="#id"> binds to) ---

  get clip(): AudioClip | undefined {
    return this.queue?.currentClip;
  }

  get analyser(): AnalyserNode | undefined {
    const player = this.queue?.activePlayer;
    return player ? player.analyser : undefined;
  }

  get seconds(): number {
    return this.queue?.seconds ?? 0;
  }

  get currentTime(): number {
    return this.seconds;
  }

  get duration(): number {
    return this.queue?.duration ?? 0;
  }

  get playing(): boolean {
    return this.queue?.playing ?? false;
  }

  /** Index of the current entry, or -1 when the queue is empty. */
  get index(): number {
    return this.queue?.index ?? -1;
  }

  // --- transport ---

  async play(): Promise<void> {
    if (!this.owner && this.connection.requested) return;
    this.activateQueue();
    if (this.owner) await this.owner.play();
    else await this.queue?.play();
    this.notifyUI();
  }

  pause(): void {
    if (this.owner) this.owner.pause();
    else if (!this.connection.requested) this.queue?.pause();
    this.notifyUI();
  }

  stop(): void {
    if (this.owner) this.owner.stop();
    else if (!this.connection.requested) this.queue?.stop();
    this.notifyUI();
  }

  async next(): Promise<void> {
    this.activateQueue();
    await this.queue?.next();
  }

  async previous(): Promise<void> {
    this.activateQueue();
    await this.queue?.previous();
  }

  async select(target: string | number): Promise<void> {
    this.activateQueue();
    await this.queue?.select(target);
  }

  seek(seconds: number): void {
    if (this.owner) this.owner.seek(seconds);
    else if (!this.connection.requested) this.queue?.seek(seconds);
    this.notifyUI();
  }

  // --- internals ---

  private build(): void {
    this.teardown();
    const engineAttr = this.getAttribute('engine');
    const queue = new AudioPlaylist({
      entries: this.resolveEntries(),
      loop: boolAttr(this, 'loop'),
      prefetch: boolAttr(this, 'prefetch', true),
      skipFailed: boolAttr(this, 'skip-failed', true),
      volume: numAttr(this, 'volume', 1),
      rate: numAttr(this, 'rate', 1),
      ...(engineAttr && ENGINES.has(engineAttr) ? {engine: engineAttr as PlayerEngineKind} : {}),
      mediaAdapterFactory: browserMediaAdapterFactory,
      // The controller may not reach `play/api`, so the element supplies the
      // loader — and threads the queue's own context into it, which is what
      // keeps native decodeAudioData available to every entry.
      loadEntry: (entry, context) =>
        loadClipFromUrl(entry.src ?? '', {
          context,
          ...(entry.format ? {format: entry.format} : {}),
          ...(entry.streaming ? {streaming: true} : {}),
        }),
    });
    this.queue = queue;

    this.offFns = [
      queue.on('trackchange', ({id, index}) => {
        this.notifyUI();
        this.dispatch('trackchange', {id, index} satisfies AudioPlaylistTrackDetail);
      }),
      queue.on('trackend', ({id, index}) =>
        this.dispatch('trackend', {id, index} satisfies AudioPlaylistTrackDetail),
      ),
      // Deliberately NOT webaudio:end: that name already means "one clip
      // finished" on <audio-player>, and overloading it would make the
      // two impossible to tell apart on a page carrying both.
      queue.on('playlistend', () => {
        this.notifyUI();
        this.dispatch('playlistend', undefined);
      }),
      queue.on('timeupdate', (data) => {
        this.notifyUI();
        this.dispatch('timeupdate', data);
      }),
      queue.on('statuschange', () => this.notifyUI()),
      queue.on('error', (error) => this.dispatch('error', error)),
    ];

    this.activateQueue();
    this.render();
  }

  private attachPlayer(player: AudioPlayer | undefined): void {
    const previous = this.owner;
    this.owner = player;
    if (previous && previous.transport === this.queue) previous.setTransport(undefined);
    this.activateQueue();
    this.render();
  }

  private activateQueue(): void {
    if (this.owner && this.queue && this.owner.transport !== this.queue) this.owner.setTransport(this.queue);
  }

  private startAutoplay(): void {
    void this.play().catch((error: unknown) => {
      this.dispatch('error', error instanceof Error ? error : new Error(String(error)));
    });
  }

  private resolveEntries(): AudioPlaylistEntry[] {
    if (this.explicitEntries) return [...this.explicitEntries];
    const src = this.getAttribute('src');
    if (src) return entriesFromSrc(src);
    return entriesFromChildren(this);
  }

  private applyEntries(): void {
    if (!this.queue) return;
    this.queue.setEntries(this.resolveEntries());
    this.notifyUI();
  }

  private render(): void {
    if (!this.root) return;
    this.ui?.destroy();
    this.ui = mountPlaylist(
      this.root,
      {
        snapshot: () => this.snapshot(),
        toggle: () => this.playing ? this.pause() : this.play(),
        previous: () => this.previous(),
        next: () => this.next(),
        seek: (fraction) => this.seekFraction(fraction),
        select: (id) => this.select(id),
        subscribe: (notify) => {
          this.subscribers.add(notify);
          return () => this.subscribers.delete(notify);
        },
      },
      {transport: !this.connection.requested, onError: (error) => this.dispatch('error', error)},
    );
    this.appendCompatibilityStyle();
  }

  private snapshot() {
    const queue = this.queue;
    const currentId = queue?.current?.id;
    const items: PlaylistItem[] = (queue?.entries ?? []).map((entry) => {
      const status = queue?.statusOf(entry.id);
      const clip = entry.clip ?? queue?.clipOf(entry.id);
      return {
        id: entry.id,
        label: labelFor(entry),
        ...(clip ? {duration: formatTime(clip.duration)} : {}),
        active: entry.id === currentId,
        ...(status === 'loading' || status === 'error' ? {status} : {}),
      };
    });
    return {
      playing: queue?.playing ?? false,
      disabled: this.connection.requested && !this.owner,
      progress: queue?.progress ?? 0,
      status: this.connection.requested && !this.owner
        ? {kind: 'waiting' as const, message: 'Waiting for the playback owner.'}
        : {kind: items.length ? 'ready' as const : 'waiting' as const, message: 'Waiting for playlist entries.'},
      items,
    };
  }

  /** Seek within the current entry and announce it, like the rest of the family. */
  private seekFraction(fraction: number): void {
    const queue = this.queue;
    if (!queue) return;
    this.seek(fraction * queue.duration);
    this.notifyUI();
    this.dispatch('seek', {seconds: queue.seconds, progress: fraction});
  }

  /**
   * Re-append the ONE compatibility style node — the presenter's destroy()
   * removes only its own nodes, so a per-render style would accumulate.
   */
  private appendCompatibilityStyle(): void {
    if (!this.root?.ownerDocument) return;
    if (!this.compatibilityStyle) {
      this.compatibilityStyle = this.root.ownerDocument.createElement('style');
      this.compatibilityStyle.textContent =
        ':host{display:block;box-sizing:border-box;inline-size:100%;min-inline-size:0;max-inline-size:100%}:host([hidden]){display:none}.wui-playlist{' +
        'box-sizing:border-box;' +
        'background:var(--wm-audio-playlist-surface-background,var(--wm-playlist-surface-background,var(--wm-component-background,var(--wapl-bg,var(--wm-playlist-background,var(--wm-surface,#fff))))));' +
        'border:var(--wm-audio-playlist-surface-border,var(--wm-playlist-surface-border,var(--wm-component-border,var(--wapl-border,1px solid var(--wm-border,#d8d8d8)))));' +
        'padding:var(--wm-audio-playlist-surface-padding,var(--wm-playlist-surface-padding,var(--wm-component-padding,.6rem)));' +
        'border-radius:var(--wm-audio-playlist-surface-radius,var(--wm-playlist-surface-radius,var(--wm-component-radius,var(--wapl-radius,var(--wm-control-radius,0)))));' +
        'color:var(--wapl-fg,var(--wm-playlist-text,var(--wm-component-foreground,var(--wm-foreground,#444))));' +
        '--wui-playlist-text:var(--wapl-fg,var(--wm-playlist-text,var(--wm-component-foreground,var(--wm-foreground,#444))));' +
        '--wui-playlist-primary-background:var(--wapl-accent,var(--wm-playlist-primary-background,var(--wm-playlist-button,var(--wm-accent,#111))));' +
        '--wui-playlist-primary-border:var(--wapl-accent,var(--wm-playlist-primary-border,var(--wm-playlist-button-border,var(--wm-accent,#111))));' +
        '--wui-playlist-primary-foreground:var(--wapl-bg,var(--wm-playlist-primary-foreground,var(--wm-playlist-button-text,var(--wm-accent-foreground,#fff))));' +
        '--wui-playlist-accent:var(--wapl-accent,var(--wm-playlist-accent,var(--wm-accent,#999)));' +
        '--wui-playlist-active:var(--wapl-active,var(--wm-playlist-active,rgba(17,17,17,.08)));' +
        '--wui-playlist-muted:var(--wapl-muted,var(--wm-playlist-muted,var(--wm-component-foreground-muted,var(--wm-foreground-muted,#666))));' +
        '--wui-playlist-radius:var(--wapl-radius,var(--wm-playlist-radius,var(--wm-control-radius,0)))}';
    }
    this.root.append(this.compatibilityStyle);
  }

  private teardown(): void {
    if (this.owner && this.owner.transport === this.queue) this.owner.setTransport(undefined);
    for (const off of this.offFns) {
      try {
        off();
      } catch {
        // Unsubscribing must never block teardown.
      }
    }
    this.offFns = [];
    this.ui?.destroy();
    this.ui = undefined;
    try {
      this.queue?.dispose();
    } catch (error) {
      this.dispatch('error', error instanceof Error ? error : new Error(String(error)));
    }
    this.queue = undefined;
  }

  private notifyUI(): void {
    for (const notify of this.subscribers) notify();
  }

  private dispatch(type: string, detail: unknown): void {
    this.dispatchEvent(
      new CustomEvent(`webaudio:${type}`, {detail, bubbles: true, composed: true}),
    );
  }
}

/** Register `<audio-playlist>` (or a custom tag). Idempotent, SSR-safe. */
export function defineAudioPlaylistElement(tag = 'audio-playlist'): void {
  defineOnce(tag, AudioPlaylistElement);
}
