import {describe, expect, it} from 'vitest';
import {
  Duration, Measure, MeasureId, Note, NoteId, Part, PartId, Pitch, Rational, ScoreBuilder, VoiceId,
  expandRepeats, scoreFromJSON, type PartClefChange, type PartData, type PartDirection,
} from '../../src/core';

const id = PartId('p');
const note = {id: NoteId('n'), voice: VoiceId('v'), onsetQuarters: Rational.ZERO, duration: Duration.quarter(), pitch: Pitch.parse('C4')};

describe('persistent timed notation', () => {
  it('snapshots arrays and nested marks at each builder mutation and across builds, edits and JSON', () => {
    const clefs: PartClefChange[] = [{onsetQuarters: Rational.ZERO, staff: 1, clef: {sign: 'G', line: 2}}];
    const values = ['p'];
    const directions: PartDirection[] = [{kind: 'dynamics', onsetQuarters: Rational.ZERO, staff: 1, values}];
    const builder = new ScoreBuilder();
    builder.addPart({id, name: 'Piano', clefChanges: clefs, directions});
    builder.addNote(id, note);
    clefs[0].clef.line = 4;
    clefs.length = 0;
    values.push('f');
    directions.length = 0;
    const direction: PartDirection = {kind: 'words', text: 'rit.', onsetQuarters: new Rational(2), fontStyle: 'italic'};
    builder.addDirection(id, direction);
    builder.addClefChange(id, {onsetQuarters: new Rational(2), staff: 1, clef: {sign: 'F', line: 4}});
    direction.text = 'wrong';
    const first = builder.build();
    builder.addDirection(id, {kind: 'metronome', onsetQuarters: Rational.ONE, beatUnit: Duration.quarter(), perMinute: 72});
    const next = builder.build();
    expect(first.parts[0].directions).toHaveLength(2);
    expect(next.parts[0].directions?.map((value) => value.onsetQuarters.toString())).toEqual(['0', '1', '2']);
    for (const score of [first, first.edit((edit) => edit.updateNote(note.id, {pitch: Pitch.parse('D4')})), scoreFromJSON(first.toJSON())]) {
      const part = score.parts[0];
      expect(part.clefChanges?.map((value) => value.clef)).toEqual([{sign: 'G', line: 2}, {sign: 'F', line: 4}]);
      expect(part.directions).toEqual([{kind: 'dynamics', onsetQuarters: Rational.ZERO, staff: 1, values: ['p']}, {kind: 'words', text: 'rit.', onsetQuarters: new Rational(2), fontStyle: 'italic'}]);
      expect(Object.isFrozen(part.clefChanges)).toBe(true);
      expect(Object.isFrozen(part.clefChanges![0].clef)).toBe(true);
      expect(Object.isFrozen(part.directions)).toBe(true);
      expect(Object.isFrozen(part.directions![0])).toBe(true);
      expect(Object.isFrozen((part.directions![0] as Extract<PartDirection, {kind: 'dynamics'}>).values)).toBe(true);
    }
  });

  it('rejects malformed notation before it enters immutable state or hydrated JSON', () => {
    const invalid: Partial<PartData>[] = [
      {clefChanges: [{onsetQuarters: Rational.ZERO, staff: 0, clef: {sign: 'G'}}]},
      {clefChanges: [{onsetQuarters: Rational.ZERO, staff: 1, clef: {sign: 'X' as 'G'}}]},
      {directions: [{kind: 'words', onsetQuarters: 0 as unknown as Rational, text: 'rit.'}]},
      {directions: [{kind: 'other' as 'words', onsetQuarters: Rational.ZERO, text: 'x'}]},
      {directions: [{kind: 'pedal', onsetQuarters: Rational.ZERO, type: 'start', number: 0}]},
      {directions: [{kind: 'wedge', onsetQuarters: Rational.ZERO, type: 'crescendo', spread: -1}]},
      {directions: [{kind: 'metronome', onsetQuarters: Rational.ZERO, beatUnit: Duration.quarter(), perMinute: 0}]},
    ];
    for (const patch of invalid) expect(() => new Part({id, name: 'Piano', notes: [], ...patch})).toThrow();
    const builder = new ScoreBuilder();
    builder.addPart({id, name: 'Piano'});
    for (const patch of invalid) {
      const json = JSON.parse(JSON.stringify(builder.build().toJSON()));
      Object.assign(json.parts[0], JSON.parse(JSON.stringify(patch)));
      expect(() => scoreFromJSON(json)).toThrow(/scoreFromJSON/);
    }
    expect(() => builder.addDirection(PartId('missing'), {kind: 'words', text: 'rit.', onsetQuarters: Rational.ZERO})).toThrow(/Unknown part/);
    expect(() => builder.addClefChange(PartId('missing'), {staff: 1, clef: {sign: 'G'}, onsetQuarters: Rational.ZERO})).toThrow(/Unknown part/);
  });

  it('replays directions and restores the source clef when a repeated passage jumps backwards', () => {
    const builder = new ScoreBuilder();
    builder.addPart({id, name: 'Piano', clefChanges: [
      {staff: 1, onsetQuarters: Rational.ZERO, clef: {sign: 'G', line: 2}},
      {staff: 1, onsetQuarters: new Rational(7), clef: {sign: 'F', line: 4}},
    ], directions: [
      {kind: 'words', text: 'rit.', onsetQuarters: new Rational(5)},
      {kind: 'pedal', type: 'start', onsetQuarters: new Rational(4), staff: 1},
      {kind: 'pedal', type: 'stop', onsetQuarters: new Rational(8), staff: 1},
    ]});
    for (let index = 0; index < 3; index += 1) builder.addMeasure({id: MeasureId(`m${index}`), number: index + 1, onsetQuarters: new Rational(index * 4), durationQuarters: new Rational(4), repeat: index === 1 ? {start: true, end: true} : undefined});
    builder.addNote(id, note);
    const expanded = expandRepeats(builder.build());
    const part = expanded.parts[0];
    expect(part.clefChanges?.map((change) => [change.onsetQuarters.toString(), change.clef.sign])).toEqual([['0', 'G'], ['7', 'F'], ['8', 'G'], ['11', 'F']]);
    expect(part.directions?.filter((direction) => direction.kind === 'words').map((direction) => direction.onsetQuarters.toString())).toEqual(['5', '9']);
    expect(part.directions?.filter((direction) => direction.kind === 'pedal').map((direction) => [direction.onsetQuarters.toString(), direction.type])).toEqual([['4', 'start'], ['8', 'stop'], ['8', 'start'], ['12', 'stop']]);
  });

  it('validates rest positions and bar styles and snapshots rest glyph metadata', () => {
    const display = {step: 'F' as const, octave: 5};
    const rest = new Note({...note, pitch: undefined, rest: true, restDisplay: display});
    display.octave = 4;
    expect(rest.restDisplay).toEqual({step: 'F', octave: 5});
    expect(Object.isFrozen(rest.restDisplay)).toBe(true);
    expect(rest.with({onsetQuarters: Rational.ONE}).restDisplay).toEqual(rest.restDisplay);
    expect(() => new Note({...note, restDisplay: display})).toThrow(/restDisplay/);
    expect(() => new Note({...note, pitch: undefined, rest: true, restDisplay: {step: 'F', octave: 10}})).toThrow(/restDisplay/);
    const measure = {id: MeasureId('m'), number: 1, onsetQuarters: Rational.ZERO, durationQuarters: new Rational(4)};
    expect(() => new Measure({...measure, barlineEnd: 'invalid' as 'regular'})).toThrow(/barline/);
    const builder = new ScoreBuilder();
    builder.addPart({id, name: 'Piano'});
    builder.addNote(id, rest);
    builder.addMeasure({...measure, barlineStart: 'heavy-light', barlineEnd: 'light-heavy'});
    const score = scoreFromJSON(builder.build().toJSON());
    expect(score.parts[0].notes[0].restDisplay).toEqual(rest.restDisplay);
    expect(score.measures[0].barlineEnd).toBe('light-heavy');
    const json = JSON.parse(JSON.stringify(score.toJSON()));
    json.measures[0].barlineEnd = 'invalid';
    expect(() => scoreFromJSON(json)).toThrow(/scoreFromJSON/);
  });
});
