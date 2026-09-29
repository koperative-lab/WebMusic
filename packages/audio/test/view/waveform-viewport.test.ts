// @vitest-environment jsdom

import type {AudioPeaks} from '../../src/core';
import {renderWaveformVisualizer} from '../../src/view/render/waveform';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

interface CanvasHarness {
  fillStyle: string;
  clearRect: ReturnType<typeof vi.fn>;
  fillRect: ReturnType<typeof vi.fn>;
  setTransform: ReturnType<typeof vi.fn>;
  translate: ReturnType<typeof vi.fn>;
  drawImage: ReturnType<typeof vi.fn>;
}

let measuredWidth = 400;
let measuredHeight = 128;
let triggerResize: (() => void) | undefined;
let resizeDisconnect: ReturnType<typeof vi.fn<() => void>>;
let context: CanvasHarness;

beforeEach(() => {
  measuredWidth = 400;
  measuredHeight = 128;
  triggerResize = undefined;
  resizeDisconnect = vi.fn();
  context = {
    fillStyle: '',
    clearRect: vi.fn(),
    fillRect: vi.fn(),
    setTransform: vi.fn(),
    translate: vi.fn(),
    drawImage: vi.fn(),
  };

  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => measuredWidth);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(() => measuredHeight);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    (function (this: HTMLCanvasElement, kind: string) {
      return kind === '2d'
        ? {...context, clearRect: this.parentElement ? context.clearRect : vi.fn()}
        : null;
    }) as typeof HTMLCanvasElement.prototype.getContext,
  );

  class ResizeObserverHarness {
    constructor(callback: ResizeObserverCallback) {
      triggerResize = () => callback([], this as unknown as ResizeObserver);
    }

    observe(): void {}

    unobserve(): void {}

    disconnect(): void {
      resizeDisconnect();
    }
  }

  vi.stubGlobal('ResizeObserver', ResizeObserverHarness);
});

afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('renderWaveformVisualizer viewport', () => {
  it('keeps both clip boundaries centered with blank padding and clamped hit testing', () => {
    const {rendered, outer, scroller, spacer, canvas} = renderHarness({
      durationSeconds: 10, pixelsPerSecond: 100, playheadMode: 'center',
    });
    const overlay = outer.children[2] as HTMLElement;
    expect(overlay.style.transform).toBe('translateX(200px)');
    expect(spacer.style.width).toBe('1400px');
    expect(scroller.style.overflowX).toBe('hidden');
    expect(rendered.viewport()).toEqual({startSeconds: 0, endSeconds: 2});
    expect(rendered.hitTest(0, 0).seconds).toBe(0);
    expect(rendered.hitTest(200, 0).seconds).toBe(0);
    expect(rendered.hitTest(400, 0).seconds).toBe(2);
    expect(context.fillRect.mock.calls.every(([x]) => x >= 200)).toBe(true);

    context.fillRect.mockClear();
    rendered.redraw(10, false);
    rendered.redraw();
    expect(overlay.style.transform).toBe('translateX(200px)');
    expect(rendered.viewport()).toEqual({startSeconds: 8, endSeconds: 10});
    expect(rendered.hitTest(0, 0).seconds).toBe(8);
    expect(rendered.hitTest(200, 0).seconds).toBe(10);
    expect(rendered.hitTest(400, 0).seconds).toBe(10);
    expect(context.fillRect.mock.calls.every(([x]) => x < 200)).toBe(true);
    expect(canvas.width).toBe(400);
    expect(scroller.scrollLeft).toBe(1000);
    rendered.dispose();
  });

  it('centers short clips and preserves cursor time across resize and zoom', () => {
    const {rendered, outer, spacer} = renderHarness({
      durationSeconds: 1, pixelsPerSecond: 100, playheadMode: 'center',
    });
    const overlay = outer.children[2] as HTMLElement;
    rendered.redraw(0.25, false);
    rendered.redraw();
    expect(rendered.viewport()).toEqual({startSeconds: 0, endSeconds: 1});
    expect(rendered.hitTest(200, 0).seconds).toBe(0.25);
    measuredWidth = 800;
    triggerResize?.();
    expect(overlay.style.transform).toBe('translateX(400px)');
    expect(rendered.hitTest(400, 0).seconds).toBe(0.25);
    expect(spacer.style.width).toBe('900px');
    rendered.setZoom(200);
    expect(rendered.hitTest(400, 0).seconds).toBe(0.25);
    expect(spacer.style.width).toBe('1000px');
    expect(rendered.viewport()).toEqual({startSeconds: 0, endSeconds: 1});
    rendered.dispose();
  });

  it('changes playhead mode in place and gives centered geometry sole pan ownership', () => {
    const {rendered, outer, canvas, scroller, spacer} = renderHarness({
      durationSeconds: 10, pixelsPerSecond: 100,
    });
    rendered.redraw(9, false);
    rendered.setPlayheadMode('center');
    expect(rendered.viewport()).toEqual({startSeconds: 7, endSeconds: 10});
    const notify = vi.fn();
    rendered.onViewportChange(notify);
    rendered.setOffset(2);
    scroller.scrollLeft = 0;
    scroller.dispatchEvent(new Event('scroll'));
    expect(scroller.scrollLeft).toBe(900);
    expect(rendered.viewport()).toEqual({startSeconds: 7, endSeconds: 10});
    expect(notify).not.toHaveBeenCalled();
    rendered.setPlayheadMode('position');
    expect(rendered.viewport()).toEqual({startSeconds: 6, endSeconds: 10});
    expect(spacer.style.width).toBe('1000px');
    expect(scroller.style.overflowX).toBe('auto');
    expect(outer.querySelector('canvas')).toBe(canvas);
    rendered.setOffset(2);
    expect(rendered.viewport()).toEqual({startSeconds: 2, endSeconds: 6});
    rendered.dispose();
    rendered.setPlayheadMode('center');
    expect(outer.querySelector('canvas')).toBe(canvas);
  });

  it('recenters a hidden view after measurement and ignores nonfinite cursor updates', () => {
    measuredWidth = 0;
    const {rendered, outer, canvas} = renderHarness({
      durationSeconds: 10, pixelsPerSecond: 100, playheadMode: 'center',
    });
    rendered.redraw(10, false);
    expect(rendered.viewport()).toEqual({startSeconds: 10, endSeconds: 10});
    expect(canvas.width).toBe(1);
    measuredWidth = 400;
    triggerResize?.();
    rendered.redraw(Number.NaN, false);
    expect(rendered.viewport()).toEqual({startSeconds: 8, endSeconds: 10});
    expect((outer.children[2] as HTMLElement).style.transform).toBe('translateX(200px)');
    rendered.dispose();
  });

  it('publishes manual scroll, clamps offsets and suppresses no-op work', () => {
    const {container, rendered, scroller, spacer, canvas} = renderHarness({
      durationSeconds: 100,
      pixelsPerSecond: 100,
      devicePixelRatio: 2,
    });
    const notify = vi.fn();
    const unsubscribe = rendered.onViewportChange(notify);

    expect(rendered.viewport()).toEqual({startSeconds: 0, endSeconds: 4});
    expect(spacer.style.width).toBe('10000px');
    expect(canvas.width).toBe(800);
    expect(canvas.height).toBe(256);
    expect(container.querySelector('[role="slider"]')).toBeNull();
    expect(container.querySelector('[tabindex]')).toBeNull();

    scroller.scrollLeft = 750;
    scroller.dispatchEvent(new Event('scroll'));
    expect(rendered.viewport()).toEqual({startSeconds: 7.5, endSeconds: 11.5});
    expect(rendered.hitTest(0, 0).seconds).toBe(7.5);
    expect(notify).toHaveBeenCalledOnce();
    expect(notify).toHaveBeenLastCalledWith(rendered.viewport());

    // A scroll event whose position the surface already painted is not news.
    const paintsAfterScroll = context.clearRect.mock.calls.length;
    scroller.dispatchEvent(new Event('scroll'));
    expect(notify).toHaveBeenCalledOnce();
    expect(context.clearRect).toHaveBeenCalledTimes(paintsAfterScroll);

    scroller.scrollLeft = 20_000;
    scroller.dispatchEvent(new Event('scroll'));
    expect(rendered.viewport()).toEqual({startSeconds: 96, endSeconds: 100});
    expect(scroller.scrollLeft).toBe(9_600);

    rendered.setOffset(-50);
    rendered.setZoom(0);
    expect(rendered.viewport()).toEqual({startSeconds: 0, endSeconds: 4});
    const notificationsAfterClamp = notify.mock.calls.length;
    const paintsAfterClamp = context.clearRect.mock.calls.length;

    rendered.setOffset(Number.NaN);
    rendered.setZoom(Number.NaN);
    expect(notify).toHaveBeenCalledTimes(notificationsAfterClamp);
    expect(context.clearRect).toHaveBeenCalledTimes(paintsAfterClamp);

    unsubscribe();
    unsubscribe();
    rendered.dispose();
  });

  it('keeps the offset inside the content width across zoom changes', () => {
    measuredWidth = 100;
    const {rendered, scroller, spacer} = renderHarness({
      durationSeconds: 100,
      pixelsPerSecond: 10,
    });
    const notify = vi.fn();
    rendered.onViewportChange(notify);

    rendered.setOffset(90);
    expect(rendered.viewport()).toEqual({startSeconds: 90, endSeconds: 100});
    expect(scroller.scrollLeft).toBe(900);

    // Zooming in widens the content, so the offset it was clamped against
    // still names the same instant.
    rendered.setZoom(100);
    expect(spacer.style.width).toBe('10000px');
    expect(rendered.viewport()).toEqual({startSeconds: 9, endSeconds: 10});

    rendered.setOffset(49);
    expect(rendered.viewport()).toEqual({startSeconds: 49, endSeconds: 50});
    expect(scroller.scrollLeft).toBe(4_900);

    // Zooming back out shrinks the content under the offset; the surface must
    // re-clamp rather than keep scrolling past the end of the clip.
    rendered.setZoom(1);
    expect(spacer.style.width).toBe('100px');
    expect(rendered.viewport()).toEqual({startSeconds: 0, endSeconds: 100});
    expect(scroller.scrollLeft).toBe(0);
    expect(notify).toHaveBeenCalledTimes(4);
    rendered.dispose();
  });

  it('contains subscriber failures and still notifies later observers', async () => {
    const {rendered} = renderHarness({
      durationSeconds: 100,
      pixelsPerSecond: 100,
    });
    const syncFailure = vi.fn(() => {
      throw new Error('waveform subscriber failed');
    });
    const asyncFailure = vi.fn(() =>
      Promise.reject(new Error('waveform async subscriber failed')),
    );
    const observed: number[] = [];

    rendered.onViewportChange(syncFailure);
    rendered.onViewportChange(asyncFailure);
    rendered.onViewportChange((viewport) => observed.push(viewport.startSeconds));

    expect(() => rendered.setOffset(1)).not.toThrow();
    expect(syncFailure).toHaveBeenCalledOnce();
    expect(asyncFailure).toHaveBeenCalledOnce();
    expect(observed).toEqual([1]);
    await Promise.resolve();
    await Promise.resolve();
    rendered.dispose();
  });

  it('lets a nested viewport update supersede stale outer delivery', () => {
    const {rendered} = renderHarness({
      durationSeconds: 100,
      pixelsPerSecond: 100,
    });
    const observed: string[] = [];

    rendered.onViewportChange((viewport) => {
      observed.push(`first:${viewport.startSeconds}`);
      if (viewport.startSeconds === 1) rendered.setOffset(2);
    });
    rendered.onViewportChange((viewport) => {
      observed.push(`second:${viewport.startSeconds}`);
    });

    rendered.setOffset(1);

    expect(rendered.viewport().startSeconds).toBe(2);
    expect(observed).toEqual(['first:1', 'first:2', 'second:2']);
    rendered.dispose();
  });

  it('stops an active dispatch when a subscriber disposes the renderer', () => {
    const {rendered} = renderHarness({
      durationSeconds: 100,
      pixelsPerSecond: 100,
    });
    const dispose = vi.fn(() => rendered.dispose());
    const stale = vi.fn();
    rendered.onViewportChange(dispose);
    rendered.onViewportChange(stale);

    rendered.setOffset(1);
    rendered.setOffset(2);

    expect(dispose).toHaveBeenCalledOnce();
    expect(stale).not.toHaveBeenCalled();
  });

  it('reports an unmeasured viewport as empty while keeping a safe canvas backing', () => {
    measuredWidth = 0;
    const {rendered, canvas} = renderHarness({
      durationSeconds: 10,
      pixelsPerSecond: 100,
    });

    expect(rendered.viewport()).toEqual({startSeconds: 0, endSeconds: 0});
    expect(canvas.width).toBe(1);
    expect(canvas.height).toBe(128);
    rendered.dispose();
  });

  it('publishes resize and follow geometry, then becomes inert after dispose', () => {
    const {container, rendered, scroller} = renderHarness({
      durationSeconds: 10,
      pixelsPerSecond: 100,
    });
    const notify = vi.fn();
    const unsubscribe = rendered.onViewportChange(notify);
    rendered.setOffset(6);
    notify.mockClear();

    measuredWidth = 800;
    triggerResize?.();
    expect(rendered.viewport()).toEqual({startSeconds: 2, endSeconds: 10});
    expect(scroller.scrollLeft).toBe(200);
    expect(notify).toHaveBeenCalledOnce();

    rendered.redraw(5, true);
    expect(rendered.viewport().startSeconds).toBe(1);
    expect(notify).toHaveBeenCalledTimes(2);

    const paintsBeforeDispose = context.clearRect.mock.calls.length;
    rendered.dispose();
    rendered.dispose();
    expect(resizeDisconnect).toHaveBeenCalledOnce();
    expect(container.firstElementChild).toBeNull();

    scroller.scrollLeft = 500;
    scroller.dispatchEvent(new Event('scroll'));
    triggerResize?.();
    rendered.setOffset(3);
    rendered.setZoom(200);
    rendered.redraw(8, true);
    expect(context.clearRect).toHaveBeenCalledTimes(paintsBeforeDispose);
    expect(notify).toHaveBeenCalledTimes(2);
    unsubscribe();
    unsubscribe();
  });

  it('keeps long-clip allocation and painting bounded by viewport width', () => {
    measuredWidth = 800;
    const {rendered, scroller, spacer, canvas} = renderHarness({
      durationSeconds: 21_600,
      pixelsPerSecond: 100,
      devicePixelRatio: 2,
    });

    // A six-hour clip is two million CSS px wide, but the canvas only ever
    // backs the visible window.
    expect(spacer.style.width).toBe('2160000px');
    expect(canvas.width).toBe(1_600);
    expect(context.fillRect.mock.calls.length).toBeGreaterThan(0);
    expect(context.fillRect.mock.calls.length).toBeLessThanOrEqual(801);

    const notify = vi.fn();
    rendered.onViewportChange(notify);
    const paints = context.clearRect.mock.calls.length;
    scroller.dispatchEvent(new Event('scroll'));
    expect(context.clearRect).toHaveBeenCalledTimes(paints);
    expect(notify).not.toHaveBeenCalled();

    context.fillRect.mockClear();
    rendered.setZoom(200);
    expect(spacer.style.width).toBe('4320000px');
    expect(canvas.width).toBe(1_600);
    expect(context.clearRect).toHaveBeenCalledTimes(paints + 1);
    expect(context.fillRect.mock.calls.length).toBeGreaterThan(0);
    expect(context.fillRect.mock.calls.length).toBeLessThanOrEqual(801);
    expect(notify).toHaveBeenCalledOnce();
    rendered.dispose();
  });
});

function renderHarness(options: {
  durationSeconds: number;
  pixelsPerSecond: number;
  devicePixelRatio?: number;
  playheadMode?: 'position' | 'center';
}) {
  const container = document.createElement('div');
  document.body.append(container);
  const rendered = renderWaveformVisualizer(container, peaks(10), options);
  const outer = container.firstElementChild as HTMLElement;
  const scroller = outer.firstElementChild as HTMLElement;
  const spacer = scroller.firstElementChild as HTMLElement;
  const canvas = outer.querySelector('canvas')!;
  return {container, rendered, outer, scroller, spacer, canvas};
}

function peaks(durationSeconds: number): AudioPeaks {
  const sampleRate = 100;
  const peakCount = durationSeconds * sampleRate;
  return {
    sampleRate,
    channels: 1,
    baseSamplesPerPeak: 1,
    levels: [{samplesPerPeak: 1, data: new Int8Array(peakCount * 2)}],
  };
}
