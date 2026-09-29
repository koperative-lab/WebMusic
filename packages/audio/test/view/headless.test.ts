import {createAudioClip, createRegion, type AudioPeaks} from '../../src/core';
import {describe, expect, it, vi} from 'vitest';
import {
  bindPlayerToAudioTimeline,
  calculateLevelMeter,
  calculateSpectrumBars,
  computeClipPeaks,
  createAudioTimeline,
  createSpectrogramViewModel,
  createWaveformViewModel,
  fitWaveformColumns,
  peaksDuration,
} from '../../src/view/headless';

describe('AudioTimeline', () => {
  it('tracks zoom, viewport, follow and region hit-testing as code state', () => {
    const region = createRegion({label: 'chorus', startSeconds: 4, endSeconds: 6});
    const timeline = createAudioTimeline({
      durationSeconds: 10,
      pixelsPerSecond: 100,
      viewportWidth: 200,
      regions: [region],
    });
    timeline.setPlayhead(5);
    timeline.followPlayhead();
    expect(timeline.snapshot.offsetPixels).toBe(400);
    expect(timeline.hitTest(100)).toEqual({seconds: 5, region});

    timeline.setZoom(200, 5);
    expect(timeline.snapshot.offsetPixels).toBe(900);
    expect(timeline.visibleRange()).toEqual({startSeconds: 4.5, endSeconds: 5.5});
  });

  it.each([NaN, Infinity, -Infinity])('uses the current playhead for a nonfinite zoom anchor (%s)', (anchor) => {
    const timeline = createAudioTimeline({
      durationSeconds: 10,
      pixelsPerSecond: 100,
      viewportWidth: 200,
      offsetPixels: 300,
      playheadSeconds: 4,
    });
    timeline.setZoom(200, anchor);
    expect(timeline.snapshot.offsetPixels).toBe(700);
    expect(timeline.hitTest(100).seconds).toBe(4);
    expect(timeline.visibleRange()).toEqual({startSeconds: 3.5, endSeconds: 4.5});
  });

  it('notifies subscribers only when observable state changes and cleans up idempotently', () => {
    const timeline = createAudioTimeline({durationSeconds: 10});
    const notify = vi.fn();
    const unsubscribe = timeline.subscribe(notify);

    timeline.setPlayhead(2);
    timeline.setPlayhead(2);
    timeline.setRegions([]);
    expect(notify).toHaveBeenCalledTimes(2);

    unsubscribe();
    unsubscribe();
    timeline.setOffset(10);
    expect(notify).toHaveBeenCalledTimes(2);
  });

  it('isolates synchronous subscriber throws and consumes rejected async listeners', async () => {
    const timeline = createAudioTimeline({durationSeconds: 10});
    const syncFailure = vi.fn(() => {
      throw new Error('observer failed');
    });
    const asyncFailure = vi.fn(async () => {
      throw new Error('async observer failed');
    });
    const observed: number[] = [];

    timeline.subscribe(syncFailure);
    timeline.subscribe(asyncFailure);
    timeline.subscribe(() => observed.push(timeline.snapshot.playheadSeconds));

    expect(() => timeline.setPlayhead(3)).not.toThrow();
    expect(syncFailure).toHaveBeenCalledOnce();
    expect(asyncFailure).toHaveBeenCalledOnce();
    expect(observed).toEqual([3]);
    await Promise.resolve();
    await Promise.resolve();
  });

  it('applies external viewport geometry atomically under the new zoom', () => {
    const timeline = createAudioTimeline({
      durationSeconds: 100,
      pixelsPerSecond: 10,
      viewportWidth: 100,
      offsetPixels: 400,
    });
    const notify = vi.fn();
    timeline.subscribe(notify);

    timeline.setGeometry({pixelsPerSecond: 100, viewportWidth: 200, offsetPixels: 4_900});

    expect(timeline.snapshot).toMatchObject({
      pixelsPerSecond: 100,
      viewportWidth: 200,
      offsetPixels: 4_900,
      contentWidth: 10_000,
    });
    expect(notify).toHaveBeenCalledOnce();
  });
});

