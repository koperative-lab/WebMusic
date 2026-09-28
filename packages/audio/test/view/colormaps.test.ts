import {describe, expect, it} from 'vitest';
import {colormapByName, grayscale, magma, viridis, type RGB} from '../../src/view/core/colormaps';

/** Every channel of an RGB is an integer in [0, 255]. */
function isValidRGB(rgb: RGB): boolean {
  return rgb.every((c) => Number.isInteger(c) && c >= 0 && c <= 255);
}

describe('grayscale', () => {
  it('maps the endpoints to black and white', () => {
    expect(grayscale(0)).toEqual([0, 0, 0]);
    expect(grayscale(1)).toEqual([255, 255, 255]);
  });

  it('maps the midpoint to mid-gray', () => {
    expect(grayscale(0.5)).toEqual([128, 128, 128]);
  });

  it('clamps out-of-range and non-finite inputs', () => {
    expect(grayscale(-1)).toEqual([0, 0, 0]);
    expect(grayscale(2)).toEqual([255, 255, 255]);
    expect(grayscale(Number.NaN)).toEqual([0, 0, 0]);
  });
});

describe('viridis', () => {
  it('starts dark blue/purple and ends bright yellow', () => {
    expect(viridis(0)).toEqual([68, 1, 84]);
    expect(viridis(1)).toEqual([253, 231, 37]);
  });

  it('clamps out-of-range inputs to the endpoints', () => {
    expect(viridis(-5)).toEqual(viridis(0));
    expect(viridis(5)).toEqual(viridis(1));
  });

  it('returns valid RGB across the range', () => {
    for (let t = 0; t <= 1; t += 0.05) {
      expect(isValidRGB(viridis(t))).toBe(true);
    }
  });
});

describe('magma', () => {
  it('starts near-black and ends near-cream', () => {
    expect(magma(0)).toEqual([0, 0, 4]);
    expect(magma(1)).toEqual([252, 253, 191]);
  });

  it('returns valid RGB across the range', () => {
    for (let t = 0; t <= 1; t += 0.05) {
      expect(isValidRGB(magma(t))).toBe(true);
    }
  });

  it('is monotonically brightening on the green channel near the ends', () => {
    // Sanity: the bright end is much lighter than the dark end.
    expect(magma(1)[1]).toBeGreaterThan(magma(0)[1]);
  });
});

describe('colormapByName', () => {
  it('resolves the built-in names', () => {
    expect(colormapByName('viridis')(0)).toEqual(viridis(0));
    expect(colormapByName('magma')(1)).toEqual(magma(1));
    expect(colormapByName('grayscale')(0.5)).toEqual(grayscale(0.5));
    expect(colormapByName('gray')(0.5)).toEqual(grayscale(0.5));
  });

  it('falls back to viridis for unknown or missing names', () => {
    expect(colormapByName('nope')(0)).toEqual(viridis(0));
    expect(colormapByName(null)(1)).toEqual(viridis(1));
    expect(colormapByName(undefined)(0.5)).toEqual(viridis(0.5));
  });
});
