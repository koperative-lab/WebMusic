import {expect, it} from 'vitest';
import {Duration, Pitch, Rational, ScoreBuilder, VoiceId} from '../../src/core';
import {createScoreEditor} from '../../src/edit/headless';
import {parseMIDI, serializeMIDI} from '../../src/io/formats/midi';
import {ScoreTimeline} from '../../src/play/headless/score-timeline';

it('MIDI import → atomic edit → timeline/export → undo/redo uses one committed Score', () => {
  const builder = new ScoreBuilder();
  builder.addTempo({atQuarters: Rational.ZERO, bpm: 120});
  builder.addTempo({atQuarters: new Rational(2), bpm: 60});
  const part = builder.addPart({id: builder.newPartId(), name: 'Piano'});
  builder.addNote(part, {id: builder.newNoteId(), pitch: Pitch.parse('C4'),
    onsetQuarters: Rational.ZERO, duration: Duration.half(), voice: VoiceId('v')});
  const imported = parseMIDI(serializeMIDI(builder.build()).buffer as ArrayBuffer);
  const noteId = imported.notes[0].id;
  expect(imported.getNote(noteId)!.performed).toBeDefined();
  const editor = createScoreEditor(imported);
  expect(editor.transaction('Move and set velocity', (tx) => {
    tx.add({type: 'move-notes', noteIds: [noteId], deltaQuarters: [1, 1]});
    tx.add({type: 'set-velocity', noteIds: [noteId], velocity: 110});
  }).status).toBe('committed');
  const edited = editor.score;
  expect(edited.getNote(noteId)!.performed).toBeUndefined();
  const event = new ScoreTimeline(edited).prepare()[0];
  expect(event.start).toBeCloseTo(0.5, 6);
  expect(event.end).toBeCloseTo(2, 6); // q=1..3 crosses the tempo change at q=2.
  expect(event.velocity).toBe(110);
  const exported = parseMIDI(serializeMIDI(edited).buffer as ArrayBuffer).notes[0];
  expect(exported.performed!.onsetSec).toBeCloseTo(event.start, 5);
  expect(exported.performed!.durationSec).toBeCloseTo(event.end - event.start, 5);
  expect(exported.velocity).toBe(110);
  editor.undo();
  expect(editor.score).toBe(imported);
  expect(new ScoreTimeline(editor.score).prepare()[0].start).toBe(0);
  editor.redo();
  expect(editor.score).toBe(edited);
  expect(new ScoreTimeline(editor.score).prepare()[0].end).toBeCloseTo(2, 6);
  editor.dispose();
});
