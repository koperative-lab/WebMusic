import {describe, expect, it} from 'vitest';
import {AudioClip} from '../../src/core/model/AudioClip';
import {createClipEditSession} from '../../src/core/model/ClipEditSession';
import {createRegion} from '../../src/core/model/Region';
import {BeatGrid} from '../../src/core/time/BeatGrid';

const sr = 1000;

function ramp(length: number, value = 1): Float32Array {
  return new Float32Array(length).fill(value);
}

describe('ClipEditSession', () => {
  it('cut removes a range and shortens the clip', () => {
    const clip = new AudioClip({sampleRate: sr, channelData: [ramp(1000)]});
    const out = createClipEditSession(clip).cut(0.2, 0.5).apply();
    expect(out.length).toBe(1000 - 300);
    expect(out).not.toBe(clip);
    expect(clip.length).toBe(1000); // base untouched
  });

  it('gain scales a sub-range', () => {
    const clip = new AudioClip({sampleRate: sr, channelData: [ramp(100, 1)]});
    const out = createClipEditSession(clip).gain(0.5, 0, 0.05).apply();
    const data = out.channelData(0)!;
    expect(data[0]).toBeCloseTo(0.5);
    expect(data[60]).toBeCloseTo(1);
  });

  it('normalize scales peak to target', () => {
    const ch = new Float32Array([0.1, -0.25, 0.2]);
    const clip = new AudioClip({sampleRate: sr, channelData: [ch]});
    const out = createClipEditSession(clip).normalize(1).apply();
    const data = out.channelData(0)!;
    const peak = Math.max(...Array.from(data).map(Math.abs));
    expect(peak).toBeCloseTo(1);
  });

  it('fadeIn ramps from 0 to original', () => {
    const clip = new AudioClip({sampleRate: sr, channelData: [ramp(100, 1)]});
    const out = createClipEditSession(clip).fadeIn(0.05).apply();
    const data = out.channelData(0)!;
    expect(data[0]).toBeCloseTo(0);
    expect(data[99]).toBeCloseTo(1);
  });

  it('reverse mirrors samples', () => {
    const ch = new Float32Array([1, 2, 3, 4]);
    const clip = new AudioClip({sampleRate: sr, channelData: [ch]});
    const out = createClipEditSession(clip).reverse().apply();
    expect(Array.from(out.channelData(0)!)).toEqual([4, 3, 2, 1]);
  });

  it('chains ops and records serializable edits', () => {
    const clip = new AudioClip({sampleRate: sr, channelData: [ramp(1000)]});
    const session = createClipEditSession(clip).cut(0, 0.1).fadeOut(0.05).normalize(0.9);
    expect(session.edits.map((e) => e.op)).toEqual(['cut', 'fade', 'normalize']);
    expect(session.apply().length).toBe(900);
  });

  it('rejects non-finite and backwards edit ranges before applying them', () => {
    const clip = new AudioClip({sampleRate: sr, channelData: [ramp(100)]});
    expect(() => createClipEditSession(clip).cut(0.08, 0.02)).toThrow(/endSeconds/);
    expect(() => createClipEditSession(clip).gain(Number.NaN)).toThrow(/finite/);
    expect(() => createClipEditSession(clip).fadeIn(Number.POSITIVE_INFINITY)).toThrow(/finite/);
    expect(() => createClipEditSession(clip).insertSilence(0, -1)).toThrow(/non-negative/);
  });

  it('updates regions and beat-grid positions for structural edits', () => {
    const clip = new AudioClip({
      sampleRate: 10,
      channelData: [ramp(100)],
      metadata: {title: 'Annotated'},
      regions: [
        createRegion({label: 'before', startSeconds: 1, endSeconds: 2}),
        createRegion({label: 'across', startSeconds: 2, endSeconds: 7}),
        createRegion({label: 'removed', startSeconds: 4}),
        createRegion({label: 'after', startSeconds: 8}),
      ],
      beatGrid: new BeatGrid({bpm: 60, beats: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10], downbeats: [0, 4, 8]}),
    });

    const out = createClipEditSession(clip).cut(3, 6).insertSilence(1, 2).apply();
    expect(out.metadata.title).toBe('Annotated');
    expect(out.duration).toBe(9);
    expect(out.regions.map((region) => region.toJSON())).toMatchObject([
      {label: 'before', startSeconds: 3, endSeconds: 4},
      {label: 'across', startSeconds: 4, endSeconds: 6},
      {label: 'after', startSeconds: 7},
    ]);
    expect(out.beatGrid?.beats).toEqual([0, 3, 4, 5, 6, 7, 8, 9]);
    expect(out.beatGrid?.downbeats).toEqual([0, 7]);
  });

  it('mirrors annotations when reversing a clip', () => {
    const clip = new AudioClip({
      sampleRate: 10,
      channelData: [ramp(100)],
      regions: [createRegion({label: 'span', startSeconds: 2, endSeconds: 4}), createRegion({label: 'cue', startSeconds: 1})],
      beatGrid: new BeatGrid({bpm: 60, beats: [0, 2, 4, 6, 8, 10], downbeats: [0, 4, 8]}),
    });
    const out = createClipEditSession(clip).reverse().apply();
    expect(out.regions.map((region) => region.toJSON())).toMatchObject([
      {label: 'span', startSeconds: 6, endSeconds: 8},
      {label: 'cue', startSeconds: 9},
    ]);
    expect(out.beatGrid?.beats).toEqual([0, 2, 4, 6, 8, 10]);
    expect(out.beatGrid?.downbeats).toEqual([2, 6, 10]);
  });
});
