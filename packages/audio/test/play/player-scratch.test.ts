import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {AudioClip, createAudioClip} from '../../src/core';
import {AudioClipPlayer} from '../../src/play/headless/player';

function deferred() {
  let resolve!: () => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<void>((res, rej) => { resolve = res; reject = rej; });
  return {promise, resolve, reject};
}

function contextFixture(state: AudioContextState = 'running') {
  const pending = deferred();
  const node = () => ({connect: vi.fn(), disconnect: vi.fn()});
  const param = () => ({value: 1, setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(), cancelScheduledValues: vi.fn()});
  const sources: AudioBufferSourceNode[] = [];
  const gains: GainNode[] = [];
  const buffers: AudioBuffer[] = [];
  const context = {
    state,
    currentTime: 0,
    destination: node(),
    resume: vi.fn(() => pending.promise),
    close: vi.fn(async () => {}),
    createGain: vi.fn(() => {
      const gain = {...node(), gain: param()} as unknown as GainNode;
      gains.push(gain);
      return gain;
    }),
    createStereoPanner: vi.fn(() => ({...node(), pan: {value: 0}})),
    createAnalyser: vi.fn(() => ({...node(), fftSize: 0, smoothingTimeConstant: 0})),
    createBufferSource: vi.fn(() => {
      const source = {...node(), buffer: null, playbackRate: param(), loop: false,
        loopStart: 0, loopEnd: 0, onended: null, start: vi.fn(), stop: vi.fn()} as unknown as AudioBufferSourceNode;
      sources.push(source);
      return source;
    }),
    createBuffer: vi.fn((numberOfChannels: number, length: number, sampleRate: number) => {
      const channels = Array.from({length: numberOfChannels}, () => new Float32Array(length));
      const buffer = {numberOfChannels, length, sampleRate, duration: length / sampleRate,
        getChannelData: (index: number) => channels[index]!} as AudioBuffer;
      buffers.push(buffer);
      return buffer;
    }),
  } as unknown as AudioContext;
  const advance = (seconds: number) => { Object.assign(context, {currentTime: seconds}); };
  return {context, pending, advance, sources, gains, buffers};
}

function pcm(seconds = 10) {
  const a = Float32Array.from({length: seconds * 8000}, (_, i) => i / (seconds * 8000));
  return createAudioClip({sampleRate: 8000, channelData: [a, a.map((x) => -x)]});
}

const players: AudioClipPlayer[] = [];
function setup(state: AudioContextState = 'running', options: ConstructorParameters<typeof AudioClipPlayer>[1] = {}) {
  const fixture = contextFixture(state);
  const clip = pcm();
  const player = new AudioClipPlayer(clip, {audioContext: fixture.context, ...options});
  players.push(player);
  return {...fixture, clip, player};
}

beforeEach(() => { vi.useFakeTimers(); });

