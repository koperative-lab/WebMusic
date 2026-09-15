import {afterEach, describe, expect, it, vi} from 'vitest';
import {
  Duration,
  MeasureId,
  PartId,
  Pitch,
  Rational,
  ScoreBuilder,
  VoiceId,
  type NoteData,
} from '../../src/core';
import {ScorePlayer, type HeadlessSynth} from '../../src/play/headless';

function mockAudio(options: {suspended?: boolean; resume?: () => Promise<void>} = {}) {
  let time = 0;
  let state: AudioContextState = options.suspended ? 'suspended' : 'running';
  const param = () => ({
    value: 0,
    setValueAtTime() { return this; },
    exponentialRampToValueAtTime() { return this; },
    cancelScheduledValues() { return this; },
  });
  const node = () => ({gain: param(), connect: () => node(), disconnect() {}});
  const ctx = {
    get currentTime() { return time; },
    get state() { return state; },
    sampleRate: 44100,
    destination: {},
    resume: async () => {
      await options.resume?.();
      state = 'running';
    },
    createGain: () => node(),
    createStereoPanner: () => ({pan: param(), connect: () => node(), disconnect() {}}),
  } as unknown as AudioContext;
  return {ctx, advance: (milliseconds: number) => (time += milliseconds / 1000), suspend: () => {state = 'suspended';}};
}

function run(advance: (milliseconds: number) => void, totalMilliseconds: number, step = 10) {
  for (let elapsed = 0; elapsed < totalMilliseconds; elapsed += step) {
    advance(step);
    vi.advanceTimersByTime(step);
  }
}

function scoreWith(
  notes: Array<Partial<NoteData> & Pick<NoteData, 'onsetQuarters' | 'duration'>>,
) {
  const builder = new ScoreBuilder();
  const part = PartId('part');
  const voice = VoiceId('voice');
  const timeSignature = {numerator: 4, denominator: 4};
  builder
    .addTempo({atQuarters: Rational.ZERO, bpm: 120})
    .addMeter({atQuarters: Rational.ZERO, measureNumber: 1, timeSignature});
  builder.addPart({id: part, name: 'Part', staves: 1});
  builder.addMeasure({
    id: MeasureId('m1'),
    number: 1,
    onsetQuarters: Rational.ZERO,
    durationQuarters: new Rational(4),
    timeSignature,
  });
  for (const note of notes) {
    builder.addNote(part, {id: builder.newNoteId(), voice, ...note} as NoteData);
  }
  return builder.build();
}

function trackedSynth(): HeadlessSynth & {
  ons: Array<{midi: number; time: number; duration: number}>;
  released: Array<{handle: unknown; time: number}>;
} {
  let nextHandle = 0;
  const ons: Array<{midi: number; time: number; duration: number}> = [];
  const released: Array<{handle: unknown; time: number}> = [];
  return {
    ons,
    released,
    connect() {},
    disconnect() {},
    noteOn: (midi, _velocity, time, duration) => {
      ons.push({midi, time, duration});
      return ++nextHandle;
    },
    noteOffById: (handle, time) => released.push({handle, time}),
  };
}

/** A legacy polyphonic backend that can only release by MIDI pitch. */
function pitchOnlySynth(): HeadlessSynth & {offs: number[]; ons: number[]} {
  const offs: number[] = [];
  const ons: number[] = [];
  return {
    offs,
    ons,
    connect() {},
    noteOn: (midi) => ons.push(midi),
    noteOff: (midi) => offs.push(midi),
  };
}

/** A backend which opts into exact AudioContext-clock lookahead cancellation. */
function clockScheduledSynth(): HeadlessSynth & {
  ons: Array<{handle: number; midi: number; time: number; duration: number}>;
  cancelled: Array<{handle: unknown; time: number}>;
  released: Array<{handle: unknown; time: number}>;
  retimed: Array<{handle: unknown; time: number}>;
} {
  let nextHandle = 0;
  const ons: Array<{handle: number; midi: number; time: number; duration: number}> = [];
  const cancelled: Array<{handle: unknown; time: number}> = [];
  const released: Array<{handle: unknown; time: number}> = [];
  const retimed: Array<{handle: unknown; time: number}> = [];
  return {
    ons,
    cancelled,
    released,
    retimed,
    connect() {},
    disconnect() {},
    supportsScheduledCancellation: true,
    noteOn: (midi, _velocity, time, duration) => {
      const handle = ++nextHandle;
      ons.push({handle, midi, time, duration});
      return handle;
    },
    cancelScheduledNote: (handle, time) => cancelled.push({handle, time}),
    noteOffById: (handle, time) => released.push({handle, time}),
    retimeScheduledNote: (handle, time) => retimed.push({handle, time}),
  };
}

