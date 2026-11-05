import {describe, expect, it} from 'vitest';
import {Duration, MeasureId, Note, NoteId, PartId, Pitch, Rational, ScoreBuilder, ScoreEditError, VoiceId,
  type NoteData, type ScoreEditOperation, type ScoreNotationWrite} from '../../src/core';
import {applyScoreOperations, snapshotScoreOperations} from '../../src/view/core/edit-operations';
import {createScoreEditor} from '../../src/view/headless';

const p = PartId('p'); const v = VoiceId('1');
function note(id: string, onset: number | Rational = 0, duration = Duration.quarter(), extra: Partial<NoteData> = {}): Note {
  return new Note({id: NoteId(id), pitch: Pitch.parse('C4'), onsetQuarters: Rational.from(onset), duration, voice: v, ...extra});
}
function fixture(notes: Note[] = [], measures = true) {
  const builder = new ScoreBuilder();
  builder.addPart({id: p, name: 'Piano', staves: 2});
  if (measures) {
    builder.addMeasure({id: MeasureId('m1'), number: 1, onsetQuarters: Rational.ZERO,
      durationQuarters: new Rational(4), timeSignature: {numerator: 4, denominator: 4}});
    builder.addMeasure({id: MeasureId('m2'), number: 2, onsetQuarters: new Rational(4), durationQuarters: new Rational(4)});
  }
  for (const item of notes) builder.addNote(p, item);
  return builder.build();
}
function write(patch: Partial<ScoreNotationWrite> = {}): ScoreNotationWrite {
  return {type: 'write-notation', partId: p, voice: v, staff: 1, onsetQuarters: [0, 1], duration: {base: [1, 1]},
    notes: [{id: NoteId('w'), pitch: {step: 'E', alter: 0, octave: 4}}], ...patch};
}
function apply(score: ReturnType<typeof fixture>, ...operations: ScoreEditOperation[]) {
  return applyScoreOperations(score, operations).score;
}
function failure(score: ReturnType<typeof fixture>, operation: ScoreEditOperation): ScoreEditError {
  try { applyScoreOperations(score, [operation]); } catch (error) { return error as ScoreEditError; }
  throw new Error('expected the operation to fail');
}
function lane(score: ReturnType<typeof fixture>) {
  return score.parts[0].notes.filter((item) => item.voice === v && (item.staff ?? 1) === 1)
    .map((item) => [String(item.id), item.rest ? 'rest' : item.pitch.toString(), item.onsetQuarters.toString(), item.duration.quarters.toString()]);
}
const triplet = (id: string, at: Rational) => note(id, at, new Duration({base: new Rational(1, 2), tuplet: [3, 2]}), {tupletId: 't1'});

describe('set-pitches', () => {
  it('respells a note and moves its whole tie chain, keeping ties', () => {
    const before = fixture([note('a', 0, Duration.quarter(), {tie: 'start'}), note('b', 1, Duration.quarter(), {tie: 'stop'}), note('c', 2)]);
    const after = apply(before, {type: 'set-pitches', changes: [{noteId: NoteId('a'), pitch: {step: 'D', alter: -1, octave: 4}}]});
    expect(after.getNote(NoteId('a'))!.pitch.toString()).toBe('Db4');
    expect(after.getNote(NoteId('b'))!.pitch.toString()).toBe('Db4');
    expect(after.getNote(NoteId('b'))!.tie).toBe('stop');
    expect(after.getNote(NoteId('c'))).toBe(before.getNote(NoteId('c')));
  });

  it('works on tuplet notes and drops an authored stem direction', () => {
    const before = fixture([triplet('t', Rational.ZERO), triplet('u', new Rational(1, 3)), triplet('x', new Rational(2, 3))].map((item, index) =>
      index ? item : new Note({...item, stem: 'up'})));
    const after = apply(before, {type: 'set-pitches', changes: [{noteId: NoteId('t'), pitch: {step: 'G', alter: 0, octave: 4}}]});
    expect(after.getNote(NoteId('t'))!.pitch.toString()).toBe('G4');
    expect(after.getNote(NoteId('t'))!.stem).toBeUndefined();
    expect(after.getNote(NoteId('t'))!.duration.tuplet).toEqual([3, 2]);
  });

  it('rejects rests, out-of-range pitches and conflicting chain targets', () => {
    const before = fixture([note('r', 0, Duration.quarter(), {rest: true, pitch: undefined}),
      note('a', 1, Duration.quarter(), {tie: 'start'}), note('b', 2, Duration.quarter(), {tie: 'stop'})]);
    expect(failure(before, {type: 'set-pitches', changes: [{noteId: NoteId('r'), pitch: {step: 'C', alter: 0, octave: 4}}]}).code).toBe('unsupported-structure');
    expect(() => snapshotScoreOperations([{type: 'set-pitches', changes: [{noteId: NoteId('a'), pitch: {step: 'C', alter: 0, octave: 10}}]}])).toThrow(/MIDI range/);
    expect(failure(before, {type: 'set-pitches', changes: [
      {noteId: NoteId('a'), pitch: {step: 'D', alter: 0, octave: 4}}, {noteId: NoteId('b'), pitch: {step: 'E', alter: 0, octave: 4}}]}).code).toBe('invalid-command');
  });
});

