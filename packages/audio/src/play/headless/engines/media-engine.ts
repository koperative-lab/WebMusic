// ============================================================================
// Streaming playback engine.
//
// The engine owns transport state but has no browser-surface dependency. A
// host adapter supplies the streaming source and its audio-graph connection.
// The styled element package provides a browser adapter; other runtimes can
// inject their own implementation.
// ============================================================================

import type {AudioClip} from '../../../core';
import {normalizeLoopOption, type PlaybackEngine} from './buffer-engine';
import {createTickSource, type TickSource} from '@webmusic/kernel/tick';

export interface MediaPlaybackAdapter {
  readonly duration: number;
  readonly paused: boolean;
  readonly ended: boolean;
  currentTime: number;
  playbackRate: number;
  preservesPitch?: boolean;
  loop: boolean;
  onended: (() => void) | null;
  play(): void | Promise<void>;
  pause(): void;
  /** Connect the adapter's audio output to the engine output. */
  connect(destination: AudioNode): void;
  disconnect?(): void;
  dispose?(): void;
}

export type MediaPlaybackAdapterFactory = (
  context: BaseAudioContext,
  sourceUrl: string,
) => MediaPlaybackAdapter;

export interface MediaEngineOptions {
  loop?: boolean | {start: number; end: number};
  rate?: number;
  preservesPitch?: boolean;
  /** Runtime-specific streaming adapter. Required before playback or seeking. */
  adapterFactory?: MediaPlaybackAdapterFactory;
}

export class MediaEngine implements PlaybackEngine {
  readonly output: GainNode;
  private readonly context: BaseAudioContext;
  private readonly url: string;
  private readonly adapterFactory?: MediaPlaybackAdapterFactory;
  private adapter: MediaPlaybackAdapter | null = null;
  private rate: number;
  private loop: boolean | {start: number; end: number};
  private preservesPitch: boolean;
  private endedCb: (() => void) | null = null;
  /**
   * Range-loop watcher. Worker-backed where the platform allows: a main-thread
   * interval is clamped to >=1s in a hidden tab (and to once a minute under
   * intensive throttling), which would overshoot the loop end audibly every
   * pass. The kernel source falls back to a main-thread interval itself when
   * no Worker is available.
   */
  private loopTicker: TickSource | null = null;
  private declaredDuration: number;
  private readonly sourceOffset: number;
  private readonly boundedSource: boolean;
  private playbackGeneration = 0;
  private wantsPlayback = false;
  private disposed = false;

  constructor(context: BaseAudioContext, clip: AudioClip, options: MediaEngineOptions = {}) {
    if (!clip.sourceUrl) throw new Error('MediaEngine requires a clip with a sourceUrl');
    this.context = context;
    this.url = clip.sourceUrl;
    this.adapterFactory = options.adapterFactory;
    this.rate = options.rate ?? 1;
    this.loop = normalizeLoopOption(options.loop ?? false);
    this.preservesPitch = options.preservesPitch ?? true;
    this.declaredDuration = clip.duration;
    this.sourceOffset = clip.sourceOffsetSeconds ?? 0;
    this.boundedSource = clip.sourceOffsetSeconds !== undefined;
    this.output = context.createGain();
  }

  get duration(): number {
    const real = this.adapter?.duration;
    if (!real || !Number.isFinite(real)) return this.declaredDuration;
    const available = Math.max(0, real - this.sourceOffset);
    return this.boundedSource ? Math.min(this.declaredDuration, available) : available;
  }

  get playing(): boolean {
    return !!this.adapter && !this.adapter.paused && !this.adapter.ended;
  }

  get currentTime(): number {
    return this.adapter
      ? Math.max(0, Math.min(this.duration, this.adapter.currentTime - this.sourceOffset))
      : 0;
  }

