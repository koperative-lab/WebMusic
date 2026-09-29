// ============================================================================
// Colormaps — map a scalar `t` in [0, 1] to an [r, g, b] triple (0..255).
//
// Used by the spectrogram renderer to colour magnitude bins. The perceptual
// maps (viridis / magma) are sampled from the canonical matplotlib control
// points and linearly interpolated; both are colour-blind friendly and
// perceptually uniform, which keeps faint spectral detail legible. `grayscale`
// is the trivial luminance ramp.
//
// Pure and DOM-free so they can be unit-tested in plain Node.
// ============================================================================

/** An [r, g, b] colour, each channel an integer in [0, 255]. */
export type RGB = [r: number, g: number, b: number];

/** A function mapping a scalar `t` in [0, 1] to an RGB colour. */
export type Colormap = (t: number) => RGB;

/** Clamp `t` to [0, 1], mapping NaN to 0. */
function clamp01(t: number): number {
  if (!Number.isFinite(t)) return 0;
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

/**
 * Sample a list of evenly-spaced RGB control points with linear interpolation
 * between neighbours. `stops[0]` is `t = 0`, `stops[n-1]` is `t = 1`.
 */
function sampleStops(stops: readonly RGB[], t: number): RGB {
  const clamped = clamp01(t);
  const last = stops.length - 1;
  if (last <= 0) return stops[0] ? [...stops[0]] : [0, 0, 0];
  const scaled = clamped * last;
  const i = Math.min(last - 1, Math.floor(scaled));
  const f = scaled - i;
  const a = stops[i];
  const b = stops[i + 1];
  return [
    Math.round(a[0] + (b[0] - a[0]) * f),
    Math.round(a[1] + (b[1] - a[1]) * f),
    Math.round(a[2] + (b[2] - a[2]) * f),
  ];
}

// 16-point samples of the matplotlib `viridis` colormap (dark blue → green → yellow).
const VIRIDIS_STOPS: readonly RGB[] = [
  [68, 1, 84],
  [72, 27, 109],
  [71, 51, 126],
  [65, 73, 134],
  [56, 93, 140],
  [48, 111, 142],
  [41, 128, 142],
  [35, 145, 140],
  [31, 161, 135],
  [40, 177, 124],
  [69, 191, 106],
  [110, 206, 83],
  [161, 217, 56],
  [216, 226, 39],
  [253, 231, 37],
  [253, 231, 37],
];

// 16-point samples of the matplotlib `magma` colormap (black → purple → orange → cream).
const MAGMA_STOPS: readonly RGB[] = [
  [0, 0, 4],
  [12, 8, 38],
  [34, 12, 75],
  [60, 9, 102],
  [86, 16, 110],
  [111, 23, 110],
  [136, 34, 106],
  [163, 43, 97],
  [188, 55, 84],
  [210, 71, 67],
  [228, 93, 51],
  [240, 121, 38],
  [248, 152, 32],
  [251, 185, 48],
  [251, 218, 87],
  [252, 253, 191],
];

/** Perceptually-uniform viridis colormap (dark blue → green → yellow). */
export function viridis(t: number): RGB {
  return sampleStops(VIRIDIS_STOPS, t);
}

/** Perceptually-uniform magma colormap (black → purple → orange → cream). */
export function magma(t: number): RGB {
  return sampleStops(MAGMA_STOPS, t);
}

/** Linear grayscale ramp (black → white). */
export function grayscale(t: number): RGB {
  const v = Math.round(clamp01(t) * 255);
  return [v, v, v];
}

/** Names of the built-in colormaps accepted by `color-map`. */
export type ColormapName = 'viridis' | 'magma' | 'grayscale' | 'gray';

const COLORMAPS: Record<ColormapName, Colormap> = {
  viridis,
  magma,
  grayscale,
  gray: grayscale,
};

/**
 * Resolve a colormap by name, falling back to {@link viridis} for an unknown
 * or missing name.
 */
export function colormapByName(name: string | null | undefined): Colormap {
  if (name && Object.prototype.hasOwnProperty.call(COLORMAPS, name)) {
    return COLORMAPS[name as ColormapName];
  }
  return viridis;
}
