import {createAudioClip} from '../../src/core';
import {describe, expect, it} from 'vitest';
import {clipToWav} from '../../src/play/api/export';
import {parseWav} from '../../src/play/core/wav';

describe('clipToWav', () => {
  it('serializes a decoded clip to a WAV that parses back to the same samples', () => {
    const left = Float32Array.from({length: 64}, (_, i) => Math.sin(i / 5) * 0.8);
    const right = Float32Array.from({length: 64}, (_, i) => Math.cos(i / 5) * 0.8);
    const clip = createAudioClip({sampleRate: 44100, channelData: [left, right]});

    const wav = clipToWav(clip);
    const decoded = parseWav(wav);
    expect(decoded.sampleRate).toBe(44100);
    expect(decoded.channelData).toHaveLength(2);
    expect(decoded.channelData[0]).toHaveLength(64);
    // 16-bit default → within one LSB.
    for (let i = 0; i < 64; i++) {
      expect(decoded.channelData[0][i]).toBeCloseTo(left[i], 3);
      expect(decoded.channelData[1][i]).toBeCloseTo(right[i], 3);
    }
  });

  it('honours a 32-bit float request bit-exactly', () => {
    const samples = new Float32Array([0, 0.123456, -0.654321, 1, -1]);
    const clip = createAudioClip({sampleRate: 48000, channelData: [samples]});
    const decoded = parseWav(clipToWav(clip, {bitDepth: 32, float: true}));
    expect(Array.from(decoded.channelData[0])).toEqual(Array.from(samples));
  });

  it('throws for a clip with no samples (streaming clip)', () => {
    const streaming = createAudioClip({sampleRate: 44100, length: 0, numberOfChannels: 2, sourceUrl: 'x.mp3'});
    // A zero-length clip still has (empty) channels; force the no-samples branch
    // by constructing a streaming clip without channelData and length 0.
    expect(streaming.hasSamples).toBe(false);
    expect(() => clipToWav(streaming)).toThrow(/no samples/);
  });
});