  async play(offsetSeconds?: number, _when?: number): Promise<void> {
    if (this.disposed) return;
    const adapter = this.ensureAdapter();
    // Per the PlaybackEngine contract, play() on a running engine is a no-op:
    // the offset positions a START. Applying it here made this engine alone
    // treat `play(offset)` as a live seek, so the same call relocated audio on
    // the media engine and did nothing on the buffer engine. `seek()` is the
    // operation that moves a running playhead, and both engines honour it.
    if (this.playing) return;
    const generation = ++this.playbackGeneration;
    this.wantsPlayback = true;
    if (offsetSeconds !== undefined) adapter.currentTime = this.sourceTime(offsetSeconds);
    try {
      await adapter.play();
    } catch (error) {
      // A pause/stop/dispose may abort a pending HTMLMediaElement.play().
      // The newer command owns the outcome; only an active start reports a
      // playback failure to its caller.
      if (generation !== this.playbackGeneration || this.disposed) return;
      this.wantsPlayback = false;
      this.clearLoopTimer();
      try {
        adapter.pause();
      } catch {
        /* preserve the start failure */
      }
      throw error;
    }
    if (generation !== this.playbackGeneration || this.disposed) {
      // Some adapters begin output only when their play promise settles. A
      // pause before settlement must retract that late start, while a newer
      // play request must remain audible.
      if (!this.wantsPlayback || this.disposed) {
        try {
          adapter.pause();
        } catch {
          /* the adapter may already have been released */
        }
      }
      return;
    }
    if (typeof this.loop === 'object' || this.boundedSource) this.startLoopTimer();
  }

  pause(): void {
    this.playbackGeneration++;
    this.wantsPlayback = false;
    this.clearLoopTimer();
    this.adapter?.pause();
  }

  stop(): void {
    this.playbackGeneration++;
    this.wantsPlayback = false;
    this.clearLoopTimer();
    if (!this.adapter) return;
    this.adapter.pause();
    this.adapter.currentTime = this.sourceOffset;
  }

  seek(seconds: number): void {
    if (this.disposed) return;
    this.ensureAdapter().currentTime = this.sourceTime(seconds);
  }

  setRate(rate: number): void {
    if (this.disposed) return;
    this.rate = Math.max(0.25, Math.min(4, rate));
    if (this.adapter) {
      this.adapter.playbackRate = this.rate;
      this.adapter.preservesPitch = this.preservesPitch;
    }
  }

  /**
   * Change pitch preservation on a running engine. The media element applies
   * it live, which is what makes a `preserves-pitch` attribute change a real
   * update instead of a player rebuild.
   */
  setPreservesPitch(preservesPitch: boolean): void {
    if (this.disposed) return;
    this.preservesPitch = preservesPitch;
    if (this.adapter) this.adapter.preservesPitch = preservesPitch;
  }

  setLoop(loop: boolean | {start: number; end: number}): void {
    if (this.disposed) return;
    this.loop = normalizeLoopOption(loop);
    if (!this.adapter) return;
    if (typeof loop === 'boolean') {
      this.adapter.loop = loop && !this.boundedSource;
      this.clearLoopTimer();
    } else {
      this.adapter.loop = false;
    }
    if (this.playing && (typeof loop === 'object' || this.boundedSource)) {
      this.startLoopTimer();
    }
  }

  onEnded(cb: () => void): void {
    if (!this.disposed) this.endedCb = cb;
  }

  /**
   * Build the media element and let it start buffering (the browser adapter
   * asks for `preload="auto"`). Without this, a streaming entry begins its
   * network fetch only at `play()`.
   */
  prepare(): void {
    if (this.disposed) return;
    this.ensureAdapter();
  }

  dispose(): void {
    this.disposed = true;
    this.playbackGeneration++;
    this.wantsPlayback = false;
    this.clearLoopTimer();
    const adapter = this.adapter;
    // Clear ownership before invoking host code so repeated disposal remains
    // idempotent even when an adapter cleanup hook throws.
    this.adapter = null;
    this.endedCb = null;
    if (adapter) releaseAdapter(adapter);
    try {
      this.output.disconnect();
    } catch {
      /* already disconnected */
    }
  }

