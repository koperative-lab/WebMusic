// ============================================================================
// computeSpectrogram — a self-built STFT pipeline (framing → Hann window →
// hop → magnitude) over an `FFTBackend`. The FFT *kernel* is `fft.js` by
// default (radix-4, fast, MIT); `webfft` can be slotted in as an optional
// high-performance backend behind the same interface. Framing, windowing,
// hopping and magnitude extraction are all done here.
//
// Optional mel projection: a self-built triangular mel filterbank reduces the
// linear bins to `mel` mel bands (Slaney-style, HTK mel scale).
// ============================================================================

import FFT from 'fft.js';
import type {SpectrogramData} from './types';

/**
 * Pluggable FFT kernel. `forward(realInput)` returns the magnitude spectrum of
 * the first half + DC + Nyquist (`fftSize / 2 + 1` bins). Implementations may
 * keep internal buffers; callers must not retain the returned array across
 * calls (copy what you need).
 */
export interface FFTBackend {
  readonly size: number;
  /** Magnitude spectrum (length `size / 2 + 1`) of a real, windowed frame. */
  forward(frame: Float32Array): Float32Array;
}

/** Default backend built on `fft.js` (radix-4 real FFT). */
export function createFftJsBackend(size: number): FFTBackend {
  const fft = new FFT(size);
  const out = fft.createComplexArray();
  const input = new Array<number>(size);
  const bins = size / 2 + 1;
  const mags = new Float32Array(bins);
  return {
    size,
    forward(frame: Float32Array): Float32Array {
      for (let i = 0; i < size; i++) input[i] = frame[i] ?? 0;
      fft.realTransform(out, input);
      // realTransform fills the left half; out is interleaved [re, im, ...].
      // DC (bin 0) has zero imaginary part; Nyquist is at index size.
      mags[0] = Math.abs(out[0]);
      for (let b = 1; b < bins - 1; b++) {
        const re = out[2 * b];
        const im = out[2 * b + 1];
        mags[b] = Math.hypot(re, im);
      }
      // Nyquist bin (size/2): fft.js stores its real part at out[size].
      mags[bins - 1] = Math.abs(out[size] ?? out[2 * (bins - 1)] ?? 0);
      return mags;
    },
  };
}

export interface SpectrogramOptions {
  /** FFT window size (power of two recommended). Default 2048. */
  fftSize?: number;
  /** Samples between successive frames. Default `fftSize / 4`. */
  hopSize?: number;
  /** When set, project linear bins onto this many mel bands. */
  mel?: number;
  /** Override the FFT backend (default: `fft.js`). */
  backend?: FFTBackend;
}

/** Precompute a Hann window of length n. */
function hannWindow(n: number): Float32Array {
  const w = new Float32Array(n);
  if (n === 1) {
    w[0] = 1;
    return w;
  }
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
  return w;
}

/** Hz → mel (HTK formula). */
function hzToMel(hz: number): number {
  return 2595 * Math.log10(1 + hz / 700);
}

/** mel → Hz (HTK formula). */
function melToHz(mel: number): number {
  return 700 * (Math.pow(10, mel / 2595) - 1);
}

/**
 * Build a triangular mel filterbank: `melBands` filters spanning [0, Nyquist],
 * each a row of `binsPerFrame` weights. Returns the filterbank and the mel
 * band center frequencies (Hz).
 */
function melFilterbank(
  melBands: number,
  binsPerFrame: number,
  sampleRate: number,
): {filters: Float32Array[]; centers: Float32Array} {
  const nyquist = sampleRate / 2;
  const melMax = hzToMel(nyquist);
  // melBands + 2 edge points equally spaced in mel.
  const points = new Float32Array(melBands + 2);
  for (let i = 0; i < points.length; i++) points[i] = melToHz((i / (melBands + 1)) * melMax);
  const binHz = nyquist / (binsPerFrame - 1);
  const filters: Float32Array[] = [];
  const centers = new Float32Array(melBands);
  for (let m = 1; m <= melBands; m++) {
    const left = points[m - 1];
    const center = points[m];
    const right = points[m + 1];
    centers[m - 1] = center;
    const row = new Float32Array(binsPerFrame);
    for (let b = 0; b < binsPerFrame; b++) {
      const f = b * binHz;
      if (f >= left && f <= center) row[b] = center > left ? (f - left) / (center - left) : 1;
      else if (f > center && f <= right) row[b] = right > center ? (right - f) / (right - center) : 1;
    }
    filters.push(row);
  }
  return {filters, centers};
}

/**
 * Compute the magnitude spectrogram of one channel.
 *
 * ```ts
 * const spec = computeSpectrogram(clip.channelData(0)!, clip.sampleRate, {fftSize: 1024, hopSize: 256});
 * // spec.magnitudes[frame * spec.binsPerFrame + bin]
 * ```
 */
export function computeSpectrogram(
  channel: Float32Array,
  sampleRate: number,
  options: SpectrogramOptions = {},
): SpectrogramData {
  const fftSize = Math.max(2, Math.floor(options.fftSize ?? 2048));
  const hopSize = Math.max(1, Math.floor(options.hopSize ?? fftSize / 4));
  const backend = options.backend ?? createFftJsBackend(fftSize);
  if (backend.size !== fftSize) {
    throw new Error(`FFT backend size ${backend.size} does not match fftSize ${fftSize}`);
  }
  const window = hannWindow(fftSize);
  const linearBins = fftSize / 2 + 1;

  const length = channel.length;
  // Number of frames: slide a full window with `hopSize` steps. At least one
  // frame even for short signals (zero-padded).
  const frameCount = length >= fftSize ? 1 + Math.floor((length - fftSize) / hopSize) : 1;

  const mel = options.mel && options.mel > 0 ? Math.floor(options.mel) : 0;
  const binsPerFrame = mel > 0 ? mel : linearBins;

  const melBank = mel > 0 ? melFilterbank(mel, linearBins, sampleRate) : null;

  const magnitudes = new Float32Array(frameCount * binsPerFrame);
  const times = new Float32Array(frameCount);
  const frame = new Float32Array(fftSize);

  for (let f = 0; f < frameCount; f++) {
    const start = f * hopSize;
    for (let i = 0; i < fftSize; i++) {
      const idx = start + i;
      frame[i] = idx < length ? channel[idx] * window[i] : 0;
    }
    times[f] = (start + fftSize / 2) / sampleRate;
    const spectrum = backend.forward(frame);
    if (melBank) {
      for (let m = 0; m < mel; m++) {
        const row = melBank.filters[m];
        let acc = 0;
        for (let b = 0; b < linearBins; b++) acc += row[b] * spectrum[b];
        magnitudes[f * binsPerFrame + m] = acc;
      }
    } else {
      magnitudes.set(spectrum.subarray(0, linearBins), f * binsPerFrame);
    }
  }

  const frequencies = new Float32Array(binsPerFrame);
  if (melBank) {
    frequencies.set(melBank.centers);
  } else {
    const binHz = sampleRate / fftSize;
    for (let b = 0; b < binsPerFrame; b++) frequencies[b] = b * binHz;
  }

  return {times, frequencies, magnitudes, binsPerFrame};
}
