import {describe, expect, it} from 'vitest';
import {
  Duration, MeasureId, NoteId, PartId, Pitch, Rational, ScoreBuilder, VoiceId,
  type Note, type TimeSignature,
} from '../../src/core';
import {inspectScoreChords} from '../../src/analyze/core/chord-inspection';
import {inspectScoreRhythm} from '../../src/analyze/core/rhythm-inspection';
import {loadArabesqueMxlFixture} from '../arabesque-fixture';

const part = PartId('p');
const voice = VoiceId('v');
const q = (value: number | readonly [number, number]) => Rational.from(value);
function builder(meter: TimeSignature = {numerator: 4, denominator: 4}) {
  const score = new ScoreBuilder();
  score.addPart({id: part, name: 'Piano'});
  score.addMeter({atQuarters: Rational.ZERO, measureNumber: 1, timeSignature: meter});
  return score;
}
function add(
  score: ScoreBuilder, id: string, pitch: string,
  onset: number | readonly [number, number], length: number | readonly [number, number],
  extra: Partial<Pick<Note, 'tie' | 'voice'>> = {},
) {
  score.addNote(part, {
    id: NoteId(id), pitch: Pitch.parse(pitch), voice, onsetQuarters: q(onset),
    duration: new Duration({base: q(length)}), ...extra,
  });
}

