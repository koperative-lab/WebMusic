import {describe, expect, it, vi} from 'vitest';
import {createAudioClip} from '../../src/core/model/AudioClip';
import {audioChannelLayout, audioEnvelopeGain, audioSequenceAssetIds, createAudioSequence, createMemoryAudioAssetStore,
  readAudioSequenceRange, retainAudioSequence, type AudioAssetSegment} from '../../src/core/sequence';
import {createAudioPositionMap, composeAudioPositionMaps, mapAudioPosition} from '../../src/core/audio-position-map';

function fixture() {
  const store = createMemoryAudioAssetStore();
  const clip = createAudioClip({sampleRate: 8000, channelData: [Float32Array.from([0, 1, 2, 3, 4, 5, 6, 7]) ]});
  const lease = store.registerClip(clip, {id: 'original'});
  const segment: AudioAssetSegment = {kind: 'asset', id: 'segment', assetId: 'original', sourceStart: 0, sourceEnd: 8, gain: 1, envelope: []};
  const sequence = createAudioSequence({sampleRate: 8000, channelLayout: ['mono'], segments: [segment]}, store);
  return {store, clip, lease, segment, sequence};
}
describe('immutable Audio sequence and assets', () => {
  it('uses explicit channel layouts without guessing surround semantics', () => {
    expect(audioChannelLayout(1)).toEqual(['mono']); expect(audioChannelLayout(2)).toEqual(['left', 'right']);
    expect(audioChannelLayout(3)).toEqual(['channel-1', 'channel-2', 'channel-3']);
  });
  it('does not copy whole PCM when importing or reading a bounded range', () => {
    const {store, clip, lease} = fixture();
    const whole = vi.spyOn(Object.getPrototypeOf(clip), 'channelData');
    const out = new Float32Array(2); store.read('original', 3, [out]);
    expect([...out]).toEqual([3, 4]); out[0] = 99;
    store.read('original', 3, [out]); expect([...out]).toEqual([3, 4]); expect(whole).not.toHaveBeenCalled();
    whole.mockRestore(); lease.release();
  });
  it('keeps assets alive until the final lease releases, including after store disposal', () => {
    const {store, clip, lease, sequence} = fixture();
    const owner = retainAudioSequence(sequence, store), another = store.registerClip(clip);
    expect(store.getStats()).toEqual({assets: 1, bytes: 32, leases: 3});
    lease.release(); lease.release(); store.dispose(); another.release();
    expect(store.getStats().leases).toBe(1); const out = new Float32Array(1); store.read('original', 7, [out]); expect(out[0]).toBe(7);
    expect(() => store.registerClip(clip)).toThrow(/disposed/); owner.release(); expect(store.getStats().assets).toBe(0);
  });
  it('retains all or none when an asset is missing', () => {
    const {store, lease} = fixture();
    expect(() => store.retain(['original', 'missing'])).toThrow(/Unknown asset/);
    expect(store.getStats().leases).toBe(1); lease.release();
  });
  it('does not permit asset IDs to identify different content after retirement', () => {
    const {store, lease} = fixture(); lease.release();
    expect(() => store.registerClip(createAudioClip({sampleRate: 8000, channelData: [new Float32Array(8)]}), {id: 'original'})).toThrow(/reused/);
  });
  it('rejects streaming-only input, mismatched format and source bounds', () => {
    const {store, lease, segment} = fixture();
    expect(() => store.registerClip(createAudioClip({sampleRate: 8000, length: 10, numberOfChannels: 1}))).toThrow(/decoded/);
    expect(() => createAudioSequence({sampleRate: 9000, channelLayout: ['mono'], segments: [segment]}, store)).toThrow(/format/);
    expect(() => createAudioSequence({sampleRate: 8000, channelLayout: ['left'], segments: [segment]}, store)).toThrow(/format/);
    expect(() => createAudioSequence({sampleRate: 8000, channelLayout: ['mono'], segments: [{...segment, sourceEnd: 9}]}, store)).toThrow(/bounds/);
    lease.release();
  });
  it('rejects unsafe summed lengths and malformed envelopes before rendering', () => {
    const {store, lease, segment} = fixture();
    expect(() => createAudioSequence({sampleRate: 8000, channelLayout: ['mono'], segments: [
      {kind: 'silence', id: 'a', length: Number.MAX_SAFE_INTEGER}, {kind: 'silence', id: 'b', length: 1}]})).toThrow(/safe integer/);
    for (const points of [[{frame: 9, gain: 0}], [{frame: 2, gain: 0}, {frame: 1, gain: 1}], [{frame: 0, gain: -1}]]) {
      expect(() => createAudioSequence({sampleRate: 8000, channelLayout: ['mono'], segments: [{...segment, envelope: points}]}, store)).toThrow();
    }
    lease.release();
  });
  it('removes zero length segments and freezes all stored data', () => {
    const sequence = createAudioSequence({sampleRate: 8000, channelLayout: ['mono'], segments: [{kind: 'silence', id: 'zero', length: 0}]});
    expect(sequence.length).toBe(0); expect(sequence.segments).toEqual([]); expect(Object.isFrozen(sequence.channelLayout)).toBe(true);
  });
  it('copies a range across segments with gain, envelopes and silence', () => {
    const {store, lease, segment} = fixture();
    const sequence = createAudioSequence({sampleRate: 8000, channelLayout: ['mono'], segments: [
      {...segment, sourceStart: 2, sourceEnd: 6, gain: .5, envelope: [{frame: 0, gain: 0}, {frame: 4, gain: 1}]},
      {kind: 'silence', id: 'silence', length: 2}, {...segment, id: 'again', sourceEnd: 2},
    ]}, store);
    const out = new Float32Array(6); readAudioSequenceRange(sequence, store, 1, [out]);
    expect([...out]).toEqual([.375, 1, 1.875, 0, 0, 0]); expect(audioSequenceAssetIds(sequence)).toEqual(['original']);
    expect(audioEnvelopeGain(segment.envelope, 2)).toBe(1); lease.release();
  });
  it('checks read bounds and destination format atomically', () => {
    const {store, lease} = fixture(); const out = new Float32Array([99, 99]);
    expect(() => store.read('original', 7, [out])).toThrow(/bounds/); expect([...out]).toEqual([99, 99]);
    expect(() => store.read('original', 0, [out, out])).toThrow(/layout/); lease.release();
  });
});
describe('Audio frame position maps', () => {
  const deletion = createAudioPositionMap('doc', 0, 1, [{type: 'splice', startFrame: 3, deleteCount: 4, insertCount: 0, length: 6}]);
  const undo = createAudioPositionMap('doc', 1, 2, [{type: 'splice', startFrame: 3, deleteCount: 0, insertCount: 4, length: 10}]);
  it('maps surviving content and marks collapsed deleted anchors', () => {
    expect(mapAudioPosition(deletion, 8)).toMatchObject({frame: 4, deleted: false});
    expect(mapAudioPosition(deletion, 4)).toMatchObject({frame: 3, deleted: true});
    expect(mapAudioPosition(deletion, 7)).toMatchObject({frame: 3, deleted: false});
  });
  it('honors insertion affinity and retains lost-position information across undo', () => {
    expect(mapAudioPosition(undo, 3, 'left').frame).toBe(3); expect(mapAudioPosition(undo, 3, 'right').frame).toBe(7);
    expect(mapAudioPosition(composeAudioPositionMaps(deletion, undo), 5)).toMatchObject({frame: 3, deleted: true});
    expect(mapAudioPosition(composeAudioPositionMaps(deletion, undo), 8)).toMatchObject({frame: 8, deleted: false});
  });
  it('rejects gaps/foreign identities and propagates explicit reset', () => {
    expect(() => composeAudioPositionMaps(deletion, deletion)).toThrow(/continuous/);
    const reset = createAudioPositionMap('doc', 1, 2, [{type: 'reset', length: 10}]);
    expect(mapAudioPosition(composeAudioPositionMaps(deletion, reset), 8)).toMatchObject({frame: 0, positionPolicy: 'reset-origin'});
  });
});

