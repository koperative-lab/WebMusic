import {describe, expect, it} from 'vitest';
import {
  Duration,
  Note,
  NoteId,
  Part,
  PartId,
  Pitch,
  Rational,
  VoiceId,
  type NoteData,
  type BeamMark,
  type TupletMark,
  ScoreBuilder,
  scoreFromJSON,
} from '../../src/core';

function noteData(patch: Partial<NoteData> = {}): NoteData {
  return {
    id: NoteId('n'),
    pitch: Pitch.parse('C4'),
    onsetQuarters: Rational.ZERO,
    duration: Duration.quarter(),
    voice: VoiceId('v'),
    ...patch,
  };
}

describe('Note runtime validation', () => {
  it('rejects invalid performed timings before they reach a scheduler', () => {
    const invalid = [
      {onsetSec: Number.NaN, durationSec: 0.1, velocity: 80},
      {onsetSec: -0.1, durationSec: 0.1, velocity: 80},
      {onsetSec: 0, durationSec: Infinity, velocity: 80},
      {onsetSec: 0, durationSec: -0.1, velocity: 80},
      {onsetSec: 0, durationSec: 0.1, velocity: 0},
      {onsetSec: 0, durationSec: 0.1, velocity: 128},
      {onsetSec: 0, durationSec: 0.1, velocity: 64.5},
    ];
    for (const performed of invalid) {
      expect(() => new Note(noteData({performed}))).toThrow(RangeError);
    }
  });

  it('requires real Rational and Duration instances for notated time', () => {
    expect(() =>
      new Note(noteData({onsetQuarters: {} as unknown as Rational})),
    ).toThrow(TypeError);
    expect(() => new Note(noteData({duration: {} as unknown as Duration}))).toThrow(TypeError);
  });

  it('snapshots notation marks and preserves them through functional updates and JSON', () => {
    const beams: BeamMark[] = [{number: 1, type: 'begin'}];
    const tupletMarks: TupletMark[] = [{type: 'start', number: 2, bracket: false, showNumber: 'none'}];
    const slur = {type: 'start' as const, number: 2, placement: 'below' as const};
    const note = new Note(noteData({beams, tupletMarks, stem: 'up', printObject: false, slur, tiePlacement: 'above'}));
    beams[0].type = 'end';
    tupletMarks[0].bracket = true;
    beams.push({number: 2, type: 'continue'});
    expect(note.beams).toEqual([{number: 1, type: 'begin'}]);
    expect(note.tupletMarks).toEqual([{type: 'start', number: 2, bracket: false, showNumber: 'none'}]);
    expect(Object.isFrozen(note.beams)).toBe(true);
    expect(Object.isFrozen(note.beams![0])).toBe(true);
    expect(Object.isFrozen(note.tupletMarks![0])).toBe(true);
    const updated = note.with({pitch: Pitch.parse('D4')});
    const builder = new ScoreBuilder();
    builder.addPart({id: PartId('p'), name: 'P'});
    builder.addNote(PartId('p'), updated);
    const restored = scoreFromJSON(builder.build().toJSON()).parts[0].notes[0];
    expect(restored.beams).toEqual(note.beams);
    expect(restored.tupletMarks).toEqual(note.tupletMarks);
    expect(restored.stem).toBe('up');
    expect(restored.printObject).toBe(false);
    expect(restored.slur).toEqual(slur);
    expect(restored.tiePlacement).toBe('above');
    expect(Object.isFrozen(restored.slur)).toBe(true);
  });

  it('rejects invalid notation marks at construction and JSON hydration', () => {
    const invalid: Partial<NoteData>[] = [
      {beams: [{number: 0, type: 'begin'}]},
      {beams: [{number: 1, type: 'begin'}, {number: 1, type: 'end'}]},
      {beams: [{number: 1, type: 'unknown' as BeamMark['type']}]},
      {tupletMarks: [{type: 'start', number: 17}]},
      {tupletMarks: [{type: 'start', placement: 'left' as TupletMark['placement']}]},
      {tupletMarks: [{type: 'start', showNumber: 'no' as TupletMark['showNumber']}]},
      {tiePlacement: 'left' as 'above'},
      {stem: 'left' as NoteData['stem']},
      {printObject: 'no' as unknown as boolean},
      {slur: {type: 'start', placement: 'left' as 'above'}},
    ];
    const builder = new ScoreBuilder();
    builder.addPart({id: PartId('p'), name: 'P'});
    builder.addNote(PartId('p'), noteData());
    for (const patch of invalid) {
      expect(() => new Note(noteData(patch))).toThrow();
      const json = JSON.parse(JSON.stringify(builder.build().toJSON()));
      Object.assign(json.parts[0].notes[0], patch);
      expect(() => scoreFromJSON(json)).toThrow(/scoreFromJSON/);
    }
  });
});

describe('Part runtime validation', () => {
  it('rejects malformed note arrays and invalid MIDI/staff metadata', () => {
    const valid = new Note(noteData());
    const base = {id: PartId('p'), name: 'P', notes: [valid]};

    expect(() => new Part({...base, notes: [{} as unknown as Note]})).toThrow(TypeError);
    expect(() => new Part({...base, midiProgram: 128})).toThrow(RangeError);
    expect(() => new Part({...base, midiChannel: 16})).toThrow(RangeError);
    expect(() => new Part({...base, staves: 0})).toThrow(RangeError);
    expect(() => new Part({...base, transpose: {chromatic: Number.NaN}})).toThrow(RangeError);
  });
});
