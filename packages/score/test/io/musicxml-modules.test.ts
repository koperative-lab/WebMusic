import {describe, expect, it} from 'vitest';
import {
  parseMusicXML as facadeParseMusicXML,
  parseMusicXMLDetailed as facadeParseMusicXMLDetailed,
  serializeMusicXML as facadeSerializeMusicXML,
} from '../../src/io/formats/musicxml';
import {walkMusicXmlMeasure} from '../../src/io/formats/musicxml/measure-walker';
import {
  parseOrderedXml,
  requireNumber,
  tagOf,
} from '../../src/io/formats/musicxml/ordered-tree';
import {parseMusicXML, parseMusicXMLDetailed} from '../../src/io/formats/musicxml/parser';
import {serializeMusicXML} from '../../src/io/formats/musicxml/serializer';

describe('MusicXML module boundaries', () => {
  it('keeps the historical format module as the stable facade', () => {
    expect(facadeParseMusicXML).toBe(parseMusicXML);
    expect(facadeParseMusicXMLDetailed).toBe(parseMusicXMLDetailed);
    expect(facadeSerializeMusicXML).toBe(serializeMusicXML);
  });

  it('walks note and forward elements in preserved document order', () => {
    const document = parseOrderedXml(`
      <measure number="1">
        <attributes><divisions>2</divisions></attributes>
        <note><duration>2</duration><voice>1</voice></note>
        <forward><duration>2</duration></forward>
        <note><duration>2</duration><voice>1</voice></note>
      </measure>
    `);
    const measure = document.find((node) => tagOf(node) === 'measure')!;
    const onsets: number[] = [];
    const duration = walkMusicXmlMeasure(measure, {divisions: 1}, (event) => {
      if (event.kind === 'note') onsets.push(event.onsetQuarters.toFloat());
    });

    expect(onsets).toEqual([0, 2]);
    expect(duration.toFloat()).toBe(3);
  });

  it('reports malformed numeric fields with MusicXML context', () => {
    expect(() => requireNumber('not-a-number', '<duration>')).toThrow(
      /MusicXML parse error.*<duration>/,
    );
  });
});
