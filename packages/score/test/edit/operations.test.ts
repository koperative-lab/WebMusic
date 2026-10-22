import {describe, expect, it} from 'vitest';
import {Duration, Note, NoteId, Part, PartId, Pitch, Rational, Score, ScoreBuilder, VoiceId, type NoteData} from '../../src/core';
import {ScoreEditError, type ScoreEditOperation, type ScoreNoteInput} from '../../src/core/editing';
import {applyScoreOperations, sameScoreContent, snapshotScoreOperations, validateEditableScore} from '../../src/edit/core/operations';
import {createScoreEditor} from '../../src/edit/headless/score-editor';
import {parseMIDI, serializeMIDI} from '../../src/io/formats/midi';
import {serializeMusicXML} from '../../src/io/formats/musicxml';

const noteId = NoteId('a');
const partId = PartId('p');

function note(patch: Partial<NoteData> = {}): Note {
  return new Note({id: noteId, pitch: Pitch.parse('C4'), onsetQuarters: new Rational(1),
    duration: Duration.quarter(), voice: VoiceId('v'), ...patch});
}

function score(notes = [note()]): Score {
  const builder = new ScoreBuilder();
  builder.addPart({id: partId, name: 'Piano'});
  builder.addPart({id: PartId('untouched'), name: 'Other'});
  for (const item of notes) builder.addNote(partId, item);
  return builder.build();
}

function input(id = 'new'): ScoreNoteInput {
  return {id: NoteId(id), partId, pitch: {step: 'D', alter: 0, octave: 4},
    onsetQuarters: [5, 3], durationQuarters: [1, 3], voice: VoiceId('v'), velocity: 95};
}

function expectCode(action: () => unknown, code: ScoreEditError['code']): void {
  expect(action).toThrowError(ScoreEditError);
  try { action(); } catch (error) { expect((error as ScoreEditError).code).toBe(code); }
}

