// ============================================================================
// ITU-R BS.1770 K-weighting — the two biquads every loudness reading starts
// from, plus the arithmetic that evaluates them on a signal or on a frequency
// grid.
//
// This is pure numeric DSP with no analysis policy: gating, windows and
// channel summation remain with the offline analyzer and the live meter that
// consume it. Both families of loudness reading need exactly these
// coefficients, so they live once, in the domain root, rather than being
// re-derived in each capability.
// ============================================================================

/** Biquad coefficients (Direct Form I), normalized so a0 = 1. */
export interface Biquad {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

/**
 * BS.1770 stage-1 "pre-filter" (high-frequency shelving boost, ~+4 dB) and
 * stage-2 high-pass (RLB), re-derived for an arbitrary sample rate from the
 * analog prototypes the spec defines at 48 kHz. At 48 kHz these reduce to the
 * exact tabulated coefficients.
 */
export function kWeightingFilters(sampleRate: number): [Biquad, Biquad] {
  // --- Stage 1: high-shelf "head"/pre filter ---
  const f0 = 1681.974450955533;
  const G = 3.999843853973347; // dB
  const Q = 0.7071752369554196;
  const K = Math.tan((Math.PI * f0) / sampleRate);
  const Vh = Math.pow(10, G / 20);
  const Vb = Math.pow(Vh, 0.4996667741545416);
  const a0 = 1 + K / Q + K * K;
  const stage1: Biquad = {
    b0: (Vh + (Vb * K) / Q + K * K) / a0,
    b1: (2 * (K * K - Vh)) / a0,
    b2: (Vh - (Vb * K) / Q + K * K) / a0,
    a1: (2 * (K * K - 1)) / a0,
    a2: (1 - K / Q + K * K) / a0,
  };

  // --- Stage 2: high-pass (RLB) ---
  const f0b = 38.13547087602444;
  const Qb = 0.5003270373238773;
  const Kb = Math.tan((Math.PI * f0b) / sampleRate);
  const a0b = 1 + Kb / Qb + Kb * Kb;
  const stage2: Biquad = {
    b0: 1,
    b1: -2,
    b2: 1,
    a1: (2 * (Kb * Kb - 1)) / a0b,
    a2: (1 - Kb / Qb + Kb * Kb) / a0b,
  };

  return [stage1, stage2];
}

/** Apply a biquad (Direct Form I) to a signal, returning a new array. */
export function applyBiquad(input: Float32Array, q: Biquad): Float32Array {
  const out = new Float32Array(input.length);
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < input.length; i++) {
    const x0 = input[i]!;
    const y0 = q.b0 * x0 + q.b1 * x1 + q.b2 * x2 - q.a1 * y1 - q.a2 * y2;
    out[i] = y0;
    x2 = x1;
    x1 = x0;
    y2 = y1;
    y1 = y0;
  }
  return out;
}

/**
 * Power response |H(e^{jω})|² of one biquad at a normalized angular frequency
 * ω = 2π·f/sampleRate. Used to weight a magnitude spectrum instead of
 * filtering samples, which is what a live meter reading overlapping analyser
 * windows needs: a frequency-domain weight has no filter-state transient at
 * the start of every window.
 */
export function biquadPowerResponse(q: Biquad, omega: number): number {
  const cos1 = Math.cos(omega);
  const sin1 = Math.sin(omega);
  const cos2 = Math.cos(2 * omega);
  const sin2 = Math.sin(2 * omega);
  const numeratorReal = q.b0 + q.b1 * cos1 + q.b2 * cos2;
  const numeratorImaginary = -(q.b1 * sin1 + q.b2 * sin2);
  const denominatorReal = 1 + q.a1 * cos1 + q.a2 * cos2;
  const denominatorImaginary = -(q.a1 * sin1 + q.a2 * sin2);
  const numerator = numeratorReal * numeratorReal + numeratorImaginary * numeratorImaginary;
  const denominator = denominatorReal * denominatorReal + denominatorImaginary * denominatorImaginary;
  return denominator > 0 ? numerator / denominator : 0;
}

/**
 * K-weighting power weights for the bins of a real FFT: index `k` of the
 * result is |H_K|² at `k · sampleRate / (2 · binCount)`, so weighting a power
 * spectrum by it reproduces the two-stage filter's effect on signal energy.
 */
export function kWeightingBinWeights(binCount: number, sampleRate: number): Float32Array {
  const bins = Math.max(0, Math.floor(binCount));
  const weights = new Float32Array(bins);
  if (bins === 0 || !Number.isFinite(sampleRate) || sampleRate <= 0) return weights;
  const [shelf, highPass] = kWeightingFilters(sampleRate);
  for (let k = 0; k < bins; k += 1) {
    const omega = (Math.PI * k) / bins;
    weights[k] = biquadPowerResponse(shelf, omega) * biquadPowerResponse(highPass, omega);
  }
  return weights;
}
