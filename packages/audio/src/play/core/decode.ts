// ============================================================================
// Audio decoding. Strategy, in priority order:
//   1. WAV bytes        → pure-JS parseWav (works in Node/worker, zero deps)
//   2. a context given  → native `decodeAudioData` (hardware-accelerated, broad
//                          codec coverage on the main thread / OfflineContext)
//   3. otherwise        → an optional WASM decoder for the sniffed format,
//                          dynamically imported and guarded so the build /
//                          typecheck pass without the peer installed.
// Everything returns deinterleaved float channels — the AudioClip currency.
// ============================================================================

import type {AudioFormat} from '../../core';
import {detectAudioFormat} from './format-detect';
import {parseWav} from './wav';

/** Result of any decode: deinterleaved float channels + the sample rate. */
export interface DecodedAudio {
  sampleRate: number;
  channelData: Float32Array[];
}

export interface DecodeOptions {
  /** Explicit format; otherwise sniffed from the bytes. */
  format?: AudioFormat;
  /** A context to decode compressed formats with `decodeAudioData`. */
  context?: BaseAudioContext;
}

/**
 * Decode `bytes` into float channels. WAV takes the pure-JS path; compressed
 * formats prefer a provided context's native decoder, then fall back to an
 * optional WASM decoder. Throws a clear error when a format needs a peer that
 * isn't installed.
 */
export async function decodeAudio(
  bytes: ArrayBuffer | Uint8Array,
  opts: DecodeOptions = {},
): Promise<DecodedAudio> {
  const buffer = toArrayBuffer(bytes);
  const format = opts.format ?? detectAudioFormat(buffer);

  if (format === 'wav') {
    return parseWav(buffer);
  }

  // Native decode covers mp3/aac/m4a/flac/ogg on most browsers — try it first
  // whenever a context is available (cheapest, hardware-accelerated).
  if (opts.context && typeof opts.context.decodeAudioData === 'function') {
    try {
      return await decodeWithContext(opts.context, buffer);
    } catch {
      // Fall through to the WASM decoders (e.g. Safari can't decode Ogg).
    }
  }

  return decodeWithWasm(format, buffer);
}

/**
 * Streaming decode in chunks. Real signature, real behaviour for the WAV path
 * (it slices the decoded channels into windows); compressed formats currently
 * decode whole then chunk, which keeps the streaming-peaks call sites working
 * today and leaves room for a true chunked codec path later.
 */
export async function* decodeAudioChunked(
  bytes: ArrayBuffer | Uint8Array,
  opts: DecodeOptions & {chunkFrames?: number} = {},
): AsyncGenerator<DecodedAudio, void, unknown> {
  const decoded = await decodeAudio(bytes, opts);
  const chunk = Math.max(1, opts.chunkFrames ?? decoded.sampleRate); // ~1s windows
  const total = decoded.channelData[0]?.length ?? 0;
  for (let start = 0; start < total; start += chunk) {
    const end = Math.min(total, start + chunk);
    yield {
      sampleRate: decoded.sampleRate,
      channelData: decoded.channelData.map((ch) => ch.subarray(start, end)),
    };
  }
}

// ---------------------------------------------------------------------------
// Native decode
// ---------------------------------------------------------------------------

async function decodeWithContext(context: BaseAudioContext, buffer: ArrayBuffer): Promise<DecodedAudio> {
  // decodeAudioData detaches the buffer it's handed on some engines; pass a copy.
  const copy = buffer.slice(0);
  const audioBuffer = await context.decodeAudioData(copy);
  const channelData: Float32Array[] = [];
  for (let c = 0; c < audioBuffer.numberOfChannels; c++) {
    channelData.push(Float32Array.from(audioBuffer.getChannelData(c)));
  }
  return {sampleRate: audioBuffer.sampleRate, channelData};
}

// ---------------------------------------------------------------------------
// WASM fall-backs (all dynamically imported, all optional)
// ---------------------------------------------------------------------------

