import {XMLParser} from 'fast-xml-parser';

/** One node in fast-xml-parser's preserveOrder representation. */
export type OrderedXmlNode = Record<string, unknown>;

/** Upper bound for element nodes accepted before fast-xml-parser builds a tree. */
export const DEFAULT_MUSICXML_MAX_ELEMENTS = 250_000;
/** Upper bound for UTF-8 source bytes accepted by the direct parser. */
export const DEFAULT_MUSICXML_MAX_INPUT_BYTES = 32 * 1024 * 1024;

export class MusicXMLParseLimitError extends Error {
  readonly code = 'musicxml-parse-limit';

  constructor(message: string) {
    super(message);
    this.name = 'MusicXMLParseLimitError';
  }
}

export interface OrderedXmlParseOptions {
  /** Maximum UTF-8 source size. Default 32 MiB. */
  maxInputBytes?: number;
  /** Maximum opening element tags. Comments, declarations and closing tags do not count. */
  maxElements?: number;
}

const PREDEFINED_XML_ENTITIES: Readonly<Record<string, string>> = Object.freeze({
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
});

/**
 * Decode ONLY the five predefined XML entities (&amp; &lt; &gt; &quot;
 * &apos;) plus numeric character references (&#NNN; / &#xHHH;) in a parsed
 * text or attribute value.
 *
 * The parsers below run with `processEntities: false` so that custom
 * DTD-declared entities are never expanded — recursive entity expansion is
 * the "billion laughs" denial-of-service vector. That switch also leaves the
 * predefined entities un-decoded, so this helper restores exactly the safe,
 * non-recursive subset: named lookups are limited to the fixed table above
 * and numeric references expand to a single code point, so no input can
 * trigger expansion growth. Unknown entities (e.g. `&xxe;`) stay literal.
 */
export function decodeXmlEntities(text: string): string {
  return text.replace(
    /&(?:(amp|lt|gt|quot|apos)|#(\d{1,7})|#x([0-9a-fA-F]{1,6}));/g,
    (match, named: string | undefined, decimal: string | undefined, hex: string | undefined) => {
      if (named !== undefined) return PREDEFINED_XML_ENTITIES[named];
      const codePoint = decimal !== undefined ? Number.parseInt(decimal, 10) : Number.parseInt(hex as string, 16);
      // Leave malformed references (beyond Unicode, or surrogate halves) literal.
      if (codePoint > 0x10ffff || (codePoint >= 0xd800 && codePoint <= 0xdfff)) return match;
      return String.fromCodePoint(codePoint);
    },
  );
}

/** Parse without discarding in-measure note/backup/forward order. */
export function parseOrderedXml(xml: string, options: OrderedXmlParseOptions = {}): OrderedXmlNode[] {
  const maxInputBytes = positiveIntegerLimit(
    'MusicXML maxInputBytes',
    options.maxInputBytes,
    DEFAULT_MUSICXML_MAX_INPUT_BYTES,
  );
  const maxElements = positiveIntegerLimit(
    'MusicXML maxElements',
    options.maxElements,
    DEFAULT_MUSICXML_MAX_ELEMENTS,
  );
  assertMusicXmlInputLimit(xml, maxInputBytes);
  assertMusicXmlElementLimit(xml, maxElements);
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '',
    preserveOrder: true,
    parseTagValue: false,
    trimValues: true,
    // Disabled to block DTD entity expansion; see decodeXmlEntities.
    processEntities: false,
    tagValueProcessor: (_name, value) => decodeXmlEntities(value),
    attributeValueProcessor: (_name, value) => decodeXmlEntities(value),
  });
  return parser.parse(xml) as OrderedXmlNode[];
}

/** Reject oversized direct string input without allocating a second UTF-8 buffer. */
export function assertMusicXmlInputLimit(xml: string, maxInputBytes: number): void {
  if (!Number.isSafeInteger(maxInputBytes) || maxInputBytes < 1) {
    throw new RangeError('MusicXML maxInputBytes must be a positive safe integer');
  }
  const byteLength = utf8ByteLengthAtMost(xml, maxInputBytes);
  if (byteLength > maxInputBytes) {
    throw new MusicXMLParseLimitError(
      `MusicXML resource limit exceeded: input exceeds maxInputBytes (${maxInputBytes.toLocaleString()})`,
    );
  }
}

