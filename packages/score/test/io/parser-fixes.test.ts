import { describe, expect, it } from 'vitest';
import { Midi } from '@tonejs/midi';
import { Duration, PartId, Pitch, Rational, ScoreBuilder, VoiceId, scoreNotes, scoreTitle } from '../../src/core';
import { parseMIDI } from '../../src/io/formats/midi';
import { parseMusicXML, parseMusicXMLDetailed, serializeMusicXML } from '../../src/io/formats/musicxml';

const HEADER = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list>
    <score-part id="P1"><part-name>Piano</part-name></score-part>
  </part-list>`;

describe('MusicXML <forward> handling', () => {
  it('advances the cursor by the forward duration', () => {
    const xml = `${HEADER}
  <part id="P1">
    <measure number="1">
      <attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice></note>
      <forward><duration>2</duration></forward>
      <note><pitch><step>E</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice></note>
    </measure>
  </part>
</score-partwise>`;
    const score = parseMusicXML(xml);
    const notes = scoreNotes(score).sort((a, b) => a.onsetQuarters.cmp(b.onsetQuarters));
    expect(notes).toHaveLength(2);
    expect(notes[0].onsetQuarters.toFloat()).toBe(0);
    // 1 quarter of note + 2 quarters of <forward> = onset 3.
    expect(notes[1].onsetQuarters.toFloat()).toBe(3);
    expect(score.durationQuarters.toFloat()).toBe(4);
  });
});

describe('MusicXML grace notes', () => {
  it('gives grace notes zero duration and does not advance the cursor', () => {
    const xml = `${HEADER}
  <part id="P1">
    <measure number="1">
      <attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
      <note><grace/><pitch><step>D</step><octave>4</octave></pitch><voice>1</voice><type>eighth</type></note>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice></note>
    </measure>
    <measure number="2">
      <note><pitch><step>E</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice></note>
    </measure>
  </part>
</score-partwise>`;
    const score = parseMusicXML(xml);
    const notes = scoreNotes(score).sort(
      (a, b) => a.onsetQuarters.cmp(b.onsetQuarters) || a.duration.quarters.cmp(b.duration.quarters),
    );
    expect(notes).toHaveLength(3);
    const grace = notes.find((n) => n.pitch.step === 'D')!;
    expect(grace.duration.quarters.toFloat()).toBe(0);
    expect(grace.onsetQuarters.toFloat()).toBe(0);
    // The main note still sits at beat 1, undisturbed by the grace note.
    const main = notes.find((n) => n.pitch.step === 'C')!;
    expect(main.onsetQuarters.toFloat()).toBe(0);
    // Measure 1 stays exactly 4 quarters: the next measure's note starts at 4.
    const second = notes.find((n) => n.pitch.step === 'E')!;
    expect(second.onsetQuarters.toFloat()).toBe(4);
  });
});

describe('MusicXML <direction><sound tempo>', () => {
  it('uses the default tempo before a first direction declared at measure 3', () => {
    const measure = (num: number, extra = '') => `
    <measure number="${num}">
      ${num === 1 ? '<attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>' : ''}
      ${extra}
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice></note>
    </measure>`;
    const xml = `${HEADER}
  <part id="P1">
    ${measure(1)}
    ${measure(2)}
    ${measure(3, '<direction><sound tempo="90"/></direction>')}
  </part>
</score-partwise>`;
    const score = parseMusicXML(xml); // must not throw "First tempo must be at quarter 0"
    const tempi = score.timeMap.tempi;
    expect(tempi[0].atQuarters.toFloat()).toBe(0);
    // The found tempo applies at measure 3 (quarter 8), but cannot
    // retroactively replace the default opening tempo.
    expect(tempi.some((t) => t.atQuarters.toFloat() === 8 && t.bpm === 90)).toBe(true);
    expect(tempi[0].bpm).toBe(120);
  });

  it('reads measure-level <sound tempo> too', () => {
    const xml = `${HEADER}
  <part id="P1">
    <measure number="1">
      <attributes><divisions>1</divisions></attributes>
      <sound tempo="72"/>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice></note>
    </measure>
  </part>
