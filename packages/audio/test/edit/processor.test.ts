import {describe, expect, it, vi} from 'vitest';
import {createAudioClip} from '../../src/core/model/AudioClip';
import {createAudioClipEditor} from '../../src/edit/headless/audio-clip-editor';
import {createAudioRangeProcessor} from '../../src/edit/api/processor';
import {renderAudioSequence} from '../../src/edit/api/render';

describe('built-in selected-range processors', () => {
  it('normalizes stereo with one shared factor, keeps surrounding samples and reuses output during history travel', async () => {
    const processor = createAudioRangeProcessor('normalize');
    const process = vi.fn(processor.process);
    const editor = createAudioClipEditor(createAudioClip({sampleRate: 8000, channelData: [
      new Float32Array([.25, .5, -.25, .125]), new Float32Array([-.25, .25, -.125, .5]),
    ]}), {processors: [{...processor, process}]});
    const snapshot = editor.getSnapshot();
    const outcome = await editor.processRange({documentId: snapshot.documentId, expectedRevision: 0,
      startFrame: 1, endFrame: 3, processorId: 'normalize', processorVersion: 1,
      parameters: {targetPeak: 1}, assetId: 'normalized', segmentId: 'processed', rightId: 'tail'});
    expect(outcome.status).toBe('committed');
    const rendered = await renderAudioSequence(editor.sequence, editor.getSnapshot().assets);
    expect(rendered.channelData).toEqual([new Float32Array([.25, 1, -.5, .125]), new Float32Array([-.25, .5, -.25, .5])]);
    expect(editor.undo().status).toBe('committed');
    expect(editor.redo().status).toBe('committed');
    expect(process).toHaveBeenCalledTimes(1);
    expect((await renderAudioSequence(editor.sequence, editor.getSnapshot().assets)).channelData).toEqual(rendered.channelData);
    editor.dispose();
  });
  it('reverses only the selection and refuses unknown parameters before materializing an asset', async () => {
    const editor = createAudioClipEditor(createAudioClip({sampleRate: 8000, channelData: [new Float32Array([.1, .2, .3, .4])]}),
      {processors: [createAudioRangeProcessor('reverse')]});
    const request = {documentId: editor.getSnapshot().documentId, expectedRevision: 0, startFrame: 1, endFrame: 3,
      processorId: 'reverse', processorVersion: 1, parameters: {}, assetId: 'reverse', segmentId: 'processed', rightId: 'tail'};
    expect((await editor.processRange({...request, parameters: {targetPeak: 1}})).status).toBe('failed');
    expect(editor.getSnapshot().documentRevision).toBe(0);
    expect((await editor.processRange(request)).status).toBe('committed');
    expect((await renderAudioSequence(editor.sequence, editor.getSnapshot().assets)).channelData[0])
      .toEqual(new Float32Array([.1, .3, .2, .4]));
    editor.dispose();
  });
  it('yields long processing so cancellation cannot commit partial output', async () => {
    const editor = createAudioClipEditor(createAudioClip({sampleRate: 8000, channelData: [new Float32Array(131_072).fill(.5)]}),
      {processors: [createAudioRangeProcessor('normalize')]});
    const controller = new AbortController();
    const pending = editor.processRange({documentId: editor.getSnapshot().documentId, expectedRevision: 0,
      startFrame: 0, endFrame: 131_072, processorId: 'normalize', processorVersion: 1, parameters: {},
      assetId: 'cancelled', segmentId: 'processed'}, {signal: controller.signal});
    controller.abort();
    expect((await pending).status).toBe('cancelled');
    expect(editor.getSnapshot().documentRevision).toBe(0);
    expect(editor.getSnapshot().assets.getDescriptor('cancelled')).toBeUndefined();
    editor.dispose();
  });
});
