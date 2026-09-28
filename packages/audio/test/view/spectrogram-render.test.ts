// @vitest-environment jsdom

import {afterEach, describe, expect, it, vi} from 'vitest';
import {renderSpectrogramVisualizer} from '../../src/view/render/spectrogram-view';
import {createRegion} from '../../src/core';
import type {SpectrogramData} from '../../src/view/core/types';

/**
 * Canvas 2D is not implemented in jsdom, so we install a recording stub. It
 * keeps enough state to assert WHAT was painted and HOW MANY blits it took —
 * the two things the renderer's hot path is judged on.
 */
function stubCanvas() {
  const blits: Array<{width: number; height: number; dx: number; data: Uint8ClampedArray}> = [];
  const strokes: number[] = [];
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (
    this: HTMLCanvasElement,
  ) {
    return {
      canvas: this,
      setTransform: () => {},
      clearRect: () => {},
      strokeRect: (x: number) => strokes.push(x),
      set strokeStyle(_value: string) {},
      createImageData: (width: number, height: number) => ({
        width,
        height,
        data: new Uint8ClampedArray(width * height * 4),
      }),
      putImageData: (image: ImageData, dx: number) => {
        blits.push({width: image.width, height: image.height, dx, data: image.data});
      },
    } as unknown as CanvasRenderingContext2D;
  });
  return {blits, strokes};
}

/** Two frames: frame 0 silent, frame 1 full-scale, one bin each. */
function twoFrameSpectrogram(): SpectrogramData {
  return {
    magnitudes: Float32Array.from([0, 1]),
    binsPerFrame: 1,
    frequencies: Float32Array.from([1_000]),
    times: Float32Array.from([0, 1]),
  };
}

