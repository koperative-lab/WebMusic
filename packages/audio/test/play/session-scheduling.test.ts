import {afterEach, describe, expect, it, vi} from 'vitest';
import {SessionTransport} from '@webmusic/kernel/session';
import {createAudioClip} from '../../src/core';
import {AudioClipPlayer} from '../../src/play/headless/player';
import {AudioPlayer} from '../../src/play/headless/audio-player';

function fixture(duration = 8) {
  let now = 0;
  let state = 'running';
  const context = {} as AudioContext;
  const node = () => ({context, connect: vi.fn(), disconnect: vi.fn()});
  const sources: Array<ReturnType<typeof source>> = [];
  const source = () => ({...node(), buffer: null, playbackRate: {value: 1},
    loop: false, loopStart: 0, loopEnd: 0, onended: null as (() => void) | null,
    start: vi.fn((_when: number, _offset: number, _duration?: number) => {}), stop: vi.fn()});
  Object.assign(context, {
    sampleRate: 1000, destination: node(),
    createGain: () => ({...node(), gain: {value: 1}}),
    createStereoPanner: () => ({...node(), pan: {value: 0}}),
    createAnalyser: () => ({...node(), fftSize: 2048, smoothingTimeConstant: 0.8}),
    createBuffer: vi.fn((channels: number, length: number, sampleRate: number) => ({
      numberOfChannels: channels, length, sampleRate, duration: length / sampleRate,
      getChannelData: () => new Float32Array(length),
    })),
    createBufferSource: () => { const created = source(); sources.push(created); return created; },
    resume: vi.fn(async () => { state = 'running'; }), close: vi.fn(async () => { state = 'closed'; }),
  });
  Object.defineProperties(context, {currentTime: {get: () => now}, state: {get: () => state}});
  const clip = createAudioClip({sampleRate: 1000, channelData: [new Float32Array(duration * 1000)]});
  const player = new AudioClipPlayer(clip, {audioContext: context});
  const session = new SessionTransport(() => now, {leadInSeconds: 0.1});
  const commands = {play: vi.fn(() => player.play()), pause: vi.fn(() => player.pause()), stop: vi.fn(() => player.stop()),
    seek: vi.fn((position: number) => player.seek(position)), setRate: vi.fn((rate: number) => player.setRate(rate)),
    get position() { return player.seconds; }, get running() { return player.playing; }};
  const attach = (mapping: {offsetSeconds?: number; positionScale?: number} = {}) => session.register(commands, {
    axis: 'clip-seconds', identity: player, durationSeconds: () => duration, endPolicy: 'position',
    prepare: () => player.preload(), activate: () => player.activateScheduling(),
    attachScheduling: binding => player.attachScheduling(binding), ...mapping,
  });
  cleanups.push(() => player.dispose(), () => session.dispose());
  return {context, sources, clip, player, session, commands, attach,
    time: (value: number) => { now = value; }, suspend: () => { state = 'suspended'; }};
}

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
  vi.useRealTimers();
});

