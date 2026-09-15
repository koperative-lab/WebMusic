import {strFromU8, strToU8, unzipSync, zipSync} from 'fflate';
import {XMLBuilder, XMLParser} from 'fast-xml-parser';
import {parseMusicXMLDetailed, serializeMusicXML} from './musicxml';
import {decodeXmlEntities} from './musicxml/ordered-tree';
import type {Score} from '../../core';
import type {ScoreParseResult} from '../diagnostics';

/** Resource limits applied while reading an untrusted MXL (ZIP) archive. */
export interface MXLParseLimits {
  /** Maximum compressed archive size accepted before ZIP metadata is inspected. */
  maxArchiveBytes: number;
  /** Maximum decompressed size of one extracted archive entry. */
  maxEntryBytes: number;
  /** Maximum combined decompressed size of the container and score entries. */
  maxTotalExtractedBytes: number;
  /** Maximum ZIP entries inspected while looking for the score file. */
  maxEntries: number;
  /** Maximum decoded character length of an archive entry name. */
  maxPathLength: number;
}

/** Optional overrides for {@link DEFAULT_MXL_PARSE_LIMITS}. */
export type MXLParseOptions = Partial<MXLParseLimits>;

/**
 * Conservative browser-side defaults. An MXL archive contains one small
 * container manifest and one MusicXML score; callers that intentionally use
 * larger trusted archives can raise these values explicitly.
 */
export const DEFAULT_MXL_PARSE_LIMITS: Readonly<MXLParseLimits> = Object.freeze({
  maxArchiveBytes: 32 * 1024 * 1024,
  maxEntryBytes: 64 * 1024 * 1024,
  maxTotalExtractedBytes: 64 * 1024 * 1024,
  maxEntries: 4_096,
  maxPathLength: 1_024,
});

/** Thrown before MXL metadata or decompression can allocate excessive work. */
export class MXLParseLimitError extends Error {
  readonly code = 'mxl-parse-limit';

  constructor(message: string) {
    super(message);
    this.name = 'MXLParseLimitError';
  }
}

/** Resolve and validate optional MXL resource-limit overrides. */
export function resolveMXLParseLimits(options: MXLParseOptions = {}): MXLParseLimits {
  return {
    maxArchiveBytes: positiveIntegerLimit(
      'maxArchiveBytes',
      options.maxArchiveBytes,
      DEFAULT_MXL_PARSE_LIMITS.maxArchiveBytes,
    ),
    maxEntryBytes: positiveIntegerLimit('maxEntryBytes', options.maxEntryBytes, DEFAULT_MXL_PARSE_LIMITS.maxEntryBytes),
    maxTotalExtractedBytes: positiveIntegerLimit(
      'maxTotalExtractedBytes',
      options.maxTotalExtractedBytes,
      DEFAULT_MXL_PARSE_LIMITS.maxTotalExtractedBytes,
    ),
    maxEntries: positiveIntegerLimit('maxEntries', options.maxEntries, DEFAULT_MXL_PARSE_LIMITS.maxEntries),
    maxPathLength: positiveIntegerLimit('maxPathLength', options.maxPathLength, DEFAULT_MXL_PARSE_LIMITS.maxPathLength),
  };
}

export async function parseMXL(buffer: ArrayBuffer, options: MXLParseOptions = {}): Promise<Score> {
  return (await parseMXLDetailed(buffer, options)).score;
}

/**
 * Parse an MXL container and preserve diagnostics from its MusicXML payload.
 * Container-level recovery diagnostics will be added only when the MXL parser
 * itself gains recoverable fallback behavior; fatal container errors still
 * reject as they do in the score-only wrapper.
 */
