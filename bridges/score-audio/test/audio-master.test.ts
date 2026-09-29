// ============================================================================
// The reverse pairing, with the REAL family players: a recording drives the
// transport and the score follows it. Same harness as player-contracts.test.ts
// — one AudioContext double serving both families — so the assertions compare
// against the forward pairing directly.
// ============================================================================

import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {Duration, MeasureId, PartId, Pitch, Rational, ScoreBuilder, VoiceId} from '@webmusic/score';
import type {HeadlessSynth} from '@webmusic/score/play/headless';
import {createAudioClip} from '@webmusic/audio';
import {createAudioMasteredPlayback, scoreAsFollower} from '../src/audio-master';

/** Controllable AudioContext double serving both families; records source starts. */
function fakeSharedContext() {
  let t = 0;
  const started: Array<{when: number; offset: number}> = [];
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
  const node = (): Record<string, unknown> => ({
    gain: param(),
    pan: param(),
    connect: () => node(),
    disconnect() {},
  });
  const ctx = {
    get currentTime() {
      return t;
    },
    state: 'running' as const,
    sampleRate: 44100,
    destination: {},
    resume: async () => {},
    createGain: node,
    createStereoPanner: node,
    createConvolver: () => ({...node(), buffer: null}),
    createAnalyser: () => ({...node(), fftSize: 2048, smoothingTimeConstant: 0.8}),
    createBuffer: (channels: number, length: number, sampleRate: number) => ({
      numberOfChannels: channels,
      length,
      sampleRate,
      duration: length / sampleRate,
      getChannelData: () => new Float32Array(length),
    }),
    createBufferSource: () => ({
      buffer: null,
      playbackRate: param(),
      loop: false,
      loopStart: 0,
      loopEnd: 0,
      onended: null,
      connect: () => node(),
      disconnect() {},
      start: (when: number, offset: number) => started.push({when, offset}),
      stop() {},
    }),
  } as unknown as AudioContext;
  return {ctx, started, advance: (ms: number) => (t += ms / 1000)};
}

function recordingSynth(): HeadlessSynth & {ons: Array<{midi: number; time: number}>} {
  const ons: Array<{midi: number; time: number}> = [];
  return {ons, connect() {}, disconnect() {}, noteOn: (midi, _v, time) => ons.push({midi, time}), noteOff() {}};
}

function run(advance: (ms: number) => void, totalMs: number, stepMs = 10) {
  for (let elapsed = 0; elapsed < totalMs; elapsed += stepMs) {
    advance(stepMs);
    vi.advanceTimersByTime(stepMs);
  }
}

