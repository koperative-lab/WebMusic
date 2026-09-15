import {describe, expect, it} from 'vitest';
import {
  Duration,
  MeasureId,
  PartId,
  Pitch,
  Rational,
  ScoreBuilder,
  VoiceId,
  mergedTiedNotes,
} from '../../src/core';
import {parseMusicXML, serializeMusicXML} from '../../src/io';

/** Wrap measure content in a minimal single-part score-partwise document. */
function doc(measures: string, partExtras = ''): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list>
    <score-part id="P1"><part-name>Test</part-name>${partExtras}</score-part>
  </part-list>
  <part id="P1">${measures}</part>
</score-partwise>`;
}

describe('MusicXML clef support', () => {
  const xml = doc(`
    <measure number="1">
      <attributes>
        <divisions>1</divisions>
        <time><beats>4</beats><beat-type>4</beat-type></time>
        <clef><sign>F</sign><line>4</line><clef-octave-change>-1</clef-octave-change></clef>
      </attributes>
      <note><pitch><step>C</step><octave>3</octave></pitch><duration>4</duration><type>whole</type></note>
    </measure>`);

  it('parses <attributes><clef> onto the measure', () => {
    const score = parseMusicXML(xml);
    expect(score.measures[0].clef).toEqual({sign: 'F', line: 4, octaveChange: -1});
  });

  it('survives a parse → serialize → parse round-trip', () => {
    const once = parseMusicXML(xml);
    const twice = parseMusicXML(serializeMusicXML(once));
    expect(twice.measures[0].clef).toEqual({sign: 'F', line: 4, octaveChange: -1});
  });

  it('keeps per-staff clefs for multi-staff parts', () => {
    const pianoXml = doc(`
      <measure number="1">
        <attributes>
          <divisions>1</divisions>
          <time><beats>4</beats><beat-type>4</beat-type></time>
          <staves>2</staves>
          <clef number="1"><sign>G</sign><line>2</line></clef>
          <clef number="2"><sign>F</sign><line>4</line></clef>
        </attributes>
        <note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><staff>1</staff></note>
        <backup><duration>4</duration></backup>
        <note><pitch><step>C</step><octave>2</octave></pitch><duration>4</duration><staff>2</staff></note>
      </measure>`);
    const score = parseMusicXML(pianoXml);
    expect(score.measures[0].clefs).toEqual({1: {sign: 'G', line: 2}, 2: {sign: 'F', line: 4}});
    const again = parseMusicXML(serializeMusicXML(score));
    expect(again.measures[0].clefs).toEqual({1: {sign: 'G', line: 2}, 2: {sign: 'F', line: 4}});
  });
});

describe('MusicXML rest support', () => {
  const xml = doc(`
    <measure number="1">
      <attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
      <note><rest/><duration>2</duration><type>half</type></note>
      <note><pitch><step>D</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
    </measure>`);

  it('emits rest notes with onset/duration and no pitch', () => {
    const score = parseMusicXML(xml);
    const all = [...score.allNotes()];
    expect(all).toHaveLength(3);
    const rest = all.find((n) => n.rest)!;
    expect(rest.pitch).toBeUndefined();
    expect(rest.onsetQuarters.toFloat()).toBe(1);
    expect(rest.duration.quarters.toFloat()).toBe(2);
    // The flattened sounding view excludes rests; the D4 onset stays at 3.
    expect(score.notes).toHaveLength(2);
    expect(score.notes[1].onsetQuarters.toFloat()).toBe(3);
  });

  it('serializes <rest/> back and survives a round-trip', () => {
    const once = parseMusicXML(xml);
    const xml2 = serializeMusicXML(once);
    expect(xml2).toContain('<rest');
    const twice = parseMusicXML(xml2);
    const rest = [...twice.allNotes()].find((n) => n.rest)!;
    expect(rest.duration.quarters.toFloat()).toBe(2);
    expect(rest.onsetQuarters.toFloat()).toBe(1);
    // The note *after* the rest keeps its position.
    expect(twice.notes[1].onsetQuarters.toFloat()).toBe(3);
  });
});

describe('MusicXML grace-note support', () => {
  const xml = doc(`
    <measure number="1">
      <attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
      <note><grace slash="yes"/><pitch><step>B</step><octave>3</octave></pitch><type>eighth</type></note>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note>
    </measure>`);

  it('sets the grace flag (with slash) and zero duration without advancing the cursor', () => {
    const score = parseMusicXML(xml);
    const grace = score.notes.find((n) => n.grace)!;
    expect(grace.grace).toEqual({slash: true});
    expect(grace.duration.quarters.toFloat()).toBe(0);
    const principal = score.notes.find((n) => !n.grace)!;
    expect(principal.onsetQuarters.toFloat()).toBe(0); // grace stole no time
  });

  it('serializes <grace/> without <duration> and survives a round-trip', () => {
    const once = parseMusicXML(xml);
    const xml2 = serializeMusicXML(once);
    expect(xml2).toMatch(/<grace[^>]*slash="yes"/);
    const twice = parseMusicXML(xml2);
    const grace = twice.notes.find((n) => n.grace)!;
    expect(grace.grace).toEqual({slash: true});
    expect(grace.duration.quarters.toFloat()).toBe(0);
    expect(twice.notes.find((n) => !n.grace)!.onsetQuarters.toFloat()).toBe(0);
    // The measure is still exactly 4 quarters long.
    expect(twice.measures[0].durationQuarters.toFloat()).toBe(4);
  });
});

describe('MusicXML transposing instruments', () => {
  const xml = doc(`
    <measure number="1">
      <attributes>
        <divisions>1</divisions>
        <time><beats>4</beats><beat-type>4</beat-type></time>
        <transpose><diatonic>-1</diatonic><chromatic>-2</chromatic></transpose>
      </attributes>
      <note><pitch><step>D</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note>
    </measure>`);

  it('parses <attributes><transpose> onto the part', () => {
    const score = parseMusicXML(xml);
    expect(score.parts[0].transpose).toEqual({chromatic: -2, diatonic: -1});
  });

  it('survives a parse → serialize → parse round-trip (incl. octave-change)', () => {
    const once = parseMusicXML(xml);
    const twice = parseMusicXML(serializeMusicXML(once));
    expect(twice.parts[0].transpose).toEqual({chromatic: -2, diatonic: -1});

    const piccolo = doc(`
      <measure number="1">
        <attributes>
          <divisions>1</divisions>
          <time><beats>4</beats><beat-type>4</beat-type></time>
          <transpose><chromatic>0</chromatic><octave-change>1</octave-change></transpose>
        </attributes>
        <note><pitch><step>C</step><octave>5</octave></pitch><duration>4</duration></note>
      </measure>`);
    const back = parseMusicXML(serializeMusicXML(parseMusicXML(piccolo)));
    expect(back.parts[0].transpose).toEqual({chromatic: 0, octaveChange: 1});
  });
});

describe('MusicXML timeline-preserving serialization', () => {
  it('preserves later tempo, key and meter changes at measure boundaries', () => {
    const builder = new ScoreBuilder();
    const part = PartId('p');
    const voice = VoiceId('v');
    builder.addPart({id: part, name: 'Piano'});
    builder.addTempo({atQuarters: Rational.ZERO, bpm: 120});
    builder.addTempo({atQuarters: new Rational(2), bpm: 90});
    builder.addTempo({atQuarters: new Rational(4), bpm: 60});
    builder.addMeter({
      atQuarters: Rational.ZERO,
      measureNumber: 1,
      timeSignature: {numerator: 4, denominator: 4},
    });
    builder.addMeter({
      atQuarters: new Rational(4),
      measureNumber: 2,
      timeSignature: {numerator: 3, denominator: 4},
    });
    builder.addMeasure({
      id: MeasureId('m1'),
      number: 1,
      onsetQuarters: Rational.ZERO,
      durationQuarters: new Rational(4),
      timeSignature: {numerator: 4, denominator: 4},
      keySignature: {fifths: 0},
    });
    builder.addMeasure({
      id: MeasureId('m2'),
      number: 2,
      onsetQuarters: new Rational(4),
      durationQuarters: new Rational(3),
      timeSignature: {numerator: 3, denominator: 4},
      keySignature: {fifths: -1},
    });
    builder.addNote(part, {
      id: builder.newNoteId(),
      pitch: Pitch.parse('C4'),
      onsetQuarters: Rational.ZERO,
      duration: Duration.quarter(),
      voice,
    });
    const restored = parseMusicXML(serializeMusicXML(builder.build()));

    expect(restored.timeMap.tempoAt(new Rational(2)).bpm).toBe(90);
    expect(restored.timeMap.tempoAt(new Rational(4)).bpm).toBe(60);
    expect(restored.timeMap.timeSignatureAt(new Rational(4))).toEqual({numerator: 3, denominator: 4});
    expect(restored.measures[1].keySignature).toEqual({fifths: -1, mode: undefined});
    expect(restored.measures[1].durationQuarters.eq(new Rational(3))).toBe(true);
  });

  it('splits a note across measures into a connected tie chain', () => {
    const builder = new ScoreBuilder();
    const part = PartId('p');
    const voice = VoiceId('v');
    builder.addPart({id: part, name: 'Piano'});
    for (const number of [1, 2]) {
      builder.addMeasure({
        id: MeasureId(`m${number}`),
        number,
        onsetQuarters: new Rational((number - 1) * 4),
        durationQuarters: new Rational(4),
      });
    }
    builder.addNote(part, {
      id: builder.newNoteId(),
      pitch: Pitch.parse('C4'),
      onsetQuarters: new Rational(3),
      duration: new Duration({base: new Rational(2)}),
      voice,
    });
    const restored = parseMusicXML(serializeMusicXML(builder.build()));
    const notes = restored.parts[0].notes;

    expect(notes).toHaveLength(2);
    expect(notes.map((note) => note.tie)).toEqual(['start', 'stop']);
    expect(notes.map((note) => note.duration.quarters.toString())).toEqual(['1', '1']);
    const merged = mergedTiedNotes(restored.parts[0]);
    expect(merged).toHaveLength(1);
    expect(merged[0].durationQuarters.eq(new Rational(2))).toBe(true);
  });

  it('writes a continuing tie as both a stop and a start', () => {
    const builder = new ScoreBuilder();
    const part = PartId('p');
    const voice = VoiceId('v');
    builder.addPart({id: part, name: 'Piano'});
    builder.addMeasure({id: MeasureId('m1'), number: 1, onsetQuarters: Rational.ZERO, durationQuarters: new Rational(3)});
    for (const [index, tie] of ['start', 'continue', 'stop'].entries()) {
      builder.addNote(part, {
        id: builder.newNoteId(),
        pitch: Pitch.parse('C4'),
        onsetQuarters: new Rational(index),
        duration: Duration.quarter(),
        voice,
        tie: tie as 'start' | 'continue' | 'stop',
      });
    }
    const restored = parseMusicXML(serializeMusicXML(builder.build()));

    expect(restored.parts[0].notes.map((note) => note.tie)).toEqual(['start', 'continue', 'stop']);
    expect(mergedTiedNotes(restored.parts[0])[0].durationQuarters.eq(new Rational(3))).toBe(true);
  });
});
