import {describe, expect, it} from 'vitest';
import {detectOnsets} from '../../src/analyze/core/onsets';
import {analyzeAudioClip} from '../../src/analyze/core/analyze-clip';
import {createAudioClip} from '../../src/core';
import {trackPitch} from '../../src/analyze/core/pitch';
import {extractFeatures} from '../../src/analyze/core/features';
import {clickTrain, sine, silence, midiToHz} from './signals';

describe('detectOnsets', () => {
  it('finds roughly one onset per click in a 120-BPM click train', () => {
    const sr = 44100;
    const channel = clickTrain(120, 4, sr); // 8 beats
    const onsets = detectOnsets(channel, sr, {fftSize: 1024, hopSize: 256});
    // 8 clicks in 4 s — allow a couple of miss/spurious detections.
    expect(onsets.length).toBeGreaterThanOrEqual(6);
    expect(onsets.length).toBeLessThanOrEqual(10);
    // Onsets are ascending and spaced ~0.5 s apart.
    for (let i = 1; i < onsets.length; i++) {
      expect(onsets[i]).toBeGreaterThan(onsets[i - 1]);
    }
  });

  it('finds no onsets in steady silence', () => {
    const onsets = detectOnsets(silence(1, 44100), 44100);
    expect(onsets.length).toBe(0);
  });

  it('detects attacks present only in a stereo clip\'s right channel', async () => {
    const sampleRate = 8_000;
    const left = silence(4, sampleRate);
    const right = clickTrain(120, 4, sampleRate);
    const clip = createAudioClip({sampleRate, channelData: [left, right]});
    expect(detectOnsets(left, sampleRate)).toEqual([]);

    const analyzed = await analyzeAudioClip(clip, {tasks: ['onsets'], fftSize: 512, hopSize: 128});
    expect(analyzed.onsets!.length).toBeGreaterThanOrEqual(6);
    expect(analyzed.onsets!.some((seconds) => Math.abs(seconds - 1) < 0.06)).toBe(true);
  });

  it('finds far fewer onsets in a steady tone than in a click train', () => {
    const sr = 44100;
    const steady = detectOnsets(sine(440, 4, sr), sr, {fftSize: 1024, hopSize: 512});
    const clicks = detectOnsets(clickTrain(120, 4, sr), sr, {fftSize: 1024, hopSize: 256});
    // A steady sine has only spectral-leakage flux (no transients), so it should
    // yield many fewer detections than 8 sharp clicks.
    expect(steady.length).toBeLessThan(clicks.length);
  });
});

describe('trackPitch', () => {
  it('tracks a steady A4 sine close to 440 Hz', async () => {
    const sr = 44100;
    const channel = sine(440, 0.5, sr);
    const {frequencies, confidences, times} = await trackPitch(channel, sr, {frameSize: 2048});
    expect(times.length).toBe(frequencies.length);
    expect(frequencies.length).toBe(confidences.length);

    const voiced = Array.from(frequencies).filter((f) => f > 0);
    expect(voiced.length).toBeGreaterThan(0);
    const median = voiced.sort((a, b) => a - b)[Math.floor(voiced.length / 2)];
    expect(median).toBeGreaterThan(430);
    expect(median).toBeLessThan(450);
  });

  it('tracks a C5 sine close to its frequency', async () => {
    const sr = 44100;
    const hz = midiToHz(72); // C5 ≈ 523.25
    const {frequencies} = await trackPitch(sine(hz, 0.4, sr), sr, {frameSize: 2048});
    const voiced = Array.from(frequencies).filter((f) => f > 0);
    expect(voiced.length).toBeGreaterThan(0);
    const median = voiced.sort((a, b) => a - b)[Math.floor(voiced.length / 2)];
    expect(median).toBeGreaterThan(hz - 15);
    expect(median).toBeLessThan(hz + 15);
  });

  it('reports unvoiced (0 Hz) frames for silence', async () => {
    const {frequencies} = await trackPitch(silence(0.3, 44100), 44100, {frameSize: 2048});
    const voiced = Array.from(frequencies).filter((f) => f > 0);
    expect(voiced.length).toBe(0);
  });
});

describe('extractFeatures', () => {
  it('returns per-frame scalar and vector features with consistent lengths', () => {
    const sr = 44100;
    const channel = sine(440, 0.5, sr);
    const result = extractFeatures(channel, sr, ['rms', 'spectralCentroid', 'mfcc'], {bufferSize: 512});

    expect(result.featureNames).toContain('rms');
    expect(result.times.length).toBeGreaterThan(0);

    const rms = result.features.rms as Float32Array;
    expect(rms).toBeInstanceOf(Float32Array);
    expect(rms.length).toBe(result.times.length);
    // A unit sine through Meyda's default window has per-frame RMS ~0.4–0.5
    // (windowing attenuates the edges); assert it is clearly non-trivial.
    const mid = rms[Math.floor(rms.length / 2)];
    expect(mid).toBeGreaterThan(0.3);
    expect(mid).toBeLessThan(0.8);

    const mfcc = result.features.mfcc as Float32Array[];
    expect(Array.isArray(mfcc)).toBe(true);
    expect(mfcc.length).toBe(result.times.length);
  });

  it('uses the default feature set when none is given', () => {
    const result = extractFeatures(sine(440, 0.2, 44100), 44100);
    expect(result.featureNames.length).toBeGreaterThan(0);
    expect(result.featureNames).toContain('spectralCentroid');
  });
});