describe('sequence input normalization', () => {
  it('defaults gain and envelopes while retaining a readonly normalized representation', () => {
    const {store, lease} = fixture();
    const sequence = createAudioSequence({sampleRate: 8000, channelLayout: ['mono'], segments: [{kind: 'asset', id: 'a', assetId: 'original', sourceStart: 0, sourceEnd: 8}]}, store);
    expect(sequence.segments[0]).toMatchObject({gain: 1, envelope: []}); lease.release();
  });
  it('uses the private bounded PCM seam across separately loaded modules', async () => {
    const origin = await import('../../src/core/model/AudioClip');
    const source = origin.createAudioClip({sampleRate: 8000, channelData: [Float32Array.from([.1, .2, .3, .4])]});
    vi.resetModules();
    const consumer = await import('../../src/core/sequence');
    const store = consumer.createMemoryAudioAssetStore(), lease = store.registerClip(source);
    const out = new Float32Array(2); store.read(lease.assetIds[0], 1, [out]);
    expect(out[0]).toBeCloseTo(.2); expect(out[1]).toBeCloseTo(.3); lease.release();
  });
  it('supports long metadata-only output without allocating a document-sized buffer', () => {
    const sequence = createAudioSequence({sampleRate: 48000, channelLayout: ['left', 'right'], segments: [{kind: 'silence', id: 'hour', length: 48000 * 3600}]});
    const out = [new Float32Array(16), new Float32Array(16)];
    readAudioSequenceRange(sequence, createMemoryAudioAssetStore(), sequence.length - 16, out);
    expect(out[0]).toEqual(new Float32Array(16)); expect(sequence.length).toBe(172800000);
  });
});

