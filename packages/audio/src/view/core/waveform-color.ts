// ============================================================================
// Frequency colouring for the waveform — turn a spectrogram into one RGB colour
// per frame so the amplitude waveform can be tinted by its spectral content
// (the "multi-band" look: bass → red, mids → green, treble → blue, and their
// additive mixes — yellow, cyan, magenta, white).
//
// The waveform's SHAPE always comes from the amplitude peaks; this module only
// decides the COLOUR of each column. Colours are precomputed once per frame
// (frames are far coarser than pixels) and the renderer looks them up by time,
// so per-frame painting stays an O(1) array read.
//
// Pure and DOM-free so it can be unit-tested in plain Node.
// ============================================================================

import type {SpectrogramData} from './types';
import {colormapByName} from './colormaps';

/** How the waveform is coloured. */
export type WaveformColorMode = 'static' | 'multiband' | 'colormap';

/** Precomputed per-frame colours plus the time mapping to look them up by. */
export interface FrameColors {
  /** `frames * 3` bytes — `[r, g, b]` per frame. */
  colors: Uint8ClampedArray;
  frames: number;
  /** Onset time (seconds) of frame 0. */
  startTime: number;
  /** Seconds between consecutive frames. */
  frameStep: number;
}

function at(a: ArrayLike<number>, i: number): number {
  return a[i] ?? 0;
}

function frameCount(spec: SpectrogramData): number {
  return spec.binsPerFrame > 0 ? Math.floor(spec.magnitudes.length / spec.binsPerFrame) : 0;
}

/** Pure hue at full saturation/value. `h` in [0, 1) around the colour wheel. */
function hueRGB(h: number): [number, number, number] {
  const x = (((h % 1) + 1) % 1) * 6;
  const c = 1;
  const seg = Math.floor(x) % 6;
  const f = x - Math.floor(x);
  switch (seg) {
    case 0:
      return [c, c * f, 0];
    case 1:
      return [c * (1 - f), c, 0];
    case 2:
      return [0, c, c * f];
    case 3:
      return [0, c * (1 - f), c];
    case 4:
      return [c * f, 0, c];
    default:
      return [c, 0, c * (1 - f)];
  }
}

/** Linear-frequency bin index nearest to `freq` Hz. */
function freqToBin(nyquist: number, bins: number, freq: number): number {
  if (nyquist <= 0) return 0;
  return Math.round((freq / nyquist) * (bins - 1));
}

/** `N + 1` monotonically-increasing bin edges, log-spaced in frequency. */
function bandBinEdges(nyquist: number, bins: number, fMin: number, n: number): number[] {
  const logMin = Math.log(Math.max(1, fMin));
  const logMax = Math.log(Math.max(fMin * 2, nyquist));
  const edges: number[] = [];
  for (let i = 0; i <= n; i += 1) {
    const freq = Math.exp(logMin + (logMax - logMin) * (i / n));
    edges.push(freqToBin(nyquist, bins, freq));
  }
  edges[0] = 0;
  edges[n] = bins;
  for (let i = 1; i <= n; i += 1) {
    if (edges[i] <= edges[i - 1]) edges[i] = Math.min(bins, edges[i - 1] + 1);
  }
  return edges;
}

/**
 * Precompute one RGB colour per spectrogram frame.
 *
 * - `multiband`: split the spectrum into `bands` log-spaced bands (default 3 →
 *   red / green / blue), sum each band's magnitude, and add the band colours
 *   weighted by energy. Each frame is normalised so its brightest channel hits
 *   full intensity — so the colour reads the spectral *balance* (the waveform's
 *   height already carries loudness).
 * - `colormap`: map each frame's spectral centroid (0 = lowest bin, 1 = Nyquist)
 *   through the named colormap.
 */
export function computeFrameColors(
  spec: SpectrogramData,
  mode: WaveformColorMode,
  opts: {bands?: number; colorMap?: string; minFreq?: number} = {},
): FrameColors {
  const binsPerFrame = spec.binsPerFrame;
  const frames = frameCount(spec);
  const colors = new Uint8ClampedArray(Math.max(0, frames) * 3);
  const startTime = frames > 0 ? at(spec.times, 0) : 0;
  const frameStep = frames > 1 ? (at(spec.times, frames - 1) - startTime) / (frames - 1) : 0;
  if (frames === 0 || binsPerFrame === 0 || mode === 'static') {
    return {colors, frames, startTime, frameStep};
  }

  if (mode === 'colormap') {
    const cmap = colormapByName(opts.colorMap);
    const span = binsPerFrame - 1 || 1;
    for (let f = 0; f < frames; f += 1) {
      const base = f * binsPerFrame;
      let sum = 0;
      let weighted = 0;
      for (let bin = 0; bin < binsPerFrame; bin += 1) {
        const m = spec.magnitudes[base + bin] ?? 0;
        sum += m;
        weighted += m * (bin / span);
      }
      const t = sum > 0 ? weighted / sum : 0;
      const [r, g, b] = cmap(t);
      colors[f * 3] = r;
      colors[f * 3 + 1] = g;
      colors[f * 3 + 2] = b;
    }
    return {colors, frames, startTime, frameStep};
  }

  // multiband
  const n = Math.max(1, Math.min(12, Math.floor(opts.bands ?? 3)));
  const nyquist = at(spec.frequencies, binsPerFrame - 1) || 1;
  const edges = bandBinEdges(nyquist, binsPerFrame, Math.max(20, opts.minFreq ?? 40), n);
  // For n = 3 this is exactly red / green / blue.
  const palette: Array<[number, number, number]> = [];
  for (let i = 0; i < n; i += 1) palette.push(hueRGB(i / n));

  for (let f = 0; f < frames; f += 1) {
    const base = f * binsPerFrame;
    let r = 0;
    let g = 0;
    let b = 0;
    for (let band = 0; band < n; band += 1) {
      let energy = 0;
      for (let bin = edges[band]; bin < edges[band + 1]; bin += 1) {
        energy += spec.magnitudes[base + bin] ?? 0;
      }
      energy = Math.sqrt(energy); // tame the dynamic range
      const [pr, pg, pb] = palette[band];
      r += pr * energy;
      g += pg * energy;
      b += pb * energy;
    }
    // Pull toward a pure hue — remove most of the shared "white" component so the
    // tint stays vivid even when energy is spread across bands, then normalise so
    // the brightest channel hits full intensity.
    const gray = Math.min(r, g, b) * 0.82;
    r -= gray;
    g -= gray;
    b -= gray;
    const peak = Math.max(r, g, b);
    const norm = peak > 0 ? 255 / peak : 0;
    colors[f * 3] = r * norm;
    colors[f * 3 + 1] = g * norm;
    colors[f * 3 + 2] = b * norm;
  }
  return {colors, frames, startTime, frameStep};
}
