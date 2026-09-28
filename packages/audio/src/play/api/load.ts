// ============================================================================
// File I/O for digital audio: format sniffing, extension mapping, and the
// `loadClip` / `loadClipFromUrl` entry points that turn bytes / Blobs / Files /
// AudioBuffers into immutable `AudioClip`s. Decoding itself lives in decode.ts
// (native `decodeAudioData` + WASM fall-backs); this module owns detection and
// the AudioClip assembly. Metadata tags are read lazily via an optional
// `music-metadata` peer, only when `opts.metadata` is set.
// ============================================================================

import {
  AudioClip,
  createAudioClip,
  type AudioClipMetadata,
  type AudioFormat,
} from '../../core';
import {decodeAudio, type DecodeOptions} from '../core/decode';
import {detectAudioFormat, formatFromExtension} from '../core/format-detect';
import {parseWav} from '../core/wav';
import {
  assertDecodedSize,
  assertDecodedDimensions,
  assertInputSize,
  fetchAudioBytes,
  throwIfAborted,
  type AudioResourceLimits,
} from './resource-limits';

/** Options for {@link loadClip}. */
export interface LoadClipOptions extends AudioResourceLimits {
  /** Explicit format hint; otherwise sniffed from magic bytes / extension. */
  format?: AudioFormat;
  /** An AudioContext (or OfflineAudioContext) to decode compressed formats with. */
  context?: BaseAudioContext;
  /** Read ID3 / Vorbis tags via the optional `music-metadata` peer. */
  metadata?: boolean;
  /** Original URL, stored on the clip for the streaming (media) engine. */
  sourceUrl?: string;
}

/** Options for {@link loadClipFromUrl}. */
export interface LoadClipFromUrlOptions extends LoadClipOptions {
  /** Don't decode up front: keep only `sourceUrl`, leaving samples to stream. */
  streaming?: boolean;
  /** Fetch timeout in milliseconds. Set to 0 to disable. Default 30 seconds. */
  timeoutMs?: number;
}


export {detectAudioFormat, formatFromExtension} from '../core/format-detect';

/**
 * Load an immutable {@link AudioClip} from raw bytes, a Blob/File, or an already
 * decoded `AudioBuffer`. WAV bytes are decoded with the pure-JS path; everything
 * else goes through {@link decodeAudio} (native `decodeAudioData` or a WASM
 * fall-back). Tags are read only when `opts.metadata` is true.
 */
export async function loadClip(
  input: ArrayBuffer | Blob | AudioBufferLike,
  opts: LoadClipOptions = {},
): Promise<AudioClip> {
  throwIfAborted(opts.signal);
  // Already-decoded AudioBuffer (duck-typed so SSR builds need no DOM lib).
  if (isAudioBuffer(input)) {
    assertDecodedDimensions(input.numberOfChannels, input.length, opts);
    return clipFromAudioBuffer(input, opts, opts.sourceUrl);
  }

  if (!(input instanceof ArrayBuffer) && typeof input.size === 'number') assertInputSize(input.size, opts);
  const buffer = await toArrayBuffer(input);
  throwIfAborted(opts.signal);
  assertInputSize(buffer.byteLength, opts);
  const format = opts.format ?? detectAudioFormat(buffer) ?? formatFromBlob(input);
  const decodeOpts: DecodeOptions = {format, context: opts.context};
  const decoded = await decodeAudio(buffer, decodeOpts);
  throwIfAborted(opts.signal);
  assertDecodedSize(decoded.channelData, opts);

  let metadata: AudioClipMetadata | undefined;
  if (opts.metadata) metadata = await readMetadata(buffer);
  throwIfAborted(opts.signal);

  return createAudioClip({
    sampleRate: decoded.sampleRate,
    channelData: decoded.channelData,
    ...(metadata ? {metadata} : {}),
    ...(opts.sourceUrl !== undefined ? {sourceUrl: opts.sourceUrl} : {}),
  });
}

/**
 * Fetch and load a clip from a URL. With `streaming: true` the bytes are NOT
 * decoded up front — the returned clip carries only `sourceUrl` plus a header
 * probe for `length`/`numberOfChannels`, leaving playback to the media engine
 * and peaks to `decodeAudioChunked`.
 */