/**
 * Count XML opening tags without constructing the parser's object graph. This
 * deliberately ignores comments, CDATA, processing instructions and DTD text;
 * it is a resource preflight, not a second XML parser.
 */
export function assertMusicXmlElementLimit(xml: string, maxElements: number): void {
  if (!Number.isSafeInteger(maxElements) || maxElements < 1) {
    throw new RangeError('MusicXML maxElements must be a positive safe integer');
  }

  let elements = 0;
  let cursor = 0;
  while (cursor < xml.length) {
    const open = xml.indexOf('<', cursor);
    if (open < 0) break;

    if (xml.startsWith('<!--', open)) {
      cursor = skipDelimited(xml, open + 4, '-->');
      continue;
    }
    if (xml.startsWith('<![CDATA[', open)) {
      cursor = skipDelimited(xml, open + 9, ']]>');
      continue;
    }
    if (xml.startsWith('<?', open)) {
      cursor = skipDelimited(xml, open + 2, '?>');
      continue;
    }

    const end = findMarkupEnd(xml, open + 1);
    const first = xml.charCodeAt(open + 1);
    if (first !== 0x2f /* / */ && first !== 0x21 /* ! */) {
      elements += 1;
      if (elements > maxElements) {
        throw new MusicXMLParseLimitError(
          `MusicXML resource limit exceeded: more than ${maxElements.toLocaleString()} elements`,
        );
      }
    }
    cursor = end + 1;
  }
}

function skipDelimited(xml: string, start: number, delimiter: string): number {
  const end = xml.indexOf(delimiter, start);
  return end < 0 ? xml.length : end + delimiter.length;
}

/** Find a markup-closing `>` while respecting quoted attribute/DTD values. */
function findMarkupEnd(xml: string, start: number): number {
  let quote = 0;
  let subsetDepth = 0;
  for (let index = start; index < xml.length; index += 1) {
    const code = xml.charCodeAt(index);
    if (quote !== 0) {
      if (code === quote) quote = 0;
      continue;
    }
    if (code === 0x22 || code === 0x27) {
      quote = code;
      continue;
    }
    if (code === 0x5b) subsetDepth += 1;
    else if (code === 0x5d && subsetDepth > 0) subsetDepth -= 1;
    else if (code === 0x3e && subsetDepth === 0) return index;
  }
  return xml.length - 1;
}

function positiveIntegerLimit(label: string, value: number | undefined, fallback: number): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < 1) {
    throw new RangeError(`${label} must be a positive safe integer`);
  }
  return resolved;
}

/** Count UTF-8 bytes without allocating a second large buffer; stop after limit. */
function utf8ByteLengthAtMost(value: string, limit: number): number {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && index + 1 < value.length) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        index += 1;
      } else {
        bytes += 3;
      }
    } else {
      bytes += 3;
    }
    if (bytes > limit) return bytes;
  }
  return bytes;
}

export function tagOf(node: OrderedXmlNode): string {
  for (const key of Object.keys(node)) {
    if (key !== ':@') return key;
  }
  return '';
}

export function childrenOf(node: OrderedXmlNode): OrderedXmlNode[] {
  const value = node[tagOf(node)];
  return Array.isArray(value) ? value as OrderedXmlNode[] : [];
}

export function attrsOf(node: OrderedXmlNode): Record<string, unknown> {
  return (node[':@'] as Record<string, unknown>) ?? {};
}

export function childList(node: OrderedXmlNode, name: string): OrderedXmlNode[] {
  return childrenOf(node).filter((child) => tagOf(child) === name);
}

export function childOf(
  node: OrderedXmlNode,
  name: string,
): OrderedXmlNode | undefined {
  return childrenOf(node).find((child) => tagOf(child) === name);
}

export function textOf(node?: OrderedXmlNode): string | undefined {
  if (!node) return undefined;
  for (const child of childrenOf(node)) {
    if (tagOf(child) === '#text') return String(child['#text']);
  }
  return undefined;
}

export function childText(node: OrderedXmlNode, name: string): string | undefined {
  return textOf(childOf(node, name));
}

/** Numeric read with a clear parse error instead of silent NaN propagation. */
export function requireNumber(value: unknown, description: string): number {
  const number = typeof value === 'string' ? Number(value.trim()) : Number(value);
  if (!Number.isFinite(number)) {
    throw new Error(
      `MusicXML parse error: ${description} is not a valid number ` +
      `(got ${JSON.stringify(value)})`,
    );
  }
  return number;
}
