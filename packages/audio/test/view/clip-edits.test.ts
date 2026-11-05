import {describe, expect, it} from 'vitest';
import {createAudioClip, readAudioSequenceRange, type AudioSequence} from '../../src/core';
import {applyAudioOperations} from '../../src/view/core/edit-operations';
import {
  audioFadeGain, audioRangeFadeOperations, audioRangeGainOperations, audioRangeSilenceOperations, audioSplitOperations,
  decibelsToGain, editAudioEnvelope, gainToDecibels, nearestAudioZeroCrossing,
} from '../../src/view/core/clip-edits';
import {createAudioRangeProcessor} from '../../src/view/api/processor';
import {createAudioClipEditor} from '../../src/view/headless';

const constant = (length = 1000, value = 1) => createAudioClip({sampleRate: 100, channelData: [new Float32Array(length).fill(value)]});
const ids = () => { let index = 0; return () => `piece-${++index}`; };
function samples(editor: ReturnType<typeof createAudioClipEditor>, content: AudioSequence = editor.getSnapshot().content): Float32Array {
  const channel = new Float32Array(content.length);
  readAudioSequenceRange(content, editor.getSnapshot().assets, 0, [channel]);
  return channel;
}
function apply(editor: ReturnType<typeof createAudioClipEditor>, operations: Parameters<typeof applyAudioOperations>[2]) {
  return applyAudioOperations(editor.getSnapshot().content, editor.getSnapshot().assets, operations).content;
}

describe('range gain, fades and silence', () => {
  it('amplifies only the selected range through splits and segment gain', () => {
    const editor = createAudioClipEditor(constant());
    const content = apply(editor, audioRangeGainOperations(editor.getSnapshot().content, {startFrame: 200, endFrame: 400}, .5, ids()));
    expect(content.segments).toHaveLength(3);
    const pcm = samples(editor, content);
    expect([pcm[199], pcm[200], pcm[399], pcm[400]]).toEqual([1, .5, .5, 1]);
    expect(content.length).toBe(1000);
    editor.dispose();
  });

  it('fades a range with each curve and keeps existing envelope shaping', () => {
    const editor = createAudioClipEditor(constant());
    for (const curve of ['linear', 'logarithmic', 'cosine'] as const) {
      const content = apply(editor, audioRangeFadeOperations(editor.getSnapshot().content, {startFrame: 0, endFrame: 400}, 'in', curve, ids()));
      const pcm = samples(editor, content);
      expect(pcm[0]).toBeCloseTo(0, 5);
      expect(pcm[200]).toBeCloseTo(audioFadeGain(curve, .5), 1);
      expect(pcm[500]).toBe(1);
    }
    const halved = apply(editor, [{type: 'set-envelope', segmentId: editor.getSnapshot().content.segments[0].id, points: [{frame: 0, gain: .5}, {frame: 1000, gain: .5}]}]);
    const faded = applyAudioOperations(halved, editor.getSnapshot().assets, audioRangeFadeOperations(halved, {startFrame: 600, endFrame: 1000}, 'out', 'linear', ids())).content;
    const pcm = samples(editor, faded);
    expect(pcm[600]).toBeCloseTo(.5, 3);
    expect(pcm[800]).toBeCloseTo(.25, 2);
    editor.dispose();
  });

  it('replaces a range with silence of the same length', () => {
    const editor = createAudioClipEditor(constant());
    const content = apply(editor, audioRangeSilenceOperations(editor.getSnapshot().content, {startFrame: 100, endFrame: 300}, ids()));
    const pcm = samples(editor, content);
    expect([pcm[99], pcm[100], pcm[299], pcm[300]]).toEqual([1, 0, 0, 1]);
    expect(content.length).toBe(1000);
    editor.dispose();
  });

  it('rejects empty or outside ranges and unknown curves', () => {
    const editor = createAudioClipEditor(constant());
    const content = editor.getSnapshot().content;
    expect(() => audioRangeGainOperations(content, {startFrame: 5, endFrame: 5}, 2, ids())).toThrow(/nonempty range/);
    expect(() => audioRangeGainOperations(content, {startFrame: 0, endFrame: 2000}, 2, ids())).toThrow(/nonempty range/);
    expect(() => audioRangeFadeOperations(content, {startFrame: 0, endFrame: 10}, 'in', 'square' as never, ids())).toThrow(/Unknown fade curve/);
    editor.dispose();
  });

  it('splits only inside segments and reports the new pieces', () => {
    const editor = createAudioClipEditor(constant());
    const {operations, spans} = audioSplitOperations(editor.getSnapshot().content, [0, 250, 250, 1000], ids());
    expect(operations).toHaveLength(1);
    expect(spans.map((span) => [span.segment.id, span.start, span.end])).toEqual([['piece-1', 0, 250], ['piece-2', 250, 1000]]);
    editor.dispose();
  });
});

