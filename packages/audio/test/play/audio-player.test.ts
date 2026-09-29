import {afterEach, describe, expect, it, vi} from 'vitest';
import {createAudioClip} from '../../src/core';
import {AudioPlayer, type AudioPlayerTransport} from '../../src/play/headless/audio-player';

const clip = (seconds = 2) => createAudioClip({sampleRate: 1000, channelData: [new Float32Array(seconds * 1000)]});
const node = () => ({connect: vi.fn(), disconnect: vi.fn()});
function context() {
  return {
    state: 'running', currentTime: 0, destination: node(),
    close: vi.fn(async () => {}), resume: vi.fn(async () => {}),
    createGain: vi.fn(() => ({...node(), gain: {value: 1}})),
    createStereoPanner: vi.fn(() => ({...node(), pan: {value: 0}})),
    createAnalyser: vi.fn(() => ({...node(), fftSize: 0, smoothingTimeConstant: 0})),
    createBuffer: vi.fn((numberOfChannels: number, length: number, sampleRate: number) => ({
      numberOfChannels, length, sampleRate, duration: length / sampleRate,
      getChannelData: () => new Float32Array(length),
    })),
    createBufferSource: vi.fn(() => ({...node(), playbackRate: {value: 1}, start: vi.fn(), stop: vi.fn()})),
  } as unknown as AudioContext;
}
function transport() {
  const listeners = new Set<() => void>();
  const endListeners = new Set<() => void>();
  const errorListeners = new Set<(error: Error) => void>();
  const source = {
    seconds: 0, duration: 4, playing: false as boolean, clip: clip(4),
    play: vi.fn(async () => { source.playing = true; }),
    pause: vi.fn(() => { source.playing = false; }),
    stop: vi.fn(() => { source.playing = false; source.seconds = 0; }),
    seek: vi.fn((seconds: number) => { source.seconds = seconds; }),
    setVolume: vi.fn(), setRate: vi.fn(), dispose: vi.fn(),
    subscribe: vi.fn((notify: () => void) => { listeners.add(notify); return () => listeners.delete(notify); }),
    onEnd: vi.fn((notify: () => void) => { endListeners.add(notify); return () => endListeners.delete(notify); }),
    onError: vi.fn((notify: (error: Error) => void) => { errorListeners.add(notify); return () => errorListeners.delete(notify); }),
  } satisfies AudioPlayerTransport & {dispose(): void};
  return {source, listeners, endListeners, errorListeners, notify: () => { for (const notify of listeners) notify(); }};
}
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe('AudioPlayer stable source ownership', () => {
  it('keeps an empty owner free of audio resources and publishes sources before playback', () => {
    const ctx = context();
    const player = new AudioPlayer(undefined, {audioContext: ctx});
    const first = clip();
    const changes: unknown[] = [];
    player.on('sourcechange', (detail) => changes.push(detail));
    expect(player.analyser).toBeUndefined();
    player.setClip(first);
    expect(player.clip).toBe(first);
    expect(player.duration).toBe(2);
    expect(player.clock).toBeUndefined();
    expect(ctx.createAnalyser).not.toHaveBeenCalled();
    player.setClip(first);
    expect(changes).toEqual([{clip: first, revision: 1}]);
    player.dispose();
    expect(ctx.close).not.toHaveBeenCalled();
  });

  it('retains one output analyser/context across owned source replacements', async () => {
    const ctx = context();
    const player = new AudioPlayer(clip(), {audioContext: ctx, volume: 0.3});
    const output = player.analyser;
    await player.play();
    player.seek(1);
    const firstSource = vi.mocked(ctx.createBufferSource).mock.results[0]!.value;
    player.setClip(clip(3));
    expect(firstSource.stop).toHaveBeenCalled();
    expect(player.playing).toBe(false);
    expect(player.seconds).toBe(0);
    expect(player.analyser).toBe(output);
    await player.play();
    expect(vi.mocked(ctx.createGain).mock.results.some(({value}) => value.gain.value === 0.3)).toBe(true);
    player.setClip(undefined);
    expect(player.analyser).toBeUndefined();
    expect(ctx.close).not.toHaveBeenCalled();
    player.dispose();
    expect(output!.disconnect).toHaveBeenCalledOnce();
    expect(ctx.close).not.toHaveBeenCalled();
  });

  it('cancels an old pending play when a new clip is selected', async () => {
    const ctx = context();
    Object.defineProperty(ctx, 'state', {value: 'suspended'});
    let resolve!: () => void;
    vi.mocked(ctx.resume).mockImplementation(() => new Promise<void>((done) => { resolve = done; }));
    const player = new AudioPlayer(clip(), {audioContext: ctx});
    const play = player.play();
    player.setClip(clip(3));
    resolve();
    await play;
    expect(ctx.createBufferSource).not.toHaveBeenCalled();
    expect(player.playing).toBe(false);
    expect(player.duration).toBe(3);
    player.dispose();
  });

  it('honors a reentrant source choice made during the source notification', () => {
    const player = new AudioPlayer();
    const first = clip(1);
    const second = clip(3);
    const times: number[] = [];
    player.on('sourcechange', ({clip: selected}) => { if (selected === first) player.setClip(second); });
    player.on('timeupdate', ({duration}) => times.push(duration));
    player.setClip(first);
    expect(player.clip).toBe(second);
    expect(times).toEqual([3]);
    player.dispose();
  });
});

