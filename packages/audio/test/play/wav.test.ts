import {describe, expect, it} from 'vitest';
import {parseWav, serializeWav, type WavBitDepth} from '../../src/play/core/wav';

// ---------------------------------------------------------------------------
// Small helpers for hand-building WAV bytes and asserting near-equality.
// ---------------------------------------------------------------------------

function writeAscii(view: DataView, offset: number, text: string): void {
  for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
}

/** Build a minimal canonical 44-byte-header WAV from raw little-endian sample bytes. */
function buildWav(opts: {
  formatCode: number;
  numChannels: number;
  sampleRate: number;
  bitsPerSample: number;
  dataBytes: Uint8Array;
}): ArrayBuffer {
  const {formatCode, numChannels, sampleRate, bitsPerSample, dataBytes} = opts;
  const blockAlign = (bitsPerSample >> 3) * numChannels;
  const buffer = new ArrayBuffer(44 + dataBytes.length);
  const view = new DataView(buffer);
  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataBytes.length, true);
  writeAscii(view, 8, 'WAVE');
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, formatCode, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeAscii(view, 36, 'data');
  view.setUint32(40, dataBytes.length, true);
  new Uint8Array(buffer, 44).set(dataBytes);
  return buffer;
}

function maxAbsError(a: Float32Array, b: Float32Array): number {
  expect(a.length).toBe(b.length);
  let max = 0;
  for (let i = 0; i < a.length; i++) max = Math.max(max, Math.abs(a[i] - b[i]));
  return max;
}

// Quantization error for an N-bit signed integer round trip. The encoder scales
// positives by (2^(bits-1) - 1) and rounds, so worst-case error is ~1.5 LSB
// relative to positive full-scale; 2 LSB is a safe ceiling.
const tolForBits = (bits: number) => 2 / (2 ** (bits - 1) - 1);

