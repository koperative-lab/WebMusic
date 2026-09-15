import {afterEach, describe, expect, it, vi} from 'vitest';
import {Duration, MeasureId, PartId, Pitch, Rational, ScoreBuilder, VoiceId} from '../../src/core';
import {serializeMIDI} from '../../src/io/formats';
import {InteractivePlayer, createInteractivePlayer, Effect, Sound, type HeadlessSynth} from '../../src/play/headless';

/** Run `fn` with `fetch` stubbed to return `bytes` for any URL. */
async function withFetch(bytes: Uint8Array, fn: () => Promise<void>): Promise<void> {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => ({ok: true, arrayBuffer: async () => bytes.buffer as ArrayBuffer}) as Response) as typeof fetch;
  try {
    await fn();
  } finally {
    globalThis.fetch = original;
  }
}

/** Build a 4-beat single-part score, one quarter note per beat (C, D, E, F). */
function buildScore(title: string, pitches: string[]) {
  const builder = new ScoreBuilder();
  const partId = PartId('piano');
  const voice = VoiceId('piano-v1');
  const timeSignature = {numerator: 4, denominator: 4};
  builder
    .setMetadata({title})
    .addTempo({atQuarters: Rational.ZERO, bpm: 120})
    .addMeter({atQuarters: Rational.ZERO, measureNumber: 1, timeSignature});
  builder.addPart({id: partId, name: 'Piano', staves: 1});
  builder.addMeasure({
    id: MeasureId('m1'),
    number: 1,
    onsetQuarters: Rational.ZERO,
    durationQuarters: new Rational(pitches.length),
    timeSignature,
  });
  pitches.forEach((p, i) => {
    builder.addNote(partId, {
      id: builder.newNoteId(),
      pitch: Pitch.parse(p),
      onsetQuarters: new Rational(i),
      duration: Duration.quarter(),
      voice,
    });
  });
  return builder.build();
}

/** A fake HeadlessSynth that records calls — no Web Audio needed. */
function fakeSynth(): HeadlessSynth & {ons: number[]; offs: number[]} {
  const ons: number[] = [];
  const offs: number[] = [];
  return {
    ons,
    offs,
    connect: vi.fn(),
    disconnect: vi.fn(),
    noteOn: (midi) => ons.push(midi),
    noteOff: (midi) => offs.push(midi),
  };
}

function interactiveAudio() {
  let time = 0;
  const ctx = {} as AudioContext;
  const node = () => ({context: ctx, gain: {value: 1}, connect: () => node(), disconnect() {}});
  Object.assign(ctx, {
    state: 'running' as const,
    destination: node(),
    createGain: () => node(),
  });
  Object.defineProperty(ctx, 'currentTime', {get: () => time});
  return {ctx, advance: (milliseconds: number) => (time += milliseconds / 1000)};
}

