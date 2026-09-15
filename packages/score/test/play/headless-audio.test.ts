import {afterEach, describe, expect, it, vi} from 'vitest';
import {Duration, MeasureId, PartId, Pitch, Rational, ScoreBuilder, VoiceId} from '../../src/core';
import {ScorePlayer, createScorePlayer, playScore, Effect, type HeadlessSynth} from '../../src/play/headless';

/** A controllable AudioContext stand-in whose `currentTime` we drive by hand. */
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
  const node = () => ({gain: param(), connect: () => node(), disconnect() {}});
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

/** A synth that records every noteOn with the exact audio time it was given. */
function recordingSynth(): HeadlessSynth & {ons: Array<{midi: number; time: number}>; offs: number[]} {
  const ons: Array<{midi: number; time: number}> = [];
  const offs: number[] = [];
  return {ons, offs, connect() {}, disconnect() {}, noteOn: (midi, _v, time) => ons.push({midi, time}), noteOff: (midi) => offs.push(midi)};
}

/** Drive both clocks forward in lockstep: audio time + fake timers. */
function run(advance: (ms: number) => void, totalMs: number, stepMs = 10) {
  for (let elapsed = 0; elapsed < totalMs; elapsed += stepMs) {
    advance(stepMs);
    vi.advanceTimersByTime(stepMs);
  }
}

function buildScore() {
  const builder = new ScoreBuilder();
  const partId = PartId('piano');
  const voice = VoiceId('piano-v1');
  const timeSignature = {numerator: 4, denominator: 4};

  builder
    .setMetadata({title: 'Audio Test'})
    .addTempo({atQuarters: Rational.ZERO, bpm: 120})
    .addMeter({atQuarters: Rational.ZERO, measureNumber: 1, timeSignature});
  builder.addPart({id: partId, name: 'Piano', staves: 1});
  builder.addMeasure({
    id: MeasureId('m1'),
    number: 1,
    onsetQuarters: Rational.ZERO,
    durationQuarters: new Rational(4),
    timeSignature,
  });
  builder.addNote(partId, {
    id: builder.newNoteId(),
    pitch: Pitch.parse('C4'),
    onsetQuarters: Rational.ZERO,
    duration: Duration.whole(),
    voice,
  });
  return builder.build();
}

/** Two quarter notes (C4 then D4) at 120bpm → 0.5s each, 1.0s total. */
function buildTwoNoteScore() {
  const builder = new ScoreBuilder();
  const partId = PartId('piano');
  const voice = VoiceId('piano-v1');
  const timeSignature = {numerator: 4, denominator: 4};
  builder
    .setMetadata({title: 'Two Notes'})
    .addTempo({atQuarters: Rational.ZERO, bpm: 120})
    .addMeter({atQuarters: Rational.ZERO, measureNumber: 1, timeSignature});
  builder.addPart({id: partId, name: 'Piano', staves: 1});
  builder.addMeasure({
    id: MeasureId('m1'),
    number: 1,
    onsetQuarters: Rational.ZERO,
    durationQuarters: new Rational(4),
    timeSignature,
  });
  for (const [i, name] of ['C4', 'D4'].entries()) {
    builder.addNote(partId, {
      id: builder.newNoteId(),
      pitch: Pitch.parse(name),
      onsetQuarters: new Rational(i),
      duration: Duration.quarter(),
      voice,
    });
  }
  return builder.build();
}