describe('helpers', () => {
  it('converts decibels and edits envelope points', () => {
    expect(decibelsToGain(-6)).toBeCloseTo(.501, 3);
    expect(gainToDecibels(2)).toBeCloseTo(6.02, 2);
    expect(gainToDecibels(0)).toBe(-Infinity);
    const points = editAudioEnvelope([{frame: 0, gain: 1}, {frame: 100, gain: 1}], {add: {frame: 50, gain: .2}});
    expect(points.map((point) => point.frame)).toEqual([0, 50, 100]);
    expect(editAudioEnvelope(points, {move: 1, to: {frame: 60, gain: .4}})[1]).toEqual({frame: 60, gain: .4});
    expect(editAudioEnvelope(points, {remove: 1})).toHaveLength(2);
    expect(() => editAudioEnvelope(points, {add: {frame: -1, gain: 1}})).toThrow(/nonnegative/);
  });

  it('snaps to the nearest zero crossing', () => {
    const wave = createAudioClip({sampleRate: 100, channelData: [Float32Array.from({length: 400}, (_, index) => Math.sin(index / 10))]});
    const editor = createAudioClipEditor(wave);
    const {content, assets} = editor.getSnapshot();
    const crossing = nearestAudioZeroCrossing(content, assets, 30, 40);
    expect(crossing).toBe(32);
    expect(nearestAudioZeroCrossing(content, assets, 0, 0)).toBe(0);
    editor.dispose();
  });
});

describe('set-annotations', () => {
  it('replaces markers and validates them', () => {
    const editor = createAudioClipEditor(constant());
    const result = editor.execute({version: 1, documentId: editor.getSnapshot().documentId, expectedRevision: 0, label: 'Add marker',
      operations: [{type: 'set-annotations', annotations: [{id: 'm1', startFrame: 120, anchoring: 'content', label: 'Marker 1'}]}]});
    expect(result.status).toBe('committed');
    expect(editor.getSnapshot().content.annotations).toEqual([{id: 'm1', startFrame: 120, anchoring: 'content', label: 'Marker 1'}]);
    const bad = editor.execute({version: 1, documentId: editor.getSnapshot().documentId, expectedRevision: 1, label: 'Bad marker',
      operations: [{type: 'set-annotations', annotations: [{id: 'm2', startFrame: 5000, anchoring: 'content'}]}]});
    expect(bad.status).toBe('failed');
    expect(() => applyAudioOperations(editor.getSnapshot().content, editor.getSnapshot().assets,
      [{type: 'set-annotations', annotations: [{id: 'm3', startFrame: 1, anchoring: 'content', color: 'red'} as never]}])).toThrow(/Unknown annotation fields/);
    editor.undo();
    expect(editor.getSnapshot().content.annotations).toEqual([]);
    editor.dispose();
  });
});

describe('processors', () => {
  async function run(kind: Parameters<typeof createAudioRangeProcessor>[0], input: Float32Array) {
    const output = await createAudioRangeProcessor(kind).process({channels: [input], sampleRate: 100, selectionOffset: 0,
      selectionLength: input.length, parameters: {}, signal: new AbortController().signal});
    return output.channels()![0];
  }

  it('inverts polarity and removes DC offset', async () => {
    expect([...await run('invert', Float32Array.from([.5, -.25, 0]))]).toEqual([-.5, .25, -0]);
    const centered = await run('remove-dc', Float32Array.from([1, 2, 3]));
    expect([...centered]).toEqual([-1, 0, 1]);
  });

  it('runs through the clip editor and reports its processors', async () => {
    const editor = createAudioClipEditor(constant(100, .5), {processors: [createAudioRangeProcessor('invert')]});
    expect(editor.processorDescriptors).toEqual([{id: 'invert', version: 1}]);
    const snapshot = editor.getSnapshot();
    const result = await editor.processRange({documentId: snapshot.documentId, expectedRevision: 0, startFrame: 10, endFrame: 20,
      processorId: 'invert', processorVersion: 1, parameters: {}, assetId: 'inverted', segmentId: 'inverted-segment', rightId: 'tail'});
    expect(result.status).toBe('committed');
    const pcm = samples(editor);
    expect([pcm[9], pcm[10], pcm[19], pcm[20]]).toEqual([.5, -.5, -.5, .5]);
    editor.dispose();
  });

  it('rejects unknown kinds', () => {
    expect(() => createAudioRangeProcessor('echo' as never)).toThrow(/Expected normalize/);
  });
});

describe('fade handles', () => {
  it('reads and replaces a fade at either end without touching the middle', async () => {
    const {audioFadeLength, audioSegmentFadeEnvelope} = await import('../../src/view/core/clip-edits');
    const fadeIn = audioSegmentFadeEnvelope([], 1000, 'in', 200, 'linear');
    expect(audioFadeLength(fadeIn, 1000, 'in')).toBe(200);
    expect(fadeIn[0]).toEqual({frame: 0, gain: 0});
    const both = audioSegmentFadeEnvelope(fadeIn, 1000, 'out', 300, 'cosine');
    expect(audioFadeLength(both, 1000, 'in')).toBe(200);
    expect(audioFadeLength(both, 1000, 'out')).toBe(300);
    const shorter = audioSegmentFadeEnvelope(both, 1000, 'in', 50, 'linear');
    expect(audioFadeLength(shorter, 1000, 'in')).toBe(50);
    expect(audioFadeLength(shorter, 1000, 'out')).toBe(300);
    expect(audioSegmentFadeEnvelope(fadeIn, 1000, 'in', 0, 'linear')).toEqual([]);
  });
});
