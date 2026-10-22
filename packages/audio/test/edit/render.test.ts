import {describe, expect, it, vi} from 'vitest';
import {createAudioClip} from '../../src/core/model/AudioClip';
import {createAudioSequence, createMemoryAudioAssetStore, type AudioAssetReader} from '../../src/core/sequence';
import {renderAudioSequence, exportAudioSequenceWav} from '../../src/edit/api/render';
import {parseWav} from '../../src/core/serialize/wav';

function fixture() {
  const store = createMemoryAudioAssetStore();
  const lease = store.registerClip(createAudioClip({sampleRate: 8000, channelData: [new Float32Array([1, .5, -.5, -1])]}));
  const sequence = createAudioSequence({sampleRate: 8000, channelLayout: ['mono'], segments: [
    {kind: 'asset', id: 'note', assetId: lease.assetIds[0], sourceStart: 0, sourceEnd: 4, gain: .5,
      envelope: [{frame: 0, gain: 0}, {frame: 4, gain: 1}]}, {kind: 'silence', id: 'pause', length: 2},
  ]}, store);
  return {store, lease, sequence};
}
describe('explicit Audio sequence rendering and WAV export', () => {
  it('renders gain, envelope and silence in bounded reads and preserves immutable assets', async () => {
    const {store, lease, sequence} = fixture();
    const read = vi.fn(store.read), assets = {...store, read};
    const out = await renderAudioSequence(sequence, assets, {chunkFrames: 2});
    expect([...out.channelData[0]]).toEqual([0, .0625, -.125, -.375, 0, 0]);
    expect(read.mock.calls.every((call) => call[2][0].length <= 2)).toBe(true);
    out.channelData[0][1] = 99;
    const original = new Float32Array(4); store.read(lease.assetIds[0], 0, [original]);
    expect([...original]).toEqual([1, .5, -.5, -1]);
    expect(store.getStats().leases).toBe(1); lease.release();
  });
  it('exports an exact selected range and supports ready empty output', async () => {
    const {store, lease, sequence} = fixture();
    const wav = await exportAudioSequenceWav(sequence, store, {startFrame: 1, endFrame: 5, bitDepth: 32, float: true});
    expect(parseWav(wav).channelData[0]).toEqual(new Float32Array([.0625, -.125, -.375, 0]));
    const empty = createAudioSequence({sampleRate: 8000, channelLayout: ['mono']});
    expect((await exportAudioSequenceWav(empty, store)).byteLength).toBe(44);
    lease.release();
  });
  it('checks combined PCM/WAV budgets and invalid ranges before any sample reads', async () => {
    const {store, lease, sequence} = fixture(); const read = vi.fn(store.read);
    await expect(exportAudioSequenceWav(sequence, {...store, read}, {maxBytes: 50})).rejects.toMatchObject({code: 'resource-limit'});
    await expect(renderAudioSequence(sequence, {...store, read}, {endFrame: 7})).rejects.toMatchObject({code: 'invalid-range'});
    await expect(exportAudioSequenceWav(sequence, store, {float: true})).rejects.toMatchObject({code: 'invalid-command'});
    for (const format of [{sampleRate: 8000.5, channelLayout: ['mono']}, {sampleRate: 2 ** 31, channelLayout: ['left', 'right']}]) {
      await expect(exportAudioSequenceWav(createAudioSequence(format), store)).rejects.toMatchObject({code: 'incompatible-audio-format'});
    }
    expect(read).not.toHaveBeenCalled(); expect(store.getStats().leases).toBe(1); lease.release();
  });
  it('rejects data beyond the RIFF size field before rendering, including an odd chunk pad byte', async () => {
    const store = createMemoryAudioAssetStore(), read = vi.fn(store.read), assets = {...store, read};
    const silence = (length: number) => createAudioSequence({sampleRate: 8000, channelLayout: ['mono'], segments: [{kind: 'silence', id: 'long', length}]});
    const riff = {code: 'resource-limit', message: expect.stringMatching(/RIFF/)};
    await expect(exportAudioSequenceWav(silence(2 ** 30), assets, {bitDepth: 32, maxBytes: Number.MAX_SAFE_INTEGER})).rejects.toMatchObject(riff);
    // 24-bit mono data ending exactly at the size field overflows only with its pad; the budget admits the unpadded job.
    const frames = (0xffffffff - 36) / 3;
    await expect(exportAudioSequenceWav(silence(frames), assets, {bitDepth: 24, maxBytes: frames * 7 + 43})).rejects.toMatchObject(riff);
    expect(read).not.toHaveBeenCalled();
  });
  it('writes 24- and 32-bit integer PCM with matching byte rate and block alignment', async () => {
    const {store, lease, sequence} = fixture();
    const stereo = createAudioSequence({sampleRate: 8000, channelLayout: ['left', 'right'], segments: [{kind: 'silence', id: 's', length: 3}]});
    for (const [content, bitDepth] of [[sequence, 24], [sequence, 32], [stereo, 24], [stereo, 32]] as const) {
      const wav = await exportAudioSequenceWav(content, store, {bitDepth}), view = new DataView(wav);
      const channels = content.channelLayout.length, blockAlign = channels * bitDepth / 8;
      expect({format: view.getUint16(20, true), channels: view.getUint16(22, true), sampleRate: view.getUint32(24, true),
        byteRate: view.getUint32(28, true), blockAlign: view.getUint16(32, true), bits: view.getUint16(34, true), data: view.getUint32(40, true)})
        .toEqual({format: 1, channels, sampleRate: 8000, byteRate: 8000 * blockAlign, blockAlign, bits: bitDepth, data: content.length * blockAlign});
      const decoded = parseWav(wav).channelData;
      expect(decoded).toHaveLength(channels);
      if (content === sequence) [0, .0625, -.125, -.375, 0, 0].forEach((value, index) => expect(decoded[0][index]).toBeCloseTo(value, 6));
    }
    lease.release();
  });
  it('pads an odd 24-bit data chunk and charges the pad byte to the export budget', async () => {
    const {store, lease, sequence} = fixture(), options = {endFrame: 5, bitDepth: 24} as const;
    const wav = await exportAudioSequenceWav(sequence, store, options), view = new DataView(wav);
    expect(wav.byteLength).toBe(44 + 15 + 1); expect(view.getUint32(4, true)).toBe(wav.byteLength - 8);
    expect(view.getUint32(40, true)).toBe(15); expect(view.getUint8(wav.byteLength - 1)).toBe(0);
    expect(parseWav(wav).channelData[0]).toHaveLength(5);
    // Five float PCM frames plus the padded WAV allocation.
    const required = 5 * 4 + wav.byteLength;
    await expect(exportAudioSequenceWav(sequence, store, {...options, maxBytes: required - 1})).rejects.toMatchObject({code: 'resource-limit'});
    expect((await exportAudioSequenceWav(sequence, store, {...options, maxBytes: required})).byteLength).toBe(wav.byteLength);
    lease.release();
  });
  it('retains a source after its current owner releases it and releases the job lease on cancellation', async () => {
    const {store, lease, sequence} = fixture(); const controller = new AbortController();
    const assets: AudioAssetReader = {...store, read(id, start, out) {
      store.read(id, start, out); lease.release(); store.dispose(); controller.abort();
    }};
    await expect(renderAudioSequence(sequence, assets, {chunkFrames: 1, signal: controller.signal})).rejects.toMatchObject({name: 'AbortError'});
    expect(store.getStats()).toEqual({assets: 0, bytes: 0, leases: 0});
  });
  it('releases retained assets on read failure', async () => {
    const {store, lease, sequence} = fixture();
    await expect(renderAudioSequence(sequence, {...store, read() {throw new Error('read failed');}})).rejects.toThrow('read failed');
    expect(store.getStats().leases).toBe(1); lease.release();
  });
});
