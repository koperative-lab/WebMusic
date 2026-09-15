import {Duration, Pitch, Rational, ScoreBuilder, VoiceId} from '../../src/core';
import {describe, expect, it} from 'vitest';
import {
  MIDIParseLimitError,
  MusicXMLParseLimitError,
  parseMIDI,
  parseMusicXML,
  serializeMIDI,
  serializeMusicXML,
} from '../../src/io';

function sampleScore() {
  const builder = new ScoreBuilder();
  const partId = builder.newPartId();
  builder.addPart({id: partId, name: 'Piano'});
  builder.addNote(partId, {
    id: builder.newNoteId(),
    pitch: Pitch.parse('C4'),
    onsetQuarters: Rational.ZERO,
    duration: new Duration({base: Rational.ONE}),
    voice: VoiceId(`${partId}-v1`),
  });
  return builder.build();
}

describe('structured score parser limits', () => {
  it('rejects MusicXML element bombs before constructing the ordered tree', () => {
    const xml = serializeMusicXML(sampleScore());
    expect(() => parseMusicXML(xml, {maxElements: 3})).toThrow(MusicXMLParseLimitError);
    expect(() => parseMusicXML(xml, {maxElements: 3})).toThrow(/resource limit.*elements/i);
  });

  it('does not count XML comments, declarations or CDATA as elements', () => {
    const xml = `<?xml version="1.0"?><!-- <fake/> --><score-partwise><movement-title><![CDATA[<not-a-tag>]]></movement-title></score-partwise>`;
    expect(() => parseMusicXML(xml, {maxElements: 2})).not.toThrow();
  });

  it('bounds direct MusicXML input by UTF-8 bytes before parsing', () => {
    const multibyteXml = '<score-partwise title="\u{1f3b5}"/>';
    expect(new TextEncoder().encode(multibyteXml).byteLength).toBeGreaterThan(multibyteXml.length);
    expect(() => parseMusicXML(multibyteXml, {maxInputBytes: multibyteXml.length}))
      .toThrow(MusicXMLParseLimitError);
    expect(() => parseMusicXML('<score-partwise/>', {maxInputBytes: 0})).toThrow(RangeError);
  });

  it('rejects MIDI event bombs before @tonejs/midi constructs tracks and notes', () => {
    const midi = serializeMIDI(sampleScore());
    const buffer = midi.buffer.slice(midi.byteOffset, midi.byteOffset + midi.byteLength) as ArrayBuffer;
    expect(() => parseMIDI(buffer, {maxEvents: 1})).toThrow(MIDIParseLimitError);
    expect(() => parseMIDI(buffer, {maxEvents: 1})).toThrow(/resource limit.*events/i);
  });

  it('bounds direct MIDI input before constructing the parser object graph', () => {
    const midi = serializeMIDI(sampleScore());
    const buffer = midi.buffer.slice(midi.byteOffset, midi.byteOffset + midi.byteLength) as ArrayBuffer;
    expect(() => parseMIDI(buffer, {maxInputBytes: buffer.byteLength - 1})).toThrow(MIDIParseLimitError);
  });

  it('validates custom structure limits', () => {
    expect(() => parseMusicXML('<score-partwise/>', {maxElements: 0})).toThrow(RangeError);
    expect(() => parseMIDI(new ArrayBuffer(0), {maxTracks: 0})).toThrow(RangeError);
  });
});
