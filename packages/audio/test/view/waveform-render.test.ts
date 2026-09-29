// @vitest-environment jsdom

import {afterEach, describe, expect, it, vi} from 'vitest';
import {renderWaveformVisualizer} from '../../src/view/render/waveform';
import {createRegion, type AudioPeaks} from '../../src/core';

interface RecordedFill {
  x: number; y: number; width: number; height: number; color: string; alpha: number;
}
interface CanvasRecording {
  fills: RecordedFill[];
  transforms: number[][];
  translations: number[][];
  context: CanvasRenderingContext2D;
}
interface RecordedComposite {
  target: HTMLCanvasElement;
  source: HTMLCanvasElement;
  coordinates: number[];
  fills: RecordedFill[];
}

/** Record geometry at the actual raster and visible-canvas boundary. */
function stubCanvas() {
  const fills: number[] = [];
  const colors: string[] = [];
  const canvases = new Map<HTMLCanvasElement, CanvasRecording>();
  const composites: RecordedComposite[] = [];
  const operations: string[] = [];
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (
    this: HTMLCanvasElement,
  ) {
    const existing = canvases.get(this);
    if (existing) return existing.context;
    const record = {fills: [], transforms: [], translations: []} as unknown as CanvasRecording;
    const visible = !!this.parentElement;
    let fill = '#000';
    let alpha = 1;
    record.context = {
      canvas: this,
      setTransform: (...values: number[]) => record.transforms.push(values),
      translate: (...values: number[]) => record.translations.push(values),
      clearRect: () => {
        operations.push(visible ? 'surface-clear' : 'raster-clear');
        record.fills.length = 0;
      },
      fillRect: (x: number, y: number, width: number, height: number) => {
        operations.push(visible ? 'surface-fill' : 'raster-fill');
        fills.push(x);
        colors.push(fill);
        record.fills.push({x, y, width, height, color: fill, alpha});
      },
      drawImage: (source: HTMLCanvasElement, ...coordinates: number[]) => {
        operations.push('composite');
        composites.push({target: this, source, coordinates, fills: [...(canvases.get(source)?.fills ?? [])]});
      },
      set fillStyle(value: string) { fill = value; },
      get fillStyle() { return fill; },
      set globalAlpha(value: number) { alpha = value; },
      get globalAlpha() { return alpha; },
    } as unknown as CanvasRenderingContext2D;
    canvases.set(this, record);
    return record.context;
  });
  return {fills, colors, canvases, composites, operations};
}

/** One pyramid level, mono, alternating quiet/loud peaks. */
function peaks(count = 512): AudioPeaks {
  const data = new Int8Array(count * 2);
  for (let i = 0; i < count; i += 1) {
    const amp = i % 2 === 0 ? 40 : 100;
    data[i * 2] = -amp;
    data[i * 2 + 1] = amp;
  }
  return {
    sampleRate: 44_100,
    channels: 1,
    levels: [{samplesPerPeak: 256, data}],
  } as AudioPeaks;
}

