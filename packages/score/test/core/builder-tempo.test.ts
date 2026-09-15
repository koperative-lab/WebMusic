import {describe, expect, it} from 'vitest';
import {Duration, Pitch, Rational, ScoreBuilder} from '../../src/core';

function buildWithMeasureTempo(bpm: number) {
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
    tempo: {bpm},
  });
  return b.build();
}

describe('ScoreBuilder measure-level tempo/meter', () => {
  it('measure tempo of 60 actually affects durationSeconds', () => {
    // 4 quarters at 60 bpm = 4 seconds (was 2s when the tempo was ignored).
    const score = buildWithMeasureTempo(60);
    expect(score.durationSeconds).toBeCloseTo(4);
    expect(score.timeMap.tempoAt(Rational.ZERO).bpm).toBe(60);
  });

  it('measure tempo of 240 shortens durationSeconds', () => {
    const score = buildWithMeasureTempo(240);
    expect(score.durationSeconds).toBeCloseTo(1);
  });

  it('measure timeSignature feeds the time map', () => {
    const b = new ScoreBuilder();
    b.addMeasure({
      id: b.newMeasureId(),
      number: 1,
      onsetQuarters: Rational.ZERO,
      durationQuarters: new Rational(3),
      timeSignature: {numerator: 3, denominator: 4},
    });
    b.addMeasure({
      id: b.newMeasureId(),
      number: 2,
      onsetQuarters: new Rational(3),
      durationQuarters: new Rational(4),
      timeSignature: {numerator: 4, denominator: 4},
    });
    const score = b.build();
    expect(score.timeMap.timeSignatureAt(Rational.ZERO)).toEqual({numerator: 3, denominator: 4});
    expect(score.timeMap.timeSignatureAt(new Rational(3))).toEqual({numerator: 4, denominator: 4});
    expect(score.timeMap.quartersToMBS(new Rational(4))).toMatchObject({measure: 2, beat: 2});
  });

  it('explicit addTempo wins over a measure tempo at the same position', () => {
    const b = new ScoreBuilder();
    b.addTempo({atQuarters: Rational.ZERO, bpm: 100});
    b.addMeasure({
      id: b.newMeasureId(),
      number: 1,
      onsetQuarters: Rational.ZERO,
      durationQuarters: new Rational(4),
      tempo: {bpm: 60},
    });
    const score = b.build();
    expect(score.timeMap.tempoAt(Rational.ZERO).bpm).toBe(100);
  });

  it('mid-piece measure tempo creates a second segment', () => {
    const b = new ScoreBuilder();
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
      tempo: {bpm: 60},
    });
    const score = b.build();
    // 4q at 120 = 2s, then 4q at 60 = 4s.
    expect(score.timeMap.quartersToSeconds(new Rational(8))).toBeCloseTo(6);
  });

  it('still defaults to 120 bpm 4/4 when nothing is specified', () => {
    const b = new ScoreBuilder();
    b.addPart({id: b.newPartId(), name: 'P'});
    const score = b.build();
    expect(score.timeMap.tempoAt(Rational.ZERO).bpm).toBe(120);
    expect(score.timeMap.timeSignatureAt(Rational.ZERO)).toEqual({numerator: 4, denominator: 4});
  });

  it('anchors a generated q=0 meter to the q=0 measure, not add order', () => {
    const b = new ScoreBuilder();
    // Importers may discover later bars before the opening measure. Neither
    // measure declares meter metadata, so Builder supplies the 4/4 anchor.
    b.addMeasure({
      id: b.newMeasureId(),
      number: 2,
      onsetQuarters: new Rational(4),
      durationQuarters: new Rational(4),
    });
    b.addMeasure({
      id: b.newMeasureId(),
      number: 1,
      onsetQuarters: Rational.ZERO,
      durationQuarters: new Rational(4),
    });

    const score = b.build();
    expect(score.timeMap.meters[0]).toMatchObject({
      atQuarters: Rational.ZERO,
      measureNumber: 1,
      timeSignature: {numerator: 4, denominator: 4},
    });
  });

  it('uses the earliest onset when no measure starts at q=0', () => {
    const b = new ScoreBuilder();
    b.addMeasure({
      id: b.newMeasureId(),
      number: 3,
      onsetQuarters: new Rational(8),
      durationQuarters: new Rational(4),
    });
    b.addMeasure({
      id: b.newMeasureId(),
      number: 2,
      onsetQuarters: new Rational(4),
      durationQuarters: new Rational(4),
    });

    expect(b.build().timeMap.meters[0].measureNumber).toBe(2);
  });
});
