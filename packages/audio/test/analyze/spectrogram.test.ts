import {describe, expect, it} from 'vitest';
import {computeSpectrogram, createFftJsBackend} from '../../src/analyze/core/spectrogram';
import {sine, silence} from './signals';

describe('computeSpectrogram', () => {
  it('has the expected bin count and frame timing', () => {
    const sr = 16000;
    const fftSize = 1024;
    const hopSize = 256;
    const channel = sine(440, 1, sr); // 16000 samples
    const spec = computeSpectrogram(channel, sr, {fftSize, hopSize});

    // Linear bins = fftSize / 2 + 1.
    expect(spec.binsPerFrame).toBe(fftSize / 2 + 1);
    expect(spec.frequencies.length).toBe(fftSize / 2 + 1);

    // Frame count = 1 + floor((N - fftSize) / hop).
    const expectedFrames = 1 + Math.floor((16000 - fftSize) / hopSize);
    expect(spec.times.length).toBe(expectedFrames);
    expect(spec.magnitudes.length).toBe(expectedFrames * spec.binsPerFrame);

    // Bin center frequencies are evenly spaced by sr/fftSize.
    expect(spec.frequencies[1] - spec.frequencies[0]).toBeCloseTo(sr / fftSize, 4);
  });

  it('peaks at the bin nearest the tone frequency', () => {
    const sr = 16000;
    const fftSize = 2048;
    const freq = 1000;
    const channel = sine(freq, 0.5, sr, 1.0);
    const spec = computeSpectrogram(channel, sr, {fftSize, hopSize: 512});

    // Examine the middle frame; find its strongest bin.
    const frame = Math.floor(spec.times.length / 2);
    let bestBin = 0;
    let bestMag = -1;
    for (let b = 0; b < spec.binsPerFrame; b++) {
      const mag = spec.magnitudes[frame * spec.binsPerFrame + b];
      if (mag > bestMag) {
        bestMag = mag;
        bestBin = b;
      }
    }
    const expectedBin = Math.round(freq / (sr / fftSize));
    expect(Math.abs(bestBin - expectedBin)).toBeLessThanOrEqual(1);
  });

  it('supports a mel projection with the requested band count', () => {
    const sr = 16000;
    const channel = sine(500, 0.3, sr);
    const spec = computeSpectrogram(channel, sr, {fftSize: 1024, hopSize: 256, mel: 40});
    expect(spec.binsPerFrame).toBe(40);
    expect(spec.frequencies.length).toBe(40);
  });

  it('the fft.js backend reports the right size and yields the half-spectrum', () => {
    const backend = createFftJsBackend(512);
    expect(backend.size).toBe(512);
    const frame = sine(1000, 512 / 16000, 16000);
    const mags = backend.forward(frame.subarray(0, 512));
    expect(mags.length).toBe(512 / 2 + 1);
    for (const m of mags) expect(Number.isFinite(m)).toBe(true);
  });

  it('returns near-zero magnitudes for silence', () => {
    const spec = computeSpectrogram(silence(0.2, 16000), 16000, {fftSize: 512, hopSize: 256});
    let total = 0;
    for (const m of spec.magnitudes) total += m;
    expect(total).toBeCloseTo(0, 4);
  });
});