describe('Audio shared Session scheduling', () => {
  it('prepares without resuming, activates before choosing the origin, and never runs legacy follower commands', async () => {
    const f = fixture();
    f.suspend();
    f.attach({offsetSeconds: 1, positionScale: 2});
    await f.session.preload();
    expect(f.context.resume).not.toHaveBeenCalled();
    expect(f.sources).toHaveLength(0);
    vi.mocked(f.context.resume).mockImplementation(async () => { f.time(3); });
    await f.session.play();
    expect(f.context.resume).toHaveBeenCalledOnce();
    expect(f.sources[0].start).toHaveBeenCalledWith(3.1, 1);
    expect(f.sources[0].playbackRate.value).toBe(2);
    expect(f.player.clock?.state).toEqual({...f.session.clock.state, originPosition: 1, rate: 2});
    for (const command of [f.commands.play, f.commands.pause, f.commands.stop, f.commands.seek, f.commands.setRate]) expect(command).not.toHaveBeenCalled();
    expect(() => f.player.seek(2)).toThrow('Session owns');
    expect(f.player.beginScratch()).toBeUndefined();
  });

  it('invalidates future sources immediately and re-arms seek/rate under one authority', async () => {
    const f = fixture();
    f.attach();
    await f.session.play();
    const first = f.sources[0];
    f.time(0.02);
    const seek = f.session.seek(2);
    expect(first.stop).toHaveBeenCalledOnce();
    await seek;
    expect(f.sources.at(-1)!.start.mock.calls[0][1]).toBe(2);
    const second = f.sources.at(-1)!;
    await f.session.setRate(1.5);
    expect(second.stop).toHaveBeenCalledOnce();
    expect(f.sources.at(-1)!.playbackRate.value).toBe(1.5);
    await f.session.pause();
    expect(f.player.playing).toBe(false);
    const count = f.sources.length;
    f.time(20);
    expect(f.sources).toHaveLength(count);
    expect(f.player.seconds).toBeCloseTo(2, 8);
  });

  it('uses one continuous native source for a mapped loop at non-unit rate', async () => {
    vi.useFakeTimers();
    const f = fixture();
    f.attach({offsetSeconds: 0.5, positionScale: 2});
    await f.session.setLoop({startSeconds: 0.5, endSeconds: 2});
    await f.session.setRate(1.5);
    await f.session.play();
    expect(f.sources).toHaveLength(1);
    expect(f.sources[0]).toMatchObject({loop: true, loopStart: 1.5, loopEnd: 4.5});
    expect(f.sources[0].playbackRate.value).toBe(3);
    f.time(10.1);
    await vi.advanceTimersByTimeAsync(100);
    expect(f.sources).toHaveLength(1);
    expect(f.player.seconds).toBeCloseTo(3.5, 7);
    expect(f.player.clock!.positionAt(10.1)).toBeCloseTo(30.5, 7);
    expect(f.player.schedulingMode).toBe('session-native');
  });

  it('schedules short clips once per wider loop and leaves the remainder silent', async () => {
    vi.useFakeTimers();
    const f = fixture(1);
    f.attach();
    await f.session.setLoop({startSeconds: 0, endSeconds: 2});
    await f.session.play();
    expect(f.player.schedulingMode).toBe('session-lookahead');
    expect(f.sources[0].start).toHaveBeenCalledWith(0.1, 0, 1);
    f.time(1.92);
    await vi.advanceTimersByTimeAsync(25);
    expect(f.sources).toHaveLength(2);
    expect(f.sources[1].start.mock.calls[0][0]).toBeCloseTo(2.1, 8);
    expect(f.sources[1].start.mock.calls[0].slice(1)).toEqual([0, 1]);
    await vi.advanceTimersByTimeAsync(100);
    expect(f.sources).toHaveLength(2);
    await f.session.pause();
    expect(f.sources.every(source => source.stop.mock.calls.length === 1)).toBe(true);
  });

  it('does not advance scheduling while audio reference time is suspended', async () => {
    vi.useFakeTimers();
    const f = fixture(1);
    f.attach();
    await f.session.setLoop({startSeconds: 0, endSeconds: 2});
    await f.session.play();
    f.suspend();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(f.sources).toHaveLength(1);
    expect(f.player.seconds).toBe(0);
    f.time(1.92);
    await vi.advanceTimersByTimeAsync(25);
    expect(f.sources).toHaveLength(2);
  });

  it('schedules silence before a negatively mapped clip and between wider loop passes', async () => {
    vi.useFakeTimers();
    const f = fixture(1);
    f.attach({offsetSeconds: -0.5, positionScale: 2});
    await f.session.setLoop({startSeconds: 0, endSeconds: 1});
    await f.session.setRate(1.5);
    await f.session.play();
    expect(f.player.schedulingMode).toBe('session-lookahead');
    expect(f.sources[0].start.mock.calls[0][0]).toBeCloseTo(0.1 + 0.5 / 3, 8);
    expect(f.sources[0].start.mock.calls[0].slice(1)).toEqual([0, 1]);
    expect(f.sources[0].playbackRate.value).toBe(3);
    expect(f.player.seconds).toBe(0);
    f.time(0.6);
    await vi.advanceTimersByTimeAsync(25);
    expect(f.sources).toHaveLength(2);
    expect(f.sources[1].start.mock.calls[0][0]).toBeCloseTo(0.1 + 2.5 / 3, 8);
    expect(f.sources[1].start.mock.calls[0].slice(1)).toEqual([0, 1]);
    await f.session.pause();
    expect(f.sources.every(source => source.stop.mock.calls.length === 1)).toBe(true);
  });

  it('catches up to the shared position if graph preparation crosses an existing future origin', async () => {
    const f = fixture();
    await f.session.play();
    vi.mocked(f.context.createBuffer).mockImplementation((channels, length, sampleRate) => {
      f.time(0.6);
      const data = Array.from({length: channels}, () => new Float32Array(length));
      return {numberOfChannels: channels, length, sampleRate, duration: length / sampleRate,
        getChannelData: channel => data[channel],
        copyFromChannel: (destination, channel, start = 0) => destination.set(data[channel].subarray(start, start + destination.length)),
        copyToChannel: (source, channel, start = 0) => data[channel].set(source.subarray(0, length - start), start)};
    });
    const lease = f.player.attachScheduling(f.session.scheduling);
    expect(f.sources[0].start.mock.calls[0][0]).toBeCloseTo(0.6, 8);
    expect(f.sources[0].start.mock.calls[0][1]).toBeCloseTo(0.5, 8);
    expect(f.session.clock.state.originTime).toBeCloseTo(0.1, 8);
    lease.release();
  });

  it('detaches a borrowed engine without pausing or changing the Session clock', async () => {
    const f = fixture();
    const lease = f.attach();
    await f.session.play();
    f.time(1);
    const before = f.session.clock.state;
    lease.release();
    await lease.settled;
    expect(f.player.followsSession).toBe(false);
    expect(f.player.playing).toBe(false);
    expect(f.session.clock.state).toEqual(before);
    expect(f.context.close).not.toHaveBeenCalled();
    await f.player.play();
    expect(f.player.playing).toBe(true);
  });

  it('retains the mapped rate consistently in detached readback and subsequent independent playback', async () => {
    const f = fixture();
    const attachment = f.attach({positionScale: 2});
    await f.session.setRate(1.5);
    await f.session.play();
    expect(f.player.playbackRate).toBe(3);
    attachment.release();
    await attachment.settled;
    expect(f.player.followsSession).toBe(false);
    expect(f.player.clock!.rate).toBe(3);
    expect(f.player.playbackRate).toBe(3);
    await f.player.play();
    expect(f.sources.at(-1)!.playbackRate.value).toBe(3);
    expect(f.session.clock.rate).toBe(1.5);
  });

  it('keeps stable AudioPlayer output while source replacement withdraws scheduled audio', async () => {
    const f = fixture();
    const owner = new AudioPlayer(f.clip, {audioContext: f.context});
    cleanups.push(() => owner.dispose());
    await owner.preload();
    const port = owner.outputPort;
    const lease = owner.attachScheduling(f.session.scheduling);
    await f.session.play();
    expect(owner.followsSession).toBe(true);
    owner.setClip(createAudioClip({sampleRate: 1000, channelData: [new Float32Array(2000)]}));
    expect(lease.active).toBe(false);
    expect(owner.outputPort).toBe(port);
    expect(f.session.clock.paused).toBe(false);
  });

  it('declares media scheduling limits and rejects a shared-anchor claim before allocating media', () => {
    const f = fixture();
    const media = new AudioClipPlayer(f.clip, {audioContext: f.context, engine: 'media'});
    cleanups.push(() => media.dispose());
    expect(media.timingCapabilities).toEqual({engine: 'media', sharedSessionClock: false, futureStart: false, nativeLoop: false});
    expect(media.schedulingMode).toBe('approximate-media');
    expect(() => media.attachScheduling(f.session.scheduling)).toThrow('approximate transport coordination');
    expect(f.sources).toHaveLength(0);
  });

  it('releases only a facade-owned borrowed scheduling attachment when replacing or disposing the facade', async () => {
    const f = fixture();
    const facade = new AudioPlayer(undefined, {audioContext: f.context});
    cleanups.push(() => facade.dispose());
    facade.setTransport(f.player);
    await facade.preload();
    const first = facade.attachScheduling(f.session.scheduling);
    await f.session.play();
    const state = f.session.clock.state;
    expect(facade.followsSession).toBe(true);
    facade.setClip(createAudioClip({sampleRate: 1000, channelData: [new Float32Array(1000)]}));
    expect(first.active).toBe(false);
    expect(f.player.followsSession).toBe(false);
    expect(f.player.playing).toBe(false);
    expect(f.session.clock.state).toEqual(state);
    facade.setTransport(f.player);
    const second = facade.attachScheduling(f.session.scheduling);
    facade.dispose();
    expect(second.active).toBe(false);
    expect(f.player.followsSession).toBe(false);
    expect(f.context.close).not.toHaveBeenCalled();
    await f.player.play();
    expect(f.player.playing).toBe(true);
  });

  it('preserves a caller-owned borrowed scheduling attachment when its facade detaches', async () => {
    const f = fixture();
    await f.player.preload();
    const attachment = f.player.attachScheduling(f.session.scheduling);
    const facade = new AudioPlayer(undefined, {audioContext: f.context});
    cleanups.push(() => facade.dispose());
    facade.setTransport(f.player);
    await f.session.play();
    const before = f.session.clock.state;
    facade.setClip(createAudioClip({sampleRate: 1000, channelData: [new Float32Array(1000)]}));
    expect(attachment.active).toBe(true);
    expect(f.player.followsSession).toBe(true);
    expect(f.player.playing).toBe(true);
    expect(f.session.clock.state).toEqual(before);
    attachment.release();
  });

  it('releases a borrowed attachment if its initial notification replaces the facade source', async () => {
    const f = fixture();
    const facade = new AudioPlayer(undefined, {audioContext: f.context});
    cleanups.push(() => facade.dispose());
    facade.setTransport(f.player);
    await facade.preload();
    const replacement = createAudioClip({sampleRate: 1000, channelData: [new Float32Array(1000)]});
    const off = f.player.on('timeupdate', () => facade.setClip(replacement));
    expect(() => facade.attachScheduling(f.session.scheduling)).toThrow('attachment was cancelled');
    expect(facade.clip).toBe(replacement);
    expect(facade.followsSession).toBe(false);
    expect(f.player.followsSession).toBe(false);
    off();
  });

  it('rejects obsolete asynchronous facade activation after source replacement', async () => {
    const f = fixture();
    f.suspend();
    let finish!: () => void;
    vi.mocked(f.context.resume).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const facade = new AudioPlayer(undefined, {audioContext: f.context});
    cleanups.push(() => facade.dispose());
    facade.setTransport(f.player);
    const pending = facade.activateScheduling();
    const replacement = createAudioClip({sampleRate: 1000, channelData: [new Float32Array(1000)]});
    facade.setClip(replacement);
    finish();
    await expect(pending).rejects.toThrow('activation was cancelled');
    expect(facade.clip).toBe(replacement);
    expect(f.sources).toHaveLength(0);
  });
});