describe('retained backing-buffer accounting', () => {
  it('charges a short zero-copy slice for its whole retained buffer and deduplicates the same clip', () => {
    const original = createAudioClip({sampleRate: 1000, channelData: [new Float32Array(10000)]});
    const slice = original.slice(1, 1.01);
    expect(slice.length).toBe(10);
    const store = createMemoryAudioAssetStore(), first = store.registerClip(slice), second = store.registerClip(slice);
    expect(first.assetIds).toEqual(second.assetIds);
    expect(store.getDescriptor(first.assetIds[0])).toMatchObject({length: 10, byteLength: 40000});
    expect(store.getStats()).toEqual({assets: 1, bytes: 40000, leases: 2}); first.release(); second.release();
  });
  it('conservatively charges distinct sliced assets sharing one backing buffer separately', () => {
    const original = createAudioClip({sampleRate: 1000, channelData: [new Float32Array(10000)]});
    const store = createMemoryAudioAssetStore(), a = store.registerClip(original.slice(0, 1)), b = store.registerClip(original.slice(1, 2));
    expect(store.getStats().bytes).toBe(80000); a.release(); b.release();
  });
  it('retains backing size through independently loaded modules without exposing PCM', async () => {
    const origin = await import('../../src/core/model/AudioClip');
    const slice = origin.createAudioClip({sampleRate: 1000, channelData: [new Float32Array(10000)]}).slice(1, 1.01);
    vi.resetModules();
    const consumer = await import('../../src/core/sequence'); const store = consumer.createMemoryAudioAssetStore();
    const lease = store.registerClip(slice);
    expect(store.getDescriptor(lease.assetIds[0])!.byteLength).toBe(40000); lease.release();
  });
  it('does not silently estimate legacy clips missing the private accounting capability', () => {
    const source = clipWithoutAccounting();
    expect(() => createMemoryAudioAssetStore().registerClip(source)).toThrow(/retained PCM byte accounting/);
  });
});
function clipWithoutAccounting() {
  const clip = createAudioClip({sampleRate: 1000, channelData: [new Float32Array(10)]});
  return new Proxy(clip, {get(target, key, receiver) {
    if (key === Symbol.for('@webmusic/audio/clip-retained-pcm-bytes')) return undefined;
    return Reflect.get(target, key, receiver);
  }});
}