describe('InteractivePlayer', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('constructs and registers sources without a Web Audio context', () => {
    const player = createInteractivePlayer();
    expect(() => player.addSource('major', buildScore('major', ['C4', 'D4', 'E4', 'F4']))).not.toThrow();
    expect(player.listSources()).toEqual(['major']);
    expect(player.activeSourceId).toBe('major');
    expect(player.position.total).toBe(4);
  });

  it('surfaces a shared Sound route conflict instead of silently dropping playback', () => {
    const {ctx} = interactiveAudio();
    const shared = Sound.custom({connect: () => () => {}, noteOn() {}});
    const first = new InteractivePlayer({audioContext: ctx});
    const second = new InteractivePlayer({audioContext: ctx});
    first.addVoice('first', shared);
    second.addVoice('second', shared);
    void first.context;

    expect(() => second.noteOn('second', 60)).toThrow(/already connected/i);
    first.dispose();
    second.dispose();
  });

  it('buckets notes by beat and pulls them one beat per advance()', () => {
    const player = new InteractivePlayer();
    player.addSource('major', buildScore('major', ['C4', 'D4', 'E4', 'F4']));

    const beats: number[] = [];
    player.on('beat', (b) => beats.push(b.beat));

    expect(player.advance().map((n) => n.midi)).toEqual([Pitch.parse('C4').midi]);
    expect(player.advance().map((n) => n.midi)).toEqual([Pitch.parse('D4').midi]);
    expect(player.position.beat).toBe(2);
    expect(beats).toEqual([0, 1]);
  });

  it('isolates control-plane listener failures and still commits the beat transition', () => {
    const player = new InteractivePlayer();
    player.addSource('s', buildScore('s', ['C4']));
    const failure = new Error('beat listener failed');
    const later = vi.fn();
    const listenerErrors: string[] = [];
    player.on('beat', () => {
      throw failure;
    });
    player.on('beat', later);
    player.on('listenerError', ({event}) => listenerErrors.push(event));

    expect(() => player.advance()).not.toThrow();
    expect(player.position.beat).toBe(0);
    expect(later).toHaveBeenCalledOnce();
    expect(listenerErrors).toEqual(['beat']);
    player.dispose();
  });

  it('wraps the cursor and emits wrap after the final beat', () => {
    const player = new InteractivePlayer();
    player.addSource('s', buildScore('s', ['C4', 'D4']));
    const wraps: string[] = [];
    player.on('wrap', (w) => wraps.push(w.source));
    player.advance(); // beat 0
    player.advance(); // beat 1 -> cursor wraps to 0
    expect(player.position.beat).toBe(0);
    expect(wraps).toEqual(['s']);
  });

  it('keeps trailing rests in a source instead of wrapping after its last onset', () => {
    const builder = new ScoreBuilder();
    const part = PartId('sparse');
    const voice = VoiceId('v');
    const timeSignature = {numerator: 4, denominator: 4};
    builder
      .addTempo({atQuarters: Rational.ZERO, bpm: 120})
      .addMeter({atQuarters: Rational.ZERO, measureNumber: 1, timeSignature});
    builder.addPart({id: part, name: 'Sparse', staves: 1});
    builder.addMeasure({
      id: MeasureId('m1'),
      number: 1,
      onsetQuarters: Rational.ZERO,
      durationQuarters: new Rational(4),
      timeSignature,
    });
    builder.addNote(part, {
      id: builder.newNoteId(),
      pitch: Pitch.parse('C4'),
      onsetQuarters: Rational.ZERO,
      duration: Duration.quarter(),
      voice,
    });

    const player = new InteractivePlayer();
    const wraps: string[] = [];
    player.on('wrap', ({source}) => wraps.push(source));
    player.addSource('sparse', builder.build());

    expect(player.position.total).toBe(4);
    expect(player.advance().map((note) => note.midi)).toEqual([Pitch.parse('C4').midi]);
    expect(player.advance()).toEqual([]);
    expect(player.advance()).toEqual([]);
    expect(player.advance()).toEqual([]);
    expect(wraps).toEqual(['sparse']);
  });

  it('switches sources instantly with proportional position carry', () => {
    const player = new InteractivePlayer();
    player.addSource('major', buildScore('major', ['C4', 'D4', 'E4', 'F4'])); // 4 beats
    player.addSource('minor', buildScore('minor', ['C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4', 'C5'])); // 8 beats

    player.advance();
    player.advance(); // now at beat 2 of 4 -> 50%
    expect(player.position.beat).toBe(2);

    player.select('minor'); // carry 50% -> beat 4 of 8
    expect(player.activeSourceId).toBe('minor');
    expect(player.position.beat).toBe(4);
    expect(player.position.total).toBe(8);
  });

  it('routes parts to voices and plays through the matching synth', () => {
    const player = new InteractivePlayer();
    const piano = fakeSynth();
    player.addVoice('piano', piano);
    player.addSource('s', buildScore('s', ['C4', 'D4']), {route: {Piano: 'piano'}});

    // No AudioContext in node, so synth scheduling is skipped — but routing/data still resolve.
    const notes = player.advance();
    expect(notes[0].voice).toBe('piano');
  });

  it('stays headless-safe: advance() returns data even with no voices/audio', () => {
    const player = new InteractivePlayer();
    player.addSource('s', buildScore('s', ['C4', 'D4']));
    expect(() => player.advance()).not.toThrow();
    expect(player.peek().length).toBeGreaterThanOrEqual(0);
  });

  it('addSourceFromUrl loads a file into a source (parsers lazy-loaded)', async () => {
    const bytes = serializeMIDI(buildScore('major', ['C4', 'D4', 'E4', 'F4']));
    await withFetch(bytes, async () => {
      const player = new InteractivePlayer();
      await player.addSourceFromUrl('major', 'https://example.com/major.mid');
      expect(player.listSources()).toEqual(['major']);
      expect(player.activeSourceId).toBe('major');
      expect(player.position.total).toBe(4);
    });
  });

  it('aborts an in-flight URL source and cannot add sources after disposal', async () => {
    const bytes = serializeMIDI(buildScore('late', ['C4', 'D4']));
    const originalFetch = globalThis.fetch;
    let loadSignal: AbortSignal | undefined;
    let resolveFetch!: (response: Response) => void;
    const response = new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    });
    const fetchStub = vi.fn((_url: string | URL | Request, init?: RequestInit) => {
      loadSignal = init?.signal ?? undefined;
      return response;
    });
    globalThis.fetch = fetchStub as typeof fetch;

    try {
      const player = new InteractivePlayer();
      const loading = player.addSourceFromUrl('late', 'https://example.com/late.mid');
      await vi.waitFor(() => expect(fetchStub).toHaveBeenCalledTimes(1));

      player.dispose();

      expect(loadSignal?.aborted).toBe(true);
      await expect(loading).rejects.toThrow(/abort|disposed/i);
      expect(player.listSources()).toEqual([]);
      expect(() => player.addSource('sync-late', buildScore('late', ['E4']))).toThrow(
        /disposed/i,
      );
      await expect(
        player.addSourceFromUrl('async-late', 'https://example.com/async-late.mid'),
      ).rejects.toThrow(/disposed/i);
      expect(fetchStub).toHaveBeenCalledTimes(1);

      // Settle a fetch implementation which ignored AbortSignal. Its late
      // response must still be unable to resurrect the disposed source index.
      resolveFetch({
        ok: true,
        arrayBuffer: async () => bytes.buffer as ArrayBuffer,
      } as Response);
      await Promise.resolve();
      expect(player.listSources()).toEqual([]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('static fromUrls builds a player with several sources, first active', async () => {
    const bytes = serializeMIDI(buildScore('s', ['C4', 'D4']));
    await withFetch(bytes, async () => {
      const player = await InteractivePlayer.fromUrls({
        major: 'https://example.com/major.mid',
        minor: 'https://example.com/minor.mid',
      });
      expect(player.listSources()).toEqual(['major', 'minor']);
      expect(player.activeSourceId).toBe('major');
    });
  });

  it('inserts a per-voice effect between the synth and its gain bus', () => {
    const node = () => ({gain: {value: 1}, connect: () => node(), disconnect() {}});
    const ctx = {
      get currentTime() {
        return 0;
      },
      state: 'running',
      destination: {},
      createGain: () => node(),
      createConvolver: () => ({buffer: null, connect: () => node(), disconnect() {}}),
      createBuffer: (c: number, l: number) => ({numberOfChannels: c, getChannelData: () => new Float32Array(l)}),
    } as unknown as AudioContext;

    let built = false;
    const effect = Effect.custom((c) => {
      built = true;
      const g = c.createGain();
      return {input: g, output: g};
    });

    const synth = fakeSynth();
    const player = new InteractivePlayer({audioContext: ctx});
    player.addVoice('lead', synth, {effect});
    player.addSource('s', buildScore('s', ['C4', 'D4']));

    player.advance(); // triggers audio init → wires voice through the effect
    expect(built).toBe(true);
    expect(synth.ons).toEqual([Pitch.parse('C4').midi]);
  });

  it('manages voice registration and mix state', () => {
    const player = new InteractivePlayer();
    player.addVoice('a', fakeSynth());
    player.addVoice('b', fakeSynth());
    expect(player.listVoices()).toEqual(['a', 'b']);
    expect(() => player.setMix({a: 0.5, b: 0})).not.toThrow();
    expect(() => player.soloVoice('a')).not.toThrow();
    player.removeVoice('a');
    expect(player.listVoices()).toEqual(['b']);
  });

  it('preloads every routed voice before externally driven playback', async () => {
    const {ctx} = interactiveAudio();
    let resolve!: () => void;
    const loading = new Promise<void>((done) => {
      resolve = done;
    });
    const synth = {
      connect: vi.fn(),
      disconnect: vi.fn(),
      noteOn: vi.fn(),
      preload: vi.fn(() => loading),
    } as HeadlessSynth & {preload: () => Promise<void>};
    const player = new InteractivePlayer({audioContext: ctx});
    player.addVoice('piano', synth);

    const ready = player.preload();
    await Promise.resolve();
    expect(synth.connect).toHaveBeenCalledTimes(1);
    expect(synth.preload).toHaveBeenCalledTimes(1);

    resolve();
    await ready;
    player.dispose();
  });

  it('cleans only a borrowed voice route unless ownership is explicitly transferred', () => {
    const {ctx} = interactiveAudio();
    const routeCleanup = vi.fn();
    const borrowed = {
      connect: vi.fn(() => routeCleanup),
      disconnect: vi.fn(),
      dispose: vi.fn(),
      noteOn: vi.fn(),
    } satisfies HeadlessSynth;
    const borrowedPlayer = new InteractivePlayer({audioContext: ctx});
    borrowedPlayer.addVoice('borrowed', borrowed);
    void borrowedPlayer.context; // build the route before removing the voice
    borrowedPlayer.removeVoice('borrowed');
    expect(routeCleanup).toHaveBeenCalledTimes(1);
    expect(borrowed.disconnect).not.toHaveBeenCalled();
    expect(borrowed.dispose).not.toHaveBeenCalled();

    const owned = {
      connect: vi.fn(),
      disconnect: vi.fn(),
      dispose: vi.fn(),
      noteOn: vi.fn(),
    } satisfies HeadlessSynth;
    const ownedPlayer = new InteractivePlayer();
    ownedPlayer.addVoice('owned', owned, {synthOwnership: 'owned'});
    ownedPlayer.dispose();
    expect(owned.dispose).toHaveBeenCalledTimes(1);
  });

  it('releases overlapping same-MIDI notes by their individual synth handles', () => {
    vi.useFakeTimers();
    const {ctx, advance} = interactiveAudio();
    let nextHandle = 0;
    const released: unknown[] = [];
    const synth: HeadlessSynth = {
      connect() {},
      noteOn: () => ++nextHandle,
      noteOffById: (handle) => released.push(handle),
    };
    const player = new InteractivePlayer({audioContext: ctx, lookaheadSeconds: 0, reverb: false});
    player.addVoice('piano', synth);
    player.play([
      {midi: 60, durationSeconds: 0.1},
      {midi: 60, timeOffsetSeconds: 0.05, durationSeconds: 0.2},
    ]);

    advance(100);
    vi.advanceTimersByTime(100);
    expect(released).toEqual([1]);
    advance(150);
    vi.advanceTimersByTime(150);
    expect(released).toEqual([1, 2]);
    player.dispose();
  });

  it('arms an interactive release before notifying fallible note listeners', () => {
    vi.useFakeTimers();
    const {ctx, advance} = interactiveAudio();
    const synth = fakeSynth();
    const player = new InteractivePlayer({
      audioContext: ctx,
      lookaheadSeconds: 0,
      reverb: false,
    });
    const laterOn = vi.fn();
    const laterOff = vi.fn();
    const listenerErrors: string[] = [];
    player.addVoice('piano', synth);
    player.on('noteOn', () => {
      throw new Error('interactive noteOn listener');
    });
    player.on('noteOn', laterOn);
    player.on('noteOff', () => {
      throw new Error('interactive noteOff listener');
    });
    player.on('noteOff', laterOff);
    player.on('listenerError', ({event}) => listenerErrors.push(event));

    player.noteOn('piano', 60, 100, 0.1);
    advance(100);
    vi.advanceTimersByTime(100);

    expect(laterOn).toHaveBeenCalledTimes(1);
    expect(laterOff).toHaveBeenCalledTimes(1);
    expect(synth.offs).toEqual([60]);
    expect(listenerErrors).toEqual(['noteOn', 'noteOff']);
    player.dispose();
  });

  it('releases a voice created by reentrant removeVoice inside noteOn', () => {
    vi.useFakeTimers();
    const {ctx} = interactiveAudio();
    const released = vi.fn();
    const synth: HeadlessSynth = {
      connect() {},
      noteOn: () => {
        player.removeVoice('lead');
        return 'stale-interactive-voice';
      },
      noteOffById: released,
    };
    const player = new InteractivePlayer({audioContext: ctx, lookaheadSeconds: 0});
    player.addVoice('lead', synth);
    const logicalOn = vi.fn();
    player.on('noteOn', logicalOn);

    expect(() => player.noteOn('lead', 60, 100, 0.5)).not.toThrow();

    expect(player.hasVoice('lead')).toBe(false);
    expect(logicalOn).not.toHaveBeenCalled();
    expect(released).toHaveBeenCalledWith('stale-interactive-voice', 0);
    vi.advanceTimersByTime(1000);
    expect(released).toHaveBeenCalledTimes(1);
    player.dispose();
  });

  it('releases a handle committed after reentrant removeVoice already compensated', () => {
    vi.useFakeTimers();
    const {ctx} = interactiveAudio();
    let sounding = false;
    const pitchRelease = vi.fn(() => {
      sounding = false;
    });
    const exactRelease = vi.fn(() => {
      sounding = false;
    });
    const synth: HeadlessSynth = {
      connect() {},
      noteOn: () => {
        player.removeVoice('lead');
        // The provisional pitch release ran during removeVoice, but this late
        // commit occurs afterward in the same arbitrary backend call.
        sounding = true;
        return 'late-handle';
      },
      noteOff: pitchRelease,
      noteOffById: exactRelease,
    };
    const player = new InteractivePlayer({audioContext: ctx, lookaheadSeconds: 0});
    player.addVoice('lead', synth);

    expect(() => player.noteOn('lead', 60, 100, 0.5)).not.toThrow();

    expect(pitchRelease).toHaveBeenCalledWith(60, 0);
    expect(exactRelease).toHaveBeenCalledWith('late-handle', 0);
    expect(sounding).toBe(false);
    player.dispose();
  });

  it('continues multi-note release and owned disposal after backend throws', () => {
    vi.useFakeTimers();
    const {ctx} = interactiveAudio();
    let nextHandle = 0;
    const noteOffById = vi.fn(() => {
      throw new Error('exact release failed');
    });
    const noteOff = vi.fn(() => {
      throw new Error('pitch release failed');
    });
    const dispose = vi.fn();
    const synth: HeadlessSynth = {
      connect() {},
      noteOn: () => ++nextHandle,
      noteOffById,
      noteOff,
      dispose,
    };
    const player = new InteractivePlayer({audioContext: ctx, lookaheadSeconds: 0});
    player.addVoice('lead', synth, {synthOwnership: 'owned'});
    const operations: string[] = [];
    player.on('operationError', ({operation}) => operations.push(operation));
    player.play([
      {voice: 'lead', midi: 60, durationSeconds: 1},
      {voice: 'lead', midi: 64, durationSeconds: 1},
    ]);

    expect(() => player.dispose()).not.toThrow();

    expect(noteOffById).toHaveBeenCalledTimes(2);
    expect(noteOff).toHaveBeenCalledTimes(2);
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(operations).toEqual([
      'noteOffById',
      'noteOff',
      'noteOffById',
      'noteOff',
    ]);
  });

  it('keeps operationError observers until an owned context close settles', async () => {
    const originalAudioContext = globalThis.AudioContext;
    const {ctx} = interactiveAudio();
    const closeFailure = new Error('async close failed');
    let rejectClose!: (error: Error) => void;
    const closing = new Promise<void>((_resolve, reject) => {
      rejectClose = reject;
    });
    const close = vi.fn(() => closing);
    Object.assign(ctx, {close});
    globalThis.AudioContext = vi.fn(function AudioContextMock() { return ctx; }) as unknown as typeof AudioContext;

    try {
      const player = new InteractivePlayer();
      player.addVoice('lead', fakeSynth());
      void player.context;
      const failures: Array<{operation: string; error: unknown}> = [];
      player.on('operationError', ({operation, error}) => failures.push({operation, error}));

      player.dispose();
      expect(close).toHaveBeenCalledOnce();
      expect(failures).toEqual([]);

      rejectClose(closeFailure);
      await closing.catch(() => undefined);
      await Promise.resolve();

      expect(failures).toEqual([{operation: 'context.close', error: closeFailure}]);
    } finally {
      globalThis.AudioContext = originalAudioContext;
    }
  });

  it('reports a synchronous owned context close failure during disposal', () => {
    const originalAudioContext = globalThis.AudioContext;
    const {ctx} = interactiveAudio();
    const closeFailure = new Error('sync close failed');
    const close = vi.fn(() => {
      throw closeFailure;
    });
    Object.assign(ctx, {close});
    globalThis.AudioContext = vi.fn(function AudioContextMock() { return ctx; }) as unknown as typeof AudioContext;

    try {
      const player = new InteractivePlayer();
      player.addVoice('lead', fakeSynth());
      void player.context;
      const failures: Array<{operation: string; error: unknown}> = [];
      player.on('operationError', ({operation, error}) => failures.push({operation, error}));

      expect(() => player.dispose()).not.toThrow();

      expect(close).toHaveBeenCalledOnce();
      expect(failures).toEqual([{operation: 'context.close', error: closeFailure}]);
    } finally {
      globalThis.AudioContext = originalAudioContext;
    }
  });
});
