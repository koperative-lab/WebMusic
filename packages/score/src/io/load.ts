import type {Score} from '../core';
import {
  ScoreLoadAbortError,
  ScoreLoadTimeoutError,
  createScoreCancellationContext,
  raceWithScoreAbort,
  throwIfScoreAborted,
} from './cancellation';
import type {ScoreParseResult} from './diagnostics';
import {
  assertABCInputByteLength,
  parseABCDetailed,
  resolveABCParseLimits,
  type ABCParseOptions,
} from './formats/abc';
import {parseMIDIDetailed, type MIDIParseOptions} from './formats/midi';
import {parseMusicXMLDetailed, type MusicXMLParseOptions} from './formats/musicxml';
import {parseMXLDetailed, resolveMXLParseLimits, type MXLParseOptions} from './formats/mxl';

export type ScoreFormat = 'midi' | 'mxl' | 'musicxml' | 'abc';

/** Limits applied before score data is decoded or passed to a parser. */
export interface LoadScoreLimits {
  /** Maximum UTF-8 or binary source size accepted by a score load. */
  maxInputBytes: number;
}

/** Conservative default for a complete score file received from an untrusted source. */
export const DEFAULT_LOAD_SCORE_LIMITS: Readonly<LoadScoreLimits> = Object.freeze({
  maxInputBytes: 32 * 1024 * 1024,
});

/** Thrown before an oversized score body is decoded, copied, or parsed. */
export class ScoreInputLimitError extends Error {
  readonly code = 'score-input-limit';

  constructor(message: string) {
    super(message);
    this.name = 'ScoreInputLimitError';
  }
}

export interface LoadScoreOptions {
  format?: ScoreFormat;
  /** Cancel download and suppress any pending parse result. */
  signal?: AbortSignal;
  /**
   * Maximum duration of the complete load operation, in milliseconds.
   * This includes download, bounded stream reading, and parsing.
   */
  timeoutMs?: number;
  /**
   * Maximum source size for binary input, text input, and URL responses.
   * The default is 32 MiB. Raise this only for trusted, known-large scores.
   */
  maxInputBytes?: number;
  /** Resource-limit overrides used only when parsing ABC input. */
  abc?: ABCParseOptions;
  /** Structure-limit overrides used only when parsing MIDI input. */
  midi?: MIDIParseOptions;
  /** Structure-limit overrides used only when parsing MusicXML input. */
  musicxml?: MusicXMLParseOptions;
  /** Resource-limit overrides used only when parsing compressed MXL input. */
  mxl?: MXLParseOptions;
}

/**
 * Detect the encoding of a score input. Binary buffers are sniffed by magic
 * bytes (`MThd` for SMF, `PK` for the zip-based .mxl); text is classified as
 * MusicXML when it opens with `<`, otherwise ABC.
 */
export function detectFormat(input: ArrayBuffer | Uint8Array | string): ScoreFormat {
  if (typeof input === 'string') {
    return startsWithMusicXmlText(input) ? 'musicxml' : 'abc';
  }

  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes[0] === 0x4d && bytes[1] === 0x54 && bytes[2] === 0x68 && bytes[3] === 0x64) return 'midi';
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) return 'mxl';

  return startsWithMusicXml(bytes) ? 'musicxml' : 'abc';
}

/**
 * Parse any supported score input into a Score, auto-detecting the format
 * unless one is given explicitly. Always async since .mxl decoding is.
 */
export async function loadScore(
  input: ArrayBuffer | Uint8Array | string,
  opts: LoadScoreOptions = {},
): Promise<Score> {
  return (await loadScoreDetailed(input, opts)).score;
}

/**
 * Parse any supported score input and retain the normalisations each format
 * currently detects. An empty diagnostics list does not imply a lossless file.
 */
export async function loadScoreDetailed(
  input: ArrayBuffer | Uint8Array | string,
  opts: LoadScoreOptions = {},
): Promise<ScoreParseResult> {
  const cancellation = createScoreCancellationContext(opts);
  try {
    cancellation.throwIfAborted();
    const result = await raceWithScoreAbort(
      Promise.resolve().then(() => parseScoreDetailed(input, opts)),
      cancellation.signal,
    );
    cancellation.throwIfAborted();
    return result;
  } finally {
    cancellation.dispose();
  }
}

