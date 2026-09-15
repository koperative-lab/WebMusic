// Stable compatibility facade. Parsing, ordered measure walking and
// serialization are implemented in focused modules under ./musicxml.
export {parseMusicXML, parseMusicXMLDetailed, type MusicXMLParseOptions} from './musicxml/parser';
export {
  DEFAULT_MUSICXML_MAX_INPUT_BYTES,
  DEFAULT_MUSICXML_MAX_ELEMENTS,
  MusicXMLParseLimitError,
  assertMusicXmlElementLimit,
  assertMusicXmlInputLimit,
} from './musicxml/ordered-tree';
export {serializeMusicXML} from './musicxml/serializer';
