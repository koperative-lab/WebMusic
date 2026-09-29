import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {createAudioClip} from '../../src/core';
import {AudioMixer, createAudioMixer} from '../../src/play/headless/mixer';
import {AudioClipPlayer, type PlayerLike} from '../../src/play/headless/player';

// ---------------------------------------------------------------------------
// A fake PlayerLike that records transport calls and the most recent volume.
// The mixer's gain math (mute / solo / per-member × master) routes through
// `setVolume`, so we can verify the scheduling logic with no AudioContext.
// ---------------------------------------------------------------------------

function fakePlayer() {
  const calls: string[] = [];
  let endListener: (() => void) | null = null;
  const player: PlayerLike & {volume: number; calls: string[]; setVolume(value: number): void; fireEnd(): void} = {
    volume: 1,
    calls,
    play() {
      calls.push('play');
    },
    pause() {
      calls.push('pause');
    },
    stop() {
      calls.push('stop');
    },
    seek(seconds: number) {
      calls.push(`seek:${seconds}`);
    },
    setVolume(v: number) {
      this.volume = v;
    },
    on(event: string, listener: (data: unknown) => void) {
      if (event === 'end') endListener = listener as () => void;
      return () => {
        if (event === 'end') endListener = null;
      };
    },
    dispose() {
      calls.push('dispose');
    },
    fireEnd() {
      endListener?.();
    },
  };
  return player;
}