describe('notes-to-rests', () => {
  it('turns a single note into a rest of the same duration, tuplet and beam position', () => {
    const before = fixture([new Note({...triplet('t', Rational.ZERO), beams: [{number: 1, type: 'begin'}]}),
      new Note({...triplet('u', new Rational(1, 3)), beams: [{number: 1, type: 'continue'}]}),
      new Note({...triplet('x', new Rational(2, 3)), beams: [{number: 1, type: 'end'}]})]);
    const after = apply(before, {type: 'notes-to-rests', noteIds: [NoteId('u')]});
    const rest = after.getNote(NoteId('u'))!;
    expect(rest.rest).toBe(true);
    expect(rest.duration.tuplet).toEqual([3, 2]);
    expect(rest.tupletId).toBe('t1');
    expect(rest.beams).toEqual([{number: 1, type: 'continue'}]);
  });

  it('removes only the chosen heads of a chord and promotes the next head', () => {
    const before = fixture([note('low'), note('high', 0, Duration.quarter(), {pitch: Pitch.parse('E4'), chord: true})]);
    const after = apply(before, {type: 'notes-to-rests', noteIds: [NoteId('low')]});
    expect(after.getNote(NoteId('low'))).toBeUndefined();
    expect(after.getNote(NoteId('high'))!.chord).toBeUndefined();
    expect(after.parts[0].notes.some((item) => item.rest)).toBe(false);
  });

  it('drops the ties and slurs that would lose their partner', () => {
    const before = fixture([note('a', 0, Duration.quarter(), {tie: 'start', slur: 'start'}), note('b', 1, Duration.quarter(), {tie: 'stop'}),
      note('c', 2, Duration.quarter(), {slur: 'stop'})]);
    const after = apply(before, {type: 'notes-to-rests', noteIds: [NoteId('a')]});
    expect(after.getNote(NoteId('b'))!.tie).toBeUndefined();
    expect(after.getNote(NoteId('c'))!.slur).toBeUndefined();
  });

  it('leaves rests unchanged', () => {
    const before = fixture([note('r', 0, Duration.quarter(), {rest: true, pitch: undefined})]);
    expect(apply(before, {type: 'notes-to-rests', noteIds: [NoteId('r')]})).toBe(before);
  });
});

describe('tie-notes', () => {
  it('ties to the next same-pitch note and unties again', () => {
    const before = fixture([note('a'), note('b', 1), note('c', 2)]);
    const tied = apply(before, {type: 'tie-notes', noteIds: [NoteId('a'), NoteId('b')], tied: true});
    expect([tied.getNote(NoteId('a'))!.tie, tied.getNote(NoteId('b'))!.tie, tied.getNote(NoteId('c'))!.tie]).toEqual(['start', 'continue', 'stop']);
    const untied = apply(tied, {type: 'tie-notes', noteIds: [NoteId('a')], tied: false});
    expect([untied.getNote(NoteId('a'))!.tie, untied.getNote(NoteId('b'))!.tie]).toEqual([undefined, 'start']);
  });

  it('rejects a note with no adjacent same-pitch successor', () => {
    const before = fixture([note('a'), note('b', 1, Duration.quarter(), {pitch: Pitch.parse('D4')})]);
    expect(failure(before, {type: 'tie-notes', noteIds: [NoteId('a')], tied: true}).code).toBe('unsupported-structure');
  });
});

