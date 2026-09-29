import {describe, expect, it} from 'vitest';
import {
  peakCount,
  peaksFromWaveformData,
  peaksLevelForResolution,
  peaksToWaveformData,
  readPeak,
  type AudioPeaks,
} from '../../src/core/peaks/AudioPeaks';

function fakePeaks(): AudioPeaks {
  return {
    sampleRate: 44100,
    channels: 1,
    baseSamplesPerPeak: 256,
    levels: [
      {samplesPerPeak: 256, data: new Int8Array([-64, 64, -32, 96])},
      {samplesPerPeak: 512, data: new Int8Array([-64, 96])},
      {samplesPerPeak: 1024, data: new Int8Array([-64, 96])},
    ],
  };
}

describe('AudioPeaks helpers', () => {
  it('readPeak dequantizes to [-1, 1)', () => {
    const peaks = fakePeaks();
    const {min, max} = readPeak(peaks.levels[0], 1, 0, 0);
    expect(min).toBeCloseTo(-0.5);
    expect(max).toBeCloseTo(0.5);
  });

  it('peakCount counts min/max pairs per channel', () => {
    expect(peakCount(fakePeaks().levels[0], 1)).toBe(2);
  });

  it('chooses the coarsest level not finer than the target', () => {
    const peaks = fakePeaks();
    expect(peaksLevelForResolution(peaks, 600).samplesPerPeak).toBe(512);
    expect(peaksLevelForResolution(peaks, 100).samplesPerPeak).toBe(256);
    expect(peaksLevelForResolution(peaks, 5000).samplesPerPeak).toBe(1024);
  });

  it('round-trips BBC waveform-data format', () => {
    const wd = {
      version: 2 as const,
      channels: 1,
      sample_rate: 44100,
      samples_per_pixel: 256,
      bits: 8 as const,
      length: 2,
      data: [-64, 64, -32, 96],
    };
    const peaks = peaksFromWaveformData(wd);
    expect(peaks.levels[0].samplesPerPeak).toBe(256);
    const back = peaksToWaveformData(peaks);
    expect(back.data).toEqual(wd.data);
  });
});
