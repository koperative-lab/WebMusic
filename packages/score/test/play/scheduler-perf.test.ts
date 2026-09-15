import {afterEach, describe, expect, it, vi} from 'vitest';
import {Duration, MeasureId, PartId, Pitch, Rational, ScoreBuilder, VoiceId} from '../../src/core';
import {ScorePlayer, type HeadlessSynth} from '../../src/play/headless';

// ---------------------------------------------------------------------------
// Tests for the scheduler performance fixes: rate-independent (nominal-seconds)
// snapshot, bounded committed[] in loop mode, and binary-search seek/resume.
// Mock-clock pattern mirrors headless-audio.test.ts.
// ---------------------------------------------------------------------------

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
  return {
    ons,
    offs,
    connect() {},
    disconnect() {},
    noteOn: (midi, _v, time) => ons.push({midi, time}),
    noteOff: (midi) => offs.push(midi),
  };
}

/** Drive both clocks forward in lockstep: audio time + fake timers. */
function run(advance: (ms: number) => void, totalMs: number, stepMs = 10) {
  for (let elapsed = 0; elapsed < totalMs; elapsed += stepMs) {
    advance(stepMs);
    vi.advanceTimersByTime(stepMs);
  }
}

/** Quarter notes C4, D4, E4, F4 at 120bpm → 0.5s each, 2.0s total. */
function buildFourNoteScore() {
  const builder = new ScoreBuilder();
  const partId = PartId('piano');
  const voice = VoiceId('piano-v1');
  const timeSignature = {numerator: 4, denominator: 4};
  builder
    .setMetadata({title: 'Four Notes'})
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
  for (const [i, name] of ['C4', 'D4', 'E4', 'F4'].entries()) {
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

/**
 * A long pedal note under shorter ones: A2 whole note at 0 (0–2s), C4 quarter
 * at 0 (0–0.5s), E4 quarter at 1.5q (0.75–1.25s), G4 quarter at 3q (1.5–2.0s).
 */
function buildSustainScore() {
  const builder = new ScoreBuilder();
  const partId = PartId('piano');
  const timeSignature = {numerator: 4, denominator: 4};
  builder
    .setMetadata({title: 'Sustain'})
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
  const add = (pitch: string, onsetQuarters: Rational, duration: Duration, voice: string) =>
    builder.addNote(partId, {id: builder.newNoteId(), pitch: Pitch.parse(pitch), onsetQuarters, duration, voice: VoiceId(voice)});
  add('A2', Rational.ZERO, Duration.whole(), 'v-pedal'); // 0.0 – 2.0s
  add('C4', Rational.ZERO, Duration.quarter(), 'v-melody'); // 0.0 – 0.5s
  add('E4', new Rational(3, 2), Duration.quarter(), 'v-melody'); // 0.75 – 1.25s
  add('G4', new Rational(3), Duration.quarter(), 'v-melody'); // 1.5 – 2.0s
  return builder.build();
}

describe('ScorePlayer scheduler performance fixes', () => {
  afterEach(() => vi.useRealTimers());

  it('setRate mid-playback preserves the musical position and schedules later notes at scaled times', async () => {
    vi.useFakeTimers();
    const {ctx, advance} = mockAudio();
    const synth = recordingSynth();
    const player = new ScorePlayer(buildFourNoteScore(), {audioContext: ctx, synth, reverb: false});

    await player.play();
    run(advance, 200); // C4 (nominal 0.0s) has sounded; we are at 0.2s musical time

    expect(synth.ons.map((o) => o.midi)).toEqual([60]);
    expect(player.currentTime.seconds).toBeCloseTo(0.2, 3);

    player.setRate(0.5); // half speed: every nominal second now takes 2 real seconds
    // The musical position must not jump on a rate change.
    expect(player.currentTime.seconds).toBeCloseTo(0.2, 3);
    // Total duration rescales: 2.0s nominal → 4.0s at half speed.
    expect(player.durationSeconds).toBeCloseTo(4.0, 3);

    // D4 sits at nominal 0.5s, i.e. 0.3 nominal seconds ahead → 0.6 real seconds
    // after the rate change (clock 0.2) → audio time 0.8.
    run(advance, 700);
    expect(synth.ons.map((o) => o.midi)).toEqual([60, 62]);
    expect(synth.ons[1].time).toBeCloseTo(0.8, 3);

    // E4 at nominal 1.0s → audio time 0.2 + (1.0 - 0.2) / 0.5 = 1.8.
    run(advance, 1000);
    expect(synth.ons.map((o) => o.midi)).toEqual([60, 62, 64]);
    expect(synth.ons[2].time).toBeCloseTo(1.8, 3);

    // And the cursor keeps advancing at the scaled rate.
    expect(player.currentTime.seconds).toBeCloseTo(0.2 + 1.7 * 0.5, 3);
    player.dispose();
  });

  it('repeated setRate calls reuse the cached snapshot and keep scheduling consistent', async () => {
    vi.useFakeTimers();
    const {ctx, advance} = mockAudio();
    const synth = recordingSynth();
    const player = new ScorePlayer(buildFourNoteScore(), {audioContext: ctx, synth, reverb: false});

    await player.play();
    run(advance, 100);
    player.setRate(2); // double speed at musical position 0.1s
    player.setRate(2); // no-op (same scale) must be harmless
    run(advance, 2000);
    // All four notes fire exactly once each, in order.
    expect(synth.ons.map((o) => o.midi)).toEqual([60, 62, 64, 65]);
    // D4 (nominal 0.5s): 0.1 + (0.5 - 0.1) / 2 = 0.3 on the audio clock.
    expect(synth.ons[1].time).toBeCloseTo(0.3, 3);
    player.dispose();
  });

  it('loop mode keeps the committed-note bookkeeping bounded across many iterations', async () => {
    vi.useFakeTimers();
    const {ctx, advance} = mockAudio();
    const synth = recordingSynth();
    const player = new ScorePlayer(buildFourNoteScore(), {audioContext: ctx, synth, reverb: false});
    const committed = () => (
      player as unknown as {scheduler: {committed: unknown[]}}
    ).scheduler.committed.length;

    player.setLoop(0, 2.0);
    await player.play();

    const sizes: number[] = [];
    for (let i = 0; i < 10; i += 1) {
      run(advance, 2000); // one full loop iteration
      sizes.push(committed());
    }
    // Each iteration replays the 4 notes; noteOns keep flowing…
    expect(synth.ons.length).toBeGreaterThanOrEqual(40);
    // …but the bookkeeping never accumulates: records are pruned once both
    // dispatch timers fire, so the size stays bounded by the lookahead window
    // (a handful of in-flight notes), not by the number of iterations.
    expect(Math.max(...sizes)).toBeLessThanOrEqual(4);
    expect(sizes[sizes.length - 1]).toBeLessThanOrEqual(sizes[0] + 1); // no growth trend
    // pause() still cancels every in-flight dispatch timer.
    player.pause();
    expect(committed()).toBe(0);
    const onsAtPause = synth.ons.length;
    run(advance, 1000);
    expect(synth.ons.length).toBe(onsAtPause);
    player.dispose();
  });

  it('seek resumes at the right snapshot index, including a long sustained note from before the seek point', async () => {
    vi.useFakeTimers();
    const {ctx, advance} = mockAudio();
    const synth = recordingSynth();
    const player = new ScorePlayer(buildSustainScore(), {audioContext: ctx, synth, reverb: false});

    await player.play();
    run(advance, 50);
    // Seek to 1.4s: A2 (0–2s) is still sounding and must be re-committed;
    // C4 (0–0.5s) and E4 (0.75–1.25s) ended before the seek point and must not;
    // G4 (1.5–2s) lies ahead and plays at its normal time.
    synth.ons.length = 0;
    player.seek(1.4);
    expect(player.currentTime.seconds).toBeCloseTo(1.4, 3);
    run(advance, 400);

    const midis = synth.ons.map((o) => o.midi).sort((a, b) => a - b);
    expect(midis).toEqual([45, 67]); // A2 resumes, G4 plays — C4/E4 stay silent
    player.dispose();
  });
});
