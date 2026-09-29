import type {
  AudioViewportHandle,
  AudioViewportSnapshot,
  AudioViewportSubscriber,
  AudioViewportUpdate,
} from '../../src/view/api';
import {createAudioTimeline} from '../../src/view/headless';
import {bindAudioTimelineViewport} from '../../src/view/render/viewport-binding';
import {describe, expect, it, vi} from 'vitest';

describe('bindAudioTimelineViewport', () => {
  it('keeps timeline-owned zoom and offset while adopting measured width', () => {
    const timeline = createAudioTimeline({
      durationSeconds: 100,
      pixelsPerSecond: 10,
      offsetPixels: 400,
    });
    const viewport = new FakeViewport({
      durationSeconds: 100,
      pixelsPerSecond: 2,
      viewportWidth: 100,
      offsetPixels: 50,
    });
    const setViewport = vi.spyOn(viewport, 'setViewport');

    const binding = bindAudioTimelineViewport(timeline, viewport);

    expect(timeline.snapshot.viewportWidth).toBe(100);
    expect(timeline.snapshot.pixelsPerSecond).toBe(10);
    expect(timeline.snapshot.offsetPixels).toBe(400);
    expect(viewport.snapshot.pixelsPerSecond).toBe(10);
    expect(viewport.snapshot.offsetPixels).toBe(400);
    expect(setViewport).toHaveBeenCalledOnce();
    expect(setViewport).toHaveBeenCalledWith({pixelsPerSecond: 10, offsetPixels: 400});
    binding.unsubscribe();
  });

  it('synchronizes both directions atomically without feedback loops', () => {
    const timeline = createAudioTimeline({
      durationSeconds: 100,
      pixelsPerSecond: 10,
      viewportWidth: 100,
      offsetPixels: 400,
    });
    const viewport = new FakeViewport({
      durationSeconds: 100,
      pixelsPerSecond: 10,
      viewportWidth: 100,
      offsetPixels: 400,
    });
    const binding = bindAudioTimelineViewport(timeline, viewport);
    const setViewport = vi.spyOn(viewport, 'setViewport');
    const modelNotify = vi.fn();
    const surfaceNotify = vi.fn();
    timeline.subscribe(modelNotify);
    viewport.subscribe(surfaceNotify);

    timeline.setZoom(100, 50);
    expect(timeline.snapshot.offsetPixels).toBe(4_900);
    expect(viewport.snapshot.pixelsPerSecond).toBe(100);
    expect(viewport.snapshot.offsetPixels).toBe(4_900);
    expect(setViewport).toHaveBeenCalledOnce();
    expect(setViewport).toHaveBeenCalledWith({
      pixelsPerSecond: 100,
      offsetPixels: 4_900,
    });
    expect(modelNotify).toHaveBeenCalledOnce();
    expect(surfaceNotify).toHaveBeenCalledOnce();

    setViewport.mockClear();
    modelNotify.mockClear();
    surfaceNotify.mockClear();
    viewport.manualScroll(2_500);
    expect(timeline.snapshot.offsetPixels).toBe(2_500);
    expect(setViewport).not.toHaveBeenCalled();
    expect(modelNotify).toHaveBeenCalledOnce();
    expect(surfaceNotify).toHaveBeenCalledOnce();

    modelNotify.mockClear();
    surfaceNotify.mockClear();
    viewport.resize(500);
    expect(timeline.snapshot.viewportWidth).toBe(500);
    expect(timeline.snapshot.offsetPixels).toBe(2_500);
    expect(setViewport).not.toHaveBeenCalled();
    expect(modelNotify).toHaveBeenCalledOnce();
    expect(surfaceNotify).toHaveBeenCalledOnce();

    setViewport.mockClear();
    modelNotify.mockClear();
    surfaceNotify.mockClear();
    viewport.setViewport({pixelsPerSecond: 50, offsetPixels: 1_250});
    expect(timeline.snapshot.pixelsPerSecond).toBe(50);
    expect(timeline.snapshot.offsetPixels).toBe(1_250);
    expect(setViewport).toHaveBeenCalledOnce();
    expect(modelNotify).toHaveBeenCalledOnce();
    expect(surfaceNotify).toHaveBeenCalledOnce();
    binding.unsubscribe();
  });

  it('unsubscribes idempotently without disposing either borrowed object', () => {
    const timeline = createAudioTimeline({
      durationSeconds: 20,
      pixelsPerSecond: 100,
      viewportWidth: 400,
    });
    const viewport = new FakeViewport({
      durationSeconds: 20,
      pixelsPerSecond: 100,
      viewportWidth: 400,
      offsetPixels: 0,
    });
    const binding = bindAudioTimelineViewport(timeline, viewport);

    expect(viewport.subscribers.size).toBe(1);
    binding.unsubscribe();
    binding.unsubscribe();
    expect(viewport.subscribers.size).toBe(0);

    timeline.setOffset(300);
    expect(viewport.snapshot.offsetPixels).toBe(0);
    viewport.manualScroll(500);
    expect(timeline.snapshot.offsetPixels).toBe(300);
    expect(viewport.snapshot.offsetPixels).toBe(500);
  });

  it('rejects mismatched durations before subscribing or mutating either side', () => {
    const timeline = createAudioTimeline({
      durationSeconds: 10,
      pixelsPerSecond: 100,
      offsetPixels: 200,
    });
    const viewport = new FakeViewport({
      durationSeconds: 11,
      pixelsPerSecond: 50,
      viewportWidth: 300,
      offsetPixels: 100,
    });
    const timelineSubscribe = vi.spyOn(timeline, 'subscribe');
    const viewportSubscribe = vi.spyOn(viewport, 'subscribe');

    expect(() => bindAudioTimelineViewport(timeline, viewport)).toThrow(
      /must represent the same duration/,
    );
    expect(timelineSubscribe).not.toHaveBeenCalled();
    expect(viewportSubscribe).not.toHaveBeenCalled();
    expect(timeline.snapshot.offsetPixels).toBe(200);
    expect(viewport.snapshot.offsetPixels).toBe(100);
  });

  it('rolls back partial setup and completes every cleanup after an error', () => {
    const setupError = new Error('viewport subscribe failed');
    const rollback = vi.fn();
    const setupTimeline = createAudioTimeline({durationSeconds: 10});
    vi.spyOn(setupTimeline, 'subscribe').mockReturnValue(rollback);
    const brokenViewport = new FakeViewport({
      durationSeconds: 10,
      pixelsPerSecond: 100,
      viewportWidth: 200,
      offsetPixels: 0,
    });
    vi.spyOn(brokenViewport, 'subscribe').mockImplementation(() => {
      throw setupError;
    });

    expect(() => bindAudioTimelineViewport(setupTimeline, brokenViewport)).toThrow(setupError);
    expect(rollback).toHaveBeenCalledOnce();

    const laterCleanupError = new Error('timeline cleanup failed');
    const timelineCleanup = vi.fn(() => {
      throw laterCleanupError;
    });
    const viewportCleanup = vi.fn(() => {
      throw undefined;
    });
    const cleanupTimeline = createAudioTimeline({durationSeconds: 10});
    vi.spyOn(cleanupTimeline, 'subscribe').mockReturnValue(timelineCleanup);
    const cleanupViewport = new FakeViewport({
      durationSeconds: 10,
      pixelsPerSecond: 100,
      viewportWidth: 200,
      offsetPixels: 0,
    });
    vi.spyOn(cleanupViewport, 'subscribe').mockReturnValue(viewportCleanup);

    const binding = bindAudioTimelineViewport(cleanupTimeline, cleanupViewport);
    expect(captureThrown(() => binding.unsubscribe())).toEqual({
      failed: true,
      error: undefined,
    });
    expect(viewportCleanup).toHaveBeenCalledOnce();
    expect(timelineCleanup).toHaveBeenCalledOnce();
    expect(() => binding.unsubscribe()).not.toThrow();
  });
});

