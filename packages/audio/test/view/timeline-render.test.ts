// @vitest-environment jsdom

import {BeatGrid, Region, RegionId} from '../../src/core';
import type {
  AudioViewportHandle,
  AudioViewportSnapshot,
  AudioViewportSubscriber,
  AudioViewportUpdate,
} from '../../src/view/core/types';
import {createAudioTimeline} from '../../src/view/headless';
import {
  audioTimelineTicks,
  formatAudioTimelinePosition,
  mountAudioTimeline,
} from '../../src/view/render/audio-timeline';
import {afterEach, describe, expect, it, vi} from 'vitest';

afterEach(() => {
  document.body.replaceChildren();
});

describe('mountAudioTimeline', () => {
  it('maps viewport geometry, regions, selection, loop and non-uniform beat ticks', async () => {
    const crossing = region('crossing', 'Crossing', 2, 5, '#2255aa');
    const marker = region('cue', 'Cue', 6, undefined, '#d97706');
    const outside = region('outside', 'Outside', 9, 10);
    const timeline = createAudioTimeline({
      durationSeconds: 12,
      pixelsPerSecond: 100,
      viewportWidth: 400,
      offsetPixels: 400,
      playheadSeconds: 6,
      regions: [crossing, marker, outside],
    });
    const beatGrid = new BeatGrid({
      bpm: 120,
      beats: [4, 4.48, 5.03, 5.55, 6.1, 8],
      downbeats: [4, 8],
    });
    const host = document.createElement('div');
    const handle = mountAudioTimeline(host, timeline, {
      beatGrid,
      selection: {startSeconds: 5, endSeconds: 7},
      loop: {startSeconds: 4.5, endSeconds: 7.5},
      selectedRegionIds: ['cue'],
      seek: vi.fn(),
    });

    expect(handle.seek.min).toBe('4');
    expect(handle.seek.max).toBe('8');
    expect(handle.seek.value).toBe('6');
    expect(handle.seek.getAttribute('aria-valuetext')).toBe('0:06.00');
    expect(handle.lane.querySelector<HTMLElement>('[part="playhead"]')?.style.left).toBe('50%');

    const crossingElement = handle.regionElement('crossing')!;
    expect(crossingElement.style.left).toBe('0%');
    expect(crossingElement.style.width).toBe('25%');
    expect(crossingElement.style.getPropertyValue('--wui-timeline-region-color')).toBe('#2255aa');
    expect(handle.regionElement('cue')?.getAttribute('part')).toContain('marker');
    expect(handle.regionElement('cue')?.getAttribute('aria-pressed')).toBe('true');
    expect(handle.regionElement('outside')).toBeUndefined();

    expect(handle.lane.querySelector<HTMLElement>('[part="selection"]')?.style.left).toBe('25%');
    expect(handle.lane.querySelector<HTMLElement>('[part="selection"]')?.style.width).toBe('50%');
    expect(handle.lane.querySelector<HTMLElement>('[part="loop"]')?.style.left).toBe('12.5%');
    expect(handle.lane.querySelector<HTMLElement>('[part="loop"]')?.style.width).toBe('75%');

    const ticks = handle.ruler.querySelectorAll<HTMLElement>('[part="tick"]');
    expect(ticks).toHaveLength(6);
    expect(ticks[0].dataset.level).toBe('major');
    expect(ticks[0].textContent).toBe('1');
    expect(ticks[1].dataset.level).toBe('minor');
    expect(ticks[1].textContent).toBe('');
    expect(Number.parseFloat(ticks[1].style.left)).toBeCloseTo(12);
    expect(ticks[5].dataset.level).toBe('major');
    expect(ticks[5].textContent).toBe('2');

    const late = region('late', 'Late', 6.5, 7.25);
    timeline.setOffset(500);
    timeline.setZoom(200);
    timeline.setRegions([marker, late]);
    await nextFrame();
    expect(handle.seek.min).toBe('5.5');
    expect(handle.seek.max).toBe('7.5');
    expect(handle.regionElement('crossing')).toBeUndefined();
    expect(handle.regionElement('late')).toBeDefined();
  });

  it('delegates seek, follows player updates and resets the model on end', async () => {
    const timeline = createAudioTimeline({
      durationSeconds: 20,
      pixelsPerSecond: 100,
      viewportWidth: 400,
    });
    const player = playerHarness(2, 20);
    const viewport = viewportHarness(20, 400, 100);
    const host = document.createElement('div');
    const handle = mountAudioTimeline(host, timeline, {
      player,
      viewport,
      followPlayhead: true,
      followAnchor: 0.5,
    });

    expect(host.querySelectorAll('input[type="range"]')).toHaveLength(1);
    expect(handle.seek.getAttribute('aria-label')).toBe('Timeline playhead');

    handle.seek.value = '3';
    handle.seek.dispatchEvent(new Event('input', {bubbles: true}));
    await Promise.resolve();
    expect(player.seek).toHaveBeenCalledWith(3);
    expect(timeline.snapshot.playheadSeconds).toBe(3);

    viewport.manualScroll(400);
    await nextFrame();
    expect(timeline.visibleRange()).toEqual({startSeconds: 4, endSeconds: 8});
    expect(timeline.hitTest(0).seconds).toBe(4);
    expect(handle.seek.min).toBe('4');
    expect(handle.seek.max).toBe('8');

    player.emit('timeupdate', {seconds: 10});
    await nextFrame();
    expect(timeline.snapshot.offsetPixels).toBe(800);
    expect(viewport.snapshot.offsetPixels).toBe(800);
    expect(handle.seek.min).toBe('8');
    expect(handle.seek.max).toBe('12');
    expect(handle.seek.value).toBe('10');
    expect(handle.lane.querySelector<HTMLElement>('[part="playhead"]')?.style.left).toBe('50%');

    player.emit('end', undefined);
    await nextFrame();
    expect(timeline.snapshot.playheadSeconds).toBe(0);
    expect(timeline.snapshot.offsetPixels).toBe(0);
    expect(viewport.snapshot.offsetPixels).toBe(0);
    expect(handle.seek.min).toBe('0');
    expect(handle.seek.max).toBe('4');
    expect(handle.seek.value).toBe('0');
    expect(handle.lane.querySelector<HTMLElement>('[part="playhead"]')?.style.left).toBe('0%');

    handle.destroy();
    expect(viewport.subscribers.size).toBe(0);
  });

  it('keeps selection controlled and returns the original Region to commands', async () => {
    const verse = region('verse', 'Verse', 2, 6);
    const timeline = createAudioTimeline({durationSeconds: 8, regions: [verse]});
    let selectedIds: readonly string[] = [];
    const selectRegion = vi.fn((selected: Region) => {
      selectedIds = [String(selected.id)];
    });
    const host = document.createElement('div');
    const handle = mountAudioTimeline(host, timeline, {
      selectedRegionIds: () => selectedIds,
      selectRegion,
    });

    handle.regionElement('verse')!.dispatchEvent(
      new MouseEvent('click', {bubbles: true, ctrlKey: true}),
    );
    await Promise.resolve();
    await nextFrame();

    expect(selectRegion).toHaveBeenCalledWith(verse, {additive: true});
    expect(handle.regionElement('verse')?.getAttribute('aria-pressed')).toBe('true');
    expect(timeline.regions[0]).toBe(verse);
  });

  it('restores UI state after async command failure and contains reporter rejection', async () => {
    const timeline = createAudioTimeline({durationSeconds: 8, playheadSeconds: 2});
    const error = new Error('seek rejected');
    const onError = vi.fn(async () => {
      throw new Error('reporter rejected');
    });
    const host = document.createElement('div');
    const handle = mountAudioTimeline(host, timeline, {
      seek: () => Promise.reject(error),
      onError,
    });

    handle.seek.value = '6';
    handle.seek.dispatchEvent(new Event('input', {bubbles: true}));
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await nextFrame();

    expect(onError).toHaveBeenCalledWith(error);
    expect(timeline.snapshot.playheadSeconds).toBe(2);
    expect(handle.seek.value).toBe('2');
  });

  it('rolls back presenter and viewport after player subscription setup fails', () => {
    const timeline = createAudioTimeline({durationSeconds: 8});
    const viewport = viewportHarness(8, 400, 100);
    const playerRollback = vi.fn(() => {
      throw undefined;
    });
    const setupError = new Error('end subscription failed');
    const player = {
      seconds: 0,
      duration: 8,
      seek: vi.fn(),
      on(event: string) {
        if (event === 'timeupdate') return playerRollback;
        throw setupError;
      },
    };
    const host = document.createElement('div');

    expect(() => mountAudioTimeline(host, timeline, {player, viewport})).toThrow(
      setupError,
    );
    expect(playerRollback).toHaveBeenCalledOnce();
    expect(viewport.subscribers.size).toBe(0);
    expect(host.querySelector('.wui-timeline')).toBeNull();
  });

  it('preserves an undefined first cleanup failure while completing teardown', () => {
    const timeline = createAudioTimeline({durationSeconds: 8});
    const firstPlayerCleanup = vi.fn(() => {
      throw undefined;
    });
    const secondPlayerCleanup = vi.fn();
    const player = {
      seconds: 0,
      duration: 8,
      seek: vi.fn(),
      on: vi
        .fn()
        .mockReturnValueOnce(firstPlayerCleanup)
        .mockReturnValueOnce(secondPlayerCleanup),
    };
    const viewport = viewportHarness(8, 400, 100);
    const viewportFailure = new Error('viewport cleanup failed');
    const viewportCleanup = vi.fn(() => {
      throw viewportFailure;
    });
    viewport.subscribe = vi.fn(() => viewportCleanup);
    const host = document.createElement('div');
    const handle = mountAudioTimeline(host, timeline, {player, viewport});

    expect(captureThrown(() => handle.destroy())).toEqual({
      failed: true,
      error: undefined,
    });
    expect(firstPlayerCleanup).toHaveBeenCalledOnce();
    expect(secondPlayerCleanup).toHaveBeenCalledOnce();
    expect(viewportCleanup).toHaveBeenCalledOnce();
    expect(host.querySelector('.wui-timeline')).toBeNull();
    expect(() => handle.destroy()).not.toThrow();
  });

  it('destroys the whole previous adapter on remount and preserves caller DOM', async () => {
    const host = document.createElement('div');
    const sentinel = document.createElement('span');
    host.append(sentinel);
    const firstPlayer = playerHarness(0, 8);
    const firstViewport = viewportHarness(8, 400, 100);
    const firstTimeline = createAudioTimeline({durationSeconds: 8});
    const first = mountAudioTimeline(host, firstTimeline, {
      player: firstPlayer,
      viewport: firstViewport,
    });
    firstTimeline.setPlayhead(4); // queue a presenter paint before remount

    const secondPlayer = playerHarness(0, 8);
    const secondViewport = viewportHarness(8, 400, 100);
    const secondTimeline = createAudioTimeline({durationSeconds: 8});
    const second = mountAudioTimeline(host, secondTimeline, {
      player: secondPlayer,
      viewport: secondViewport,
    });
    firstPlayer.emit('timeupdate', {seconds: 6});
    await nextFrame();

    expect(host.contains(sentinel)).toBe(true);
    expect(host.querySelectorAll('.wui-timeline')).toHaveLength(1);
    expect(firstPlayer.cleanups.every((cleanup) => cleanup.mock.calls.length === 1)).toBe(true);
    expect(firstViewport.subscribers.size).toBe(0);
    expect(firstTimeline.snapshot.playheadSeconds).toBe(4);
    expect(second.seek.value).toBe('0');

    first.destroy();
    expect(host.querySelectorAll('.wui-timeline')).toHaveLength(1);
    second.destroy();
    second.destroy();
    expect(host.contains(sentinel)).toBe(true);
    expect(secondPlayer.cleanups.every((cleanup) => cleanup.mock.calls.length === 1)).toBe(true);
    expect(secondViewport.subscribers.size).toBe(0);
  });
});