describe('Score semantic operations', () => {
  it('executes dependent operations in order while preserving untouched parts and the input', () => {
    const before = score();
    const result = applyScoreOperations(before, [
      {type: 'insert-notes', notes: [input()]},
      {type: 'move-notes', noteIds: [NoteId('new')], deltaQuarters: [1, 3]},
      {type: 'transpose-notes', noteIds: [NoteId('new')], semitones: 2},
      {type: 'delete-notes', noteIds: [noteId]},
    ]);
    expect(before.getNote(noteId)).toBeDefined();
    expect(before.getNote(NoteId('new'))).toBeUndefined();
    expect(result.score.getNote(noteId)).toBeUndefined();
    expect(result.score.getNote(NoteId('new'))?.onsetQuarters.toJSON()).toEqual([2, 1]);
    expect(result.score.getNote(NoteId('new'))?.pitch.toString()).toBe('E4');
    expect(result.score.getNote(NoteId('new'))?.velocity).toBe(95);
    expect(result.score.parts[1]).toBe(before.parts[1]);
    expect(result.affectedNoteIds).toEqual([NoteId('new'), noteId]);
  });

  it('does not expose an earlier valid operation when a later operation fails', () => {
    const before = score();
    expectCode(() => applyScoreOperations(before, [
      {type: 'move-notes', noteIds: [noteId], deltaQuarters: [1, 1]},
      {type: 'delete-notes', noteIds: [NoteId('missing')]},
    ]), 'unknown-note');
    expect(before.getNote(noteId)?.onsetQuarters.toJSON()).toEqual([1, 1]);
  });

  it('synchronizes effective musical timing while retaining resolved velocity and Duration spelling', () => {
    const original = note({duration: Duration.dotted(Duration.quarter()),
      performed: {onsetSec: 0.45, durationSec: 0.72, velocity: 97}, velocityOverride: 103});
    const result = applyScoreOperations(score([original]), [
      {type: 'move-notes', noteIds: [noteId], deltaQuarters: [1, 7]},
    ]).score.getNote(noteId)!;
    expect(result.onsetQuarters.toJSON()).toEqual([8, 7]);
    expect(result.duration).toBe(original.duration);
    expect(result.performed).toBeUndefined();
    expect(result.velocityOverride).toBe(103);
    expect(original.performed?.onsetSec).toBe(0.45);
  });

  it('stores the performed velocity as an override when a timing edit removes performed timing', () => {
    const original = note({performed: {onsetSec: 0.45, durationSec: 0.48, velocity: 97}});
    const moved = applyScoreOperations(score([original]), [{type: 'move-notes', noteIds: [noteId], deltaQuarters: [1, 4]}]).score.getNote(noteId)!;
    expect(moved.performed).toBeUndefined();
    expect(moved.velocityOverride).toBe(97);
    expect(moved.velocity).toBe(97);
  });

  it('preserves performed timing under pitch/velocity changes and no-op timing changes', () => {
    const original = note({performed: {onsetSec: 0.45, durationSec: 0.48, velocity: 97}});
    const before = score([original]);
    const noOp = applyScoreOperations(before, [
      {type: 'move-notes', noteIds: [noteId], deltaQuarters: [0, 1]},
      {type: 'resize-notes', noteIds: [noteId], durationQuarters: [1, 1]},
      {type: 'quantize-notes', noteIds: [noteId]},
    ]);
    expect(noOp.score).toBe(before);
    expect(noOp.affectedNoteIds).toEqual([]);
    const changed = applyScoreOperations(before, [
      {type: 'transpose-notes', noteIds: [noteId], semitones: 1},
      {type: 'set-velocity', noteIds: [noteId], velocity: 44},
    ]).score;
    expect(changed.getNote(noteId)?.performed).toEqual(original.performed);
    expect(changed.getNote(noteId)?.velocity).toBe(44);
    expect(applyScoreOperations(changed, [{type: 'set-velocity', noteIds: [noteId], velocity: null}])
      .score.getNote(noteId)?.velocity).toBe(97);
  });

  it('returns the exact initial root for net-zero content even when equal-onset notes reorder', () => {
    const before = score([note(), note({id: NoteId('b')})]);
    const result = applyScoreOperations(before, [
      {type: 'move-notes', noteIds: [noteId], deltaQuarters: [1, 3]},
      {type: 'move-notes', noteIds: [noteId], deltaQuarters: [-1, 3]},
      {type: 'insert-notes', notes: [input()]},
      {type: 'delete-notes', noteIds: [NoteId('new')]},
    ]);
    expect(result.score).toBe(before);
    expect(result.affectedNoteIds).toEqual([]);
    expect(before.getNote(noteId)?.velocityOverride).toBeUndefined();
  });

  it('quantizes exact rational grids beyond tick precision with ties forward on either side of origin', () => {
    const before = score([note({onsetQuarters: new Rational(1, 14)}),
      note({id: NoteId('b'), onsetQuarters: new Rational(3, 14)})]);
    const result = applyScoreOperations(before, [{type: 'quantize-notes', noteIds: [noteId, NoteId('b')],
      grid: [1, 7], origin: [1, 7]}]).score;
    expect(result.getNote(noteId)?.onsetQuarters.toJSON()).toEqual([1, 7]);
    expect(result.getNote(NoteId('b'))?.onsetQuarters.toJSON()).toEqual([2, 7]);
  });

  it('quantizes with exact intermediates beyond Number safe products', () => {
    const denominator = 1_000_000_007;
    const before = score([note({onsetQuarters: new Rational(1, 2 * denominator)})]);
    const result = applyScoreOperations(before, [{type: 'quantize-notes', noteIds: [noteId],
      grid: [1, denominator], origin: [1, denominator]}]).score;
    expect(result.getNote(noteId)?.onsetQuarters.toJSON()).toEqual([1, denominator]);
  });

  it('uses origin for onset and a zero-anchored duration grid; rejects duration quantized to zero', () => {
    const before = score([note({onsetQuarters: new Rational(1, 3), duration: new Duration({base: [1, 3]})})]);
    const result = applyScoreOperations(before, [{type: 'quantize-notes', noteIds: [noteId],
      grid: [1, 4], origin: [1, 8], target: 'both'}]).score.getNote(noteId)!;
    expect(result.onsetQuarters.toJSON()).toEqual([3, 8]);
    expect(result.duration.quarters.toJSON()).toEqual([1, 4]);
    expectCode(() => applyScoreOperations(score([note({duration: new Duration({base: [1, 32]})})]),
      [{type: 'quantize-notes', noteIds: [noteId], target: 'duration'}]), 'invalid-command');
  });

  it.each([
    {tie: 'start' as const},
    {tupletId: 'tuplet'},
    {tupletMarks: [{type: 'start' as const}]},
    {duration: Duration.triplet(Duration.quarter())},
    {grace: true, duration: new Duration({base: 0})},
  ])('blocks rhythm repair for %j while keeping its unchanged source readable', (patch) => {
    const before = score([note(patch)]);
    expect(() => validateEditableScore(before)).not.toThrow();
    expectCode(() => applyScoreOperations(before, [{type: 'move-notes', noteIds: [noteId], deltaQuarters: [1, 4]}]), 'unsupported-structure');
    expectCode(() => applyScoreOperations(before, [{type: 'delete-notes', noteIds: [noteId]}]), 'unsupported-structure');
    expect(applyScoreOperations(before, [{type: 'move-notes', noteIds: [noteId], deltaQuarters: [0, 1]}]).score).toBe(before);
  });

  it('allows pitch-only tuplet edits while rejecting independent tied-pitch edits', () => {
    const tuplet = score([note({duration: Duration.triplet(Duration.quarter())})]);
    const changed = applyScoreOperations(tuplet, [{type: 'transpose-notes', noteIds: [noteId], semitones: 2}]).score.getNote(noteId)!;
    expect(changed.pitch.toString()).toBe('D4');
    expect(changed.duration).toBe(tuplet.getNote(noteId)?.duration);
    expectCode(() => applyScoreOperations(score([note({tie: 'start'})]),
      [{type: 'transpose-notes', noteIds: [noteId], semitones: 2}]), 'unsupported-structure');
  });

  it('rejects negative positions, out-of-range pitch, bad velocity and rational overflow atomically', () => {
    const before = score();
    const operations: ScoreEditOperation[] = [
      {type: 'move-notes', noteIds: [noteId], deltaQuarters: [-2, 1]},
      {type: 'transpose-notes', noteIds: [noteId], semitones: 100},
      {type: 'set-velocity', noteIds: [noteId], velocity: 128},
      {type: 'move-notes', noteIds: [noteId], deltaQuarters: [Number.MAX_SAFE_INTEGER, 1]},
    ];
    for (const operation of operations) expectCode(() => applyScoreOperations(before, [operation]), 'invalid-command');
  });

  it('rejects unrepresentable final note offsets before changing editor history or publishing', () => {
    const original = score();
    const editor = createScoreEditor(original);
    const initial = editor.getSnapshot();
    let notifications = 0;
    const unsubscribe = editor.subscribe(() => { notifications++; });
    const result = editor.execute({version: 1, label: 'Overflow', documentId: initial.documentId,
      expectedRevision: initial.documentRevision,
      operations: [{type: 'move-notes', noteIds: [noteId], deltaQuarters: [Number.MAX_SAFE_INTEGER - 1, 1]}]});
    expect(result.status).toBe('failed');
    expect(editor.getSnapshot()).toBe(initial);
    expect(editor.getState().history.undoCount).toBe(0);
    expect(notifications).toBe(1);
    unsubscribe();
    editor.dispose();
  });

  it('rejects missing parts, unknown IDs and duplicate identifiers', () => {
    expectCode(() => applyScoreOperations(score(), [{type: 'insert-notes', notes: [{...input(), partId: PartId('missing')}]}]), 'unknown-part');
    expectCode(() => applyScoreOperations(score(), [{type: 'insert-notes', notes: [input('a')]}]), 'duplicate-id');
    expectCode(() => applyScoreOperations(score(), [{type: 'insert-notes', notes: [input(), input()]}]), 'duplicate-id');
    expectCode(() => applyScoreOperations(score(), [{type: 'delete-notes', noteIds: [noteId, noteId]}]), 'duplicate-id');
  });

  it('snapshots all nested input without retaining mutable caller data', () => {
    const notes = [input()];
    const source: ScoreEditOperation[] = [{type: 'insert-notes', notes}];
    const frozen = snapshotScoreOperations(source);
    notes.length = 0;
    expect((frozen[0] as {notes: readonly ScoreNoteInput[]}).notes).toHaveLength(1);
    const inserted = (frozen[0] as {notes: readonly ScoreNoteInput[]}).notes[0];
    expect(Object.isFrozen(frozen)).toBe(true);
    expect(Object.isFrozen(inserted.pitch)).toBe(true);
    expect(Object.isFrozen(inserted.onsetQuarters)).toBe(true);
  });

  it('rejects malformed/nonserializable payloads without evaluating accessors', () => {
    let calls = 0;
    const accessor = {type: 'delete-notes', get noteIds() { calls++; return [noteId]; }};
    const cyclic: Record<string, unknown> = {type: 'delete-notes', noteIds: [noteId]};
    cyclic.extra = cyclic;
    const symbol = {type: 'delete-notes', noteIds: [noteId], [Symbol('extra')]: 1};
    for (const malformed of [accessor, cyclic, symbol,
      {type: 'delete-notes', noteIds: new Array(1)},
      {type: 'move-notes', noteIds: [noteId], deltaQuarters: [NaN, 1]},
      {type: 'quantize-notes', noteIds: [noteId], grid: undefined},
      {type: 'delete-notes', noteIds: [noteId], extra: true},
      {type: 'delete-notes', noteIds: [noteId], toJSON: () => ({})},
      {type: 'move-notes', noteIds: [noteId], deltaQuarters: [1, 0]},
      {type: 'move-notes', noteIds: [noteId], deltaQuarters: [2, 4]},
      {type: 'unknown', noteIds: [noteId]}, new Date(),
    ]) expectCode(() => snapshotScoreOperations([malformed] as unknown as ScoreEditOperation[]), 'invalid-command');
    expect(calls).toBe(0);
  });

  it('validates editor input identity and ordinary-note time, while preserving legal rests/grace', () => {
    const base = score();
    const duplicates = new Score({...base, parts: [base.parts[0], new Part({id: PartId('p2'), name: 'Duplicate', notes: [note()]})]});
    expectCode(() => validateEditableScore(duplicates), 'duplicate-id');
    expectCode(() => validateEditableScore(new Score({...base, parts: [base.parts[0], base.parts[0]]})), 'duplicate-id');
    expectCode(() => validateEditableScore(score([note({id: NoteId('')})])), 'invalid-score');
    expectCode(() => validateEditableScore(score([note({onsetQuarters: new Rational(-1)})])), 'invalid-score');
    expectCode(() => validateEditableScore(score([note({duration: new Duration({base: 0})})])), 'invalid-score');
    expect(() => validateEditableScore(score([note({rest: true, pitch: undefined})]))).not.toThrow();
  });

  it('compares semantic content without calling whole-score serialization', () => {
    const before = score();
    const changed = before.edit((tx) => tx.updateNote(noteId, {onsetQuarters: new Rational(2)}));
    const restored = changed.edit((tx) => tx.updateNote(noteId, {onsetQuarters: new Rational(1)}));
    expect(sameScoreContent(before, changed)).toBe(false);
    expect(sameScoreContent(before, restored)).toBe(true);
    expect(sameScoreContent(before, before.withMetadata({title: 'Changed'}))).toBe(false);
  });
});