describe('AudioPlayer terminal observations', () => {
  it('publishes terminal emptiness to all followers before removing subscriptions', async () => {
    const ctx = context();
    const player = new AudioPlayer(clip(), {audioContext: ctx});
    await player.play();
    const output = player.analyser!;
    const states: boolean[] = [];
    const times: unknown[] = [];
    const source = vi.fn(() => {
      expect(player.clip).toBeUndefined();
      expect(player.transport).toBeUndefined();
      expect(player.analyser).toBeUndefined();
      expect(player.playing).toBe(false);
      player.setClip(clip(6));
      player.setTransport(transport().source);
      void player.play();
      player.dispose();
    });
    player.on('sourcechange', source);
    player.on('statechange', ({playing}) => states.push(playing));
    player.on('timeupdate', (detail) => times.push(detail));
    player.dispose();
    player.dispose();
    expect(source).toHaveBeenCalledOnce();
    expect(source).toHaveBeenCalledWith({clip: undefined, revision: 1});
    expect(states).toEqual([false]);
    expect(times).toEqual([{seconds: 0, duration: 0, progress: 0}]);
    expect(player.clip).toBeUndefined();
    expect(output.disconnect).toHaveBeenCalledOnce();
    expect(ctx.close).not.toHaveBeenCalled();
  });

  it('finishes follower notification and cleanup when an earlier observer throws', () => {
    const ctx = context();
    const player = new AudioPlayer(clip(), {audioContext: ctx});
    const output = player.analyser!;
    const failure = new Error('observer failed');
    const followingSource = vi.fn();
    const finalTime = vi.fn();
    player.on('sourcechange', () => { throw failure; });
    player.on('sourcechange', followingSource);
    player.on('timeupdate', finalTime);
    expect(() => player.dispose()).toThrow(failure);
    expect(followingSource).toHaveBeenCalledWith({clip: undefined, revision: 1});
    expect(finalTime).toHaveBeenCalledWith({seconds: 0, duration: 0, progress: 0});
    expect(output.disconnect).toHaveBeenCalledOnce();
    expect(player.analyser).toBeUndefined();
    expect(() => player.dispose()).not.toThrow();
    expect(followingSource).toHaveBeenCalledOnce();
  });
});

