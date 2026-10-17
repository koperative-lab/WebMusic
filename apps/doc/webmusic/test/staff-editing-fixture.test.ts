import {readFileSync} from 'node:fs';
import {describe, expect, it} from 'vitest';
import {VoiceId} from '../../../../packages/score/src/core';
import {parseMusicXML, serializeMusicXML} from '../../../../packages/score/src/io';
import {createScoreEditor} from '../../../../packages/score/src/edit/headless';
import {createScoreViewEditing, createStaffViewEditing} from '../../../../packages/score/src/view/headless';

describe('Staff editing documentation fixture', () => {
  it('supports rest entry, a second voice and shared undo on its authored measures', () => {
    const source = readFileSync(new URL('../public/musicxml/StaffEditing.musicxml', import.meta.url), 'utf8');
    const score = parseMusicXML(source);
    expect(score.measures.map(measure => measure.durationQuarters.toFloat())).toEqual([4, 4]);
    expect(score.parts).toHaveLength(1);
    expect([...score.allNotes()].filter(note => note.rest)).toHaveLength(1);
    const editor = createScoreEditor(score);
    const editing = createScoreViewEditing(editor, {editable: true});
    const input = createStaffViewEditing(editing);
    try {
      const primaryVoiceId = input.state.voice;
      input.setCursor([4, 1]);
      expect(input.insertPitch('D').status).toBe('committed');
      expect(editor.score.notes.some(note => !note.rest && note.onsetQuarters.toFloat() === 4 && note.pitch.toString() === 'D4')).toBe(true);
      const primaryVoice = [...editor.score.allNotes()].filter(note => note.voice === primaryVoiceId);
      expect(primaryVoice.length).toBeGreaterThan(0);
      input.setVoice(VoiceId('2')); input.setCursor([4, 1]);
      expect(input.insertRest().status).toBe('committed');
      expect([...editor.score.allNotes()].filter(note => note.voice === primaryVoiceId)).toEqual(primaryVoice);
      expect([...editor.score.allNotes()].some(note => note.voice === VoiceId('2') && note.rest)).toBe(true);
      const restored = parseMusicXML(serializeMusicXML(editor.score, {ppq: 960}));
      const notation = (value: typeof score) => {
        const voices = new Map<string, number>();
        return [...value.allNotes()].map(note => {
          if (!voices.has(note.voice)) voices.set(note.voice, voices.size);
          return [note.rest ? 'rest' : note.pitch.toString(), voices.get(note.voice), note.onsetQuarters.toString(), note.duration.quarters.toString()];
        });
      };
      expect(notation(restored)).toEqual(notation(editor.score));
      expect(editor.undo().status).toBe('committed');
      expect([...editor.score.allNotes()].some(note => note.voice === VoiceId('2'))).toBe(false);
      expect(editor.undo().status).toBe('committed');
      expect(editor.score).toBe(score);
    } finally {
      input.dispose(); editing.dispose(); editor.dispose();
    }
  });

  it('exports double-dotted sixty-fourths and the smallest staff-entry cursor grid exactly', () => {
    const source = readFileSync(new URL('../public/musicxml/StaffEditing.musicxml', import.meta.url), 'utf8');
    const editor = createScoreEditor(parseMusicXML(source));
    const editing = createScoreViewEditing(editor, {editable: true});
    const input = createStaffViewEditing(editing);
    try {
      input.setCursor([257, 64]);
      input.setDuration([1, 16], 2);
      expect(input.insertPitch('D').status).toBe('committed');
      const restored = parseMusicXML(serializeMusicXML(editor.score, {ppq: 960}));
      const entered = restored.notes.find(note => note.pitch.toString() === 'D4')!;
      expect(entered.onsetQuarters.toJSON()).toEqual([257, 64]);
      expect(entered.duration.quarters.toJSON()).toEqual([7, 64]);
      expect(entered.duration.dots).toBe(2);
      const timing = (score: typeof editor.score) => [...score.allNotes()].map(note => [note.rest, note.onsetQuarters.toJSON(), note.duration.quarters.toJSON()]);
      expect(timing(restored)).toEqual(timing(editor.score));
    } finally {
      input.dispose(); editing.dispose(); editor.dispose();
    }
  });
});