describe('Score operation spelling, velocity and structure rules', () => {
  it.each([
    ['Bb4', 12, 'Bb5'], ['Cb4', 12, 'Cb5'], ['E#4', 12, 'E#5'], ['F##4', -24, 'F##2'],
    ['Bb4', 2, 'C5'], ['Eb4', 1, 'E4'], ['Bb4', 3, 'Db5'], ['Ebb4', 1, 'Eb4'], ['Cb4', -1, 'Bb3'],
    ['F#4', 2, 'G#4'], ['B#3', 1, 'C#4'], ['D4', 1, 'D#4'], ['D4', -1, 'C#4'],
  ])('transposes written %s by %i semitones to %s', (from, semitones, to) => {
    const before = score([note({pitch: Pitch.parse(from)})]);
    const changed = applyScoreOperations(before, [{type: 'transpose-notes', noteIds: [noteId], semitones}]).score.getNote(noteId)!;
    expect(changed.pitch.toString()).toBe(to);
    expect(changed.pitch.midi).toBe(before.getNote(noteId)!.pitch.midi + semitones);
  });

  it('spells representable resized, quantized and inserted lengths with a base and dots', () => {
    const spelled = (quarters: readonly [number, number]) => applyScoreOperations(score(),
      [{type: 'resize-notes', noteIds: [noteId], durationQuarters: quarters}]).score.getNote(noteId)!.duration.toJSON();
    expect(spelled([3, 4])).toEqual({base: [1, 2], dots: 1, tuplet: [1, 1]});
    expect(spelled([7, 8])).toEqual({base: [1, 2], dots: 2, tuplet: [1, 1]});
    expect(spelled([3, 2])).toEqual({base: [1, 1], dots: 1, tuplet: [1, 1]});
    expect(spelled([7, 64])).toEqual({base: [1, 16], dots: 2, tuplet: [1, 1]});
    expect(spelled([5, 4])).toEqual({base: [5, 4], dots: 0, tuplet: [1, 1]});
    expect(spelled([1, 3])).toEqual({base: [1, 3], dots: 0, tuplet: [1, 1]});
    const quantized = applyScoreOperations(score([note({duration: new Duration({base: [5, 7]})})]),
      [{type: 'quantize-notes', noteIds: [noteId], target: 'duration'}]).score.getNote(noteId)!;
    expect(quantized.duration.toJSON()).toEqual({base: [1, 2], dots: 1, tuplet: [1, 1]});
    const inserted = applyScoreOperations(score(), [{type: 'insert-notes', notes: [{...input(), durationQuarters: [3, 2]}]}]).score;
    expect(inserted.getNote(NoteId('new'))!.duration.toJSON()).toEqual({base: [1, 1], dots: 1, tuplet: [1, 1]});
    // The staff controller re-enters a selected note with its stored spelling.
    const resized = applyScoreOperations(score(), [{type: 'resize-notes', noteIds: [noteId], durationQuarters: [3, 4]}]).score;
    const duration = resized.getNote(noteId)!.duration;
    expect(() => snapshotScoreOperations([{type: 'enter-notation', entry: {id: NoteId('rest'), partId, voice: VoiceId('v'),
      onsetQuarters: [1, 1], duration: {base: duration.base.toJSON(), dots: duration.dots}, pitch: null}}])).not.toThrow();
    expect(serializeMusicXML(resized)).toContain('<dot');
    expect(parseMIDI(serializeMIDI(resized).buffer as ArrayBuffer).notes[0].performed?.durationSec).toBeCloseTo(0.375, 5);
  });

  it('rejects velocity on rests and tie continuations while allowing chain heads and clearing', () => {
    const rest = score([note({rest: true, pitch: undefined})]);
    expectCode(() => applyScoreOperations(rest, [{type: 'set-velocity', noteIds: [noteId], velocity: 90}]), 'unsupported-structure');
    expect(applyScoreOperations(rest, [{type: 'set-velocity', noteIds: [noteId], velocity: null}]).score).toBe(rest);
    const tied = score([note({tie: 'start'}), note({id: NoteId('b'), onsetQuarters: new Rational(2), tie: 'stop'}),
      note({id: NoteId('lone'), onsetQuarters: new Rational(4), pitch: Pitch.parse('E4'), tie: 'stop'})]);
    expectCode(() => applyScoreOperations(tied, [{type: 'set-velocity', noteIds: [NoteId('b')], velocity: 90}]), 'unsupported-structure');
    const changed = applyScoreOperations(tied, [{type: 'set-velocity', noteIds: [noteId, NoteId('lone')], velocity: 90}]).score;
    expect(changed.getNote(noteId)?.velocity).toBe(90);
    // A stop without an open chain sounds as its own event.
    expect(changed.getNote(NoteId('lone'))?.velocity).toBe(90);
    const stale = score([note({tie: 'start'}), note({id: NoteId('b'), onsetQuarters: new Rational(2), tie: 'stop', velocityOverride: 50})]);
    expect(applyScoreOperations(stale, [{type: 'set-velocity', noteIds: [NoteId('b')], velocity: null}])
      .score.getNote(NoteId('b'))?.velocityOverride).toBeUndefined();
  });

  it('reports only notes whose content differs between the input and the result', () => {
    const before = score([note(), note({id: NoteId('b')})]);
    const result = applyScoreOperations(before, [
      {type: 'insert-notes', notes: [input('x')]},
      {type: 'delete-notes', noteIds: [NoteId('x')]},
      {type: 'move-notes', noteIds: [NoteId('b')], deltaQuarters: [1, 1]},
      {type: 'move-notes', noteIds: [NoteId('b')], deltaQuarters: [-1, 1]},
      {type: 'set-velocity', noteIds: [noteId], velocity: 70},
    ]);
    expect(result.affectedNoteIds).toEqual([noteId]);
  });

  it('validates sounding pitch through the Part transposition', () => {
    const builder = new ScoreBuilder();
    builder.addPart({id: partId, name: 'Piccolo', transpose: {chromatic: 0, octaveChange: 1}});
    builder.addNote(partId, note());
    const before = builder.build();
    expectCode(() => applyScoreOperations(before, [{type: 'transpose-notes', noteIds: [noteId], semitones: 60}]), 'invalid-command');
    expectCode(() => applyScoreOperations(before, [{type: 'insert-notes', notes: [{...input(), pitch: {step: 'C', alter: 0, octave: 9}}]}]), 'invalid-command');
    const valid = applyScoreOperations(before, [{type: 'transpose-notes', noteIds: [noteId], semitones: 55}]).score;
    expect(parseMIDI(serializeMIDI(valid).buffer as ArrayBuffer).notes[0].pitch.midi).toBe(127);
  });

  it('deletes authored slur pairs and beam groups whole or not at all', () => {
    const eighth = Duration.eighth();
    const slurred = score([note({slur: 'start'}), note({id: NoteId('middle'), onsetQuarters: new Rational(2)}),
      note({id: NoteId('end'), onsetQuarters: new Rational(3), slur: [{type: 'stop', number: 1}]})]);
    expectCode(() => applyScoreOperations(slurred, [{type: 'delete-notes', noteIds: [noteId]}]), 'unsupported-structure');
    expectCode(() => applyScoreOperations(slurred, [{type: 'delete-notes', noteIds: [NoteId('end')]}]), 'unsupported-structure');
    expect(applyScoreOperations(slurred, [{type: 'delete-notes', noteIds: [NoteId('middle')]}]).score.parts[0].notes).toHaveLength(2);
    expect(applyScoreOperations(slurred, [{type: 'delete-notes', noteIds: [noteId, NoteId('end')]}]).score.parts[0].notes).toHaveLength(1);
    const beamed = (id: string, onset: number, type: 'begin' | 'continue' | 'end', extra: Partial<NoteData> = {}) =>
      note({id: NoteId(id), onsetQuarters: new Rational(onset, 2), duration: eighth, beams: [{number: 1, type}], ...extra});
    const group = score([beamed('b1', 2, 'begin'), beamed('chord', 2, 'begin', {pitch: Pitch.parse('E4'), chord: true}),
      beamed('b2', 3, 'continue'), beamed('b3', 4, 'end'), beamed('orphan', 6, 'continue')]);
    for (const ids of [['b2'], ['b1', 'chord'], ['b3']]) {
      expectCode(() => applyScoreOperations(group, [{type: 'delete-notes', noteIds: ids.map(NoteId)}]), 'unsupported-structure');
    }
    expect(applyScoreOperations(group, [{type: 'delete-notes', noteIds: [NoteId('chord')]}]).score.parts[0].notes).toHaveLength(4);
    expect(applyScoreOperations(group, [{type: 'delete-notes', noteIds: ['b1', 'chord', 'b2', 'b3'].map(NoteId)}])
      .score.parts[0].notes.map((item) => item.id)).toEqual([NoteId('orphan')]);
    expect(applyScoreOperations(group, [{type: 'delete-notes', noteIds: [NoteId('orphan')]}]).score.parts[0].notes).toHaveLength(4);
    // A beamed grace group at the main group's onset does not absorb its first note.
    const graced = score([beamed('g1', 2, 'begin', {grace: true}), beamed('g2', 2, 'end', {grace: true, pitch: Pitch.parse('D4')}),
      beamed('n1', 2, 'begin'), beamed('n2', 3, 'continue'), beamed('n3', 4, 'end')]);
    expectCode(() => applyScoreOperations(graced, [{type: 'delete-notes', noteIds: [NoteId('n1')]}]), 'unsupported-structure');
    expect(applyScoreOperations(graced, [{type: 'delete-notes', noteIds: ['n1', 'n2', 'n3'].map(NoteId)}])
      .score.parts[0].notes.map((item) => item.id)).toEqual([NoteId('g1'), NoteId('g2')]);
  });
});
