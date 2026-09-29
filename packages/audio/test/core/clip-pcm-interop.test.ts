import {afterEach, describe, expect, it, vi} from 'vitest';

afterEach(() => { vi.resetModules(); });

describe('internal PCM copy across independently bundled module entries', () => {
  it('copies bounded forward/reverse frames from an independently constructed sliced clip', async () => {
    const origin = await import('../../src/core/model/AudioClip');
    const samples = Float32Array.from([0, 1, 2, 3, 4, 5, 6, 7]);
    const clip = origin.createAudioClip({sampleRate: 4, channelData: [samples]}).slice(0.5, 1.75);
    vi.resetModules();
    const consumer = await import('../../src/core/model/AudioClip');
    expect(consumer.AudioClip).not.toBe(origin.AudioClip);
    const forward = new Float32Array(3);
    consumer.copyClipPcmRange(clip, 0, 1, forward);
    expect([...forward]).toEqual([3, 4, 5]);
    const reverse = new Float32Array(3);
    consumer.copyClipPcmRange(clip, 0, 1, reverse, true);
    expect([...reverse]).toEqual([5, 4, 3]);
    reverse.fill(-1);
    expect([...clip.channelData(0)!]).toEqual([2, 3, 4, 5, 6]);
    expect([...samples]).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it('rejects unavailable channels and out-of-range frames before changing the destination', async () => {
    const origin = await import('../../src/core/model/AudioClip');
    const clip = origin.createAudioClip({sampleRate: 4, channelData: [Float32Array.from([1, 2, 3])]});
    vi.resetModules();
    const consumer = await import('../../src/core/model/AudioClip');
    const output = Float32Array.from([9, 9]);
    expect(() => consumer.copyClipPcmRange(clip, 0, 2, output)).toThrow('within the clip');
    expect(() => consumer.copyClipPcmRange(clip, 0, -1, output)).toThrow('within the clip');
    expect(() => consumer.copyClipPcmRange(clip, 1, 0, output)).toThrow('unavailable');
    expect([...output]).toEqual([9, 9]);
  });
});