function mountHost(width: number): HTMLElement {
  const host = document.createElement('div');
  document.body.append(host);
  // jsdom reports zero layout for every element, and the scroll wrapper the
  // renderer measures is created internally — so the viewport is stubbed on
  // the prototype rather than on the host.
  Object.defineProperty(HTMLDivElement.prototype, 'clientWidth', {
    value: width,
    configurable: true,
  });
  return host;
}

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('renderSpectrogramVisualizer', () => {
  it.each([
    {width: 7, dpr: 1.25, pixelsPerSecond: 100, duration: 20},
    {width: 6000, dpr: 4, pixelsPerSecond: 1000, duration: 120},
  ])('preserves overlapping spectral pixels across stripe replacement at $dpr DPR', ({width, dpr, pixelsPerSecond, duration}) => {
    const {blits} = stubCanvas();
    const host = mountHost(width);
    const times = Float32Array.from({length: 12001}, (_, index) => index * duration / 12000);
    const magnitudes = Float32Array.from(times, (_, index) => 10 ** ((index % 200 - 200) / 20));
    const viz = renderSpectrogramVisualizer(host, {
      times, magnitudes, binsPerFrame: 1, frequencies: [1000],
    }, {
      durationSeconds: duration, pixelsPerSecond, height: 1, devicePixelRatio: dpr,
      playheadMode: 'center', minDb: -200, colorMap: (value) => [Math.round(value * 255), 0, 0],
    });
    const canvas = host.querySelector('canvas')!;
    const initial = blits[0];
    const initialScale = initial.width / parseFloat(canvas.style.width);
    // Cross the cached right edge, so a wider stripe replaces the initial
    // clip-edge stripe. Common content must not flash to different colors.
    viz.redraw(width * 1.3 / pixelsPerSecond, false);
    const wider = blits.at(-1)!;
    expect(blits).toHaveLength(2);
    expect(wider.width).toBeGreaterThan(initial.width);
    expect(wider.width).toBeLessThanOrEqual(16384);
    expect(wider.data.slice(0, initial.width * 4).every((value, index) => value === initial.data[index])).toBe(true);
    expect(wider.width / parseFloat(canvas.style.width)).toBeCloseTo(initialScale, 10);

    // A later stripe has a nonzero origin; its overlap retains the same
    // clip-wide sample phase rather than restarting at local canvas zero.
    viz.redraw(width * 3 / pixelsPerSecond, false);
    const shifted = blits.at(-1)!;
    expect(blits).toHaveLength(3);
    const offset = width * 3 - width / 2;
    const firstPixel = Math.round((parseFloat(canvas.style.left) + offset) * initialScale);
    const overlap = Math.min(wider.width - firstPixel, shifted.width);
    expect(overlap).toBeGreaterThan(0);
    expect(shifted.data.slice(0, overlap * 4).every((value, index) => value === wider.data[firstPixel * 4 + index])).toBe(true);
    viz.dispose();
  });

  it('prepares replacement pixels before changing the currently visible backing store', () => {
    const {blits} = stubCanvas();
    const host = mountHost(400);
    const viz = renderSpectrogramVisualizer(host, twoFrameSpectrogram(), {
      durationSeconds: 60, pixelsPerSecond: 100, height: 8, devicePixelRatio: 2,
      playheadMode: 'center',
    });
    const canvas = host.querySelector('canvas')!;
    const originalWidth = canvas.width;
    const events: string[] = [];
    const widthDescriptor = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, 'width')!;
    Object.defineProperty(canvas, 'width', {
      configurable: true,
      get() { return widthDescriptor.get!.call(this); },
      set(value: number) {
        events.push('resize');
        widthDescriptor.set!.call(this, value);
      },
    });
    const getContext = vi.mocked(HTMLCanvasElement.prototype.getContext).getMockImplementation()!;
    // An own method keeps this observer off the separate overlay canvas.
    Object.defineProperty(canvas, 'getContext', {
      configurable: true,
      value: vi.fn(function () {
        const ctx = getContext.call(canvas, '2d') as CanvasRenderingContext2D;
        const createImageData = ctx.createImageData.bind(ctx);
        ctx.createImageData = ((width: number, height: number) => {
          events.push('prepare');
          expect(canvas.width).toBe(originalWidth);
          return createImageData(width, height);
        }) as typeof ctx.createImageData;
        ctx.clearRect = () => { events.push('clear'); };
        return ctx;
      } as unknown as typeof canvas.getContext),
    });
    viz.redraw(8, false);
    expect(blits).toHaveLength(2);
    expect(events).toEqual(['prepare', 'resize']);
    viz.dispose();
  });

  it('paints the stripe in a single blit rather than one per column', () => {
    const {blits} = stubCanvas();
    const host = mountHost(0);

    const viz = renderSpectrogramVisualizer(host, twoFrameSpectrogram(), {
      pixelsPerSecond: 100,
      height: 64,
      devicePixelRatio: 1,
      durationSeconds: 2,
      virtualization: false,
    });

    // 200 device-pixel columns went out as ONE ImageData, not 200.
    expect(blits).toHaveLength(1);
    expect(blits[0].width).toBe(200);
    expect(blits[0].height).toBe(64);
    viz.dispose();
  });

  it('maps magnitude through the colormap table (silent and full-scale differ)', () => {
    const {blits} = stubCanvas();
    const host = mountHost(0);

    const viz = renderSpectrogramVisualizer(host, twoFrameSpectrogram(), {
      pixelsPerSecond: 100,
      height: 8,
      devicePixelRatio: 1,
      durationSeconds: 2,
      virtualization: false,
      // Identity-ish colormap: intensity drives the red channel.
      colorMap: (t: number) => [Math.round(t * 255), 0, 0],
    });

    const {data, width} = blits[0];
    const pixelAt = (x: number, y: number) => {
      const o = (y * width + x) * 4;
      return [data[o], data[o + 1], data[o + 2], data[o + 3]];
    };
    // Left edge samples the silent frame, right edge the full-scale one.
    expect(pixelAt(0, 0)[0]).toBe(0);
    expect(pixelAt(width - 1, 0)[0]).toBeGreaterThan(200);
    // Every painted pixel is opaque.
    expect(pixelAt(0, 0)[3]).toBe(255);
    expect(pixelAt(width - 1, 4)[3]).toBe(255);
    viz.dispose();
  });

  it('rasterizes only the visible stripe when virtualization is on', () => {
    const {blits} = stubCanvas();
    // 300 CSS px of viewport over a 60 s clip at 100 px/s = 6000 px total.
    const host = mountHost(300);

    const viz = renderSpectrogramVisualizer(host, twoFrameSpectrogram(), {
      pixelsPerSecond: 100,
      height: 8,
      devicePixelRatio: 1,
      durationSeconds: 60,
      virtualization: {bufferScreens: 1},
    });

    expect(blits).toHaveLength(1);
    // Viewport plus one buffer screen each side, not the whole 6000 px clip.
    expect(blits[0].width).toBeLessThan(6_000);
    expect(blits[0].width).toBeLessThanOrEqual(900);
    expect(blits[0].width).toBeGreaterThan(0);
    viz.dispose();
  });

  it('paints everything when virtualization is turned off', () => {
    const {blits} = stubCanvas();
    const host = mountHost(300);

    const viz = renderSpectrogramVisualizer(host, twoFrameSpectrogram(), {
      pixelsPerSecond: 100,
      height: 8,
      devicePixelRatio: 1,
      durationSeconds: 60,
      virtualization: false,
    });

    expect(blits[0].width).toBe(6_000);
    viz.dispose();
  });

  it('does not re-rasterize the spectrogram when regions change', () => {
    const {blits, strokes} = stubCanvas();
    const host = mountHost(0);

    const viz = renderSpectrogramVisualizer(host, twoFrameSpectrogram(), {
      pixelsPerSecond: 100,
      height: 8,
      devicePixelRatio: 1,
      durationSeconds: 2,
      virtualization: false,
    });
    const afterMount = blits.length;

    viz.setRegions([createRegion({label: 'a', startSeconds: 0.2, endSeconds: 0.8})]);
    viz.setRegions([createRegion({label: 'a', startSeconds: 0.3, endSeconds: 0.9})]);

    // The image was untouched; only the region layer was redrawn.
    expect(blits).toHaveLength(afterMount);
    expect(strokes.length).toBeGreaterThanOrEqual(2);
    viz.dispose();
  });

  it('keeps both canvases viewport-sized and reuses buffered pixels during follow and pan', () => {
    const {blits} = stubCanvas();
    const host = mountHost(400);
    const viz = renderSpectrogramVisualizer(host, twoFrameSpectrogram(), {
      durationSeconds: 3_600, pixelsPerSecond: 100, height: 64, devicePixelRatio: 2,
    });
    const wrapper = host.firstElementChild as HTMLElement;
    const scroller = wrapper.lastElementChild as HTMLElement;
    const [canvas, regions] = Array.from(host.querySelectorAll('canvas'));
    expect(canvas.width).toBe(1_600);
    expect(regions.width).toBe(1_600);
    expect(canvas.style.width).toBe('800px');
    expect((scroller.firstElementChild as HTMLElement).style.width).toBe('360000px');

    for (let index = 0; index < 20; index++) viz.redraw(index / 20, true);
    expect(blits).toHaveLength(1);
    expect(viz.viewport()).toEqual({startSeconds: 0, endSeconds: 4});

    // Follow moves within the already rasterized second screen.
    viz.redraw(5, true);
    expect(blits).toHaveLength(1);
    expect(scroller.scrollLeft).toBe(300);
    expect(viz.hitTest(50, 0).seconds).toBe(3.5);

    // Exposing unpainted pixels moves the canvas stripe and rerasterizes once.
    viz.redraw(8, true);
    expect(blits).toHaveLength(2);
    expect(canvas.style.left).toBe('-400px');
    expect(canvas.width).toBe(2_400);
    expect(regions.width).toBe(2_400);
    expect(viz.viewport()).toEqual({startSeconds: 6, endSeconds: 10});
    viz.setRegions([createRegion({label: 'visible', startSeconds: 6, endSeconds: 7})]);
    expect(blits).toHaveLength(2);
    viz.dispose();
  });

  it('does no raster work before layout', () => {
    const {blits} = stubCanvas();
    const host = mountHost(0);
    const viz = renderSpectrogramVisualizer(host, twoFrameSpectrogram(), {
      durationSeconds: 60, pixelsPerSecond: 100, height: 256, devicePixelRatio: 2,
    });
    expect(blits).toHaveLength(0);
    for (const canvas of host.querySelectorAll('canvas')) {
      expect(canvas.width * canvas.height).toBe(1);
    }
    viz.redraw(1, true);
    expect(blits).toHaveLength(0);
    viz.dispose();
  });

  it('samples the actual nonuniform frame times and frequency centers', () => {
    const {blits} = stubCanvas();
    const host = mountHost(100);
    const viz = renderSpectrogramVisualizer(host, {
      times: [0, 0.1, 10],
      frequencies: [100, 1_000, 20_000],
      // Only the early middle frame and 1000Hz bin carry energy.
      magnitudes: Float32Array.from([0, 0, 0, 0, 1, 0, 0, 0, 0]),
      binsPerFrame: 3,
    }, {
      durationSeconds: 10, pixelsPerSecond: 100, height: 2, devicePixelRatio: 1,
      minFreq: 100, maxFreq: 5_000, colorMap: (value) => [Math.round(value * 255), 0, 0],
    });
    const {data, width} = blits[0];
    // At 0.1 s, 5 kHz is nearest to the 1000 Hz bin; 100 Hz is silent.
    expect(data[10 * 4]).toBe(255);
    expect(data[(width + 10) * 4]).toBe(0);
    expect(data[0]).toBe(0);
    viz.dispose();
  });

});
