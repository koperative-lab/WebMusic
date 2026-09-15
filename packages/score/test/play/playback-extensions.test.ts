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
  type PartData,
} from '../../src/core';
import {ScorePlayer, type HeadlessSynth} from '../../src/play/headless';

// ---------------------------------------------------------------------------
// Test doubles (same pattern as headless-audio.test.ts).
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
  } as unknown as AudioContext;
  return {ctx, advance: (ms: number) => (t += ms / 1000)};
}

/** A synth that records every noteOn with the exact audio time + duration it was given. */
function recordingSynth(): HeadlessSynth & {ons: Array<{midi: number; time: number; duration: number}>} {
  const ons: Array<{midi: number; time: number; duration: number}> = [];
  return {
    ons,
    connect() {},
    disconnect() {},
    noteOn: (midi, _v, time, duration) => ons.push({midi, time, duration}),
    noteOff() {},
  };
}

/** Drive both clocks forward in lockstep: audio time + fake timers. */
function run(advance: (ms: number) => void, totalMs: number, stepMs = 10) {
  for (let elapsed = 0; elapsed < totalMs; elapsed += stepMs) {
    advance(stepMs);
    vi.advanceTimersByTime(stepMs);
  }
}

/** 120bpm 4/4 score: `measures` bars, with notes added by the callback. */
function build(
  measures: Array<Partial<Parameters<ScoreBuilder['addMeasure']>[0]>>,
  part: Partial<Omit<PartData, 'notes'>>,
  notes: Array<Partial<NoteData> & Pick<NoteData, 'onsetQuarters' | 'duration'>>,
) {
  const b = new ScoreBuilder();
  const partId = PartId('p');
  const voice = VoiceId('v');
  const ts = {numerator: 4, denominator: 4};
  b.addTempo({atQuarters: Rational.ZERO, bpm: 120}).addMeter({
    atQuarters: Rational.ZERO,
    measureNumber: 1,
    timeSignature: ts,
  });
  b.addPart({id: partId, name: 'P', ...part});
  measures.forEach((extra, i) =>
    b.addMeasure({
      id: MeasureId(`m${i + 1}`),
      number: i + 1,
      onsetQuarters: new Rational(4 * i),
      durationQuarters: new Rational(4),
      ...(i === 0 ? {timeSignature: ts} : {}),
      ...extra,
    }),
  );
  for (const n of notes) b.addNote(partId, {id: b.newNoteId(), voice, ...n} as NoteData);
  return b.build();
}