describe('ScorePlayer push-clock scheduler', () => {
  afterEach(() => vi.useRealTimers());

  it('commits notes onto the audio clock in order, at their exact times', async () => {
    vi.useFakeTimers();
    const {ctx, advance} = mockAudio();
    const synth = recordingSynth();
    const player = new ScorePlayer(buildTwoNoteScore(), {audioContext: ctx, synth, reverb: false});

    await player.play();
    run(advance, 1300);

    expect(synth.ons.map((o) => o.midi)).toEqual([Pitch.parse('C4').midi, Pitch.parse('D4').midi]);
    // Audio-clock onsets land at their exact piece times (note 0 ~0s — clamped to
    // "now" since you cannot schedule in the past; note 1 exactly 0.5s later).
    expect(synth.ons[0].time).toBeLessThan(0.05);
    expect(synth.ons[1].time).toBeCloseTo(0.5, 5);
  });

  it('emits end once the timeline completes', async () => {
    vi.useFakeTimers();
    const {ctx, advance} = mockAudio();
    const player = new ScorePlayer(buildTwoNoteScore(), {audioContext: ctx, synth: recordingSynth(), reverb: false});
    const ended = vi.fn();
    player.on('end', ended);

    // Duration spans the whole 4/4 measure (2.0s at 120bpm), not just the notes.
    await player.play();
    run(advance, 2300);

    expect(ended).toHaveBeenCalledTimes(1);
    expect(player.isPlaying()).toBe(false);
  });

  it('plays through an Effect chain without disrupting note scheduling', async () => {
    vi.useFakeTimers();
    const {ctx, advance} = mockAudio();
    const synth = recordingSynth();
    const player = new ScorePlayer(buildTwoNoteScore(), {
      audioContext: ctx,
      synth,
      effect: Effect.chain(Effect.reverb({wet: 0.3}), Effect.gain(0.8)),
    });

    await player.play();
    run(advance, 1300);

    expect(synth.ons.map((o) => o.midi)).toEqual([Pitch.parse('C4').midi, Pitch.parse('D4').midi]);
  });

  it('setLoop wraps the clock and never finishes on its own', async () => {
    vi.useFakeTimers();
    const {ctx, advance} = mockAudio();
    const synth = recordingSynth();
    const player = new ScorePlayer(buildTwoNoteScore(), {audioContext: ctx, synth});
    const ended = vi.fn();
    player.on('end', ended);

    player.setLoop(0, 0.5); // loop just the first note (C4 at 0s)
    await player.play();
    run(advance, 1700);

    const c4 = Pitch.parse('C4').midi;
    const c4Hits = synth.ons.filter((o) => o.midi === c4).length;
    expect(c4Hits).toBeGreaterThanOrEqual(3); // replayed every ~0.5s
    expect(ended).not.toHaveBeenCalled();
    expect(player.isPlaying()).toBe(true);
    player.stop();
  });

  it('preserves loop phase across wraps instead of banking each late wake', async () => {
    vi.useFakeTimers();
    const {ctx, advance} = mockAudio();
    const player = new ScorePlayer(buildTwoNoteScore(), {audioContext: ctx, synth: recordingSynth(), reverb: false});

    player.setLoop(0, 0.5);
    await player.play();
    // Coarse steps so every boundary wake lands well past the boundary — the
    // case where restarting flat at loopStart would fold the lateness into
    // the next cycle, and the next, until the loop trails the audio clock.
    run(advance, 1700, 40);

    // Three wraps later the transport still reads the audio clock's true
    // phase — elapsed modulo the loop span — not elapsed minus the lateness
    // banked at each wake.
    expect(player.nominalSeconds).toBeCloseTo(ctx.currentTime % 0.5, 5);
    expect(player.isPlaying()).toBe(true);
    player.stop();
  });

  it('pause() cancels the uncommitted tail', async () => {
    vi.useFakeTimers();
    const {ctx, advance} = mockAudio();
    const synth = recordingSynth();
    const player = new ScorePlayer(buildTwoNoteScore(), {audioContext: ctx, synth, reverb: false});

    await player.play();
    run(advance, 200); // past note 0 (0.0s), well before note 1 (0.5s)
    player.pause();
    run(advance, 1300); // nothing further should commit

    expect(synth.ons.map((o) => o.midi)).toEqual([Pitch.parse('C4').midi]);
    expect(player.isPlaying()).toBe(false);
  });

  it('waits for an async synth preload after resuming audio before scheduling', async () => {
    vi.useFakeTimers();
    const {ctx, advance} = mockAudio();
    const synth = recordingSynth() as HeadlessSynth & {
      ons: Array<{midi: number; time: number}>;
      preload?: () => Promise<void>;
    };
    let resolve!: () => void;
    const pending = new Promise<void>((done) => {
      resolve = done;
    });
    synth.preload = vi.fn(() => pending);
    const player = new ScorePlayer(buildTwoNoteScore(), {audioContext: ctx, synth, reverb: false});

    const start = player.play();
    await Promise.resolve();
    expect(synth.preload).toHaveBeenCalledTimes(1);
    expect(synth.ons).toEqual([]);

    resolve();
    await start;
    run(advance, 20);
    expect(synth.ons.map((note) => note.midi)).toEqual([Pitch.parse('C4').midi]);
    player.stop();
  });

  it('cancels a pending async start before its synth becomes ready', async () => {
    vi.useFakeTimers();
    const {ctx, advance} = mockAudio();
    const synth = recordingSynth() as HeadlessSynth & {
      ons: Array<{midi: number; time: number}>;
      preload?: () => Promise<void>;
    };
    let resolve!: () => void;
    synth.preload = vi.fn(() => new Promise<void>((done) => {
      resolve = done;
    }));
    const player = new ScorePlayer(buildTwoNoteScore(), {audioContext: ctx, synth, reverb: false});

    const start = player.play();
    await Promise.resolve();
    player.stop();
    resolve();
    await start;
    run(advance, 100);

    expect(synth.ons).toEqual([]);
    expect(player.isPlaying()).toBe(false);
  });
});

