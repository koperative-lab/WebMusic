// @vitest-environment jsdom
import {afterEach, describe, expect, it, vi} from 'vitest';
import type {ScoreNoteSequence, ScoreViewDirection} from '../../src/view/core/types';
import {PianoRollCanvasVisualizer, PianoRollSVGVisualizer} from '../../src/view/render/renderers/piano-roll';
import {WaterfallSVGVisualizer} from '../../src/view/render/renderers/waterfall';

const directions = ['up', 'down', 'left', 'right'] as const;
const sequence: ScoreNoteSequence = {
  ticksPerQuarter: 220, tempos: [{time: 0, qpm: 120}], timeSignatures: [], keySignatures: [], partInfos: [], totalTime: 10,
  notes: [
    {pitch: 60, startTime: 0, endTime: 1}, {pitch: 61, startTime: 0, endTime: 1},
    {pitch: 64, startTime: 0, endTime: 1}, {pitch: 60, startTime: 2, endTime: 3},
  ],
};
const horizontal = (direction: ScoreViewDirection) => direction === 'left' || direction === 'right';

function container() {
  const host = document.createElement('div');
  let width = 320; let height = 180;
  Object.defineProperties(host, {clientWidth: {get: () => width}, clientHeight: {get: () => height}});
  document.body.append(host);
  return {host, resize: (w: number, h: number) => {width = w; height = h;}};
}

function note(svg: Element, index: number) {
  const element = svg.querySelector<SVGRectElement>(`[data-index="${index}"]`)!;
  return {element, x: Number(element.getAttribute('x')), y: Number(element.getAttribute('y')), w: Number(element.getAttribute('width')), h: Number(element.getAttribute('height'))};
}