/** Two quarter notes (C4 then D4) at 120bpm — 0.5s each on the nominal axis. */
function buildTwoNoteScore() {
  const builder = new ScoreBuilder();
  const partId = PartId('piano');
  const voice = VoiceId('piano-v1');
  const timeSignature = {numerator: 4, denominator: 4};
  builder
    .setMetadata({title: 'Audio Master'})
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

function makeWorld(options: {clipOffsetSeconds?: number; leadInSeconds?: number} = {}) {
  const {ctx, started, advance} = fakeSharedContext();
  const synth = recordingSynth();
  const clip = createAudioClip({channelData: [new Float32Array(4000)], sampleRate: 1000});
  const {sync, scorePlayer, clipPlayer} = createAudioMasteredPlayback(buildTwoNoteScore(), clip, {
    context: ctx,
    leadInSeconds: options.leadInSeconds ?? 0.06,
    clipOffsetSeconds: options.clipOffsetSeconds,
    driftCheckIntervalMs: 0,
    tick: {intervalMs: 25, createWorker: () => null},
    scoreOptions: {synth, reverb: false},
  });
  return {ctx, started, advance, synth, sync, scorePlayer, clipPlayer};
}

describe('audio as master (real AudioClipPlayer driving a real ScorePlayer)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('starts both on one shared origin owned by the recording', async () => {
    const {started, advance, synth, sync, scorePlayer, clipPlayer} = makeWorld();

    await sync.play();

    // The CLIP armed the shared origin this time; the score joined it.
    expect(clipPlayer.clock?.holding).toBe(true);
    const origin = clipPlayer.clock?.state.originTime ?? -1;
    expect(origin).toBeCloseTo(0.06, 9);
    expect(started).toHaveLength(1);
    expect(started[0].when).toBe(origin);
    expect(scorePlayer.clock.holding).toBe(true);
    expect(scorePlayer.clock.state.originTime).toBe(origin);

    run(advance, 300);
    // The score's notes land on the recording's clock, first attack at the
    // shared origin — the score is following, not leading.
    expect(synth.ons[0]?.midi).toBe(Pitch.parse('C4').midi);
    expect(synth.ons[0]?.time).toBeCloseTo(origin, 9);
    expect(sync.seconds).toBeCloseTo(clipPlayer.seconds, 9);
    expect(sync.checkDrift()).toBeCloseTo(0, 9);
    sync.dispose();
  });

  it('reads the sync clock through the recording, not the score', async () => {
    const {advance, sync, scorePlayer, clipPlayer} = makeWorld();

    await sync.play();
    run(advance, 400);
    // Identity: the master's clock IS the sync's clock.
    expect(sync.clock).toBe(clipPlayer.clock);
    expect(sync.clock).not.toBe(scorePlayer.clock);
    sync.dispose();
  });

  it('seeks on the recording axis and re-enters both on a shared origin', async () => {
    const {ctx, started, advance, sync, scorePlayer, clipPlayer} = makeWorld();

    await sync.play();
    run(advance, 200);
    await sync.seek(1.5);

    expect(clipPlayer.clock?.holding).toBe(true);
    const origin = clipPlayer.clock?.state.originTime ?? -1;
    expect(origin).toBeCloseTo(ctx.currentTime + 0.06, 9);
    // The recording re-armed at the seek target, and the score followed onto
    // the very same origin at the matching nominal position.
    expect(started.at(-1)?.when).toBe(origin);
    expect(started.at(-1)?.offset).toBeCloseTo(1.5, 9);
    expect(scorePlayer.clock.state.originTime).toBe(origin);
    expect(scorePlayer.nominalSeconds).toBeCloseTo(1.5, 9);
    expect(sync.checkDrift()).toBeCloseTo(0, 9);
    sync.dispose();
  });

  it('holds the score out of a recording lead-in until it reaches score zero', async () => {
    const {advance, synth, sync, scorePlayer, clipPlayer} = makeWorld({clipOffsetSeconds: 0.25});

    await sync.play(); // shared origin at 0.06; score-zero is 0.25 into the clip
    // The score is armed for the instant the recording reaches score-zero,
    // not for the shared origin — otherwise it would run 0.25 s early for
    // the whole recording.
    expect(scorePlayer.clock.holding).toBe(true);
    expect(scorePlayer.clock.state.originTime).toBeCloseTo(0.31, 9);

    run(advance, 200); // still inside the lead-in
    expect(scorePlayer.nominalSeconds).toBe(0);
    expect(synth.ons).toHaveLength(0);

    run(advance, 400); // past score-zero
    expect(scorePlayer.nominalSeconds).toBeCloseTo(clipPlayer.seconds - 0.25, 9);
    expect(synth.ons[0]?.midi).toBe(Pitch.parse('C4').midi);
    // The score's first note sounds when the recording reaches score-zero.
    expect(synth.ons[0]?.time).toBeCloseTo(0.31, 9);
    sync.dispose();
  });

  it('keeps the follower rate-invariant: a shared rate change does not desync', async () => {
    const {advance, sync, scorePlayer, clipPlayer} = makeWorld();

    await sync.play();
    run(advance, 300);
    sync.setRate(2);
    run(advance, 300);

    // The adapter routes through seekNominal/nominalSeconds, so the score
    // follower tracks the recording's axis at any rate. Routing through the
    // rate-scaled seek()/seconds instead would put these a factor of 2 apart.
    expect(scorePlayer.nominalSeconds).toBeCloseTo(clipPlayer.seconds, 4);
    expect(sync.checkDrift()).toBeCloseTo(0, 4);
    sync.dispose();
  });

  it('does not repeatedly re-join a score waiting through a long recording lead-in', async () => {
    const {advance, sync, scorePlayer, clipPlayer} = makeWorld({clipOffsetSeconds: 2});
    const play = vi.spyOn(scorePlayer, 'play');
    await sync.play();
    const origin = scorePlayer.clock.state.originTime;

    for (let check = 0; check < 7; check += 1) {
      run(advance, 250);
      expect(sync.checkDrift()).toBe(0);
      await vi.advanceTimersByTimeAsync(0);
    }
    expect(play).toHaveBeenCalledOnce();
    expect(scorePlayer.clock.state.originTime).toBe(origin);

    run(advance, 500);
    expect(scorePlayer.nominalSeconds).toBeCloseTo(clipPlayer.seconds - 2, 9);
    expect(sync.checkDrift()).toBeCloseTo(0, 9);
    // Once the scheduled start passed, real divergence must still be detected.
    await scorePlayer.seekNominal(scorePlayer.nominalSeconds + 0.15);
    expect(Math.abs(sync.checkDrift())).toBeGreaterThan(0.03);
    await vi.advanceTimersByTimeAsync(0);
    expect(play.mock.calls.length).toBeGreaterThan(1);
    sync.dispose();
  });

  it('scoreAsFollower shifts the clock view so the offset is not read as drift', async () => {
    const {ctx, advance, scorePlayer, sync} = makeWorld();
    const follower = scoreAsFollower(scorePlayer, {clipOffsetSeconds: 0.25});

    await sync.play();
    run(advance, 300); // timeAt needs a running clock to invert against
    expect(follower.seconds).toBeCloseTo(scorePlayer.nominalSeconds + 0.25, 9);
    expect(follower.clock?.positionAt(ctx.currentTime)).toBeCloseTo(
      scorePlayer.clock.positionAt(ctx.currentTime) + 0.25,
      9,
    );
    // The shifted view stays a faithful inverse pair.
    expect(follower.clock?.timeAt(0.25)).toBeCloseTo(scorePlayer.clock.timeAt(0), 9);
    sync.dispose();
  });
});