describe('write-notation', () => {
  it('replaces covered events and fills a partly covered remainder with rests', () => {
    const before = fixture([note('a', 0, Duration.half()), note('b', 2, Duration.half())]);
    const after = apply(before, write({onsetQuarters: [2, 1], duration: {base: [1, 1]}}));
    expect(lane(after)).toEqual([['a', 'C4', '0', '2'], ['w', 'E4', '2', '1'], ['w:rest:0', 'rest', '3', '1']]);
  });

  it('keeps the ID and expression marks of a rewritten note when its duration changes', () => {
    const before = fixture([note('a', 0, Duration.quarter(), {articulations: ['staccato'], beams: [{number: 1, type: 'begin'}]}),
      note('r', 1, new Duration({base: new Rational(2), dots: 1}), {rest: true, pitch: undefined})]);
    const after = apply(before, write({notes: [{id: NoteId('a'), pitch: {step: 'C', alter: 0, octave: 4}}], duration: {base: [2, 1]}}));
    expect(lane(after)).toEqual([['a', 'C4', '0', '2'], ['a:rest:0', 'rest', '2', '2']]);
    expect(after.getNote(NoteId('a'))!.articulations).toEqual(['staccato']);
    expect(after.getNote(NoteId('a'))!.beams).toBeUndefined();
  });

  it('writes chords and leaves other voices, staves and tuplets elsewhere untouched', () => {
    const tupletBeat = [triplet('t1n', new Rational(3)), triplet('t2n', new Rational(10, 3)), triplet('t3n', new Rational(11, 3))];
    const other = note('other', 0, Duration.whole(), {voice: VoiceId('2')});
    const bass = note('bass', 0, Duration.whole(), {pitch: Pitch.parse('C3'), staff: 2});
    const before = fixture([note('a', 0), ...tupletBeat, other, bass]);
    const after = apply(before, write({notes: [{id: NoteId('c1'), pitch: {step: 'C', alter: 0, octave: 4}},
      {id: NoteId('c2'), pitch: {step: 'E', alter: 0, octave: 4}}]}));
    expect(after.getNote(NoteId('c2'))!.chord).toBe(true);
    expect(after.getNote(NoteId('a'))).toBeUndefined();
    for (const id of ['t1n', 'other', 'bass']) expect(after.getNote(NoteId(id))).toBe(before.getNote(NoteId(id)));
  });

  it('drops beams in the rewritten voice and ties that lose their partner', () => {
    const before = fixture([note('a', 0, Duration.eighth(), {beams: [{number: 1, type: 'begin'}], tie: 'start'}),
      note('b', new Rational(1, 2), Duration.eighth(), {beams: [{number: 1, type: 'end'}], tie: 'stop'})]);
    const after = apply(before, write({duration: {base: [1, 2]}}));
    expect(after.getNote(NoteId('b'))!.tie).toBeUndefined();
    expect(after.getNote(NoteId('b'))!.beams).toBeUndefined();
  });

  it('uses meter bars when the score has no authored measures', () => {
    const before = fixture([note('a', 4, Duration.whole())], false);
    const after = apply(before, write({onsetQuarters: [4, 1]}));
    expect(lane(after)).toEqual([['w', 'E4', '4', '1'], ['w:rest:0', 'rest', '5', '3']]);
  });

  it('rejects tuplet rewrites, barline crossings and writes inside a sounding note', () => {
    const before = fixture([triplet('t', Rational.ZERO), triplet('u', new Rational(1, 3)), triplet('x', new Rational(2, 3)), note('h', 2, Duration.half())]);
    expect(failure(before, write()).message).toMatch(/Tuplet/);
    expect(failure(before, write({onsetQuarters: [2, 1], duration: {base: [4, 1]}})).message).toMatch(/barline/);
    expect(failure(before, write({onsetQuarters: [3, 1]})).message).toMatch(/inside a sounding note/);
  });

  it('is a single undoable history item, and rewriting identical content changes nothing', () => {
    const before = fixture([note('a', 0, Duration.whole())]);
    const editor = createScoreEditor(before);
    expect(editor.transaction('Write', (tx) => tx.add(write({notes: [{id: NoteId('a'), pitch: {step: 'C', alter: 0, octave: 4}}], duration: {base: [4, 1]}}))).status).toBe('noop');
    expect(editor.score).toBe(before);
    expect(editor.transaction('Write', (tx) => tx.add(write())).status).toBe('committed');
    expect(editor.getState().history.undoCount).toBe(1);
    editor.undo();
    expect(editor.score).toBe(before);
  });

  it('validates the payload before evaluating it', () => {
    expect(() => snapshotScoreOperations([write({notes: []})])).toThrow(/nonempty/);
    expect(() => snapshotScoreOperations([write({duration: {base: [3, 1]}})])).toThrow(/whole through 64th/);
    expect(() => snapshotScoreOperations([write({notes: [{id: NoteId('w'), pitch: null, velocity: 80}]})])).toThrow(/rest cannot have a velocity/);
  });
});