export async function loadClipFromUrl(url: string, opts: LoadClipFromUrlOptions = {}): Promise<AudioClip> {
  throwIfAborted(opts.signal);
  const format = opts.format ?? formatFromExtension(url);

  if (opts.streaming) {
    // A streaming clip holds no samples; we still want a plausible duration.
    // Probe the Content-Length and assume stereo @ 44.1k as a placeholder when
    // the real header isn't cheaply available — the media engine reads the true
    // duration from the <audio> element once it loads.
    return createAudioClip({
      sampleRate: 44100,
      length: 0,
      numberOfChannels: 2,
      sourceUrl: url,
      ...(format ? {metadata: {format}} : {}),
    });
  }

  const buffer = await fetchAudioBytes(url, opts);
  return loadClip(buffer, {...opts, format: format ?? detectAudioFormat(buffer), sourceUrl: url});
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal structural AudioBuffer surface (avoids a DOM dependency at runtime). */
interface AudioBufferLike {
  readonly sampleRate: number;
  readonly numberOfChannels: number;
  readonly length: number;
  getChannelData(channel: number): Float32Array;
}

function isAudioBuffer(value: unknown): value is AudioBufferLike {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as AudioBufferLike).getChannelData === 'function' &&
    typeof (value as AudioBufferLike).sampleRate === 'number' &&
    typeof (value as AudioBufferLike).numberOfChannels === 'number'
  );
}

function clipFromAudioBuffer(buffer: AudioBufferLike, options: AudioResourceLimits, sourceUrl?: string): AudioClip {
  const channels: Float32Array[] = [];
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const channel = buffer.getChannelData(c);
    if (!(channel instanceof Float32Array) || channel.length !== buffer.length) {
      throw new TypeError('AudioBuffer channels must be Float32Array values matching buffer.length');
    }
    channels.push(channel);
  }
  // A duck-typed AudioBuffer can lie about its declared length. Check the real
  // channel arrays before AudioClip makes its defensive copies.
  assertDecodedSize(channels, options);
  return createAudioClip({
    sampleRate: buffer.sampleRate,
    channelData: channels,
    ...(sourceUrl !== undefined ? {sourceUrl} : {}),
  });
}

async function toArrayBuffer(input: ArrayBuffer | Blob): Promise<ArrayBuffer> {
  if (input instanceof ArrayBuffer) return input;
  // Blob / File (both expose arrayBuffer()).
  if (typeof (input as Blob).arrayBuffer === 'function') return (input as Blob).arrayBuffer();
  throw new Error('loadClip: unsupported input (expected ArrayBuffer, Blob/File, or AudioBuffer)');
}

/** Pull a format from a Blob/File MIME type or name when byte sniffing fails. */
function formatFromBlob(input: ArrayBuffer | Blob): AudioFormat | undefined {
  if (input instanceof ArrayBuffer) return undefined;
  const blob = input as Blob & {name?: string; type?: string};
  if (blob.name) {
    const fromName = formatFromExtension(blob.name);
    if (fromName) return fromName;
  }
  if (blob.type) return formatFromMime(blob.type);
  return undefined;
}

function formatFromMime(mime: string): AudioFormat | undefined {
  const lower = mime.toLowerCase();
  if (lower.includes('wav')) return 'wav';
  if (lower.includes('aiff')) return 'aiff';
  if (lower.includes('mpeg') || lower.includes('mp3')) return 'mp3';
  if (lower.includes('flac')) return 'flac';
  if (lower.includes('opus')) return 'opus';
  if (lower.includes('ogg')) return 'ogg';
  if (lower.includes('mp4') || lower.includes('m4a') || lower.includes('aac')) return 'm4a';
  if (lower.includes('webm')) return 'webm';
  return undefined;
}

/** Read tags via the optional `music-metadata` peer; returns `undefined` if absent. */
async function readMetadata(buffer: ArrayBuffer): Promise<AudioClipMetadata | undefined> {
  try {
    const mm = (await import('music-metadata' as string)) as {
      parseBuffer?: (buf: Uint8Array) => Promise<{common?: Record<string, unknown>}>;
    };
    if (!mm.parseBuffer) return undefined;
    const parsed = await mm.parseBuffer(new Uint8Array(buffer));
    const common = parsed.common ?? {};
    const meta: AudioClipMetadata = {};
    if (typeof common.title === 'string') meta.title = common.title;
    if (typeof common.artist === 'string') meta.artist = common.artist;
    if (typeof common.album === 'string') meta.album = common.album;
    return meta;
  } catch {
    return undefined;
  }
}

// Expose the wav fast-path so callers (and the decode worker) can reuse it
// without an extra import hop.
export {parseWav};
