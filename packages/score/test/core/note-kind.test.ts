import {describe, expect, it} from 'vitest';
import {
  Duration,
  PartId,
  Pitch,
  Rational,
  ScoreBuilder,
  VoiceId,
  isPitchedNote,
  isSoundingNote,
} from '../../src/core';

describe('note-kind predicates', () => {
  it('keeps unpitched display notes visible while excluding them from tonal analysis', () => {
    const builder = new ScoreBuilder();
    const partId = PartId('p');
    builder.addPart({id: partId, name: 'Test'});
    const voice = VoiceId('v');
    builder.addNote(partId, {
      id: builder.newNoteId(),
      rest: true,
      onsetQuarters: Rational.ZERO,
      duration: Duration.quarter(),
      voice,
    });
    builder.addNote(partId, {
      id: builder.newNoteId(),
      pitch: Pitch.parse('C4'),
      unpitched: true,
      onsetQuarters: Rational.ONE,
      duration: Duration.quarter(),
      voice,
    });
    builder.addNote(partId, {
      id: builder.newNoteId(),
      pitch: Pitch.parse('D4'),
      onsetQuarters: new Rational(2),
      duration: Duration.quarter(),
      voice,
    });
    const notes = [...builder.build().allNotes()];

    expect(notes.filter(isSoundingNote)).toHaveLength(2);
    expect(notes.filter(isPitchedNote)).toHaveLength(1);
    expect(notes.filter(isPitchedNote)[0].pitch.toString()).toBe('D4');
  });
});
