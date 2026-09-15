import {afterEach, describe, expect, it, vi} from 'vitest';
import {Duration, MeasureId, PartId, Pitch, Rational, ScoreBuilder, VoiceId, type Score} from '../../src/core';
import {InteractivePlayer, Rack, type HeadlessSynth} from '../../src/play/headless';

function score(performedDurationSeconds?: number): Score {
  const builder = new ScoreBuilder();
  const part = PartId('part');
  const voice = VoiceId('voice');
  const meter = {numerator: 4, denominator: 4};
  builder
    .addTempo({atQuarters: Rational.ZERO, bpm: 120})
    .addMeter({atQuarters: Rational.ZERO, measureNumber: 1, timeSignature: meter});
  builder.addPart({id: part, name: 'Part', staves: 1});
  builder.addMeasure({
    id: MeasureId('measure'),
    number: 1,
    onsetQuarters: Rational.ZERO,
    durationQuarters: new Rational(4),
    timeSignature: meter,
  });
  builder.addNote(part, {
    id: builder.newNoteId(),
    pitch: Pitch.parse('C4'),
    onsetQuarters: Rational.ZERO,
    duration: Duration.quarter(),
    voice,
    performed: performedDurationSeconds === undefined
      ? undefined
      : {onsetSec: 0, durationSec: performedDurationSeconds, velocity: 100},
  });
  return builder.build();
}

function deferred(): {
  promise: Promise<void>;
  resolve: () => void;
  reject: (error: unknown) => void;
} {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return {promise, resolve, reject};
}

function fakeAudio(options: {close?: () => Promise<void>} = {}) {
  let state = 'running';
  const context = {} as AudioContext;
  const parameter = () => ({
    value: 1,
    setValueAtTime() {
      return this;
    },
    exponentialRampToValueAtTime() {
      return this;
    },
    cancelScheduledValues() {
      return this;
    },
  });
  const node = () => ({
    context,
    gain: parameter(),
    pan: parameter(),
    connect: () => node(),
    disconnect: vi.fn(),
    buffer: null,
  });
  Object.assign(context, {
    currentTime: 0,
    sampleRate: 44_100,
    destination: node(),
    resume: vi.fn(async () => {
      if (state !== 'closed') state = 'running';
    }),
    close: vi.fn(options.close ?? (async () => {
      state = 'closed';
    })),
    createGain: vi.fn(() => node()),
    createStereoPanner: vi.fn(() => node()),
    createConvolver: vi.fn(() => node()),
    createBuffer: vi.fn((channels: number, length: number) => ({
      numberOfChannels: channels,
      getChannelData: () => new Float32Array(length),
    })),
  });
  Object.defineProperty(context, 'state', {get: () => state, configurable: true});
  return {
    context,
    setState(next: string) {
      state = next;
    },
  };
}

function preloadSynth(promise: Promise<void>): HeadlessSynth & {preload: ReturnType<typeof vi.fn>} {
  return {
    connect: vi.fn(),
    noteOn: vi.fn(),
    preload: vi.fn(() => promise),
  };
}

