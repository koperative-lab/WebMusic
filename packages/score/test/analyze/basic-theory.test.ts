import {describe, expect, it} from 'vitest';
import {Duration, NoteId, PartId, Pitch, Rational, ScoreBuilder, VoiceId} from '../../src/core';
import {inspectChordPitches, inspectScoreChords} from '../../src/analyze/core/chord-inspection';
import {inspectScale, type ScaleInspectionOptions} from '../../src/analyze/core/scale-inspection';

function makeScore(
  notes: readonly (readonly [string, number, number])[],
  transpose?: {chromatic: number; diatonic?: number; octaveChange?: number},
) {
  const builder = new ScoreBuilder();
  const part = PartId('part');
  builder.addPart({id: part, name: 'Part', ...(transpose ? {transpose} : {})});
  notes.forEach(([name, onset, length], index) => builder.addNote(part, {
    id: NoteId(`n${index}`), pitch: Pitch.parse(name), onsetQuarters: Rational.from(onset),
    duration: new Duration({base: Rational.from(length)}), voice: VoiceId('voice'),
  }));
  return builder.build();
}

const pitches = (...names: string[]) => names.map((name) => Pitch.parse(name));
const selection = {partId: 'part'};

describe('explicit scale inspection', () => {
  it('uses letter degrees and exact reference accidentals, retaining source evidence', () => {
    const score = makeScore([['F#4', 0, 1], ['Gb4', 1, 1], ['B4', 2, 1]]);
    const result = inspectScale(score, selection, {tonic: 'C'});
    expect(result.pitches.map((pitch) => pitch.pitch)).toEqual(['C', 'D', 'E', 'F', 'G', 'A', 'B']);
    expect(result.notes.map((note) => note.label)).toEqual(['#4', 'b5', '7']);
    expect(result.notes[0]).toMatchObject({
      noteId: 'n0', partId: 'part', voiceId: 'voice', writtenPitch: 'F#4', pitch: 'F#4',
      degree: 4, alteration: 1, inScale: false, spellingInferred: false,
    });
    expect(result.notes[2]?.inScale).toBe(true);
    expect(score.getNote(NoteId('n0'))?.pitch.toString()).toBe('F#4');
  });

  it('spells theoretical keys across the octave boundary without chromatic respelling', () => {
    const score = makeScore([['Cb4', 0, 1], ['B3', 1, 1], ['Bb4', 2, 1]]);
    const result = inspectScale(score, selection, {tonic: 'C♭'});
    expect(result.pitches.map((pitch) => pitch.pitch)).toEqual(['Cb', 'Db', 'Eb', 'Fb', 'Gb', 'Ab', 'Bb']);
    expect(result.notes.map((note) => [note.label, note.inScale])).toEqual([['1', true], ['#7', false], ['7', true]]);
    expect(inspectScale(score, selection, {tonic: 'F#'}).pitches[6]?.pitch).toBe('E#');
  });

  it('requires the caller to choose each minor form and direction', () => {
    const score = makeScore([['F#4', 0, 1], ['G#4', 1, 1]]);
    const check = (scale: ScaleInspectionOptions['scale']) => inspectScale(score, selection, {tonic: 'A', scale});
    expect(check('natural-minor').notes.map((note) => note.label)).toEqual(['#6', '#7']);
    expect(check('harmonic-minor').notes.map((note) => note.label)).toEqual(['#6', '7']);
    expect(check('melodic-minor-ascending').notes.every((note) => note.inScale)).toBe(true);
    expect(check('melodic-minor-descending').pitches).toEqual(check('natural-minor').pitches);
  });

  it('filters by identity and sounding overlap in a half-open range', () => {
    const score = makeScore([['C4', 0, 2], ['D4', 1, 1], ['E4', 2, 1]]);
    const result = inspectScale(score, {noteIds: ['n0', 'n2'], fromQuarters: 1, toQuarters: 2}, {tonic: 'C'});
    expect(result.notes.map((note) => note.noteId)).toEqual(['n0']);
    expect(inspectScale(score, {fromQuarters: 1, toQuarters: 1}, {tonic: 'C'}).notes).toEqual([]);
    expect(inspectScale(score, {noteIds: []}, {tonic: 'C'}).notes).toEqual([]);
  });

  it('applies part transposition only in sounding mode and reports inferred spelling', () => {
    const score = makeScore([['D4', 0, 1]], {chromatic: -2, diatonic: -1});
    expect(inspectScale(score, selection, {tonic: 'C'}).notes[0]?.label).toBe('2');
    expect(inspectScale(score, selection, {tonic: 'C', pitchMode: 'sounding'}).notes[0]).toMatchObject({
      label: '1', pitch: 'C4', writtenPitch: 'D4', spellingInferred: false,
    });
    const chromaticOnly = makeScore([['D4', 0, 1]], {chromatic: -1});
    expect(inspectScale(chromaticOnly, selection, {tonic: 'C', pitchMode: 'sounding'}).notes[0]?.spellingInferred).toBe(true);
  });

  it('validates explicit context and selections even without score notes', () => {
    const score = makeScore([]);
    expect(() => inspectScale(score, selection, {tonic: ''})).toThrow(RangeError);
    expect(() => inspectScale(score, selection, {tonic: 'C4'})).toThrow(RangeError);
    expect(() => inspectScale(score, selection, {tonic: 'C', scale: 'unknown' as never})).toThrow(RangeError);
    expect(() => inspectScale(score, {}, {tonic: 'C'})).toThrow(TypeError);
    expect(() => inspectScale(score, {fromQuarters: 0}, {tonic: 'C'})).toThrow(TypeError);
    expect(() => inspectScale(score, {fromQuarters: 2, toQuarters: 1}, {tonic: 'C'})).toThrow(RangeError);
    expect(() => inspectScale(score, selection, {tonic: 'C', pitchMode: 'invalid' as never})).toThrow(RangeError);
  });
});

