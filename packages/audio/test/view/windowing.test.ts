import {describe, expect, it} from 'vitest';
import {
  DEFAULT_BUFFER_SCREENS,
  MAX_CANVAS_DIMENSION,
  bufferedScrollRange,
  clampCanvasBackingSize,
  pixelToSeconds,
  secondsToPixel,
  visibleColumnRange,
  visibleTimeRange,
} from '../../src/view/core/windowing';

describe('bufferedScrollRange', () => {
  it('widens the visible stripe by bufferScreens on each side', () => {
    expect(bufferedScrollRange(1000, 500, 1)).toEqual({lo: 500, hi: 2000});
    expect(bufferedScrollRange(1000, 500, 0)).toEqual({lo: 1000, hi: 1500});
    expect(bufferedScrollRange(1000, 500, 2.5)).toEqual({lo: -250, hi: 2750});
  });

  it('treats negative buffers as zero', () => {
    expect(bufferedScrollRange(100, 50, -3)).toEqual({lo: 100, hi: 150});
  });
});

describe('visibleColumnRange', () => {
  it('returns the empty range for degenerate inputs', () => {
    expect(visibleColumnRange(0, 100, 1, 0)).toEqual({start: 0, end: 0});
    expect(visibleColumnRange(0, 100, 0, 1000)).toEqual({start: 0, end: 0});
    expect(visibleColumnRange(0, 0, 1, 1000)).toEqual({start: 0, end: 0});
  });

  it('covers the viewport plus a buffer screen on each side', () => {
    // 1px columns, viewport 200 wide, scrolled to 1000, 1 buffer screen.
    // lo = 1000 - 200 = 800, hi = 1000 + 200 + 200 = 1400.
    const range = visibleColumnRange(1000, 200, 1, 100_000, 1);
    expect(range).toEqual({start: 800, end: 1400});
  });

  it('clamps to [0, totalColumns]', () => {
    // Scrolled to the very start: lo is negative, clamps to 0.
    const start = visibleColumnRange(0, 200, 1, 1000, 1);
    expect(start.start).toBe(0);
    expect(start.end).toBe(400); // 0 + 200 + 200 buffer

    // Scrolled to the very end: end clamps to totalColumns.
    const end = visibleColumnRange(900, 200, 1, 1000, 1);
    expect(end.end).toBe(1000);
  });

  it('groups columns when columnWidth > 1', () => {
    // 10px-wide columns: viewport [0, 100) with no buffer → columns 0..10.
    const range = visibleColumnRange(0, 100, 10, 1000, 0);
    expect(range).toEqual({start: 0, end: 10});
  });

  it('never returns an inverted range', () => {
    const range = visibleColumnRange(100_000, 200, 1, 1000, 1);
    expect(range.end).toBeGreaterThanOrEqual(range.start);
  });
});

describe('visibleTimeRange', () => {
  it('maps pixels to seconds at the given zoom (+ buffer)', () => {
    // 100 px/s, viewport 200 px (=2 s), scrollLeft 1000 px (=10 s), 1 buffer.
    // lo = 800 px = 8 s, hi = 1400 px = 14 s.
    const range = visibleTimeRange(1000, 200, 100, 3600, 1);
    expect(range.startSeconds).toBeCloseTo(8);
    expect(range.endSeconds).toBeCloseTo(14);
  });

  it('clamps start at 0 and end at duration', () => {
    const range = visibleTimeRange(0, 200, 100, 1, 1);
    expect(range.startSeconds).toBe(0);
    expect(range.endSeconds).toBe(1); // clamped to duration
  });

  it('returns an empty window for non-positive zoom', () => {
    expect(visibleTimeRange(100, 200, 0, 10)).toEqual({startSeconds: 0, endSeconds: 0});
  });
});

describe('pixel ↔ seconds', () => {
  it('round-trips through the zoom factor', () => {
    expect(secondsToPixel(3, 120)).toBe(360);
    expect(pixelToSeconds(360, 120)).toBeCloseTo(3);
  });

  it('pixelToSeconds is 0 for non-positive zoom', () => {
    expect(pixelToSeconds(100, 0)).toBe(0);
    expect(pixelToSeconds(100, -5)).toBe(0);
  });
});

describe('clampCanvasBackingSize', () => {
  it('multiplies CSS size by dpr in the normal case', () => {
    expect(clampCanvasBackingSize(800, 600, 2)).toEqual({width: 1600, height: 1200, scaleX: 2, scaleY: 2});
  });

  it('caps each dimension to the browser-safe maximum', () => {
    // 20-minute clip at 30 px/s = 36 000 css px; 2x dpr would be 72 000.
    const size = clampCanvasBackingSize(36_000, 400, 2);
    expect(size.width).toBe(MAX_CANVAS_DIMENSION);
    expect(size.height).toBe(800);
    expect(size.scaleX).toBeCloseTo(MAX_CANVAS_DIMENSION / 36_000);
    expect(size.scaleY).toBe(2);
  });

  it('never returns a zero or negative size', () => {
    const size = clampCanvasBackingSize(0, -5, 0);
    expect(size.width).toBeGreaterThanOrEqual(1);
    expect(size.height).toBeGreaterThanOrEqual(1);
    expect(size.scaleX).toBeGreaterThan(0);
    expect(size.scaleY).toBeGreaterThan(0);
  });

  it('handles non-finite dpr', () => {
    const size = clampCanvasBackingSize(100, 100, Number.NaN);
    expect(size.width).toBe(100);
    expect(size.scaleX).toBe(1);
  });
});

describe('DEFAULT_BUFFER_SCREENS', () => {
  it('is a sane positive default', () => {
    expect(DEFAULT_BUFFER_SCREENS).toBeGreaterThan(0);
  });
});
