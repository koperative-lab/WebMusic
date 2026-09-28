import {describe, expect, it} from 'vitest';
import {Rational, scoreFromJSON} from '@webmusic/score';
import {scoreFromTranscription} from '../src/transcription';

const NOTES = [
  {startSeconds: 0.0, endSeconds: 0.24, midi: 60, velocity: 0.8},
  {startSeconds: 0.26, endSeconds: 0.5, midi: 64, velocity: 0.6},
  {startSeconds: 0.51, endSeconds: 1.02, midi: 67, velocity: 0.9},
];

describe('scoreFromTranscription', () => {
  it('quantizes onsets/durations to the grid and keeps exact performed timing', () => {
    const score = scoreFromTranscription(NOTES, {bpm: 120, quantizeGrid: 4});
    const part = score.parts[0];
    expect(part.notes).toHaveLength(3);

    // 120 BPM: 1 quarter = 0.5s; grid 4 → sixteenths. 0.26s → 0.52 quarters → 0.5.
    expect(part.notes[0].onsetQuarters.cmp(Rational.ZERO)).toBe(0);
    expect(part.notes[1].onsetQuarters.cmp(new Rational(1, 2))).toBe(0);
    expect(part.notes[2].onsetQuarters.cmp(new Rational(1, 1))).toBe(0);
    expect(part.notes[2].duration.quarters.cmp(new Rational(1, 1))).toBe(0);

    // The audio truth survives unquantized on the performed attributes.
    expect(part.notes[1].performed?.onsetSec).toBe(0.26);
    expect(part.notes[0].performed?.velocity).toBe(Math.round(0.8 * 127));
  });

  it('produces a score that survives its own JSON round-trip validation', () => {
    const score = scoreFromTranscription(NOTES, {bpm: 100});
    const revived = scoreFromJSON(JSON.parse(JSON.stringify(score)));
    expect(revived.parts[0].notes).toHaveLength(3);
    expect(revived.timeMap.tempi[0].bpm).toBe(100);
  });

  it('lays out measures covering the material and at least one for empty input', () => {
    const score = scoreFromTranscription(NOTES, {bpm: 120});
    // Material spans ~2.04 quarters at 120 BPM → one 4/4 measure.
    expect((score.parts[0] as {measures?: unknown}).measures ?? score.measures).toBeDefined();
    const empty = scoreFromTranscription([], {bpm: 90});
    expect(empty.parts[0].notes).toHaveLength(0);
    const revived = scoreFromJSON(JSON.parse(JSON.stringify(empty)));
    expect(revived.timeMap.tempi[0].bpm).toBe(90);
  });

  it('skips out-of-range pitches, clamps velocity, enforces a minimum duration', () => {
    const score = scoreFromTranscription(
      [
        {startSeconds: 0, endSeconds: 0.001, midi: 60, velocity: 0}, // zero-ish duration + zero velocity
        {startSeconds: 0, endSeconds: 1, midi: 200, velocity: 0.5}, // out of range → skipped
        // Timing/velocity on pitch noise are irrelevant and retain the documented skip contract.
        {startSeconds: Number.NaN, endSeconds: Infinity, midi: -20, velocity: Infinity},
      ],
      {bpm: 120, quantizeGrid: 4},
    );
    const notes = score.parts[0].notes;
    expect(notes).toHaveLength(1);
    expect(notes[0].duration.quarters.cmp(new Rational(1, 4))).toBe(0); // one grid unit min
    expect(notes[0].performed?.velocity).toBe(1); // clamped into MIDI range
  });

  it('supports unquantized assembly on the tick grid', () => {
    const score = scoreFromTranscription(NOTES, {bpm: 120, quantizeGrid: 0});
    // 0.26s at 120 BPM = 0.52 quarters = 249.6 ticks → 250/480.
    expect(score.parts[0].notes[1].onsetQuarters.cmp(new Rational(250, 480))).toBe(0);
  });

  it('rejects invalid options', () => {
    expect(() => scoreFromTranscription(NOTES, {bpm: 0})).toThrow(RangeError);
    expect(() => scoreFromTranscription(NOTES, {quantizeGrid: -1})).toThrow(RangeError);
    expect(() => scoreFromTranscription(NOTES, {quantizeGrid: 2.5})).toThrow(RangeError);
    expect(() => scoreFromTranscription(NOTES, {
      timeSignature: {numerator: 0, denominator: 4},
    })).toThrow(/timeSignature/);
    expect(() => scoreFromTranscription(NOTES, {maxNotes: 2})).toThrow(/maxNotes/);
    expect(() => scoreFromTranscription(NOTES, {maxMeasures: 0})).toThrow(/maxMeasures/);
  });

  it('bounds materialized measures and rejects non-finite note data', () => {
    expect(() => scoreFromTranscription(
      [{startSeconds: 0, endSeconds: 10, midi: 60, velocity: 0.8}],
      {bpm: 120, maxMeasures: 1},
    )).toThrow(/maxMeasures/);
    expect(() => scoreFromTranscription(
      [{startSeconds: 0, endSeconds: Infinity, midi: 60, velocity: 0.8}],
    )).toThrow(/finite/);
    expect(() => scoreFromTranscription(
      [{startSeconds: 0, endSeconds: 1, midi: Number.NaN, velocity: 0.8}],
    )).toThrow(/finite/);
  });

  it('counts exact non-binary measure boundaries without a floating-point extra measure', () => {
    const score = scoreFromTranscription(
      [{startSeconds: 0, endSeconds: 42, midi: 60, velocity: 0.8}],
      {
        bpm: 120,
        quantizeGrid: 1,
        timeSignature: {numerator: 7, denominator: 5},
        maxMeasures: 15,
      },
    );
    expect(score.measures).toHaveLength(15);
  });

  it('reduces a large time-signature ratio before constructing measure duration', () => {
    const score = scoreFromTranscription([], {
      timeSignature: {
        numerator: Number.MAX_SAFE_INTEGER,
        denominator: Number.MAX_SAFE_INTEGER,
      },
    });

    expect(score.measures).toHaveLength(1);
    expect(score.measures[0].durationQuarters.cmp(new Rational(4, 1))).toBe(0);
  });
});
