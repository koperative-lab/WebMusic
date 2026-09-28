import {createAudioClip} from '../../src/core';
import {describe, expect, it} from 'vitest';
import {summarizeClip} from '../../src/analyze/core/summary';
// Importing the elements entry in Node must not throw (SSR-safe: HTMLElementBase
// + guarded define). The import itself is the test.
import {
  defineAllAudioElements,
  defineAudioLevelAnalyzerElement,
  defineAudioMeterElement,
  defineAudioOscilloscopeElement,
  defineAudioSpectrumAnalyzerElement,
  defineAudioTransientAnalyzerElement,
} from '../../src/analyze/element/index';
import {sine} from './signals';

describe('summarizeClip', () => {
  it('summarizes a decoded clip including integrated loudness', () => {
    const sr = 22050;
    const clip = createAudioClip({
      sampleRate: sr,
      channelData: [sine(440, 1, sr), sine(440, 1, sr)],
      metadata: {title: 'Tone', artist: 'Test'},
    });
    const summary = summarizeClip(clip);
    expect(summary.durationSeconds).toBeCloseTo(1, 3);
    expect(summary.sampleRate).toBe(sr);
    expect(summary.channels).toBe(2);
    expect(summary.title).toBe('Tone');
    expect(summary.artist).toBe('Test');
    expect(typeof summary.integratedLufs).toBe('number');
    expect(Number.isFinite(summary.integratedLufs!)).toBe(true);
  });

  it('omits loudness for a streaming-only clip', () => {
    const clip = createAudioClip({
      sampleRate: 44100,
      numberOfChannels: 2,
      length: 44100,
      sourceUrl: 'https://example.com/song.mp3',
    });
    const summary = summarizeClip(clip);
    expect(summary.integratedLufs).toBeUndefined();
    expect(summary.channels).toBe(2);
  });
});

describe('elements (SSR-safe)', () => {
  it('imports without throwing and exposes define helpers', () => {
    expect(typeof defineAllAudioElements).toBe('function');
    expect(typeof defineAudioLevelAnalyzerElement).toBe('function');
    expect(typeof defineAudioMeterElement).toBe('function');
    expect(typeof defineAudioOscilloscopeElement).toBe('function');
    expect(typeof defineAudioSpectrumAnalyzerElement).toBe('function');
    expect(typeof defineAudioTransientAnalyzerElement).toBe('function');
    // Calling define* in Node (no customElements global) is a guarded no-op.
    expect(() => defineAllAudioElements()).not.toThrow();
    expect(() => defineAudioLevelAnalyzerElement()).not.toThrow();
    expect(() => defineAudioMeterElement()).not.toThrow();
    expect(() => defineAudioOscilloscopeElement()).not.toThrow();
    expect(() => defineAudioSpectrumAnalyzerElement()).not.toThrow();
    expect(() => defineAudioTransientAnalyzerElement()).not.toThrow();
  });
});
