import {describe, expect, it} from 'vitest';
import * as TonejsMidi from '@tonejs/midi';
import {XMLParser} from 'fast-xml-parser';
import {Duration, Pitch, Rational, ScoreBuilder, type NoteData} from '../../src/core';
import {loadScoreDetailed, parseABC, parseMIDI, parseMXL, serializeABC, serializeMIDI, serializeMusicXML, serializeMXL, type ScoreFormat} from '../../src/io';

const {Midi} = ((TonejsMidi as {default?: typeof TonejsMidi}).default ?? TonejsMidi) as typeof TonejsMidi;

function makeScore(notes: Array<{pitch: string; at: number; length: number; tie?: NoteData['tie']; chord?: boolean}>, transpose = 0, tempoUnit = 1) {
  const b = new ScoreBuilder();
  const part = b.addPart({id: b.newPartId(), name: 'Clarinet', transpose: {chromatic: transpose}});
  const voice = b.newVoiceId();
  b.addTempo({atQuarters: Rational.ZERO, bpm: 60, unit: tempoUnit});
  b.addMeasure({id: b.newMeasureId(), number: 1, onsetQuarters: Rational.ZERO, durationQuarters: new Rational(4)});
  for (const note of notes) b.addNote(part, {
    id: b.newNoteId(), voice, pitch: Pitch.parse(note.pitch), onsetQuarters: new Rational(note.at * 2, 2),
    duration: new Duration({base: new Rational(note.length * 2, 2)}), tie: note.tie, chord: note.chord, staff: 1,
  });
  return b.build();
}

describe('MIDI independent performance expectations', () => {
  it('writes a quarter-note tempo event for a half-note metronome marking', () => {
    const bytes = serializeMIDI(makeScore([{pitch: 'C4', at: 0, length: 1}], 0, 2));
    const marker = bytes.findIndex((byte, index) => byte === 0xff && bytes[index + 1] === 0x51 && bytes[index + 2] === 3);
    expect(marker).toBeGreaterThan(0);
    // Half=60 means quarter=120, i.e. 500,000 microseconds per SMF quarter.
    expect(bytes[marker + 3] * 65536 + bytes[marker + 4] * 256 + bytes[marker + 5]).toBe(500_000);
  });

  it('exports written D4 with transpose -2 as one sustained C4 attack across a tie', () => {
    const source = makeScore([
      {pitch: 'D4', at: 0, length: 1, tie: 'start'},
      {pitch: 'D4', at: 1, length: 1, tie: 'stop'},
    ], -2);
    const track = new Midi(serializeMIDI(source)).tracks[0];
    expect(track.notes.map((note) => [note.midi, note.ticks, note.durationTicks])).toEqual([[60, 0, 960]]);
    expect(source.notes.map((note) => note.pitch.midi)).toEqual([62, 62]);
  });

  it.each([0, -1, 1.5, 32768, NaN, Infinity])('rejects unrepresentable SMF PPQ %s', (ppq) => {
    expect(() => serializeMIDI(makeScore([{pitch: 'C4', at: 0, length: 1}]), {ppq})).toThrow(/PPQ/i);
  });

  it('rejects SMPTE timing rather than silently interpreting its ticks as quarters', () => {
    // SMF type 0, -25 fps, 40 ticks/frame: the note lasts 1,000 ticks = 1 second.
    const bytes = Uint8Array.from([
      77, 84, 104, 100, 0, 0, 0, 6, 0, 0, 0, 1, 0xe7, 40,
      77, 84, 114, 107, 0, 0, 0, 13,
      0, 0x90, 60, 100, 0x87, 0x68, 0x80, 60, 0, 0, 0xff, 0x2f, 0,
    ]);
    expect(() => parseMIDI(bytes.buffer)).toThrow(/SMPTE/);
  });

  it('rejects type 2 sequences rather than merging independent tracks into one timeline', () => {
    const bytes = serializeMIDI(makeScore([{pitch: 'C4', at: 0, length: 1}]));
    bytes[9] = 2;
    expect(() => parseMIDI(bytes.buffer as ArrayBuffer)).toThrow(/format 2/);
  });

  it('retains untied concert-pitch attacks and accepts the largest quarter PPQ', () => {
    const bytes = serializeMIDI(makeScore([
      {pitch: 'C4', at: 0, length: 1}, {pitch: 'C4', at: 1, length: 1},
    ]), {ppq: 32767});
    const result = new Midi(bytes);
    expect(result.header.ppq).toBe(32767);
    expect(result.tracks[0].notes.map((note) => [note.midi, note.ticks])).toEqual([[60, 0], [60, 32767]]);
  });

  it.each([['G#9', 0], ['C0', -24]] as const)('rejects sounding pitches outside MIDI data bytes: %s / %s', (pitch, transpose) => {
    expect(() => serializeMIDI(makeScore([{pitch, at: 0, length: 1}], transpose))).toThrow(/MIDI sounding pitch/);
  });
});

