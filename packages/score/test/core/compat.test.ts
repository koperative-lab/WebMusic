import {describe, expect, it} from 'vitest';
import {
  Duration,
  Pitch,
  Rational,
  ScoreBuilder,
  locateSeconds,
  locateTick,
  noteDurationSeconds,
  noteOnsetSeconds,
  noteVelocity,
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

describe('independent note velocity', () => {
  it('keeps velocity-only edits responsive to tempo changes across a note', () => {
    const builder = new ScoreBuilder();
    const partId = builder.addPart({id: builder.newPartId(), name: 'Piano'});
    const id = builder.newNoteId();
    const firstMeasure = builder.newMeasureId();
    const secondMeasure = builder.newMeasureId();
    builder.addMeasure({
      id: firstMeasure, number: 1, onsetQuarters: Rational.ZERO,
      durationQuarters: new Rational(2), tempo: {bpm: 120},
    });
    builder.addMeasure({
      id: secondMeasure, number: 2, onsetQuarters: new Rational(2),
      durationQuarters: new Rational(2), tempo: {bpm: 60},
    });
    builder.addNote(partId, {
      id, pitch: Pitch.parse('C4'), onsetQuarters: Rational.ONE,
      duration: Duration.half(), voice: builder.newVoiceId(),
    });
    const original = builder.build();
    const edited = original.edit((tx) => tx.updateNote(id, {velocityOverride: 110}));
    expect(edited.getNote(id)?.performed).toBeUndefined();
    expect(noteVelocity(edited.getNote(id)!)).toBe(110);
    expect(noteOnsetSeconds(edited.getNote(id)!, edited)).toBeCloseTo(0.5);
    expect(noteDurationSeconds(edited.getNote(id)!, edited)).toBeCloseTo(1.5);

    const slower = edited.edit((tx) => {
      tx.updateMeasure(firstMeasure, {tempo: {bpm: 60}});
      tx.updateMeasure(secondMeasure, {tempo: {bpm: 30}});
    });
    expect(noteOnsetSeconds(slower.getNote(id)!, slower)).toBeCloseTo(1);
    expect(noteDurationSeconds(slower.getNote(id)!, slower)).toBeCloseTo(3);
    expect(noteVelocity(slower.getNote(id)!)).toBe(110);
    expect(noteVelocity(original.getNote(id)!)).toBe(80);

    const performed = edited.getNote(id)!.with({performed: {onsetSec: 0.52, durationSec: 1.4, velocity: 70}});
    expect(noteVelocity(performed)).toBe(110);
    expect(noteVelocity(performed.with({velocityOverride: undefined}))).toBe(70);
    expect(noteOnsetSeconds(performed, slower)).toBe(0.52);
    expect(noteDurationSeconds(performed, slower)).toBe(1.4);
  });

  it('resolves velocity for plain note data such as toJSON output and structured clones', () => {
    const builder = new ScoreBuilder();
    const partId = builder.addPart({id: builder.newPartId(), name: 'Piano'});
    const id = builder.newNoteId();
    builder.addNote(partId, {id, pitch: Pitch.parse('C4'), onsetQuarters: Rational.ZERO, duration: Duration.quarter(),
      voice: builder.newVoiceId(), performed: {onsetSec: 0, durationSec: 0.5, velocity: 70}});
    const note = builder.build().getNote(id)!;
    const plain = (value: unknown) => value as Parameters<typeof noteVelocity>[0];
    expect(noteVelocity(plain(note.toJSON()))).toBe(70);
    expect(noteVelocity(plain(structuredClone(note.toJSON())))).toBe(70);
    expect(noteVelocity(plain({...note.toJSON(), velocityOverride: 101}))).toBe(101);
    expect(noteVelocity(plain({...note.toJSON(), performed: undefined}))).toBe(80);
  });
});
