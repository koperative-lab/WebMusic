import {beforeEach, describe, expect, it, vi} from 'vitest';
import {createAudioClip} from '../../src/core/model/AudioClip';
import {loadClipFromUrl} from '../../src/play/api/load';
import {loadAudioDocument} from '../../src/edit/element/internal/audio-document-loader';

vi.mock('../../src/play/api/load', () => ({loadClipFromUrl: vi.fn()}));
const load = vi.mocked(loadClipFromUrl);
beforeEach(() => {load.mockReset();});

describe('Audio document decoded loader boundary', () => {
  it('forwards explicit limits and the original signal while forcing decoded loading', async () => {
    const clip = createAudioClip({sampleRate: 8000, channelData: [new Float32Array(8)]});
    load.mockResolvedValue(clip);
    const controller = new AbortController();
    const options = {signal: controller.signal, format: 'wav' as const, maxInputBytes: 1000,
      maxDecodedFrames: 2000, maxDecodedBytes: 8000, maxChannels: 2, timeoutMs: 0};
    expect(await loadAudioDocument('/audio.wav', options)).toBe(clip);
    expect(load).toHaveBeenCalledWith('/audio.wav', {...options, streaming: false});
    expect(load.mock.calls[0][1]!.signal).toBe(controller.signal);
    expect(load.mock.calls[0][1]).not.toHaveProperty('context');
  });
  it('never permits a runtime streaming override and propagates decoder rejection', async () => {
    const failure = new Error('decode limit'); load.mockRejectedValue(failure);
    const options = {signal: new AbortController().signal, streaming: true};
    await expect(loadAudioDocument('/broken.wav', options)).rejects.toBe(failure);
    expect(load.mock.calls[0][1]!.streaming).toBe(false);
  });
});