describe('parseWav — hand-built byte fixtures', () => {
  it('rejects a buffer too short to hold a RIFF header', () => {
    expect(() => parseWav(new ArrayBuffer(4))).toThrow(/too short/i);
  });

  it('rejects a non-RIFF buffer', () => {
    const buf = new ArrayBuffer(12);
    writeAscii(new DataView(buf), 0, 'JUNKxxxxJUNK');
    expect(() => parseWav(buf)).toThrow(/RIFF/);
  });

  it('rejects RIFF that is not WAVE', () => {
    const buf = new ArrayBuffer(12);
    const v = new DataView(buf);
    writeAscii(v, 0, 'RIFF');
    v.setUint32(4, 4, true);
    writeAscii(v, 8, 'AVI ');
    expect(() => parseWav(buf)).toThrow(/WAVE/);
  });

  it('decodes 16-bit mono with exact reference values', () => {
    // Samples: 0, +full-scale (0x7FFF), -full-scale (-0x8000).
    const data = new Uint8Array([0x00, 0x00, 0xff, 0x7f, 0x00, 0x80]);
    const wav = buildWav({formatCode: 1, numChannels: 1, sampleRate: 8000, bitsPerSample: 16, dataBytes: data});
    const {sampleRate, channelData} = parseWav(wav);
    expect(sampleRate).toBe(8000);
    expect(channelData).toHaveLength(1);
    expect(channelData[0][0]).toBeCloseTo(0, 6);
    expect(channelData[0][1]).toBeCloseTo(32767 / 32768, 6);
    expect(channelData[0][2]).toBeCloseTo(-1, 6);
  });

  it('deinterleaves 16-bit stereo frames', () => {
    // Two frames: [L=+1, R=-1], [L=0, R=+1].
    const data = new Uint8Array([0xff, 0x7f, 0x00, 0x80, 0x00, 0x00, 0xff, 0x7f]);
    const wav = buildWav({formatCode: 1, numChannels: 2, sampleRate: 44100, bitsPerSample: 16, dataBytes: data});
    const {channelData} = parseWav(wav);
    expect(channelData).toHaveLength(2);
    expect(channelData[0][0]).toBeCloseTo(32767 / 32768, 6);
    expect(channelData[1][0]).toBeCloseTo(-1, 6);
    expect(channelData[0][1]).toBeCloseTo(0, 6);
    expect(channelData[1][1]).toBeCloseTo(1 - 1 / 32768, 6);
  });

  it('decodes 8-bit unsigned PCM centred at 128', () => {
    const data = new Uint8Array([128, 255, 0]); // 0, +1, -1
    const wav = buildWav({formatCode: 1, numChannels: 1, sampleRate: 8000, bitsPerSample: 8, dataBytes: data});
    const {channelData} = parseWav(wav);
    expect(channelData[0][0]).toBeCloseTo(0, 6);
    expect(channelData[0][1]).toBeCloseTo(127 / 128, 6);
    expect(channelData[0][2]).toBeCloseTo(-1, 6);
  });

  it('decodes 32-bit IEEE float (format code 3)', () => {
    const floats = new Float32Array([0, 0.5, -0.5, 1]);
    const data = new Uint8Array(floats.buffer.slice(0));
    const wav = buildWav({formatCode: 3, numChannels: 1, sampleRate: 48000, bitsPerSample: 32, dataBytes: data});
    const {channelData} = parseWav(wav);
    expect(Array.from(channelData[0])).toEqual([0, 0.5, -0.5, 1]);
  });

  it('skips unknown chunks (LIST) and still finds data', () => {
    // RIFF | WAVE | LIST(4) | fmt (16) | data(...)
    const sampleData = new Uint8Array([0xff, 0x7f]); // single +1 sample
    const listBody = new Uint8Array([0x49, 0x4e, 0x46, 0x4f]); // "INFO"
    const total = 12 + (8 + listBody.length) + (8 + 16) + (8 + sampleData.length);
    const buffer = new ArrayBuffer(total);
    const view = new DataView(buffer);
    let o = 0;
    writeAscii(view, o, 'RIFF'); view.setUint32(4, total - 8, true); writeAscii(view, 8, 'WAVE'); o = 12;
    writeAscii(view, o, 'LIST'); view.setUint32(o + 4, listBody.length, true);
    new Uint8Array(buffer, o + 8).set(listBody); o += 8 + listBody.length;
    writeAscii(view, o, 'fmt '); view.setUint32(o + 4, 16, true);
    view.setUint16(o + 8, 1, true); view.setUint16(o + 10, 1, true);
    view.setUint32(o + 12, 22050, true); view.setUint32(o + 16, 22050 * 2, true);
    view.setUint16(o + 20, 2, true); view.setUint16(o + 22, 16, true); o += 8 + 16;
    writeAscii(view, o, 'data'); view.setUint32(o + 4, sampleData.length, true);
    new Uint8Array(buffer, o + 8).set(sampleData);

    const {sampleRate, channelData} = parseWav(buffer);
    expect(sampleRate).toBe(22050);
    expect(channelData[0]).toHaveLength(1);
    expect(channelData[0][0]).toBeCloseTo(1 - 1 / 32768, 6);
  });

  it('clamps a streamed (0xFFFFFFFF) data size to remaining bytes', () => {
    const data = new Uint8Array([0xff, 0x7f, 0x00, 0x80]); // two 16-bit samples
    const wav = buildWav({formatCode: 1, numChannels: 1, sampleRate: 8000, bitsPerSample: 16, dataBytes: data});
    new DataView(wav).setUint32(40, 0xffffffff, true); // bogus data size
    const {channelData} = parseWav(wav);
    expect(channelData[0]).toHaveLength(2);
  });
});

