import {describe, expect, it} from 'vitest';
import {
  Duration,
  MeasureId,
  NoteId,
  PartId,
  Pitch,
  Rational,
  ScoreBuilder,
  VoiceId,
} from '../../src/core';
import {inspectScoreRhythm} from '../../src/analyze/core/rhythm-inspection';

describe('inspectScoreRhythm', () => {
  it('reports exact offbeat placement, authored accents and optional performance evidence', () => {
    const builder = new ScoreBuilder();
    const melody = PartId('melody');
    const percussion = PartId('percussion');
    const voice = VoiceId('upper');
    builder.addPart({id: melody, name: 'Melody'});
    builder.addPart({id: percussion, name: 'Percussion'});
    const add = (
      id: string,
      at: Rational,
      extra: Partial<Parameters<typeof builder.addNote>[1]> = {},
    ) => builder.addNote(melody, {
      id: NoteId(id), pitch: Pitch.parse('C4'), onsetQuarters: at,
      duration: Duration.quarter(), voice, ...extra,
    });
    add('downbeat', Rational.ZERO, {
      articulations: ['accent'], performed: {onsetSec: 0.04, durationSec: 0.5, velocity: 106},
    });
    add('chord-tone', Rational.ZERO, {chord: true});
    add('triplet', new Rational(1, 3));
    add('eighth', new Rational(1, 2), {articulations: ['marcato']});
    add('tied-stop', new Rational(1), {tie: 'stop'});
    add('later', new Rational(2), {
      performed: {onsetSec: 1.52, durationSec: 1, velocity: 81},
    });
    builder.addTempo({atQuarters: new Rational(1), bpm: 60});
    builder.addNote(percussion, {
      id: NoteId('other-part'), pitch: Pitch.parse('C3'), onsetQuarters: new Rational(1, 2),
      duration: Duration.quarter(), voice: VoiceId('drums'),
    });

    const score = builder.build();
    const inspection = inspectScoreRhythm(score, {partId: melody});

    expect(inspection.range).toEqual({startQuarters: 0, endQuarters: 3});
    expect(inspection.beats.map((beat) => beat.atQuarters)).toEqual([0, 1, 2]);
    expect(inspection.onsets).toHaveLength(4);
    expect(inspection.onsets[0]).toMatchObject({
      noteIds: ['downbeat', 'chord-tone'], partId: 'melody', voiceId: 'upper',
      measure: 1, beat: 1, metricAccent: true, authoredAccent: true,
      offbeat: false, subdivisionIndex: 0, syncopationCue: false,
    });
    expect(inspection.onsets[0].performed).toEqual([{
      noteId: 'downbeat', onsetSeconds: 0.04, deviationSeconds: 0.04, velocity: 106,
    }]);
    expect(inspection.onsets[1]).toMatchObject({
      noteIds: ['triplet'], subbeatExact: '1/3', offbeat: true, subdivisionIndex: null,
      performed: [], metricAccent: false, syncopationCue: false,
    });
    expect(inspection.onsets[2]).toMatchObject({
      noteIds: ['eighth'], subbeatExact: '1/2', subdivisionIndex: 1,
      metricAccent: false, syncopationCue: true,
    });
    expect(inspection.onsets[3]).toMatchObject({nominalSeconds: 1.5});
    expect(inspection.onsets[3].performed[0].deviationSeconds).toBeCloseTo(0.02);
    expect(inspection.summary).toEqual({
      beatCount: 3, onsetCount: 4, offbeatCount: 2, authoredAccentCount: 2,
      syncopationCueCount: 1, performedCount: 2,
    });
    const narrow = inspectScoreRhythm(score, {
      partId: melody, startQuarters: 1 / 3, endQuarters: 0.5, subdivision: 3,
    });
    expect(narrow.beats).toEqual([]);
    expect(narrow.onsets.map((onset) => onset.noteIds)).toEqual([['triplet']]);
    expect(narrow.onsets[0].subdivisionIndex).toBe(1);
    expect(score.getNote(NoteId('triplet'))?.onsetQuarters.toString()).toBe('1/3');
  });

  it('uses real pickup measures and changes denominator-beat spacing at a meter change', () => {
    const builder = new ScoreBuilder();
    const partId = PartId('p');
    builder.addPart({id: partId, name: 'Part'});
    builder.addMeasure({
      id: MeasureId('pickup'), number: 0, onsetQuarters: Rational.ZERO,
      durationQuarters: new Rational(1), timeSignature: {numerator: 4, denominator: 4},
    });
    builder.addMeasure({
      id: MeasureId('first'), number: 1, onsetQuarters: new Rational(1),
      durationQuarters: new Rational(3), timeSignature: {numerator: 3, denominator: 4},
    });
    builder.addMeasure({
      id: MeasureId('second'), number: 2, onsetQuarters: new Rational(4),
      durationQuarters: new Rational(3), timeSignature: {numerator: 6, denominator: 8},
    });
    builder.addNote(partId, {
      id: NoteId('syncopation'), pitch: Pitch.parse('D4'), voice: VoiceId('v'),
      onsetQuarters: new Rational(19, 4), duration: Duration.eighth(),
    });

    const inspection = inspectScoreRhythm(builder.build(), {subdivision: 4});
    expect(inspection.beats.map(({atQuarters, measure, beat}) => [atQuarters, measure, beat])).toEqual([
      [0, 0, 1], [1, 1, 1], [2, 1, 2], [3, 1, 3],
      [4, 2, 1], [4.5, 2, 2], [5, 2, 3], [5.5, 2, 4], [6, 2, 5], [6.5, 2, 6],
    ]);
    expect(inspection.beats[4]).toMatchObject({
      beatLengthQuarters: 0.5, meter: {numerator: 6, denominator: 8}, metricAccent: true,
    });
    expect(inspection.onsets[0]).toMatchObject({
      atQuarters: 4.75, measure: 2, beat: 2, subbeatExact: '1/2', subdivisionIndex: 2,
      offbeat: true,
    });
  });

  it('restarts the grid at a meter-only partial measure boundary', () => {
    const builder = new ScoreBuilder();
    const partId = PartId('p');
    builder.addPart({id: partId, name: 'Part'});
    builder.addMeter({
      atQuarters: new Rational(13, 2), measureNumber: 2,
      timeSignature: {numerator: 3, denominator: 4},
    });
    builder.addNote(partId, {
      id: NoteId('tail'), pitch: Pitch.parse('E4'), voice: VoiceId('v'),
      onsetQuarters: new Rational(8), duration: Duration.quarter(),
    });
    const inspection = inspectScoreRhythm(builder.build(), {startQuarters: 4, endQuarters: 9});
    expect(inspection.beats.map(({atQuarters, measure, beat}) => [atQuarters, measure, beat])).toEqual([
      [4, 2, 1], [5, 2, 2], [6, 2, 3], [6.5, 3, 1], [7.5, 3, 2], [8.5, 3, 3],
    ]);
    expect(inspection.subdivisions.some((division) => division.atQuarters === 6.5 && division.beatAtQuarters === 6)).toBe(false);
    expect(inspection.onsets[0]).toMatchObject({measure: 3, beat: 2, subbeatExact: '1/2'});
  });

  it('clamps the selected range and rejects invalid inputs', () => {
    const builder = new ScoreBuilder();
    const partId = PartId('p');
    builder.addPart({id: partId, name: 'Part'});
    builder.addNote(partId, {
      id: NoteId('n'), pitch: Pitch.parse('C4'), voice: VoiceId('v'),
      onsetQuarters: Rational.ZERO, duration: Duration.quarter(),
    });
    const score = builder.build();
    expect(inspectScoreRhythm(score, {startQuarters: 2, endQuarters: 3}).range).toEqual({
      startQuarters: 1, endQuarters: 1,
    });
    expect(() => inspectScoreRhythm(score, {startQuarters: -1})).toThrow(RangeError);
    expect(() => inspectScoreRhythm(score, {startQuarters: 2, endQuarters: 1})).toThrow(RangeError);
    expect(() => inspectScoreRhythm(score, {subdivision: 5 as 4})).toThrow(RangeError);
    expect(() => inspectScoreRhythm(score, {partId: 'missing'})).toThrow(/Unknown/);
  });

  it('uses two dotted-quarter pulses in 6/8 while keeping the denominator default', () => {
    const builder = new ScoreBuilder();
    const partId = PartId('p');
    builder.addPart({id: partId, name: 'Part'});
    builder.addMeasure({
      id: MeasureId('compound'), number: 1, onsetQuarters: Rational.ZERO,
      durationQuarters: new Rational(3), timeSignature: {numerator: 6, denominator: 8},
    });
    for (let index = 0; index < 6; index += 1) {
      builder.addNote(partId, {
        id: NoteId(`n${index}`), pitch: Pitch.parse('C4'), voice: VoiceId('v'),
        onsetQuarters: new Rational(index, 2), duration: Duration.eighth(),
      });
    }
    const score = builder.build();
    const denominator = inspectScoreRhythm(score);
    expect(denominator.beatUnit).toBe('denominator');
    expect(denominator.beats.map(({atQuarters}) => atQuarters)).toEqual([0, 0.5, 1, 1.5, 2, 2.5]);
    expect(denominator.onsets.every(({offbeat}) => !offbeat)).toBe(true);

    const meter = inspectScoreRhythm(score, {beatUnit: 'meter', subdivision: 3});
    expect(meter.beatUnit).toBe('meter');
    expect(meter.beats.map(({atQuarters, beat, beatLengthQuarters}) => [atQuarters, beat, beatLengthQuarters]))
      .toEqual([[0, 1, 1.5], [1.5, 2, 1.5]]);
    expect(meter.subdivisions.map(({atQuarters}) => atQuarters)).toEqual([0.5, 1, 2, 2.5]);
    expect(meter.onsets.map(({beat, subbeatExact, offbeat, subdivisionIndex}) =>
      [beat, subbeatExact, offbeat, subdivisionIndex],
    )).toEqual([
      [1, '0', false, 0], [1, '1/3', true, 1], [1, '2/3', true, 2],
      [2, '0', false, 0], [2, '1/3', true, 1], [2, '2/3', true, 2],
    ]);
    const slice = inspectScoreRhythm(score, {
      beatUnit: 'meter', subdivision: 3, startQuarters: 0.5, endQuarters: 1.5,
    });
    expect(slice.beats).toEqual([]);
    expect(slice.subdivisions.map(({atQuarters}) => atQuarters)).toEqual([0.5, 1]);
    expect(slice.onsets.map(({subbeatExact}) => subbeatExact)).toEqual(['1/3', '2/3']);
  });

  it('requires explicit irregular-meter groups and distinguishes 2+3 from 3+2', () => {
    const builder = new ScoreBuilder();
    const partId = PartId('p');
    builder.addPart({id: partId, name: 'Part'});
    builder.addMeasure({
      id: MeasureId('irregular'), number: 1, onsetQuarters: Rational.ZERO,
      durationQuarters: new Rational(5, 2), timeSignature: {numerator: 5, denominator: 8},
    });
    builder.addNote(partId, {
      id: NoteId('attack'), pitch: Pitch.parse('C4'), voice: VoiceId('v'),
      onsetQuarters: Rational.ONE, duration: Duration.eighth(),
    });
    const score = builder.build();
    expect(() => inspectScoreRhythm(score, {beatUnit: 'meter'})).toThrow(/explicit beatGroups.*5\/8/);
    const shortLong = inspectScoreRhythm(score, {beatUnit: 'meter', beatGroups: [2, 3]});
    const longShort = inspectScoreRhythm(score, {beatUnit: 'meter', beatGroups: [3, 2]});
    expect(shortLong.beats.map(({atQuarters, beatLengthQuarters}) => [atQuarters, beatLengthQuarters]))
      .toEqual([[0, 1], [1, 1.5]]);
    expect(longShort.beats.map(({atQuarters, beatLengthQuarters}) => [atQuarters, beatLengthQuarters]))
      .toEqual([[0, 1.5], [1.5, 1]]);
    expect(shortLong.onsets[0]).toMatchObject({beat: 2, subbeatExact: '0', offbeat: false});
    expect(longShort.onsets[0]).toMatchObject({beat: 1, subbeatExact: '2/3', offbeat: true});
    for (const groups of [[], [2, 2], [0, 5], [-1, 6], [1.5, 3.5], [Infinity], [Number.MAX_SAFE_INTEGER, 1]]) {
      expect(() => inspectScoreRhythm(score, {beatUnit: 'meter', beatGroups: groups})).toThrow(RangeError);
    }
    expect(() => inspectScoreRhythm(score, {beatGroups: [2, 3]})).toThrow(/requires beatUnit meter/);
    expect(() => inspectScoreRhythm(score, {beatUnit: 'guess' as 'meter'})).toThrow(/beatUnit/);
    const sparse = new Array<number>(2);
    sparse[1] = 5;
    expect(() => inspectScoreRhythm(score, {beatUnit: 'meter', beatGroups: sparse})).toThrow(/positive safe integers/);
  });

  it('truncates pickup pulses, changes pulse units at authored bars and excludes tied continuations', () => {
    const builder = new ScoreBuilder();
    const partId = PartId('p');
    builder.addPart({id: partId, name: 'Part'});
    builder.addMeasure({
      id: MeasureId('pickup'), number: 0, onsetQuarters: Rational.ZERO,
      durationQuarters: Rational.ONE, timeSignature: {numerator: 6, denominator: 8},
    });
    builder.addMeasure({
      id: MeasureId('compound'), number: 1, onsetQuarters: Rational.ONE,
      durationQuarters: new Rational(3), timeSignature: {numerator: 6, denominator: 8},
    });
    builder.addMeasure({
      id: MeasureId('simple'), number: 2, onsetQuarters: new Rational(4),
      durationQuarters: new Rational(3), timeSignature: {numerator: 3, denominator: 4},
    });
    for (const [index, tie] of (['start', 'continue', 'stop'] as const).entries()) {
      builder.addNote(partId, {
        id: NoteId(tie), pitch: Pitch.parse('C4'), voice: VoiceId('v'),
        onsetQuarters: new Rational(index, 2), duration: Duration.eighth(), tie,
      });
    }
    const result = inspectScoreRhythm(builder.build(), {beatUnit: 'meter', subdivision: 3});
    expect(result.beats.map(({atQuarters, measure, beat}) => [atQuarters, measure, beat]))
      .toEqual([[0, 0, 1], [1, 1, 1], [2.5, 1, 2], [4, 2, 1], [5, 2, 2], [6, 2, 3]]);
    expect(result.subdivisions.filter(({beatAtQuarters}) => beatAtQuarters === 0).map(({atQuarters}) => atQuarters))
      .toEqual([0.5]);
    expect(result.onsets.map(({noteIds}) => noteIds)).toEqual([['start']]);
  });

  it('restarts grouped pulses at a meter-only partial bar boundary', () => {
    const builder = new ScoreBuilder();
    const partId = PartId('p');
    builder.addPart({id: partId, name: 'Part'});
    builder.addMeter({
      atQuarters: Rational.ZERO, measureNumber: 1,
      timeSignature: {numerator: 6, denominator: 8},
    });
    builder.addMeter({
      atQuarters: new Rational(5, 2), measureNumber: 2,
      timeSignature: {numerator: 3, denominator: 4},
    });
    builder.addNote(partId, {
      id: NoteId('tail'), pitch: Pitch.parse('C4'), voice: VoiceId('v'),
      onsetQuarters: new Rational(4), duration: Duration.quarter(),
    });
    const score = builder.build();
    const result = inspectScoreRhythm(score, {beatUnit: 'meter', subdivision: 3});
    expect(result.beats.map(({atQuarters, measure, beat}) => [atQuarters, measure, beat]))
      .toEqual([[0, 1, 1], [1.5, 1, 2], [2.5, 2, 1], [3.5, 2, 2], [4.5, 2, 3]]);
    expect(result.subdivisions.some(({atQuarters, beatAtQuarters}) => atQuarters === 2.5 && beatAtQuarters === 1.5))
      .toBe(false);
    expect(() => inspectScoreRhythm(score, {beatUnit: 'meter', beatGroups: [3, 3]})).toThrow(/sum to 3/);
  });
});
