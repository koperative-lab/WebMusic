// @vitest-environment jsdom

import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import type {
  SpectrogramData,
  ViewportAudioVisualizer,
} from '../../src/view/core/types';
import {createRegion} from '../../src/core';
import {renderSpectrogramVisualizer} from '../../src/view/render/spectrogram-view';

interface CanvasHarness {
  clearRect: ReturnType<typeof vi.fn>;
  createImageData: ReturnType<typeof vi.fn>;
  putImageData: ReturnType<typeof vi.fn>;
  setTransform: ReturnType<typeof vi.fn>;
  strokeRect: ReturnType<typeof vi.fn>;
  strokeStyle: string;
}

let measuredWidth = 400;
let triggerResize: (() => void) | undefined;
let resizeDisconnect: ReturnType<typeof vi.fn<() => void>>;
let context: CanvasHarness;

beforeEach(() => {
  measuredWidth = 400;
  triggerResize = undefined;
  resizeDisconnect = vi.fn();
  context = {
    clearRect: vi.fn(),
    createImageData: vi.fn((width: number, height: number) => ({
      width,
      height,
      data: new Uint8ClampedArray(width * height * 4),
    })),
    putImageData: vi.fn(),
    setTransform: vi.fn(),
    strokeRect: vi.fn(),
    strokeStyle: '',
  };

  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(
    () => measuredWidth,
  );
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    ((kind: string) =>
      kind === '2d'
        ? (context as unknown as CanvasRenderingContext2D)
        : null) as typeof HTMLCanvasElement.prototype.getContext,
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

describe('renderSpectrogramVisualizer viewport', () => {
  it('keeps playback layers in one fractional coordinate system despite native scroll rounding', () => {
    const {rendered, wrapper, scroller, canvas} = renderHarness({
      durationSeconds: 10, pixelsPerSecond: 100, playheadMode: 'center',
    });
    const regions = wrapper.children[1] as HTMLCanvasElement;
    const overlay = wrapper.children[2] as HTMLElement;
    let nativeOffset = 0;
    Object.defineProperty(scroller, 'scrollLeft', {
      configurable: true,
      get: () => nativeOffset,
      set: (value: number) => { nativeOffset = Math.round(value); },
    });
    const imageWidthWrites = vi.spyOn(canvas, 'width', 'set');
    const imageHeightWrites = vi.spyOn(canvas, 'height', 'set');
    const regionWidthWrites = vi.spyOn(regions, 'width', 'set');
    const regionHeightWrites = vi.spyOn(regions, 'height', 'set');
    const clears = context.clearRect.mock.calls.length;
    for (let index = 1; index <= 40; index++) {
      const seconds = index * 0.0123;
      rendered.redraw(seconds, false);
      scroller.dispatchEvent(new Event('scroll'));
      expect(parseFloat(canvas.style.left)).toBeCloseTo(200 - seconds * 100);
      expect(regions.style.left).toBe(canvas.style.left);
      expect(overlay.style.transform).toBe('translateX(200px)');
      expect(rendered.hitTest(200, 0).seconds).toBeCloseTo(seconds);
    }
    expect(canvas.parentElement).toBe(wrapper);
    expect(scroller.contains(canvas)).toBe(false);
    expect(context.putImageData).toHaveBeenCalledOnce();
    expect(context.clearRect).toHaveBeenCalledTimes(clears);
    expect(imageWidthWrites).not.toHaveBeenCalled();
    expect(imageHeightWrites).not.toHaveBeenCalled();
    expect(regionWidthWrites).not.toHaveBeenCalled();
    expect(regionHeightWrites).not.toHaveBeenCalled();
    rendered.dispose();
  });

  it('keeps clip edges centered with blank padding and bounded image and region layers', () => {
    const {rendered, wrapper, scroller, canvas} = renderHarness({
      durationSeconds: 10, pixelsPerSecond: 100, playheadMode: 'center',
    });
    const overlay = wrapper.children[2] as HTMLElement;
    const regions = wrapper.children[1] as HTMLCanvasElement;
    expect(overlay.style.transform).toBe('translateX(200px)');
    expect(scroller.style.overflowX).toBe('hidden');
    expect((scroller.firstElementChild as HTMLElement).style.width).toBe('1400px');
    expect(canvas.style.left).toBe('200px');
    expect(regions.style.left).toBe('200px');
    expect(canvas.width).toBe(600);
    expect(regions.width).toBe(600);
    expect(rendered.viewport()).toEqual({startSeconds: 0, endSeconds: 2});
    expect(rendered.hitTest(0, 0).seconds).toBe(0);
    expect(rendered.hitTest(200, 0).seconds).toBe(0);
    expect(rendered.hitTest(400, 0).seconds).toBe(2);
    rendered.setRegions([createRegion({label: 'first', startSeconds: 0, endSeconds: 1})]);
    expect(context.strokeRect).toHaveBeenLastCalledWith(0, 0.5, 100, 7);
    expect(context.putImageData).toHaveBeenCalledOnce();
    rendered.redraw(0, false);
    rendered.redraw(0.1, false);
    expect(context.putImageData).toHaveBeenCalledOnce();

    rendered.redraw(10, false);
    expect(overlay.style.transform).toBe('translateX(200px)');
    expect(scroller.scrollLeft).toBe(1000);
    expect(rendered.viewport()).toEqual({startSeconds: 8, endSeconds: 10});
    expect(rendered.hitTest(0, 0).seconds).toBe(8);
    expect(rendered.hitTest(200, 0).seconds).toBe(10);
    expect(rendered.hitTest(400, 0).seconds).toBe(10);
    expect(canvas.style.left).toBe('-400px');
    expect(canvas.style.width).toBe('600px');
    expect(canvas.width).toBe(600);
    expect(regions.width).toBe(600);
    const paints = context.putImageData.mock.calls.length;
    rendered.redraw(10, false);
    expect(context.putImageData).toHaveBeenCalledTimes(paints);
    rendered.dispose();
  });

  it('centers short clips and preserves cursor time across resize and zoom', () => {
    const {rendered, wrapper, scroller, canvas} = renderHarness({
      durationSeconds: 1, pixelsPerSecond: 100, playheadMode: 'center',
    });
    const overlay = wrapper.children[2] as HTMLElement;
    rendered.redraw(0.25, false);
    expect(rendered.viewport()).toEqual({startSeconds: 0, endSeconds: 1});
    expect(rendered.hitTest(200, 0).seconds).toBe(0.25);
    measuredWidth = 800;
    triggerResize?.();
    expect(overlay.style.transform).toBe('translateX(400px)');
    expect(canvas.style.left).toBe('375px');
    expect(rendered.hitTest(400, 0).seconds).toBe(0.25);
    expect((scroller.firstElementChild as HTMLElement).style.width).toBe('900px');
    rendered.setZoom(200);
    expect(overlay.style.transform).toBe('translateX(400px)');
    expect(rendered.hitTest(400, 0).seconds).toBe(0.25);
    expect((scroller.firstElementChild as HTMLElement).style.width).toBe('1000px');
    expect(rendered.viewport()).toEqual({startSeconds: 0, endSeconds: 1});
    rendered.dispose();
  });

  it('changes playhead mode in place and ignores independent panning while centered', () => {
    const {rendered, wrapper, scroller, canvas} = renderHarness({
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
    expect((wrapper.children[2] as HTMLElement).style.transform).toBe('translateX(200px)');
    expect(rendered.viewport()).toEqual({startSeconds: 7, endSeconds: 10});
    expect(notify).not.toHaveBeenCalled();
    rendered.setPlayheadMode('position');
    expect(rendered.viewport()).toEqual({startSeconds: 6, endSeconds: 10});
    expect((scroller.firstElementChild as HTMLElement).style.width).toBe('1000px');
    expect(scroller.style.overflowX).toBe('auto');
    expect(wrapper.firstElementChild).toBe(canvas);
    rendered.setOffset(2);
    expect(rendered.viewport()).toEqual({startSeconds: 2, endSeconds: 6});
    rendered.dispose();
    rendered.setPlayheadMode('center');
    expect(wrapper.firstElementChild).toBe(canvas);
  });

  it('defers hidden centered raster work then recenters after measurement', () => {
    measuredWidth = 0;
    const {rendered, wrapper, canvas} = renderHarness({
      durationSeconds: 10, pixelsPerSecond: 100, playheadMode: 'center',
    });
    rendered.redraw(10, false);
    expect(rendered.viewport()).toEqual({startSeconds: 10, endSeconds: 10});
    expect(context.createImageData).not.toHaveBeenCalled();
    expect(canvas.width).toBe(1);
    measuredWidth = 400;
    triggerResize?.();
    rendered.redraw(Number.NaN, false);
    expect(rendered.viewport()).toEqual({startSeconds: 8, endSeconds: 10});
    expect((wrapper.children[2] as HTMLElement).style.transform).toBe('translateX(200px)');
    expect(context.putImageData).toHaveBeenCalledOnce();
    rendered.dispose();
  });

  it('publishes manual scroll, clamps offsets and suppresses no-op work', () => {
    const {container, rendered, scroller, canvas} = renderHarness({
      durationSeconds: 100,
      pixelsPerSecond: 100,
    });
    const publicTypeSmoke: ViewportAudioVisualizer = rendered;
    const notify = vi.fn();
    const unsubscribe = publicTypeSmoke.onViewportChange(notify);

    expect(rendered.viewport()).toEqual({startSeconds: 0, endSeconds: 4});
    expect((scroller.firstElementChild as HTMLElement).style.width).toBe('10000px');
    expect(canvas.width).toBeLessThanOrEqual(measuredWidth * 3);
    expect(container.querySelector('[role="slider"]')).toBeNull();
    expect(container.querySelector('[tabindex]')).toBeNull();
    triggerResize?.();
    expect(context.putImageData).toHaveBeenCalledOnce();
    expect(notify).not.toHaveBeenCalled();

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
    const {rendered, scroller, canvas} = renderHarness({
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
    expect((scroller.firstElementChild as HTMLElement).style.width).toBe('10000px');
    expect(canvas.width).toBeLessThanOrEqual(measuredWidth * 3);
    expect(rendered.viewport()).toEqual({startSeconds: 9, endSeconds: 10});

    rendered.setOffset(49);
    expect(rendered.viewport()).toEqual({startSeconds: 49, endSeconds: 50});
    expect(scroller.scrollLeft).toBe(4_900);

    // Zooming back out shrinks the content under the offset; the surface must
    // re-clamp rather than keep scrolling past the end of the clip.
    rendered.setZoom(1);
    expect(canvas.style.width).toBe('100px');
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
      throw new Error('spectrogram subscriber failed');
    });
    const asyncFailure = vi.fn(() =>
      Promise.reject(new Error('spectrogram async subscriber failed')),
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

  it('lets a nested manual scroll supersede stale outer delivery', () => {
    const {rendered, scroller} = renderHarness({
      durationSeconds: 100,
      pixelsPerSecond: 100,
    });
    const observed: string[] = [];

    rendered.onViewportChange((viewport) => {
      observed.push(`first:${viewport.startSeconds}`);
      if (viewport.startSeconds === 1) {
        scroller.scrollLeft = 200;
        scroller.dispatchEvent(new Event('scroll'));
      }
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
    expect(rendered.viewport()).toEqual({startSeconds: 1, endSeconds: 9});
    expect(scroller.scrollLeft).toBe(100);
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
    rendered.setRegions([]);
    expect(context.clearRect).toHaveBeenCalledTimes(paintsBeforeDispose);
    expect(notify).toHaveBeenCalledTimes(2);
    unsubscribe();
    unsubscribe();
  });

  it('locks native panning when scrollable is false without mutating borrowed data', () => {
    const data = spectrogram();
    const magnitudes = data.magnitudes;
    const {rendered, scroller} = renderHarness(
      {durationSeconds: 10, pixelsPerSecond: 100, scrollable: false},
      data,
    );

    expect(scroller.style.overflowX).toBe('hidden');
    rendered.setOffset(2.5);
    expect(rendered.viewport().startSeconds).toBe(2.5);
    expect(data.magnitudes).toBe(magnitudes);
    expect(Array.from(data.magnitudes)).toEqual([0, 1]);
    rendered.dispose();
  });

  it('reports an unmeasured viewport as empty with a stable content width', () => {
    measuredWidth = 0;
    const {rendered, canvas, scroller} = renderHarness({
      durationSeconds: 10,
      pixelsPerSecond: 100,
    });

    expect(rendered.viewport()).toEqual({startSeconds: 0, endSeconds: 0});
    expect((scroller.firstElementChild as HTMLElement).style.width).toBe('1000px');
    expect(canvas.width).toBe(1);
    expect(canvas.height).toBe(1);
    expect(context.createImageData).not.toHaveBeenCalled();

    measuredWidth = 300;
    triggerResize?.();
    expect(context.putImageData).toHaveBeenCalledOnce();
    expect(canvas.width).toBe(600);
    expect(rendered.viewport()).toEqual({startSeconds: 0, endSeconds: 3});

    measuredWidth = 0;
    triggerResize?.();
    expect(canvas.width).toBe(1);
    expect(canvas.height).toBe(1);
    expect(context.putImageData).toHaveBeenCalledOnce();
    rendered.dispose();
  });
});

function renderHarness(
  options: {
    durationSeconds: number;
    pixelsPerSecond: number;
    scrollable?: boolean;
    playheadMode?: 'position' | 'center';
  },
  data: SpectrogramData = spectrogram(),
) {
  const container = document.createElement('div');
  document.body.append(container);
  const rendered = renderSpectrogramVisualizer(container, data, {
    ...options,
    devicePixelRatio: 1,
    height: 8,
    virtualization: {bufferScreens: 1},
  });
  const wrapper = container.firstElementChild as HTMLElement;
  const canvas = wrapper.firstElementChild as HTMLCanvasElement;
  const scroller = wrapper.lastElementChild as HTMLElement;
  return {container, rendered, wrapper, scroller, canvas};
}

function spectrogram(): SpectrogramData {
  return {
    magnitudes: Float32Array.from([0, 1]),
    binsPerFrame: 1,
    frequencies: Float32Array.from([1_000]),
    times: Float32Array.from([0, 1]),
  };
}
