import {describe, expect, it} from 'vitest';
import {MeasureId, NoteId, PartId, Rational, ScoreBuilder, ScoreEditError, VoiceId, type ScoreEditResult} from '../../src/core';
import {createScoreEditor} from '../../src/edit/headless';
import {createScoreView, createScoreViewEditing, createStaffViewEditing} from '../../src/view/headless';

function fixture() {
  const builder = new ScoreBuilder();
  builder.addPart({id: PartId('p'), name: 'Piano', staves: 2});
  builder.addMeasure({id: MeasureId('m'), number: 1, onsetQuarters: Rational.ZERO,
    durationQuarters: new Rational(4), timeSignature: {numerator: 4, denominator: 4}});
  return builder.build();
}
function setup(editable = true) {
  const editor = createScoreEditor(fixture());
  const editing = createScoreViewEditing(editor, {editable});
  const staff = createStaffViewEditing(editing);
  return {editor, editing, staff, dispose: () => { staff.dispose(); editing.dispose(); editor.dispose(); }};
}

describe('staff input controller', () => {
  it('keeps spelling, exact duration and independent cursors while sharing content/history', () => {
    const {editor, editing, staff, dispose} = setup();
    const second = createStaffViewEditing(editing, {voice: VoiceId('2'), octave: 3});
    staff.setAlter(-1); staff.setDuration([1, 1], 1);
    expect(staff.insertPitch('B').status).toBe('committed');
    expect(staff.state.onsetQuarters.toJSON()).toEqual([3, 2]);
    expect(second.state.onsetQuarters.toJSON()).toEqual([0, 1]);
    expect(editor.score.parts[0].notes.find((note) => !note.rest)?.pitch.toString()).toBe('Bb4');
    expect(second.insertPitch('C').status).toBe('committed');
    expect(editor.getState().history.undoCount).toBe(2);
    expect(staff.undo().status).toBe('committed');
    expect(editor.score.parts[0].notes.every((note) => note.voice === VoiceId('1'))).toBe(true);
    expect(second.redo().status).toBe('committed');
    second.dispose(); dispose();
  });

  it('selects a source note, deletes it to a rest and preserves cursor with one shared history step', () => {
    const {editor, editing, staff, dispose} = setup();
    staff.setOctave(3); staff.setStaff(2); staff.insertPitch('C');
    const note = editor.score.parts[0].notes.find((value) => !value.rest)!;
    staff.select(note.id);
    expect(staff.state.staff).toBe(2); expect(staff.state.octave).toBe(3);
    expect(editing.state.interaction.selectedNoteIds).toEqual([note.id]);
    expect(staff.deleteSelected().status).toBe('committed');
    expect(editor.score.parts[0].notes.every((value) => value.rest)).toBe(true);
    expect(staff.state.onsetQuarters.toJSON()).toEqual([0, 1]);
    expect(editor.getState().history.undoCount).toBe(2);
    staff.undo(); expect(editor.score.getNote(note.id)).toBe(note);
    dispose();
  });

  it('deletes the captured note when selection observers change the local input target', () => {
    const {editor, editing, staff, dispose} = setup();
    staff.insertPitch('C'); staff.insertPitch('D');
    const [first, second] = editor.score.parts[0].notes.filter((note) => !note.rest);
    editing.select([first.id]);
    let redirected = false;
    const off = staff.subscribe((state) => {
      if (!redirected && state.onsetQuarters.eq(Rational.ZERO)) {
        redirected = true;
        staff.setCursor([1, 1]); staff.setVoice(VoiceId('2')); staff.setStaff(2); staff.setDuration([2, 1]);
      }
    });
    expect(staff.deleteSelected().status).toBe('committed');
    expect(redirected).toBe(true);
    expect(editor.score.getNote(first.id)).toBeUndefined();
    expect(editor.score.getNote(second.id)).toBe(second);
    const replacement = editor.score.parts[0].notes.find((note) => note.onsetQuarters.eq(Rational.ZERO))!;
    expect(replacement.rest).toBe(true); expect(replacement.voice).toBe(first.voice); expect(replacement.staff).toBe(1);
    expect(replacement.duration.quarters.toJSON()).toEqual([1, 1]);
    expect(editor.getState().history.undoCount).toBe(3);
    expect(staff.state.onsetQuarters.toJSON()).toEqual([1, 1]);
    expect(staff.state.voice).toBe(VoiceId('2')); expect(staff.state.staff).toBe(2);
    expect(staff.state.duration.quarters.toJSON()).toEqual([2, 1]);
    off(); dispose();
  });

  it('rejects a deletion superseded by a document edit during selection publication', () => {
    const {editor, editing, staff, dispose} = setup();
    staff.insertPitch('C');
    const note = editor.score.parts[0].notes.find((value) => !value.rest)!;
    editing.select([note.id]);
    let replaced = false;
    let replacement: ScoreEditResult | undefined;
    const off = staff.subscribe((state) => {
      if (!replaced && state.onsetQuarters.eq(Rational.ZERO)) {
        replaced = true;
        replacement = editor.transaction('Replace selection', (transaction) => {
          transaction.add({type: 'delete-notes', noteIds: [note.id]});
          transaction.add({type: 'insert-notes', notes: [{id: NoteId('replacement'), partId: PartId('p'), voice: VoiceId('1'),
            pitch: {step: 'E', alter: 0, octave: 4}, onsetQuarters: [0, 1], durationQuarters: [1, 1]}]});
        });
      }
    });
    const result = staff.deleteSelected();
    expect(replacement?.status).toBe('committed');
    expect(result.status).toBe('failed');
    if (result.status === 'failed') expect(result.error.code).toBe('revision-conflict');
    expect(editor.score.getNote(NoteId('replacement'))?.pitch.toString()).toBe('E4');
    expect(editor.getSnapshot().documentRevision).toBe(2); expect(editor.getState().history.undoCount).toBe(2);
    off(); dispose();
  });

  it('does not commit a deletion after a selection observer disposes the controller', () => {
    const {editor, editing, staff, dispose} = setup();
    staff.insertPitch('C');
    const note = editor.score.parts[0].notes.find((value) => !value.rest)!;
    editing.select([note.id]);
    const before = editor.getSnapshot();
    staff.subscribe((state) => { if (state.onsetQuarters.eq(Rational.ZERO)) staff.dispose(); });
    const result = staff.deleteSelected();
    expect(result.status).toBe('failed');
    if (result.status === 'failed') expect(result.error.code).toBe('disposed');
    expect(editor.getSnapshot()).toBe(before); expect(editor.score.getNote(note.id)).toBe(note);
    dispose();
  });

  it('retains the returned failure when an observer clears the local error', () => {
    const {editor, staff, dispose} = setup();
    let observed: ScoreEditError | undefined;
    const off = staff.subscribe((state) => {
      if (state.error) { observed = state.error; staff.setCursor([0, 1]); }
    });
    const result = staff.deleteSelected();
    expect(result.status).toBe('failed');
    if (result.status === 'failed') {
      expect(result.error).toBeInstanceOf(ScoreEditError); expect(result.error).toBe(observed);
      expect(result.error.code).toBe('invalid-command');
    }
    expect(staff.state.error).toBeUndefined(); expect(editor.getSnapshot().documentRevision).toBe(0);
    off(); dispose();
  });

  it('reports disabled/unsupported failures without advancing cursor or history', () => {
    const {editor, editing, staff, dispose} = setup(false);
    expect(staff.insertPitch('C').status).toBe('failed');
    expect(staff.state.onsetQuarters.toJSON()).toEqual([0, 1]);
    editing.setEditable(true); staff.setCursor([7, 2]);
    expect(staff.insertPitch('C').status).toBe('failed');
    expect(staff.state.error?.code).toBe('unsupported-structure');
    expect(staff.state.onsetQuarters.toJSON()).toEqual([7, 2]);
    expect(editor.getState().history.undoCount).toBe(0);
    expect(staff.deleteSelected().status).toBe('failed');
    dispose();
  });

  it('validates local cursor/spelling/duration without mutating document and releases only borrowed observers', () => {
    const {editor, editing, staff, dispose} = setup();
    for (const bad of [() => staff.setCursor([-1, 1]), () => staff.setCursor([2, 4]), () => staff.setDuration([1, 3]),
      () => staff.setDuration([1, 1], 3), () => staff.setOctave(10), () => staff.setAlter(3 as 0),
      () => staff.setVoice(VoiceId('')), () => staff.setStaff(0)]) expect(bad).toThrow();
    expect(editor.getSnapshot().documentRevision).toBe(0);
    staff.dispose(); staff.dispose();
    expect(staff.state.available).toBe(false);
    expect(editing.state.available).toBe(true);
    expect(editor.getSnapshot().status).toBe('ready');
    expect(staff.insertRest().status).toBe('failed');
    dispose();
  });

  it('preserves requested editing across staff, passive and piano-roll types', () => {
    const editor = createScoreEditor(fixture());
    const view = createScoreView(editor, {type: 'staff', editable: true});
    expect(view.editing?.state.editable).toBe(true);
    view.setType('waterfall'); expect(view.editing?.state.editable).toBe(false);
    view.setType('piano-roll'); expect(view.editing?.state.editable).toBe(true);
    view.setType('staff'); expect(view.editing?.state.editable).toBe(true);
    view.editing?.setEditable(false);
    view.setType('waterfall'); view.setType('staff'); expect(view.editing?.state.editable).toBe(false);
    view.dispose(); editor.dispose();
  });

  it('resets local cursor on checkpoint replacement and becomes unavailable when borrowed owner disposes', () => {
    const {editor, staff, dispose} = setup();
    const checkpoint = editor.createCheckpoint();
    staff.insertPitch('C'); staff.setCursor([3, 1]);
    editor.restoreCheckpoint(checkpoint);
    expect(staff.state.onsetQuarters.toJSON()).toEqual([0, 1]);
    editor.dispose(); expect(staff.state.available).toBe(false);
    expect(staff.insertPitch('D').status).toBe('failed');
    dispose();
  });

  it('preserves a newer cursor intent set by a commit observer', () => {
    const {editor, staff, dispose} = setup();
    let moved = false;
    const off = staff.subscribe((state) => {
      if (!moved && state.document.documentRevision === 1) { moved = true; staff.setCursor([3, 1]); }
    });
    expect(staff.insertPitch('C').status).toBe('committed');
    expect(editor.getSnapshot().documentRevision).toBe(1);
    expect(staff.state.onsetQuarters.toJSON()).toEqual([3, 1]);
    off(); dispose();
  });
});
