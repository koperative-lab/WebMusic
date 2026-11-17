// ============================================================================
// Spectral processing for processors (DEC-077), as Max's pfft~ provides: a
// radix-2 FFT, analysis windows and an overlap-add frame driver. Everything is
// allocated when created, so `process` never allocates on the audio thread.
// ============================================================================

/** An in-place complex FFT of a fixed power-of-two size. */
export interface FFT {
  readonly size: number;
  /** Transform `real` and `imag` in place, time to frequency. */
  forward(real: Float32Array, imag: Float32Array): void;
  /** Transform in place, frequency to time, scaled by 1/size. */
  inverse(real: Float32Array, imag: Float32Array): void;
}

/** Create an FFT of `size` (a power of two from 2 to 65536). */
export function createFFT(size: number): FFT {
  if (!Number.isInteger(size) || size < 2 || size > 65536 || (size & (size - 1)) !== 0) throw new RangeError('FFT size must be a power of two from 2 to 65536.');
  const levels = Math.log2(size);
  const reverse = new Uint32Array(size);
  for (let index = 0; index < size; index++) {
    let reversed = 0;
    for (let bit = 0; bit < levels; bit++) reversed |= ((index >> bit) & 1) << (levels - 1 - bit);
    reverse[index] = reversed;
  }
  const cos = new Float32Array(size / 2), sin = new Float32Array(size / 2);
  for (let index = 0; index < size / 2; index++) { cos[index] = Math.cos((2 * Math.PI * index) / size); sin[index] = Math.sin((2 * Math.PI * index) / size); }
  const transform = (real: Float32Array, imag: Float32Array, direction: 1 | -1) => {
    if (real.length !== size || imag.length !== size) throw new RangeError(`FFT buffers must have ${size} samples.`);
    for (let index = 0; index < size; index++) {
      const other = reverse[index]!;
      if (other > index) {
        let swap = real[index]!; real[index] = real[other]!; real[other] = swap;
        swap = imag[index]!; imag[index] = imag[other]!; imag[other] = swap;
      }
    }
    for (let half = 1; half < size; half <<= 1) {
      const step = size / (half * 2);
      for (let start = 0; start < size; start += half * 2) {
        for (let index = 0; index < half; index++) {
          const twiddle = index * step;
          const wr = cos[twiddle]!, wi = -direction * sin[twiddle]!;
          const a = start + index, b = a + half;
          const tr = wr * real[b]! - wi * imag[b]!, ti = wr * imag[b]! + wi * real[b]!;
          real[b] = real[a]! - tr; imag[b] = imag[a]! - ti;
          real[a] = real[a]! + tr; imag[a] = imag[a]! + ti;
        }
      }
    }
  };
  return Object.freeze({
    size,
    forward: (real: Float32Array, imag: Float32Array) => transform(real, imag, 1),
    inverse: (real: Float32Array, imag: Float32Array) => {
      transform(real, imag, -1);
      for (let index = 0; index < size; index++) { real[index]! /= size; imag[index]! /= size; }
    },
  });
}

/** A periodic Hann window of `size` samples, suited to overlap-add at hop size/2 or size/4. */
export function hannWindow(size: number): Float32Array {
  const window = new Float32Array(size);
  for (let index = 0; index < size; index++) window[index] = 0.5 - 0.5 * Math.cos((2 * Math.PI * index) / size);
  return window;
}

export interface SpectralFrameOptions {
  /** FFT size, a power of two. */
  readonly size: number;
  /** Samples between frames: size/2 or size/4 (the default). */
  readonly hop?: number;
}

/**
 * Overlap-add spectral processing for one channel: feed blocks of any length;
 * every `hop` samples a Hann-windowed frame is transformed, handed to
 * `onFrame(real, imag)` to change in place, transformed back, windowed again
 * and added to the output. The output lags the input by `size` samples.
 */
export interface SpectralFrame {
  readonly size: number;
  readonly hop: number;
  /** The output's delay behind the input, in samples. */
  readonly latency: number;
  process(input: Float32Array, output: Float32Array, onFrame: (real: Float32Array, imag: Float32Array) => void): void;
  reset(): void;
}

export function createSpectralFrame(options: SpectralFrameOptions): SpectralFrame {
  const {size} = options;
  const hop = options.hop ?? size / 4;
  if (!Number.isInteger(hop) || hop < 1 || size % hop !== 0 || hop > size / 2) throw new RangeError('Hop must divide the size and be at most half of it.');
  const fft = createFFT(size);
  const window = hannWindow(size);
  // Windowed analysis and synthesis sum to this constant for a Hann window.
  const gain = hop / (size * 0.375);
  // `input` holds the last `size` samples; `accum` sums the windowed frames;
  // `pending` is the completed hop the output plays until the next frame.
  const input = new Float32Array(size), accum = new Float32Array(size), pending = new Float32Array(hop);
  const real = new Float32Array(size), imag = new Float32Array(size);
  let filled = size - hop, read = 0;
  const frame = (onFrame: (real: Float32Array, imag: Float32Array) => void) => {
    for (let index = 0; index < size; index++) { real[index] = input[index]! * window[index]!; imag[index] = 0; }
    fft.forward(real, imag);
    onFrame(real, imag);
    fft.inverse(real, imag);
    for (let index = 0; index < size; index++) accum[index]! += real[index]! * window[index]! * gain;
    pending.set(accum.subarray(0, hop));
    accum.copyWithin(0, hop);
    accum.fill(0, size - hop);
    input.copyWithin(0, hop);
    filled = size - hop;
    read = 0;
  };
  return {
    size, hop, latency: size,
    process(block, out, onFrame) {
      for (let index = 0; index < block.length; index++) {
        input[filled++] = block[index]!;
        out[index] = pending[read++]!;
        if (filled === size) frame(onFrame);
      }
    },
    reset() { input.fill(0); accum.fill(0); pending.fill(0); filled = size - hop; read = 0; },
  };
}