describe('Audio timeline presenter helpers', () => {
  it('formats long positions and creates stable beat ticks', () => {
    expect(formatAudioTimelinePosition(3661.259)).toBe('1:01:01.26');
    const ticks = audioTimelineTicks(new BeatGrid({bpm: 60, beats: [0, 1, 2]}));
    expect(ticks.map((tick) => [tick.id, tick.label, tick.level])).toEqual([
      ['beat-0', '1', 'major'],
      ['beat-1', '2', 'major'],
      ['beat-2', '3', 'major'],
    ]);
  });

  it('strictly caps dense visible grids while prioritizing stable downbeat labels', () => {
    const beats = Array.from({length: 399}, (_, index) => index);
    const downbeats = beats.filter((_, index) => index % 2 === 1);
    const ticks = audioTimelineTicks(
      new BeatGrid({bpm: 60, beats, downbeats}),
      {startSeconds: 0, endSeconds: 398},
    );

    expect(ticks.length).toBeLessThanOrEqual(200);
    expect(ticks[0].id).toBe('beat-0');
    expect(ticks.at(-1)?.id).toBe('beat-397');
    const majorTicks = ticks.filter((tick) => tick.level === 'major');
    expect(majorTicks).toHaveLength(downbeats.length);
    expect(majorTicks[0].label).toBe('1');
    expect(majorTicks.at(-1)?.label).toBe(String(downbeats.length));
  });
});

