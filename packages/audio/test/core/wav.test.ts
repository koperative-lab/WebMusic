import {describe, expect, it} from 'vitest';
import {parseWav, serializeWav} from '../../src/core/serialize/wav';
import * as playWav from '../../src/play/core/wav';

/** RIFF/WAVE bytes from raw chunks, each followed by a pad byte when its body is odd. */
function riff(chunks: readonly {readonly id: string; readonly body: readonly number[]}[]): ArrayBuffer {
  const size = chunks.reduce((sum, chunk) => sum + 8 + chunk.body.length + chunk.body.length % 2, 4);
  const bytes = new Uint8Array(8 + size), view = new DataView(bytes.buffer);
  const tag = (offset: number, text: string) => {for (let index = 0; index < 4; index++) bytes[offset + index] = text.charCodeAt(index);};
  tag(0, 'RIFF'); view.setUint32(4, size, true); tag(8, 'WAVE');
  let offset = 12;
  for (const chunk of chunks) {
    tag(offset, chunk.id); view.setUint32(offset + 4, chunk.body.length, true); bytes.set(chunk.body, offset + 8);
    offset += 8 + chunk.body.length + chunk.body.length % 2;
  }
  return bytes.buffer;
}
const fmt24 = (channels: number, rate: number) => {
  const view = new DataView(new ArrayBuffer(16));
  view.setUint16(0, 1, true); view.setUint16(2, channels, true); view.setUint32(4, rate, true);
  view.setUint32(8, rate * channels * 3, true); view.setUint16(12, channels * 3, true); view.setUint16(14, 24, true);
  return [...new Uint8Array(view.buffer)];
};

describe('RIFF word alignment', () => {
  it('appends one zero pad byte after an odd data chunk and counts it only in the RIFF size', () => {
    for (const channels of [[new Float32Array([.5, -.5, .25])], [new Float32Array([.5]), new Float32Array([-.5]), new Float32Array([.25])]]) {
      const wav = serializeWav(channels, 8000, 24), view = new DataView(wav);
      expect(wav.byteLength).toBe(44 + 9 + 1); expect(view.getUint32(4, true)).toBe(wav.byteLength - 8);
      expect(view.getUint32(40, true)).toBe(9); expect(view.getUint8(53)).toBe(0);
      const decoded = parseWav(wav);
      expect(decoded.channelData.map((channel) => channel.length)).toEqual(channels.map((channel) => channel.length));
      expect(decoded.channelData.flatMap((channel) => [...channel])).toEqual([.5, -.5, .25].map((value) => expect.closeTo(value, 6)));
    }
    const even = serializeWav([new Float32Array(2)], 8000, 24);
    expect(even.byteLength).toBe(44 + 6); expect(new DataView(even).getUint32(4, true)).toBe(36 + 6);
  });
  it('walks odd-sized chunks and their pad bytes before and after data', () => {
    const wav = riff([{id: 'LIST', body: [0x49, 0x4e, 0x46, 0x4f, 0x21]}, {id: 'fmt ', body: fmt24(1, 22050)},
      {id: 'data', body: [0, 0, 0x40, 0, 0, 0xc0, 0, 0, 0]}, {id: 'junk', body: [1, 2, 3]}]);
    const {sampleRate, channelData} = parseWav(wav);
    expect(sampleRate).toBe(22050); expect([...channelData[0]]).toEqual([.5, -.5, 0]);
  });
  it('keeps the Play WAV entry re-exporting the shared Core codec', () => {
    expect(playWav.serializeWav).toBe(serializeWav); expect(playWav.parseWav).toBe(parseWav);
  });
});
