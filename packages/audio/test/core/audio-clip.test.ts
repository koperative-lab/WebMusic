import {describe, expect, it} from 'vitest';
import {AudioClip} from '../../src/core/model/AudioClip';
import {createRegion} from '../../src/core/model/Region';
import {clipFromJSON} from '../../src/core/serialize/fromJSON';
import {BeatGrid} from '../../src/core/time/BeatGrid';

function sine(length: number, sr = 44100, freq = 440): Float32Array {
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) out[i] = Math.sin((2 * Math.PI * freq * i) / sr);
  return out;
}

describe('AudioClip', () => {
  it('derives length / duration / channels from channelData', () => {
    const clip = new AudioClip({sampleRate: 48000, channelData: [sine(48000), sine(48000)]});
    expect(clip.numberOfChannels).toBe(2);
    expect(clip.length).toBe(48000);
    expect(clip.duration).toBeCloseTo(1);
    expect(clip.hasSamples).toBe(true);
  });

  it('is frozen and protects channel data from external mutation', () => {
    const source = sine(100);
    const original = source[0];
    const clip = new AudioClip({sampleRate: 44100, channelData: [source]});
    expect(Object.isFrozen(clip)).toBe(true);
    expect(clip.channelData(0)).toBeInstanceOf(Float32Array);
    expect(clip.channelData(9)).toBeNull();
    source[0] = 123;
    expect(clip.channelData(0)![0]).toBe(original);
    const exposed = clip.channelData(0)!;
    exposed[0] = 456;
    expect(clip.channelData(0)![0]).toBe(original);
    const exposedChannels = clip.channels()!;
    exposedChannels[0][0] = 789;
    expect(clip.channelData(0)![0]).toBe(original);
  });

  it('slice returns the requested PCM range without exposing its shared internal buffer', () => {
    const ch = sine(44100);
    const clip = new AudioClip({sampleRate: 44100, channelData: [ch]});
    const part = clip.slice(0.25, 0.75);
    expect(part.length).toBe(Math.floor(0.75 * 44100) - Math.floor(0.25 * 44100));
    expect(part.channelData(0)![0]).toBeCloseTo(ch[Math.floor(0.25 * 44100)]);
  });

  it('slice intersects spans and excludes markers outside the selected range', () => {
    const clip = new AudioClip({
      sampleRate: 10,
      channelData: [new Float32Array(100)],
      regions: [
        createRegion({label: 'before', startSeconds: 1, endSeconds: 2}),
        createRegion({label: 'overlap-start', startSeconds: 4, endSeconds: 6}),
        createRegion({label: 'inside', startSeconds: 6, endSeconds: 7}),
        createRegion({label: 'overlap-end', startSeconds: 7, endSeconds: 9}),
        createRegion({label: 'old-marker', startSeconds: 2}),
        createRegion({label: 'marker', startSeconds: 6.5}),
      ],
      beatGrid: new BeatGrid({bpm: 60, beats: [4, 5, 6, 7, 8, 9], downbeats: [4, 8]}),
    });

    const part = clip.slice(5, 8);
    expect(part.regions.map((region) => region.toJSON())).toMatchObject([
      {label: 'overlap-start', startSeconds: 0, endSeconds: 1},
      {label: 'inside', startSeconds: 1, endSeconds: 2},
      {label: 'overlap-end', startSeconds: 2, endSeconds: 3},
      {label: 'marker', startSeconds: 1.5},
    ]);
    expect(part.beatGrid?.beats).toEqual([0, 1, 2, 3]);
    expect(part.beatGrid?.downbeats).toEqual([3]);
  });

  it('rejects invalid decoded and streaming dimensions', () => {
    expect(() => new AudioClip({sampleRate: Number.POSITIVE_INFINITY, channelData: [new Float32Array(1)]})).toThrow(
      /finite positive sampleRate/,
    );
    expect(() => new AudioClip({sampleRate: 44100, channelData: []})).toThrow(/at least one decoded channel/);
    expect(() => new AudioClip({sampleRate: 44100, length: -1, numberOfChannels: 2})).toThrow(/length/);
    expect(() => new AudioClip({sampleRate: 44100, length: 10, numberOfChannels: 0})).toThrow(/numberOfChannels/);
  });

  it('rejects invalid region bounds', () => {
    expect(() => createRegion({label: 'negative', startSeconds: -1})).toThrow(/non-negative/);
    expect(() => createRegion({label: 'backwards', startSeconds: 2, endSeconds: 1})).toThrow(/endSeconds/);
    expect(() => createRegion({label: 'infinite', startSeconds: Number.POSITIVE_INFINITY})).toThrow(/finite/);
  });

  it('supports streaming clips with no samples', () => {
    const clip = new AudioClip({sampleRate: 44100, length: 44100 * 600, numberOfChannels: 2, sourceUrl: 'x.mp3'});
    expect(clip.hasSamples).toBe(false);
    expect(clip.channelData(0)).toBeNull();
    expect(clip.sourceUrl).toBe('x.mp3');
  });

  it('retains the absolute source range through nested streaming slices and JSON', () => {
    const source = new AudioClip({sampleRate: 10, length: 100, numberOfChannels: 2, sourceUrl: 'x.mp3'});
    const middle = source.slice(2, 8);
    const nested = middle.slice(1, 3);

    expect(middle.duration).toBe(6);
    expect(middle.sourceOffsetSeconds).toBe(2);
    expect(nested.duration).toBe(2);
    expect(nested.sourceOffsetSeconds).toBe(3);
    expect(clipFromJSON(nested.toJSON()).sourceOffsetSeconds).toBe(3);
    expect(nested.withMetadata({title: 'excerpt'}).sourceOffsetSeconds).toBe(3);
    expect(source.sourceOffsetSeconds).toBeUndefined();
  });

  it('toJSON omits samples and round-trips with clipFromJSON', () => {
    const clip = new AudioClip({
      sampleRate: 44100,
      channelData: [sine(1000), sine(1000)],
      metadata: {title: 'Song', artist: 'A'},
      regions: [createRegion({label: 'chorus', startSeconds: 1, endSeconds: 2, loop: true})],
    });
    const json = clip.toJSON();
    expect((json as unknown as Record<string, unknown>).channelData).toBeUndefined();
    expect(json.metadata.title).toBe('Song');
    expect(json.regions[0].label).toBe('chorus');

    const channels = clip.channels()!;
    const back = clipFromJSON(json, channels);
    expect(back.length).toBe(clip.length);
    expect(back.numberOfChannels).toBe(2);
    expect(back.regions[0].loop).toBe(true);
    expect(back.metadata.artist).toBe('A');
  });

  it('withMetadata / withRegions return new frozen clips', () => {
    const clip = new AudioClip({sampleRate: 44100, channelData: [sine(100)]});
    const tagged = clip.withMetadata({title: 'New'});
    expect(tagged).not.toBe(clip);
    expect(tagged.metadata.title).toBe('New');
    expect(clip.metadata.title).toBeUndefined();
  });
});
