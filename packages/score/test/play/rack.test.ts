import {afterEach, describe, expect, it, vi} from 'vitest';
import {Duration, MeasureId, PartId, Pitch, Rational, ScoreBuilder, VoiceId} from '../../src/core';
import {
  Rack,
  Effect,
  type HeadlessSynth,
  type PlaybackOperationError,
} from '../../src/play/headless';

function buildScore(name: string, pitches: string[]) {
  const builder = new ScoreBuilder();
  const partId = PartId('p');
  const voice = VoiceId('v');
  const timeSignature = {numerator: 4, denominator: 4};
  builder
    .setMetadata({title: name})
    .addTempo({atQuarters: Rational.ZERO, bpm: 120})
    .addMeter({atQuarters: Rational.ZERO, measureNumber: 1, timeSignature});
  builder.addPart({id: partId, name: 'Part', staves: 1});
  builder.addMeasure({
    id: MeasureId('m1'),
    number: 1,
    onsetQuarters: Rational.ZERO,
    durationQuarters: new Rational(Math.max(4, pitches.length)),
    timeSignature,
  });
  pitches.forEach((p, i) =>
    builder.addNote(partId, {
      id: builder.newNoteId(),
      pitch: Pitch.parse(p),
      onsetQuarters: new Rational(i),
      duration: Duration.quarter(),
      voice,
    }),
  );
  return builder.build();
}

function recordingSynth(): HeadlessSynth & {ons: number[]} {
  const ons: number[] = [];
  return {ons, connect() {}, disconnect() {}, noteOn: (midi) => ons.push(midi), noteOff() {}};
}

function trackedEffect() {
  const input = {connect: vi.fn(), disconnect: vi.fn()} as unknown as AudioNode;
  const output = {connect: vi.fn(), disconnect: vi.fn()} as unknown as AudioNode;
  const dispose = vi.fn();
  const build = vi.fn((_context: AudioContext) => ({input, output, dispose}));
  return {effect: Effect.custom(build), build, dispose};
}

function graphNode(label: string, edges: Set<string>) {
  const node = {
    label,
    connect: vi.fn((destination: AudioNode) => {
      edges.add(`${label}->${(destination as unknown as {label: string}).label}`);
      return destination;
    }),
    disconnect: vi.fn((destination?: AudioNode) => {
      if (destination) {
        edges.delete(`${label}->${(destination as unknown as {label: string}).label}`);
        return;
      }
      for (const edge of [...edges]) {
        if (edge.startsWith(`${label}->`)) edges.delete(edge);
      }
    }),
  };
  return node;
}

function routingAudio() {
  const edges = new Set<string>();
  const destination = graphNode('destination', edges);
  const master = Object.assign(graphNode('master', edges), {gain: {value: 0}});
  const ctx = {
    state: 'running' as const,
    destination,
    resume: async () => undefined,
    createGain: () => master,
  } as unknown as AudioContext;
  const effect = (label: string) => {
    const input = graphNode(`${label}.input`, edges);
    const output = graphNode(`${label}.output`, edges);
    const dispose = vi.fn();
    const recipe = Effect.custom(() => ({
      input: input as unknown as AudioNode,
      output: output as unknown as AudioNode,
      dispose,
    }));
    return {recipe, input, output, dispose};
  };
  return {ctx, edges, destination, master, effect};
}