class FakeViewport implements AudioViewportHandle {
  readonly subscribers = new Set<AudioViewportSubscriber>();
  #snapshot: AudioViewportSnapshot;

  constructor(snapshot: Omit<AudioViewportSnapshot, 'contentWidth'>) {
    this.#snapshot = {
      ...snapshot,
      contentWidth: snapshot.durationSeconds * snapshot.pixelsPerSecond,
    };
  }

  get snapshot(): AudioViewportSnapshot {
    return this.#snapshot;
  }

  setViewport(update: AudioViewportUpdate): void {
    const pixelsPerSecond =
      update.pixelsPerSecond !== undefined &&
      Number.isFinite(update.pixelsPerSecond) &&
      update.pixelsPerSecond > 0
        ? update.pixelsPerSecond
        : this.#snapshot.pixelsPerSecond;
    const requestedOffset =
      update.offsetPixels !== undefined && Number.isFinite(update.offsetPixels)
        ? update.offsetPixels
        : this.#snapshot.offsetPixels;
    this.#publish({
      ...this.#snapshot,
      pixelsPerSecond,
      contentWidth: this.#snapshot.durationSeconds * pixelsPerSecond,
      offsetPixels: requestedOffset,
    });
  }

  subscribe(subscriber: AudioViewportSubscriber): () => void {
    this.subscribers.add(subscriber);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      this.subscribers.delete(subscriber);
    };
  }

  manualScroll(offsetPixels: number): void {
    this.#publish({...this.#snapshot, offsetPixels});
  }

  resize(viewportWidth: number): void {
    this.#publish({...this.#snapshot, viewportWidth});
  }

  #publish(next: AudioViewportSnapshot): void {
    const maxOffset = Math.max(0, next.contentWidth - next.viewportWidth);
    const normalized = {
      ...next,
      offsetPixels: Math.max(0, Math.min(maxOffset, next.offsetPixels)),
    };
    if (sameSnapshot(this.#snapshot, normalized)) return;
    this.#snapshot = normalized;
    for (const subscriber of [...this.subscribers]) subscriber(normalized);
  }
}

function sameSnapshot(left: AudioViewportSnapshot, right: AudioViewportSnapshot): boolean {
  return (
    left.offsetPixels === right.offsetPixels &&
    left.viewportWidth === right.viewportWidth &&
    left.pixelsPerSecond === right.pixelsPerSecond &&
    left.contentWidth === right.contentWidth &&
    left.durationSeconds === right.durationSeconds
  );
}

function captureThrown(action: () => void): {failed: boolean; error: unknown} {
  try {
    action();
    return {failed: false, error: undefined};
  } catch (error) {
    return {failed: true, error};
  }
}