describe('headless view models', () => {
  it('keeps a decoded empty clip empty through peaks and waveform projection', () => {
    const clip = createAudioClip({sampleRate: 48_000, channelData: [new Float32Array(0)]});
    const peaks = computeClipPeaks(clip)!;
    expect(peaks.levels).toHaveLength(1);
    expect(peaks.levels[0].data).toHaveLength(0);
    expect(peaksDuration(peaks)).toBe(0);
    expect(fitWaveformColumns(peaks, 800)).toEqual([]);
    expect(createWaveformViewModel(peaks, {viewportWidth: 800}).columns()).toEqual([]);
  });

  it('returns visible waveform peak columns without a rendering surface', () => {
    const peaks: AudioPeaks = {
      sampleRate: 8,
      channels: 1,
      baseSamplesPerPeak: 2,
      levels: [{samplesPerPeak: 2, data: new Int8Array([-128, 64, -64, 96, -32, 127, 0, 32])}],
    };
    const view = createWaveformViewModel(peaks, {pixelsPerSecond: 4, viewportWidth: 4});
    expect(view.columns()).toEqual([
      {x: 0, seconds: 0, peaks: [{min: -1, max: 0.5}]},
      {x: 1, seconds: 0.25, peaks: [{min: -0.5, max: 0.75}]},
      {x: 2, seconds: 0.5, peaks: [{min: -0.25, max: 127 / 128}]},
      {x: 3, seconds: 0.75, peaks: [{min: 0, max: 0.25}]},
    ]);

    const zoomedOut = createWaveformViewModel(peaks, {pixelsPerSecond: 2, viewportWidth: 2});
    expect(zoomedOut.columns()).toEqual([
      {x: 0, seconds: 0, peaks: [{min: -1, max: 0.75}]},
      {x: 1, seconds: 0.5, peaks: [{min: -0.25, max: 127 / 128}]},
    ]);

    expect(peaksDuration(peaks)).toBe(1);
    expect(fitWaveformColumns(peaks, 4)).toEqual(view.columns());
  });

  it('selects visible spectrogram frames and a frequency window', () => {
    const view = createSpectrogramViewModel(
      {
        times: [0, 0.5, 1],
        frequencies: [0, 100, 200],
        binsPerFrame: 3,
        magnitudes: new Float32Array([1, 2, 3, 4, 5, 6, 7, 8, 9]),
      },
      {durationSeconds: 1.5, pixelsPerSecond: 100, viewportWidth: 100, minFrequency: 100, maxFrequency: 200},
    );
    const frames = view.frames();
    expect(frames.map((frame) => frame.seconds)).toEqual([0, 0.5, 1]);
    expect(Array.from(frames[1].frequencies)).toEqual([100, 200]);
    expect(Array.from(frames[1].magnitudes)).toEqual([5, 6]);
  });
});

describe('headless meter calculations', () => {
  it('calculates level state and spectrum bars', () => {
    expect(calculateLevelMeter([-1, 0, 1], {previousPeak: 0.5})).toEqual({
      rms: Math.sqrt(2 / 3),
      peak: 1,
      peakHold: 1,
    });
    expect(Array.from(calculateSpectrumBars([0, 255, 128, 64], {bars: 2}))).toEqual([
      0.5,
      expect.closeTo(96 / 255, 5),
    ]);
  });
});

describe('bindPlayerToAudioTimeline', () => {
  it('updates a playhead model and cleans up listeners', () => {
    const listeners = new Map<string, (payload: unknown) => void>();
    const cleanups: Array<ReturnType<typeof vi.fn>> = [];
    const player = {
      seconds: 2,
      duration: 10,
      seek: vi.fn(),
      on(event: string, listener: (payload: unknown) => void) {
        listeners.set(event, listener);
        const cleanup = vi.fn();
        cleanups.push(cleanup);
        return cleanup;
      },
    };
    const target = {setPlayhead: vi.fn(), followPlayhead: vi.fn()};
    const binding = bindPlayerToAudioTimeline(player, target, {followPlayhead: true});
    listeners.get('timeupdate')?.({seconds: 3});
    expect(target.setPlayhead).toHaveBeenCalledWith(3);
    expect(target.followPlayhead).toHaveBeenCalled();
    listeners.get('end')?.({});
    expect(target.setPlayhead).toHaveBeenLastCalledWith(0);
    binding.unsubscribe();
    binding.unsubscribe();
    expect(cleanups.every((cleanup) => cleanup.mock.calls.length === 1)).toBe(true);
  });

  it('rolls back partial subscriptions and completes cleanup after an error', () => {
    const rollback = vi.fn();
    const subscribeError = new Error('end subscription failed');
    const brokenPlayer = {
      seconds: 0,
      duration: 1,
      seek: vi.fn(),
      on(event: string) {
        if (event === 'timeupdate') return rollback;
        throw subscribeError;
      },
    };
    expect(() => bindPlayerToAudioTimeline(brokenPlayer, {setPlayhead: vi.fn()})).toThrow(subscribeError);
    expect(rollback).toHaveBeenCalledOnce();

    const firstError = new Error('first cleanup failed');
    const first = vi.fn(() => {
      throw firstError;
    });
    const second = vi.fn();
    const player = {
      seconds: 0,
      duration: 1,
      seek: vi.fn(),
      on: vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(second),
    };
    const binding = bindPlayerToAudioTimeline(player, {setPlayhead: vi.fn()});
    expect(() => binding.unsubscribe()).toThrow(firstError);
    expect(first).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledOnce();
    expect(() => binding.unsubscribe()).not.toThrow();

    const nullCleanup = vi.fn(() => {
      throw null;
    });
    const laterFailure = new Error('later cleanup failed');
    const laterCleanup = vi.fn(() => {
      throw laterFailure;
    });
    const sentinelPlayer = {
      seconds: 0,
      duration: 1,
      seek: vi.fn(),
      on: vi.fn().mockReturnValueOnce(nullCleanup).mockReturnValueOnce(laterCleanup),
    };
    const sentinelBinding = bindPlayerToAudioTimeline(
      sentinelPlayer,
      {setPlayhead: vi.fn()},
    );
    expect(captureThrown(() => sentinelBinding.unsubscribe())).toEqual({
      failed: true,
      error: null,
    });
    expect(nullCleanup).toHaveBeenCalledOnce();
    expect(laterCleanup).toHaveBeenCalledOnce();
  });
});

function captureThrown(action: () => void): {failed: boolean; error: unknown} {
  try {
    action();
    return {failed: false, error: undefined};
  } catch (error) {
    return {failed: true, error};
  }
}