describe('serializeWav — header correctness', () => {
  it('writes a canonical 44-byte PCM header', () => {
    const buf = serializeWav([new Float32Array([0, 0.5])], 44100, 16);
    const view = new DataView(buf);
    const tag = (o: number) =>
      String.fromCharCode(view.getUint8(o), view.getUint8(o + 1), view.getUint8(o + 2), view.getUint8(o + 3));
    expect(tag(0)).toBe('RIFF');
    expect(tag(8)).toBe('WAVE');
    expect(tag(12)).toBe('fmt ');
    expect(view.getUint16(20, true)).toBe(1); // PCM
    expect(view.getUint16(22, true)).toBe(1); // mono
    expect(view.getUint32(24, true)).toBe(44100);
    expect(view.getUint16(34, true)).toBe(16);
    expect(tag(36)).toBe('data');
    expect(view.getUint32(40, true)).toBe(2 * 2); // frames * blockAlign
  });

  it('writes format code 3 for float output', () => {
    const buf = serializeWav([new Float32Array([0.25])], 48000, 32, {float: true});
    expect(new DataView(buf).getUint16(20, true)).toBe(3);
  });

  it('throws when float is requested without bitDepth 32', () => {
    expect(() => serializeWav([new Float32Array([0])], 44100, 16, {float: true})).toThrow();
  });

  it('throws for empty channel list or non-positive sample rate', () => {
    expect(() => serializeWav([], 44100, 16)).toThrow();
    expect(() => serializeWav([new Float32Array([0])], 0, 16)).toThrow();
  });

  it('throws when channels differ in length', () => {
    expect(() => serializeWav([new Float32Array([0, 0]), new Float32Array([0])], 44100, 16)).toThrow(/equal length/);
  });

  it('clamps out-of-range samples on the integer path', () => {
    const buf = serializeWav([new Float32Array([2, -2])], 8000, 16);
    const {channelData} = parseWav(buf);
    expect(channelData[0][0]).toBeCloseTo(32767 / 32768, 5);
    expect(channelData[0][1]).toBeCloseTo(-1, 5);
  });
});

describe('serializeWav → parseWav round trips', () => {
  const sampleRate = 44100;

  // A deterministic signal spanning the full [-1, 1] range.
  const makeSignal = (n: number, phase = 0) =>
    Float32Array.from({length: n}, (_, i) => Math.sin((i / n) * Math.PI * 8 + phase) * 0.95);

  for (const bitDepth of [16, 24, 32] as WavBitDepth[]) {
    it(`mono ${bitDepth}-bit integer PCM round-trips within quantization tolerance`, () => {
      const signal = makeSignal(512);
      const wav = serializeWav([signal], sampleRate, bitDepth);
      const decoded = parseWav(wav);
      expect(decoded.sampleRate).toBe(sampleRate);
      expect(decoded.channelData).toHaveLength(1);
      expect(maxAbsError(decoded.channelData[0], signal)).toBeLessThanOrEqual(tolForBits(bitDepth));
    });

    it(`stereo ${bitDepth}-bit integer PCM round-trips and keeps channels distinct`, () => {
      const left = makeSignal(300, 0);
      const right = makeSignal(300, Math.PI / 2);
      const wav = serializeWav([left, right], sampleRate, bitDepth);
      const decoded = parseWav(wav);
      expect(decoded.channelData).toHaveLength(2);
      expect(maxAbsError(decoded.channelData[0], left)).toBeLessThanOrEqual(tolForBits(bitDepth));
      expect(maxAbsError(decoded.channelData[1], right)).toBeLessThanOrEqual(tolForBits(bitDepth));
    });
  }

  it('mono 32-bit float round-trips bit-exactly', () => {
    const signal = makeSignal(256);
    const wav = serializeWav([signal], sampleRate, 32, {float: true});
    const decoded = parseWav(wav);
    // Float32 → Float32 is lossless.
    expect(maxAbsError(decoded.channelData[0], signal)).toBe(0);
  });

  it('stereo 32-bit float round-trips bit-exactly', () => {
    const left = makeSignal(128, 0);
    const right = makeSignal(128, 1);
    const wav = serializeWav([left, right], sampleRate, 32, {float: true});
    const decoded = parseWav(wav);
    expect(maxAbsError(decoded.channelData[0], left)).toBe(0);
    expect(maxAbsError(decoded.channelData[1], right)).toBe(0);
  });

  it('preserves the exact zero and endpoint values across an int round trip', () => {
    const signal = new Float32Array([0, 1, -1, 0.5, -0.5]);
    const decoded = parseWav(serializeWav([signal], sampleRate, 24));
    expect(decoded.channelData[0][0]).toBeCloseTo(0, 5);
    expect(decoded.channelData[0][1]).toBeCloseTo(1, 5);
    expect(decoded.channelData[0][2]).toBeCloseTo(-1, 5);
  });
});
