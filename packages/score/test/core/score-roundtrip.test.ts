import {describe, expect, it} from 'vitest';
import {
  Duration,
  Part,
  Pitch,
  Rational,
  ScoreBuilder,
  notesAt,
  notesIn,
  scoreFromJSON,
} from '../../src/core';

function buildCMajorChord() {
  const b = new ScoreBuilder();
  b.setMetadata({title: 'C Major', composer: 'Test'});
  const pianoId = b.addPart({id: b.newPartId(), name: 'Piano', midiProgram: 0, staves: 2});
  const v1 = b.newVoiceId();
  const pitches = ['C4', 'E4', 'G4'];
  pitches.forEach((p, i) => {
    b.addNote(pianoId, {
      id: b.newNoteId(),
      pitch: Pitch.parse(p),
      onsetQuarters: Rational.ZERO,
      duration: Duration.whole(),
      voice: v1,
      chord: i !== 0,
    });
  });
  b.addMeasure({
    id: b.newMeasureId(),
    number: 1,
    onsetQuarters: Rational.ZERO,
    durationQuarters: new Rational(4),
    timeSignature: {numerator: 4, denominator: 4},
    keySignature: {fifths: 0, mode: 'major'},
    tempo: {bpm: 120},
  });
  return b.build();
}

describe('Score', () => {
  it('builder produces a usable Score', () => {
    const score = buildCMajorChord();
    expect(score.parts).toHaveLength(1);
    expect([...score.allNotes()]).toHaveLength(3);
    expect(score.durationQuarters.eq(new Rational(4))).toBe(true);
    expect(score.durationSeconds).toBeCloseTo(2);
  });

  it('notesAt returns the three chord tones at q=1', () => {
    const score = buildCMajorChord();
    const sounding = notesAt(score, Rational.ONE).map((n) => n.pitch.toString()).sort();
    expect(sounding).toEqual(['C4', 'E4', 'G4']);
  });

  it('notesIn is half-open at the right boundary', () => {
    const score = buildCMajorChord();
    expect(notesIn(score, Rational.ZERO, new Rational(4))).toHaveLength(3);
    expect(notesIn(score, new Rational(4), new Rational(8))).toHaveLength(0);
  });

  it('toJSON ↔ fromJSON round-trips with note IDs preserved', () => {
    const score = buildCMajorChord();
    const json = JSON.parse(JSON.stringify(score));
    const back = scoreFromJSON(json);
    expect(back.metadata.title).toBe('C Major');
    expect([...back.allNotes()].map((n) => n.id).sort()).toEqual(
      [...score.allNotes()].map((n) => n.id).sort(),
    );
    expect(back.durationQuarters.eq(score.durationQuarters)).toBe(true);
    expect(back.durationSeconds).toBeCloseTo(score.durationSeconds);
  });

  it('immutable updates do not mutate the original', () => {
    const score = buildCMajorChord();
    const updated = score.withMetadata({composer: 'Other'});
    expect(score.metadata.composer).toBe('Test');
    expect(updated.metadata.composer).toBe('Other');
    expect(updated).not.toBe(score);
  });

  it('notes/durationQuarters are stable, memoized references', () => {
    const score = buildCMajorChord();
    expect(score.notes).toBe(score.notes); // same frozen array each access
    expect(Object.isFrozen(score.notes)).toBe(true);
    expect(score.notes).toHaveLength(3);
    expect(score.durationQuarters).toBe(score.durationQuarters);
  });

  it('withPart replaces in place and preserves part order', () => {
    const b = new ScoreBuilder();
    const a = b.addPart({id: b.newPartId(), name: 'A'});
    b.addPart({id: b.newPartId(), name: 'C'});
    const score = b.build();
    expect(score.parts.map((p) => p.name)).toEqual(['A', 'C']);

    const updated = score.withPart(new Part({id: a, name: 'A2', notes: []}));
    expect(updated.parts.map((p) => p.name)).toEqual(['A2', 'C']); // order kept

    const appended = score.withPart(new Part({id: b.newPartId(), name: 'Z', notes: []}));
    expect(appended.parts.map((p) => p.name)).toEqual(['A', 'C', 'Z']); // new → appended
  });
});