async function parseScoreDetailed(
  input: ArrayBuffer | Uint8Array | string,
  opts: LoadScoreOptions,
): Promise<ScoreParseResult> {
  const limits = resolveLoadScoreLimits(opts);
  assertScoreInputByteLength(scoreInputByteLengthAtMost(input, limits.maxInputBytes), limits.maxInputBytes, 'input');
  const format = opts.format ?? detectFormat(input);
  switch (format) {
    case 'midi':
      return parseMIDIDetailed(toArrayBuffer(input), {
        ...opts.midi,
        maxInputBytes: Math.min(opts.midi?.maxInputBytes ?? limits.maxInputBytes, limits.maxInputBytes),
      });
    case 'mxl':
      return parseMXLDetailed(toArrayBuffer(input), mxlOptionsForLoad(opts, limits));
    case 'musicxml':
      return parseMusicXMLDetailed(toText(input), {
        ...opts.musicxml,
        maxInputBytes: Math.min(
          opts.musicxml?.maxInputBytes ?? limits.maxInputBytes,
          limits.maxInputBytes,
        ),
      });
    case 'abc': {
      const limits = resolveABCParseLimits(opts.abc);
      // Reject oversized binary input before TextDecoder materializes a large
      // string. String inputs are counted by parseABC itself.
      if (typeof input !== 'string') {
        assertABCInputByteLength(input instanceof Uint8Array ? input.byteLength : input.byteLength, limits);
      }
      return parseABCDetailed(toText(input), limits);
    }
    default:
      throw new TypeError(`Unsupported score format "${String(format)}"`);
  }
}

/**
 * Fetch a score file from a URL and parse it. The format is taken from
 * `opts.format`, otherwise inferred from the file extension, otherwise sniffed
 * from the bytes. Used by the `src` attribute of WebScore custom elements.
 */
export async function loadScoreFromUrl(url: string, opts: LoadScoreOptions = {}): Promise<Score> {
  return (await loadScoreFromUrlDetailed(url, opts)).score;
}

/** Fetch a score file and preserve parser diagnostics when available. */
export async function loadScoreFromUrlDetailed(
  url: string,
  opts: LoadScoreOptions = {},
): Promise<ScoreParseResult> {
  const cancellation = createScoreCancellationContext(opts);
  try {
    cancellation.throwIfAborted();
    const response = await raceWithScoreAbort(fetch(url, {signal: cancellation.signal}), cancellation.signal);
    if (!response.ok) {
      cancelResponseBody(response.body);
      throw new Error(`Failed to load score from ${url}: ${response.status} ${response.statusText}`);
    }
    const limits = resolveLoadScoreLimits(opts);
    const buffer = await readScoreResponse(
      response,
      limits.maxInputBytes,
      `response from ${url}`,
      cancellation.signal,
    );
    cancellation.throwIfAborted();
    const result = await raceWithScoreAbort(
      Promise.resolve().then(() =>
        parseScoreDetailed(buffer, {...opts, format: opts.format ?? formatFromExtension(url)}),
      ),
      cancellation.signal,
    );
    cancellation.throwIfAborted();
    return result;
  } finally {
    cancellation.dispose();
  }
}

/** Resolve and validate caller-provided score source limits. */
export function resolveLoadScoreLimits(options: Pick<LoadScoreOptions, 'maxInputBytes'> = {}): LoadScoreLimits {
  const maxInputBytes = options.maxInputBytes ?? DEFAULT_LOAD_SCORE_LIMITS.maxInputBytes;
  if (!Number.isSafeInteger(maxInputBytes) || maxInputBytes < 1) {
    throw new RangeError('Score load option maxInputBytes must be a positive safe integer');
  }
  return {maxInputBytes};
}

/**
 * Read a successful Fetch response without allowing an unbounded body to be
 * materialized. A declared over-limit Content-Length is rejected immediately;
 * otherwise chunks are counted and the stream is cancelled at the limit.
 */
export async function readScoreResponse(
  response: Response,
  maxInputBytes: number,
  label = 'response',
  signal?: AbortSignal,
): Promise<ArrayBuffer> {
  throwIfScoreAborted(signal);
  const limits = resolveLoadScoreLimits({maxInputBytes});
  const declaredLength = contentLength(response);
  if (declaredLength != null && declaredLength > limits.maxInputBytes) {
    cancelResponseBody(response.body);
    throw inputLimitError(label, declaredLength, limits.maxInputBytes);
  }

  const body = response.body;
  if (!body || typeof body.getReader !== 'function') {
    // Some fetch polyfills expose only arrayBuffer(). The final byte-length
    // check still protects parsing, although such implementations cannot be
    // cancelled mid-download.
    let buffer: ArrayBuffer;
    try {
      buffer = await raceWithScoreAbort(response.arrayBuffer(), signal);
    } catch (error) {
      if (signal?.aborted) void cancelResponseBody(response.body);
      throw error;
    }
    assertScoreInputByteLength(buffer.byteLength, limits.maxInputBytes, label);
    return buffer;
  }

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      throwIfScoreAborted(signal);
      let read: ReadableStreamReadResult<Uint8Array>;
      try {
        read = await raceWithScoreAbort(reader.read(), signal);
      } catch (error) {
        if (signal?.aborted) void cancelReader(reader);
        throw error;
      }
      const {done, value} = read;
      if (done) break;
      if (!value || value.byteLength === 0) continue;
      const nextTotal = total + value.byteLength;
      if (!Number.isSafeInteger(nextTotal) || nextTotal > limits.maxInputBytes) {
        cancelReader(reader);
        throw inputLimitError(label, nextTotal, limits.maxInputBytes);
      }
      chunks.push(value);
      total = nextTotal;
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // A cancellation can leave a polyfilled reader temporarily locked.
    }
  }

  throwIfScoreAborted(signal);
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes.buffer;
}