</score-partwise>`;
    const score = parseMusicXML(xml);
    expect(score.timeMap.tempi[0].bpm).toBe(72);
  });
});

describe('MusicXML master measure grid', () => {
  it('aligns every part to the master starts when a local measure is short', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list>
    <score-part id="P1"><part-name>Master</part-name></score-part>
    <score-part id="P2"><part-name>Follower</part-name></score-part>
  </part-list>
  <part id="P1">
    <measure number="1"><attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration></note>
    </measure>
    <measure number="2"><note><pitch><step>D</step><octave>4</octave></pitch><duration>4</duration></note></measure>
  </part>
  <part id="P2">
    <measure number="1"><attributes><divisions>1</divisions></attributes>
      <note><pitch><step>E</step><octave>4</octave></pitch><duration>3</duration></note>
    </measure>
    <measure number="2"><note><pitch><step>F</step><octave>4</octave></pitch><duration>1</duration></note></measure>
  </part>
</score-partwise>`;

    const { score, diagnostics } = parseMusicXMLDetailed(xml);
    const follower = score.parts.find((part) => String(part.id) === 'P2')!;

    expect(follower.notes.map((note) => [note.pitch.step, note.onsetQuarters.toFloat()])).toEqual([
      ['E', 0],
      ['F', 4],
    ]);
    expect(diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'musicxml-part-measure-duration-mismatch',
          location: { partId: 'P2', measureNumber: 1 },
        }),
      ]),
    );
  });
});

describe('MusicXML unpitched notes', () => {
  it('maps <unpitched> to its display pitch instead of crashing', () => {
    const xml = `${HEADER}
  <part id="P1">
    <measure number="1">
      <attributes><divisions>1</divisions></attributes>
      <note><unpitched><display-step>E</display-step><display-octave>4</display-octave></unpitched><duration>1</duration><voice>1</voice></note>
    </measure>
  </part>
</score-partwise>`;
    const score = parseMusicXML(xml);
    const notes = scoreNotes(score);
    expect(notes).toHaveLength(1);
    expect(notes[0].pitch.step).toBe('E');
    expect(notes[0].pitch.octave).toBe(4);
    expect(notes[0].unpitched).toBe(true);
  });

  it('serializes unpitched notes as <unpitched> and preserves their display pitch', () => {
    const xml = `${HEADER}
  <part id="P1">
    <measure number="1">
      <attributes><divisions>1</divisions></attributes>
      <note><unpitched><display-step>E</display-step><display-octave>4</display-octave></unpitched><duration>1</duration><voice>1</voice></note>
    </measure>
  </part>
</score-partwise>`;

    const serialized = serializeMusicXML(parseMusicXML(xml));
    expect(serialized).toContain('<unpitched>');
    expect(serialized).toContain('<display-step>E</display-step>');
    expect(serialized).toContain('<display-octave>4</display-octave>');
    expect(serialized).not.toContain('<pitch>');

    const note = scoreNotes(parseMusicXML(serialized))[0];
    expect(note.unpitched).toBe(true);
    expect(note.pitch.step).toBe('E');
    expect(note.pitch.octave).toBe(4);
  });
});

describe('MusicXML mid-measure <attributes>', () => {
  it('handles a second <attributes> changing divisions mid-measure', () => {
    const xml = `${HEADER}
  <part id="P1">
    <measure number="1">
      <attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>2</duration><voice>1</voice></note>
      <attributes><divisions>2</divisions></attributes>
      <note><pitch><step>D</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice></note>
    </measure>
  </part>
</score-partwise>`;
    const score = parseMusicXML(xml);
    const notes = scoreNotes(score).sort((a, b) => a.onsetQuarters.cmp(b.onsetQuarters));
    expect(notes[0].duration.quarters.toFloat()).toBe(2); // 2 divs @ 1/quarter
    expect(notes[1].onsetQuarters.toFloat()).toBe(2);
    expect(notes[1].duration.quarters.toFloat()).toBe(2); // 4 divs @ 2/quarter
  });

  it('does not inject a mid-measure time change into a real Measure grid', () => {
    const xml = `${HEADER}
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>1</divisions>
        <time><beats>4</beats><beat-type>4</beat-type></time>
        <key><fifths>0</fifths></key>
        <clef><sign>G</sign><line>2</line></clef>
      </attributes>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>2</duration></note>
      <attributes>
        <time><beats>6</beats><beat-type>8</beat-type></time>
        <key><fifths>2</fifths></key>
        <clef><sign>F</sign><line>4</line></clef>
      </attributes>
      <note><pitch><step>D</step><octave>4</octave></pitch><duration>2</duration></note>
    </measure>
  </part>
</score-partwise>`;

    const { score, diagnostics } = parseMusicXMLDetailed(xml);

    expect(score.timeMap.timeSignatureAt(Rational.ZERO)).toEqual({
      numerator: 4,
      denominator: 4,
    });
    expect(score.timeMap.timeSignatureAt(new Rational(2))).toEqual({
      numerator: 4,
      denominator: 4,
    });
    const q2 = new Rational(2);
    expect(score.timeMap.mbsToQuarters(score.timeMap.quartersToMBS(q2)).eq(q2)).toBe(true);
    expect(score.measures[0].timeSignature).toEqual({
      numerator: 4,
      denominator: 4,
    });
    expect(score.measures[0].keySignature).toEqual({
      fifths: 0,
      mode: undefined,
    });
    expect(score.measures[0].clef).toEqual({ sign: 'G', line: 2 });
    expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual(
      expect.arrayContaining([
        'musicxml-mid-measure-time-ignored',
        'musicxml-mid-measure-key-ignored',
      ]),
    );
  });
});