describe('ScorePlayer transport surface (rate / progress / scrub / seekFraction)', () => {
  afterEach(() => vi.useRealTimers());

  it('rate defaults to 1 and setRate rescales duration (real seconds)', () => {
    const player = new ScorePlayer(buildTwoNoteScore()); // one 4/4 measure = 2.0s nominal
    expect(player.rate).toBe(1);
    expect(player.duration).toBeCloseTo(2.0, 5);
    player.setRate(2);
    expect(player.rate).toBe(2);
    expect(player.duration).toBeCloseTo(1.0, 5);
    expect(player.durationSeconds).toBeCloseTo(1.0, 5); // same domain, kept in sync
  });

  it('seekFraction / progress agree at any rate', () => {
    const player = new ScorePlayer(buildTwoNoteScore());
    player.setRate(2);
    player.seekFraction(0.5);
    expect(player.seconds).toBeCloseTo(0.5, 5); // half of the 1.0s rate-2 duration
    expect(player.progress).toBeCloseTo(0.5, 5);
    // The musical position is the same point regardless of rate.
    expect(player.currentTime.seconds).toBeCloseTo(1.0, 5);
    player.seekFraction(2); // clamped to 1
    expect(player.progress).toBe(1);
  });

  it('scrub moves by real-seconds deltas and clamps to [0, duration]', () => {
    const player = new ScorePlayer(buildTwoNoteScore());
    player.scrub(0.25);
    expect(player.seconds).toBeCloseTo(0.25, 5);
    player.scrub(-10);
    expect(player.seconds).toBe(0);
    player.scrub(99);
    expect(player.seconds).toBeCloseTo(player.duration, 5);
    expect(player.progress).toBe(1);
  });

  it('changing rate while paused preserves the musical position', () => {
    const player = new ScorePlayer(buildTwoNoteScore());
    player.seek(1.0); // halfway, in rate-1 real seconds
    player.setRate(2);
    expect(player.currentTime.seconds).toBeCloseTo(1.0, 5); // same musical spot
    expect(player.seconds).toBeCloseTo(0.5, 5); // half the wall-clock time at 2x
    expect(player.progress).toBeCloseTo(0.5, 5);
  });

  it('schedules notes at the right audio times at rate != 1', async () => {
    vi.useFakeTimers();
    const {ctx, advance} = mockAudio();
    const synth = recordingSynth();
    const player = new ScorePlayer(buildTwoNoteScore(), {audioContext: ctx, synth});
    player.setRate(2);
    await player.play();
    run(advance, 800);
    expect(synth.ons.map((o) => o.midi)).toEqual([Pitch.parse('C4').midi, Pitch.parse('D4').midi]);
    expect(synth.ons[1].time).toBeCloseTo(0.25, 5); // nominal 0.5s onset, halved at 2x
    player.stop();
  });

  it('emits timeupdate on the cursor cadence while playing — no rAF involved', async () => {
    vi.useFakeTimers();
    const {ctx, advance} = mockAudio();
    const player = new ScorePlayer(buildTwoNoteScore(), {
      audioContext: ctx,
      synth: recordingSynth(),
      cursorIntervalMs: 100,
    });
    const updates: Array<{
      nominalSeconds: number;
      transportSeconds: number;
      transportDurationSeconds: number;
      progress: number;
      seconds: number;
      duration: number;
    }> = [];
    player.on('timeupdate', (u) => updates.push(u));

    await player.play();
    run(advance, 1000);
    player.pause();

    // ~10 updates over 1s at the 100ms cursor cadence (plus the pause-side emits).
    expect(updates.length).toBeGreaterThanOrEqual(8);
    expect(updates.length).toBeLessThanOrEqual(14);
    const last = updates[updates.length - 1];
    expect(last.transportDurationSeconds).toBeCloseTo(2.0, 5);
    expect(last.transportSeconds).toBeGreaterThan(0.8);
    expect(last.nominalSeconds).toBeCloseTo(last.transportSeconds, 5);
    expect(last.progress).toBeCloseTo(last.transportSeconds / last.transportDurationSeconds, 5);
    // Direct ScorePlayer aliases preserve their historical transport meaning.
    expect(last.seconds).toBe(last.transportSeconds);
    expect(last.duration).toBe(last.transportDurationSeconds);
    // Monotonic while playing forward.
    for (let i = 1; i < updates.length; i += 1) {
      expect(updates[i].transportSeconds).toBeGreaterThanOrEqual(updates[i - 1].transportSeconds);
    }
  });

  it('timeupdate also fires once on seek while paused', () => {
    const player = new ScorePlayer(buildTwoNoteScore());
    const updates: number[] = [];
    player.on('timeupdate', (u) => updates.push(u.progress));
    player.seekFraction(0.25);
    expect(updates).toEqual([0.25]);
  });
});