describe('AudioMixer scheduling', () => {
  it('createAudioMixer builds an AudioMixer', () => {
    expect(createAudioMixer()).toBeInstanceOf(AudioMixer);
  });

  it('accepts structural PlayerLike members and tracks ids', () => {
    const mixer = new AudioMixer();
    mixer.add({id: 'drums', player: fakePlayer()});
    mixer.add({id: 'bass', player: fakePlayer()});
    expect(mixer.ids()).toEqual(['drums', 'bass']);
  });

  it('fans transport commands out to every member', () => {
    const drums = fakePlayer();
    const bass = fakePlayer();
    const mixer = new AudioMixer();
    mixer.add({id: 'drums', player: drums});
    mixer.add({id: 'bass', player: bass});

    mixer.pause();
    mixer.stop();
    mixer.seek(12.5);

    expect(drums.calls).toContain('pause');
    expect(drums.calls).toContain('stop');
    expect(drums.calls).toContain('seek:12.5');
    expect(bass.calls).toContain('seek:12.5');
  });

  it('retracts started members when one start fails', async () => {
    const {ctx} = driftingContext();
    let running = false;
    const healthy = {
      ...fakePlayer(),
      get playing() { return running; },
      play() { running = true; },
      pause() { running = false; },
    };
    const broken = {...fakePlayer(), play() { throw new Error('start failed'); }};
    const mixer = new AudioMixer({audioContext: ctx});
    mixer.add({id: 'healthy', player: healthy});
    mixer.add({id: 'broken', player: broken});

    await expect(mixer.play()).rejects.toThrow('start failed');
    expect(healthy.playing).toBe(false);
    expect(mixer.playing).toBe(false);
    mixer.dispose();
  });

  it('retracts a late async start after a sibling rejects', async () => {
    const {ctx} = driftingContext();
    let running = false;
    let finishStart!: () => void;
    const late = {
      ...fakePlayer(),
      get playing() { return running; },
      play() {
        return new Promise<void>((resolve) => {
          finishStart = () => { running = true; resolve(); };
        });
      },
      pause() { running = false; },
    };
    const broken = {...fakePlayer(), play() { throw new Error('start failed'); }};
    const mixer = new AudioMixer({audioContext: ctx});
    mixer.add({id: 'late', player: late});
    mixer.add({id: 'broken', player: broken});

    await expect(mixer.play()).rejects.toThrow('start failed');
    finishStart();
    await vi.waitFor(() => expect(late.playing).toBe(false));
    expect(mixer.playing).toBe(false);
    mixer.dispose();
  });

  it('applies per-member volume scaled by master volume', () => {
    const drums = fakePlayer();
    const mixer = new AudioMixer({masterVolume: 0.5});
    mixer.add({id: 'drums', player: drums, volume: 0.8});
    // applyGains runs on add(): 0.8 × 0.5 = 0.4
    expect(drums.volume).toBeCloseTo(0.4, 6);

    mixer.setMasterVolume(1);
    expect(drums.volume).toBeCloseTo(0.8, 6);

    mixer.setVolume('drums', 0.25);
    expect(drums.volume).toBeCloseTo(0.25, 6);
  });

  it('mute drives a member to zero gain and unmute restores it', () => {
    const drums = fakePlayer();
    const mixer = new AudioMixer();
    mixer.add({id: 'drums', player: drums, volume: 0.9});
    mixer.mute('drums');
    expect(drums.volume).toBe(0);
    mixer.unmute('drums');
    expect(drums.volume).toBeCloseTo(0.9, 6);
  });

  it('solo silences every non-soloed member', () => {
    const drums = fakePlayer();
    const bass = fakePlayer();
    const mixer = new AudioMixer();
    mixer.add({id: 'drums', player: drums, volume: 1});
    mixer.add({id: 'bass', player: bass, volume: 1});

    mixer.solo('drums');
    expect(drums.volume).toBeCloseTo(1, 6);
    expect(bass.volume).toBe(0);

    mixer.solo(null);
    expect(bass.volume).toBeCloseTo(1, 6);
  });

  it('emits memberEnd per member and end once all members finish', () => {
    const drums = fakePlayer();
    const bass = fakePlayer();
    const mixer = new AudioMixer();
    mixer.add({id: 'drums', player: drums});
    mixer.add({id: 'bass', player: bass});

    const memberEnds: string[] = [];
    let ended = 0;
    mixer.on('memberEnd', (d) => memberEnds.push(d.id));
    mixer.on('end', () => (ended += 1));

    drums.fireEnd();
    expect(memberEnds).toEqual(['drums']);
    expect(ended).toBe(0);

    bass.fireEnd();
    expect(memberEnds).toEqual(['drums', 'bass']);
    expect(ended).toBe(1);
  });

  it('does not dispose externally-owned players on remove', () => {
    const drums = fakePlayer();
    const mixer = new AudioMixer();
    mixer.add({id: 'drums', player: drums});
    mixer.remove('drums');
    expect(drums.calls).not.toContain('dispose');
    expect(mixer.ids()).toEqual([]);
  });

  it('readding the same id replaces the previous member', () => {
    const first = fakePlayer();
    const second = fakePlayer();
    const mixer = new AudioMixer();
    mixer.add({id: 'vox', player: first});
    mixer.add({id: 'vox', player: second});
    expect(mixer.ids()).toEqual(['vox']);
  });

  it('keeps an existing member when its replacement has no player or clip', () => {
    const first = fakePlayer();
    const mixer = new AudioMixer();
    const ended: string[] = [];
    mixer.on('memberEnd', ({id}) => ended.push(id));
    mixer.add({id: 'vox', player: first});

    expect(() => mixer.add({id: 'vox'})).toThrow(/needs either a clip or a player/);

    expect(mixer.ids()).toEqual(['vox']);
    first.fireEnd();
    expect(ended).toEqual(['vox']);
    expect(first.calls).not.toContain('dispose');
  });

  it('keeps an existing member when a candidate subscription fails', () => {
    const first = fakePlayer();
    const broken = {...fakePlayer(), on: () => {throw new Error('subscribe failed');}} as PlayerLike;
    const mixer = new AudioMixer();
    mixer.add({id: 'vox', player: first});

    expect(() => mixer.add({id: 'vox', player: broken})).toThrow('subscribe failed');
    expect(mixer.ids()).toEqual(['vox']);
    mixer.pause();
    expect(first.calls).toContain('pause');
  });

  it('keeps the end subscription when the same player is added again', () => {
    const first = fakePlayer();
    const mixer = new AudioMixer();
    const ended: string[] = [];
    mixer.on('memberEnd', ({id}) => ended.push(id));
    mixer.add({id: 'vox', player: first});
    mixer.add({id: 'vox', player: first, volume: 0.5});

    first.fireEnd();
    expect(ended).toEqual(['vox']);
    expect(first.volume).toBe(0.5);
  });

  it('unsubscribes an external player when the member is removed', () => {
    const drums = fakePlayer();
    const mixer = new AudioMixer();
    const memberEnds: string[] = [];
    mixer.on('memberEnd', ({id}) => memberEnds.push(id));
    mixer.add({id: 'drums', player: drums});

    mixer.remove('drums');
    drums.fireEnd();

    expect(memberEnds).toEqual([]);
    expect(drums.calls).not.toContain('dispose');
  });

  it('unsubscribes external players on dispose without disposing them', () => {
    const drums = fakePlayer();
    const mixer = new AudioMixer();
    const memberEnds: string[] = [];
    mixer.on('memberEnd', ({id}) => memberEnds.push(id));
    mixer.add({id: 'drums', player: drums});

    mixer.dispose();
    drums.fireEnd();

    expect(memberEnds).toEqual([]);
    expect(drums.calls).not.toContain('dispose');
  });

  it('counts each member end only once per playback cycle', () => {
    const drums = fakePlayer();
    const bass = fakePlayer();
    const mixer = new AudioMixer();
    mixer.add({id: 'drums', player: drums});
    mixer.add({id: 'bass', player: bass});
    let ended = 0;
    mixer.on('end', () => ended++);

    drums.fireEnd();
    drums.fireEnd();
    expect(ended).toBe(0);
    bass.fireEnd();
    expect(ended).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Stem alignment for schedulable members on a compatible AudioContext:
// hand each one the same future reference time instead of anchoring each at
// a different time during its own start call.
// ---------------------------------------------------------------------------

/** Fake context whose clock advances on every read, exposing per-call anchoring. */
function driftingContext() {
  const node = () => ({connect: vi.fn(), disconnect: vi.fn()});
  const starts: number[] = [];
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
      start: vi.fn((at: number) => starts.push(at)),
      stop: vi.fn(),
    }),
  };
  // Every read advances the clock, the way real per-member start work does.
  // The step stays well inside the mixer's scheduling lead, so what the test
  // measures is whether the members share one anchor — not whether the lead is
  // large enough to absorb an implausibly slow start.
  let now = 0;
  Object.defineProperty(ctx, 'currentTime', {
    get() {
      now += 0.001;
      return now;
    },
  });
  return {ctx: ctx as AudioContext, starts};
}

describe('AudioMixer stem alignment', () => {
  it('starts every member on one shared audio-clock instant', async () => {
    const {ctx, starts} = driftingContext();
    const mixer = new AudioMixer({audioContext: ctx});
    for (const id of ['drums', 'bass', 'vocal']) {
      mixer.add({
        id,
        clip: createAudioClip({sampleRate: 1_000, channelData: [new Float32Array(2_000)]}),
      });
    }

    await mixer.play();

    // Three sources started, all at the SAME `when` — the clock kept moving
    // between the calls, so per-call anchoring would have spread them out.
    expect(starts).toHaveLength(3);
    expect(new Set(starts).size).toBe(1);
  });

  it('re-aligns the members when seeking during playback', async () => {
    const {ctx, starts} = driftingContext();
    const mixer = new AudioMixer({audioContext: ctx});
    for (const id of ['drums', 'bass']) {
      mixer.add({
        id,
        clip: createAudioClip({sampleRate: 1_000, channelData: [new Float32Array(4_000)]}),
      });
    }

    await mixer.play();
    starts.length = 0;
    mixer.seek(1);
    await Promise.resolve();
    await Promise.resolve();

    expect(starts).toHaveLength(2);
    expect(new Set(starts).size).toBe(1);
  });
});

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((onResolve) => { resolve = onResolve; });
  return {promise, resolve};
}