describe('MusicXML score-timewise rejection', () => {
  it('throws a clear error instead of producing garbage', () => {
    const xml = `<?xml version="1.0"?><score-timewise version="4.0"><measure number="1"/></score-timewise>`;
    expect(() => parseMusicXML(xml)).toThrow(/score-timewise/);
  });
});

describe('MusicXML multi-voice export', () => {
  function twoVoiceScore() {
    const builder = new ScoreBuilder();
    const partId = PartId('P1');
    builder.setMetadata({ title: 'Two Voices' });
    builder.addTempo({ atQuarters: Rational.ZERO, bpm: 120 });
    builder.addMeter({
      atQuarters: Rational.ZERO,
      measureNumber: 1,
      timeSignature: { numerator: 4, denominator: 4 },
    });
    builder.addPart({ id: partId, name: 'Piano' });
    builder.addNote(partId, {
      id: builder.newNoteId(),
      pitch: Pitch.parse('C5'),
      onsetQuarters: Rational.ZERO,
      duration: Duration.whole(),
      voice: VoiceId('P1-1'),
    });
    builder.addNote(partId, {
      id: builder.newNoteId(),
      pitch: Pitch.parse('C3'),
      onsetQuarters: Rational.ZERO,
      duration: Duration.whole(),
      voice: VoiceId('P1-2'),
    });
    return builder.build();
  }

  it('emits <backup> between voices and keeps voice labels stable on round-trip', () => {
    const xml = serializeMusicXML(twoVoiceScore());
    expect(xml).toContain('<backup>');
    expect(xml).toContain('<voice>1</voice>');
    expect(xml).toContain('<voice>2</voice>');
    expect(xml).not.toContain('P1-P1'); // no voice-label inflation

    const reparsed = parseMusicXML(xml);
    const notes = scoreNotes(reparsed).sort((a, b) => a.pitch.midi - b.pitch.midi);
    expect(notes).toHaveLength(2);
    expect(notes[0].onsetQuarters.toFloat()).toBe(0); // both voices share the downbeat
    expect(notes[1].onsetQuarters.toFloat()).toBe(0);
    expect([...new Set(notes.map((n) => String(n.voice)))].sort()).toEqual(['P1-1', 'P1-2']);

    // Second round-trip stays stable (no further label growth).
    const xml2 = serializeMusicXML(reparsed);
    expect(xml2).not.toContain('P1-P1');
  });
});

describe('parseMIDI duplicate track names', () => {
  it('keeps notes from two tracks both named "Piano"', () => {
    const midi = new Midi();
    const a = midi.addTrack();
    a.name = 'Piano';
    a.addNote({ midi: 60, ticks: 0, durationTicks: 480, velocity: 0.8 });
    const b = midi.addTrack();
    b.name = 'Piano';
    b.addNote({ midi: 64, ticks: 0, durationTicks: 480, velocity: 0.8 });

    const score = parseMIDI(midi.toArray().buffer as ArrayBuffer);
    expect(score.parts).toHaveLength(2);
    expect(new Set(score.parts.map((p) => String(p.id))).size).toBe(2);
    expect(scoreNotes(score)).toHaveLength(2);
  });
});