// CONTRACTUAL — @webmusic/bridge depends on this surface: ScoreAudioSync
// anchors by reading `clock` (nominal axis), reads `nominalSeconds` for the
// settled position, and awaits `seekNominal` before re-joining the clip
// (bridges/score-audio/src/sync.ts, pinned by SyncTransportContract).
// Behavioral changes here require a matching bridge change.
describe('ScorePlayer transport clock surface (clock / nominalSeconds / seekNominal)', () => {
  afterEach(() => vi.useRealTimers());

  it('exposes a read-only transport clock in the nominal-seconds domain', async () => {
    vi.useFakeTimers();
    const {ctx, advance} = mockAudio();
    const player = new ScorePlayer(buildTwoNoteScore(), {audioContext: ctx, synth: recordingSynth(), reverb: false});

    expect(player.clock.paused).toBe(true);
    expect(player.clock.rate).toBe(1);

    player.setRate(2);
    expect(player.clock.rate).toBe(2);

    await player.play();
    expect(player.clock.paused).toBe(false);
    run(advance, 300);
    // The clock position advances at rate x wall clock: 0.3s x 2 = 0.6 nominal.
    expect(player.clock.positionAt(ctx.currentTime)).toBeCloseTo(0.6, 5);
    expect(player.nominalSeconds).toBeCloseTo(0.6, 5);

    player.pause();
    expect(player.clock.paused).toBe(true);
    // The paused anchor holds the nominal resume position, frozen in time.
    expect(player.clock.state.originPosition).toBeCloseTo(0.6, 5);
    expect(player.clock.positionAt(ctx.currentTime + 5)).toBeCloseTo(0.6, 5);
    player.dispose();
  });

  it('nominalSeconds and seekNominal are rate-invariant score positions', async () => {
    const player = new ScorePlayer(buildTwoNoteScore()); // 2.0s nominal timeline
    player.setRate(2);
    await player.seekNominal(1.0);
    expect(player.nominalSeconds).toBeCloseTo(1.0, 5);
    expect(player.seconds).toBeCloseTo(0.5, 5); // transport domain at 2x
    expect(player.currentTime.seconds).toBeCloseTo(1.0, 5);
    // Clamped to the nominal timeline, mirroring seek()'s duration clamp.
    await player.seekNominal(99);
    expect(player.nominalSeconds).toBeCloseTo(2.0, 5);
    expect(player.progress).toBe(1);
    await player.seekNominal(-3);
    expect(player.nominalSeconds).toBe(0);
  });

  it('seekNominal during playback restarts the transport at the target', async () => {
    vi.useFakeTimers();
    const {ctx, advance} = mockAudio();
    const synth = recordingSynth();
    const player = new ScorePlayer(buildTwoNoteScore(), {audioContext: ctx, synth, reverb: false});

    await player.play();
    run(advance, 100);
    await player.seekNominal(0.5); // D4's onset, in nominal score seconds
    expect(player.isPlaying()).toBe(true);
    run(advance, 100);

    const d4 = Pitch.parse('D4').midi;
    const last = synth.ons.at(-1);
    expect(last?.midi).toBe(d4);
    // Re-anchored at the seek point (~0.1s): D4 sounds immediately.
    expect(last?.time).toBeGreaterThanOrEqual(0.1);
    expect(last?.time).toBeLessThan(0.15);
    player.dispose();
  });
});