describe('AudioMixer asynchronous transitions', () => {
  const mixers: AudioMixer[] = [];
  function makeMixer() {
    const {ctx, starts} = driftingContext();
    const mixer = new AudioMixer({audioContext: ctx});
    mixers.push(mixer);
    mixer.add({id: 'a', clip: createAudioClip({sampleRate: 1000, channelData: [new Float32Array(4000)]})});
    return {mixer, ctx, starts};
  }
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    for (const mixer of mixers.splice(0)) mixer.dispose();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it.each(['pause', 'stop', 'dispose'] as const)('cancels a pending play when %s arrives during preload', async (operation) => {
    const {mixer, starts} = makeMixer();
    const warming = deferred();
    vi.spyOn(AudioClipPlayer.prototype, 'preload').mockImplementationOnce(() => warming.promise);
    const pending = mixer.play();
    mixer[operation]();
    warming.resolve();
    await pending;
    expect(starts).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['pause', 'stop', 'dispose'] as const)('cancels the restart from seek when %s arrives during preload', async (operation) => {
    const {mixer, starts} = makeMixer();
    await mixer.play();
    const warming = deferred();
    vi.spyOn(AudioClipPlayer.prototype, 'preload').mockImplementationOnce(() => warming.promise);
    mixer.seek(1);
    mixer[operation]();
    warming.resolve();
    await vi.runAllTimersAsync();
    expect(starts).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cancels a start while AudioContext.resume is pending', async () => {
    const {mixer, ctx, starts} = makeMixer();
    const resumed = deferred();
    Object.defineProperty(ctx, 'state', {value: 'suspended'});
    vi.spyOn(ctx, 'resume').mockImplementation(() => resumed.promise);
    const pending = mixer.play();
    mixer.stop();
    resumed.resolve();
    await pending;
    expect(starts).toHaveLength(0);
  });

  it('keeps a newer play after stop while discarding the older pending play', async () => {
    const {mixer, starts} = makeMixer();
    const warming = deferred();
    vi.spyOn(AudioClipPlayer.prototype, 'preload').mockImplementationOnce(() => warming.promise);
    const oldPlay = mixer.play();
    mixer.stop();
    await mixer.play();
    warming.resolve();
    await oldPlay;
    expect(starts).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(1);
  });

  it('does not start a member removed or replaced during preload', async () => {
    const {mixer, starts} = makeMixer();
    const warming = deferred();
    vi.spyOn(AudioClipPlayer.prototype, 'preload').mockImplementationOnce(() => warming.promise);
    const remaining = fakePlayer();
    mixer.add({id: 'b', player: remaining});
    const pending = mixer.play();
    mixer.remove('a');
    const replacement = fakePlayer();
    mixer.add({id: 'a', player: replacement});
    warming.resolve();
    await pending;
    expect(starts).toHaveLength(0);
    expect(remaining.calls).toContain('play');
    expect(replacement.calls).not.toContain('play');
  });

  it.each(['pause', 'stop'] as const)('reapplies %s when a structural player finishes starting late', async (operation) => {
    const {ctx} = driftingContext();
    const started = deferred();
    const entering = deferred();
    let sounding = false;
    const player = fakePlayer();
    player.play = vi.fn(async () => {
      entering.resolve();
      await started.promise;
      sounding = true;
    });
    player.pause = () => { sounding = false; };
    player.stop = () => { sounding = false; };
    const mixer = new AudioMixer({audioContext: ctx});
    mixers.push(mixer);
    mixer.add({id: 'external', player});
    const pending = mixer.play();
    await entering.promise;
    expect(player.play).toHaveBeenCalledTimes(1);
    mixer[operation]();
    started.resolve();
    await pending;
    expect(sounding).toBe(false);
  });

  it('honors a stop called reentrantly by a member load listener', async () => {
    const {ctx, starts} = driftingContext();
    const mixer = new AudioMixer({audioContext: ctx});
    mixers.push(mixer);
    const player = new AudioClipPlayer(createAudioClip({sampleRate: 1000, channelData: [new Float32Array(1000)]}), {audioContext: ctx});
    player.on('load', () => mixer.stop());
    mixer.add({id: 'a', player});
    try {
      await mixer.play();
      expect(starts).toHaveLength(0);
    } finally {
      player.dispose();
    }
  });
});


describe('AudioMixer authoritative mix state and cleanup', () => {
  it('publishes frozen snapshots and notifies all attached readers', () => {
    const mixer = new AudioMixer({masterVolume: 0.5});
    const player = fakePlayer();
    const first = vi.fn();
    const second = vi.fn();
    const off = mixer.on('change', first);
    mixer.on('change', second);
    mixer.add({id: 'a', player, volume: 0.4});
    const before = mixer.snapshot();
    expect(before).toEqual({masterVolume: 0.5, soloId: null, members: [
      {id: 'a', volume: 0.4, muted: false, solo: false, effectiveVolume: 0.2},
    ]});
    expect(Object.isFrozen(before)).toBe(true);
    expect(Object.isFrozen(before.members)).toBe(true);
    expect(Object.isFrozen(before.members[0])).toBe(true);
    mixer.mute('a');
    expect(mixer.snapshot().members[0]?.effectiveVolume).toBe(0);
    expect(before.members[0]?.muted).toBe(false);
    expect(first).toHaveBeenCalledTimes(2);
    expect(second).toHaveBeenCalledTimes(2);
    off();
    mixer.setMasterVolume(0.8);
    expect(first).toHaveBeenCalledTimes(2);
    expect(second).toHaveBeenCalledTimes(3);
    mixer.dispose();
  });

  it('keeps other snapshot readers informed when a change listener throws', () => {
    const mixer = new AudioMixer();
    mixer.on('change', () => { throw new Error('presenter failed'); });
    const states: number[] = [];
    mixer.on('change', () => states.push(mixer.snapshot().masterVolume));
    const errors = vi.fn();
    mixer.on('error', errors);
    expect(() => mixer.setMasterVolume(0.4)).not.toThrow();
    expect(states).toEqual([0.4]);
    expect(errors).toHaveBeenCalledTimes(1);
    mixer.dispose();
  });

  it('restores non-muted members when the solo member is removed', () => {
    const mixer = new AudioMixer({masterVolume: 0.5});
    const a = fakePlayer();
    const b = fakePlayer();
    const c = fakePlayer();
    mixer.add({id: 'a', player: a}).add({id: 'b', player: b, volume: 0.4})
      .add({id: 'c', player: c});
    mixer.mute('c');
    mixer.solo('a');
    mixer.remove('a');
    expect(mixer.snapshot().soloId).toBeNull();
    expect(b.volume).toBe(0.2);
    expect(c.volume).toBe(0);
    mixer.dispose();
  });

  it('lets a newer command from a gain callback supersede the old gain pass', () => {
    const mixer = new AudioMixer();
    const a = fakePlayer();
    const b = fakePlayer();
    mixer.add({id: 'a', player: a}).add({id: 'b', player: b});
    const setVolume = a.setVolume;
    let reenter = true;
    a.setVolume = (value) => {
      setVolume.call(a, value);
      if (reenter) { reenter = false; mixer.setMasterVolume(0.25); }
    };
    const observed: number[] = [];
    mixer.on('change', () => observed.push(mixer.snapshot().masterVolume));
    mixer.setMasterVolume(0.5);
    expect(a.volume).toBe(0.25);
    expect(b.volume).toBe(0.25);
    expect(observed).toEqual([0.25]);
    mixer.dispose();
  });

  it('keeps a reentrant replacement and ignores the removed member end callback', () => {
    const mixer = new AudioMixer();
    const replacement = fakePlayer();
    let oldEnd: (() => void) | undefined;
    const first = {...fakePlayer(), on(_event: string, listener: (data: unknown) => void) {
      oldEnd = () => listener(undefined);
      return () => { mixer.add({id: 'a', player: replacement, volume: 0.3}); };
    }};
    mixer.add({id: 'a', player: first});
    mixer.add({id: 'a', player: fakePlayer(), volume: 0.7});
    expect(mixer.snapshot().members[0]?.volume).toBe(0.3);
    const ended = vi.fn();
    mixer.on('memberEnd', ended);
    oldEnd?.();
    expect(ended).not.toHaveBeenCalled();
    replacement.fireEnd();
    expect(ended).toHaveBeenCalledTimes(1);
    mixer.dispose();
  });

  it('finishes removal and gain restoration when unsubscription throws', () => {
    const mixer = new AudioMixer();
    const broken = {...fakePlayer(), on() { return () => { throw new Error('off failed'); }; }};
    const remaining = fakePlayer();
    mixer.add({id: 'a', player: broken}).add({id: 'b', player: remaining});
    mixer.solo('a');
    expect(() => mixer.remove('a')).toThrow('off failed');
    expect(mixer.ids()).toEqual(['b']);
    expect(remaining.volume).toBe(1);
    expect(() => mixer.remove('a')).not.toThrow();
    mixer.dispose();
  });

  it('releases later subscriptions, owned players and context after cleanup errors', () => {
    const {ctx} = driftingContext();
    vi.stubGlobal('AudioContext', function AudioContext() { return ctx; });
    const disposePlayer = vi.spyOn(AudioClipPlayer.prototype, 'dispose').mockImplementation(() => {
      throw new Error('player cleanup failed');
    });
    const nextOff = vi.fn();
    const mixer = new AudioMixer();
    try {
      mixer.add({id: 'broken', player: {...fakePlayer(), on() {
        return () => { throw new Error('off failed'); };
      }}});
      mixer.add({id: 'owned', clip: createAudioClip({sampleRate: 1000, channelData: [new Float32Array(1000)]})});
      mixer.add({id: 'next', player: {...fakePlayer(), on() { return nextOff; }}});
      expect(() => mixer.dispose()).toThrow('off failed');
      expect(nextOff).toHaveBeenCalledTimes(1);
      expect(disposePlayer).toHaveBeenCalledTimes(1);
      expect(ctx.close).toHaveBeenCalledTimes(1);
      expect(mixer.ids()).toEqual([]);
      expect(() => mixer.dispose()).not.toThrow();
      expect(nextOff).toHaveBeenCalledTimes(1);
    } finally {
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
    }
  });

  it('lets a nested seek supersede the remaining paused-member writes', () => {
    const mixer = new AudioMixer();
    const a = fakePlayer();
    const b = fakePlayer();
    mixer.add({id: 'a', player: a}).add({id: 'b', player: b});
    let reenter = true;
    a.seek = (seconds) => {
      a.calls.push(`seek:${seconds}`);
      if (reenter) { reenter = false; mixer.seek(2); }
    };
    mixer.seek(1);
    expect(a.calls).toEqual(['seek:1', 'seek:2']);
    expect(b.calls).toEqual(['seek:2']);
    mixer.dispose();
  });

  it.each(['pause', 'stop'] as const)('does not continue %s after a member issues a newer group play', async (operation) => {
    const {ctx} = driftingContext();
    const mixer = new AudioMixer({audioContext: ctx});
    const a = fakePlayer();
    const b = fakePlayer();
    mixer.add({id: 'a', player: a}).add({id: 'b', player: b});
    let newerPlay: Promise<void> | undefined;
    a[operation] = () => { newerPlay = mixer.play(); };
    mixer[operation]();
    await newerPlay;
    expect(b.calls).not.toContain(operation);
    expect(b.calls).toContain('play');
    mixer.dispose();
  });

  it('does not report old completion after a memberEnd listener stops the group', () => {
    const mixer = new AudioMixer();
    const member = fakePlayer();
    mixer.add({id: 'a', player: member});
    mixer.on('memberEnd', () => mixer.stop());
    const ended = vi.fn();
    mixer.on('end', ended);
    member.fireEnd();
    expect(ended).not.toHaveBeenCalled();
    mixer.dispose();
  });
});

describe('AudioMixer naturally ended stem re-entry', () => {
  function statefulPlayer(duration: number) {
    const player = {...fakePlayer(), duration, playing: false};
    player.play = () => { player.playing = true; player.calls.push('play'); };
    player.pause = () => { player.playing = false; player.calls.push('pause'); };
    player.stop = () => { player.playing = false; player.calls.push('stop'); };
    return player;
  }

  it('rejoins an ended short stem on backward seek, preserving independently paused members', async () => {
    const {ctx} = driftingContext();
    const mixer = new AudioMixer({audioContext: ctx});
    const short = statefulPlayer(1);
    const long = statefulPlayer(4);
    const paused = statefulPlayer(4);
    mixer.add({id: 'short', player: short}).add({id: 'long', player: long})
      .add({id: 'paused', player: paused});
    const ended: string[] = [];
    mixer.on('memberEnd', ({id}) => ended.push(id));
    await mixer.play();
    short.playing = false;
    short.fireEnd();
    paused.pause();
    mixer.seek(0.25);
    await Promise.resolve();
    await Promise.resolve();
    expect(short.playing).toBe(true);
    expect(long.playing).toBe(true);
    expect(paused.playing).toBe(false);
    short.playing = false;
    short.fireEnd();
    expect(ended).toEqual(['short', 'short']);
    mixer.dispose();
  });

  it('does not resume an ended stem beyond its end or after the group is paused', async () => {
    const {ctx} = driftingContext();
    const mixer = new AudioMixer({audioContext: ctx});
    const short = statefulPlayer(1);
    const long = statefulPlayer(4);
    mixer.add({id: 'short', player: short}).add({id: 'long', player: long});
    await mixer.play();
    short.playing = false;
    short.fireEnd();
    mixer.seek(2);
    await Promise.resolve();
    await Promise.resolve();
    expect(short.playing).toBe(false);
    mixer.pause();
    mixer.seek(0.25);
    await Promise.resolve();
    expect(short.playing).toBe(false);
    expect(long.playing).toBe(false);
    mixer.dispose();
  });
});