describe('MusicXML external document-order expectations', () => {
  it('preserves simultaneous and partially overlapping onsets without requiring chord metadata', () => {
    const source = makeScore([
      {pitch: 'C4', at: 0, length: 2}, {pitch: 'E4', at: 0, length: 1},
      {pitch: 'G4', at: 1.5, length: 0.5},
    ]);
    const document = new XMLParser({preserveOrder: true, ignoreAttributes: false}).parse(serializeMusicXML(source));
    const root = document.find((node: Record<string, unknown>) => node['score-partwise'])['score-partwise'];
    const measure = root.find((node: Record<string, unknown>) => node.part).part[0].measure;
    let cursor = 0;
    let previousOnset = 0;
    const positions: number[] = [];
    // Independent SMF-free MusicXML cursor interpreter: duration advances,
    // backup subtracts, forward adds, chord reuses the preceding note onset.
    for (const node of measure) {
      const tag = Object.keys(node)[0];
      const children = node[tag];
      if (!['note', 'backup', 'forward'].includes(tag)) continue;
      const duration = children.find((child: Record<string, unknown>) => child.duration)?.duration[0]['#text'] ?? 0;
      if (tag === 'backup') cursor -= duration;
      else if (tag === 'forward') cursor += duration;
      else if (children.some((child: Record<string, unknown>) => child.chord)) positions.push(previousOnset);
      else { positions.push(cursor); previousOnset = cursor; cursor += duration; }
    }
    expect(positions).toEqual([0, 0, 720]);
    expect(cursor).toBe(1920);
  });

  it('places visual tie notations after voice/type/staff as required by the MusicXML note sequence', () => {
    const xml = serializeMusicXML(makeScore([{pitch: 'C4', at: 0, length: 1, tie: 'start'}]));
    const note = xml.slice(xml.indexOf('<note>'), xml.indexOf('</note>'));
    expect(note.indexOf('<tie ')).toBeLessThan(note.indexOf('<voice>'));
    expect(note.indexOf('<notations>')).toBeGreaterThan(note.indexOf('<staff>'));
  });
});

describe('ABC independent notation expectations', () => {
  it.each([['4/4', 0.5], ['3/4', 0.5], ['2/4', 0.25]])('derives omitted L from meter %s', (meter, quarters) => {
    const score = parseABC(`X:1\nM:${meter}\nK:C\nC D`);
    expect(score.notes.map((note) => note.duration.quarters.toFloat())).toEqual([quarters, quarters]);
  });

  it('propagates explicit accidentals through a bar and cancels them at the barline or natural', () => {
    const score = parseABC('X:1\nM:4/4\nL:1/4\nK:C\n^F F =F F | F');
    expect(score.notes.map((note) => note.pitch.midi)).toEqual([66, 66, 65, 65, 65]);
  });

  it('writes an explicit natural so an external ABC reader does not inherit the previous sharp', () => {
    const abc = serializeABC(makeScore([{pitch: 'F#4', at: 0, length: 1}, {pitch: 'F4', at: 1, length: 1}]));
    expect(abc.split('\n').pop()).toBe('^F =F');
  });

  it('retains explicit L and resets pitch-wide accidentals at a thick barline', () => {
    const score = parseABC('X:1\nM:4/4\nL:1/4\nK:C\n^F f [| F f |]');
    expect(score.notes.map((note) => [note.pitch.midi, note.onsetQuarters.toFloat()])).toEqual([
      [66, 0], [78, 1], [65, 2], [77, 3],
    ]);
  });
});

describe('MXL archive output path', () => {
  it.each(['', 'META-INF/container.xml'])('rejects a score path that destroys archive discoverability: %s', (scorePath) => {
    expect(() => serializeMXL(makeScore([{pitch: 'C4', at: 0, length: 1}]), {scorePath})).toThrow(/scorePath/);
  });

  it('preserves a caller-selected nested score path', async () => {
    const bytes = serializeMXL(makeScore([{pitch: 'C4', at: 0, length: 1}]), {scorePath: 'scores/main.musicxml'});
    expect((await parseMXL(bytes.buffer as ArrayBuffer)).notes[0].pitch.midi).toBe(60);
  });
});

describe('load format validation', () => {
  it('rejects an unsupported JavaScript format hint instead of fulfilling with undefined', async () => {
    await expect(loadScoreDetailed('X:1\nK:C\nC', {format: 'json' as ScoreFormat})).rejects.toThrow(/Unsupported score format/);
  });
});