function region(
  id: string,
  label: string,
  startSeconds: number,
  endSeconds?: number,
  color?: string,
): Region {
  return new Region({
    id: RegionId(id),
    label,
    startSeconds,
    ...(endSeconds !== undefined ? {endSeconds} : {}),
    ...(color !== undefined ? {color} : {}),
  });
}

function playerHarness(initialSeconds: number, duration: number) {
  let seconds = initialSeconds;
  const listeners = new Map<string, Set<(payload: unknown) => void>>();
  const cleanups: Array<ReturnType<typeof vi.fn>> = [];
  return {
    get seconds() {
      return seconds;
    },
    duration,
    seek: vi.fn((next: number) => {
      seconds = next;
    }),
    on(event: string, listener: (payload: unknown) => void) {
      const group = listeners.get(event) ?? new Set();
      group.add(listener);
      listeners.set(event, group);
      const cleanup = vi.fn(() => group.delete(listener));
      cleanups.push(cleanup);
      return cleanup;
    },
    emit(event: string, payload: unknown) {
      for (const listener of listeners.get(event) ?? []) listener(payload);
    },
    cleanups,
  };
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => window.requestAnimationFrame(() => resolve()));
}

function captureThrown(action: () => void): {failed: boolean; error: unknown} {
  try {
    action();
    return {failed: false, error: undefined};
  } catch (error) {
    return {failed: true, error};
  }
}

