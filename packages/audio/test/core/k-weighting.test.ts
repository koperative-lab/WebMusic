import {describe, expect, it} from 'vitest';
import {
  applyBiquad,
  biquadPowerResponse,
  kWeightingBinWeights,
  kWeightingFilters,
} from '../../src/core';

function sine(hz: number, seconds: number, sampleRate: number, amplitude = 1): Float32Array {
  const out = new Float32Array(Math.round(seconds * sampleRate));
  for (let index = 0; index < out.length; index += 1) {
    out[index] = amplitude * Math.sin((2 * Math.PI * hz * index) / sampleRate);
  }
  return out;
}

function meanSquare(samples: Float32Array, from = 0): number {
  let sum = 0;
  for (let index = from; index < samples.length; index += 1) sum += samples[index]! * samples[index]!;
  return sum / Math.max(1, samples.length - from);
}

describe('K-weighting', () => {
  it('reduces to the BS.1770 tabulated coefficients at 48 kHz', () => {
    const [shelf, highPass] = kWeightingFilters(48_000);
    expect(shelf.b0).toBeCloseTo(1.53512485958697, 6);
    expect(shelf.b1).toBeCloseTo(-2.69169618940638, 6);
    expect(shelf.b2).toBeCloseTo(1.19839281085285, 6);
    expect(shelf.a1).toBeCloseTo(-1.69065929318241, 6);
    expect(shelf.a2).toBeCloseTo(0.73248077421585, 6);
    expect(highPass.b0).toBe(1);
    expect(highPass.b1).toBe(-2);
    expect(highPass.b2).toBe(1);
    expect(highPass.a1).toBeCloseTo(-1.99004745483398, 6);
    expect(highPass.a2).toBeCloseTo(0.99007225036621, 6);
  });

  it('has the spectral shape the loudness offset assumes', () => {
    const sampleRate = 48_000;
    const [shelf, highPass] = kWeightingFilters(sampleRate);
    const power = (hz: number): number => {
      const omega = (2 * Math.PI * hz) / sampleRate;
      return biquadPowerResponse(shelf, omega) * biquadPowerResponse(highPass, omega);
    };
    // The -0.691 LUFS offset compensates a +0.691 dB gain at 1 kHz.
    expect(10 * Math.log10(power(1_000))).toBeCloseTo(0.691, 1);
    // Roughly +4 dB in the treble, well attenuated below the high-pass corner.
    expect(10 * Math.log10(power(10_000))).toBeGreaterThan(3.5);
    expect(10 * Math.log10(power(10_000))).toBeLessThan(4.5);
    expect(power(20)).toBeLessThan(0.5);
    expect(power(0)).toBe(0);
  });

  it('weights FFT bins the way filtering the samples would', () => {
    const sampleRate = 48_000;
    const [shelf, highPass] = kWeightingFilters(sampleRate);
    for (const hz of [100, 1_000, 8_000]) {
      const signal = sine(hz, 2, sampleRate, 0.5);
      const filtered = applyBiquad(applyBiquad(signal, shelf), highPass);
      // Skip the first second so the IIR transient has settled.
      const ratio = meanSquare(filtered, sampleRate) / meanSquare(signal, sampleRate);
      const omega = (2 * Math.PI * hz) / sampleRate;
      expect(ratio).toBeCloseTo(biquadPowerResponse(shelf, omega) * biquadPowerResponse(highPass, omega), 2);
    }
    const weights = kWeightingBinWeights(1_024, sampleRate);
    expect(weights).toHaveLength(1_024);
    expect(weights[0]).toBe(0);
    const bin = (hz: number): number => Math.round((hz / (sampleRate / 2)) * 1_024);
    expect(weights[bin(1_000)]).toBeCloseTo(Math.pow(10, 0.0691), 1);
    expect(weights[bin(10_000)]).toBeGreaterThan(weights[bin(1_000)]!);
    expect(kWeightingBinWeights(0, sampleRate)).toHaveLength(0);
    expect(kWeightingBinWeights(4, 0).every((weight) => weight === 0)).toBe(true);
  });
});