  private ensureAdapter(): MediaPlaybackAdapter {
    if (this.adapter) return this.adapter;
    if (!this.adapterFactory) {
      throw new Error(
        'MediaEngine requires an adapterFactory. Pass AudioClipPlayerOptions.mediaAdapterFactory for streaming playback.',
      );
    }
    const adapter = this.adapterFactory(this.context, this.url);
    try {
      adapter.playbackRate = this.rate;
      adapter.preservesPitch = this.preservesPitch;
      adapter.onended = () => {
        if (!this.wantsPlayback || this.disposed) return;
        if (this.loopBounds()) {
          // A range loop that raced the watcher to the end of the media:
          // wrap explicitly rather than parking with the end suppressed.
          this.wrapAtNaturalEnd();
          return;
        }
        if (this.loop !== true || this.boundedSource) {
          // Metadata can make a configured range empty. It must then finish
          // normally instead of suppressing both replay and the end event.
          this.wantsPlayback = false;
          this.clearLoopTimer();
          this.endedCb?.();
        }
      };
      adapter.connect(this.output);
      if (this.sourceOffset > 0) adapter.currentTime = this.sourceOffset;
    } catch (error) {
      // The adapter may have allocated a streaming source before its graph
      // connection failed. It is not installed on the engine yet, so release
      // that local resource here rather than relying on dispose().
      releaseAdapter(adapter);
      throw error;
    }
    this.adapter = adapter;
    adapter.loop = typeof this.loop === 'boolean' && !this.boundedSource ? this.loop : false;
    return adapter;
  }

  /**
   * Effective range-loop bounds, clamped to what the media can actually play.
   * The declared clip duration may exceed the real one (it is metadata, known
   * before the stream loads), and an end at or past the real duration lets the
   * element reach its natural end before the watcher ever sees the boundary.
   */
  private loopBounds(): {start: number; end: number} | null {
    if (this.loop === false || (this.loop === true && !this.boundedSource)) return null;
    const duration = this.duration;
    const start = typeof this.loop === 'object' ? Math.max(0, this.loop.start) : 0;
    const end = Number.isFinite(duration) && duration > 0
      ? Math.min(duration, typeof this.loop === 'object' ? this.loop.end : duration)
      : typeof this.loop === 'object' ? this.loop.end : duration;
    return end > start ? {start, end} : null;
  }

  private startLoopTimer(): void {
    this.clearLoopTimer();
    if (!this.boundedSource && typeof this.loop !== 'object') return;
    this.loopTicker = createTickSource({intervalMs: 30});
    this.loopTicker.start(() => this.checkLoopBoundary());
  }

  private checkLoopBoundary(): void {
    const bounds = this.loopBounds();
    if (!bounds && !this.boundedSource) {
      this.clearLoopTimer();
      return;
    }
    if (!this.adapter) return;
    const end = bounds?.end ?? this.duration;
    if (this.currentTime < end) return;
    if (bounds) this.adapter.currentTime = this.sourceTime(bounds.start);
    else {
      this.wantsPlayback = false;
      this.clearLoopTimer();
      this.adapter.pause();
      this.endedCb?.();
    }
  }

  /**
   * Natural end under a range loop. The watcher polls, so the element can
   * reach the end of the media first — and the `onended` handler suppresses
   * the end callback while a range loop is active. Without an explicit wrap
   * here the engine parked in a paused state with the loop never wrapping
   * again and no end reported: wedged.
   */
  private wrapAtNaturalEnd(): void {
    const bounds = this.loopBounds();
    const adapter = this.adapter;
    if (!bounds || !adapter) return;
    adapter.currentTime = this.sourceTime(bounds.start);
    // Route the automatic replay through the same generation guard as public
    // play(). A pause/stop/dispose while the host promise is pending must
    // retract a late start. No caller awaits this event-driven restart.
    void this.play().catch(() => {});
  }

  private clearLoopTimer(): void {
    if (this.loopTicker) {
      this.loopTicker.dispose();
      this.loopTicker = null;
    }
  }

  private sourceTime(clipSeconds: number): number {
    const position = Math.max(0, clipSeconds);
    return this.sourceOffset + (this.boundedSource ? Math.min(position, this.duration) : position);
  }
}

/** Best-effort release across a host-owned adapter boundary. */
function releaseAdapter(adapter: MediaPlaybackAdapter): void {
  const actions: Array<() => void> = [
    () => adapter.pause(),
    () => {
      adapter.onended = null;
    },
    () => adapter.disconnect?.(),
    () => adapter.dispose?.(),
  ];
  for (const action of actions) {
    try {
      action();
    } catch {
      /* continue releasing the remaining resources */
    }
  }
}