export {ScoreLoadAbortError, ScoreLoadTimeoutError};

/** Infer the score format from a URL/path file extension, if recognizable. */
export function formatFromExtension(url: string): ScoreFormat | undefined {
  const path = url.split(/[?#]/, 1)[0] ?? url;
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
  switch (ext) {
    case 'mid':
    case 'midi':
      return 'midi';
    case 'mxl':
      return 'mxl';
    case 'xml':
    case 'musicxml':
      return 'musicxml';
    case 'abc':
      return 'abc';
    default:
      return undefined;
  }
}

function toArrayBuffer(input: ArrayBuffer | Uint8Array | string): ArrayBuffer {
  if (typeof input === 'string') return encodeUtf8(input).buffer as ArrayBuffer;
  if (input instanceof Uint8Array) {
    return input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength) as ArrayBuffer;
  }
  return input;
}

function toText(input: ArrayBuffer | Uint8Array | string): string {
  if (typeof input === 'string') return input;
  return decodeUtf8(input instanceof Uint8Array ? input : new Uint8Array(input));
}

function decodeUtf8(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

function encodeUtf8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

/** Assert a source byte count before decoding, copying, or parsing it. */
export function assertScoreInputByteLength(byteLength: number, maxInputBytes: number, label = 'input'): void {
  if (!Number.isSafeInteger(byteLength) || byteLength < 0) {
    throw new TypeError('Score input byte length must be a non-negative safe integer');
  }
  const limits = resolveLoadScoreLimits({maxInputBytes});
  if (byteLength > limits.maxInputBytes) {
    throw inputLimitError(label, byteLength, limits.maxInputBytes);
  }
}

/**
 * Count a string's UTF-8 bytes without allocating a second full-size buffer.
 * Returning immediately after the limit is crossed is enough for a safe
 * rejection and avoids spending linear work on an already-invalid source.
 */
export function scoreInputByteLengthAtMost(input: ArrayBuffer | Uint8Array | string, limit: number): number {
  if (typeof input !== 'string') return input.byteLength;
  let bytes = 0;
  for (let index = 0; index < input.length; index += 1) {
    const code = input.charCodeAt(index);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && index + 1 < input.length) {
      const next = input.charCodeAt(index + 1);
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

/** Keep an MXL archive within both its format-specific and top-level input caps. */
function mxlOptionsForLoad(options: LoadScoreOptions, limits: LoadScoreLimits): MXLParseOptions {
  const resolved = resolveMXLParseLimits(options.mxl);
  return {
    ...resolved,
    maxArchiveBytes: Math.min(resolved.maxArchiveBytes, limits.maxInputBytes),
  };
}

function contentLength(response: Response): number | undefined {
  const raw = response.headers?.get?.('content-length')?.trim();
  if (!raw || !/^\d+$/.test(raw)) return undefined;
  const length = Number(raw);
  return Number.isFinite(length) && length >= 0 ? length : undefined;
}

function inputLimitError(label: string, byteLength: number, maxInputBytes: number): ScoreInputLimitError {
  return new ScoreInputLimitError(
    `Score resource limit exceeded: ${label} is ${byteLength.toLocaleString()} bytes (maxInputBytes is ${maxInputBytes.toLocaleString()})`,
  );
}

function cancelResponseBody(body: ReadableStream<Uint8Array> | null | undefined): void {
  try {
    const cancellation = body?.cancel();
    if (cancellation) void Promise.resolve(cancellation).catch(() => {});
  } catch {
    // Cancellation is best-effort. The error below remains the useful cause.
  }
}

function cancelReader(reader: ReadableStreamDefaultReader<Uint8Array>): void {
  try {
    const cancellation = reader.cancel();
    if (cancellation) void Promise.resolve(cancellation).catch(() => {});
  } catch {
    // Cancellation is best-effort. The error below remains the useful cause.
  }
}

/** Sniff only the leading bytes; avoid decoding a whole untrusted file. */
function startsWithMusicXml(bytes: Uint8Array): boolean {
  let index = 0;
  const scanLimit = Math.min(bytes.length, 8 * 1024);
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) index = 3;
  while (index < scanLimit) {
    const byte = bytes[index];
    if (byte === 0x20 || byte === 0x09 || byte === 0x0a || byte === 0x0d) {
      index += 1;
      continue;
    }
    return byte === 0x3c; // '<'
  }
  return false;
}

function startsWithMusicXmlText(text: string): boolean {
  const scanLimit = Math.min(text.length, 8 * 1024);
  for (let index = text.charCodeAt(0) === 0xfeff ? 1 : 0; index < scanLimit; index += 1) {
    const character = text[index];
    if (character === ' ' || character === '\t' || character === '\n' || character === '\r') continue;
    return character === '<';
  }
  return false;
}