async function flushMicrotasks(count = 4): Promise<void> {
  for (let index = 0; index < count; index += 1) await Promise.resolve();
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('mutation-safe readiness and terminal cleanup', () => {
  it('restarts InteractivePlayer preload for a voice replaced while preparation is pending', async () => {
    const audio = fakeAudio();
    const stale = deferred();
    const current = deferred();
    const staleSynth = preloadSynth(stale.promise);
    const currentSynth = preloadSynth(current.promise);
    const player = new InteractivePlayer({audioContext: audio.context});
    player.addVoice('lead', staleSynth);

    let settled = false;
    const ready = player.preload().then(() => {
      settled = true;
    });
    await flushMicrotasks();
    expect(staleSynth.preload).toHaveBeenCalledOnce();

    player.addVoice('lead', currentSynth);
    await flushMicrotasks(8);

    expect(currentSynth.preload).toHaveBeenCalledOnce();
    expect(settled).toBe(false);
    current.resolve();
    await ready;
    expect(settled).toBe(true);
    player.dispose();
  });

  it('rejects InteractivePlayer readiness if its context closes during preparation', async () => {
    const audio = fakeAudio();
    const loading = deferred();
    const player = new InteractivePlayer({audioContext: audio.context});
    player.addVoice('lead', preloadSynth(loading.promise));

    const ready = player.preload();
    await flushMicrotasks();
    audio.setState('closed');
    loading.resolve();

    await expect(ready).rejects.toThrow(/closed/);
    player.dispose();
  });

  it('rejects synchronous InteractivePlayer attacks when the live clock is interrupted', () => {
    const audio = fakeAudio();
    const synth = preloadSynth(Promise.resolve());
    const player = new InteractivePlayer({audioContext: audio.context});
    player.addVoice('lead', synth);
    void player.context;
    audio.setState('interrupted');

    expect(() => player.noteOn('lead', 60)).toThrow(/interrupted/);
    expect(synth.noteOn).not.toHaveBeenCalled();
    player.dispose();
  });

  it('preserves sub-10ms logical gates in InteractivePlayer score pulls', () => {
    const audio = fakeAudio();
    const synth = preloadSynth(Promise.resolve());
    const player = new InteractivePlayer({audioContext: audio.context, lookaheadSeconds: 0});
    player.addVoice('lead', synth);
    player.addSource('short', score(0.005), {route: {Part: 'lead'}});

    player.advance();

    expect(synth.noteOn).toHaveBeenCalledWith(60, 100, 0, 0.005);
    player.dispose();
  });

  it('detaches Rack preload from a member replaced while preparation is pending', async () => {
    const audio = fakeAudio();
    const firstLoad = deferred();
    const secondLoad = deferred();
    const first = preloadSynth(firstLoad.promise);
    const second = preloadSynth(secondLoad.promise);
    const rack = new Rack({audioContext: audio.context});
    rack.add({id: 'first', score: score(), sound: first});

    let settled = false;
    const ready = rack.preload().then(() => {
      settled = true;
    });
    await flushMicrotasks();
    expect(first.preload).toHaveBeenCalledOnce();

    rack.add({id: 'first', score: score(), sound: second});
    await flushMicrotasks(12);

    expect(second.preload).toHaveBeenCalledOnce();
    expect(settled).toBe(false);
    secondLoad.resolve();
    await ready;
    expect(settled).toBe(true);
    rack.dispose();
  });

  it('restarts the Rack start transaction when membership changes during member play', async () => {
    const audio = fakeAudio();
    const rack = new Rack({audioContext: audio.context});
    rack.add({id: 'first', score: score(), sound: preloadSynth(Promise.resolve())});
    void rack.context;
    const first = rack.get('first')?.player;
    if (!first || !('play' in first)) throw new Error('expected timeline member');
    const blocked = deferred();
    // A timeline member is a ScorePlayer, whose play() takes no arguments.
    const originalPlay = first.play.bind(first) as () => Promise<void>;
    const firstPlay = vi.spyOn(first, 'play')
      .mockImplementationOnce(() => blocked.promise)
      .mockImplementation(() => originalPlay());

    const starting = rack.play();
    await vi.waitFor(() => expect(firstPlay).toHaveBeenCalledOnce());
    rack.add({id: 'second', score: score(), sound: preloadSynth(Promise.resolve())});
    blocked.resolve();
    await starting;

    const second = rack.get('second')?.player;
    expect(firstPlay).toHaveBeenCalledTimes(2);
    expect(second && 'isPlaying' in second ? second.isPlaying() : false).toBe(true);
    rack.dispose();
  });

  it('unsubscribes a removed Rack member from its timeline end event', () => {
    const audio = fakeAudio();
    const rack = new Rack({audioContext: audio.context});
    rack.add({id: 'timeline', score: score(), sound: preloadSynth(Promise.resolve())});
    void rack.context;
    const player = rack.get('timeline')?.player;
    if (!player) throw new Error('expected built timeline player');
    const emit = player as unknown as {emit(event: 'end', payload: Score): void};
    const memberEnd = vi.fn();
    rack.on('memberEnd', memberEnd);

    rack.remove('timeline');
    emit.emit('end', score());

    expect(memberEnd).not.toHaveBeenCalled();
    rack.dispose();
  });

  it('rolls back every Rack member route before publishing an owned context', () => {
    const audio = fakeAudio();
    const AudioContextFactory = vi.fn(function AudioContextFactory() {
      return audio.context;
    });
    vi.stubGlobal('AudioContext', AudioContextFactory);
    const firstRouteCleanup = vi.fn();
    const first: HeadlessSynth = {
      connect: vi.fn(() => firstRouteCleanup),
      noteOn: vi.fn(),
    };
    const second: HeadlessSynth = {
      connect: vi.fn(() => {
        throw new Error('second route failed');
      }),
      noteOn: vi.fn(),
    };
    const rack = new Rack();
    rack.add({id: 'first', score: score(), sound: first});
    rack.add({id: 'second', score: score(), sound: second});

    expect(() => rack.context).toThrow('second route failed');

    expect(firstRouteCleanup).toHaveBeenCalledOnce();
    expect(audio.context.close).toHaveBeenCalledOnce();
    expect(rack.get('first')?.player).toBeUndefined();
    expect(rack.get('second')?.player).toBeUndefined();
    rack.dispose();
  });

  it('delivers an owned Rack context close rejection before clearing listeners', async () => {
    const failure = new Error('close rejected');
    const audio = fakeAudio({close: async () => {
      throw failure;
    }});
    const AudioContextFactory = vi.fn(function AudioContextFactory() {
      return audio.context;
    });
    vi.stubGlobal('AudioContext', AudioContextFactory);
    const rack = new Rack();
    const operations: unknown[] = [];
    rack.on('operationError', ({operation, error}) => operations.push({operation, error}));
    void rack.context;

    rack.dispose();
    await flushMicrotasks();

    expect(operations).toEqual([{operation: 'context.close', error: failure}]);
  });
});
