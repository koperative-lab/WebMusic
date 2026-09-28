import type {Region} from '../../core';
import {visibleTimeRange} from '../core/windowing';

export interface AudioTimelineOptions {
  durationSeconds: number;
  pixelsPerSecond?: number;
  viewportWidth?: number;
  offsetPixels?: number;
  playheadSeconds?: number;
  regions?: readonly Region[];
}

export interface AudioTimelineSnapshot {
  durationSeconds: number;
  pixelsPerSecond: number;
  viewportWidth: number;
  offsetPixels: number;
  playheadSeconds: number;
  contentWidth: number;
}

export interface AudioTimelineHit {
  seconds: number;
  region?: Region;
}

/** Atomic geometry update used when synchronizing an external viewport. */
export interface AudioTimelineGeometryUpdate {
  pixelsPerSecond?: number;
  viewportWidth?: number;
  offsetPixels?: number;
}

/** Notification emitted after observable timeline state changes. */
export type AudioTimelineSubscriber = () => void;

/** Stateful, render-agnostic timeline geometry for audio views. */
export class AudioTimeline {
  #durationSeconds: number;
  #pixelsPerSecond: number;
  #viewportWidth: number;
  #offsetPixels: number;
  #playheadSeconds: number;
  #regions: readonly Region[];
  readonly #subscribers = new Set<AudioTimelineSubscriber>();

  constructor(options: AudioTimelineOptions) {
    this.#durationSeconds = finiteNonNegative(options.durationSeconds);
    this.#pixelsPerSecond = finitePositive(options.pixelsPerSecond, 100);
    this.#viewportWidth = finiteNonNegative(options.viewportWidth);
    this.#offsetPixels = finiteNonNegative(options.offsetPixels);
    this.#playheadSeconds = finiteNonNegative(options.playheadSeconds);
    this.#regions = [...(options.regions ?? [])];
    this.#clampState();
  }

  get snapshot(): AudioTimelineSnapshot {
    return {
      durationSeconds: this.#durationSeconds,
      pixelsPerSecond: this.#pixelsPerSecond,
      viewportWidth: this.#viewportWidth,
      offsetPixels: this.#offsetPixels,
      playheadSeconds: this.#playheadSeconds,
      contentWidth: this.#durationSeconds * this.#pixelsPerSecond,
    };
  }

  get regions(): readonly Region[] {
    return this.#regions;
  }