describe('parseMIDI late first tempo/meter', () => {
  it('uses SMF defaults before late q1/q4 events and keeps performed timing congruent', () => {
    const midi = new Midi();
    const { ppq } = midi.header;
    midi.header.tempos.push({ ticks: ppq, bpm: 90 }, { ticks: ppq * 4, bpm: 60 });
    midi.header.timeSignatures.push({ ticks: ppq, timeSignature: [3, 4] }, { ticks: ppq * 4, timeSignature: [5, 4] });
    const track = midi.addTrack();
    // q1 is reached under SMF's implicit 120 BPM; q4 is reached after the
    // q1 90 BPM change. Their imported performed clock must agree with the
    // Score TimeMap used for notation-derived playback.
    track.addNote({ midi: 60, ticks: ppq, durationTicks: ppq, velocity: 0.8 });
    track.addNote({
      midi: 64,
      ticks: ppq * 4,
      durationTicks: ppq,
      velocity: 0.8,
    });

    const score = parseMIDI(midi.toArray().buffer as ArrayBuffer);
    expect(score.timeMap.tempi.map((tempo) => tempo.atQuarters.toFloat())).toEqual([0, 1, 4]);
    expect(score.timeMap.tempi[0].bpm).toBe(120);
    expect(score.timeMap.tempi[1].bpm).toBeCloseTo(90, 3);
    expect(score.timeMap.tempi[2].bpm).toBeCloseTo(60, 3);
    expect(
      score.timeMap.meters.map((meter) => [
        meter.atQuarters.toFloat(),
        meter.measureNumber,
        meter.timeSignature.numerator,
        meter.timeSignature.denominator,
      ]),
    ).toEqual([
      [0, 1, 4, 4],
      [1, 2, 3, 4],
      [4, 3, 5, 4],
    ]);
    expect(new Set(score.timeMap.meters.map((meter) => meter.measureNumber)).size).toBe(score.timeMap.meters.length);

    const notes = scoreNotes(score).sort((a, b) => a.onsetQuarters.cmp(b.onsetQuarters));
    for (const note of notes) {
      expect(note.performed?.onsetSec).toBeCloseTo(score.timeMap.quartersToSeconds(note.onsetQuarters), 6);
      expect(note.performed?.durationSec).toBeCloseTo(
        score.timeMap.quartersToSeconds(note.offsetQuarters) - score.timeMap.quartersToSeconds(note.onsetQuarters),
        6,
      );
    }
    expect(notes[0].performed?.onsetSec).toBeCloseTo(0.5, 6);
    expect(notes[1].performed?.onsetSec).toBeCloseTo(2.5, 4);
  });

  it('uses the ceiling of consumed prior measures for a mid-bar meter label', () => {
    const midi = new Midi();
    const {ppq} = midi.header;
    midi.header.timeSignatures.push({ticks: ppq * 6, timeSignature: [3, 4]});
    midi.addTrack().addNote({midi: 60, ticks: ppq * 6, durationTicks: ppq, velocity: 0.8});

    const score = parseMIDI(midi.toArray().buffer as ArrayBuffer);

    // q6 consumes one full 4/4 bar plus a partial second bar. Both consume
    // display labels, so the new 3/4 segment begins at synthetic measure 3.
    expect(score.timeMap.meters.map((meter) => [
      meter.atQuarters.toFloat(),
      meter.measureNumber,
      meter.timeSignature.numerator,
      meter.timeSignature.denominator,
    ])).toEqual([
      [0, 1, 4, 4],
      [6, 3, 3, 4],
    ]);
  });
});

