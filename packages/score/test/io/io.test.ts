import {Duration, Pitch, Rational, ScoreBuilder, VoiceId, scoreNotes} from '../../src/core';
import * as TonejsMidi from '@tonejs/midi';
import {describe, expect, it} from 'vitest';
import {
  detectFormat,
  loadScore,
  loadScoreDetailed,
  loadScoreFromUrl,
  loadScoreFromUrlDetailed,
} from '../../src/io/load';
import {parseMIDI, parseMIDIDetailed, serializeMIDI} from '../../src/io/formats/midi';
import {parseMXL, parseMXLDetailed, serializeMXL} from '../../src/io/formats/mxl';
import {parseMusicXML, serializeMusicXML} from '../../src/io/formats/musicxml';

const {Midi} = ((TonejsMidi as {default?: typeof TonejsMidi}).default ?? TonejsMidi) as typeof TonejsMidi;

function sampleScore() {
  const builder = new ScoreBuilder();
  builder.setMetadata({title: 'Sample'});
  const partId = builder.newPartId();
  builder.addPart({id: partId, name: 'Piano'});
  const voice = VoiceId(`${partId}-v1`);
  const pitches = ['C4', 'E4', 'G4', 'C5'];
  pitches.forEach((name, index) => {
    builder.addNote(partId, {
      id: builder.newNoteId(),
      pitch: Pitch.parse(name),
      onsetQuarters: new Rational(index, 1),
      duration: new Duration({base: Rational.ONE}),
      voice,
    });
  });
  return builder.build();
}

describe('detectFormat', () => {
  it('detects MIDI by magic bytes', () => {
    expect(detectFormat(serializeMIDI(sampleScore()))).toBe('midi');
  });

  it('detects MXL (zip) by magic bytes', () => {
    expect(detectFormat(serializeMXL(sampleScore()))).toBe('mxl');
  });

  it('detects MusicXML from text', () => {
    expect(detectFormat(serializeMusicXML(sampleScore()))).toBe('musicxml');
  });

  it('detects ABC from text', () => {
    expect(detectFormat('X:1\nT:Tune\nK:C\nCDEF')).toBe('abc');
  });
});

