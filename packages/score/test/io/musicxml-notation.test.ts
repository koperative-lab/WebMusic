import {readFileSync} from 'node:fs';
import {describe, expect, it} from 'vitest';
import {
  Duration, PartId, Pitch, Rational, ScoreBuilder, VoiceId, scoreFromJSON,
} from '../../src/core';
import {parseMusicXML, parseMusicXMLDetailed, serializeMusicXML} from '../../src/io';

function document(notes: string, divisions = 6): string {
  return `<score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
    <part id="P1"><measure number="1"><attributes><divisions>${divisions}</divisions>
    <time><beats>4</beats><beat-type>4</beat-type></time></attributes>${notes}</measure></part></score-partwise>`;
}

function triplet(step: string, endpoint?: 'start' | 'stop', beam = 'continue', voice = '1'): string {
  return `<note><pitch><step>${step}</step><octave>5</octave></pitch><duration>2</duration>
    <voice>${voice}</voice><type>eighth</type><time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification>
    <stem>down</stem><staff>1</staff><beam number="1">${beam}</beam>
    ${endpoint ? `<notations><tuplet type="${endpoint}" number="1" bracket="no" placement="below"/>
      <slur type="${endpoint}" number="2" placement="above"/></notations>` : ''}</note>`;
}

describe('MusicXML notation preservation', () => {
  it('keeps triplet eighths, group endpoints, beam levels, stems and slurs through XML and JSON', () => {
    const xml = document(triplet('C', 'start', 'begin') + triplet('D') + triplet('E', 'stop', 'end'));
    const original = parseMusicXML(xml);
    const serialized = serializeMusicXML(original);
    expect(serialized).toContain('<type>eighth</type>');
    expect(serialized).not.toContain('<dot');
    for (const score of [original, parseMusicXML(serialized), scoreFromJSON(original.toJSON())]) {
      const notes = score.parts[0].notes;
      expect(notes.map((note) => note.onsetQuarters.toString())).toEqual(['0', '1/3', '2/3']);
      expect(notes.map((note) => note.duration.toJSON())).toEqual(Array.from({length: 3}, () => ({base: [1, 2], dots: 0, tuplet: [3, 2]})));
      expect(new Set(notes.map((note) => note.tupletId)).size).toBe(1);
      expect(notes[0].tupletId).toBeTruthy();
      expect(notes.map((note) => note.beams)).toEqual(['begin', 'continue', 'end'].map((type) => [{number: 1, type}]));
      expect(notes.map((note) => note.stem)).toEqual(['down', 'down', 'down']);
      expect(notes[0].tupletMarks).toEqual([{type: 'start', number: 1, bracket: false, placement: 'below'}]);
      expect(notes[2].tupletMarks).toEqual([{type: 'stop', number: 1, bracket: false, placement: 'below'}]);
      expect(notes[0].slur).toEqual([{type: 'start', number: 2, placement: 'above'}]);
      expect(notes[2].slur).toEqual([{type: 'stop', number: 2, placement: 'above'}]);
    }
  });

  it('keeps hidden rests and partial secondary beams without changing the timeline', () => {
    const score = parseMusicXML(document(`
      <note print-object="no"><rest/><duration>8</duration><voice>1</voice><type>quarter</type></note>
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>3</duration><voice>1</voice>
      <type>16th</type><dot/><stem>up</stem><beam number="1">begin</beam><beam number="2">forward hook</beam></note>
      <note><pitch><step>D</step><octave>5</octave></pitch><duration>1</duration><voice>1</voice>
      <type>32nd</type><stem>up</stem><beam number="1">end</beam><beam number="2">backward hook</beam></note>`, 8));
    const again = parseMusicXML(serializeMusicXML(score));
    expect(again.parts[0].notes[0].printObject).toBe(false);
    expect(again.parts[0].notes[0].rest).toBe(true);
    expect(again.parts[0].notes.map((note) => note.onsetQuarters.toString())).toEqual(['0', '1', '11/8']);
    expect(again.parts[0].notes[1].duration.toJSON()).toEqual({base: [1, 4], dots: 1, tuplet: [1, 1]});
    expect(again.parts[0].notes[1].beams).toEqual([{number: 1, type: 'begin'}, {number: 2, type: 'forward hook'}]);
    expect(again.parts[0].notes[2].beams).toEqual([{number: 1, type: 'end'}, {number: 2, type: 'backward hook'}]);
  });

  it('pairs repeating tuplet numbers separately for each voice and group', () => {
    const score = parseMusicXML(document(
      triplet('C', 'start', 'begin') + triplet('D') + triplet('E', 'stop', 'end') +
      triplet('F', 'start', 'begin') + triplet('G') + triplet('A', 'stop', 'end') +
      '<backup><duration>12</duration></backup>' +
      triplet('C', 'start', 'begin', '2') + triplet('D', undefined, 'continue', '2') + triplet('E', 'stop', 'end', '2'),
    ));
    const firstVoice = score.parts[0].notes.filter((note) => note.voice === 'P1-1');
    const secondVoice = score.parts[0].notes.filter((note) => note.voice === 'P1-2');
    expect(new Set(firstVoice.slice(0, 3).map((note) => note.tupletId)).size).toBe(1);
    expect(new Set(firstVoice.slice(3).map((note) => note.tupletId)).size).toBe(1);
    expect(new Set(secondVoice.map((note) => note.tupletId)).size).toBe(1);
    expect(new Set([firstVoice[0].tupletId, firstVoice[3].tupletId, secondVoice[0].tupletId]).size).toBe(3);
  });

  it('retains encoded timing and diagnoses inconsistent written durations', () => {
    const {score, diagnostics} = parseMusicXMLDetailed(document(
      '<note><pitch><step>C</step><octave>5</octave></pitch><duration>6</duration><type>eighth</type></note>',
    ));
    expect(score.parts[0].notes[0].duration.quarters.eq(Rational.ONE)).toBe(true);
    expect(diagnostics).toContainEqual(expect.objectContaining({code: 'musicxml-notation-duration-mismatch'}));
  });

  it('writes endpoints for programmatically grouped tuplets', () => {
    const builder = new ScoreBuilder();
    const partId = PartId('P1');
    builder.addPart({id: partId, name: 'Piano'});
    for (let index = 0; index < 3; index += 1) builder.addNote(partId, {
      id: builder.newNoteId(), voice: VoiceId('P1-1'), pitch: Pitch.parse('C4'),
      onsetQuarters: new Rational(index, 3), duration: Duration.triplet(Duration.eighth()), tupletId: 'phrase',
    });
    const xml = serializeMusicXML(builder.build());
    expect(xml.match(/<tuplet type="start"/g)).toHaveLength(1);
    expect(xml.match(/<tuplet type="stop"/g)).toHaveLength(1);
    const notes = parseMusicXML(xml).parts[0].notes;
    expect(notes[0].tupletId).toBeTruthy();
    expect(new Set(notes.map((note) => note.tupletId)).size).toBe(1);
  });

  it('does not duplicate a slur endpoint when its note crosses a barline', () => {
    const builder = new ScoreBuilder();
    const partId = PartId('P1');
    builder.addPart({id: partId, name: 'Piano'});
    builder.addNote(partId, {
      id: builder.newNoteId(), voice: VoiceId('P1-1'), pitch: Pitch.parse('C4'),
      onsetQuarters: new Rational(3), duration: Duration.half(), slur: 'start',
    });
    builder.addNote(partId, {
      id: builder.newNoteId(), voice: VoiceId('P1-1'), pitch: Pitch.parse('D4'),
      onsetQuarters: new Rational(5), duration: Duration.quarter(), slur: 'stop',
    });
    const xml = serializeMusicXML(builder.build());
    expect(xml.match(/<slur type="start"/g)).toHaveLength(1);
    expect(xml.match(/<slur type="stop"/g)).toHaveLength(1);
    expect(parseMusicXML(xml).parts[0].notes.map((note) => note.tie)).toEqual(['start', 'stop', undefined]);
  });

  it('retains the original study notation instead of turning triplets into dotted flags', () => {
    const xml = readFileSync(new URL('../../../../apps/doc/webmusic/public/xml/demo.xml', import.meta.url), 'utf8');
    const score = parseMusicXML(xml);
    for (const value of [score, parseMusicXML(serializeMusicXML(score))]) {
      const notes = [...value.allNotes()];
      expect(notes.filter((note) => note.duration.tuplet[0] !== note.duration.tuplet[1])).toHaveLength(384);
      expect(notes.reduce((count, note) => count + (note.beams?.length ?? 0), 0)).toBe(384);
      expect(notes.reduce((count, note) => count + (note.tupletMarks?.length ?? 0), 0)).toBe(256);
      expect(notes.filter((note) => note.stem)).toHaveLength(384);
      expect(notes.reduce((count, note) => count + (Array.isArray(note.slur) ? note.slur.length : note.slur ? 1 : 0), 0)).toBe(32);
      expect(notes.filter((note) => note.onsetQuarters.lt(new Rational(4))).every((note) => note.duration.dots === 0)).toBe(true);
      expect(value.measures[0].clefs).toEqual({1: {sign: 'G', line: 2}, 2: {sign: 'G', line: 2}});
      expect(notes.find((note) => note.staff === 2 && !note.rest)?.duration.toJSON()).toEqual({base: [1, 2], dots: 0, tuplet: [3, 2]});
      expect(notes.find((note) => note.staff === 2 && !note.rest)?.slur).toEqual([{type: 'start', number: 1, placement: 'above'}]);
    }
  });
});