function mountHost(width = 400): HTMLElement {
  const host = document.createElement('div');
  document.body.append(host);
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

describe('renderWaveformVisualizer raster stability', () => {
  it.each([0.75, 1, 1.25, 2])('keeps adjacent translucent bars on integer texels at DPR %s', (dpr) => {
    const {canvases, composites, operations} = stubCanvas();
    const host = mountHost(400);
    Object.defineProperty(HTMLDivElement.prototype, 'clientHeight', {value: 100, configurable: true});
    const data: AudioPeaks = {
      sampleRate: 100, channels: 1, baseSamplesPerPeak: 1,
      levels: [{samplesPerPeak: 1, data: new Int8Array(2000).fill(64).map((value, index) => index % 2 ? value : -value)}],
    };
    const viz = renderWaveformVisualizer(host, data, {
      pixelsPerSecond: 100, height: 100, devicePixelRatio: dpr,
      waveColor: 'rgba(10,20,30,0.5)', progressColor: 'rgba(10,20,30,0.5)', playheadMode: 'center',
    });
    viz.redraw(2.5, false);
    viz.redraw();
    const first = composites.at(-1)!;
    const source = first.source;
    const width = vi.spyOn(source, 'width', 'set');
    const height = vi.spyOn(source, 'height', 'set');
    operations.length = 0;
    viz.redraw(2.5025, false);
    viz.redraw();
    const shifted = composites.at(-1)!;
    expect(shifted.fills).toEqual(first.fills);
    expect(shifted.fills).toHaveLength(401);
    expect(shifted.fills.every((bar) => Number.isInteger(bar.x) && bar.width === 1)).toBe(true);
    expect(shifted.fills.every((bar) => bar.color === 'rgba(10, 20, 30, 0.5)')).toBe(true);
    expect(shifted.coordinates[4]).toBeCloseTo(-0.25);
    expect(shifted.coordinates[6]).toBe(401);
    expect(canvases.get(source)!.transforms.every(([xScale]) => xScale === 1)).toBe(true);
    expect(canvases.get(source)!.translations).toEqual([]);
    expect(source.width).toBe(401);
    expect(source.height).toBe(Math.round(100 * dpr));
    expect(shifted.target.width).toBe(Math.round(400 * dpr));
    expect(width).not.toHaveBeenCalled();
    expect(height).not.toHaveBeenCalled();
    expect(operations.lastIndexOf('raster-fill')).toBeLessThan(operations.lastIndexOf('surface-clear'));
    expect(operations.slice(-2)).toEqual(['surface-clear', 'composite']);
    expect(host.querySelectorAll('canvas')).toHaveLength(1);
    viz.dispose();
    expect(source.width * source.height).toBe(1);
  });

  it('preserves clip-anchored sample phase across integer offset crossings', () => {
    const {composites} = stubCanvas();
    const host = mountHost(8);
    Object.defineProperty(HTMLDivElement.prototype, 'clientHeight', {value: 100, configurable: true});
    const data: AudioPeaks = {
      sampleRate: 100, channels: 1, baseSamplesPerPeak: 1,
      levels: [{samplesPerPeak: 1, data: Int8Array.from({length: 2000}, (_, index) => (index % 2 ? 1 : -1) * (20 + Math.floor(index / 2) % 80))}],
    };
    const viz = renderWaveformVisualizer(host, data, {
      pixelsPerSecond: 100, devicePixelRatio: 1.25, waveColor: '#999', progressColor: '#999',
    });
    viz.setOffset(2.0025);
    const previous = composites.at(-1)!;
    viz.setOffset(2.0125);
    const next = composites.at(-1)!;
    const profile = (bars: RecordedFill[]) => bars.map(({y, height}) => ({y, height}));
    expect(profile(next.fills.slice(0, -1))).toEqual(profile(previous.fills.slice(1)));
    expect(next.coordinates[4]).toBeCloseTo(previous.coordinates[4]);
    viz.dispose();
  });

  it('preserves progress, recent-history opacity and region paint in the completed raster', () => {
    const {composites} = stubCanvas();
    const host = mountHost(400);
    Object.defineProperty(HTMLDivElement.prototype, 'clientHeight', {value: 100, configurable: true});
    const data: AudioPeaks = {
      sampleRate: 100, channels: 1, baseSamplesPerPeak: 1,
      levels: [{samplesPerPeak: 1, data: Int8Array.from({length: 2000}, (_, index) => index % 2 ? 64 : -64)}],
    };
    const viz = renderWaveformVisualizer(host, data, {
      pixelsPerSecond: 100, playheadMode: 'center', historyTrail: 1,
      waveColor: 'red', progressColor: 'blue', regions: [createRegion({label: 'Region', startSeconds: 2, endSeconds: 2.5})],
    });
    viz.redraw(3, false);
    viz.redraw();
    const [region, ...bars] = composites.at(-1)!.fills;
    expect(region).toMatchObject({x: 100, width: 50, y: 0, height: 100, alpha: 1});
    expect(bars[0]).toMatchObject({color: 'rgb(0, 0, 255)', alpha: 0.32});
    expect(bars[100]).toMatchObject({color: 'rgb(0, 0, 255)', alpha: 1});
    expect(bars[200]).toMatchObject({color: 'rgb(0, 0, 255)', alpha: 1});
    expect(bars[201]).toMatchObject({color: 'rgb(255, 0, 0)', alpha: 0.32});
    expect(bars[0]).toMatchObject({y: 25, height: 50});
    viz.dispose();
  });

  it('uses the full raw-amplitude lane height without adding inner vertical padding', () => {
    const {composites} = stubCanvas();
    const host = mountHost(8);
    Object.defineProperty(HTMLDivElement.prototype, 'clientHeight', {value: 100, configurable: true});
    const data: AudioPeaks = {
      sampleRate: 100, channels: 2, baseSamplesPerPeak: 1,
      levels: [{samplesPerPeak: 1, data: Int8Array.from({length: 400}, (_, index) => index % 2 ? 64 : -64)}],
    };
    const viz = renderWaveformVisualizer(host, data, {pixelsPerSecond: 100, amplitude: 2, channelLayout: 'split'});
    const bars = composites.at(-1)!.fills;
    expect(bars[0]).toMatchObject({y: 0, height: 50});
    expect(bars[1]).toMatchObject({y: 50, height: 50});
    expect(bars.length).toBeLessThanOrEqual(18);
    viz.dispose();
  });
});

describe('renderWaveformVisualizer playhead updates', () => {
  it('paints an observed frame immediately and cancels an older coalesced paint', () => {
    const frames = new Map<number, FrameRequestCallback>();
    let next = 0;
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      const id = ++next;
      frames.set(id, callback);
      return id;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
    const {composites} = stubCanvas();
    const viz = renderWaveformVisualizer(mountHost(), peaks(), {pixelsPerSecond: 100});
    composites.length = 0;
    viz.redraw(0.5);
    expect(composites).toHaveLength(0);
    expect(frames.size).toBe(1);
    viz.redrawFrame!(0.625);
    expect(composites).toHaveLength(1);
    expect(frames.size).toBe(0);
    viz.redrawFrame!(0.75);
    expect(composites).toHaveLength(2);
    expect(frames.size).toBe(0);
    viz.dispose();
    viz.redrawFrame!(1);
    expect(composites).toHaveLength(2);
  });

  it('coalesces playhead repaints onto one animation frame', () => {
    const frames: Array<() => void> = [];
    vi.stubGlobal('requestAnimationFrame', (cb: () => void) => {
      frames.push(cb);
      return frames.length;
    });
    vi.stubGlobal('cancelAnimationFrame', () => {});
    const {fills} = stubCanvas();
    const host = mountHost();

    const viz = renderWaveformVisualizer(host, peaks(), {
      pixelsPerSecond: 100,
      height: 64,
      devicePixelRatio: 1,
    });
    fills.length = 0;

    // A burst of cursor updates, as a 20 Hz timeupdate feed produces.
    for (let i = 1; i <= 10; i += 1) viz.redraw(i * 0.05);

    // Nothing painted yet, and only ONE frame is pending for all ten.
    expect(fills).toHaveLength(0);
    expect(frames).toHaveLength(1);

    frames[0]();
    expect(fills.length).toBeGreaterThan(0);

    // The next update schedules a fresh frame rather than reusing the spent one.
    viz.redraw(1);
    expect(frames).toHaveLength(2);
    viz.dispose();
  });

  it('paints synchronously when no animation frame is available (SSR-ish hosts)', () => {
    vi.stubGlobal('requestAnimationFrame', undefined);
    const {fills} = stubCanvas();
    const host = mountHost();

    const viz = renderWaveformVisualizer(host, peaks(), {
      pixelsPerSecond: 100,
      height: 64,
      devicePixelRatio: 1,
    });
    fills.length = 0;

    viz.redraw(0.5);
    expect(fills.length).toBeGreaterThan(0);
    viz.dispose();
  });

  it('still paints a full redraw (no playhead argument) immediately', () => {
    const frames: Array<() => void> = [];
    vi.stubGlobal('requestAnimationFrame', (cb: () => void) => {
      frames.push(cb);
      return frames.length;
    });
    const {fills} = stubCanvas();
    const host = mountHost();

    const viz = renderWaveformVisualizer(host, peaks(), {
      pixelsPerSecond: 100,
      height: 64,
      devicePixelRatio: 1,
    });
    fills.length = 0;

    // A structural redraw is not a cursor tick: it must not wait for a frame.
    viz.redraw();
    expect(fills.length).toBeGreaterThan(0);
    viz.dispose();
  });
});


describe('renderWaveformVisualizer colors', () => {
  it('preserves named and translucent CSS colors instead of falling back to blue', () => {
    const {colors} = stubCanvas();
    const host = mountHost();
    const viz = renderWaveformVisualizer(host, peaks(), {
      waveColor: 'gold',
      progressColor: 'rgba(10, 20, 30, 0.5)',
    });
    expect(colors).toContain('rgb(255, 215, 0)');
    expect(colors).toContain('rgba(10, 20, 30, 0.5)');
    viz.dispose();
  });

  it('repaints inherited CSS colors without changing the viewport and releases observation', async () => {
    const frames: Array<() => void> = [];
    vi.stubGlobal('requestAnimationFrame', (callback: () => void) => {
      frames.push(callback);
      return frames.length;
    });
    const cancel = vi.fn();
    vi.stubGlobal('cancelAnimationFrame', cancel);
    const {colors} = stubCanvas();
    const host = mountHost();
    host.style.color = 'rgb(10, 20, 30)';
    const computedStyle = window.getComputedStyle.bind(window);
    // jsdom has no CSS custom-property cascade. Supply the browser's resolved
    // color at that boundary; a browser smoke check covers the real cascade.
    vi.spyOn(window, 'getComputedStyle').mockImplementation((element) => {
      if ((element as HTMLElement).style.color.includes('var(')) {
        return {color: host.style.color} as CSSStyleDeclaration;
      }
      return computedStyle(element);
    });
    const viz = renderWaveformVisualizer(host, peaks(4096), {
      waveColor: 'var(--wm-waveform, currentColor)',
      progressColor: 'var(--wm-waveform-progress, currentColor)',
    });
    viz.setOffset(4);
    const viewport = viz.viewport();
    const changed = vi.fn();
    viz.onViewportChange(changed);
    colors.length = 0;
    host.style.color = 'rgb(220, 230, 240)';
    await Promise.resolve();
    expect(frames).toHaveLength(1);
    frames[0]();
    expect(colors).toContain('rgb(220, 230, 240)');
    expect(viz.viewport()).toEqual(viewport);
    expect(changed).not.toHaveBeenCalled();

    host.style.color = 'rgb(30, 40, 50)';
    await Promise.resolve();
    expect(frames).toHaveLength(2);
    viz.dispose();
    expect(cancel).toHaveBeenCalledWith(2);
    host.style.color = 'rgb(40, 50, 60)';
    await Promise.resolve();
    expect(frames).toHaveLength(2);
  });
});


describe('renderWaveformVisualizer split channel hit testing', () => {
  it('reports only the first two displayed channels for multichannel peaks', () => {
    stubCanvas();
    const host = mountHost();
    Object.defineProperty(HTMLDivElement.prototype, 'clientHeight', {value: 100, configurable: true});
    const data = peaks();
    const viz = renderWaveformVisualizer(host, {...data, channels: 4}, {channelLayout: 'split'});
    expect(viz.hitTest(0, 40)).toMatchObject({channel: 0});
    expect(viz.hitTest(0, 60)).toMatchObject({channel: 1});
    expect(viz.hitTest(0, 99)).toMatchObject({channel: 1});
    viz.dispose();
  });
});
