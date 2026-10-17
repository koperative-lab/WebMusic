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
    await expect(exportAudioSequenceWav(createAudioSequence({sampleRate: 8000.5, channelLayout: ['mono']}), store))
      .rejects.toMatchObject({code: 'resource-limit'});
    expect(read).not.toHaveBeenCalled(); expect(store.getStats().leases).toBe(1); lease.release();
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
