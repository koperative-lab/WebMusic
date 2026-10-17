// ============================================================================
// Pure-JS WAV (RIFF/WAVE) decode + encode. No DOM, no AudioContext — runs in
// Node, workers and the main thread alike, which is why it is the byte-level
// fast path for `decodeAudio`/`loadClip` (native `decodeAudioData` is only
// reachable on a thread with an AudioContext). Supports 8/16/24/32-bit integer
// PCM and 32-bit IEEE float, any channel count. This is the testable core of
// the package — exercised directly in test/wav.test.ts.
// ============================================================================

/** Decoded WAV payload: deinterleaved float channels in [-1, 1] + the rate. */
export interface DecodedWav {
  sampleRate: number;
  channelData: Float32Array[];
}

/** Bit depths `serializeWav` can emit. 32 alone means float; pass `'float'`/`'int'` to disambiguate. */
export type WavBitDepth = 16 | 24 | 32;

const FMT_PCM = 0x0001;
const FMT_FLOAT = 0x0003;
const FMT_EXTENSIBLE = 0xfffe;

/**
 * Parse a WAV/RIFF buffer into deinterleaved float channels. Throws a clear
 * Error on a malformed header or an unsupported codec. Chunks are walked by the
 * RIFF size fields, so trailing/leading metadata chunks (`LIST`, `bext`, …) are
 * skipped rather than misread.
 */
export function parseWav(buffer: ArrayBuffer): DecodedWav {
  const view = new DataView(buffer);
  if (buffer.byteLength < 12) throw new Error('WAV too short to contain a RIFF header');
  if (readTag(view, 0) !== 'RIFF') throw new Error('Not a RIFF file (missing "RIFF" magic)');
  if (readTag(view, 8) !== 'WAVE') throw new Error('Not a WAVE file (missing "WAVE" magic)');

  let format = FMT_PCM;
  let numChannels = 0;
  let sampleRate = 0;
  let bitsPerSample = 0;
  let dataOffset = -1;
  let dataLength = 0;

  // Walk the chunk list starting after "RIFF<size>WAVE".
  let offset = 12;
  while (offset + 8 <= buffer.byteLength) {
    const id = readTag(view, offset);
    const size = view.getUint32(offset + 4, true);
    const body = offset + 8;
    if (id === 'fmt ') {
      if (body + 16 > buffer.byteLength) throw new Error('Truncated "fmt " chunk');
      format = view.getUint16(body, true);
      numChannels = view.getUint16(body + 2, true);
      sampleRate = view.getUint32(body + 4, true);
      bitsPerSample = view.getUint16(body + 14, true);
      // WAVE_FORMAT_EXTENSIBLE stows the real codec in the sub-format GUID's
      // first two bytes; read them when the extension is present.
      if (format === FMT_EXTENSIBLE && size >= 40 && body + 26 <= buffer.byteLength) {
        format = view.getUint16(body + 24, true);
      }
    } else if (id === 'data') {
      dataOffset = body;
      // Clamp a bogus/streamed (0xFFFFFFFF) size to the remaining bytes.
      dataLength = Math.min(size, buffer.byteLength - body);
    }
    // Chunks are word-aligned: an odd size is followed by one pad byte.
    offset = body + size + (size & 1);
  }

  if (numChannels <= 0) throw new Error('WAV "fmt " chunk missing or declares no channels');
  if (sampleRate <= 0) throw new Error('WAV declares a non-positive sample rate');
  if (dataOffset < 0) throw new Error('WAV missing a "data" chunk');

  const bytesPerSample = bitsPerSample >> 3;
  if (bytesPerSample <= 0) throw new Error(`Unsupported WAV bit depth: ${bitsPerSample}`);
  const frameSize = bytesPerSample * numChannels;
  const frames = Math.floor(dataLength / frameSize);

  const channels: Float32Array[] = Array.from({length: numChannels}, () => new Float32Array(frames));
  const reader = sampleReader(format, bitsPerSample);

  for (let frame = 0; frame < frames; frame++) {
    const frameStart = dataOffset + frame * frameSize;
    for (let ch = 0; ch < numChannels; ch++) {
      channels[ch][frame] = reader(view, frameStart + ch * bytesPerSample);
    }
  }

  return {sampleRate, channelData: channels};
}

/**
 * Encode deinterleaved float channels into a WAV/RIFF buffer. `bitDepth` is
 * 16/24/32 (32 = int by default); pass `float: true` to emit 32-bit IEEE float
 * instead. Samples are clamped to [-1, 1] for the integer paths.
 */