/** Mock AudioContext with a hand-driven clock, enough for the engine + effects. */
function mockAudio() {
  let t = 0;
  const param = () => ({
    value: 0,
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
  const node = () => ({gain: param(), connect: () => node(), disconnect() {}, buffer: null});
  const ctx = {
    get currentTime() {
      return t;
    },
    state: 'running' as const,
    sampleRate: 44100,
    destination: {},
    resume: async () => {},
    createGain: () => node(),
    createStereoPanner: () => ({pan: param(), connect: () => node(), disconnect() {}}),
    createConvolver: () => ({buffer: null, connect: () => node(), disconnect() {}}),
    createBuffer: (channels: number, length: number) => ({
      numberOfChannels: channels,
      getChannelData: () => new Float32Array(length),
    }),
  } as unknown as AudioContext;
  return {ctx, advance: (ms: number) => (t += ms / 1000)};
}

function run(advance: (ms: number) => void, totalMs: number, step = 10) {
  for (let e = 0; e < totalMs; e += step) {
    advance(step);
    vi.advanceTimersByTime(step);
  }
}

describe('Rack', () => {
  afterEach(() => vi.useRealTimers());

  it('builds and configures members with no AudioContext (SSR-safe)', () => {
    const rack = new Rack();
    const a = rack.add({id: 'violin', score: buildScore('v', ['C4']), sound: recordingSynth()});
    rack.add({id: 'cello', score: buildScore('c', ['E3']), sound: recordingSynth()});
    expect(a.id).toBe('violin');
    expect(rack.list().map((m) => m.id)).toEqual(['violin', 'cello']);
    expect(() => rack.setVolume('violin', 0.5).mute('cello').solo('violin')).not.toThrow();
  });

  it('isolates memberschange listener failures after committing membership', () => {
    const rack = new Rack();
    const later = vi.fn();
    const listenerErrors: string[] = [];
    rack.on('memberschange', () => {
      throw new Error('members observer failed');
    });
    rack.on('memberschange', later);
    rack.on('listenerError', ({event}) => listenerErrors.push(event));

    expect(() => rack.add({id: 'safe', score: buildScore('safe', ['C4'])})).not.toThrow();
    expect(rack.list().map(({id}) => id)).toEqual(['safe']);
    expect(later).toHaveBeenCalledOnce();
    expect(listenerErrors).toEqual(['memberschange']);
    rack.dispose();
  });

  it('renames a live member without replacing its player, mix state or position', () => {
    const {ctx} = mockAudio();
    const rack = new Rack({audioContext: ctx});
    rack.add({id: 'lead', score: buildScore('lead', ['C4']), sound: recordingSynth()});
    rack.add({id: 'bass', score: buildScore('bass', ['E3']), sound: recordingSynth()});
    void rack.context;
    rack.setVolume('lead', 0.35).mute('lead').solo('lead');

    const before = rack.get('lead');
    if (!before?.player) throw new Error('expected a built rack member');
    const dispose = vi.spyOn(before.player, 'dispose');
    const memberschange = vi.fn();
    rack.on('memberschange', memberschange);

    expect(rack.rename('lead', 'melody')).toBe(rack);

    const after = rack.get('melody');
    expect(rack.get('lead')).toBeUndefined();
    expect(after).toMatchObject({
      id: 'melody',
      player: before.player,
      volume: 0.35,
      muted: true,
      solo: true,
    });
    expect(rack.list().map(({id}) => id)).toEqual(['melody', 'bass']);
    expect(dispose).not.toHaveBeenCalled();
    expect(memberschange).toHaveBeenCalledTimes(1);

    rack.dispose();
  });

  it('defines missing, collision, same-id and disposed rename semantics', () => {
    const rack = new Rack();
    rack.add({id: 'lead', score: buildScore('lead', ['C4'])});
    rack.add({id: 'bass', score: buildScore('bass', ['E3'])});
    const memberschange = vi.fn();
    rack.on('memberschange', memberschange);

    expect(rack.rename('lead', 'lead')).toBe(rack);
    expect(() => rack.rename('missing', 'other')).toThrow('Rack member "missing" does not exist.');
    expect(() => rack.rename('lead', 'bass')).toThrow('Rack member "bass" already exists.');
    expect(rack.list().map(({id}) => id)).toEqual(['lead', 'bass']);
    expect(memberschange).not.toHaveBeenCalled();

    rack.dispose();
    expect(() => rack.rename('lead', 'melody')).toThrow('Rack has been disposed.');
  });

  it('publishes contained member transport failures as operationError', () => {
    const {ctx} = mockAudio();
    const rack = new Rack({audioContext: ctx});
    rack.add({id: 'broken', score: buildScore('broken', ['C4']), sound: recordingSynth()});
    void rack.context;
    const player = rack.get('broken')?.player;
    if (!player) throw new Error('expected built rack member');
    const failure = new Error('member pause failed');
    (player as {pause: () => void}).pause = () => {
      throw failure;
    };
    const operations: PlaybackOperationError[] = [];
    rack.on('operationError', (error) => operations.push(error));

    expect(() => rack.pause()).not.toThrow();

    expect(operations).toEqual([{
      kind: 'operationError',
      source: 'Rack',
      operation: 'pause member',
      error: failure,
    }]);
    rack.dispose();
  });

  it('bubbles a member player backend failure through the rack operation channel', async () => {
    vi.useFakeTimers();
    const {ctx, advance} = mockAudio();
    const failure = new Error('member release failed');
    const rack = new Rack({audioContext: ctx});
    rack.add({
      id: 'broken',
      score: buildScore('broken', ['C4']),
      sound: {
        connect() {},
        noteOn: () => 'member-voice',
        noteOffById: () => {
          throw failure;
        },
      },
    });
    const operations: PlaybackOperationError[] = [];
    rack.on('operationError', (error) => operations.push(error));

    await rack.play();
    run(advance, 700);

    expect(operations).toEqual([{
      kind: 'operationError',
      source: 'Rack',
      operation: 'member broken noteOffById',
      error: failure,
    }]);
    rack.dispose();
  });

  it('plays all timeline members together through one shared graph', async () => {
    vi.useFakeTimers();
    const {ctx, advance} = mockAudio();
    const violin = recordingSynth();
    const cello = recordingSynth();
    const rack = new Rack({audioContext: ctx, effect: Effect.reverb({wet: 0.2})});
    rack.add({score: buildScore('v', ['C4', 'D4']), sound: violin});
    rack.add({score: buildScore('c', ['E3', 'F3']), sound: cello});

    const ended = vi.fn();
    rack.on('end', ended);

    await rack.play();
    run(advance, 2300); // both span a 4/4 measure (2.0s @120)

    expect(violin.ons).toEqual([Pitch.parse('C4').midi, Pitch.parse('D4').midi]);
    expect(cello.ons).toEqual([Pitch.parse('E3').midi, Pitch.parse('F3').midi]);
    expect(ended).toHaveBeenCalledTimes(1); // aggregated end after BOTH finish
  });

  it('reuses one Effect recipe contract and swaps the rack master chain without rebuilding members', () => {
    const {ctx} = mockAudio();
    const first = trackedEffect();
    const second = trackedEffect();
    const rack = new Rack({audioContext: ctx});
    rack.add({id: 'lead', score: buildScore('lead', ['C4']), sound: recordingSynth()});

    rack.effect = first.effect;
    expect(rack.effect).toBe(first.effect);
    expect(first.build).not.toHaveBeenCalled();

    void rack.context;
    const memberPlayer = rack.get('lead')?.player;
    expect(first.build).toHaveBeenCalledOnce();

    expect(rack.setEffect(second.effect)).toBe(rack);
    expect(rack.effect).toBe(second.effect);
    expect(second.build).toHaveBeenCalledOnce();
    expect(first.dispose).toHaveBeenCalledOnce();
    expect(rack.get('lead')?.player).toBe(memberPlayer);

    // Reassigning the same immutable recipe is a no-op: it must not create a
    // parallel route or tear down the live one.
    expect(rack.setEffect(second.effect)).toBe(rack);
    expect(second.build).toHaveBeenCalledOnce();
    expect(second.dispose).not.toHaveBeenCalled();

    rack.effect = undefined;
    expect(rack.effect).toBeUndefined();
    expect(second.dispose).toHaveBeenCalledOnce();
    expect(rack.get('lead')?.player).toBe(memberPlayer);
    rack.dispose();
    expect(() => rack.setEffect(first.effect)).toThrow('Rack has been disposed.');
  });

  it('commits exact master routes across effect, dry, and replacement transitions', () => {
    const {ctx, edges, effect} = routingAudio();
    const first = effect('first');
    const second = effect('second');
    const rack = new Rack({audioContext: ctx, effect: first.recipe});
    void rack.context;
    expect([...edges].sort()).toEqual([
      'first.output->destination',
      'master->first.input',
    ]);

    rack.setEffect(second.recipe);
    expect([...edges].sort()).toEqual([
      'master->second.input',
      'second.output->destination',
    ]);

    rack.effect = undefined;
    expect([...edges]).toEqual(['master->destination']);

    rack.effect = second.recipe;
    expect([...edges].sort()).toEqual([
      'master->second.input',
      'second.output->destination',
    ]);
    rack.dispose();
    expect([...edges]).toEqual([]);
  });

  it('rejects a lazy effect mutation during initial graph construction without changing its recipe', () => {
    const {ctx, edges, effect} = routingAudio();
    const first = effect('first');
    const second = effect('second');
    const initial = Effect.custom((context) => {
      expect(() => rack.setEffect(second.recipe)).toThrow(/during audio graph construction/);
      return first.recipe.build(context);
    });
    const rack = new Rack({audioContext: ctx, effect: initial});
    try {
      void rack.context;
      expect(rack.effect).toBe(initial);
      expect([...edges].sort()).toEqual(['first.output->destination', 'master->first.input']);

      rack.setEffect(second.recipe);
      expect(rack.effect).toBe(second.recipe);
      expect([...edges].sort()).toEqual(['master->second.input', 'second.output->destination']);
      expect(first.dispose).toHaveBeenCalledOnce();
    } finally {
      rack.dispose();
    }
  });

  it('can retry after an uncaught reentrant effect mutation rolls back the initial graph', () => {
    const {ctx, edges, effect} = routingAudio();
    const second = effect('second');
    const first = Effect.custom(() => {
      rack.setEffect(second.recipe);
      throw new Error('unreachable');
    });
    const rack = new Rack({audioContext: ctx, effect: first});
    try {
      expect(() => rack.context).toThrow(/during audio graph construction/);
      expect(rack.effect).toBe(first);
      expect([...edges]).toEqual([]);
      rack.setEffect(second.recipe);
      void rack.context;
      expect([...edges].sort()).toEqual(['master->second.input', 'second.output->destination']);
    } finally {
      rack.dispose();
    }
  });

  it('retains the route and one cleanup owner when a new recipe returns the exact active bundle', () => {
    const {ctx, edges, effect} = routingAudio();
    const shared = effect('shared');
    const bundle = shared.recipe.build(ctx);
    const first = Effect.custom(bundle);
    const alias = Effect.custom(bundle);
    const next = effect('next');
    const rack = new Rack({audioContext: ctx, effect: first});
    try {
      void rack.context;
      const connected = [...edges].sort();
      expect(rack.setEffect(alias)).toBe(rack);
      expect(rack.effect).toBe(alias);
      expect([...edges].sort()).toEqual(connected);
      expect(shared.output.connect).toHaveBeenCalledOnce();
      expect(shared.dispose).not.toHaveBeenCalled();

      rack.setEffect(next.recipe);
      expect(shared.dispose).toHaveBeenCalledOnce();
      expect([...edges].sort()).toEqual(['master->next.input', 'next.output->destination']);
    } finally {
      rack.dispose();
    }
    expect(shared.dispose).toHaveBeenCalledOnce();
    expect(next.dispose).toHaveBeenCalledOnce();
    expect([...edges]).toEqual([]);
  });

  it.each(['input', 'output'] as const)(
    'rejects a distinct effect bundle sharing the current %s without disconnecting or disposing it',
    (sharedSide) => {
      const {ctx, edges, effect} = routingAudio();
      const first = effect('first');
      const candidate = effect('candidate');
      const currentBundle = first.recipe.build(ctx);
      const candidateBundle = candidate.recipe.build(ctx);
      const overlapping = Effect.custom({...candidateBundle, [sharedSide]: currentBundle[sharedSide]});
      const rack = new Rack({audioContext: ctx, effect: Effect.custom(currentBundle)});
      try {
        void rack.context;
        const previousRecipe = rack.effect;
        const connected = [...edges].sort();
        expect(() => rack.setEffect(overlapping)).toThrow(/fresh input\/output nodes or the exact active/);
        expect(rack.effect).toBe(previousRecipe);
        expect([...edges].sort()).toEqual(connected);
        expect(first.dispose).not.toHaveBeenCalled();
        expect(candidate.dispose).not.toHaveBeenCalled();
      } finally {
        rack.dispose();
        // The rejected bundle was supplied by this caller and was never adopted.
        candidateBundle.dispose?.();
      }
      expect(first.dispose).toHaveBeenCalledOnce();
      expect(candidate.dispose).toHaveBeenCalledOnce();
    },
  );

  it('releases a fresh returned bundle when its builder disposes the rack before insertion', () => {
    const {ctx, edges, effect} = routingAudio();
    const first = effect('first');
    const candidate = effect('candidate');
    const rack = new Rack({audioContext: ctx, effect: first.recipe});
    void rack.context;
    const replacement = Effect.custom((context) => {
      rack.dispose();
      return candidate.recipe.build(context);
    });

    expect(() => rack.setEffect(replacement)).toThrow(/changed during audio graph construction/);
    expect(candidate.output.connect).not.toHaveBeenCalled();
    expect(candidate.dispose).toHaveBeenCalledOnce();
    expect(first.dispose).toHaveBeenCalledOnce();
    expect([...edges]).toEqual([]);
    rack.dispose();
    expect(first.dispose).toHaveBeenCalledOnce();
    expect(candidate.dispose).toHaveBeenCalledOnce();
  });

  it('rolls every candidate edge back when replacement connection fails', () => {
    const {ctx, edges, effect} = routingAudio();
    const first = effect('first');
    const broken = effect('broken');
    const failure = new Error('effect output rejected destination');
    const connect = broken.output.connect;
    broken.output.connect.mockImplementationOnce((destination) => {
      connect(destination);
      throw failure;
    });
    const rack = new Rack({audioContext: ctx, effect: first.recipe});
    void rack.context;

    expect(() => rack.setEffect(broken.recipe)).toThrow(failure);
    expect(rack.effect).toBe(first.recipe);
    expect([...edges].sort()).toEqual([
      'first.output->destination',
      'master->first.input',
    ]);
    expect(broken.dispose).toHaveBeenCalledOnce();
    expect(first.dispose).not.toHaveBeenCalled();
    rack.dispose();
  });

  it('keeps live member transport and position while replacing the master effect', async () => {
    vi.useFakeTimers();
    const {ctx, advance} = mockAudio();
    const first = trackedEffect();
    const second = trackedEffect();
    const rack = new Rack({audioContext: ctx, effect: first.effect});
    rack.add({id: 'lead', score: buildScore('lead', ['C4', 'D4']), sound: recordingSynth()});

    await rack.play();
    run(advance, 350);
    const player = rack.get('lead')?.player;
    if (!player || !('isPlaying' in player)) throw new Error('expected timeline player');
    const seconds = player.seconds;
    expect(player.isPlaying()).toBe(true);

    rack.setEffect(second.effect);
    expect(rack.get('lead')?.player).toBe(player);
    expect(player.isPlaying()).toBe(true);
    expect(player.seconds).toBeCloseTo(seconds);
    rack.dispose();
  });

  it('keeps the previous rack effect and route when a live replacement cannot be built', () => {
    const {ctx} = mockAudio();
    const first = trackedEffect();
    const next = trackedEffect();
    const failure = new Error('replacement effect failed');
    const broken = Effect.custom(() => {
      throw failure;
    });
    const rack = new Rack({audioContext: ctx, effect: first.effect});
    void rack.context;

    expect(() => rack.setEffect(broken)).toThrow(failure);
    expect(rack.effect).toBe(first.effect);
    expect(first.dispose).not.toHaveBeenCalled();

    expect(() => rack.setEffect(next.effect)).not.toThrow();
    expect(rack.effect).toBe(next.effect);
    expect(first.dispose).toHaveBeenCalledOnce();
    rack.dispose();
    expect(next.dispose).toHaveBeenCalledOnce();
  });

  it('owns its effect state even when the caller later mutates constructor options', () => {
    const {ctx} = mockAudio();
    const first = trackedEffect();
    const second = trackedEffect();
    const options = {audioContext: ctx, effect: first.effect};
    const rack = new Rack(options);
    void rack.context;

    options.effect = second.effect;
    expect(rack.effect).toBe(first.effect);
    expect(second.build).not.toHaveBeenCalled();

    rack.setEffect(second.effect);
    expect(rack.effect).toBe(second.effect);
    expect(second.build).toHaveBeenCalledOnce();
    expect(first.dispose).toHaveBeenCalledOnce();
    rack.dispose();
    expect(second.dispose).toHaveBeenCalledOnce();
  });

  it('can replace a lazy or live effect when constructor options are frozen', () => {
    const {ctx} = mockAudio();
    const first = trackedEffect();
    const second = trackedEffect();
    const options = Object.freeze({audioContext: ctx, effect: first.effect});
    const rack = new Rack(options);

    expect(rack.setEffect(second.effect)).toBe(rack);
    expect(rack.effect).toBe(second.effect);
    expect(second.build).not.toHaveBeenCalled();

    void rack.context;
    expect(second.build).toHaveBeenCalledOnce();
    expect(rack.setEffect(first.effect)).toBe(rack);
    expect(first.build).toHaveBeenCalledOnce();
    expect(second.dispose).toHaveBeenCalledOnce();
    rack.dispose();
    expect(first.dispose).toHaveBeenCalledOnce();
  });

  it('builds players lazily and exposes them after audio init', async () => {
    vi.useFakeTimers();
    const {ctx} = mockAudio();
    const rack = new Rack({audioContext: ctx});
    const handle = rack.add({score: buildScore('v', ['C4']), sound: recordingSynth()});
    expect(handle.player).toBeUndefined(); // not built yet
    await rack.play();
    expect(rack.get('player-0')?.player).toBeDefined();
    rack.stop();
  });

  it('awaits a member sound preload before a rack is used for playback', async () => {
    const {ctx} = mockAudio();
    let resolve!: () => void;
    const loading = new Promise<void>((done) => {
      resolve = done;
    });
    const sound = {
      connect: vi.fn(),
      disconnect: vi.fn(),
      noteOn: vi.fn(),
      preload: vi.fn(() => loading),
    } as HeadlessSynth & {preload: () => Promise<void>};
    const rack = new Rack({audioContext: ctx});
    rack.add({score: buildScore('v', ['C4']), sound});

    const ready = rack.preload();
    await Promise.resolve();
    expect(sound.preload).toHaveBeenCalledTimes(1);

    resolve();
    await ready;
    rack.dispose();
  });

  it('cancels an in-flight rack start before preload completes', async () => {
    vi.useFakeTimers();
    const {ctx} = mockAudio();
    let resolve!: () => void;
    const loading = new Promise<void>((done) => {
      resolve = done;
    });
    const sound = {
      connect: vi.fn(),
      noteOn: vi.fn(),
      preload: vi.fn(() => loading),
    } as HeadlessSynth & {preload: () => Promise<void>};
    const rack = new Rack({audioContext: ctx});
    rack.add({id: 'lead', score: buildScore('lead', ['C4']), sound});

    const pending = rack.play();
    await Promise.resolve();
    rack.pause();
    resolve();
    await pending;

    const player = rack.get('lead')?.player;
    expect(player && 'isPlaying' in player ? player.isPlaying() : undefined).toBe(false);
    expect(sound.noteOn).not.toHaveBeenCalled();
    rack.dispose();
  });

  it('does not enter preload after graph construction reentrantly pauses the start', async () => {
    const {ctx} = mockAudio();
    const control: {pause?: () => void} = {};
    const preload = vi.fn(async () => undefined);
    const sound = {
      connect: () => control.pause?.(),
      noteOn: vi.fn(),
      preload,
    } as HeadlessSynth & {preload(): Promise<void>};
    const rack = new Rack({audioContext: ctx});
    control.pause = () => rack.pause();
    rack.add({id: 'lead', score: buildScore('lead', ['C4']), sound});

    await expect(rack.play()).resolves.toBeUndefined();

    expect(preload).not.toHaveBeenCalled();
    const player = rack.get('lead')?.player;
    expect(player && 'isPlaying' in player ? player.isPlaying() : undefined).toBe(false);
    rack.dispose();
  });

  it('rolls back members when pause wins during their pending play calls', async () => {
    const {ctx} = mockAudio();
    const rack = new Rack({audioContext: ctx});
    rack.add({id: 'lead', score: buildScore('lead', ['C4']), sound: recordingSynth()});
    // Force lazy member construction before replacing the member start hook.
    void rack.context;
    const player = rack.get('lead')?.player;
    if (!player || !('isPlaying' in player)) throw new Error('expected timeline player');
    let resolveStart!: () => void;
    const memberStart = new Promise<void>((resolve) => {
      resolveStart = resolve;
    });
    vi.spyOn(player, 'play').mockReturnValue(memberStart);
    const pause = vi.spyOn(player, 'pause');

    const pending = rack.play();
    await vi.waitFor(() => expect(player.play).toHaveBeenCalledTimes(1));
    rack.pause();
    resolveStart();
    await pending;

    expect(pause).toHaveBeenCalledTimes(2);
    rack.dispose();
  });

  it('abandons a never-settling member start when that member is replaced', async () => {
    const {ctx} = mockAudio();
    const rack = new Rack({audioContext: ctx});
    rack.add({id: 'lead', score: buildScore('old', ['C4']), sound: recordingSynth()});
    void rack.context;
    const oldPlayer = rack.get('lead')?.player;
    if (!oldPlayer || !('isPlaying' in oldPlayer)) throw new Error('expected timeline player');
    let rejectOld!: (error: Error) => void;
    const oldStart = new Promise<void>((_resolve, reject) => {
      rejectOld = reject;
    });
    vi.spyOn(oldPlayer, 'play').mockReturnValue(oldStart);

    const pending = rack.play();
    await vi.waitFor(() => expect(oldPlayer.play).toHaveBeenCalledOnce());

    const replacement = rack.add({
      id: 'lead',
      score: buildScore('new', ['D4']),
      sound: recordingSynth(),
    });
    const newPlayer = replacement.player;
    if (!newPlayer || !('isPlaying' in newPlayer)) throw new Error('expected replacement player');
    const newStart = vi.spyOn(newPlayer, 'play').mockResolvedValue(undefined);

    await pending;
    expect(newStart).toHaveBeenCalledOnce();

    // The abandoned aggregate keeps a rejection handler even after mutation
    // wins the race, so a delayed old failure is never unhandled.
    rejectOld(new Error('late obsolete member failure'));
    await Promise.resolve();
    await Promise.resolve();
    rack.dispose();
  });

  it.each(['pause', 'stop'] as const)(
    '%s settles Rack.play while a member start never settles',
    async (operation) => {
      const {ctx} = mockAudio();
      const rack = new Rack({audioContext: ctx});
      rack.add({id: 'lead', score: buildScore('lead', ['C4']), sound: recordingSynth()});
      void rack.context;
      const player = rack.get('lead')?.player;
      if (!player || !('isPlaying' in player)) throw new Error('expected timeline player');
      let rejectStart!: (error: Error) => void;
      const memberStart = new Promise<void>((_resolve, reject) => {
        rejectStart = reject;
      });
      vi.spyOn(player, 'play').mockReturnValue(memberStart);

      const pending = rack.play();
      await vi.waitFor(() => expect(player.play).toHaveBeenCalledOnce());
      rack[operation]();
      await expect(pending).resolves.toBeUndefined();

      rejectStart(new Error(`late ${operation} member failure`));
      await Promise.resolve();
      await Promise.resolve();
      rack.dispose();
    },
  );

  it('rolls back every started member when one member play rejects', async () => {
    const {ctx} = mockAudio();
    const rack = new Rack({audioContext: ctx});
    rack.add({id: 'first', score: buildScore('first', ['C4']), sound: recordingSynth()});
    rack.add({id: 'second', score: buildScore('second', ['E4']), sound: recordingSynth()});
    void rack.context;
    const first = rack.get('first')?.player;
    const second = rack.get('second')?.player;
    if (
      !first || !('isPlaying' in first) ||
      !second || !('isPlaying' in second)
    ) {
      throw new Error('expected timeline players');
    }
    vi.spyOn(first, 'play').mockResolvedValue(undefined);
    vi.spyOn(second, 'play').mockRejectedValue(new Error('member start failed'));
    const firstPause = vi.spyOn(first, 'pause');
    const secondPause = vi.spyOn(second, 'pause');

    await expect(rack.play()).rejects.toThrow('member start failed');

    expect(firstPause).toHaveBeenCalledTimes(1);
    expect(secondPause).toHaveBeenCalledTimes(1);
    rack.dispose();
  });

  it('disposes every owned member when backend releases throw', async () => {
    vi.useFakeTimers();
    const {ctx, advance} = mockAudio();
    const backend = () => {
      let nextHandle = 0;
      const noteOffById = vi.fn(() => {
        throw new Error('member release failed');
      });
      const dispose = vi.fn();
      const synth: HeadlessSynth = {
        connect() {},
        noteOn: () => ++nextHandle,
        noteOffById,
        dispose,
      };
      return {synth, noteOffById, dispose};
    };
    const first = backend();
    const second = backend();
    const rack = new Rack({audioContext: ctx});
    rack.add({
      id: 'first',
      score: buildScore('first', ['C4']),
      sound: first.synth,
      soundOwnership: 'owned',
    });
    rack.add({
      id: 'second',
      score: buildScore('second', ['E4']),
      sound: second.synth,
      soundOwnership: 'owned',
    });

    await rack.play();
    run(advance, 10);
    expect(() => rack.dispose()).not.toThrow();

    expect(first.noteOffById).toHaveBeenCalledTimes(1);
    expect(second.noteOffById).toHaveBeenCalledTimes(1);
    expect(first.dispose).toHaveBeenCalledTimes(1);
    expect(second.dispose).toHaveBeenCalledTimes(1);
  });

  it('drives interactive members with advance()', () => {
    const {ctx} = mockAudio();
    const rack = new Rack({audioContext: ctx});
    rack.add({id: 'perc', mode: 'interactive', score: buildScore('p', ['C4', 'D4']), sound: recordingSynth()});
    const beat0 = rack.advance();
    expect(beat0.perc.map((n) => n.midi)).toEqual([Pitch.parse('C4').midi]);
    const beat1 = rack.advance();
    expect(beat1.perc.map((n) => n.midi)).toEqual([Pitch.parse('D4').midi]);
  });

  it('removes members', () => {
    const rack = new Rack();
    rack.add({id: 'a', score: buildScore('a', ['C4']), sound: recordingSynth()});
    rack.add({id: 'b', score: buildScore('b', ['D4']), sound: recordingSynth()});
    rack.remove('a');
    expect(rack.list().map((m) => m.id)).toEqual(['b']);
  });

  it.each(['remove', 'failed replacement'] as const)(
    'restores remaining gains after the last solo member leaves through %s',
    (operation) => {
      const {ctx} = mockAudio();
      const createGain = vi.spyOn(ctx, 'createGain');
      const rack = new Rack({audioContext: ctx});
      rack.add({id: 'solo', score: buildScore('solo', ['C4']), sound: recordingSynth()});
      rack.add({id: 'other', score: buildScore('other', ['D4']), sound: recordingSynth(), volume: 0.4});
      void rack.context;
      // The channel uses the requested 0.4 level; the player's private output
      // and shared master both remain at unity.
      const channel = createGain.mock.results.map(({value}) => value as GainNode)
        .find(({gain}) => gain.value === 0.4);
      expect(channel).toBeDefined();
      try {
        rack.solo('solo');
        expect(channel!.gain.value).toBe(0);
        if (operation === 'remove') {
          rack.remove('solo');
        } else {
          expect(() => rack.add({
            id: 'solo',
            score: buildScore('replacement', ['E4']),
            sound: recordingSynth(),
            effect: Effect.custom(() => { throw new Error('replacement effect failed'); }),
          })).toThrow('replacement effect failed');
          expect(rack.get('solo')).toBeUndefined();
        }
        expect(channel!.gain.value).toBe(0.4);
      } finally {
        rack.dispose();
        createGain.mockRestore();
      }
    },
  );
});
