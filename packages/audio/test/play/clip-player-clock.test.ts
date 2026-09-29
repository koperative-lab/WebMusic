import {describe, expect, it, vi} from 'vitest';
import {createAudioClip} from '../../src/core';
import {AudioClipPlayer} from '../../src/play/headless/player';

/** Fake context with the full buffer-path surface (graph + buffer source). */
function fakeContext() {
  const node = () => ({connect: vi.fn(), disconnect: vi.fn()});
  const ctx: any = {
    state: 'running',
    currentTime: 0,
    destination: node(),
    resume: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
    createGain: () => ({...node(), gain: {value: 1}}),
    createStereoPanner: () => ({...node(), pan: {value: 0}}),
    createAnalyser: () => ({...node(), fftSize: 0, smoothingTimeConstant: 0}),
    createBuffer: (channels: number, length: number, sampleRate: number) => ({
      numberOfChannels: channels,
      length,
      sampleRate,
      duration: length / sampleRate,
      getChannelData: () => new Float32Array(length),
    }),
    createBufferSource: () => ({
      buffer: null,
      playbackRate: {value: 1},
      loop: false,
      loopStart: 0,
      loopEnd: 0,
      onended: null,
      connect: vi.fn(),
      disconnect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
    }),
  };
  return ctx as AudioContext;
}

describe('AudioClipPlayer clock exposure', () => {
  it('surfaces the buffer engine transport clock once the engine exists', async () => {
    const ctx = fakeContext();
    const clip = createAudioClip({sampleRate: 1_000, channelData: [new Float32Array(2_000)]});
    const player = new AudioClipPlayer(clip, {audioContext: ctx});

    // No engine before the first play: the clock is not reachable yet.
    expect(player.clock).toBeUndefined();

    await player.play();
    const clock = player.clock;
    expect(clock).toBeDefined();
    expect(clock!.paused).toBe(false);
    // The reader is the engine's own position axis: it agrees with the
    // player's reported seconds at any reference time.
    (ctx as any).currentTime = 1.5;
    expect(clock!.positionAt(1.5)).toBeCloseTo(player.seconds, 9);

    player.pause();
    expect(player.clock!.paused).toBe(true);
    player.dispose();
  });
});