describe('MIDI serialization', () => {
  it('preserves performed timing instead of silently snapping it to notation', () => {
    const base = sampleScore();
    const source = base.edit((tx) => {
      tx.updateNote(base.parts[0].notes[0].id, {
        performed: {onsetSec: 0.37, durationSec: 0.13, velocity: 101},
      });
    });

    const bytes = serializeMIDI(source);
    const restored = parseMIDI(bytes.buffer as ArrayBuffer);
    const note = restored.parts[0].notes[0];

    expect(note.performed?.onsetSec).toBeCloseTo(0.37, 2);
    expect(note.performed?.durationSec).toBeCloseTo(0.13, 2);
    expect(note.performed?.velocity).toBe(101);
  });

  it('quantises performed timing only at the requested target PPQ', () => {
    const base = sampleScore();
    const source = base.edit((tx) => {
      tx.updateNote(base.parts[0].notes[0].id, {
        // At 120 BPM this is 0.001 quarters: below the legacy 1/480-quarter
        // inverse resolution, but representable at 9,600 PPQ.
        performed: {onsetSec: 0.0005, durationSec: 0.0005, velocity: 100},
      });
    });

    const restored = parseMIDI(serializeMIDI(source, {ppq: 9_600}).buffer as ArrayBuffer);
    const note = restored.parts[0].notes[0];

    expect(note.performed?.onsetSec).toBeGreaterThan(0);
    expect(note.performed?.onsetSec).toBeCloseTo(0.0005, 4);
    expect(note.performed?.durationSec).toBeCloseTo(0.0005, 4);
  });

  it('uses the active tempo segment when projecting performed seconds', () => {
    const builder = new ScoreBuilder();
    builder.addTempo({atQuarters: Rational.ZERO, bpm: 120});
    builder.addTempo({atQuarters: new Rational(4), bpm: 60});
    const part = builder.addPart({id: builder.newPartId(), name: 'Piano'});
    builder.addNote(part, {
      id: builder.newNoteId(),
      pitch: Pitch.parse('C4'),
      onsetQuarters: Rational.ZERO,
      duration: Duration.quarter(),
      voice: VoiceId(`${part}-v1`),
    });
    const base = builder.build();
    const source = base.edit((tx) => {
      // q=4 is exactly 2 seconds; immediately after it the 60 BPM segment
      // advances one quarter per second instead of two.
      tx.updateNote(base.parts[0].notes[0].id, {
        performed: {onsetSec: 2.0005, durationSec: 0.0005, velocity: 100},
      });
    });
    const restored = parseMIDI(serializeMIDI(source, {ppq: 9_600}).buffer as ArrayBuffer);
    const note = restored.parts[0].notes[0];

    expect(note.performed?.onsetSec).toBeCloseTo(2.0005, 4);
    expect(note.performed?.durationSec).toBeCloseTo(0.0005, 4);
  });

  it('reports MIDI normalisation facts without changing the score-only parser', () => {
    const bytes = serializeMIDI(sampleScore());
    const detailed = parseMIDIDetailed(bytes.buffer as ArrayBuffer);

    expect(detailed.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({code: 'midi-measure-grid-not-reconstructed', severity: 'info', format: 'midi'}),
    ]));
    expect(parseMIDI(bytes.buffer as ArrayBuffer).notes).toHaveLength(detailed.score.notes.length);
  });

  it('uses the final same-tick MIDI tempo and meter declaration for direct parsing', () => {
    const midi = new Midi();
    midi.header.fromJSON({
      ...midi.header.toJSON(),
      ppq: 480,
      tempos: [{ticks: 0, bpm: 120}, {ticks: 0, bpm: 90}],
      timeSignatures: [
        {ticks: 0, timeSignature: [4, 4]},
        {ticks: 0, timeSignature: [3, 4]},
      ],
    });

    const detailed = parseMIDIDetailed(midi.toArray().buffer as ArrayBuffer);
    expect(detailed.score.timeMap.tempi).toHaveLength(1);
    expect(detailed.score.timeMap.tempoAt(Rational.ZERO).bpm).toBeCloseTo(90, 3);
    expect(detailed.score.timeMap.meters).toHaveLength(1);
    expect(detailed.score.timeMap.timeSignatureAt(Rational.ZERO)).toEqual({numerator: 3, denominator: 4});
    expect(detailed.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(expect.arrayContaining([
      'midi-same-tick-tempo-normalized',
      'midi-same-tick-meter-normalized',
    ]));
  });
});

describe('MusicXML is spec-compliant (child elements, not attributes)', () => {
  it('emits duration/type/pitch as child elements so external renderers (OSMD) can read them', () => {
    const xml = serializeMusicXML(sampleScore());
    expect(xml).toContain('<duration>');
    expect(xml).toContain('<type>');
    expect(xml).toContain('<step>C</step>');
    expect(xml).toContain('<octave>4</octave>');
    // The old bug emitted these as attributes, e.g. <note duration="480" ...>.
    expect(xml).not.toMatch(/<note[^>]*\sduration=/);
    expect(xml).not.toMatch(/<note[^>]*\stype=/);
    // Genuine attributes remain attributes.
    expect(xml).toMatch(/<measure number="1"/);
  });
});