afterEach(() => {
  for (const player of players.splice(0)) player.dispose();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('AudioClipPlayer audible scratch ownership', () => {
  it('returns unsupported without constructing audio or pausing streaming-only playback', () => {
    const fixture = contextFixture();
    const player = new AudioClipPlayer(createAudioClip({sampleRate: 8000, length: 80000, numberOfChannels: 2,
      sourceUrl: 'https://example.test/stream.mp3'}), {audioContext: fixture.context});
    players.push(player);
    expect(player.beginScratch()).toBeUndefined();
    expect(fixture.context.createGain).not.toHaveBeenCalled();
    expect(fixture.context.resume).not.toHaveBeenCalled();
    expect(player.scratching).toBe(false);
  });

  it('pauses normal playback at begin and restores it at the accepted release position', async () => {
    const {player, advance, sources, context} = setup();
    await player.play();
    advance(2);
    const states: boolean[] = [];
    player.on('timeupdate', () => states.push(player.playing));
    const scratch = player.beginScratch()!;
    expect(player.seconds).toBe(2);
    expect(player.playing).toBe(false);
    expect(states).toEqual([false]);
    expect(sources[0]!.stop).toHaveBeenCalled();
    advance(2.1);
    scratch.moveToSeconds(3);
    expect(player.seconds).toBe(3);
    expect(player.playing).toBe(false);
    const release = scratch.end();
    expect(scratch.active).toBe(true);
    advance(context.currentTime + 0.3);
    vi.advanceTimersByTime(16);
    await release;
    expect(scratch.active).toBe(false);
    expect(player.scratching).toBe(false);
    expect(player.playing).toBe(true);
    expect(player.seconds).toBeCloseTo(4.26);
    expect(states.at(-1)).toBe(true);
  });

  it('keeps an originally paused player paused and supports silent click positioning', async () => {
    const {player, sources} = setup();
    const scratch = player.beginScratch()!;
    scratch.moveToSeconds(3, false);
    expect(player.seconds).toBe(3);
    expect(sources).toHaveLength(0);
    await scratch.end();
    expect(player.playing).toBe(false);
    expect(sources).toHaveLength(0);
  });

  it('renders forward and reverse stereo samples through the existing gain route with bounded copies', () => {
    const {player, clip, advance, sources, buffers, gains} = setup();
    const copies = vi.spyOn(AudioClip.prototype, 'channels');
    const slicing = vi.spyOn(AudioClip.prototype, 'slice').mockImplementation(() => { throw new Error('metadata slicing forbidden'); });
    const channelCopies = vi.spyOn(AudioClip.prototype, 'channelData');
    player.seek(3);
    const scratch = player.beginScratch()!;
    advance(0.05);
    scratch.moveToSeconds(3.1);
    advance(0.10);
    scratch.moveToSeconds(3.0);
    expect(sources).toHaveLength(2);
    const forward = sources[0]!.buffer!;
    const reverse = sources[1]!.buffer!;
    expect(forward.getChannelData(0)[0]).toBeLessThan(forward.getChannelData(0).at(-1)!);
    expect(reverse.getChannelData(0)[0]).toBeGreaterThan(reverse.getChannelData(0).at(-1)!);
    for (let index = 0; index < reverse.length; index++) {
      expect(reverse.getChannelData(1)[index]).toBe(-reverse.getChannelData(0)[index]!);
    }
    expect(sources[0]!.playbackRate.value).toBeCloseTo(2);
    expect(sources[1]!.playbackRate.value).toBeCloseTo(2);
    expect(buffers.every((b) => b.length <= 2 * 8000 + 2)).toBe(true);
    expect(copies).not.toHaveBeenCalled();
    expect(slicing).not.toHaveBeenCalled();
    expect(channelCopies).not.toHaveBeenCalled();
    expect(clip.channelData(0)![0]).toBe(0);
    expect(gains.at(-1)!.connect).toHaveBeenCalledWith(gains[0]);
    expect(sources[1]!.stop).toHaveBeenCalledWith(expect.closeTo(0.2));
  });


  it('copies relative frame offsets correctly when the input clip already shares a sliced PCM view', () => {
    const fixture = contextFixture();
    const clip = pcm().slice(2, 5);
    const player = new AudioClipPlayer(clip, {audioContext: fixture.context});
    players.push(player);
    const scratch = player.beginScratch()!;
    fixture.advance(0.05);
    scratch.moveToSeconds(0.5);
    expect(fixture.sources[0]!.buffer!.getChannelData(0)[0]).toBeCloseTo(0.25);
    fixture.advance(0.1);
    scratch.moveToSeconds(0.4);
    const reverse = fixture.sources[1]!.buffer!.getChannelData(0);
    expect(reverse[0]).toBeCloseTo(0.24);
  });

  it('derives direction from requested movement despite loop-normalized readback', () => {
    const {player, advance, sources} = setup('running', {loop: {start: 2, end: 4}});
    player.seek(3.9);
    const scratch = player.beginScratch()!;
    advance(0.05);
    scratch.moveToSeconds(4.1);
    expect(player.seconds).toBeCloseTo(2.1);
    const samples = sources[0]!.buffer!.getChannelData(0);
    expect(samples[0]).toBeLessThan(samples.at(-1)!);
  });


  it('truncates both scratch directions at active loop bounds while retaining the normal lead-in', () => {
    const fixture = contextFixture();
    const samples = Float32Array.from({length: 80000}, (_, i) => i < 16000 || i >= 32000 ? 0.9 : 0.1);
    const player = new AudioClipPlayer(createAudioClip({sampleRate: 8000, channelData: [samples]}), {
      audioContext: fixture.context, loop: {start: 2, end: 4},
    });
    players.push(player);
    player.seek(3.85);
    const scratch = player.beginScratch()!;
    fixture.advance(0.05);
    scratch.moveToSeconds(3.95);
    expect(fixture.sources[0]!.buffer!.getChannelData(0).every((v) => Math.abs(v - 0.1) < 1e-6)).toBe(true);
    fixture.advance(0.1);
    scratch.moveToSeconds(2.05);
    expect(fixture.sources[1]!.buffer!.getChannelData(0).every((v) => Math.abs(v - 0.1) < 1e-6)).toBe(true);
    fixture.advance(0.15);
    scratch.moveToSeconds(1);
    expect(player.seconds).toBe(1);
    expect(fixture.sources[2]!.buffer!.getChannelData(0).every((v) => Math.abs(v - 0.9) < 1e-6)).toBe(true);
    player.setLoop({start: 2.02, end: 2.04});
    fixture.advance(0.2);
    scratch.moveToSeconds(2.03);
    expect(fixture.sources[3]!.buffer!.duration).toBeLessThanOrEqual(0.010125);
  });

  it('supports decoded PCM with a media transport while borrowing its accepted position', async () => {
    const fixture = contextFixture();
    const base = pcm();
    const clip = createAudioClip({sampleRate: base.sampleRate, channelData: base.channels()!, sourceUrl: 'https://example.test/file.wav'});
    const adapter = {
      duration: 10, paused: true, ended: false, currentTime: 0, playbackRate: 1, loop: false,
      onended: null as (() => void) | null, connect: vi.fn(), disconnect: vi.fn(),
      play: vi.fn(async () => { adapter.paused = false; }),
      pause: vi.fn(() => { adapter.paused = true; }),
    };
    const player = new AudioClipPlayer(clip, {audioContext: fixture.context, engine: 'media', mediaAdapterFactory: () => adapter});
    players.push(player);
    await player.play();
    const scratch = player.beginScratch()!;
    expect(adapter.paused).toBe(true);
    fixture.advance(0.05);
    scratch.moveToSeconds(2);
    expect(player.seconds).toBe(2);
    expect(fixture.sources).toHaveLength(1);
    const release = scratch.end();
    fixture.advance(0.35);
    vi.advanceTimersByTime(16);
    await release;
    expect(adapter.paused).toBe(false);
    expect(player.seconds).toBeCloseTo(3.26);
  });

  it('does not replay a grain while pushing against a clamped clip edge', () => {
    const {player, advance, sources} = setup();
    player.seek(1);
    const scratch = player.beginScratch()!;
    advance(0.05);
    scratch.moveToSeconds(0.01);
    expect(sources).toHaveLength(1);
    advance(0.1);
    scratch.moveToSeconds(-1);
    const count = sources.length;
    advance(0.15);
    scratch.moveToSeconds(-2);
    scratch.moveToSeconds(-2);
    expect(sources).toHaveLength(count);
  });

  it('bounds simultaneous voices, schedules their own end, and releases all graph resources', async () => {
    const {player, sources, gains, context} = setup();
    player.seek(3);
    const scratch = player.beginScratch()!;
    for (let i = 0; i < 50; i++) scratch.moveToSeconds(3 + (i + 1) * 0.0001);
    expect(sources).toHaveLength(1);
    expect(sources.filter((s) => !vi.mocked(s.disconnect).mock.calls.length).length).toBeLessThanOrEqual(4);
    expect(sources.every((s) => vi.mocked(s.stop).mock.calls.some(([when]) => typeof when === 'number' && when <= 0.1))).toBe(true);
    await scratch.end(false);
    expect(sources.every((s) => vi.mocked(s.disconnect).mock.calls.length > 0)).toBe(true);
    expect(gains.slice(2).every((g) => vi.mocked(g.disconnect).mock.calls.length > 0)).toBe(true);
    expect(context.close).not.toHaveBeenCalled();
  });

  it.each(['pause', 'stop', 'seek', 'play'] as const)('external %s invalidates an old session and prevents stale resume', async (command) => {
    const {player, sources, advance} = setup();
    await player.play();
    const scratch = player.beginScratch()!;
    advance(0.05);
    scratch.moveToSeconds(2);
    if (command === 'seek') player.seek(5);
    else await player[command]();
    const count = sources.length;
    const position = player.seconds;
    expect(scratch.active).toBe(false);
    scratch.moveToSeconds(7);
    await scratch.end();
    expect(sources.length).toBe(count);
    expect(player.seconds).toBe(position);
    expect(player.playing).toBe(command === 'play');
  });

  it('lets an end observer seek and keep the player paused', async () => {
    const {player} = setup();
    await player.play();
    const scratch = player.beginScratch()!;
    player.once('timeupdate', () => player.seek(4));
    await scratch.end();
    expect(player.seconds).toBe(4);
    expect(player.playing).toBe(false);
  });

  it('keeps a replacement gesture started during old end notification active', async () => {
    const {player} = setup();
    await player.play();
    const scratch = player.beginScratch()!;
    let replacement: ReturnType<AudioClipPlayer['beginScratch']>;
    player.once('timeupdate', () => { replacement = player.beginScratch(); });
    await scratch.end();
    expect(replacement!.active).toBe(true);
    expect(scratch.active).toBe(false);
    expect(player.playing).toBe(false);
  });

  it('contains context-resume rejection and never sounds after canceled async preparation', async () => {
    const {player, pending, context, sources} = setup('suspended');
    const scratch = player.beginScratch()!;
    expect(context.resume).toHaveBeenCalledTimes(1);
    scratch.moveToSeconds(2);
    expect(player.seconds).toBe(2);
    expect(sources).toHaveLength(0);
    await scratch.end(false);
    pending.resolve();
    await Promise.resolve();
    scratch.moveToSeconds(3);
    expect(sources).toHaveLength(0);
    expect(player.playing).toBe(false);
  });

  it('reports active resume failure once, then releases the session', async () => {
    const {player, pending} = setup('suspended');
    const error = new Error('resume blocked');
    const onError = vi.fn();
    player.on('error', onError);
    const scratch = player.beginScratch()!;
    pending.reject(error);
    await Promise.resolve();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(error);
    expect(scratch.active).toBe(false);
    expect(player.playing).toBe(false);
  });

  it('honors a synchronous load listener canceling begin before its return', () => {
    const {player, sources} = setup();
    player.on('load', () => player.pause());
    const scratch = player.beginScratch()!;
    expect(scratch.active).toBe(false);
    scratch.moveToSeconds(2);
    expect(sources).toHaveLength(0);
  });


  it('preserves 1x motion at 120Hz and excludes a long stationary hold from velocity', () => {
    const {player, advance, sources} = setup();
    player.seek(3);
    const scratch = player.beginScratch()!;
    advance(1 / 120);
    scratch.moveToSeconds(3 + 1 / 120);
    expect(sources[0]!.playbackRate.value).toBeCloseTo(1);
    advance(10);
    scratch.moveToSeconds(3 + 1 / 120 + 0.12);
    expect(sources[1]!.playbackRate.value).toBeCloseTo(2);
  });

  it('cancels a coast when the audio context suspends, settling the promise and releasing nodes', async () => {
    const {player, advance, sources, context} = setup();
    const scratch = player.beginScratch()!;
    advance(0.05);
    scratch.moveToSeconds(2);
    const release = scratch.end();
    expect(scratch.active).toBe(true);
    Object.assign(context, {state: 'suspended'});
    vi.advanceTimersByTime(16);
    await release;
    expect(scratch.active).toBe(false);
    expect(sources[0]!.disconnect).toHaveBeenCalled();
  });

  it('disposal forces silence and settles a pending release coast', async () => {
    const {player, advance, sources} = setup();
    const scratch = player.beginScratch()!;
    advance(0.05);
    scratch.moveToSeconds(2);
    const release = scratch.end();
    player.dispose();
    await release;
    expect(sources[0]!.disconnect).toHaveBeenCalled();
    expect(scratch.active).toBe(false);
  });

  it('retires a failed grain and publishes the engine position already accepted', () => {
    const {player, advance, sources, context} = setup();
    const scratch = player.beginScratch()!;
    advance(0.05);
    scratch.moveToSeconds(2);
    const onTime = vi.fn();
    player.on('timeupdate', onTime);
    vi.mocked(context.createBuffer).mockImplementationOnce(() => { throw new Error('allocation failed'); });
    advance(0.1);
    expect(() => scratch.moveToSeconds(3)).toThrow('allocation failed');
    expect(player.seconds).toBe(3);
    expect(onTime).toHaveBeenCalledWith(expect.objectContaining({seconds: 3}));
    expect(scratch.active).toBe(false);
    expect(sources[0]!.disconnect).toHaveBeenCalled();
  });

  it('retains one native source and sample phase through a second of steady 120Hz movement', () => {
    const {player, advance, sources, buffers} = setup();
    player.seek(3);
    const scratch = player.beginScratch()!;
    for (let frame = 1; frame <= 120; frame++) {
      advance(frame / 120);
      scratch.moveToSeconds(3 + frame / 120);
    }
    expect(sources).toHaveLength(1);
    expect(buffers).toHaveLength(1);
    expect(sources[0]!.start).toHaveBeenCalledTimes(1);
    const targets = vi.mocked(sources[0]!.playbackRate.linearRampToValueAtTime).mock.calls.filter(([value]) => value > 0);
    expect(targets).toHaveLength(120);
    expect(targets.every(([value]) => Math.abs(value - 1) < 1e-8)).toBe(true);
    expect(sources[0]!.stop).toHaveBeenLastCalledWith(expect.closeTo(1.1));
  });

  it('resumes a source during its idle fade from the actual gain without an amplitude step', () => {
    const {player, advance, sources, gains} = setup();
    player.seek(3);
    const scratch = player.beginScratch()!;
    advance(0.01);
    scratch.moveToSeconds(3.01);
    advance(0.095);
    scratch.moveToSeconds(3.075);
    expect(sources).toHaveLength(1);
    expect(gains.at(-1)!.gain.setValueAtTime).toHaveBeenCalledWith(expect.closeTo(0.5), 0.095);
  });

  it('coasts a paused reverse movement to rest with analytically matched position updates', async () => {
    const {player, advance, sources} = setup();
    player.seek(5);
    const scratch = player.beginScratch()!;
    advance(0.05);
    scratch.moveToSeconds(4.9);
    const release = scratch.end();
    const repeated = scratch.end();
    expect(scratch.active).toBe(true);
    expect(player.playing).toBe(false);
    advance(0.19);
    vi.advanceTimersByTime(16);
    expect(player.seconds).toBeCloseTo(4.69);
    expect(scratch.active).toBe(true);
    advance(0.34);
    vi.advanceTimersByTime(16);
    await Promise.all([release, repeated]);
    expect(player.seconds).toBeCloseTo(4.62);
    expect(player.playing).toBe(false);
    expect(scratch.active).toBe(false);
    expect(sources.length).toBeGreaterThan(0);
  });

  it('lets a reverse coast cross zero and restore the prior forward playback rate', async () => {
    const {player, advance, sources} = setup();
    player.seek(5);
    await player.play();
    const scratch = player.beginScratch()!;
    advance(0.05);
    scratch.moveToSeconds(4.9);
    const release = scratch.end();
    for (let frame = 1; frame <= 18; frame++) {
      advance(0.05 + frame * 0.016);
      vi.advanceTimersByTime(16);
    }
    await release;
    expect(player.seconds).toBeCloseTo(4.76);
    expect(player.playing).toBe(true);
    expect(scratch.active).toBe(false);
    expect(sources.some((source) => {
      const data = source.buffer?.getChannelData(0);
      return data && data[0] > data[data.length - 1];
    })).toBe(true);
    expect(sources.at(-1)!.playbackRate.value).toBe(1);
  });

  it('does not fling after holding the pointer still through the audio watchdog', async () => {
    const {player, advance} = setup();
    await player.play();
    const scratch = player.beginScratch()!;
    advance(0.05);
    scratch.moveToSeconds(2);
    advance(0.2);
    await scratch.end();
    expect(scratch.active).toBe(false);
    expect(player.seconds).toBe(2);
    expect(player.playing).toBe(true);
  });

  it.each(['pause', 'stop', 'seek', 'play'] as const)('external %s cancels a pending coast without a stale final write', async (command) => {
    const {player, advance} = setup();
    await player.play();
    const scratch = player.beginScratch()!;
    advance(0.05);
    scratch.moveToSeconds(2);
    const release = scratch.end();
    if (command === 'seek') player.seek(6);
    else await player[command]();
    await release;
    expect(scratch.active).toBe(false);
    const accepted = player.seconds;
    vi.advanceTimersByTime(400);
    expect(player.seconds).toBe(accepted);
    expect(player.playing).toBe(command === 'play');
  });

  it('transfers original playback intent when a released coast is grabbed again', async () => {
    const {player, advance} = setup();
    await player.play();
    const old = player.beginScratch()!;
    advance(0.05);
    old.moveToSeconds(2);
    const release = old.end();
    const next = player.beginScratch()!;
    await release;
    expect(old.active).toBe(false);
    expect(next.active).toBe(true);
    expect(player.playing).toBe(false);
    next.moveToSeconds(5, false);
    await next.end();
    expect(player.playing).toBe(true);
    expect(player.seconds).toBe(5);
  });

  it('allows a move to retake the same session and settle its previous release', async () => {
    const {player, advance} = setup();
    const scratch = player.beginScratch()!;
    advance(0.05);
    scratch.moveToSeconds(2);
    const release = scratch.end();
    scratch.moveToSeconds(3, false);
    await release;
    expect(scratch.active).toBe(true);
    expect(player.seconds).toBe(3);
    vi.advanceTimersByTime(400);
    expect(player.seconds).toBe(3);
    await scratch.end(false);
  });

  it.each(['rate', 'loop'] as const)('a %s edit finishes the coast and restores the newly configured transport', async (setting) => {
    const {player, advance} = setup();
    await player.play();
    const scratch = player.beginScratch()!;
    advance(0.05);
    scratch.moveToSeconds(2);
    const release = scratch.end();
    if (setting === 'rate') player.setRate(2);
    else player.setLoop({start: 1, end: 2.1});
    await release;
    expect(scratch.active).toBe(false);
    expect(player.playing).toBe(true);
    advance(0.25);
    vi.advanceTimersByTime(400);
    expect(player.seconds).toBeCloseTo(setting === 'rate' ? 2.4 : 1.1);
  });

  it('rejects a failed coast, retires its sound and leaves accepted position observable', async () => {
    const {player, advance, context, sources} = setup();
    const scratch = player.beginScratch()!;
    advance(0.05);
    scratch.moveToSeconds(2);
    const release = scratch.end();
    vi.mocked(context.createBuffer).mockImplementationOnce(() => { throw new Error('refill failed'); });
    // A delayed delivery exhausts the old audio watchdog; restarting requires a window.
    advance(0.2);
    vi.advanceTimersByTime(16);
    await expect(release).rejects.toThrow('refill failed');
    expect(scratch.active).toBe(false);
    expect(player.playing).toBe(false);
    expect(player.seconds).toBeGreaterThan(2);
    expect(sources.every((source) => vi.mocked(source.disconnect).mock.calls.length > 0)).toBe(true);
  });

  it('crossfades the scratch and normal engine routes without automating shared user volume', async () => {
    const {player, context, advance, sources, gains} = setup('running', {volume: 0.4});
    player.seek(5);
    await player.play();
    const normalOutput = vi.mocked(sources[0]!.connect).mock.calls[0]![0] as unknown as GainNode;
    const sharedVolume = vi.mocked(normalOutput.connect).mock.calls[0]![0] as unknown as GainNode;
    const scratch = player.beginScratch()!;
    advance(0.05);
    scratch.moveToSeconds(5.1);
    const release = scratch.end();
    for (let frame = 1; frame <= 18; frame++) {
      advance(0.05 + frame * 0.016);
      vi.advanceTimersByTime(16);
    }
    await release;
    const now = context.currentTime;
    const scratchGain = gains.at(-1)!;
    expect(scratchGain.gain.linearRampToValueAtTime).toHaveBeenLastCalledWith(0, expect.closeTo(now + 0.005));
    expect(normalOutput.gain.setValueAtTime).toHaveBeenLastCalledWith(0, now);
    expect(normalOutput.gain.linearRampToValueAtTime).toHaveBeenLastCalledWith(1, now + 0.005);
    expect(sharedVolume.gain.value).toBe(0.4);
    expect(sharedVolume.gain.cancelScheduledValues).not.toHaveBeenCalled();
    expect(sharedVolume.gain.linearRampToValueAtTime).not.toHaveBeenCalled();
    expect(player.playing).toBe(true);
    // An external command cancels the private fade, so a subsequent ordinary
    // start cannot inherit zero gain or an obsolete scheduled envelope.
    player.pause();
    expect(normalOutput.gain.cancelScheduledValues).toHaveBeenLastCalledWith(now);
    expect(normalOutput.gain.setValueAtTime).toHaveBeenLastCalledWith(1, now);
    const rampCount = vi.mocked(normalOutput.gain.linearRampToValueAtTime).mock.calls.length;
    await player.play();
    expect(normalOutput.gain.linearRampToValueAtTime).toHaveBeenCalledTimes(rampCount);
  });

  it('disposal stops active grains and makes future sessions unavailable', async () => {
    const {player, sources, advance} = setup();
    const scratch = player.beginScratch()!;
    advance(0.05);
    scratch.moveToSeconds(2);
    player.dispose();
    expect(sources[0]!.disconnect).toHaveBeenCalled();
    expect(scratch.active).toBe(false);
    expect(player.beginScratch()).toBeUndefined();
    await scratch.end();
    expect(player.playing).toBe(false);
  });
});
