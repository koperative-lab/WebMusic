import {describe, expect, it} from 'vitest';
import {Duration, Pitch, Rational, ScoreBuilder, VoiceId, type Score} from '../../src/core';
import {findRhythmPatternOccurrences} from '../../src/analyze/core/rhythm-pattern-occurrences';
import {projectRhythmPatternFlow} from '../../src/analyze/headless/rhythm-pattern-flow';

type Spec = readonly [pitch: string, onset: Rational, duration: Rational];

function scoreFrom(voices: Record<string, readonly Spec[]>): Score {
  const builder = new ScoreBuilder();
  const partId = builder.addPart({id: builder.newPartId(), name: 'Pattern'});
  for (const [name, notes] of Object.entries(voices)) {
    const voice = VoiceId(`${partId}-${name}`);
    for (const [pitch, onset, duration] of notes) {
      builder.addNote(partId, {
        id: builder.newNoteId(),
        pitch: Pitch.parse(pitch),
        onsetQuarters: onset,
        duration: new Duration({base: duration}),
        voice,
      });
    }
  }
  return builder.build();
}

const q = (value: number) => new Rational(value);
const half = new Rational(1, 2);

describe('findRhythmPatternOccurrences', () => {
  it('finds pitched-independent recurrence with source provenance and exact spans', () => {
    const score = scoreFrom({lead: [
      ['C4', q(0), q(1)], ['D4', q(1), half], ['E4', new Rational(3, 2), half],
      ['F4', q(4), q(1)], ['G4', q(5), half], ['A4', new Rational(11, 2), half],
    ]});
    const groups = findRhythmPatternOccurrences(score, {length: 3});
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      durations: [1, 0.5, 0.5],
      onsetGaps: [1, 0.5],
    });
    expect(groups[0].occurrences.map((item) => [item.startQuarters, item.endQuarters])).toEqual([
      [0, 2], [4, 6],
    ]);
    expect(groups[0].occurrences.every((item) => item.noteIds.length === 3 && item.voiceId.endsWith('-lead'))).toBe(true);
  });

  it('does not equate equal durations with different inter-onset gaps', () => {
    const score = scoreFrom({lead: [
      ['C4', q(0), q(1)], ['D4', q(1), q(1)], ['E4', q(2), q(1)],
      ['F4', q(4), q(1)], ['G4', new Rational(11, 2), q(1)], ['A4', q(7), q(1)],
    ]});
    expect(findRhythmPatternOccurrences(score, {length: 3})).toEqual([]);
  });

  it('requires non-overlapping time spans but retains every matching window', () => {
    const repeated = (count: number) => scoreFrom({lead: Array.from({length: count}, (_, index) =>
      ['C4', q(index), q(1)] as const)});
    expect(findRhythmPatternOccurrences(repeated(6), {length: 4})).toEqual([]);
    const [group] = findRhythmPatternOccurrences(repeated(8), {length: 4});
    expect(group.occurrences).toHaveLength(5);
  });

  it('uses exact rational signatures for triplet durations and onset gaps', () => {
    const third = new Rational(1, 3);
    const score = scoreFrom({lead: [
      ['C4', q(0), third], ['D4', third, third], ['E4', new Rational(2, 3), third],
      ['F4', q(2), third], ['G4', new Rational(7, 3), third], ['A4', new Rational(8, 3), third],
    ]});
    const [group] = findRhythmPatternOccurrences(score, {length: 3});
    expect(group.occurrences).toHaveLength(2);
    expect(group.durations).toEqual([1 / 3, 1 / 3, 1 / 3]);
    expect(group.onsetGaps).toEqual([1 / 3, 1 / 3]);
  });

  it('collapses simultaneous chord tones and never joins different voices', () => {
    const score = scoreFrom({
      lead: [
        ['C4', q(0), q(1)], ['E4', q(0), q(1)], ['D4', q(1), half], ['E4', new Rational(3, 2), half],
        ['F4', q(4), q(1)], ['A4', q(4), q(1)], ['G4', q(5), half], ['A4', new Rational(11, 2), half],
      ],
      bass: [['C3', q(0), q(2)], ['G3', q(2), q(2)], ['C3', q(4), q(2)]],
    });
    const [group] = findRhythmPatternOccurrences(score, {length: 3});
    expect(group.occurrences).toHaveLength(2);
    expect(group.occurrences.every((item) => item.voiceId.endsWith('-lead'))).toBe(true);
    expect(group.occurrences[0].noteIds).toHaveLength(4);
  });

  it('treats an explicit rest as a phrase break', () => {
    const builder = new ScoreBuilder();
    const part = builder.addPart({id: builder.newPartId(), name: 'Rested'});
    const voice = builder.newVoiceId();
    const add = (onset: number) => builder.addNote(part, {
      id: builder.newNoteId(), pitch: Pitch.parse('C4'), onsetQuarters: q(onset),
      duration: Duration.quarter(), voice,
    });
    add(0); add(1);
    builder.addNote(part, {id: builder.newNoteId(), rest: true, onsetQuarters: q(2), duration: Duration.quarter(), voice});
    add(3); add(4);
    expect(findRhythmPatternOccurrences(builder.build(), {length: 3})).toEqual([]);
  });

  it('validates options even for an empty score', () => {
    const empty = new ScoreBuilder().build();
    expect(() => findRhythmPatternOccurrences(empty, {length: 0})).toThrow(RangeError);
    expect(() => findRhythmPatternOccurrences(empty, {minOccurrences: Number.NaN})).toThrow(RangeError);
    expect(() => findRhythmPatternOccurrences(empty, {partId: 'absent'})).toThrow(RangeError);
  });
});

describe('projectRhythmPatternFlow', () => {
  it('keeps one group per rhythmic cell and both nominal and written axes', () => {
    const score = scoreFrom({lead: [
      ['C4', q(0), q(1)], ['D4', q(1), half], ['E4', new Rational(3, 2), half],
      ['F4', q(4), q(1)], ['G4', q(5), half], ['A4', new Rational(11, 2), half],
    ]});
    const groups = findRhythmPatternOccurrences(score, {length: 3});
    const lane = projectRhythmPatternFlow(groups, score);
    expect(lane.tracks).toMatchObject([{label: 'R1'}]);
    expect(lane.tracks?.[0].sublabel).toBeUndefined();
    expect(lane.bands).toHaveLength(2);
    expect(lane.bands.map((band) => band.group)).toEqual([groups[0].id, groups[0].id]);
    expect(lane.bands.map((band) => [band.stampStart, band.stampEnd])).toEqual([[0, 2], [4, 6]]);
    expect(lane.bands[1].start).toBeCloseTo(score.timeMap.quartersToSeconds(q(4)));
    expect(lane.flags).toHaveLength(6);
  });
});
