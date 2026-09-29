// ============================================================================
// Runtime contract tests: the REAL family players, driven through the sync.
//
// transport-contracts.ts pins the documented pairing at compile time and the
// families mark their load-bearing surfaces CONTRACTUAL, but nothing ran the
// blessed combination — a real ScorePlayer mastering a real AudioClipPlayer
// (buffer engine) — through ScoreAudioSync itself. These tests do, on a
// hand-driven AudioContext double, and pin the behavior the bridge's whole
// strategy rests on: both players making their first sound at one shared
// audio-clock origin. TonePlayer (the clockless fallback) stays a
// compile-time pin only — it wraps a Tone.js transport this harness cannot
// host — and its mirror path is exercised by the structural fakes in
// sync.test.ts.
// ============================================================================

import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {Duration, MeasureId, PartId, Pitch, Rational, ScoreBuilder, VoiceId} from '@webmusic/score';
import type {HeadlessSynth} from '@webmusic/score/play/headless';
import {createAudioClip} from '@webmusic/audio';
import {createSyncedPlayback, renderScoreToClip} from '../src/sync';
import {createAudioMasteredPlayback} from '../src/audio-master';

/**
 * One controllable AudioContext double serving BOTH families: the score
 * player's graph (gain/panner/convolver) and the clip player's buffer engine
 * (buffer sources, analyser). Every `source.start(when, offset)` is recorded
 * — that pair is the observable half of the shared-origin contract.
 */
function fakeSharedContext() {
  let t = 0;
  const started: Array<{when: number; offset: number}> = [];
  const stopped: number[] = [];
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
      stop: () => stopped.push(t),
    }),
  } as unknown as AudioContext;
  return {ctx, started, stopped, advance: (ms: number) => (t += ms / 1000)};
}

/** Offline render double retains the requested frame length and channel count. */
function stubOfflineContext() {
  vi.stubGlobal('OfflineAudioContext', class {
    readonly destination = {};
    constructor(
      readonly numberOfChannels: number,
      readonly length: number,
      readonly sampleRate: number,
    ) {}
    createGain() {
      return {connect() {}, disconnect() {}};
    }
    async startRendering() {
      return {
        numberOfChannels: this.numberOfChannels,
        length: this.length,
        sampleRate: this.sampleRate,
        getChannelData: () => new Float32Array(this.length),
      };
    }
  });
}

/** A synth that records every noteOn with the exact audio time it was given. */
function recordingSynth(): HeadlessSynth & {ons: Array<{midi: number; time: number}>} {
  const ons: Array<{midi: number; time: number}> = [];
  return {ons, connect() {}, disconnect() {}, noteOn: (midi, _v, time) => ons.push({midi, time}), noteOff() {}};
}

/** Drive the audio clock and the fake timers forward in lockstep. */
function run(advance: (ms: number) => void, totalMs: number, stepMs = 10) {
  for (let elapsed = 0; elapsed < totalMs; elapsed += stepMs) {
    advance(stepMs);
    vi.advanceTimersByTime(stepMs);
  }
}

/**
 * Same, but flushing microtasks at every step. Transport work that settles
 * asynchronously (the loop wrap's seek → arm → re-join chain) must interleave
 * with the audio clock the way it does in a browser; advancing the clock in
 * one synchronous burst instead would let a proposed origin expire before the
 * chain reaches the join, exercising the fallback rather than the wrap.
 */
async function runAsync(advance: (ms: number) => void, totalMs: number, stepMs = 10) {
  for (let elapsed = 0; elapsed < totalMs; elapsed += stepMs) {
    advance(stepMs);
    await vi.advanceTimersByTimeAsync(stepMs);
  }
}

