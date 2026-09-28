import {afterEach, describe, expect, it, vi} from 'vitest';
import {BeatGrid, createAudioClip, createRegion} from '../../src/core';
import {AudioClipPlayer} from '../../src/play/headless/player';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((res) => {
    resolve = res;
  });
  return {promise, resolve};
}

function fakeContext(state: AudioContextState = 'running') {
  const resume = deferred();
  const counts = {gain: 0, panner: 0, analyser: 0};
  const node = () => ({connect: vi.fn(), disconnect: vi.fn()});
  const destination = node();
  const context = {
    state,
    currentTime: 0,
    destination,
    resume: vi.fn(() => resume.promise),
    close: vi.fn(async () => {}),
    createGain: vi.fn(() => {
      counts.gain++;
      return {...node(), gain: {value: 1}};
    }),
    createStereoPanner: vi.fn(() => {
      counts.panner++;
      return {...node(), pan: {value: 0}};
    }),
    createAnalyser: vi.fn(() => {
      counts.analyser++;
      return {...node(), fftSize: 0, smoothingTimeConstant: 0};
    }),
    createMediaElementSource: vi.fn(() => node()),
    createBufferSource: vi.fn(() => ({
      ...node(),
      buffer: null,
      playbackRate: {value: 1},
      loop: false,
      loopStart: 0,
      loopEnd: 0,
      onended: null,
      start: vi.fn(),
      stop: vi.fn(),
    })),
    // preload() now warms the engine as well as the graph, so the buffer
    // engine reaches AudioClip.toAudioBuffer — a real context always has this.
    createBuffer: vi.fn((numberOfChannels: number, length: number, sampleRate: number) => ({
      numberOfChannels,
      length,
      sampleRate,
      duration: length / sampleRate,
      getChannelData: () => new Float32Array(length),
    })),
  } as unknown as AudioContext;
  return {context, resume, counts};
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('AudioClipPlayer terminal disposal', () => {
  it('does not start after stop invalidates a pending context resume', async () => {
    const {context, resume, counts} = fakeContext('suspended');
    const clip = createAudioClip({
      sampleRate: 8_000,
      channelData: [new Float32Array(8)],
    });
    const player = new AudioClipPlayer(clip, {audioContext: context});

    const play = player.play();
    player.stop();
    resume.resolve();
    await play;

    expect(counts).toEqual({gain: 0, panner: 0, analyser: 0});
    expect(player.playing).toBe(false);
    player.dispose();
  });

  it('does not build a graph when a suspended-context resume finishes after dispose', async () => {
    const {context, resume, counts} = fakeContext('suspended');
    const clip = createAudioClip({sampleRate: 8_000, channelData: [new Float32Array(8)]});
    const player = new AudioClipPlayer(clip, {audioContext: context});

    const play = player.play();
    expect(context.resume).toHaveBeenCalledTimes(1);
    player.dispose();
    resume.resolve();
    await play;

    expect(counts).toEqual({gain: 0, panner: 0, analyser: 0});
    player.seek(0.5);
    await player.preload();
    expect(counts).toEqual({gain: 0, panner: 0, analyser: 0});
    expect(() => player.analyser).toThrow(/disposed/);
  });

  it('does not start polling when injected media playback resolves after dispose', async () => {
    const {context} = fakeContext();
    const mediaPlay = deferred();
    const pause = vi.fn();
    const adapter = {
      paused: false,
      ended: false,
      duration: 10,
      currentTime: 0,
      playbackRate: 1,
      preservesPitch: true,
      loop: false,
      onended: null as (() => void) | null,
      play: vi.fn(() => mediaPlay.promise),
      pause,
      connect: vi.fn(),
      disconnect: vi.fn(),
    };

    const clip = createAudioClip({
      sampleRate: 44_100,
      length: 0,
      numberOfChannels: 2,
      sourceUrl: 'https://example.test/audio.mp3',
    });
    const player = new AudioClipPlayer(clip, {
      audioContext: context,
      engine: 'media',
      mediaAdapterFactory: () => adapter,
    });

    const play = player.play();
    await Promise.resolve();
    player.dispose();
    mediaPlay.resolve();
    await play;

    expect(pause).toHaveBeenCalled();
    expect(player.playing).toBe(false);
  });

  it('does not restart polling when pause wins a pending media play race', async () => {
    vi.useFakeTimers();
    const {context} = fakeContext();
    const mediaPlay = deferred();
    const adapter = {
      paused: false,
      ended: false,
      duration: 10,
      currentTime: 0,
      playbackRate: 1,
      preservesPitch: true,
      loop: false,
      onended: null as (() => void) | null,
      play: vi.fn(() => mediaPlay.promise),
      pause: vi.fn(),
      connect: vi.fn(),
      disconnect: vi.fn(),
    };
    const clip = createAudioClip({
      sampleRate: 44_100,
      length: 0,
      numberOfChannels: 2,
      sourceUrl: 'https://example.test/audio.mp3',
    });
    const player = new AudioClipPlayer(clip, {
      audioContext: context,
      engine: 'media',
      mediaAdapterFactory: () => adapter,
    });
    const timeupdate = vi.fn();
    player.on('timeupdate', timeupdate);

    const play = player.play();
    await Promise.resolve();
    player.pause();
    mediaPlay.resolve();
    await play;
    await vi.advanceTimersByTimeAsync(200);

    expect(timeupdate).not.toHaveBeenCalled();
    player.dispose();
    vi.useRealTimers();
  });

  it('emits media playback failures through the error event before rejecting', async () => {
    const {context} = fakeContext();
    const failure = new Error('autoplay denied');
    const adapter = {
      paused: true,
      ended: false,
      duration: 10,
      currentTime: 0,
      playbackRate: 1,
      preservesPitch: true,
      loop: false,
      onended: null as (() => void) | null,
      play: vi.fn(async () => {
        throw failure;
      }),
      pause: vi.fn(),
      connect: vi.fn(),
      disconnect: vi.fn(),
    };
    const clip = createAudioClip({
      sampleRate: 44_100,
      length: 0,
      numberOfChannels: 2,
      sourceUrl: 'https://example.test/audio.mp3',
    });
    const player = new AudioClipPlayer(clip, {
      audioContext: context,
      engine: 'media',
      mediaAdapterFactory: () => adapter,
    });
    const onError = vi.fn();
    player.on('error', onError);

    await expect(player.play()).rejects.toBe(failure);
    expect(onError).toHaveBeenCalledWith(failure);
    player.dispose();
  });

  it('finishes graph cleanup when an effect disposer throws', async () => {
    const {context} = fakeContext();
    const failure = new Error('effect cleanup failed');
    const effectNode = {connect: vi.fn(), disconnect: vi.fn()};
    const clip = createAudioClip({
      sampleRate: 8_000,
      channelData: [new Float32Array(8)],
    });
    const player = new AudioClipPlayer(clip, {
      audioContext: context,
      effect: {
        createAudioNodes: () => ({
          input: effectNode as unknown as AudioNode,
          output: effectNode as unknown as AudioNode,
          dispose: () => {
            throw failure;
          },
        }),
      },
    });
    await player.preload();
    const nodes = [
      vi.mocked(context.createGain).mock.results[0]!.value,
      vi.mocked(context.createStereoPanner).mock.results[0]!.value,
      vi.mocked(context.createAnalyser).mock.results[0]!.value,
    ];

    expect(() => player.dispose()).toThrow(failure);
    for (const node of nodes) expect(node.disconnect).toHaveBeenCalled();
    expect(() => player.analyser).toThrow(/disposed/);
  });

  it('releases a failed graph even when effect cleanup also throws', async () => {
    const {context} = fakeContext();
    const failure = new Error('destination unavailable');
    const effectDispose = vi.fn(() => {
      throw new Error('effect cleanup failed');
    });
    const clip = createAudioClip({sampleRate: 8_000, channelData: [new Float32Array(8)]});
    const player = new AudioClipPlayer(clip, {
      audioContext: context,
      effect: {
        createAudioNodes: () => ({
          input: {connect: vi.fn(), disconnect: vi.fn()} as unknown as AudioNode,
          output: {connect: vi.fn(), disconnect: vi.fn()} as unknown as AudioNode,
          dispose: effectDispose,
        }),
      },
    });
    const originalCreateAnalyser = vi.mocked(context.createAnalyser).getMockImplementation()!;
    vi.spyOn(context, 'createAnalyser').mockImplementation(() => {
      const node = originalCreateAnalyser.call(context);
      vi.spyOn(node, 'connect').mockImplementation(() => {
        throw failure;
      });
      return node;
    });

    await expect(player.preload()).rejects.toBe(failure);
    expect(effectDispose).toHaveBeenCalledOnce();
    expect(vi.mocked(context.createGain).mock.results[0]!.value.disconnect).toHaveBeenCalled();
    expect(vi.mocked(context.createStereoPanner).mock.results[0]!.value.disconnect).toHaveBeenCalled();
    expect(vi.mocked(context.createAnalyser).mock.results[0]!.value.disconnect).toHaveBeenCalled();
    player.dispose();
  });

  it('releases graph nodes when a later node constructor fails', async () => {
    const {context} = fakeContext();
    const failure = new Error('analyser unavailable');
    vi.mocked(context.createAnalyser).mockImplementation(() => {
      throw failure;
    });
    const clip = createAudioClip({sampleRate: 8_000, channelData: [new Float32Array(8)]});
    const player = new AudioClipPlayer(clip, {audioContext: context});

    await expect(player.preload()).rejects.toBe(failure);
    expect(vi.mocked(context.createGain).mock.results[0]!.value.disconnect).toHaveBeenCalled();
    expect(vi.mocked(context.createStereoPanner).mock.results[0]!.value.disconnect).toHaveBeenCalled();
    player.dispose();
  });

  it('requires an explicit host adapter for streaming playback', async () => {
    const {context} = fakeContext();
    const clip = createAudioClip({
      sampleRate: 44_100,
      length: 0,
      numberOfChannels: 2,
      sourceUrl: 'https://example.test/audio.mp3',
    });
    const player = new AudioClipPlayer(clip, {audioContext: context, engine: 'media'});
    await expect(player.play()).rejects.toThrow(/mediaAdapterFactory/);
    player.dispose();
  });

  it('cleans graph nodes idempotently on repeated dispose', async () => {
    const {context} = fakeContext();
    const clip = createAudioClip({sampleRate: 8_000, channelData: [new Float32Array(8)]});
    const player = new AudioClipPlayer(clip, {audioContext: context});
    await player.preload();
    const nodes = [
      vi.mocked(context.createGain).mock.results[0]!.value,
      vi.mocked(context.createStereoPanner).mock.results[0]!.value,
      vi.mocked(context.createAnalyser).mock.results[0]!.value,
    ];

    player.dispose();
    player.dispose();
    for (const node of nodes) expect(node.disconnect).toHaveBeenCalled();
  });
});


function annotatedClip() {
  return createAudioClip({
    sampleRate: 1_000,
    channelData: [new Float32Array(4_000)],
    regions: [
      createRegion({label: 'near', startSeconds: 0.5, endSeconds: 1}),
      createRegion({label: 'far', startSeconds: 2.5, endSeconds: 3}),
    ],
    beatGrid: BeatGrid.fromTempo(60, 4),
  });
}

describe('AudioClipPlayer command and observation reentrancy', () => {
  it.each(['pause', 'stop', 'dispose'] as const)(
    'honors %s invoked by the graph load listener before starting a source',
    async (command) => {
      vi.useFakeTimers();
      const {context} = fakeContext();
      const player = new AudioClipPlayer(annotatedClip(), {audioContext: context});
      player.on('load', () => player[command]());

      await player.play();

      expect(player.playing).toBe(false);
      expect(context.createBufferSource).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
      player.dispose();
    },
  );

  it('allows a load listener to relocate a pending play without cancelling its intent', async () => {
    const {context} = fakeContext();
    const player = new AudioClipPlayer(annotatedClip(), {audioContext: context});
    player.once('load', () => player.seek(0.75));

    await player.play(3);

    const source = vi.mocked(context.createBufferSource).mock.results[0]!.value;
    expect(source.start).toHaveBeenCalledWith(3, 0.75);
    expect(player.playing).toBe(true);
    player.dispose();
  });

  it('keeps a newer load-listener seek instead of applying the interrupted outer seek', () => {
    const {context} = fakeContext();
    const player = new AudioClipPlayer(annotatedClip(), {audioContext: context});
    const updates = vi.fn();
    player.on('timeupdate', updates);
    player.once('load', () => player.seek(2.75));

    player.seek(0.75);

    expect(player.seconds).toBe(2.75);
    expect(updates).toHaveBeenCalledOnce();
    expect(updates.mock.calls[0]![0].seconds).toBe(2.75);
    player.dispose();
  });

  it('reports regions at the actual wrapped position, including a paused seek', () => {
    const {context} = fakeContext();
    const player = new AudioClipPlayer(annotatedClip(), {
      audioContext: context,
      loop: {start: 0, end: 2},
    });
    const labels: string[] = [];
    player.on('regionenter', (region) => labels.push(region.label));

    player.seek(2.75);

    expect(player.seconds).toBe(0.75);
    expect(labels).toEqual(['near']);
    player.dispose();
  });

  it('drops old region and beat notifications after a timeupdate listener seeks', async () => {
    vi.useFakeTimers();
    const {context} = fakeContext();
    const player = new AudioClipPlayer(annotatedClip(), {audioContext: context});
    const regions: string[] = [];
    const beats: number[] = [];
    player.on('regionenter', (region) => regions.push(`enter:${region.label}`));
    player.on('regionleave', (region) => regions.push(`leave:${region.label}`));
    player.on('beat', ({index}) => beats.push(index));
    player.once('timeupdate', () => player.seek(2.75));
    await player.play();
    Object.defineProperty(context, 'currentTime', {value: 0.75, writable: true});

    await vi.advanceTimersByTimeAsync(50);

    expect(player.seconds).toBe(2.75);
    expect(regions).toEqual(['enter:far']);
    expect(beats).toEqual([]);
    await vi.advanceTimersByTimeAsync(50);
    expect(regions).toEqual(['enter:far']);
    expect(beats).toEqual([2]);
    player.dispose();
  });

  it('commits region membership before a listener seeks within that same region', () => {
    const {context} = fakeContext();
    const player = new AudioClipPlayer(annotatedClip(), {audioContext: context});
    const entered = vi.fn(() => player.seek(0.75));
    const updates = vi.fn();
    player.on('regionenter', entered);
    player.on('timeupdate', updates);

    player.seek(0.75);

    expect(entered).toHaveBeenCalledOnce();
    expect(updates).toHaveBeenCalledOnce();
    player.dispose();
  });

  it('preserves a nested region seek and emits only the newer position', () => {
    const {context} = fakeContext();
    const player = new AudioClipPlayer(annotatedClip(), {audioContext: context});
    const events: string[] = [];
    const positions: number[] = [];
    player.on('regionenter', (region) => {
      events.push(`enter:${region.label}`);
      if (region.label === 'near') player.seek(2.75);
    });
    player.on('regionleave', (region) => events.push(`leave:${region.label}`));
    player.on('timeupdate', ({seconds}) => positions.push(seconds));

    player.seek(0.75);
    player.seek(2.8);

    expect(events).toEqual(['enter:near', 'enter:far', 'leave:near']);
    expect(positions).toEqual([2.75, 2.8]);
    player.dispose();
  });

  it('retains the accepted loop after a rejected range edit', async () => {
    const {context} = fakeContext();
    const player = new AudioClipPlayer(annotatedClip(), {
      audioContext: context,
      loop: {start: 0, end: 2},
    });
    await player.preload();

    expect(() => player.setLoop({start: 5, end: 6})).toThrow(RangeError);
    player.seek(2.75);
    expect(player.seconds).toBe(0.75);
    player.dispose();
  });

  it('exposes its immutable input clip without allocating playback resources', () => {
    const {context} = fakeContext();
    const clip = annotatedClip();
    const player = new AudioClipPlayer(clip, {audioContext: context});

    expect(player.clip).toBe(clip);
    expect(context.createGain).not.toHaveBeenCalled();
    player.dispose();
    expect(player.clip).toBe(clip);
  });
});