afterEach(() => { document.body.replaceChildren(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('physical note directions', () => {
  it.each(directions)('draws piano-roll time toward %s with complete endpoint pitch lanes', (direction) => {
    const {host} = container();
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); host.append(svg);
    const view = new PianoRollSVGVisualizer(sequence, svg, {direction, minPitch: 60, maxPitch: 64, noteHeight: 12, pixelsPerSecond: 60, noteSpacing: 0});
    const low = note(svg, 0); const high = note(svg, 2); const later = note(svg, 3);
    const inverted = direction === 'left' || direction === 'up';
    expect(horizontal(direction) ? low.w : low.h).toBe(60);
    expect(horizontal(direction) ? low.h : low.w).toBe(12);
    expect(horizontal(direction) ? high.y < low.y : high.x > low.x).toBe(true);
    expect(horizontal(direction) ? later.x - low.x : later.y - low.y).toBe(inverted ? -120 : 120);
    expect(Number(svg.getAttribute('width'))).toBe(horizontal(direction) ? 600 : 60);
    expect(Number(svg.getAttribute('height'))).toBe(horizontal(direction) ? 60 : 600);
    for (const index of [0, 1, 2, 3]) {
      const rect = note(svg, index);
      expect(rect.x).toBeGreaterThanOrEqual(0); expect(rect.y).toBeGreaterThanOrEqual(0);
      expect(rect.x + rect.w).toBeLessThanOrEqual(Number(svg.getAttribute('width')));
      expect(rect.y + rect.h).toBeLessThanOrEqual(Number(svg.getAttribute('height')));
    }
    view.redrawAtTime(.5); expect(svg.querySelectorAll('.active')).toHaveLength(3);
    view.redrawAtTime(1); expect(svg.querySelectorAll('.active')).toHaveLength(0);
    view.dispose(); expect(host.children).toHaveLength(1);
  });

  it.each(directions)('lands waterfall notes at %s and rewinds without changing musical time', (direction) => {
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {callback(0); return 1;});
    const {host} = container();
    const view = new WaterfallSVGVisualizer(sequence, host, {direction, minPitch: 60, maxPitch: 64, whiteNoteWidth: 30, blackNoteWidth: 18, pixelsPerSecond: 60, noteSpacing: 0});
    const svg = host.querySelector('svg')!;
    const viewport = host.firstElementChild as HTMLElement;
    Object.defineProperties(viewport, {clientWidth: {value: 320}, clientHeight: {value: 180}});
    const low = note(svg, 0); const black = note(svg, 1); const high = note(svg, 2); const later = note(svg, 3);
    const inverted = direction === 'down' || direction === 'right';
    expect(horizontal(direction) ? low.h : low.w).toBe(30);
    expect(horizontal(direction) ? black.h : black.w).toBe(18);
    expect(horizontal(direction) ? high.y < low.y : high.x > low.x).toBe(true);
    expect(horizontal(direction) ? later.x - low.x : later.y - low.y).toBe(inverted ? -120 : 120);
    const scroll = () => horizontal(direction) ? viewport.scrollLeft : viewport.scrollTop;
    view.redrawAtTime(2, true); expect(scroll()).toBe(inverted ? 480 : 120);
    view.redrawAtTime(1, true); expect(scroll()).toBe(inverted ? 540 : 60);
    if (horizontal(direction)) viewport.scrollLeft = inverted ? 400 : 200;
    else viewport.scrollTop = inverted ? 400 : 200;
    view.redrawAtTime(2, true); expect(scroll()).toBe(inverted ? 400 : 200);
    view.redrawAtTime(0, true); expect(scroll()).toBe(inverted ? 600 : 0);
    expect(svg.querySelectorAll('.active')).toHaveLength(3);
    view.dispose(); expect(host.children).toHaveLength(0);
  });

  it.each(directions)('fits waterfall pitch breadth on the physical axis when facing %s', (direction) => {
    const callbacks: Array<() => void> = [];
    class Observer { constructor(callback: () => void) {callbacks.push(callback);} observe() {} disconnect() {} }
    vi.stubGlobal('ResizeObserver', Observer);
    const box = container();
    const view = new WaterfallSVGVisualizer(sequence, box.host, {direction, minPitch: 60, maxPitch: 64, fitToWidth: true, pixelsPerSecond: 60});
    const breadth = () => Number(box.host.querySelector('svg')!.getAttribute(horizontal(direction) ? 'height' : 'width'));
    expect(breadth()).toBe(horizontal(direction) ? 180 : 320);
    box.resize(480, 270); for (const callback of callbacks) callback();
    expect(breadth()).toBe(horizontal(direction) ? 270 : 480);
    view.dispose();
  });

  it.each(directions)('virtualizes the physical %s waterfall time window', (direction) => {
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {callback(0); return 1;});
    const {host} = container();
    const dense: ScoreNoteSequence = {...sequence, totalTime: 100, notes: Array.from({length: 1000}, (_, index) => ({pitch: 60, startTime: index / 10, endTime: (index + 1) / 10}))};
    const view = new WaterfallSVGVisualizer(dense, host, {direction, minPitch: 60, maxPitch: 64, whiteNoteWidth: 30, pixelsPerSecond: 60, virtualization: {bufferScreens: 0}});
    const viewport = host.firstElementChild as HTMLElement;
    Object.defineProperties(viewport, {clientWidth: {value: 320}, clientHeight: {value: 180}});
    if (horizontal(direction)) viewport.scrollLeft = 3000;
    else viewport.scrollTop = 3000;
    viewport.dispatchEvent(new Event('scroll'));
    const mounted = [...host.querySelectorAll<SVGRectElement>('[data-index]')];
    expect(mounted.length).toBeGreaterThan(1); expect(mounted.length).toBeLessThan(60);
    expect(mounted.some((rect) => Number(rect.dataset.index) === 500)).toBe(true);
    view.dispose();
  });

  it.each(directions)('keeps canvas geometry and overlay coordinates aligned toward %s', (direction) => {
    const paints: number[][] = [];
    const context = {setTransform: vi.fn(), clearRect: vi.fn(), fillRect: (...rect: number[]) => paints.push(rect), fillStyle: '', globalAlpha: 1};
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D);
    const {host} = container(); const canvas = document.createElement('canvas'); host.append(canvas);
    const view = new PianoRollCanvasVisualizer(sequence, canvas, {direction, minPitch: 60, maxPitch: 64, noteHeight: 12, noteSpacing: 0, pixelsPerSecond: 60});
    const viewport = host.querySelector<HTMLElement>('.webscore-piano-roll-viewport')!;
    viewport.scrollLeft = direction === 'left' ? 500 : 0;
    viewport.scrollTop = direction === 'up' ? 500 : 0;
    view.redraw();
    expect(paints.some(([x, y, w, h]) => horizontal(direction)
      ? x === (direction === 'left' ? 540 : 0) && y === 48 && w === 60 && h === 12
      : x === 0 && y === (direction === 'up' ? 540 : 0) && w === 12 && h === 60)).toBe(true);
    view.dispose();
  });
});
