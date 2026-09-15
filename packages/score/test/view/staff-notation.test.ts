import {readFileSync} from 'node:fs';
import {describe, expect, it} from 'vitest';
import {
  Duration, Note, NoteId, Part, PartId, Pitch, Rational, ScoreBuilder, VoiceId,
  type MeasureData, type NoteData,
} from '../../src/core';
import {inferStaffClefChanges, projectStaffNotation, spellStaffDuration} from '../../src/view/core/staff-notation';
import {parseMusicXML} from '../../src/io';

const q = (numerator: number, denominator = 1) => new Rational(numerator, denominator);
function note(id: string, onset: Rational, patch: Partial<NoteData> = {}): Note {
  return new Note({id: NoteId(id), pitch: Pitch.parse('C4'), onsetQuarters: onset,
    duration: Duration.eighth(), voice: VoiceId('melody'), ...patch});
}
function music(notes: readonly Note[], measures: readonly Omit<MeasureData, 'id'>[] = [], staves?: number) {
  const builder = new ScoreBuilder();
  const part = builder.addPart({id: PartId('piano'), name: 'Piano', staves});
  notes.forEach((value) => builder.addNote(part, value));
  measures.forEach((value) => builder.addMeasure({id: builder.newMeasureId(), ...value}));
  return builder.build();
}
const bar = (number: number, start: number, length: number, extra: Partial<MeasureData> = {}): Omit<MeasureData, 'id'> => ({
  number, onsetQuarters: q(start), durationQuarters: q(length), ...extra,
});