  /**
   * Subscribe to geometry, playhead and region changes. The timeline remains
   * renderer-agnostic; browser presenters use this hook to schedule their own
   * paints. The returned cleanup is idempotent.
   */
  subscribe(subscriber: AudioTimelineSubscriber): () => void {
    this.#subscribers.add(subscriber);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      this.#subscribers.delete(subscriber);
    };
  }

  setDuration(durationSeconds: number): void {
    const before = this.snapshot;
    this.#durationSeconds = finiteNonNegative(durationSeconds);
    this.#clampState();
    this.#notifyIfChanged(before);
  }

  setZoom(pixelsPerSecond: number, anchorSeconds: number = this.#playheadSeconds): void {
    const before = this.snapshot;
    const nextZoom = finitePositive(pixelsPerSecond, this.#pixelsPerSecond);
    const anchor = clamp(
      Number.isFinite(anchorSeconds) ? anchorSeconds : this.#playheadSeconds,
      0,
      this.#durationSeconds,
    );
    const anchorInViewport = anchor * this.#pixelsPerSecond - this.#offsetPixels;
    this.#pixelsPerSecond = nextZoom;
    this.#offsetPixels = anchor * nextZoom - anchorInViewport;
    this.#clampState();
    this.#notifyIfChanged(before);
  }

  setViewport(viewportWidth: number): void {
    this.setGeometry({viewportWidth});
  }

  setOffset(offsetPixels: number): void {
    this.setGeometry({offsetPixels});
  }

  /** Apply zoom, measured width and offset as one observable transaction. */
  setGeometry(update: AudioTimelineGeometryUpdate): void {
    const before = this.snapshot;
    if (update.pixelsPerSecond !== undefined) {
      this.#pixelsPerSecond = finitePositive(update.pixelsPerSecond, this.#pixelsPerSecond);
    }
    if (update.viewportWidth !== undefined) {
      this.#viewportWidth = finiteNonNegative(update.viewportWidth);
    }
    if (update.offsetPixels !== undefined) {
      this.#offsetPixels = finiteNonNegative(update.offsetPixels);
    }
    this.#clampState();
    this.#notifyIfChanged(before);
  }

  setPlayhead(playheadSeconds: number): void {
    const before = this.snapshot;
    this.#playheadSeconds = clamp(finiteNonNegative(playheadSeconds), 0, this.#durationSeconds);
    this.#notifyIfChanged(before);
  }

  setRegions(regions: readonly Region[]): void {
    this.#regions = [...regions];
    this.#notify();
  }

  /** Move the viewport so the playhead sits at `anchor` (0 = left, 1 = right). */
  followPlayhead(anchor: number = 0.5): void {
    const safeAnchor = clamp(Number.isFinite(anchor) ? anchor : 0.5, 0, 1);
    this.setOffset(this.#playheadSeconds * this.#pixelsPerSecond - this.#viewportWidth * safeAnchor);
  }

  visibleRange(bufferScreens: number = 0): {startSeconds: number; endSeconds: number} {
    return visibleTimeRange(
      this.#offsetPixels,
      this.#viewportWidth,
      this.#pixelsPerSecond,
      this.#durationSeconds,
      bufferScreens,
    );
  }

  /** Resolve a viewport-relative x coordinate to timeline data. */
  hitTest(x: number): AudioTimelineHit {
    const contentX = this.#offsetPixels + (Number.isFinite(x) ? x : 0);
    const seconds = clamp(contentX / this.#pixelsPerSecond, 0, this.#durationSeconds);
    const region = this.#regions.find((candidate) => {
      const end = candidate.endSeconds ?? candidate.startSeconds;
      return seconds >= candidate.startSeconds && seconds <= end;
    });
    return region ? {seconds, region} : {seconds};
  }

  #clampState(): void {
    const maxOffset = Math.max(0, this.#durationSeconds * this.#pixelsPerSecond - this.#viewportWidth);
    this.#offsetPixels = clamp(this.#offsetPixels, 0, maxOffset);
    this.#playheadSeconds = clamp(this.#playheadSeconds, 0, this.#durationSeconds);
  }

  #notifyIfChanged(before: AudioTimelineSnapshot): void {
    const after = this.snapshot;
    if (
      before.durationSeconds === after.durationSeconds &&
      before.pixelsPerSecond === after.pixelsPerSecond &&
      before.viewportWidth === after.viewportWidth &&
      before.offsetPixels === after.offsetPixels &&
      before.playheadSeconds === after.playheadSeconds &&
      before.contentWidth === after.contentWidth
    ) {
      return;
    }
    this.#notify();
  }

  #notify(): void {
    for (const subscriber of [...this.#subscribers]) {
      try {
        // The public contract intentionally remains `() => void`, but a
        // caller may still supply an async function because TypeScript permits
        // value-returning callbacks in void positions. Contain that borrowed
        // result so one extension cannot block later subscribers or create an
        // unhandled rejection.
        const result = (subscriber as () => unknown)();
        if (isPromiseLike(result)) void Promise.resolve(result).catch(() => {});
      } catch {
        // Subscribers are borrowed observers. State has already committed, so
        // a reporting failure must not prevent the remaining observers from
        // seeing the same committed snapshot.
      }
    }
  }
}

export function createAudioTimeline(options: AudioTimelineOptions): AudioTimeline {
  return new AudioTimeline(options);
}

function finitePositive(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) && value > 0 ? value : fallback;
}

function finiteNonNegative(value: number | undefined): number {
  return value !== undefined && Number.isFinite(value) && value > 0 ? value : 0;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    (typeof value === 'object' && value !== null) || typeof value === 'function'
  ) && typeof (value as {then?: unknown}).then === 'function';
}
