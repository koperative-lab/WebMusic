// @vitest-environment jsdom
import {afterEach, expect, it} from 'vitest';
import {MeasureId, PartId, Rational, ScoreBuilder} from '../../src/core';
import {createScoreEditor, type ScoreEditor} from '../../src/edit/headless';
import {parseMIDI, serializeMIDI} from '../../src/io/formats/midi';
import {ScorePlayerElement} from '../../src/play/element/score-player';
import {ScoreTimeline} from '../../src/play/headless/score-timeline';
import {ScoreViewElement} from '../../src/view/element/score-view';

customElements.define('staff-integration-player', ScorePlayerElement);
customElements.define('staff-integration-view', ScoreViewElement);
const editors: ScoreEditor[] = [];
afterEach(() => {
  document.body.replaceChildren();
  for (const editor of editors.splice(0)) editor.dispose();
});

it('staff entry, piano roll, native playback and MIDI share a revision and one undo history', async () => {
  const builder = new ScoreBuilder();
  builder.addPart({id: PartId('piano'), name: 'Piano'});
  builder.addMeasure({id: MeasureId('bar-1'), number: 1, onsetQuarters: Rational.ZERO,
    durationQuarters: new Rational(4), timeSignature: {numerator: 4, denominator: 4}});
  builder.addTempo({atQuarters: Rational.ZERO, bpm: 120});
  const initial = builder.build();
  const editor = createScoreEditor(initial); editors.push(editor);
  const player = document.createElement('staff-integration-player') as ScorePlayerElement;
  player.id = 'staff-audition'; player.editor = editor;
  const staff = document.createElement('staff-integration-view') as ScoreViewElement;
  staff.setAttribute('type', 'staff'); staff.editor = editor; staff.editable = true;
  staff.setAttribute('player', '#staff-audition');
  const roll = document.createElement('staff-integration-view') as ScoreViewElement;
  roll.editor = editor; roll.editable = true; roll.setAttribute('player', '#staff-audition');
  document.body.append(player, staff, roll);
  expect((await player.waitForDocumentRevision(editor.getSnapshot())).status).toBe('applied');
  const playback = player.playback;
  const staffSurface = staff.querySelector('[part="staff-input-surface"]')!;
  expect(staffSurface).not.toBeNull();
  staffSurface.dispatchEvent(new KeyboardEvent('keydown', {key: 'n', bubbles: true}));
  staffSurface.dispatchEvent(new KeyboardEvent('keydown', {key: 'g', bubbles: true}));
  expect(editor.getState().history.undoCount).toBe(1);
  expect(editor.score.notes).toHaveLength(1);
  expect(editor.score.notes[0].pitch.midi).toBe(67);
  expect(editor.score.parts[0].notes.some((note) => note.rest)).toBe(true);
  expect(roll.score).toBe(editor.score);
  expect(staff.score).toBe(editor.score);
  expect((await player.waitForDocumentRevision(editor.getSnapshot())).status).toBe('applied');
  expect(player.playback).toBe(playback);
  expect(player.resolvedScore).toBe(editor.score);

  // Changing the same document from the piano roll creates the next history item.
  roll.interactionSession!.setSelection([editor.score.notes[0].id]);
  const rollSurface = roll.querySelector('[part="editing-surface"]')!;
  rollSurface.dispatchEvent(new KeyboardEvent('keydown', {key: 'ArrowUp', bubbles: true}));
  expect(editor.score.notes[0].pitch.midi).toBe(68);
  expect(editor.getState().history.undoCount).toBe(2);
  expect((await player.waitForDocumentRevision(editor.getSnapshot())).status).toBe('applied');
  const events = new ScoreTimeline(editor.score).prepare();
  const exported = parseMIDI(serializeMIDI(editor.score).buffer as ArrayBuffer);
  expect(events).toHaveLength(1); // Authored rest completion is silent.
  expect(exported.notes).toHaveLength(1);
  expect(exported.notes[0].pitch.midi).toBe(68);
  expect(exported.notes[0].performed!.onsetSec).toBeCloseTo(events[0].start, 6);
  expect(exported.notes[0].performed!.durationSec).toBeCloseTo(events[0].end - events[0].start, 6);

  // Undo from staff also reverses the piano-roll command, then the entire entry.
  staffSurface.dispatchEvent(new KeyboardEvent('keydown', {key: 'z', ctrlKey: true, bubbles: true}));
  expect(editor.score.notes[0].pitch.midi).toBe(67);
  staffSurface.dispatchEvent(new KeyboardEvent('keydown', {key: 'z', ctrlKey: true, bubbles: true}));
  expect(editor.score).toBe(initial);
  expect((await player.waitForDocumentRevision(editor.getSnapshot())).status).toBe('applied');
  expect(player.resolvedScore).toBe(initial);
  expect(staff.score).toBe(initial);
  expect(roll.score).toBe(initial);
  expect(player.playback).toBe(playback);
});