describe('staff notation projection', () => {
  it('retains written triplet timing, spelling, dots, source identities and nonnumeric voices', () => {
    const triplet = Duration.triplet(Duration.eighth());
    const score = music([
      note('a', q(1), {duration: triplet, pitch: Pitch.parse('Db4'), voice: VoiceId('right hand'), tupletId: 'triplet'}),
      note('b', q(4, 3), {duration: triplet, voice: VoiceId('right hand'), tupletId: 'triplet'}),
      note('c', q(5, 3), {duration: triplet, voice: VoiceId('right hand'), tupletId: 'triplet'}),
      note('d', q(2), {duration: Duration.dotted(Duration.eighth()), voice: VoiceId('right hand')}),
    ]);
    const projection = projectStaffNotation(score);
    const voice = projection.layers[0].measures[0].voices[0];
    expect(voice.id).toBe('right hand');
    expect(voice.events.map((event) => event.onsetQuarters.toString())).toEqual(['1', '4/3', '5/3', '2']);
    expect(voice.events[0].duration).toBe(score.parts[0].notes[0].duration);
    expect(voice.events[0].notes[0]).toBe(score.parts[0].notes[0]);
    expect(voice.events[0].notes[0].pitch.toString()).toBe('Db4');
    expect(voice.events[0].notes[0].tupletId).toBe('triplet');
    expect(voice.events[0].duration.quarters.toString()).toBe('1/3');
    expect(voice.events[3].duration.dots).toBe(1);
    expect(projection.diagnostics).toEqual([]);
  });

  it('forms compatible chords within one voice without combining other voices or durations', () => {
    const score = music([
      note('c', q(0)), note('e', q(0), {pitch: Pitch.parse('E4'), chord: true}),
      note('g', q(0), {pitch: Pitch.parse('G4'), duration: Duration.quarter()}),
      note('bass', q(0), {pitch: Pitch.parse('C3'), voice: VoiceId('bass')}),
    ]);
    const voices = projectStaffNotation(score).layers[0].measures[0].voices;
    expect(voices.map((voice) => voice.id)).toEqual(['melody', 'bass']);
    expect(voices[0].events.map((event) => event.notes.map((value) => value.id))).toEqual([['c', 'e'], ['g']]);
    expect(voices[1].events[0].notes.map((value) => value.id)).toEqual(['bass']);
  });

  it('keeps source pickup and changing-meter boundaries, key changes and source clefs', () => {
    const score = music([note('high', q(0), {pitch: Pitch.parse('C7'), staff: 2})], [
      bar(0, 0, 1, {timeSignature: {numerator: 4, denominator: 4}, keySignature: {fifths: 4},
        clefs: {1: {sign: 'G', line: 2}, 2: {sign: 'G', line: 2}}}),
      bar(1, 1, 3, {timeSignature: {numerator: 3, denominator: 4},
        clefs: {2: {sign: 'C', line: 4}}}),
      bar(2, 4, 5, {timeSignature: {numerator: 5, denominator: 4}, keySignature: {fifths: -2, mode: 'minor'},
        clefs: {2: {sign: 'F', line: 4, octaveChange: -1}}}),
      bar(3, 9, 5),
    ], 2);
    const projection = projectStaffNotation(score, {defaultKey: 1});
    expect(projection.measures.map((measure) => [measure.number, measure.startQuarters.toString(), measure.endQuarters.toString()]))
      .toEqual([[0, '0', '1'], [1, '1', '4'], [2, '4', '9'], [3, '9', '14']]);
    expect(projection.measures.map((measure) => measure.timeSignature.numerator)).toEqual([4, 3, 5, 5]);
    expect(projection.measures.map((measure) => measure.keySignature.fifths)).toEqual([4, 4, -2, -2]);
    expect(projection.layers[1].measures.map((measure) => measure.clef)).toEqual([
      {sign: 'G', line: 2}, {sign: 'C', line: 4},
      {sign: 'F', line: 4, octaveChange: -1}, {sign: 'F', line: 4, octaveChange: -1},
    ]);
    expect(projection.measures[0].source).toBe(score.measures[0]);
    expect(projection.diagnostics).toEqual([]);
  });

  it('synthesizes exact meter-consistent bars including a mid-bar meter change without quantizing notes', () => {
    const builder = new ScoreBuilder();
    const part = builder.addPart({id: PartId('p'), name: 'Part'});
    builder.addNote(part, note('a', q(21, 2)));
    builder.addMeter({atQuarters: q(0), measureNumber: 1, timeSignature: {numerator: 3, denominator: 4}});
    builder.addMeter({atQuarters: q(5), measureNumber: 3, timeSignature: {numerator: 6, denominator: 8}});
    const projection = projectStaffNotation(builder.build());
    expect(projection.measures.map((measure) => [measure.startQuarters.toString(), measure.endQuarters.toString()]))
      .toEqual([['0', '3'], ['3', '5'], ['5', '8'], ['8', '11']]);
    expect(projection.measures.map((measure) => measure.timeSignature)).toEqual([
      {numerator: 3, denominator: 4}, {numerator: 3, denominator: 4},
      {numerator: 6, denominator: 8}, {numerator: 6, denominator: 8},
    ]);
    expect(projection.measures.every((measure) => measure.synthetic)).toBe(true);
    expect(projection.layers[0].measures[3].voices[0].events[0].onsetQuarters.toString()).toBe('21/2');
  });

  it('preserves explicit rests and empty staves when splitting and keeps parts separate when collapsing', () => {
    const score = music([
      note('rest', q(0), {rest: true, pitch: undefined, duration: Duration.whole(), staff: 1}),
      note('bass', q(0), {pitch: Pitch.parse('C3')}),
    ], [], 3).withPart(new Part({id: PartId('solo'), name: 'Solo', notes: [note('solo', q(0))]}));
    const split = projectStaffNotation(score);
    expect(split.layers.map((layer) => [layer.partIndex, layer.staff])).toEqual([[0, 1], [0, 2], [0, 3], [1, 1]]);
    expect(split.layers[0].notes[0].rest).toBe(true);
    expect(split.layers[0].measures[0].voices[0].events[0].rest).toBe(true);
    expect(split.layers[2].notes).toEqual([]);
    const collapsed = projectStaffNotation(score, {splitStaves: false});
    expect(collapsed.layers.map((layer) => [layer.partIndex, layer.staff])).toEqual([[0, 1], [1, 1]]);
    expect(collapsed.layers[0].notes.map((value) => value.id)).toEqual(['rest', 'bass']);
    expect(projectStaffNotation(score, {instruments: [1]}).layers.map((layer) => layer.partIndex)).toEqual([1]);
  });

  it('splits notes crossing bars into exact tied fragments and splits rests without ties', () => {
    const score = music([
      note('held', q(3), {duration: Duration.dotted(Duration.half())}),
      note('rest', q(3), {duration: Duration.dotted(Duration.half()), rest: true, pitch: undefined, voice: VoiceId('silent')}),
    ]);
    const projection = projectStaffNotation(score);
    const [first, second] = projection.layers[0].measures.map((measure) => measure.voices);
    expect(first[0].events[0]).toMatchObject({continuedFromPrevious: false, continuesToNext: true});
    expect(second[0].events[0]).toMatchObject({continuedFromPrevious: true, continuesToNext: false});
    expect(first[0].events[0].duration.quarters.toString()).toBe('1');
    expect(second[0].events[0].duration.quarters.toString()).toBe('2');
    expect(first[0].events[0].notes[0]).toBe(score.parts[0].notes[0]);
    expect(second[0].events[0].notes[0]).toBe(score.parts[0].notes[0]);
    expect(first[1].events[0]).toMatchObject({continuedFromPrevious: false, continuesToNext: false});
    expect(second[1].events[0]).toMatchObject({continuedFromPrevious: false, continuesToNext: false});
    expect(projection.diagnostics).toEqual([]);
  });

  it('preserves exact unsupported performance durations with diagnostics instead of silently rounding', () => {
    const score = music([note('micro', q(0), {duration: new Duration({base: [17, 480]})})]);
    const projection = projectStaffNotation(score);
    const event = projection.layers[0].measures[0].voices[0].events[0];
    expect(event.duration.quarters.toString()).toBe('17/480');
    expect(event.notes[0]).toBe(score.parts[0].notes[0]);
    expect(projection.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(['unsupported-duration']);
  });

  it('keeps zero-duration grace notes without turning them into rests or discarding them', () => {
    const score = music([note('grace', q(0), {grace: {slash: true}, duration: new Duration({base: 0})})]);
    const projection = projectStaffNotation(score);
    expect(projection.layers[0].measures[0].voices[0].events[0].notes[0].grace).toEqual({slash: true});
    expect(projection.diagnostics).toEqual([]);
  });

  it('retains hidden source rests, beam marks and stem direction without combining hidden and visible chords', () => {
    const score = music([
      note('hidden', q(0), {printObject: false}),
      note('visible', q(0), {stem: 'down', beams: [{number: 1, type: 'begin'}]}),
      note('rest', q(1), {rest: true, pitch: undefined, printObject: false}),
    ]);
    const events = projectStaffNotation(score).layers[0].measures[0].voices[0].events;
    expect(events.map((event) => event.notes.map((value) => value.id))).toEqual([['hidden'], ['visible'], ['rest']]);
    expect(events[0].notes[0].printObject).toBe(false);
    expect(events[1].notes[0].stem).toBe('down');
    expect(events[1].notes[0].beams).toEqual([{number: 1, type: 'begin'}]);
    expect(events[2].rest).toBe(true);
    expect(events[2].notes[0].printObject).toBe(false);
  });

  it('reports unbounded synthetic grids without allocating one measure per distant beat', () => {
    const score = music([note('distant', q(1_000_000_000))]);
    const projection = projectStaffNotation(score);
    expect(projection.measures.length).toBeLessThan(20_000);
    expect(projection.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(['measure-limit', 'outside-measures']);
    expect(projection.layers[0].notes[0]).toBe(score.parts[0].notes[0]);
  });

  it('projects the demo score from source notation with both initial treble clefs and complete triplet groups', () => {
    const xml = readFileSync(new URL('../../../../apps/doc/webmusic/public/xml/demo.xml', import.meta.url), 'utf8');
    const score = parseMusicXML(xml);
    const projection = projectStaffNotation(score);
    expect(projection.measures.map((measure) => measure.source)).toEqual(score.measures);
    expect(projection.layers.map((layer) => layer.measures[0].clef)).toEqual([{sign: 'G', line: 2}, {sign: 'G', line: 2}]);
    expect(projection.layers.flatMap((layer) => layer.notes)).toHaveLength([...score.allNotes()].length);
    const eventSources = new Set(projection.layers.flatMap((layer) => layer.measures.flatMap((measure) =>
      measure.voices.flatMap((voice) => voice.events.flatMap((event) => event.notes)))));
    expect(eventSources.size).toBe([...score.allNotes()].length);
    expect(projection.diagnostics).toEqual([]);
  });
});

describe('exact staff duration spelling', () => {
  it('decomposes binary and tuplet fragments with their exact sum intact', () => {
    for (const [value, ratio] of [[q(5, 4), [1, 1]], [q(5, 6), [3, 2]], [q(1, 3), [3, 2]]] as const) {
      const result = spellStaffDuration(value, ratio)!;
      expect(result.reduce((sum, duration) => sum.add(duration.quarters), q(0)).eq(value)).toBe(true);
      expect(result.every((duration) => duration.tuplet[0] === ratio[0] && duration.tuplet[1] === ratio[1])).toBe(true);
    }
    expect(spellStaffDuration(q(17, 480))).toBeUndefined();
    expect(spellStaffDuration(q(1_000_000_000))).toBeUndefined();
    expect(spellStaffDuration(q(-1))).toBeUndefined();
  });
});

describe('timed part notation projection', () => {
  it('applies authored mid-measure clefs to exact onset fragments and carries them over later bars', () => {
    const original = music([0, 1, 1.5, 2, 4].map((start, index) => note(`n-${index}`, Rational.from(start))), [bar(1, 0, 4), bar(2, 4, 4)]);
    const score = original.withPart(new Part({...original.parts[0], clefChanges: [
      {onsetQuarters: q(0), staff: 1, clef: {sign: 'G', line: 2}},
      {onsetQuarters: q(3, 2), staff: 1, clef: {sign: 'F', line: 4}},
      {onsetQuarters: q(4), staff: 1, clef: {sign: 'C', line: 3}},
    ]}));
    const layer = projectStaffNotation(score).layers[0];
    expect(layer.measures.map((measure) => measure.clef.sign)).toEqual(['G', 'C']);
    expect(layer.measures[0].clefChanges.map((change) => change.onsetQuarters.toString())).toEqual(['3/2']);
    expect(layer.measures[1].clefChanges).toEqual([]);
    expect(layer.measures.flatMap((measure) => measure.voices.flatMap((voice) => voice.events.map((event) => event.clef.sign))))
      .toEqual(['G', 'G', 'F', 'F', 'C']);
    expect(layer.clefChanges[1].source).toBe(score.parts[0].clefChanges![1]);
    expect(layer.clefChanges.every((change) => !change.inferred)).toBe(true);
  });

  it('uses part-local clefs independently and never substitutes automatic clefs for an authored extreme register', () => {
    const original = music(Array.from({length: 8}, (_, index) => note(`high-${index}`, q(index), {
      pitch: Pitch.parse('C7'), duration: Duration.quarter(),
    })), [bar(1, 0, 4, {clef: {sign: 'G', line: 2}}), bar(2, 4, 4)]);
    const score = original.withPart(new Part({...original.parts[0], clefChanges: [
      {onsetQuarters: q(0), staff: 1, clef: {sign: 'F', line: 4}},
    ]})).withPart(new Part({id: PartId('other'), name: 'Other', notes: [note('other-note', q(0))], clefChanges: [
      {onsetQuarters: q(0), staff: 1, clef: {sign: 'C', line: 4}},
    ]}));
    const layers = projectStaffNotation(score).layers;
    expect(layers[0].clefChanges.map((change) => change.clef.sign)).toEqual(['F']);
    expect(layers[0].measures.flatMap((measure) => measure.voices.flatMap((voice) => voice.events)).every((event) => event.clef.sign === 'F')).toBe(true);
    expect(layers[1].measures[0].clef).toEqual({sign: 'C', line: 4});
  });

  it('keeps direction source references by staff and includes boundary and terminal marks exactly once', () => {
    const original = music([], [bar(1, 0, 4), bar(2, 4, 4)], 2);
    const score = original.withPart(new Part({...original.parts[0], directions: [
      {kind: 'words', text: 'rit.', onsetQuarters: q(3, 2)},
      {kind: 'dynamics', values: ['p'], onsetQuarters: q(1), staff: 2},
      {kind: 'pedal', type: 'start', onsetQuarters: q(0), staff: 2, line: true},
      {kind: 'pedal', type: 'change', onsetQuarters: q(4), staff: 2, line: true},
      {kind: 'pedal', type: 'stop', onsetQuarters: q(8), staff: 2, line: true},
    ], clefChanges: [{onsetQuarters: q(8), staff: 2, clef: {sign: 'G', line: 2}}]}));
    const layers = projectStaffNotation(score).layers;
    expect(layers[0].directions.map((direction) => direction.kind)).toEqual(['words']);
    expect(layers[0].measures[0].directions[0]).toBe(layers[0].directions[0]);
    expect(layers[1].directions.every((direction) => score.parts[0].directions!.includes(direction))).toBe(true);
    expect(layers[1].measures.map((measure) => measure.directions.map((direction) => direction.onsetQuarters.toString())))
      .toEqual([['0', '1'], ['4', '8']]);
    expect(layers[1].measures[1].clefChanges.map((change) => change.onsetQuarters.toString())).toEqual(['8']);
    const collapsed = projectStaffNotation(score, {splitStaves: false});
    expect(collapsed.layers[0].directions).toEqual(score.parts[0].directions);
  });

  it('retains trailing directions beyond the last note in a bounded notation grid', () => {
    const original = music([note('one', q(0))]);
    const score = original.withPart(new Part({...original.parts[0], directions: [
      {kind: 'wedge', type: 'crescendo', onsetQuarters: q(0)},
      {kind: 'wedge', type: 'stop', onsetQuarters: q(8)},
    ]}));
    const projection = projectStaffNotation(score);
    expect(projection.measures.at(-1)!.endQuarters.toString()).toBe('8');
    expect(projection.layers[0].measures.at(-1)!.directions[0]).toBe(score.parts[0].directions![1]);
    expect(projection.diagnostics).toEqual([]);
  });

  it('uses the new clef for a continued fragment without changing the original tied note', () => {
    const original = music([note('long', q(3), {duration: Duration.half()})]);
    const score = original.withPart(new Part({...original.parts[0], clefChanges: [
      {onsetQuarters: q(0), staff: 1, clef: {sign: 'G', line: 2}},
      {onsetQuarters: q(4), staff: 1, clef: {sign: 'F', line: 4}},
    ]}));
    const events = projectStaffNotation(score).layers[0].measures.flatMap((measure) => measure.voices.flatMap((voice) => voice.events));
    expect(events.map((event) => [event.onsetQuarters.toString(), event.clef.sign, event.continuedFromPrevious]))
      .toEqual([['3', 'G', false], ['4', 'F', true]]);
    expect(events.every((event) => event.notes[0] === score.parts[0].notes[0])).toBe(true);
  });
});

describe('clef inference without authored clefs', () => {
  it('switches only for sustained register changes and preserves the source notes', () => {
    const notes = Array.from({length: 12}, (_, index) => note(`n-${index}`, q(index), {
      pitch: Pitch.parse(index >= 4 && index < 8 ? 'C6' : 'C3'), duration: Duration.quarter(),
    }));
    const changes = inferStaffClefChanges(notes);
    expect(changes.map((change) => [change.onsetQuarters.toString(), change.clef.sign])).toEqual([['0', 'F'], ['4', 'G'], ['8', 'F']]);
    expect(notes.map((value) => value.pitch.toString())).toEqual(['C3', 'C3', 'C3', 'C3', 'C6', 'C6', 'C6', 'C6', 'C3', 'C3', 'C3', 'C3']);
  });

  it('does not oscillate for alternating extremes or change clef around a single outlier', () => {
    const alternating = Array.from({length: 16}, (_, index) => note(`alternate-${index}`, q(index), {
      pitch: Pitch.parse(index % 2 ? 'C6' : 'C3'), duration: Duration.quarter(),
    }));
    expect(inferStaffClefChanges(alternating)).toHaveLength(1);
    const outlier = Array.from({length: 12}, (_, index) => note(`outlier-${index}`, q(index), {
      pitch: Pitch.parse(index === 6 ? 'C7' : 'C3'), duration: Duration.quarter(),
    }));
    expect(inferStaffClefChanges(outlier).map((change) => change.clef.sign)).toEqual(['F']);
  });

  it('does not change within a tuplet or across a tied continuation', () => {
    const notes = [
      ...Array.from({length: 8}, (_, index) => note(`low-${index}`, q(index), {pitch: Pitch.parse('C3'), duration: Duration.quarter()})),
      ...Array.from({length: 3}, (_, index) => note(`tuplet-${index}`, q(24 + index * 2, 3), {
        pitch: Pitch.parse(index === 0 ? 'C3' : 'C6'), duration: Duration.triplet(Duration.quarter()), tupletId: 'run',
      })),
      ...Array.from({length: 4}, (_, index) => note(`high-${index}`, q(10 + index), {pitch: Pitch.parse('C6'), duration: Duration.quarter()})),
    ];
    const changes = inferStaffClefChanges(notes);
    expect(changes.map((change) => change.onsetQuarters.toString())).toEqual(['0', '10']);
    const tied = [note('start', q(0), {pitch: Pitch.parse('C3'), duration: Duration.whole(), tie: 'start'}),
      note('stop', q(4), {pitch: Pitch.parse('C3'), duration: Duration.half(), tie: 'stop'}),
      ...Array.from({length: 5}, (_, index) => note(`high-${index}`, q(4 + index), {pitch: Pitch.parse('C6'), duration: Duration.quarter()})),
    ];
    expect(inferStaffClefChanges(tied).some((change) => change.onsetQuarters.eq(q(4)))).toBe(false);
  });
});
