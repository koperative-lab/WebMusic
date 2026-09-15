import {describe, expect, it} from 'vitest';
import {
  Duration, Measure, MeasureId, NoteId, Part, PartId, Pitch, Rational, Score, ScoreBuilder, VoiceId,
  expandRepeats, validateScore, type ScoreEditSession,
} from '../../src/core';

function repeatedScore(withCollision = false) {
  const builder = new ScoreBuilder();
  const part = builder.addPart({id: PartId('p'), name: 'Piano'});
  builder.addMeasure({id: MeasureId('m'), number: 1, onsetQuarters: Rational.ZERO,
    durationQuarters: new Rational(4), repeat: {start: true, end: true},
    tempo: {bpm: 120}, timeSignature: {numerator: 4, denominator: 4}, keySignature: {fifths: 0}});
  builder.addNote(part, {id: NoteId('n'), pitch: Pitch.parse('C4'), onsetQuarters: Rational.ZERO,
    duration: Duration.whole(), voice: VoiceId('v')});
  if (withCollision) {
    builder.addMeasure({id: MeasureId('m@2'), number: 2, onsetQuarters: new Rational(4), durationQuarters: new Rational(4)});
    builder.addNote(part, {id: NoteId('n@2'), pitch: Pitch.parse('G4'), onsetQuarters: new Rational(4),
      duration: Duration.whole(), voice: VoiceId('v')});
  }
  return builder.build();
}

describe('Score API immutable model and transform boundaries', () => {
  it('flattens a valid large part collection without spreading function arguments', () => {
    const source = repeatedScore();
    const parts = Array.from({length: 150_000}, (_, index) => new Part({
      id: PartId(`part-${index}`), name: 'Part', notes: index === 0 ? [source.notes[0]] : [],
    }));
    const score = new Score({id: source.id, metadata: source.metadata, parts,
      measures: source.measures, timeMap: source.timeMap});
    expect(score.notes).toEqual([source.notes[0]]);
    expect(score.notes).toBe(score.notes);
  });

  it('freezes cached legacy event records as well as their arrays', () => {
    const score = repeatedScore();
    const derived = score.withMetadata({title: 'Shared timeline'});
    for (const entries of [score.tempos, score.timeSignatures, score.keySignatures]) {
      expect(Object.isFrozen(entries)).toBe(true);
      expect(Object.isFrozen(entries[0])).toBe(true);
    }
    expect(Reflect.set(score.tempos[0], 'bpm', 999)).toBe(false);
    expect(derived.tempos[0].bpm).toBe(120);
  });

  it('preserves JSON metadata property names and null-prototype records without prototype assignment', () => {
    const custom = JSON.parse('{"__proto__":{"flag":true},"constructor":"value"}') as Record<string, unknown>;
    const nullRecord = Object.assign(Object.create(null) as Record<string, unknown>, {take: 1});
    const builder = new ScoreBuilder().setMetadata({custom: {...custom, nested: nullRecord}});
    const score = builder.build();
    expect(Object.hasOwn(score.metadata.custom!, '__proto__')).toBe(true);
    expect(Object.getPrototypeOf(score.metadata.custom!)).toBe(Object.prototype);
    expect(score.metadata.custom!.__proto__).toEqual({flag: true});
    expect(Object.getPrototypeOf(score.metadata.custom!.nested)).toBe(null);
    expect(JSON.parse(JSON.stringify(score.metadata.custom))['__proto__']).toEqual({flag: true});
  });

  it('closes an aborted edit session and preserves the original value', () => {
    const score = repeatedScore();
    let leaked!: ScoreEditSession;
    expect(() => score.edit((tx) => {
      leaked = tx;
      tx.updateNote(NoteId('n'), {lyric: 'uncommitted'});
      throw new Error('abort');
    })).toThrow('abort');
    expect(score.getNote(NoteId('n'))!.lyric).toBeUndefined();
    expect(() => leaked.updateNote(NoteId('n'), {lyric: 'late'})).toThrow(/committed|closed|aborted/);
  });

  it('keeps expanded IDs unique when source IDs already contain occurrence suffixes', () => {
    const original = repeatedScore(true);
    const expanded = expandRepeats(original);
    expect(new Set(expanded.measures.map((measure) => measure.id)).size).toBe(3);
    expect(new Set([...expanded.allNotes()].map((note) => note.id)).size).toBe(3);
    expect(expanded.getNote(NoteId('n@2'))!.pitch.toString()).toBe('G4');
    expect(expanded.getMeasure(MeasureId('m@2'))!.onsetQuarters.toFloat()).toBe(8);
  });

  it('keeps repeated measure declarations consistent with the expanded TimeMap', () => {
    const score = repeatedScore();
    expect(validateScore(score)).toEqual([]);
    const expanded = expandRepeats(score);
    expect(validateScore(expanded)).toEqual([]);
    expect(expanded.timeMap.tempi.map((entry) => entry.atQuarters.toFloat())).toEqual([0, 4]);
    expect(expanded.timeMap.meters.map((entry) => entry.atQuarters.toFloat())).toEqual([0, 4]);
  });

  it('applies volta selection even when the repeat only has one pass', () => {
    const source = repeatedScore().edit((tx) => {
      tx.updateMeasure(MeasureId('m'), {repeat: {start: true, end: true, times: 1}, volta: [2]});
    });
    const expanded = expandRepeats(source);
    expect(expanded).not.toBe(source);
    expect(expanded.measures).toEqual([]);
    expect(expanded.notes).toEqual([]);
    expect(expanded.durationSeconds).toBe(0);
    expect(validateScore(expanded)).toEqual([]);
  });

  it('represents an empty playback order when no requested pass selects a volta', () => {
    const source = repeatedScore().edit((tx) => tx.updateMeasure(MeasureId('m'), {volta: [3]}));
    const expanded = expandRepeats(source);
    expect(expanded.measures).toEqual([]);
    expect(expanded.notes).toEqual([]);
    expect(expanded.durationSeconds).toBe(0);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])('rejects invalid repeat counts (%s) before expansion', (times) => {
    expect(() => new Measure({id: MeasureId('invalid'), number: 1, onsetQuarters: Rational.ZERO,
      durationQuarters: new Rational(4), repeat: {start: true, end: true, times}})).toThrow(RangeError);
  });
});