export async function parseMXLDetailed(
  buffer: ArrayBuffer,
  options: MXLParseOptions = {},
): Promise<ScoreParseResult> {
  const limits = resolveMXLParseLimits(options);
  assertArchiveSize(buffer.byteLength, limits);
  const data = new Uint8Array(buffer);

  // First pass: list entry names, extracting only the container index (with a
  // size cap) — never inflate the whole archive.
  const entryNames: string[] = [];
  let containerOriginalSize = 0;
  let containerFiles = unzipSync(data, {
    filter: (file) => {
      inspectEntry(file.name, entryNames, limits);
      if (file.name !== 'META-INF/container.xml') return false;
      assertEntrySize(file.name, file.originalSize, limits, 0);
      containerOriginalSize = file.originalSize;
      return true;
    },
  });

  let container: Uint8Array | undefined = containerFiles['META-INF/container.xml'];
  let scorePath: string | undefined;
  if (container) {
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '',
      // Disabled to block DTD entity expansion; decodeXmlEntities restores
      // only the predefined entities and numeric character references.
      processEntities: false,
      tagValueProcessor: (_name, value) => decodeXmlEntities(value),
      attributeValueProcessor: (_name, value) => decodeXmlEntities(value),
    });
    const parsed = parser.parse(strFromU8(container));
    const rootfiles = parsed.container?.rootfiles?.rootfile;
    const rootfile = Array.isArray(rootfiles) ? rootfiles[0] : rootfiles;
    scorePath = rootfile?.['full-path'];
  }
  // The manifest is no longer needed before extracting the score entry. Drop
  // its reference so a large (but valid) manifest is not retained alongside
  // the MusicXML body.
  container = undefined;
  containerFiles = {};

  // Fallback: pick a score entry directly — never the META-INF index itself.
  scorePath ??= entryNames.find(
    (name) => !name.startsWith('META-INF/') && (name.endsWith('.musicxml') || name.endsWith('.xml')),
  );
  if (!scorePath || !entryNames.includes(scorePath)) {
    throw new Error('MXL archive does not contain a MusicXML score');
  }

  // Second pass: extract only the target score entry, again size-capped.
  const target = scorePath;
  const scoreFiles = unzipSync(data, {
    filter: (file) => {
      if (file.name !== target) return false;
      assertEntrySize(file.name, file.originalSize, limits, containerOriginalSize);
      return true;
    },
  });
  const scoreEntry = scoreFiles[target];
  if (!scoreEntry) throw new Error('MXL archive does not contain a MusicXML score');

  return parseMusicXMLDetailed(strFromU8(scoreEntry), {maxInputBytes: limits.maxEntryBytes});
}

function inspectEntry(name: string, entryNames: string[], limits: MXLParseLimits): void {
  if (entryNames.length >= limits.maxEntries) {
    throw new MXLParseLimitError(
      `MXL resource limit exceeded: archive has more than maxEntries (${limits.maxEntries.toLocaleString()})`,
    );
  }
  if (name.length > limits.maxPathLength) {
    throw new MXLParseLimitError(
      `MXL resource limit exceeded: entry path length is ${name.length.toLocaleString()} (maxPathLength is ${limits.maxPathLength.toLocaleString()})`,
    );
  }
  entryNames.push(name);
}

function assertArchiveSize(byteLength: number, limits: MXLParseLimits): void {
  if (!Number.isSafeInteger(byteLength) || byteLength < 0) {
    throw new TypeError('MXL archive byte length must be a non-negative safe integer');
  }
  if (byteLength > limits.maxArchiveBytes) {
    throw new MXLParseLimitError(
      `MXL resource limit exceeded: archive is ${byteLength.toLocaleString()} bytes (maxArchiveBytes is ${limits.maxArchiveBytes.toLocaleString()})`,
    );
  }
}

function assertEntrySize(name: string, originalSize: number, limits: MXLParseLimits, previouslyExtractedBytes: number): void {
  if (!Number.isSafeInteger(originalSize) || originalSize < 0) {
    throw new MXLParseLimitError(`MXL entry "${name}" has an invalid decompressed size`);
  }
  if (originalSize > limits.maxEntryBytes) {
    throw new MXLParseLimitError(
      `MXL resource limit exceeded: entry "${name}" would decompress to ${originalSize.toLocaleString()} bytes (maxEntryBytes is ${limits.maxEntryBytes.toLocaleString()})`,
    );
  }
  const total = previouslyExtractedBytes + originalSize;
  if (!Number.isSafeInteger(total) || total > limits.maxTotalExtractedBytes) {
    throw new MXLParseLimitError(
      `MXL resource limit exceeded: extracted entries would total ${total.toLocaleString()} bytes (maxTotalExtractedBytes is ${limits.maxTotalExtractedBytes.toLocaleString()})`,
    );
  }
}

function positiveIntegerLimit(name: keyof MXLParseLimits, value: number | undefined, fallback: number): number {
  if (value == null) return fallback;
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError(`MXL parse option ${name} must be a positive safe integer`);
  }
  return value;
}

/**
 * Serialize a Score to a compressed MusicXML (.mxl) archive. Mirrors
 * {@link parseMXL}: writes the score as `score.musicxml` plus the
 * `META-INF/container.xml` index that points to it, per the MusicXML spec.
 */
export function serializeMXL(score: Score, opts: {ppq?: number; scorePath?: string} = {}): Uint8Array {
  const scorePath = opts.scorePath ?? 'score.musicxml';
  if (!scorePath || scorePath === 'META-INF/container.xml') {
    throw new RangeError('MXL scorePath must be non-empty and must not replace META-INF/container.xml');
  }
  const xml = serializeMusicXML(score, {ppq: opts.ppq});
  const containerXml = new XMLBuilder({
    ignoreAttributes: false,
    attributeNamePrefix: '',
    format: true,
  }).build({
    '?xml': {version: '1.0', encoding: 'UTF-8'},
    container: {rootfiles: {rootfile: {'full-path': scorePath, 'media-type': 'application/vnd.recordare.musicxml+xml'}}},
  });

  return zipSync({
    'META-INF/container.xml': strToU8(containerXml),
    [scorePath]: strToU8(xml),
  });
}