export function serializeWav(
  channels: Float32Array[],
  sampleRate: number,
  bitDepth: WavBitDepth = 16,
  options: {float?: boolean} = {},
): ArrayBuffer {
  if (channels.length === 0) throw new Error('serializeWav requires at least one channel');
  if (sampleRate <= 0) throw new Error('serializeWav requires a positive sample rate');

  // 32-bit float is emitted only when explicitly requested; a bare bitDepth of
  // 32 means 32-bit *integer* PCM.
  const floatMode = options.float === true;
  if (floatMode && bitDepth !== 32) throw new Error('Float WAV output requires bitDepth 32');

  const numChannels = channels.length;
  const frames = channels[0]?.length ?? 0;
  for (const ch of channels) {
    if (ch.length !== frames) throw new Error('serializeWav: all channels must have equal length');
  }

  const bytesPerSample = bitDepth >> 3;
  const blockAlign = bytesPerSample * numChannels;
  const dataSize = frames * blockAlign;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const formatCode = floatMode ? FMT_FLOAT : FMT_PCM;

  writeTag(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeTag(view, 8, 'WAVE');
  writeTag(view, 12, 'fmt ');
  view.setUint32(16, 16, true); // PCM/float fmt chunk size
  view.setUint16(20, formatCode, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true); // byte rate
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitDepth, true);
  writeTag(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  const writer = sampleWriter(formatCode, bitDepth);
  let pos = 44;
  for (let frame = 0; frame < frames; frame++) {
    for (let ch = 0; ch < numChannels; ch++) {
      writer(view, pos, channels[ch][frame]);
      pos += bytesPerSample;
    }
  }

  return buffer;
}

// ---------------------------------------------------------------------------
// Per-sample readers / writers
// ---------------------------------------------------------------------------

type SampleReader = (view: DataView, byteOffset: number) => number;
type SampleWriter = (view: DataView, byteOffset: number, value: number) => void;

function sampleReader(format: number, bits: number): SampleReader {
  if (format === FMT_FLOAT) {
    if (bits === 32) return (v, o) => v.getFloat32(o, true);
    if (bits === 64) return (v, o) => v.getFloat64(o, true);
    throw new Error(`Unsupported float WAV bit depth: ${bits}`);
  }
  if (format !== FMT_PCM) throw new Error(`Unsupported WAV format code 0x${format.toString(16)}`);
  switch (bits) {
    case 8:
      // 8-bit PCM is unsigned (0..255), centred at 128.
      return (v, o) => (v.getUint8(o) - 128) / 128;
    case 16:
      return (v, o) => v.getInt16(o, true) / 0x8000;
    case 24:
      return (v, o) => read24(v, o) / 0x800000;
    case 32:
      return (v, o) => v.getInt32(o, true) / 0x80000000;
    default:
      throw new Error(`Unsupported PCM WAV bit depth: ${bits}`);
  }
}

function sampleWriter(format: number, bits: number): SampleWriter {
  if (format === FMT_FLOAT) {
    return (v, o, x) => v.setFloat32(o, x, true);
  }
  switch (bits) {
    case 16:
      return (v, o, x) => v.setInt16(o, clampInt(x, 0x8000, 0x7fff), true);
    case 24:
      return (v, o, x) => write24(v, o, clampInt(x, 0x800000, 0x7fffff));
    case 32:
      return (v, o, x) => v.setInt32(o, clampInt(x, 0x80000000, 0x7fffffff), true);
    default:
      throw new Error(`Unsupported PCM WAV bit depth: ${bits}`);
  }
}

/** Read a signed little-endian 24-bit integer. */
function read24(view: DataView, offset: number): number {
  const b0 = view.getUint8(offset);
  const b1 = view.getUint8(offset + 1);
  const b2 = view.getUint8(offset + 2);
  let value = b0 | (b1 << 8) | (b2 << 16);
  if (value & 0x800000) value |= ~0xffffff; // sign-extend
  return value;
}

/** Write a signed little-endian 24-bit integer. */
function write24(view: DataView, offset: number, value: number): void {
  const v = value < 0 ? value + 0x1000000 : value;
  view.setUint8(offset, v & 0xff);
  view.setUint8(offset + 1, (v >> 8) & 0xff);
  view.setUint8(offset + 2, (v >> 16) & 0xff);
}

/** Clamp a float sample in [-1, 1] to an integer in [-neg, pos]. */
function clampInt(x: number, neg: number, pos: number): number {
  const scaled = x < 0 ? x * neg : x * pos;
  const rounded = Math.round(scaled);
  if (rounded < -neg) return -neg;
  if (rounded > pos) return pos;
  return rounded;
}

function readTag(view: DataView, offset: number): string {
  return (
    String.fromCharCode(view.getUint8(offset)) +
    String.fromCharCode(view.getUint8(offset + 1)) +
    String.fromCharCode(view.getUint8(offset + 2)) +
    String.fromCharCode(view.getUint8(offset + 3))
  );
}

function writeTag(view: DataView, offset: number, tag: string): void {
  for (let i = 0; i < 4; i++) view.setUint8(offset + i, tag.charCodeAt(i));
}