/** Two quarter notes (C4 then D4) at 120bpm — 0.5s each on the nominal axis. */
function buildTwoNoteScore() {
  const builder = new ScoreBuilder();
  const partId = PartId('piano');
  const voice = VoiceId('piano-v1');
  const timeSignature = {numerator: 4, denominator: 4};
  builder
    .setMetadata({title: 'Runtime Contract'})
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

function makeSyncedWorld(leadInSeconds = 0.06, create = createSyncedPlayback) {
  const {ctx, started, advance} = fakeSharedContext();
  const synth = recordingSynth();
  const clip = createAudioClip({channelData: [new Float32Array(3000)], sampleRate: 1000});
  const {sync, scorePlayer, clipPlayer} = create(buildTwoNoteScore(), clip, {
    context: ctx,
    leadInSeconds,
    driftCheckIntervalMs: 0,
    // Force the timer fallback: this harness hosts no worker.
    tick: {intervalMs: 25, createWorker: () => null},
    scoreOptions: {synth, reverb: false},
  });
  return {ctx, started, advance, synth, sync, scorePlayer, clipPlayer};
}

describe('ScoreAudioSync runtime contract (real ScorePlayer + real AudioClipPlayer)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('keeps a Bridge-rendered default tail playing after the Score follower naturally ends', async () => {
    stubOfflineContext();
    const score = buildTwoNoteScore();
    const clip = await renderScoreToClip(score, {
      synth: recordingSynth(), reverb: false, sampleRate: 1000,
    });
    expect(clip.duration).toBeCloseTo(2.15, 9);
    const {ctx, advance, started, stopped} = fakeSharedContext();
    const {sync, scorePlayer, clipPlayer} = createAudioMasteredPlayback(score, clip, {
      context: ctx,
      scoreOptions: {synth: recordingSynth(), reverb: false},
      tick: {intervalMs: 25, createWorker: () => null},
    });
    try {
      await sync.play();
      await runAsync(advance, 2200);
      // At t=2.20 the armed origin was 0.06, so the clip is 2.14s in:
      // Score finished at 2s, but the final 0.14s of the clip is still live.
      expect(scorePlayer.isPlaying()).toBe(false);
      expect(clipPlayer.playing).toBe(true);
      expect(clipPlayer.seconds).toBeGreaterThan(2.1);
      expect(clipPlayer.seconds).toBeLessThan(clip.duration);
      expect(sync.snapshot.paused).toBe(false);
      expect(started).toHaveLength(1);
      expect(stopped).toHaveLength(0);
    } finally {
      sync.dispose();
    }
  });

  it('allows a zero-tail render to remain Score-mastered with matching axes', async () => {
    stubOfflineContext();
    const score = buildTwoNoteScore();
    const clip = await renderScoreToClip(score, {
      synth: recordingSynth(), reverb: false, sampleRate: 1000, tailSeconds: 0,
    });
    const {ctx, advance} = fakeSharedContext();
    const {sync, scorePlayer, clipPlayer} = createSyncedPlayback(score, clip, {
      context: ctx,
      scoreOptions: {synth: recordingSynth(), reverb: false},
      tick: {intervalMs: 25, createWorker: () => null},
    });
    try {
      await sync.play();
      await runAsync(advance, 300);
      expect(clipPlayer.seconds).toBeCloseTo(scorePlayer.nominalSeconds, 9);
      expect(sync.checkDrift()).toBeCloseTo(0, 9);
    } finally {
      sync.dispose();
    }
  });

  it('joins the clip at a valid initial Score tempo instead of beginning with a slope mismatch', async () => {
    const score = buildTwoNoteScore();
    const clip = createAudioClip({channelData: [new Float32Array(3000)], sampleRate: 1000});
    const {ctx, advance} = fakeSharedContext();
    const {sync, scorePlayer, clipPlayer} = createSyncedPlayback(score, clip, {
      context: ctx,
      scoreOptions: {synth: recordingSynth(), reverb: false, tempo: 240},
      driftCheckIntervalMs: 0,
      tick: {intervalMs: 25, createWorker: () => null},
    });
    try {
      await sync.play();
      run(advance, 300);
      expect(scorePlayer.clock.rate).toBe(2);
      expect(clipPlayer.clock?.rate).toBe(2);
      expect(clipPlayer.seconds).toBeCloseTo(scorePlayer.nominalSeconds, 9);
      expect(sync.checkDrift()).toBeCloseTo(0, 9);
    } finally {
      sync.dispose();
    }
  });

  it('starts both players on one shared armed origin, first sounds together', async () => {
    const {ctx, started, advance, synth, sync, scorePlayer, clipPlayer} = makeSyncedWorld();

    await sync.play();

    // The score armed itself at the proposed origin (now + leadIn)...
    expect(scorePlayer.clock.holding).toBe(true);
    const origin = scorePlayer.clock.state.originTime;
    expect(origin).toBeCloseTo(0.06, 9);
    // ...and the buffer engine was scheduled at the VERY SAME instant, from
    // the matching position. This is the zero-gap contract.
    expect(started).toHaveLength(1);
    expect(started[0].when).toBe(origin);
    expect(started[0].offset).toBeCloseTo(0, 9);

    run(advance, 300);
    // The score's first attack lands on the shared origin, not before/after.
    expect(synth.ons[0]?.midi).toBe(Pitch.parse('C4').midi);
    expect(synth.ons[0]?.time).toBeCloseTo(origin, 9);
    // Past the join, the two transport clocks read identical positions.
    const now = ctx.currentTime;
    expect(clipPlayer.clock?.positionAt(now)).toBeCloseTo(scorePlayer.clock.positionAt(now), 9);
    expect(sync.checkDrift()).toBeCloseTo(0, 9);
    sync.dispose();
  });

  it('re-arms a fresh shared origin on resume, from the paused position', async () => {
    const {started, advance, sync, scorePlayer} = makeSyncedWorld();

    await sync.play();
    run(advance, 300); // origin 0.06 + 0.24 of playback
    sync.pause();
    expect(scorePlayer.clock.paused).toBe(true);
    const pausedAt = scorePlayer.nominalSeconds;
    expect(pausedAt).toBeCloseTo(0.24, 9);

    run(advance, 100);
    await sync.play();

    // A fresh origin a lead-in out, both players re-anchored to it together.
    expect(scorePlayer.clock.holding).toBe(true);
    const resumedOrigin = scorePlayer.clock.state.originTime;
    expect(resumedOrigin).toBeCloseTo(0.46, 9);
    const rejoin = started.at(-1);
    expect(rejoin?.when).toBe(resumedOrigin);
    expect(rejoin?.offset).toBeCloseTo(pausedAt, 9);
    sync.dispose();
  });

  it('re-enters a mid-playback seek on a shared origin, both sides together', async () => {
    const {ctx, started, advance, synth, sync, scorePlayer, clipPlayer} = makeSyncedWorld();

    await sync.play();
    run(advance, 200);
    const onsBeforeSeek = synth.ons.length;
    await sync.seek(1.0);

    // The score ARMS its restart rather than resuming a lead-in ahead of the
    // clip, and the clip re-joins at that very instant from the seek target.
    expect(scorePlayer.clock.holding).toBe(true);
    const origin = scorePlayer.clock.state.originTime;
    expect(origin).toBeCloseTo(ctx.currentTime + 0.06, 9);
    const rejoin = started.at(-1);
    expect(rejoin?.when).toBe(origin);
    expect(rejoin?.offset).toBeCloseTo(1.0, 9);
    // Nothing sounds during the shared pre-roll — no score-only opening.
    expect(synth.ons).toHaveLength(onsBeforeSeek);

    run(advance, 200);
    const now = ctx.currentTime;
    expect(clipPlayer.clock?.positionAt(now)).toBeCloseTo(scorePlayer.clock.positionAt(now), 9);
    expect(sync.checkDrift()).toBeCloseTo(0, 9);
    sync.dispose();
  });

  it('wraps a loop onto a shared origin — no score-only opening per cycle', async () => {
    const {started, advance, sync, scorePlayer, clipPlayer} = makeSyncedWorld();

    sync.setLoop({startSeconds: 0, endSeconds: 0.5});
    await sync.play();
    const startsBeforeWrap = started.length;
    await runAsync(advance, 700); // past the boundary; a tick fires the wrap

    expect(started.length).toBeGreaterThan(startsBeforeWrap);
    // The wrapped cycle re-enters exactly like a start: master armed, clip
    // scheduled at the same origin, both from the loop start.
    expect(scorePlayer.clock.holding).toBe(true);
    const rejoin = started.at(-1);
    expect(rejoin?.when).toBe(scorePlayer.clock.state.originTime);
    expect(rejoin?.offset).toBeCloseTo(0, 9);

    run(advance, 200); // through the shared origin into the new cycle
    expect(clipPlayer.clock?.positionAt(0.9)).toBeCloseTo(scorePlayer.clock.positionAt(0.9), 9);
    sync.dispose();
  });

  it('does not restart a longer clip early when the score finishes before the loop end', async () => {
    const {started, advance, sync, scorePlayer} = makeSyncedWorld();

    sync.setLoop({startSeconds: 0, endSeconds: 5});
    await sync.play();
    // The score ends at 2s; the decoded clip continues for 3s. The group
    // observes the natural score stop and schedules one shared re-entry.
    await runAsync(advance, 2100);

    expect(started).toHaveLength(2);
    expect(started[1].offset).toBeCloseTo(0, 9);
    expect(started[1].when).toBe(scorePlayer.clock.state.originTime);
    sync.dispose();
  });
});