describe('ScorePlayer performance semantics', () => {
  afterEach(() => vi.useRealTimers());

  it('a tied pair is attacked exactly once, with the merged duration', async () => {
    vi.useFakeTimers();
    const {ctx, advance} = mockAudio();
    const synth = recordingSynth();
    // C4 quarter (tie start) + C4 quarter (tie stop): one 1.0s sounding event at 120bpm.
    const score = build([{}], {}, [
      {pitch: Pitch.parse('C4'), onsetQuarters: Rational.ZERO, duration: Duration.quarter(), tie: 'start'},
      {pitch: Pitch.parse('C4'), onsetQuarters: Rational.ONE, duration: Duration.quarter(), tie: 'stop'},
    ]);
    const player = new ScorePlayer(score, {audioContext: ctx, synth, reverb: false});
    const noteOns: number[] = [];
    player.on('noteOn', () => noteOns.push(1));
    await player.play();
    run(advance, 2500);
    expect(synth.ons).toHaveLength(1);
    expect(synth.ons[0].midi).toBe(60);
    // The fake clock wakes the JIT timer at 10ms. Its remaining gate still
    // ends at the tied event's original 1.0s logical endpoint.
    expect(synth.ons[0].time + synth.ons[0].duration).toBeCloseTo(1.0, 6);
    expect(noteOns).toHaveLength(1);
    player.dispose();
  });

  it('rest and grace notes are never scheduled', async () => {
    vi.useFakeTimers();
    const {ctx, advance} = mockAudio();
    const synth = recordingSynth();
    const score = build([{}], {}, [
      {rest: true, onsetQuarters: Rational.ZERO, duration: Duration.quarter()},
      {pitch: Pitch.parse('B3'), onsetQuarters: Rational.ONE, duration: new Duration({base: 0}), grace: true},
      {pitch: Pitch.parse('C4'), onsetQuarters: Rational.ONE, duration: Duration.quarter()},
    ]);
    const player = new ScorePlayer(score, {audioContext: ctx, synth, reverb: false});
    await player.play();
    run(advance, 2500);
    expect(synth.ons).toHaveLength(1); // only the principal C4
    expect(synth.ons[0].midi).toBe(60);
    player.dispose();
  });

  it('transposing parts play at sounding pitch (written + chromatic + 12·octaveChange)', async () => {
    vi.useFakeTimers();
    const {ctx, advance} = mockAudio();
    const synth = recordingSynth();
    // Bb clarinet: written D4 (62) sounds C4 (60).
    const score = build([{}], {transpose: {chromatic: -2, diatonic: -1}}, [
      {pitch: Pitch.parse('D4'), onsetQuarters: Rational.ZERO, duration: Duration.quarter()},
    ]);
    const player = new ScorePlayer(score, {audioContext: ctx, synth, reverb: false});
    await player.play();
    run(advance, 1500);
    expect(synth.ons.map((o) => o.midi)).toEqual([60]);
    player.dispose();
  });

  it('expandRepeats: true doubles durationSeconds and plays the repeated span twice', async () => {
    vi.useFakeTimers();
    const {ctx, advance} = mockAudio();
    const synth = recordingSynth();
    const score = build([{repeat: {start: true, end: true}}], {}, [
      {pitch: Pitch.parse('C4'), onsetQuarters: Rational.ZERO, duration: Duration.whole()},
    ]);
    const plain = new ScorePlayer(score, {audioContext: ctx, synth, reverb: false});
    expect(plain.durationSeconds).toBeCloseTo(2, 3); // 4 quarters @ 120bpm
    plain.dispose();

    const expanded = new ScorePlayer(score, {audioContext: ctx, synth, reverb: false, expandRepeats: true});
    expect(expanded.durationSeconds).toBeCloseTo(4, 3);
    await expanded.play();
    run(advance, 4500);
    expect(synth.ons).toHaveLength(2); // the bar is played twice
    expect(synth.ons[1].time).toBeCloseTo(2, 1);
    expanded.dispose();
  });
});

describe('ScorePlayer tie + transposition interaction', () => {
  afterEach(() => vi.useRealTimers());

  // Ported from the removed TonePlayer suite: a tied pair on a transposing
  // part is attacked once, at sounding pitch, with the merged duration, while
  // an interleaved rest is skipped.
  it('schedules a tied pair as one transposed noteOn', async () => {
    vi.useFakeTimers();
    const {ctx, advance} = mockAudio();
    const synth = recordingSynth();
    const score = build([{}], {transpose: {chromatic: -2}}, [
      {pitch: Pitch.parse('D4'), onsetQuarters: Rational.ZERO, duration: Duration.quarter(), tie: 'start'},
      {pitch: Pitch.parse('D4'), onsetQuarters: Rational.ONE, duration: Duration.quarter(), tie: 'stop'},
      {rest: true, onsetQuarters: new Rational(2), duration: Duration.quarter()},
    ]);
    const player = new ScorePlayer(score, {audioContext: ctx, synth, reverb: false});
    await player.play();
    run(advance, 2500);
    expect(synth.ons).toHaveLength(1); // one attack: tie merged, rest skipped
    expect(synth.ons[0].midi).toBe(60); // written D4 sounds C4
    expect(synth.ons[0].time + synth.ons[0].duration).toBeCloseTo(1.0, 6);
    player.dispose();
  });
});