describe('ScorePlayer scheduler regressions', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('isolates playback listeners without stranding release or transport work', async () => {
    vi.useFakeTimers();
    const {ctx, advance} = mockAudio();
    const synth = trackedSynth();
    const score = scoreWith([
      {pitch: Pitch.parse('C4'), onsetQuarters: Rational.ZERO, duration: Duration.quarter()},
    ]);
    const player = new ScorePlayer(score, {
      audioContext: ctx,
      synth,
      schedulerIntervalMs: 10,
      cursorIntervalMs: 10,
      reverb: false,
    });
    const laterOn = vi.fn();
    const laterOff = vi.fn();
    const laterUpdate = vi.fn();
    const laterEnd = vi.fn();
    const listenerErrors: string[] = [];
    const fail = (label: string) => (): void => {
      throw new Error(label);
    };
    let failedUpdate = false;

    player.on('noteOn', fail('noteOn listener'));
    player.on('noteOn', laterOn);
    player.on('noteOff', fail('noteOff listener'));
    player.on('noteOff', laterOff);
    player.on('timeupdate', () => {
      if (failedUpdate) return;
      failedUpdate = true;
      throw new Error('timeupdate listener');
    });
    player.on('timeupdate', laterUpdate);
    player.on('end', fail('end listener'));
    player.on('end', laterEnd);
    player.on('listenerError', ({kind, event}) => {
      expect(kind).toBe('listenerError');
      listenerErrors.push(event);
    });

    await player.play();
    run(advance, 2200);

    expect(laterOn).toHaveBeenCalledTimes(1);
    expect(laterOff).toHaveBeenCalledTimes(1);
    expect(laterUpdate).toHaveBeenCalled();
    expect(laterEnd).toHaveBeenCalledTimes(1);
    expect(synth.released).toHaveLength(1);
    expect(player.isPlaying()).toBe(false);
    expect(listenerErrors).toEqual(expect.arrayContaining([
      'noteOn',
      'noteOff',
      'timeupdate',
      'end',
    ]));
    player.dispose();
  });

  it('releases a JIT voice created by a reentrant stop inside noteOn', async () => {
    vi.useFakeTimers();
    const {ctx, advance} = mockAudio();
    const released = vi.fn();
    const synth: HeadlessSynth = {
      connect() {},
      noteOn: () => {
        player.stop();
        return 'stale-jit-voice';
      },
      noteOffById: released,
    };
    const player = new ScorePlayer(scoreWith([
      {pitch: Pitch.parse('C4'), onsetQuarters: Rational.ZERO, duration: Duration.quarter()},
    ]), {audioContext: ctx, synth, reverb: false});
    const logicalOn = vi.fn();
    player.on('noteOn', logicalOn);

    await player.play();
    run(advance, 10);

    expect(player.isPlaying()).toBe(false);
    expect(logicalOn).not.toHaveBeenCalled();
    expect(released).toHaveBeenCalledTimes(1);
    expect(released).toHaveBeenCalledWith('stale-jit-voice', ctx.currentTime);
    player.dispose();
  });

  it('cancels a future voice created by a reentrant stop inside noteOn', async () => {
    vi.useFakeTimers();
    const {ctx} = mockAudio();
    const cancelled = vi.fn();
    const released = vi.fn();
    const synth: HeadlessSynth = {
      connect() {},
      supportsScheduledCancellation: true,
      noteOn: () => {
        player.stop();
        return 'stale-clock-voice';
      },
      cancelScheduledNote: cancelled,
      noteOffById: released,
    };
    const player = new ScorePlayer(scoreWith([
      {pitch: Pitch.parse('C4'), onsetQuarters: Rational.ONE, duration: Duration.quarter()},
    ]), {
      audioContext: ctx,
      synth,
      lookaheadSeconds: 1,
      reverb: false,
    });
    await player.play();

    expect(player.isPlaying()).toBe(false);
    expect(cancelled).toHaveBeenCalledWith('stale-clock-voice', ctx.currentTime);
    expect(released).not.toHaveBeenCalled();
    player.dispose();
  });

  it('continues releasing voices and owned cleanup when backend releases throw', async () => {
    vi.useFakeTimers();
    const {ctx, advance} = mockAudio();
    let nextHandle = 0;
    const noteOffById = vi.fn(() => {
      throw new Error('exact release failed');
    });
    const dispose = vi.fn();
    const synth: HeadlessSynth = {
      connect() {},
      noteOn: () => ++nextHandle,
      noteOffById,
      dispose,
    };
    const player = new ScorePlayer(scoreWith([
      {pitch: Pitch.parse('C4'), onsetQuarters: Rational.ZERO, duration: Duration.half()},
      {pitch: Pitch.parse('E4'), onsetQuarters: Rational.ZERO, duration: Duration.half()},
    ]), {
      audioContext: ctx,
      synth,
      synthOwnership: 'owned',
      reverb: false,
    });
    const operations: string[] = [];
    player.on('operationError', ({operation}) => operations.push(operation));

    await player.play();
    run(advance, 10);
    expect(() => player.dispose()).not.toThrow();

    expect(noteOffById).toHaveBeenCalledTimes(2);
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(player.isPlaying()).toBe(false);
    expect(operations).toEqual(['noteOffById', 'noteOffById']);
  });

  it('places future capable-synth notes on the audio clock before JS timers fire', async () => {
    vi.useFakeTimers();
    const {ctx} = mockAudio();
    const synth = clockScheduledSynth();
    const score = scoreWith([
      {pitch: Pitch.parse('C4'), onsetQuarters: Rational.ONE, duration: Duration.quarter()},
      {pitch: Pitch.parse('D4'), onsetQuarters: new Rational(2), duration: Duration.quarter()},
    ]);
    const player = new ScorePlayer(score, {
      audioContext: ctx,
      synth,
      lookaheadSeconds: 1.1,
      reverb: false,
    });
    const logicalOn = vi.fn();
    const logicalOff = vi.fn();
    player.on('noteOn', logicalOn);
    player.on('noteOff', logicalOff);

    await player.play();

    // No fake timer has advanced: these calls prove the scheduler submitted
    // absolute AudioContext timestamps while their logical events remain at
    // the transport onset.
    expect(synth.ons.map(({midi, time}) => ({midi, time}))).toEqual([
      {midi: Pitch.parse('C4').midi, time: 0.5},
      {midi: Pitch.parse('D4').midi, time: 1},
    ]);
    expect(logicalOn).not.toHaveBeenCalled();

    player.pause();

    // Neither voice reached its transport event, so both are retracted with
    // no matching public noteOn/noteOff pair leaked to consumers.
    expect(synth.cancelled.map(({handle}) => handle)).toEqual(synth.ons.map(({handle}) => handle));
    expect(logicalOn).not.toHaveBeenCalled();
    expect(logicalOff).not.toHaveBeenCalled();
  });

  it('preserves sub-10ms gates for audio-clock lookahead backends', async () => {
    vi.useFakeTimers();
    const {ctx} = mockAudio();
    const synth = clockScheduledSynth();
    const score = scoreWith([
      {
        pitch: Pitch.parse('C4'),
        onsetQuarters: Rational.ZERO,
        duration: Duration.quarter(),
        performed: {onsetSec: 0, durationSec: 0.005, velocity: 100},
      },
    ]);
    const player = new ScorePlayer(score, {audioContext: ctx, synth, reverb: false});

    await player.play();

    expect(synth.ons).toHaveLength(1);
    expect(synth.ons[0].time).toBe(0);
    expect(synth.ons[0].duration).toBeCloseTo(0.005, 6);
    player.stop();
  });

  it('uses only the remaining gate when a JIT timer fires late and drops an expired event', async () => {
    vi.useFakeTimers();
    const {ctx, advance} = mockAudio();
    const synth = trackedSynth();
    const score = scoreWith([
      {
        pitch: Pitch.parse('C4'),
        onsetQuarters: Rational.ZERO,
        duration: Duration.quarter(),
        performed: {onsetSec: 0, durationSec: 0.205, velocity: 100},
      },
      {
        pitch: Pitch.parse('D4'),
        onsetQuarters: Rational.ONE,
        duration: Duration.quarter(),
        performed: {onsetSec: 1, durationSec: 0.1, velocity: 100},
      },
    ]);
    const player = new ScorePlayer(score, {
      audioContext: ctx,
      synth,
      lookaheadSeconds: 0.05,
      schedulerIntervalMs: 25,
      reverb: false,
    });

    await player.play();
    // Simulate an AudioContext which advanced while the zero-delay JS timer
    // was starved. The attack must retain the original 0.205s logical endpoint
    // and must not stretch the remaining 5ms gate to an invented 10ms minimum.
    advance(200);
    vi.advanceTimersByTime(1);

    expect(synth.ons).toHaveLength(1);
    expect(synth.ons[0].time).toBeCloseTo(0.2, 6);
    expect(synth.ons[0].duration).toBeCloseTo(0.005, 6);

    // Starve the scheduler past D4's complete 1.0-1.1s gate. It must not
    // invent a minimum-duration attack after that logical endpoint.
    advance(1000);
    vi.advanceTimersByTime(25);
    expect(synth.ons).toHaveLength(1);
    player.stop();
  });

  it('starts a starved attack from the tick when its own timer never fires', async () => {
    vi.useFakeTimers();
    const {ctx, advance} = mockAudio();
    const synth = trackedSynth();
    // A backend without scheduled cancellation: the sound happens in the JS
    // callback, so a starved timer is a silent note, not just a late event.
    const score = scoreWith([
      {pitch: Pitch.parse('C4'), onsetQuarters: Rational.ZERO, duration: Duration.quarter()},
    ]);
    let tick = () => {};
    const player = new ScorePlayer(score, {
      audioContext: ctx,
      synth,
      lookaheadSeconds: 0.05,
      schedulerIntervalMs: 25,
      reverb: false,
      // A manually driven tick source: firing it without running the fake
      // timers is exactly the starved-timer situation this sweep exists for.
      createTickSource: () => ({
        start(onTick: () => void) {
          tick = onTick;
        },
        stop() {
          tick = () => {};
        },
        get running() {
          return true;
        },
        get workerBacked() {
          return true;
        },
        dispose() {
          tick = () => {};
        },
      }),
    });

    await player.play();
    expect(synth.ons).toHaveLength(0);

    // The audio clock runs past the onset by more than a tick while the
    // per-record timer stays clamped (a hidden tab). Firing ONLY the tick is
    // what separates the two: the worker-backed source still gets through, so
    // the sweep must play the note the starved timer never would have.
    advance(100);
    tick();

    expect(synth.ons).toHaveLength(1);
    expect(synth.ons[0].time).toBeCloseTo(0.1, 6);
    player.stop();
  });

  it.each([
    ['JIT backend', trackedSynth],
    ['clock-scheduled backend', clockScheduledSynth],
  ] as const)('waits for the audio clock before future attacks/events on a %s', async (_name, createSynth) => {
    vi.useFakeTimers();
    const {ctx, advance, suspend} = mockAudio();
    const synth = createSynth();
    const score = scoreWith([{
      pitch: Pitch.parse('C4'), onsetQuarters: new Rational(1, 5), duration: Duration.quarter(),
    }]);
    const player = new ScorePlayer(score, {audioContext: ctx, synth, lookaheadSeconds: 0.2, reverb: false});
    const onNote = vi.fn();
    player.on('noteOn', onNote);
    await player.play();
    const preScheduled = synth.supportsScheduledCancellation ? 1 : 0;
    expect(synth.ons).toHaveLength(preScheduled);
    suspend();
    vi.advanceTimersByTime(1000);
    expect(synth.ons).toHaveLength(preScheduled);
    expect(onNote).not.toHaveBeenCalled();
    await ctx.resume();
    run(advance, 80);
    expect(onNote).not.toHaveBeenCalled();
    run(advance, 40);
    expect(onNote).toHaveBeenCalledOnce();
    expect(synth.ons).toHaveLength(1);
    expect(synth.ons[0].time).toBeGreaterThanOrEqual(0.1);
    player.dispose();
  });

  it('cancels a re-armed attack when paused during an interruption', async () => {
    vi.useFakeTimers();
    const {ctx, advance, suspend} = mockAudio();
    const synth = clockScheduledSynth();
    const score = scoreWith([{
      pitch: Pitch.parse('C4'), onsetQuarters: new Rational(1, 5), duration: Duration.quarter(),
    }]);
    const player = new ScorePlayer(score, {audioContext: ctx, synth, lookaheadSeconds: 0.2, reverb: false});
    const onNote = vi.fn();
    player.on('noteOn', onNote);
    await player.play();
    suspend();
    vi.advanceTimersByTime(150);
    player.pause();
    expect(synth.cancelled).toHaveLength(1);
    await ctx.resume();
    run(advance, 1000);
    expect(onNote).not.toHaveBeenCalled();
    expect(synth.ons).toHaveLength(1);
    player.dispose();
  });

  it('does not release a voice while the audio clock is suspended', async () => {
    vi.useFakeTimers();
    const {ctx, advance} = mockAudio();
    const synth = trackedSynth();
    const score = scoreWith([
      {
        pitch: Pitch.parse('C4'),
        onsetQuarters: Rational.ZERO,
        duration: Duration.quarter(),
        performed: {onsetSec: 0, durationSec: 0.5, velocity: 100},
      },
    ]);
    const player = new ScorePlayer(score, {audioContext: ctx, synth, reverb: false});

    await player.play();
    // Let the note start, then freeze the audio clock the way an OS audio
    // interruption does: wall time keeps running, ctx.currentTime does not.
    advance(10);
    vi.advanceTimersByTime(10);
    expect(synth.ons).toHaveLength(1);
    expect(synth.released).toHaveLength(0);

    // The wall clock passes the note's whole gate while the audio clock is
    // frozen. Releasing on timer arrival would cut a voice that has not
    // finished sounding.
    vi.advanceTimersByTime(2_000);
    expect(synth.released).toHaveLength(0);

    // Once the context resumes, the release lands as scheduled.
    advance(600);
    vi.advanceTimersByTime(50);
    expect(synth.released).toHaveLength(1);
    player.stop();
  });

  it.each(['jit', 'scheduled'] as const)(
    'keeps %s attacks and logical events pending while the audio clock is frozen',
    async (backend) => {
      vi.useFakeTimers();
      const {ctx, advance} = mockAudio();
      const synth = backend === 'jit' ? trackedSynth() : clockScheduledSynth();
      const player = new ScorePlayer(scoreWith([
        {pitch: Pitch.parse('C4'), onsetQuarters: Rational.ONE, duration: Duration.quarter()},
      ]), {audioContext: ctx, synth, lookaheadSeconds: 1, reverb: false});
      const logicalOn = vi.fn();
      player.on('noteOn', logicalOn);

      await player.play();
      vi.advanceTimersByTime(2_000);

      expect(player.nominalSeconds).toBe(0);
      expect(logicalOn).not.toHaveBeenCalled();
      expect(synth.ons).toHaveLength(backend === 'jit' ? 0 : 1);

      advance(500);
      vi.advanceTimersByTime(25);
      expect(logicalOn).toHaveBeenCalledTimes(1);
      expect(synth.ons).toHaveLength(1);
      expect(synth.ons[0].time).toBeCloseTo(0.5, 6);
      player.dispose();
    },
  );

  it('honours a play requested by the noteOff callback of pause', async () => {
    vi.useFakeTimers();
    const {ctx, advance} = mockAudio();
    const synth = clockScheduledSynth();
    const player = new ScorePlayer(scoreWith([
      {pitch: Pitch.parse('C4'), onsetQuarters: Rational.ZERO, duration: Duration.quarter()},
    ]), {audioContext: ctx, synth, reverb: false});
    let restart: Promise<void> | undefined;
    let restarted = false;
    player.on('noteOff', () => {
      if (restarted) return;
      restarted = true;
      restart = player.play();
    });
    await player.play();
    run(advance, 100);

    player.pause();
    await restart;
    expect(player.isPlaying()).toBe(true);
    expect(synth.ons).toHaveLength(2);
    run(advance, 500);
    expect(synth.released.map(({handle}) => handle)).toEqual([1, 2]);
    player.dispose();
  });

  it('honours a seek requested by the noteOff callback of stop', async () => {
    vi.useFakeTimers();
    const {ctx, advance} = mockAudio();
    const player = new ScorePlayer(scoreWith([
      {pitch: Pitch.parse('C4'), onsetQuarters: Rational.ZERO, duration: Duration.quarter()},
    ]), {audioContext: ctx, synth: trackedSynth(), reverb: false});
    player.on('noteOff', () => void player.seek(1));
    await player.play();
    run(advance, 100);

    player.stop();

    expect(player.isPlaying()).toBe(false);
    expect(player.seconds).toBe(1);
    player.dispose();
  });

  it('does not resume a seek after its cursor listener requests pause', async () => {
    vi.useFakeTimers();
    const {ctx, advance} = mockAudio();
    const player = new ScorePlayer(scoreWith([
      {pitch: Pitch.parse('C4'), onsetQuarters: Rational.ZERO, duration: Duration.quarter()},
    ]), {audioContext: ctx, synth: trackedSynth(), reverb: false});
    await player.play();
    run(advance, 100);
    let paused = false;
    player.on('timeupdate', ({seconds}) => {
      if (seconds !== 1 || paused) return;
      paused = true;
      player.pause();
    });

    await player.seek(1);

    expect(player.isPlaying()).toBe(false);
    expect(player.seconds).toBe(1);
    player.dispose();
  });

  it('does not restore the old position after a loop-edit release listener stops playback', async () => {
    vi.useFakeTimers();
    const {ctx, advance} = mockAudio();
    const player = new ScorePlayer(scoreWith([
      {pitch: Pitch.parse('C4'), onsetQuarters: Rational.ZERO, duration: Duration.quarter()},
    ]), {audioContext: ctx, synth: trackedSynth(), reverb: false});
    player.on('noteOff', () => player.stop());
    await player.play();
    run(advance, 100);

    player.setLoop(1, 1.5);

    expect(player.isPlaying()).toBe(false);
    expect(player.seconds).toBe(0);
    player.dispose();
  });

  it('does not restore the old position after rate-change cancellation stops playback', async () => {
    vi.useFakeTimers();
    const {ctx, advance} = mockAudio();
    const synth = clockScheduledSynth();
    const cancel = synth.cancelScheduledNote!;
    const player = new ScorePlayer(scoreWith([
      {pitch: Pitch.parse('C4'), onsetQuarters: Rational.ONE, duration: Duration.quarter()},
    ]), {audioContext: ctx, synth, lookaheadSeconds: 1, reverb: false});
    synth.cancelScheduledNote = (handle, time) => {
      cancel(handle, time);
      player.stop();
    };
    await player.play();
    run(advance, 100);

    player.setRate(2);

    expect(player.isPlaying()).toBe(false);
    expect(player.nominalSeconds).toBe(0);
    player.dispose();
  });

  it('does not publish an obsolete timeupdate after a cursor listener seeks', async () => {
    const player = new ScorePlayer(scoreWith([
      {pitch: Pitch.parse('C4'), onsetQuarters: Rational.ZERO, duration: Duration.quarter()},
    ]));
    const updates: number[] = [];
    let moved = false;
    player.on('cursor', () => {
      if (moved) return;
      moved = true;
      void player.seek(1);
    });
    player.on('timeupdate', ({seconds}) => updates.push(seconds));

    await player.seek(0.5);

    expect(player.seconds).toBe(1);
    expect(updates).toEqual([1]);
    player.dispose();
  });

  it('keeps a sounding voice when the loop region changes around it', async () => {
    vi.useFakeTimers();
    const {ctx, advance} = mockAudio();
    const synth = trackedSynth();
    const score = scoreWith([
      {
        pitch: Pitch.parse('C4'),
        onsetQuarters: Rational.ZERO,
        duration: Duration.whole(),
        performed: {onsetSec: 0, durationSec: 2, velocity: 100},
      },
    ]);
    const player = new ScorePlayer(score, {audioContext: ctx, synth, reverb: false});

    await player.play();
    advance(100);
    vi.advanceTimersByTime(100);
    expect(synth.ons).toHaveLength(1);
    expect(synth.released).toHaveLength(0);

    // Widening a loop around the playhead must not retrigger the note: the
    // envelope would restart and consumers would see a spurious off/on pair.
    player.setLoop(0, 1.5);
    advance(50);
    vi.advanceTimersByTime(50);

    expect(synth.ons).toHaveLength(1);
    expect(synth.released).toHaveLength(0);
    player.stop();
  });

  it('retracts future audio-clock commitments on seek, rate, and loop edits', async () => {
    vi.useFakeTimers();
    const {ctx, advance} = mockAudio();
    const synth = clockScheduledSynth();
    const d4 = Pitch.parse('D4').midi;
    const score = scoreWith([
      {pitch: Pitch.parse('C4'), onsetQuarters: Rational.ZERO, duration: Duration.quarter()},
      {pitch: Pitch.parse('D4'), onsetQuarters: Rational.ONE, duration: Duration.quarter()},
      {pitch: Pitch.parse('E4'), onsetQuarters: new Rational(2), duration: Duration.quarter()},
    ]);
    const player = new ScorePlayer(score, {
      audioContext: ctx,
      synth,
      lookaheadSeconds: 1.1,
      schedulerIntervalMs: 10,
      reverb: false,
    });
    const logicalD4 = vi.fn();
    player.on('noteOn', (note) => {
      if (note.pitch?.midi === d4) logicalD4();
    });

    await player.play();
    run(advance, 10); // C4 is logically started; D4 is only audio-scheduled.
    const originalD4 = synth.ons.find((note) => note.midi === d4);
    expect(originalD4).toBeDefined();

    player.seek(0.1);
    expect(synth.cancelled.map(({handle}) => handle)).toContain(originalD4?.handle);
    const seekedD4 = synth.ons.filter((note) => note.midi === d4).at(-1);
    expect(seekedD4?.handle).not.toBe(originalD4?.handle);

    player.setRate(2);
    expect(synth.cancelled.map(({handle}) => handle)).toContain(seekedD4?.handle);
    // The replacement uses the new scale rather than leaving the old attack
    // queued at 0.5 seconds.
    const retimedD4 = synth.ons.filter((note) => note.midi === d4).at(-1);
    expect(retimedD4?.time).toBeCloseTo(0.21, 3);

    // A loop change rebuilds the current pass too, retracting any future
    // audio-clock commitment outside the new half-open region.
    player.setLoop(0, 0.2);
    expect(synth.cancelled.map(({handle}) => handle)).toContain(retimedD4?.handle);
    expect(logicalD4).not.toHaveBeenCalled();
    player.stop();
  });

  it('retimes an already started capable voice hard endpoint on a rate change', async () => {
    vi.useFakeTimers();
    const {ctx, advance} = mockAudio();
    const synth = clockScheduledSynth();
    const score = scoreWith([
      {pitch: Pitch.parse('C4'), onsetQuarters: Rational.ZERO, duration: Duration.quarter()},
    ]);
    const player = new ScorePlayer(score, {audioContext: ctx, synth, reverb: false});

    await player.play();
    run(advance, 100); // C4 is now logically and physically active (0–0.5s).
    const handle = synth.ons[0]?.handle;
    player.setRate(0.5);

    // 0.4 nominal seconds remain; at 0.5× their new audio-clock endpoint is
    // 0.1 + 0.4 / 0.5 = 0.9s, replacing the original 0.5s hard stop.
    expect(synth.retimed).toEqual([{handle, time: 0.9}]);
    player.stop();
  });

  it('starts the second loop pass at the boundary, not the next scheduler tick', async () => {
    vi.useFakeTimers();
    const {ctx, advance} = mockAudio();
    const synth = trackedSynth();
    const score = scoreWith([
      {pitch: Pitch.parse('C4'), onsetQuarters: Rational.ZERO, duration: Duration.quarter()},
    ]);
    const player = new ScorePlayer(score, {
      audioContext: ctx,
      synth,
      lookaheadSeconds: 0.05,
      schedulerIntervalMs: 25,
      cursorIntervalMs: 100,
      reverb: false,
    });

    // The loop boundary (0.502s) deliberately sits just after the cadence
    // tick at 0.500s. A scheduler that only polls every 25ms would detect the
    // wrap at 0.525s and delay the whole second pass by ~23ms; the
    // boundary-aimed timer must keep that drift well under one interval.
    player.setLoop(0, 0.502);
    await player.play();
    run(advance, 700, 5);

    const c4 = Pitch.parse('C4').midi;
    const attacks = synth.ons.filter((note) => note.midi === c4);
    expect(attacks.length).toBeGreaterThanOrEqual(2);
    expect(attacks[1].time).toBeGreaterThanOrEqual(0.502);
    expect(attacks[1].time - 0.502).toBeLessThan(0.01);
    player.stop();
  });

  it('clips lookahead and releases voices at a loop boundary', async () => {
    vi.useFakeTimers();
    const {ctx, advance} = mockAudio();
    const synth = trackedSynth();
    const c4 = Pitch.parse('C4').midi;
    const d4 = Pitch.parse('D4').midi;
    const score = scoreWith([
      {pitch: Pitch.parse('C4'), onsetQuarters: Rational.ZERO, duration: Duration.whole()},
      {pitch: Pitch.parse('D4'), onsetQuarters: Rational.ONE, duration: Duration.quarter()},
    ]);
    const player = new ScorePlayer(score, {
      audioContext: ctx,
      synth,
      lookaheadSeconds: 0.2,
      schedulerIntervalMs: 10,
      reverb: false,
    });

    player.setLoop(0, 0.5);
    await player.play();
    run(advance, 1600);

    expect(synth.ons.filter((note) => note.midi === c4).length).toBeGreaterThanOrEqual(3);
    // D4 begins exactly at loopEnd and must never leak from lookahead.
    expect(synth.ons.filter((note) => note.midi === d4)).toHaveLength(0);
    // The sustained C is stopped before every next pass, rather than stacking
    // voices until its original 2-second endpoint.
    expect(synth.released.length).toBeGreaterThanOrEqual(2);
    player.stop();
  });

  it('retimes an already sounding note release when rate changes', async () => {
    vi.useFakeTimers();
    const {ctx, advance} = mockAudio();
    const synth = trackedSynth();
    const score = scoreWith([
      {pitch: Pitch.parse('C4'), onsetQuarters: Rational.ZERO, duration: Duration.quarter()},
    ]);
    const player = new ScorePlayer(score, {audioContext: ctx, synth, reverb: false});

    await player.play();
    run(advance, 100); // C4 is sounding; nominal endpoint is 0.5s.
    player.setRate(0.5);
    run(advance, 700);
    expect(synth.released).toHaveLength(0);
    run(advance, 200);

    // 0.4 nominal seconds remain at 0.5×, so release moves from 0.5s to ~0.9s.
    expect(synth.released).toHaveLength(1);
    expect(synth.released[0].time).toBeGreaterThan(0.85);
    expect(synth.released[0].time).toBeLessThan(0.96);
    player.stop();
  });

  it('keeps an overlapping same-pitch legacy voice alive until its final release', async () => {
    vi.useFakeTimers();
    const {ctx, advance} = mockAudio();
    const synth = pitchOnlySynth();
    const c4 = Pitch.parse('C4').midi;
    const score = scoreWith([
      {pitch: Pitch.parse('C4'), onsetQuarters: Rational.ZERO, duration: Duration.half()},
      {pitch: Pitch.parse('C4'), onsetQuarters: Rational.ONE, duration: Duration.half()},
    ]);
    const player = new ScorePlayer(score, {audioContext: ctx, synth, reverb: false});

    await player.play();
    run(advance, 1050); // first C4 ends at 1.0s; second remains until 1.5s.

    expect(synth.ons).toEqual([c4, c4]);
    expect(synth.offs).toEqual([]);

    run(advance, 600);
    expect(synth.offs).toEqual([c4]);
    player.stop();
  });

  it('requeues a lookahead-committed future note when rate changes', async () => {
    vi.useFakeTimers();
    const {ctx, advance} = mockAudio();
    const synth = trackedSynth();
    const score = scoreWith([
      {pitch: Pitch.parse('C4'), onsetQuarters: Rational.ZERO, duration: Duration.quarter()},
      {pitch: Pitch.parse('D4'), onsetQuarters: Rational.ONE, duration: Duration.quarter()},
    ]);
    const player = new ScorePlayer(score, {
      audioContext: ctx,
      synth,
      // D4 is committed immediately, but its attack is still in the future.
      lookaheadSeconds: 1,
      reverb: false,
    });

    await player.play();
    run(advance, 100);
    player.setRate(2);
    run(advance, 350);

    expect(synth.ons.map((note) => note.midi)).toEqual([
      Pitch.parse('C4').midi,
      Pitch.parse('D4').midi,
    ]);
    expect(synth.ons[1].time).toBeGreaterThan(0.28);
    expect(synth.ons[1].time).toBeLessThan(0.34);
    player.stop();
  });

  it('keeps a loop on the same musical region after setRate()', async () => {
    vi.useFakeTimers();
    const {ctx, advance} = mockAudio();
    const synth = trackedSynth();
    const score = scoreWith([
      {pitch: Pitch.parse('C4'), onsetQuarters: Rational.ZERO, duration: Duration.quarter()},
      {pitch: Pitch.parse('D4'), onsetQuarters: Rational.ONE, duration: Duration.quarter()},
      {pitch: Pitch.parse('E4'), onsetQuarters: new Rational(2), duration: Duration.quarter()},
      {pitch: Pitch.parse('F4'), onsetQuarters: new Rational(3), duration: Duration.quarter()},
    ]);
    const player = new ScorePlayer(score, {
      audioContext: ctx,
      synth,
      lookaheadSeconds: 0.1,
      schedulerIntervalMs: 10,
      reverb: false,
    });

    // These public endpoints are transport seconds at rate 1, representing
    // nominal score seconds 0.5 .. 1.5. The half-open loop starts on D4 and
    // must exclude the F4 attack at 1.5s.
    player.setLoop(0.5, 1.5);
    await player.play();
    run(advance, 100);
    player.setRate(2);

    // At 2x the remaining 0.9 nominal seconds take 0.45 real seconds. A
    // stale transport-domain endpoint would instead sit beyond the 1s total
    // duration and never wrap; D4 therefore proves the same musical loop
    // restarted.
    run(advance, 700);
    const midis = synth.ons.map((note) => note.midi);
    expect(midis.filter((midi) => midi === Pitch.parse('D4').midi).length).toBeGreaterThanOrEqual(2);
    expect(midis).not.toContain(Pitch.parse('F4').midi);
    player.stop();
  });

  it('coalesces concurrent play calls while a suspended context resumes', async () => {
    vi.useFakeTimers();
    let resume!: () => void;
    const pendingResume = new Promise<void>((resolve) => { resume = resolve; });
    const resumeSpy = vi.fn(() => pendingResume);
    const {ctx, advance} = mockAudio({suspended: true, resume: resumeSpy});
    const synth = trackedSynth();
    const score = scoreWith([
      {pitch: Pitch.parse('C4'), onsetQuarters: Rational.ZERO, duration: Duration.quarter()},
    ]);
    const player = new ScorePlayer(score, {audioContext: ctx, synth, reverb: false});

    const first = player.play();
    const second = player.play();
    expect(first).toBe(second);
    expect(resumeSpy).toHaveBeenCalledTimes(1);
    resume();
    await Promise.all([first, second]);
    run(advance, 20);

    expect(synth.ons).toHaveLength(1);
    player.stop();
  });

  it('honours a synchronous pause re-entered from graph construction', async () => {
    const {ctx} = mockAudio();
    const noteOn = vi.fn();
    const control: {pause?: () => void} = {};
    const synth: HeadlessSynth = {
      connect: () => control.pause?.(),
      noteOn,
    };
    const player = new ScorePlayer(scoreWith([
      {pitch: Pitch.parse('C4'), onsetQuarters: Rational.ZERO, duration: Duration.quarter()},
    ]), {audioContext: ctx, synth, reverb: false});
    control.pause = () => player.pause();

    await expect(player.play()).resolves.toBeUndefined();

    expect(player.isPlaying()).toBe(false);
    expect(noteOn).not.toHaveBeenCalled();
    player.dispose();
  });

  it('honours a synchronous stop re-entered from preload before startPromise is assigned', async () => {
    const {ctx} = mockAudio();
    const noteOn = vi.fn();
    const control: {stop?: () => void} = {};
    const synth = {
      connect() {},
      noteOn,
      preload: vi.fn(() => {
        control.stop?.();
        return Promise.resolve();
      }),
    } satisfies HeadlessSynth & {preload(): Promise<void>};
    const player = new ScorePlayer(scoreWith([
      {pitch: Pitch.parse('C4'), onsetQuarters: Rational.ZERO, duration: Duration.quarter()},
    ]), {audioContext: ctx, synth, reverb: false});
    control.stop = () => player.stop();

    await expect(player.play()).resolves.toBeUndefined();

    expect(synth.preload).toHaveBeenCalledOnce();
    expect(player.isPlaying()).toBe(false);
    expect(player.seconds).toBe(0);
    expect(noteOn).not.toHaveBeenCalled();
    player.dispose();
  });

  it('keeps playing through a performed note beyond the notated score duration', async () => {
    vi.useFakeTimers();
    const {ctx, advance} = mockAudio();
    const synth = trackedSynth();
    const score = scoreWith([
      {
        pitch: Pitch.parse('C4'),
        onsetQuarters: Rational.ZERO,
        duration: Duration.quarter(),
        performed: {onsetSec: 2.5, durationSec: 0.5, velocity: 100},
      },
    ]);
    const player = new ScorePlayer(score, {audioContext: ctx, synth, reverb: false});
    const ended = vi.fn();
    player.on('end', ended);

    // The notation ends at 2s, while the recording reaches 3s.
    expect(player.duration).toBeCloseTo(3, 5);
    await player.play();
    run(advance, 3200);

    expect(synth.ons.map((note) => note.midi)).toEqual([Pitch.parse('C4').midi]);
    expect(ended).toHaveBeenCalledTimes(1);
    expect(player.isPlaying()).toBe(false);
  });

  it('absorbs a pause from a cursor listener while a loop is armed', async () => {
    vi.useFakeTimers();
    const {ctx, advance} = mockAudio();
    const synth = trackedSynth();
    const score = scoreWith([
      {pitch: Pitch.parse('C4'), onsetQuarters: Rational.ZERO, duration: Duration.quarter()},
      {pitch: Pitch.parse('D4'), onsetQuarters: new Rational(1), duration: Duration.quarter()},
    ]);
    const player = new ScorePlayer(score, {
      audioContext: ctx,
      synth,
      schedulerIntervalMs: 10,
      cursorIntervalMs: 10,
      reverb: false,
    });
    player.setLoop(0, 0.5);
    let paused = false;
    player.on('timeupdate', () => {
      if (paused) return;
      paused = true;
      player.pause();
    });
    const listenerErrors: string[] = [];
    player.on('listenerError', ({event}) => listenerErrors.push(event));

    // A paused clock maps no reference time to a position, so the boundary
    // timer's timeAt() used to throw straight out of the tick callback.
    await player.play();
    expect(() => run(advance, 200)).not.toThrow();

    expect(paused).toBe(true);
    expect(player.isPlaying()).toBe(false);
    expect(listenerErrors).toEqual([]);
    player.dispose();
  });

  it('absorbs a pause from the cursor a loop wrap emits', async () => {
    vi.useFakeTimers();
    const {ctx, advance} = mockAudio();
    const synth = trackedSynth();
    const score = scoreWith([
      {pitch: Pitch.parse('C4'), onsetQuarters: Rational.ZERO, duration: Duration.quarter()},
      {pitch: Pitch.parse('D4'), onsetQuarters: new Rational(1), duration: Duration.quarter()},
    ]);
    const player = new ScorePlayer(score, {
      audioContext: ctx,
      synth,
      schedulerIntervalMs: 10,
      cursorIntervalMs: 10,
      reverb: false,
    });
    player.setLoop(0, 0.5);
    let wrapped = false;
    let last = -1;
    // The wrap is the one cursor whose position goes backwards; pausing from
    // it left the following commit pass reading a frozen clock.
    player.on('timeupdate', ({nominalSeconds}) => {
      if (wrapped) return;
      if (nominalSeconds < last) {
        wrapped = true;
        player.pause();
        return;
      }
      last = nominalSeconds;
    });
    const listenerErrors: string[] = [];
    player.on('listenerError', ({event}) => listenerErrors.push(event));

    await player.play();
    expect(() => run(advance, 1200)).not.toThrow();

    expect(wrapped).toBe(true);
    expect(player.isPlaying()).toBe(false);
    expect(listenerErrors).toEqual([]);
    player.dispose();
  });
});