describe('metrical chord collections', () => {
  it('keeps simultaneous inspection as the default and collects a triplet only when requested', () => {
    const score = builder();
    add(score, 'c', 'C4', 0, [1, 3]);
    add(score, 'e', 'E4', [1, 3], [1, 3]);
    add(score, 'g', 'G4', [2, 3], [1, 3]);
    const source = score.build();
    const exact = inspectScoreChords(source);
    expect(exact.grouping).toBe('simultaneous');
    expect(exact.spans.map((span) => span.label)).toEqual(['C4', 'E4', 'G4']);
    expect(exact.spans.every((span) => span.grouping === 'simultaneous')).toBe(true);
    const grouped = inspectScoreChords(source, {grouping: 'beat'});
    expect(grouped.grouping).toBe('beat');
    expect(grouped.spans).toHaveLength(1);
    expect(grouped.spans[0]).toMatchObject({
      grouping: 'beat', startQuarters: 0, endQuarters: 1,
      primary: {symbol: 'C', quality: 'major'},
    });
    expect(grouped.spans[0]?.notes.map((note) => [note.noteId, note.onsetQuarters, note.offsetQuarters])).toEqual([
      ['c', 0, 1 / 3], ['e', 1 / 3, 2 / 3], ['g', 2 / 3, 1],
    ]);
    expect(source.getNote(NoteId('e'))?.onsetQuarters.toString()).toBe('1/3');
  });

  it('keeps adjacent beat collections separate and omits empty beats', () => {
    const score = builder();
    for (const [beat, pitches] of [[0, ['C4', 'E4', 'G4']], [1, ['F4', 'A4', 'C5']], [3, ['C4', 'E4', 'G4']]] as const) {
      pitches.forEach((pitch, index) => add(score, `${beat}-${index}`, pitch, [beat * 3 + index, 3], [1, 3]));
    }
    const {spans} = inspectScoreChords(score.build(), {grouping: 'beat'});
    expect(spans.map((span) => [span.startQuarters, span.endQuarters, span.label])).toEqual([
      [0, 1, 'C'], [1, 2, 'F'], [3, 4, 'C'],
    ]);
    expect(new Set(spans.map((span) => span.id)).size).toBe(3);
  });

  it('retains extra tones and does not silently invent omitted chord members', () => {
    const score = builder();
    ['C4', 'D4', 'E4', 'G4'].forEach((pitch, index) => add(score, `tone-${index}`, pitch, [index, 4], [1, 4]));
    add(score, 'later-c', 'C4', 1, [1, 2]);
    add(score, 'later-g', 'G4', [3, 2], [1, 2]);
    const {spans} = inspectScoreChords(score.build(), {grouping: 'beat'});
    expect(spans.map((span) => span.pitches)).toEqual([['C4', 'D4', 'E4', 'G4'], ['C4', 'G4']]);
    expect(spans.every((span) => span.primary === undefined && span.candidates.length === 0)).toBe(true);
  });

  it('clips a partial beat to selection boundaries without rewriting source evidence', () => {
    const score = builder();
    add(score, 'held', 'C3', 0, 2);
    add(score, 'ended', 'E4', 0, [1, 4]);
    add(score, 'inside', 'G4', [1, 4], [1, 4]);
    add(score, 'future', 'B4', [1, 2], [1, 2]);
    add(score, 'other-voice', 'D5', [1, 4], [1, 4], {voice: VoiceId('other')});
    const source = score.build();
    const options = {grouping: 'beat', selection: {fromQuarters: 0.25, toQuarters: 0.5, voiceId: 'v'}} as const;
    const {spans} = inspectScoreChords(source, options);
    expect(spans).toHaveLength(1);
    expect(spans[0]).toMatchObject({startQuarters: 0.25, endQuarters: 0.5, pitches: ['C3', 'G4']});
    expect(spans[0]?.notes).toMatchObject([
      {noteId: 'held', onsetQuarters: 0, offsetQuarters: 2},
      {noteId: 'inside', onsetQuarters: 0.25, offsetQuarters: 0.5},
    ]);
    expect(inspectScoreChords(source, {...options, selection: {...options.selection, noteIds: ['inside']}}).spans[0]?.label).toBe('G4');
    expect(inspectScoreChords(source, {grouping: 'beat', selection: {noteIds: []}}).spans).toEqual([]);
    expect(inspectScoreChords(source, {grouping: 'beat', selection: {fromQuarters: 2, toQuarters: 2}}).spans).toEqual([]);
  });

  it('uses two dotted-quarter collections in 6/8', () => {
    const score = builder({numerator: 6, denominator: 8});
    ['C4', 'E4', 'G4', 'F4', 'A4', 'C5'].forEach((pitch, index) => add(score, `n${index}`, pitch, [index, 2], [1, 2]));
    const {spans} = inspectScoreChords(score.build(), {grouping: 'beat'});
    expect(spans.map((span) => [span.startQuarters, span.endQuarters, span.label])).toEqual([
      [0, 1.5, 'C'], [1.5, 3, 'F'],
    ]);
  });

  it('requires valid explicit irregular-meter groups and respects their order', () => {
    const score = builder({numerator: 5, denominator: 8});
    ['C4', 'E4', 'G4', 'D4', 'F4'].forEach((pitch, index) => add(score, `n${index}`, pitch, [index, 2], [1, 2]));
    const source = score.build();
    expect(() => inspectScoreChords(source, {grouping: 'beat'})).toThrow(/explicit beatGroups/);
    for (const beatGroups of [[], [0, 5], [2, 2], [2.5, 2.5], [NaN], [Infinity], new Array(5)]) {
      expect(() => inspectScoreChords(source, {grouping: 'beat', beatGroups})).toThrow(RangeError);
    }
    expect(inspectScoreChords(source, {grouping: 'beat', beatGroups: [2, 3]}).spans.map((span) => [span.startQuarters, span.endQuarters])).toEqual([[0, 1], [1, 2.5]]);
    const grouped = inspectScoreChords(source, {grouping: 'beat', beatGroups: [3, 2]}).spans;
    expect(grouped[0]).toMatchObject({startQuarters: 0, endQuarters: 1.5, label: 'C'});
    expect(grouped[1]).toMatchObject({startQuarters: 1.5, endQuarters: 2.5, pitches: ['D4', 'F4']});
    expect(() => inspectScoreChords(source, {grouping: 'invalid' as never})).toThrow(RangeError);
    expect(inspectScoreChords(source, {grouping: 'simultaneous', beatGroups: [0]})).toEqual(inspectScoreChords(source));
  });

  it('retains exact pickup boundaries and restarts the metrical grid after a change', () => {
    const score = builder({numerator: 6, denominator: 8});
    score.addMeasure({id: MeasureId('pickup'), number: 0, onsetQuarters: q(0), durationQuarters: q([2, 3]), timeSignature: {numerator: 6, denominator: 8}});
    score.addMeasure({id: MeasureId('main'), number: 1, onsetQuarters: q([2, 3]), durationQuarters: q(3), timeSignature: {numerator: 3, denominator: 4}});
    ['C4', 'E4', 'G4'].forEach((pitch, index) => add(score, `pickup-${index}`, pitch, [index * 2, 9], [2, 9]));
    ['D4', 'F4', 'A4'].forEach((pitch, index) => add(score, `main-${index}`, pitch, [2 + index, 3], [1, 3]));
    const source = score.build();
    expect(inspectScoreChords(source, {grouping: 'beat'}).spans.map((span) => [span.startQuarters, span.endQuarters, span.label])).toEqual([
      [0, 2 / 3, 'C'], [2 / 3, 5 / 3, 'Dm'],
    ]);
    // Public rhythm inspection still lists only beat attacks within its range,
    // while chord grouping includes a clipped containing beat.
    expect(inspectScoreRhythm(source, {beatUnit: 'meter', startQuarters: 1, endQuarters: 1.5}).beats).toEqual([]);
    expect(inspectScoreChords(source, {grouping: 'beat', selection: {fromQuarters: 1, toQuarters: 1.5}}).spans[0]).toMatchObject({
      startQuarters: 1, endQuarters: 1.5, pitches: ['F4', 'A4'],
    });
  });

  it('includes tied continuations as duration evidence and excludes notes released at the beat boundary', () => {
    const score = builder();
    add(score, 'bass-start', 'C3', 0, 1, {tie: 'start'});
    add(score, 'bass-stop', 'C3', 1, 1, {tie: 'stop'});
    for (const beat of [0, 1]) {
      add(score, `e${beat}`, 'E4', beat, [1, 2]);
      add(score, `g${beat}`, 'G4', [2 * beat + 1, 2], [1, 2]);
    }
    add(score, 'grace', 'Db5', 1, 0);
    const {spans} = inspectScoreChords(score.build(), {grouping: 'beat'});
    expect(spans.map((span) => span.label)).toEqual(['C', 'C']);
    expect(spans[0]?.notes.map((note) => note.noteId)).toEqual(['bass-start', 'e0', 'g0']);
    expect(spans[1]?.notes.map((note) => note.noteId)).toEqual(['bass-stop', 'e1', 'g1']);
  });

  it('retains spelled chord members and explicit-key degrees in written and sounding modes', () => {
    const score = new ScoreBuilder();
    score.addPart({id: part, name: 'Transposing', transpose: {chromatic: -2, diatonic: -1}});
    ['Db4', 'F4', 'Ab4'].forEach((pitch, index) => add(score, `n${index}`, pitch, [index, 3], [1, 3]));
    const source = score.build();
    expect(inspectScoreChords(source, {grouping: 'beat'}).spans[0]?.label).toBe('Db');
    const span = inspectScoreChords(source, {grouping: 'beat', pitchMode: 'sounding', key: {tonic: 'Cb', mode: 'major'}}).spans[0];
    expect(span?.primary).toMatchObject({symbol: 'Cb', roman: 'I'});
    expect(span?.notes[0]).toMatchObject({writtenPitch: 'Db4', pitch: 'Cb4', spellingInferred: false});
  });

  it('recognizes real Arabesque arpeggios without forcing its ambiguous fifth-measure beat', async () => {
    const score = await loadArabesqueMxlFixture();
    const options = {grouping: 'beat', selection: {fromQuarters: 0, toQuarters: 20}} as const;
    const {spans} = inspectScoreChords(score, options);
    expect(spans.find((span) => span.startQuarters === 0)).toMatchObject({
      endQuarters: 1, pitches: ['C#4', 'E4', 'A4'], label: 'A/C#',
    });
    expect(spans.find((span) => span.startQuarters === 2)?.label).toBe('G#m/B');
    const fifthMeasure = spans.find((span) => span.startQuarters === 18);
    expect(fifthMeasure).toMatchObject({endQuarters: 19, pitches: ['A4', 'C#5', 'D#5', 'A5'], candidates: []});
    expect(fifthMeasure?.primary).toBeUndefined();
    expect(fifthMeasure?.notes).toHaveLength(4);
    expect(inspectScoreChords(score, options).spans.map((span) => span.id)).toEqual(spans.map((span) => span.id));
  });
});
