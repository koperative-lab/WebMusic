import {afterEach, describe, expect, it, vi, type MockedFunction} from 'vitest';
import {Duration, MeasureId, PartId, Pitch, Rational, ScoreBuilder, VoiceId} from '../../src/core';
import {
  Effect,
  InteractivePlayer,
  Rack,
  ScorePlayer,
  type HeadlessSynth,
} from '../../src/play/headless';

function score() {
  const builder = new ScoreBuilder();
  const part = builder.addPart({id: PartId('p'), name: 'Part'});
  builder.addMeasure({
    id: MeasureId('m1'),
    number: 1,
    onsetQuarters: Rational.ZERO,
    durationQuarters: new Rational(4),
    timeSignature: {numerator: 4, denominator: 4},
  });
  builder.addNote(part, {
    id: builder.newNoteId(),
    voice: VoiceId('v'),
    pitch: Pitch.parse('C4'),
    onsetQuarters: Rational.ZERO,
    duration: Duration.quarter(),
  });
  return builder.build();
}

interface FakeNode extends AudioNode {
  gain: AudioParam;
  pan: AudioParam;
  connect: MockedFunction<AudioNode['connect']>;
  disconnect: MockedFunction<AudioNode['disconnect']>;
  kind: string;
}

function fakeAudioContext(options: {
  state?: AudioContextState;
  resume?: () => Promise<void>;
} = {}) {
  let state = options.state ?? 'running';
  const nodes: FakeNode[] = [];
  const close = vi.fn(async () => {
    state = 'closed';
  });
  const resume = vi.fn(async () => {
    await options.resume?.();
    state = 'running';
  });
  const context = {} as AudioContext;
  const param = (): AudioParam => ({
    value: 1,
    setValueAtTime: vi.fn(),
    exponentialRampToValueAtTime: vi.fn(),
    setTargetAtTime: vi.fn(),
    cancelScheduledValues: vi.fn(),
    cancelAndHoldAtTime: vi.fn(),
  }) as unknown as AudioParam;
  const node = (kind: string): FakeNode => {
    const candidate = {
      context,
      kind,
      gain: param(),
      pan: param(),
      connect: vi.fn((destination: AudioNode) => {
        if (destination.context && destination.context !== context) {
          throw new Error('cross-context edge');
        }
        return destination;
      }),
      disconnect: vi.fn(),
    } as unknown as FakeNode;
    nodes.push(candidate);
    return candidate;
  };
  const destination = node('destination');
  const createGain = vi.fn(() => node('gain'));
  Object.assign(context, {
    currentTime: 0,
    sampleRate: 44100,
    destination,
    createGain,
    createStereoPanner: vi.fn(() => node('panner')),
    createBuffer: vi.fn((channels: number, length: number) => ({
      numberOfChannels: channels,
      getChannelData: () => new Float32Array(length),
    })),
    createConvolver: vi.fn(() => ({...node('convolver'), buffer: null})),
    resume,
    close,
  });
  Object.defineProperty(context, 'state', {
    configurable: true,
    get: () => state,
  });
  return {
    context,
    destination,
    nodes,
    createGain,
    close,
    resume,
    setState: (next: AudioContextState) => {
      state = next;
    },
  };
}

function synth(connect: HeadlessSynth['connect'] = vi.fn(() => vi.fn())): HeadlessSynth {
  return {connect, noteOn: vi.fn(), noteOff: vi.fn()};
}