describe.each([
  ['score master', createSyncedPlayback],
  ['audio master', createAudioMasteredPlayback],
] as const)('%s group controls with real players', (_name, create) => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('applies a shared rate change to both transport clocks', async () => {
    const {advance, sync, scorePlayer, clipPlayer} = makeSyncedWorld(0.06, create);
    try {
      await sync.play();
      await runAsync(advance, 100);
      sync.setRate(2);
      await runAsync(advance, 200);

      expect(scorePlayer.clock.rate).toBe(2);
      expect(clipPlayer.clock?.rate).toBe(2);
      expect(clipPlayer.seconds).toBeCloseTo(scorePlayer.nominalSeconds, 9);
      expect(sync.checkDrift()).toBeCloseTo(0, 9);
    } finally {
      sync.dispose();
    }
  });

  it('wraps a group loop through shared re-entry without enabling native clip looping', async () => {
    const {started, advance, sync, scorePlayer, clipPlayer} = makeSyncedWorld(0.06, create);
    const setNativeLoop = vi.spyOn(clipPlayer, 'setLoop');
    try {
      sync.setLoop({startSeconds: 0.1, endSeconds: 0.5});
      await sync.play();
      await runAsync(advance, 800);

      expect(started.length).toBeGreaterThan(1);
      expect(started.at(-1)?.offset).toBeCloseTo(0.1, 9);
      expect(started.at(-1)?.when).toBe(scorePlayer.clock.state.originTime);
      expect(clipPlayer.clock?.state.originTime).toBe(scorePlayer.clock.state.originTime);
      expect(clipPlayer.seconds).toBeCloseTo(scorePlayer.nominalSeconds, 9);
      expect(sync.checkDrift()).toBeCloseTo(0, 9);
      expect(setNativeLoop).not.toHaveBeenCalled();
      sync.setLoop(null);
      expect(sync.loop).toBeNull();
    } finally {
      sync.dispose();
    }
  });
});