describe('MusicXML entity handling', () => {
  const entityXml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <movement-title>Crosby, Stills &amp; Nash</movement-title>
  <part-list>
    <score-part id="P1"><part-name>Piano</part-name></score-part>
  </part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice></note>
    </measure>
  </part>
</score-partwise>`;

  it('decodes the predefined XML entities in parsed text', () => {
    expect(scoreTitle(parseMusicXML(entityXml))).toBe('Crosby, Stills & Nash');
  });

  it('decodes numeric character references (decimal and hex)', () => {
    const xml = entityXml.replace('Crosby, Stills &amp; Nash', 'Music&#9835;&#x21;');
    expect(scoreTitle(parseMusicXML(xml))).toBe('Music\u266b!');
  });

  it('round-trips an ampersand title byte-stable through parse and serialize', () => {
    const first = serializeMusicXML(parseMusicXML(entityXml));
    expect(first).toContain('Crosby, Stills &amp; Nash');
    expect(first).not.toContain('&amp;amp;');

    const reparsed = parseMusicXML(first);
    expect(scoreTitle(reparsed)).toBe('Crosby, Stills & Nash');
    expect(serializeMusicXML(reparsed)).toBe(first);
  });

  it('does not expand custom DTD-declared entities', () => {
    const xml = entityXml
      .replace(
        '<score-partwise',
        '<!DOCTYPE score-partwise [<!ENTITY xxe "EXPANDED">]>\n<score-partwise',
      )
      .replace('Crosby, Stills &amp; Nash', '&xxe;&lol9;');
    expect(scoreTitle(parseMusicXML(xml))).toBe('&xxe;&lol9;');
  });
});

describe('control characters in names', () => {
  // SMF text meta events are routinely NUL-padded. A "Piano\0" track name used to
  // reach MusicXML verbatim as <score-part id="Piano&#0;">, and NUL cannot be
  // escaped in XML 1.0 — readers rejected the whole document rather than that one
  // attribute, which is what broke OSMD engraving of any MIDI-sourced score.
  const NUL = '\u0000';
  const hasForbiddenXmlCharacter = (value: string): boolean => Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return code <= 0x1F && code !== 0x09 && code !== 0x0A && code !== 0x0D;
  });

  function midiNamed(name: string): ArrayBuffer {
    const midi = new Midi();
    const track = midi.addTrack();
    track.name = name;
    track.addNote({ midi: 60, ticks: 0, durationTicks: 480, velocity: 0.8 });
    return midi.toArray().buffer as ArrayBuffer;
  }

  function singleNotePart(name: string, id = 'P1'): ReturnType<ScoreBuilder['build']> {
    const builder = new ScoreBuilder();
    const partId = PartId(id);
    builder.addTempo({ atQuarters: Rational.ZERO, bpm: 120 });
    builder.addMeter({
      atQuarters: Rational.ZERO,
      measureNumber: 1,
      timeSignature: { numerator: 4, denominator: 4 },
    });
    builder.addPart({ id: partId, name });
    builder.addNote(partId, {
      id: builder.newNoteId(),
      pitch: Pitch.parse('C4'),
      onsetQuarters: Rational.ZERO,
      duration: Duration.whole(),
      voice: VoiceId(`${id}-1`),
    });
    return builder.build();
  }

  it('strips NUL padding from an imported MIDI track name and part id', () => {
    const score = parseMIDI(midiNamed(`Piano${NUL}`));
    expect(score.parts[0].name).toBe('Piano');
    expect(String(score.parts[0].id)).toBe('Piano');
  });

  it('keeps non-ASCII track names intact', () => {
    expect(parseMIDI(midiNamed(`Flute \u00a9${NUL}`)).parts[0].name)
      .toBe('Flute \u00a9');
  });

  it('falls back to the positional name when a track name is only control bytes', () => {
    expect(parseMIDI(midiNamed(`${NUL}${NUL}`)).parts[0].name).toBe('Track 1');
  });

  it('serializes a NUL-bearing MIDI import to parseable MusicXML', () => {
    const xml = serializeMusicXML(parseMIDI(midiNamed(`Piano${NUL}`)));
    expect(hasForbiddenXmlCharacter(xml)).toBe(false);
    expect(parseMusicXML(xml).parts[0].name).toBe('Piano');
  });

  it('scrubs forbidden characters a Score carries even without a MIDI import', () => {
    // Built in code, so the MIDI import sanitiser never sees it: the serializer
    // itself has to guarantee a well-formed document.
    const xml = serializeMusicXML(singleNotePart(`Piano${NUL}`, `P1${NUL}`));
    expect(hasForbiddenXmlCharacter(xml)).toBe(false);
    expect(xml).toContain('<part-name>Piano</part-name>');
    expect(() => parseMusicXML(xml)).not.toThrow();
  });

  it('leaves tab, newline and carriage return alone — they are legal XML', () => {
    expect(serializeMusicXML(singleNotePart('Grand\tPiano'))).toContain('Grand\tPiano');
  });
});