// CONTRACTUAL — @webmusic/bridge depends on this surface: ScoreAudioSync
// proposes a shared armed origin through play(when) and reads the pre-roll
// through `clock.holding` / `clock.state.originTime` to join the clip at the
// exact same audio-clock instant (bridges/score-audio/src/sync.ts).
// Behavioral changes here require a matching bridge change.
describe('ScorePlayer scheduled start (play(when))', () => {
  afterEach(() => vi.useRealTimers());

  it('arms the clock and lands the first attacks exactly at when', async () => {
    vi.useFakeTimers();
    const {ctx, advance} = mockAudio();
    const synth = recordingSynth();
    const player = new ScorePlayer(buildTwoNoteScore(), {audioContext: ctx, synth, reverb: false});

    await player.play(0.25);
    expect(player.clock.paused).toBe(false);
    expect(player.clock.holding).toBe(true);
    expect(player.clock.state.originTime).toBeCloseTo(0.25, 9);

    run(advance, 100);
    // The position holds at the resume point through the pre-roll.
    expect(player.nominalSeconds).toBe(0);

    run(advance, 1200);
    expect(synth.ons.map((o) => o.midi)).toEqual([Pitch.parse('C4').midi, Pitch.parse('D4').midi]);
    // No clamped-to-now first note: both attacks sit on the armed origin.
    expect(synth.ons[0].time).toBeCloseTo(0.25, 5);
    expect(synth.ons[1].time).toBeCloseTo(0.75, 5);
    player.dispose();
  });

  it('clamps an expired when to an immediate start instead of skipping material', async () => {
    vi.useFakeTimers();
    const {ctx, advance} = mockAudio();
    const synth = recordingSynth();
    const player = new ScorePlayer(buildTwoNoteScore(), {audioContext: ctx, synth, reverb: false});

    advance(400); // the pre-roll headroom is already gone at play() time
    await player.play(0.25);
    expect(player.clock.holding).toBe(false);

    run(advance, 1300);
    // The score still starts from its resume position — nothing was dropped.
    expect(synth.ons.map((o) => o.midi)).toEqual([Pitch.parse('C4').midi, Pitch.parse('D4').midi]);
    expect(synth.ons[0].time).toBeGreaterThanOrEqual(0.4);
    expect(synth.ons[0].time).toBeLessThan(0.45);
    player.dispose();
  });

  it('pause during the pre-roll cancels the pending start and keeps the armed position', async () => {
    vi.useFakeTimers();
    const {ctx, advance} = mockAudio();
    const synth = recordingSynth();
    const player = new ScorePlayer(buildTwoNoteScore(), {audioContext: ctx, synth, reverb: false});

    await player.seekNominal(0.5);
    await player.play(0.5); // half a second of pre-roll
    run(advance, 200);
    player.pause();
    expect(player.clock.paused).toBe(true);
    expect(player.nominalSeconds).toBeCloseTo(0.5, 5);

    run(advance, 600); // the armed origin passes while paused
    expect(synth.ons).toHaveLength(0); // the pending start was retracted

    await player.play(); // a plain resume picks up the held position
    run(advance, 700);
    expect(synth.ons.map((o) => o.midi)).toEqual([Pitch.parse('D4').midi]);
    player.dispose();
  });

  it('arms a mid-playback seek at when instead of resuming immediately', async () => {
    vi.useFakeTimers();
    const {ctx, advance} = mockAudio();
    const synth = recordingSynth();
    const player = new ScorePlayer(buildTwoNoteScore(), {audioContext: ctx, synth, reverb: false});

    await player.play();
    run(advance, 100);
    const onsBeforeSeek = synth.ons.length;
    await player.seekNominal(0.5, ctx.currentTime + 0.06);

    // The restart is armed, not immediate: the position holds at the seek
    // target through the pre-roll and D4 sounds exactly at the armed origin.
    expect(player.clock.holding).toBe(true);
    const origin = player.clock.state.originTime;
    expect(origin).toBeCloseTo(0.16, 9);
    expect(player.nominalSeconds).toBeCloseTo(0.5, 9);

    run(advance, 300);
    const attack = synth.ons.at(-1);
    expect(synth.ons.length).toBeGreaterThan(onsBeforeSeek);
    expect(attack?.midi).toBe(Pitch.parse('D4').midi);
    expect(attack?.time).toBeCloseTo(origin, 9);
    player.dispose();
  });

  it('ignores when while paused — a seek never starts playback', async () => {
    const {ctx} = mockAudio();
    const player = new ScorePlayer(buildTwoNoteScore(), {audioContext: ctx, synth: recordingSynth(), reverb: false});

    await player.seekNominal(0.5, 0.25);
    expect(player.isPlaying()).toBe(false);
    expect(player.clock.paused).toBe(true);
    expect(player.nominalSeconds).toBeCloseTo(0.5, 9);
    player.dispose();
  });

  it('lands a mid-score resume attack exactly at when', async () => {
    vi.useFakeTimers();
    const {ctx, advance} = mockAudio();
    const synth = recordingSynth();
    const player = new ScorePlayer(buildTwoNoteScore(), {audioContext: ctx, synth, reverb: false});

    await player.seekNominal(0.5);
    await player.play(0.3);
    run(advance, 900);

    expect(synth.ons.map((o) => o.midi)).toEqual([Pitch.parse('D4').midi]);
    expect(synth.ons[0].time).toBeCloseTo(0.3, 5);
    player.dispose();
  });
});