describe('exact chord pitch inspection', () => {
  it('names complete triads with bass and conventional inversion figures', () => {
    const key = {tonic: 'C', mode: 'major'} as const;
    expect(inspectChordPitches(pitches('C4', 'E4', 'G4', 'C5'), key).primary).toMatchObject({
      symbol: 'C', root: 'C', bass: 'C', family: 'triad', quality: 'major', inversion: 0, roman: 'I',
    });
    expect(inspectChordPitches(pitches('E3', 'G4', 'C5'), key).primary).toMatchObject({symbol: 'C/E', inversion: 1, roman: 'I6'});
    expect(inspectChordPitches(pitches('G3', 'C4', 'E4'), key).primary?.roman).toBe('I64');
    expect(inspectChordPitches(pitches('C4', 'Eb4', 'G4'), key).primary?.roman).toBe('i');
    expect(inspectChordPitches(pitches('B3', 'D4', 'F4'), key).primary?.roman).toBe('vii°');
    expect(inspectChordPitches(pitches('C4', 'E4', 'G#4'), key).primary?.roman).toBe('I+');
  });

  it('uses supplied root spelling rather than the nearest chromatic major degree', () => {
    const key = {tonic: 'C', mode: 'major'} as const;
    expect(inspectChordPitches(pitches('B3', 'D#4', 'F#4'), key).primary?.roman).toBe('VII');
    expect(inspectChordPitches(pitches('Cb4', 'Eb4', 'Gb4'), key).primary?.roman).toBe('bI');
    expect(inspectChordPitches(pitches('F#4', 'A4', 'C5'), key).primary?.roman).toBe('#iv°');
    expect(inspectChordPitches(pitches('Gb4', 'Bbb4', 'Db5'), key).primary?.roman).toBe('bv');
  });

  it('retains sevenths and their inversions without inventing omitted tones', () => {
    const key = {tonic: 'C', mode: 'major'} as const;
    expect(inspectChordPitches(pitches('G3', 'B3', 'D4', 'F4'), key).primary?.roman).toBe('V7');
    expect(inspectChordPitches(pitches('B2', 'D4', 'F4', 'G4'), key).primary?.roman).toBe('V65');
    expect(inspectChordPitches(pitches('D3', 'F4', 'G4', 'B4'), key).primary?.roman).toBe('V43');
    expect(inspectChordPitches(pitches('F3', 'G4', 'B4', 'D5'), key).primary?.roman).toBe('V42');
    expect(inspectChordPitches(pitches('B3', 'D4', 'F4', 'Ab4'), key).primary?.roman).toBe('vii°7');
    expect(inspectChordPitches(pitches('B3', 'D4', 'F4', 'A4'), key).primary?.roman).toBe('viiø7');
    expect(inspectChordPitches(pitches('C4', 'E4', 'B4'), key).candidates).toEqual([]);
    expect(inspectChordPitches(pitches('E4', 'G4', 'Bb4'), key).primary?.symbol).toBe('Edim');
  });

  it('declares natural-minor degree reference, rather than assuming minor form or function', () => {
    const key = {tonic: 'A', mode: 'minor'} as const;
    expect(inspectChordPitches(pitches('G#3', 'B3', 'D4'), key).primary?.roman).toBe('#vii°');
    expect(inspectChordPitches(pitches('C4', 'E4', 'G4'), key).primary?.roman).toBe('III');
    expect(inspectChordPitches(pitches('C4', 'E4', 'G4')).primary?.roman).toBeUndefined();
  });

  it('does not silently respell, infer roots, or discard non-chord tones', () => {
    expect(inspectChordPitches(pitches('C#4', 'E#4', 'G#4')).primary?.symbol).toBe('C#');
    expect(inspectChordPitches(pitches('C#4', 'F4', 'G#4')).primary).toBeUndefined();
    expect(inspectChordPitches(pitches('C4', 'D4', 'E4', 'G4')).primary).toBeUndefined();
    expect(inspectChordPitches(pitches('C4', 'G4')).label).toBe('C4 G4');
    expect(inspectChordPitches([]).label).toBe('');
    expect(() => inspectChordPitches([], {tonic: 'H', mode: 'major'})).toThrow(RangeError);
  });
});