function viewportHarness(
  durationSeconds: number,
  viewportWidth: number,
  pixelsPerSecond: number,
): AudioViewportHandle & {
  readonly subscribers: Set<AudioViewportSubscriber>;
  manualScroll(offsetPixels: number): void;
} {
  let snapshot: AudioViewportSnapshot = {
    durationSeconds,
    viewportWidth,
    pixelsPerSecond,
    offsetPixels: 0,
    contentWidth: durationSeconds * pixelsPerSecond,
  };
  const subscribers = new Set<AudioViewportSubscriber>();
  const publish = (next: AudioViewportSnapshot): void => {
    snapshot = next;
    for (const subscriber of [...subscribers]) subscriber(next);
  };
  return {
    subscribers,
    get snapshot() {
      return snapshot;
    },
    setViewport(update: AudioViewportUpdate) {
      const zoom = update.pixelsPerSecond ?? snapshot.pixelsPerSecond;
      const contentWidth = durationSeconds * zoom;
      const requestedOffset = update.offsetPixels ?? snapshot.offsetPixels;
      publish({
        ...snapshot,
        pixelsPerSecond: zoom,
        contentWidth,
        offsetPixels: Math.max(0, Math.min(contentWidth - viewportWidth, requestedOffset)),
      });
    },
    subscribe(subscriber: AudioViewportSubscriber) {
      subscribers.add(subscriber);
      return () => subscribers.delete(subscriber);
    },
    manualScroll(offsetPixels: number) {
      publish({...snapshot, offsetPixels});
    },
  };
}