describe('AudioPlayer borrowed transport authority', () => {
  it('delegates commands and source observations without manufacturing a group clip', async () => {
    vi.useFakeTimers();
    const {source, notify} = transport();
    const player = new AudioPlayer();
    player.setTransport(source);
    expect(player.transport).toBe(source);
    expect(player.clip).toBe(source.clip);
    expect(source.setVolume).not.toHaveBeenCalled();
    await player.play();
    player.seek(2.5);
    expect(source.seek).toHaveBeenCalledWith(2.5);
    expect(player.seconds).toBe(2.5);
    source.clip = clip(5);
    source.duration = 5;
    const changes = vi.fn();
    player.on('sourcechange', changes);
    notify();
    expect(changes).toHaveBeenCalledWith({clip: source.clip, revision: 2});
    player.dispose();
    expect(source.playing).toBe(true);
    expect(source.pause).not.toHaveBeenCalled();
    expect(source.dispose).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('pauses a borrowed source on deliberate replacement, but preserves its position and lifetime', async () => {
    const {source} = transport();
    const player = new AudioPlayer();
    player.setTransport(source);
    await player.play();
    player.seek(2);
    player.setClip(clip());
    expect(source.pause).toHaveBeenCalledOnce();
    expect(source.stop).not.toHaveBeenCalled();
    expect(source.seconds).toBe(2);
    expect(source.dispose).not.toHaveBeenCalled();
    expect(player.transport).toBeUndefined();
    player.dispose();
  });

  it('merely detaches a borrowed source without issuing a playback command', async () => {
    const {source, listeners, endListeners, errorListeners} = transport();
    const player = new AudioPlayer();
    player.setTransport(source);
    await player.play();
    player.setTransport(undefined);
    expect(source.playing).toBe(true);
    expect(source.pause).not.toHaveBeenCalled();
    expect(source.dispose).not.toHaveBeenCalled();
    expect(listeners.size + endListeners.size + errorListeners.size).toBe(0);
    player.dispose();
  });

  it('applies explicit settings on attachment and rejects unsupported controls without changing state', () => {
    const {source} = transport();
    const player = new AudioPlayer(undefined, {volume: 0.2});
    player.setRate(1.5);
    player.setTransport(source);
    expect(source.setVolume).toHaveBeenCalledWith(0.2);
    expect(source.setRate).toHaveBeenCalledWith(1.5);
    expect(() => player.setPan(0.7)).toThrow(/setPan/);
    expect(player.pan).toBe(0);
    expect(() => player.setLoop(true)).toThrow(/setLoop/);
    player.dispose();
  });

  it('rejects nested central owners before changing the selected source', () => {
    const first = new AudioPlayer();
    const second = new AudioPlayer();
    const selected = clip();
    first.setClip(selected);
    expect(() => first.setTransport(first)).toThrow(/another AudioPlayer/);
    expect(() => first.setTransport(second)).toThrow(/another AudioPlayer/);
    expect(first.clip).toBe(selected);
    expect(first.transport).toBeUndefined();
    first.dispose(); second.dispose();
  });

  it('honors reentrant replacement from the old backend pause callback', () => {
    const {source} = transport();
    const player = new AudioPlayer();
    player.setTransport(source);
    const newer = clip(6);
    source.pause.mockImplementationOnce(() => player.setClip(newer));
    player.setClip(clip(3));
    expect(player.clip).toBe(newer);
    expect(source.dispose).not.toHaveBeenCalled();
    player.dispose();
  });

  it('releases subscriptions registered after synchronous reentrant disposal', () => {
    const {source} = transport();
    const release = vi.fn();
    const player = new AudioPlayer();
    source.subscribe.mockImplementationOnce(() => { player.dispose(); return release; });
    player.setTransport(source);
    expect(release).toHaveBeenCalledOnce();
    expect(source.dispose).not.toHaveBeenCalled();
    expect(source.onEnd).not.toHaveBeenCalled();
  });

  it('does not recurse or start a stale observer when state listeners pause playback', async () => {
    vi.useFakeTimers();
    const {source} = transport();
    const player = new AudioPlayer();
    player.setTransport(source);
    player.on('statechange', ({playing}) => { if (playing) player.pause(); });
    await player.play();
    expect(player.playing).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    player.dispose();
  });
});