function installAudioContextFactory(created: ReturnType<typeof fakeAudioContext>[]) {
  const AudioContextFactory = vi.fn(function AudioContextFactory() {
    const audio = fakeAudioContext();
    created.push(audio);
    return audio.context;
  });
  vi.stubGlobal('AudioContext', AudioContextFactory);
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('live AudioContext identity and graph transactions', () => {
  it('derives ScorePlayer, Rack, and InteractivePlayer context from destination.context', () => {
    const audio = fakeAudioContext();
    const scorePlayer = new ScorePlayer(score(), {destination: audio.destination, synth: synth()});
    const rack = new Rack({destination: audio.destination});
    const interactive = new InteractivePlayer({destination: audio.destination});
    interactive.addVoice('main', synth());

    expect(scorePlayer.context).toBe(audio.context);
    expect(rack.context).toBe(audio.context);
    expect(interactive.context).toBe(audio.context);

    scorePlayer.dispose();
    rack.dispose();
    interactive.dispose();
    expect(audio.close).not.toHaveBeenCalled();
  });

  it.each([
    ['ScorePlayer', (context: AudioContext, destination: AudioNode) =>
      new ScorePlayer(score(), {audioContext: context, destination, synth: synth()}).context],
    ['Rack', (context: AudioContext, destination: AudioNode) =>
      new Rack({audioContext: context, destination}).context],
    ['InteractivePlayer', (context: AudioContext, destination: AudioNode) => {
      const player = new InteractivePlayer({audioContext: context, destination});
      player.addVoice('main', synth());
      return player.context;
    }],
  ] as const)('rejects a mismatched context before %s allocates nodes', (_name, build) => {
    const explicit = fakeAudioContext();
    const external = fakeAudioContext();

    expect(() => build(explicit.context, external.destination)).toThrow(/same AudioContext/);
    expect(explicit.createGain).not.toHaveBeenCalled();
  });

  it('rejects closed and offline contexts before allocating a live graph', () => {
    const closed = fakeAudioContext({state: 'closed'});
    expect(() => new ScorePlayer(score(), {
      audioContext: closed.context,
      synth: synth(),
    }).context).toThrow(/closed/);
    expect(closed.createGain).not.toHaveBeenCalled();

    const offline = fakeAudioContext();
    Object.assign(offline.context, {startRendering: vi.fn()});
    expect(() => new Rack({audioContext: offline.context}).context).toThrow(/OfflineAudioContext/);
    expect(offline.createGain).not.toHaveBeenCalled();
  });

  it('best-effort closes a self-created context rejected by live validation', () => {
    const audio = fakeAudioContext({state: 'closed'});
    const AudioContextFactory = vi.fn(function AudioContextFactory() {
      return audio.context;
    });
    vi.stubGlobal('AudioContext', AudioContextFactory);

    expect(() => new ScorePlayer(score(), {synth: synth()}).context).toThrow(/closed/);
    expect(audio.close).toHaveBeenCalledTimes(1);
    expect(audio.createGain).not.toHaveBeenCalled();
  });

  it('closes every self-created ScorePlayer context after synth route construction fails', () => {
    const created: ReturnType<typeof fakeAudioContext>[] = [];
    installAudioContextFactory(created);
    const player = new ScorePlayer(score(), {
      synth: synth(() => {
        throw new Error('connect failed');
      }),
    });

    expect(() => player.context).toThrow('connect failed');
    expect(() => player.context).toThrow('connect failed');
    expect(created).toHaveLength(2);
    expect(created.every((audio) => audio.close.mock.calls.length === 1)).toBe(true);
    player.dispose();
  });

  it('rolls back instead of resurrecting a ScorePlayer disposed inside synth.connect', () => {
    const audio = fakeAudioContext();
    const AudioContextFactory = vi.fn(function AudioContextFactory() {
      return audio.context;
    });
    vi.stubGlobal('AudioContext', AudioContextFactory);
    const routeCleanup = vi.fn();
    const backend = synth(() => {
      player.dispose();
      return routeCleanup;
    });
    const player = new ScorePlayer(score(), {synth: backend});

    expect(() => player.context).toThrow(/disposed during audio graph construction/);
    expect(routeCleanup).toHaveBeenCalledOnce();
    expect(audio.close).toHaveBeenCalledOnce();
    expect(() => player.context).toThrow(/has been disposed/);
  });

  it('resumes an interrupted live ScorePlayer context before playback', async () => {
    const audio = fakeAudioContext();
    audio.setState('interrupted' as AudioContextState);
    const player = new ScorePlayer(score(), {audioContext: audio.context, synth: synth()});

    await player.play();

    expect(audio.resume).toHaveBeenCalledOnce();
    expect(player.isPlaying()).toBe(true);
    player.dispose();
  });

  it('rolls back Rack and InteractivePlayer graphs and closes their owned contexts', () => {
    const rackContexts: ReturnType<typeof fakeAudioContext>[] = [];
    installAudioContextFactory(rackContexts);
    const rack = new Rack({effect: Effect.custom(() => {
      throw new Error('rack effect failed');
    })});
    expect(() => rack.context).toThrow('rack effect failed');
    expect(rackContexts[0].close).toHaveBeenCalledTimes(1);

    const interactiveContexts: ReturnType<typeof fakeAudioContext>[] = [];
    installAudioContextFactory(interactiveContexts);
    const interactive = new InteractivePlayer();
    interactive.addVoice('main', synth(() => {
      throw new Error('voice connect failed');
    }));
    expect(() => interactive.context).toThrow('voice connect failed');
    expect(interactiveContexts[0].close).toHaveBeenCalledTimes(1);
  });

  it('rolls back an Interactive voice removed reentrantly inside synth.connect', () => {
    const audio = fakeAudioContext();
    const routeCleanup = vi.fn();
    const backend = synth(() => {
      player.removeVoice('main');
      return routeCleanup;
    });
    const player = new InteractivePlayer({audioContext: audio.context});
    player.addVoice('main', backend);

    expect(() => player.context).toThrow(/voices changed during audio graph construction/);
    expect(routeCleanup).toHaveBeenCalledOnce();
    expect(player.listVoices()).toEqual([]);
    player.dispose();
  });

  it('rolls back a Rack member removed reentrantly inside synth.connect', () => {
    const audio = fakeAudioContext();
    const routeCleanup = vi.fn();
    const backend = synth(() => {
      rack.remove('main');
      return routeCleanup;
    });
    const rack = new Rack({audioContext: audio.context});
    rack.add({id: 'main', score: score(), sound: backend});

    expect(() => rack.context).toThrow(/members changed during audio graph construction/);
    expect(routeCleanup).toHaveBeenCalledOnce();
    expect(rack.list()).toEqual([]);
    rack.dispose();
  });

  it('removes the direct panner-to-destination route on normal ScorePlayer disposal', () => {
    const audio = fakeAudioContext();
    const player = new ScorePlayer(score(), {audioContext: audio.context, synth: synth()});
    void player.context;
    const panner = audio.nodes.find((node) => node.kind === 'panner');
    if (!panner) throw new Error('expected panner');

    player.dispose();

    expect(panner.disconnect).toHaveBeenCalledWith(audio.destination);
  });

  it('fails closed on a suspended InteractivePlayer until preload resumes it', async () => {
    const denial = new Error('autoplay denied');
    const audio = fakeAudioContext({state: 'suspended', resume: async () => {
      throw denial;
    }});
    const backend = synth();
    const player = new InteractivePlayer({audioContext: audio.context});
    player.addVoice('main', backend);

    expect(() => player.noteOn('main', 60)).toThrow(/Await InteractivePlayer\.preload/);
    expect(backend.noteOn).not.toHaveBeenCalled();
    await expect(player.preload()).rejects.toBe(denial);
    expect(audio.resume).toHaveBeenCalledTimes(1);
    expect(backend.noteOn).not.toHaveBeenCalled();
    player.dispose();
  });

  it('does not enter playing when the context closes during async preparation', async () => {
    const audio = fakeAudioContext();
    let finish!: () => void;
    const loading = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const backend = {
      ...synth(),
      preload: vi.fn(() => loading),
    } satisfies HeadlessSynth & {preload: () => Promise<void>};
    const player = new ScorePlayer(score(), {audioContext: audio.context, synth: backend});

    const start = player.play();
    await Promise.resolve();
    expect(backend.preload).toHaveBeenCalledTimes(1);
    audio.setState('closed');
    finish();

    await expect(start).rejects.toThrow(/closed/);
    expect(player.isPlaying()).toBe(false);
    expect(backend.noteOn).not.toHaveBeenCalled();
    player.dispose();
  });

  it('removes a failed member from an already-built Rack', () => {
    const audio = fakeAudioContext();
    const rack = new Rack({audioContext: audio.context});
    void rack.context;
    audio.createGain.mockImplementationOnce(() => {
      const gain = audio.nodes[0] as FakeNode;
      gain.connect.mockImplementationOnce(() => {
        throw new Error('member edge failed');
      });
      return gain;
    });

    expect(() => rack.add({id: 'broken', score: score(), sound: synth()})).toThrow('member edge failed');
    expect(rack.get('broken')).toBeUndefined();
    expect(rack.list()).toEqual([]);
    rack.dispose();
  });
});
