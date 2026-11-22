// The saved form of an edited score (DEC-087): the Score as its own JSON,
// gzip-compressed and written as base64 text into the `document` key of the
// config of the box that plays it. A project stays one JSON document, so an
// edited score goes wherever the project goes — a file, a copy, an exported
// module or page — and needs no storage of its own.
//
// The Score's JSON is far larger than a project may hold as structure
// (Arabesque No. 1 is some 400 kB and 40 000 values), and note IDs are made
// on every load, so neither the plain JSON nor a list of edits against the
// asset can be kept. Compressed it is about a tenth of that, in strings short
// enough for the project schema.
//
// A project file may come from anyone: the text is bounded before it is
// decoded, the inflated size while it is inflated, and the result is read by
// `scoreFromJSON`, which validates it.
//
// Pure apart from the platform's compression streams; no DOM, no audio.

import type {ProjectJsonObject} from '@webmusic/kernel/module';
import {scoreFromJSON, type Score} from '@webmusic/score';

/** The `format` of a saved score. */
export const SAVED_SCORE_FORMAT = 'webmusic.score+json';
/** The `encoding` of a saved score. */
export const SAVED_SCORE_ENCODING = 'gzip+base64';

/** Strings of a saved score, each short enough for the project schema. */
const CHUNK = 32768;
/** Base64 characters a saved score may hold: about a dozen times Arabesque No. 1, and half of what a project may. */
const MAX_ENCODED = 1_000_000;
/** Bytes of JSON a saved score may inflate to. */
const MAX_INFLATED = 24 * 1024 * 1024;

type Streams = {CompressionStream?: typeof CompressionStream; DecompressionStream?: typeof DecompressionStream};
const streams = (): Streams => globalThis as Streams;

/** True where the platform can compress and inflate, which saving and restoring a score need. */
export function canSaveScores(): boolean {
  return typeof streams().CompressionStream === 'function' && typeof streams().DecompressionStream === 'function';
}

async function through(bytes: Uint8Array, stream: {readonly readable: ReadableStream<Uint8Array>; readonly writable: WritableStream<Uint8Array>}, limit: number): Promise<Uint8Array> {
  const writer = stream.writable.getWriter();
  // A failed write is reported by the read that follows it.
  void writer.write(bytes).then(() => writer.close()).catch(() => {});
  const reader = stream.readable.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const {done, value} = await reader.read();
    if (done) break;
    size += value.length;
    if (size > limit) {
      void reader.cancel().catch(() => {});
      throw new RangeError('A saved score exceeds its size limit.');
    }
    parts.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const part of parts) { out.set(part, at); at += part.length; }
  return out;
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let at = 0; at < bytes.length; at += 0x8000) binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
  return btoa(binary);
}

function fromBase64(text: string): Uint8Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let at = 0; at < binary.length; at += 1) bytes[at] = binary.charCodeAt(at);
  return bytes;
}

/**
 * `score` as a box's config holds it, or undefined when it cannot be saved:
 * the platform has no compression streams, or the result is too large for a
 * project.
 */
export async function encodeScore(score: Score): Promise<ProjectJsonObject | undefined> {
  const Compression = streams().CompressionStream;
  if (!Compression || !canSaveScores()) return undefined;
  const json = new TextEncoder().encode(JSON.stringify(score.toJSON()));
  if (json.length > MAX_INFLATED) return undefined;
  const text = toBase64(await through(json, new Compression('gzip') as never, MAX_ENCODED));
  if (text.length > MAX_ENCODED) return undefined;
  const data: string[] = [];
  for (let at = 0; at < text.length; at += CHUNK) data.push(text.slice(at, at + CHUNK));
  return Object.freeze({format: SAVED_SCORE_FORMAT, encoding: SAVED_SCORE_ENCODING, data: Object.freeze(data)});
}

/**
 * The Score a box's config holds under `document`. Rejects when the value is
 * not a saved score, is too large, does not inflate, or is not a valid Score.
 */
export async function decodeScore(value: unknown): Promise<Score> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('A saved score must be an object.');
  const {format, encoding, data} = value as {format?: unknown; encoding?: unknown; data?: unknown};
  if (format !== SAVED_SCORE_FORMAT) throw new TypeError(`A saved score must be in the format ${SAVED_SCORE_FORMAT}.`);
  if (encoding !== SAVED_SCORE_ENCODING) throw new TypeError(`A saved score must be encoded as ${SAVED_SCORE_ENCODING}.`);
  if (!Array.isArray(data) || !data.length || data.some(part => typeof part !== 'string')) throw new TypeError('A saved score must hold its data as strings.');
  let length = 0;
  for (const part of data as string[]) if ((length += part.length) > MAX_ENCODED) throw new RangeError('A saved score exceeds its size limit.');
  const Decompression = streams().DecompressionStream;
  if (!Decompression) throw new Error('This browser cannot inflate a saved score.');
  let packed: Uint8Array;
  try { packed = fromBase64((data as string[]).join('')); } catch { throw new TypeError('A saved score must be base64 text.'); }
  // The size limit is reported as it is; any other failure is data that is not gzip.
  const json = await through(packed, new Decompression('gzip') as never, MAX_INFLATED).catch((error: unknown) => {
    if (error instanceof RangeError) throw error;
    return undefined;
  });
  if (!json) throw new TypeError('A saved score does not inflate.');
  return scoreFromJSON(JSON.parse(new TextDecoder().decode(json)) as never);
}