async function decodeWithWasm(format: AudioFormat | undefined, buffer: ArrayBuffer): Promise<DecodedAudio> {
  const data = new Uint8Array(buffer);
  switch (format) {
    case 'mp3':
      return decodeMp3(data);
    case 'flac':
      return decodeFlac(data);
    case 'ogg':
      return decodeVorbis(data);
    case 'opus':
      return decodeOpus(data);
    default:
      throw new Error(
        `No decoder available for format "${format ?? 'unknown'}". ` +
          'Provide an AudioContext (native decodeAudioData) or install the matching ' +
          'optional WASM decoder (mpg123-decoder, @wasm-audio-decoders/flac, ' +
          '@wasm-audio-decoders/ogg-vorbis, ogg-opus-decoder).',
      );
  }
}

/** Shape every `@wasm-audio-decoders` family decoder exposes. */
interface WasmDecoderLike {
  ready: Promise<unknown>;
  decode?(data: Uint8Array): Promise<DecodedChannels>;
  decodeFile?(data: Uint8Array): Promise<DecodedChannels>;
  free?(): void;
}
interface DecodedChannels {
  channelData: Float32Array[];
  samplesDecoded?: number;
  sampleRate: number;
}

async function decodeMp3(data: Uint8Array): Promise<DecodedAudio> {
  const mod = await importPeer<{MPEGDecoder: new () => WasmDecoderLike}>(
    'mpg123-decoder',
    'mp3',
  );
  const decoder = new mod.MPEGDecoder();
  await decoder.ready;
  try {
    const result = await callDecode(decoder, data);
    return {sampleRate: result.sampleRate, channelData: result.channelData};
  } finally {
    decoder.free?.();
  }
}

async function decodeFlac(data: Uint8Array): Promise<DecodedAudio> {
  const mod = await importPeer<{FLACDecoder: new () => WasmDecoderLike}>(
    '@wasm-audio-decoders/flac',
    'flac',
  );
  const decoder = new mod.FLACDecoder();
  await decoder.ready;
  try {
    const result = await callDecode(decoder, data);
    return {sampleRate: result.sampleRate, channelData: result.channelData};
  } finally {
    decoder.free?.();
  }
}

async function decodeVorbis(data: Uint8Array): Promise<DecodedAudio> {
  const mod = await importPeer<{OggVorbisDecoder: new () => WasmDecoderLike}>(
    '@wasm-audio-decoders/ogg-vorbis',
    'ogg',
  );
  const decoder = new mod.OggVorbisDecoder();
  await decoder.ready;
  try {
    const result = await callDecode(decoder, data);
    return {sampleRate: result.sampleRate, channelData: result.channelData};
  } finally {
    decoder.free?.();
  }
}

async function decodeOpus(data: Uint8Array): Promise<DecodedAudio> {
  const mod = await importPeer<{OggOpusDecoder: new () => WasmDecoderLike}>(
    'ogg-opus-decoder',
    'opus',
  );
  const decoder = new mod.OggOpusDecoder();
  await decoder.ready;
  try {
    const result = await callDecode(decoder, data);
    return {sampleRate: result.sampleRate, channelData: result.channelData};
  } finally {
    decoder.free?.();
  }
}

async function callDecode(decoder: WasmDecoderLike, data: Uint8Array): Promise<DecodedChannels> {
  if (typeof decoder.decodeFile === 'function') return decoder.decodeFile(data);
  if (typeof decoder.decode === 'function') return decoder.decode(data);
  throw new Error('WASM decoder exposes neither decode() nor decodeFile()');
}

/** Dynamically import an optional peer, raising a clear error when it is absent. */
async function importPeer<T>(name: string, format: string): Promise<T> {
  try {
    return (await import(/* @vite-ignore */ name as string)) as T;
  } catch {
    throw new Error(
      `Decoding ${format} requires the optional peer "${name}". ` +
        `Install it (npm i ${name}) or decode on a thread with an AudioContext.`,
    );
  }
}

function toArrayBuffer(bytes: ArrayBuffer | Uint8Array): ArrayBuffer {
  if (bytes instanceof ArrayBuffer) return bytes;
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}
