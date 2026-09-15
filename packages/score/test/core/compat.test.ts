import {describe, expect, it} from 'vitest';
import {
  Duration,
  Pitch,
  Rational,
  ScoreBuilder,
  locateSeconds,
  locateTick,
  secondsToTick,
  tickToSeconds,
} from '../../src/core';

function buildScore() {
  const b = new ScoreBuilder();
  const partId = b.addPart({id: b.newPartId(), name: 'Piano'});
  const voice = b.newVoiceId();
  b.addNote(partId, {
    id: b.newNoteId(),
    pitch: Pitch.parse('C4'),
    onsetQuarters: Rational.ZERO,
    duration: Duration.whole(),
    voice,
  });
  b.addMeasure({
    id: b.newMeasureId(),
    number: 1,
    onsetQuarters: Rational.ZERO,
    durationQuarters: new Rational(4),
    timeSignature: {numerator: 4, denominator: 4},
    tempo: {bpm: 120},
  });
  b.addMeasure({
    id: b.newMeasureId(),
    number: 2,
    onsetQuarters: new Rational(4),
    durationQuarters: new Rational(4),
  });
  return b.build();
}

describe('compat tick projections', () => {
  const score = buildScore();

  it('tickToSeconds at default 480 ppq', () => {
    expect(tickToSeconds(score, 0)).toBeCloseTo(0);
    expect(tickToSeconds(score, 480)).toBeCloseTo(0.5); // one quarter at 120 bpm
    expect(tickToSeconds(score, 1920)).toBeCloseTo(2);
  });

  it('tickToSeconds with custom ppq', () => {
    expect(tickToSeconds(score, 96, 96)).toBeCloseTo(0.5);
    expect(tickToSeconds(score, 384, 96)).toBeCloseTo(2);
  });

  it('secondsToTick inverts tickToSeconds at both ppqs', () => {
    expect(secondsToTick(score, 0.5)).toBe(480);
    expect(secondsToTick(score, 2)).toBe(1920);
    expect(secondsToTick(score, 0.5, 96)).toBe(96);
    expect(secondsToTick(score, 2, 96)).toBe(384);
  });

  it('locateTick gives consistent tick/seconds/measure/beat', () => {
    const pos = locateTick(score, 480 * 5); // quarter 5 → measure 2, beat 2
    expect(pos.tick).toBe(2400);
    expect(pos.seconds).toBeCloseTo(2.5);
    expect(pos.measure).toBe(2);
    expect(pos.beat).toBeCloseTo(2);
  });

  it('locateTick honors custom ppq', () => {
    const pos = locateTick(score, 96 * 5, 96);
    expect(pos.seconds).toBeCloseTo(2.5);
    expect(pos.measure).toBe(2);
    expect(pos.beat).toBeCloseTo(2);
  });

  it('locateSeconds round-trips through ticks', () => {
    const pos = locateSeconds(score, 2.5);
    expect(pos.tick).toBe(2400);
    expect(pos.measure).toBe(2);
    expect(pos.beat).toBeCloseTo(2);

    const pos96 = locateSeconds(score, 2.5, 96);
    expect(pos96.tick).toBe(480); // 5 quarters at 96 ppq
    expect(pos96.measure).toBe(2);
    expect(pos96.beat).toBeCloseTo(2);
  });
});
