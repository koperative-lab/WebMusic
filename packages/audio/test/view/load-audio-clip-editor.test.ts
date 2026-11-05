import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {createAudioClip} from '../../src/core/model/AudioClip';
import type {AudioFormat} from '../../src/core';
import {loadClipFromUrl} from '../../src/play/api/load';
import {createAudioRangeProcessor} from '../../src/view/api/processor';
import * as clipEditor from '../../src/view/headless/audio-clip-editor';
import {loadAudioClipEditor, type AudioClipEditor} from '../../src/view/headless';

vi.mock('../../src/play/api/load', () => ({loadClipFromUrl: vi.fn()}));
const load = vi.mocked(loadClipFromUrl);
const editors: AudioClipEditor[] = [];
const clip = (length = 8) => createAudioClip({sampleRate: 8000, channelData: [new Float32Array(length)]});
async function loaded(...args: Parameters<typeof loadAudioClipEditor>): Promise<AudioClipEditor> {
  const editor = await loadAudioClipEditor(...args); editors.push(editor); return editor;
}
beforeEach(() => {load.mockReset();});
afterEach(() => {for (const editor of editors.splice(0)) editor.dispose(); vi.restoreAllMocks();});

describe('loadAudioClipEditor default decoded loader', () => {
  it('forwards explicit limits, signal and format while forcing decoded loading', async () => {
    const source = clip(); load.mockResolvedValue(source);
    const controller = new AbortController();
    const limits = {maxInputBytes: 1000, maxDecodedFrames: 2000, maxDecodedBytes: 8000, maxChannels: 2, timeoutMs: 0};
    const editor = await loaded('/audio.wav', {signal: controller.signal, format: 'wav', ...limits});
    expect(load).toHaveBeenCalledWith('/audio.wav', {...limits, signal: controller.signal, format: 'wav', streaming: false});
    expect(load.mock.calls[0][1]!.signal).toBe(controller.signal);
    expect(load.mock.calls[0][1]).not.toHaveProperty('context');
    expect(editor.getSnapshot()).toMatchObject({status: 'ready', documentRevision: 0});
    expect(editor.sequence.length).toBe(source.length);
  });

  it('forwards only defined limits and never editor options or a streaming override', async () => {
    load.mockResolvedValue(clip());
    await loaded('/audio.wav', {maxChannels: 1, maxDecodedFrames: undefined, history: false,
      ...({streaming: true} as object)});
    expect(load.mock.calls[0][1]).toEqual({maxChannels: 1, streaming: false});
  });

  it('propagates decoder rejection without creating an editor', async () => {
    const failure = new Error('decode limit'); load.mockRejectedValue(failure);
    const create = vi.spyOn(clipEditor, 'createAudioClipEditor');
    await expect(loadAudioClipEditor('/broken.wav')).rejects.toBe(failure);
    expect(create).not.toHaveBeenCalled();
  });
});

describe('loadAudioClipEditor options', () => {
  it('replaces the default loader with an injected one that receives signal and format', async () => {
    const source = clip(12); const loader = vi.fn(async () => source); const controller = new AbortController();
    const editor = await loaded('/take.mp3', {loader, signal: controller.signal, format: 'mp3', maxInputBytes: 10});
    expect(load).not.toHaveBeenCalled();
    expect(loader).toHaveBeenCalledWith('/take.mp3', {maxInputBytes: 10, signal: controller.signal, format: 'mp3'});
    expect(editor.sequence.length).toBe(12);
  });

  it('rejects an unsupported format with a TypeError before loading', async () => {
    const loader = vi.fn(async () => clip());
    await expect(loadAudioClipEditor('/x.mid', {format: 'midi' as AudioFormat, loader})).rejects.toBeInstanceOf(TypeError);
    await expect(loadAudioClipEditor('/x.mid', {format: 'midi' as AudioFormat})).rejects.toThrow(/Unsupported Audio format/);
    expect(loader).not.toHaveBeenCalled(); expect(load).not.toHaveBeenCalled();
  });

  it('propagates an injected loader rejection with no editor', async () => {
    const failure = new Error('network'); const create = vi.spyOn(clipEditor, 'createAudioClipEditor');
    await expect(loadAudioClipEditor('/a.wav', {loader: async () => { throw failure; }})).rejects.toBe(failure);
    expect(create).not.toHaveBeenCalled();
  });

  it('rejects with the abort reason when the signal aborts while loading, creating no editor', async () => {
    const controller = new AbortController(); const create = vi.spyOn(clipEditor, 'createAudioClipEditor');
    let resolve!: (value: ReturnType<typeof clip>) => void;
    const loader = vi.fn(() => new Promise<ReturnType<typeof clip>>((yes) => {resolve = yes;}));
    const pending = loadAudioClipEditor('/a.wav', {loader, signal: controller.signal});
    controller.abort(new DOMException('stop', 'AbortError'));
    resolve(clip());
    await expect(pending).rejects.toMatchObject({name: 'AbortError'});
    expect(create).not.toHaveBeenCalled();
  });

  it('forwards history and processors to the created editor', async () => {
    load.mockResolvedValue(clip(4));
    const editor = await loaded('/a.wav', {history: {limit: 3}, processors: [createAudioRangeProcessor('reverse')]});
    expect(editor.getState().history.limit).toBe(3);
    const snapshot = editor.getSnapshot();
    expect((await editor.processRange({documentId: snapshot.documentId, expectedRevision: 0, startFrame: 1, endFrame: 3,
      processorId: 'reverse', processorVersion: 1, parameters: {}, assetId: 'reversed', segmentId: 'processed', rightId: 'tail'})).status)
      .toBe('committed');
    const disabled = await loaded('/a.wav', {history: false});
    expect(disabled.getState().history.enabled).toBe(false);
  });
});