describe('simultaneous score chord spans', () => {
  it('never collects sequential arpeggio tones into one chord', () => {
    const result = inspectScoreChords(makeScore([['C4', 0, 1], ['E4', 1, 1], ['G4', 2, 1]]));
    expect(result.spans.map((span) => span.label)).toEqual(['C4', 'E4', 'G4']);
    expect(result.spans.every((span) => span.candidates.length === 0)).toBe(true);
  });

  it('splits at all attacks and releases, keeping provenance through a passing note', () => {
    const score = makeScore([['C4', 0, 3], ['E4', 0, 3], ['G4', 0, 3], ['D5', 1, 1]]);
    const {spans} = inspectScoreChords(score);
    expect(spans.map((span) => [span.startQuarters, span.endQuarters])).toEqual([[0, 1], [1, 2], [2, 3]]);
    expect(spans.map((span) => span.primary?.symbol)).toEqual(['C', undefined, 'C']);
    expect(spans[1]?.notes.map((note) => note.noteId)).toEqual(['n0', 'n1', 'n2', 'n3']);
    expect(inspectScoreChords(score).spans.map((span) => span.id)).toEqual(spans.map((span) => span.id));
  });

  it('does not join separate statements across silence and honors concert pitch', () => {
    const score = makeScore([
      ['D4', 0, 1], ['F#4', 0, 1], ['A4', 0, 1],
      ['D4', 2, 1], ['F#4', 2, 1], ['A4', 2, 1],
    ], {chromatic: -2, diatonic: -1});
    expect(inspectScoreChords(score).spans.map((span) => span.label)).toEqual(['D', 'D']);
    const {spans} = inspectScoreChords(score, {pitchMode: 'sounding', key: {tonic: 'C', mode: 'major'}});
    expect(spans.map((span) => [span.startQuarters, span.endQuarters, span.primary?.roman])).toEqual([[0, 1, 'I'], [2, 3, 'I']]);
    expect(spans[0]?.notes[0]).toMatchObject({pitch: 'C4', writtenPitch: 'D4'});
    expect(() => inspectScoreChords(makeScore([]), {pitchMode: 'invalid' as never})).toThrow(RangeError);
  });
});