describe('ScorePlayer', () => {
  // No AudioContext exists under the node test environment — these assert that
  // the engine is safe to construct and inspect without one (SSR-safe lazy init).
  it('constructs without a Web Audio context', () => {
    const score = buildScore();
    expect(() => new ScorePlayer(score)).not.toThrow();
    expect(() => createScorePlayer(score)).not.toThrow();
  });

  it('starts and returns a caller-controlled player through the code-only playScore action', async () => {
    vi.useFakeTimers();
    const {ctx} = mockAudio();
    const player = await playScore(buildScore(), {
      audioContext: ctx,
      synth: recordingSynth(),
      reverb: false,
    });

    expect(player).toBeInstanceOf(ScorePlayer);
    expect(player.isPlaying()).toBe(true);
    player.dispose();
  });

  it('reports time and duration without allocating audio', () => {
    const player = new ScorePlayer(buildScore());
    expect(player.currentTime.seconds).toBe(0);
    expect(player.durationSeconds).toBeGreaterThan(0);
    expect(player.isPlaying()).toBe(false);
  });

  it('subscribes and unsubscribes from events without a context', () => {
    const player = new ScorePlayer(buildScore());
    const off = player.on('end', () => undefined);
    expect(typeof off).toBe('function');
    expect(() => off()).not.toThrow();
  });

  it('lazily creates the context only when accessed', () => {
    const player = new ScorePlayer(buildScore());
    // No AudioContext global in node -> first access throws the guidance error.
    expect(() => player.context).toThrow(/Web Audio is not available/);
  });

  it('cleans only its own borrowed synth route and disposes only when ownership transfers', async () => {
    vi.useFakeTimers();
    const {ctx} = mockAudio();
    const routeCleanups: Array<ReturnType<typeof vi.fn>> = [];
    const borrowed = {
      connect: vi.fn(() => {
        const cleanup = vi.fn();
        routeCleanups.push(cleanup);
        return cleanup;
      }),
      disconnect: vi.fn(),
      dispose: vi.fn(),
      noteOn: vi.fn(),
    } satisfies HeadlessSynth;
    const first = new ScorePlayer(buildTwoNoteScore(), {audioContext: ctx, synth: borrowed});
    const second = new ScorePlayer(buildTwoNoteScore(), {audioContext: ctx, synth: borrowed});
    await Promise.all([first.play(), second.play()]);
    first.dispose();
    expect(routeCleanups).toHaveLength(2);
    expect(routeCleanups[0]).toHaveBeenCalledTimes(1);
    expect(routeCleanups[1]).not.toHaveBeenCalled();
    // A shared caller-owned synth may have unrelated routes; a player must
    // never invoke its global no-argument disconnect during borrowed cleanup.
    expect(borrowed.disconnect).not.toHaveBeenCalled();
    expect(borrowed.dispose).not.toHaveBeenCalled();
    second.dispose();
    expect(routeCleanups[1]).toHaveBeenCalledTimes(1);

    const owned = {
      connect: vi.fn(),
      disconnect: vi.fn(),
      dispose: vi.fn(),
      noteOn: vi.fn(),
    } satisfies HeadlessSynth;
    const ownedPlayer = new ScorePlayer(buildTwoNoteScore(), {
      audioContext: ctx,
      synth: owned,
      synthOwnership: 'owned',
    });
    await ownedPlayer.play();
    ownedPlayer.dispose();
    expect(owned.dispose).toHaveBeenCalledTimes(1);
  });
});