describe('MusicXML multi-staff timing', () => {
  it('keeps separate staff voices on the same timeline instead of serializing them', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list>
    <score-part id="P1"><part-name>Piano</part-name></score-part>
  </part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>1</divisions>
        <time><beats>4</beats><beat-type>4</beat-type></time>
        <staves>2</staves>
        <clef number="1"><sign>G</sign><line>2</line></clef>
        <clef number="2"><sign>F</sign><line>4</line></clef>
      </attributes>
      <note>
        <pitch><step>C</step><octave>5</octave></pitch>
        <duration>4</duration>
        <voice>1</voice>
        <type>whole</type>
        <staff>1</staff>
      </note>
      <backup><duration>4</duration></backup>
      <note>
        <pitch><step>C</step><octave>3</octave></pitch>
        <duration>4</duration>
        <voice>5</voice>
        <type>whole</type>
        <staff>2</staff>
      </note>
    </measure>
  </part>
</score-partwise>`;
    const score = parseMusicXML(xml);
    const notes = scoreNotes(score).sort((a, b) => a.pitch.midi - b.pitch.midi);
    expect(notes).toHaveLength(2);
    expect(notes[0].onsetQuarters.toFloat()).toBe(0);
    expect(notes[1].onsetQuarters.toFloat()).toBe(0);
    expect(score.durationQuarters.toFloat()).toBe(4);
  });
});

describe('MXL round-trip', () => {
  it('serializes to a .mxl archive that parses back', async () => {
    const archive = serializeMXL(sampleScore());
    const score = await parseMXL(archive.buffer as ArrayBuffer);
    expect(scoreNotes(score).length).toBe(4);
  });

  it('keeps detailed MusicXML diagnostics through the MXL container boundary', async () => {
    const result = await parseMXLDetailed(serializeMXL(sampleScore()).buffer as ArrayBuffer);
    expect(result.score.notes).toHaveLength(4);
    expect(result.diagnostics).toEqual([]);
  });

  it('resolves a container full-path containing an XML-escaped ampersand', async () => {
    const archive = serializeMXL(sampleScore(), {scorePath: 'tunes & songs.musicxml'});
    const score = await parseMXL(archive.buffer as ArrayBuffer);
    expect(scoreNotes(score).length).toBe(4);
  });
});

describe('loadScore auto-detection', () => {
  it('loads a serialized MIDI buffer', async () => {
    const score = await loadScore(serializeMIDI(sampleScore()));
    expect(scoreNotes(score).length).toBe(4);
  });

  it('retains MIDI diagnostics through the detailed loader', async () => {
    const result = await loadScoreDetailed(serializeMIDI(sampleScore()), {format: 'midi'});
    expect(result.diagnostics[0]).toMatchObject({code: 'midi-measure-grid-not-reconstructed'});
  });

  it('loads a MusicXML string', async () => {
    const score = await loadScore(serializeMusicXML(sampleScore()));
    expect(scoreNotes(score).length).toBe(4);
  });

  it('retains MusicXML diagnostics in the detailed loader without changing the wrapper', async () => {
    const xml = `<score-partwise version="4.0">
      <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
      <part id="P1"><measure number="1"><attributes><divisions>1</divisions></attributes>
        <note><duration>1</duration></note>
      </measure></part>
    </score-partwise>`;
    const result = await loadScoreDetailed(xml);

    expect(result.score.notes).toEqual([]);
    expect(result.diagnostics[0]).toMatchObject({code: 'musicxml-note-without-pitch'});
    expect((await loadScore(xml)).notes).toEqual([]);
  });
});

describe('loadScoreFromUrl', () => {
  it('fetches and parses, inferring format from the extension', async () => {
    const bytes = serializeMIDI(sampleScore());
    const originalFetch = globalThis.fetch;
    let requestedUrl = '';
    globalThis.fetch = (async (url: string) => {
      requestedUrl = url;
      return {ok: true, arrayBuffer: async () => bytes.buffer as ArrayBuffer} as Response;
    }) as typeof fetch;

    try {
      const score = await loadScoreFromUrl('https://example.com/song.mid');
      expect(requestedUrl).toBe('https://example.com/song.mid');
      expect(scoreNotes(score).length).toBe(4);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('throws a helpful error on a failed response', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => ({ok: false, status: 404, statusText: 'Not Found'} as Response)) as typeof fetch;
    try {
      await expect(loadScoreFromUrl('https://example.com/missing.mid')).rejects.toThrow(/404/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('exposes diagnostics from URL loads through the detailed wrapper', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response(`
      <score-partwise version="4.0">
        <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
        <part id="P1"><measure number="1"><attributes><divisions>1</divisions></attributes>
          <note><duration>1</duration></note>
        </measure></part>
      </score-partwise>
    `)) as typeof fetch;
    try {
      const result = await loadScoreFromUrlDetailed('https://example.com/warn.musicxml');
      expect(result.diagnostics[0]).toMatchObject({format: 'musicxml'});
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
