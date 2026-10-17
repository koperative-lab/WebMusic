import {describe, expect, it, vi} from 'vitest';
import {AudioClip, createAudioClip} from '../../src/core/model/AudioClip';
import {createAudioSequence, createMemoryAudioAssetStore, readAudioSequenceRange, type AudioAssetSegment} from '../../src/core/sequence';
import {mapAudioPosition} from '../../src/core/audio-position-map';
import {type AudioEditOperation, type AudioRangeProcessor, type AudioProcessingRequest, type AudioEditTransaction} from '../../src/core/editing';
import {createAudioClipEditor, type AudioClipEditorOptions} from '../../src/edit/headless/audio-clip-editor';
import {applyAudioOperations} from '../../src/edit/core';

const clip = (length = 8) => createAudioClip({sampleRate: 8000, channelData: [Float32Array.from({length}, (_, i) => i / 8)]});
function setup(options?: AudioClipEditorOptions) {return createAudioClipEditor(clip(), options);}
function command(editor: ReturnType<typeof setup>, operations: readonly AudioEditOperation[]) {
  return editor.execute({version: 1, documentId: editor.getSnapshot().documentId,
    expectedRevision: editor.getSnapshot().documentRevision, label: 'Test edit', operations});
}
function pcm(editor: ReturnType<typeof setup>): number[] {
  const out = new Float32Array(editor.sequence.length); readAudioSequenceRange(editor.sequence, editor.getSnapshot().assets, 0, [out]); return [...out];
}
function processRequest(editor: ReturnType<typeof setup>, extra: Partial<AudioProcessingRequest> = {}): AudioProcessingRequest {
  return {documentId: editor.getSnapshot().documentId, expectedRevision: editor.getSnapshot().documentRevision,
    startFrame: 2, endFrame: 4, processorId: 'test', processorVersion: 1, parameters: {},
    assetId: 'processed', segmentId: 'processed-segment', rightId: 'processed-right', ...extra};
}
function processor(overrides: Partial<AudioRangeProcessor> = {}): AudioRangeProcessor {
  return {id: 'test', version: 1,
    plan: ({rangeLength}) => ({inputBefore: 0, inputAfter: 0, outputLength: rangeLength, latencyFrames: 0, tailFrames: 0}),
    process: async ({channels, sampleRate}) => createAudioClip({sampleRate, channelData: channels.map((ch) => Float32Array.from(ch, (n) => -n))}),
    ...overrides};
}
describe('AudioClipEditor commands and immutable roots', () => {
  it('publishes once per atomic transaction and rejects stale envelopes', () => {
    const editor = setup(), observed: number[] = [];
    editor.subscribe((value) => observed.push(value.documentRevision));
    const first = editor.sequence.segments[0].id;
    expect(editor.transaction('gain then silence', (tx) => {tx.add({type: 'set-gain', segmentIds: [first], gain: .5}); tx.add({type: 'insert-silence', frame: 8, length: 2, id: 's'});})).toMatchObject({status: 'committed'});
    expect(observed).toEqual([0, 1]); expect(editor.sequence.length).toBe(10); expect(editor.getState().history.undoCount).toBe(1);
    expect(editor.execute({version: 1, documentId: editor.getSnapshot().documentId, expectedRevision: 0, label: 'stale', operations: []})).toMatchObject({status: 'failed', error: {code: 'revision-conflict'}});
    expect(editor.sequence.length).toBe(10); editor.dispose();
  });
  it('rejects the entire batch after a valid first operation and never reads PCM', () => {
    const editor = setup(), original = editor.sequence;
    const whole = vi.spyOn(AudioClip.prototype, 'channelData');
    expect(command(editor, [{type: 'set-gain', segmentIds: [original.segments[0].id], gain: .5},
      {type: 'trim', startFrame: 0, endFrame: 99}])).toMatchObject({status: 'failed'});
    expect(editor.sequence).toBe(original); expect(editor.getState().history.undoCount).toBe(0); expect(whole).not.toHaveBeenCalled(); whole.mockRestore(); editor.dispose();
  });
  it('rejects nonserializable and unknown command fields without invoking accessors', () => {
    const editor = setup(), getter = vi.fn(() => 1);
    const envelope = {version: 1, documentId: editor.getSnapshot().documentId, expectedRevision: 0, label: 'bad', operations: []};
    Object.defineProperty(envelope, 'extra', {get: getter, enumerable: true});
    expect(editor.execute(envelope as never)).toMatchObject({status: 'failed'}); expect(getter).not.toHaveBeenCalled();
    expect(command(editor, [{type: 'trim', startFrame: 0, endFrame: 8, extra: true} as never])).toMatchObject({status: 'failed'}); editor.dispose();
  });
  it('preserves redo and content identity for net-zero transactions', () => {
    const editor = setup(), id = editor.sequence.segments[0].id;
    command(editor, [{type: 'set-gain', segmentIds: [id], gain: .5}]); editor.undo();
    const snapshot = editor.getSnapshot();
    expect(editor.transaction('net zero', (tx) => {tx.add({type: 'set-gain', segmentIds: [id], gain: .3}); tx.add({type: 'set-gain', segmentIds: [id], gain: 1});})).toMatchObject({status: 'noop'});
    expect(editor.getSnapshot()).toBe(snapshot); expect(editor.getState().history.redoCount).toBe(1); editor.dispose();
  });
  it('supports exact split/trim/splice with shared assets and cropped fades', () => {
    const editor = setup(), id = editor.sequence.segments[0].id;
    command(editor, [{type: 'set-envelope', segmentId: id, points: [{frame: 0, gain: 0}, {frame: 8, gain: 1}]},
      {type: 'split', segmentId: id, frame: 4, leftId: 'left', rightId: 'right'}]);
    expect((editor.sequence.segments[1] as AudioAssetSegment).envelope).toEqual([{frame: 0, gain: .5}, {frame: 4, gain: 1}]);
    expect((editor.sequence.segments[0] as AudioAssetSegment).assetId).toBe((editor.sequence.segments[1] as AudioAssetSegment).assetId);
    command(editor, [{type: 'trim', startFrame: 2, endFrame: 6}]);
    expect(pcm(editor)).toEqual([.0625, .140625, .25, .390625]); editor.undo(); expect(editor.sequence.length).toBe(8); editor.dispose();
  });
  it('requires explicit IDs when a splice leaves two fragments of one segment', () => {
    const editor = setup();
    expect(command(editor, [{type: 'splice', startFrame: 2, deleteCount: 2, segments: []}])).toMatchObject({status: 'failed'});
    expect(command(editor, [{type: 'splice', startFrame: 2, deleteCount: 2, segments: [], rightId: 'right'}])).toMatchObject({status: 'committed'});
    expect(pcm(editor)).toEqual([0, .125, .5, .625, .75, .875]);
    const change = editor.getSnapshot().change!; expect(mapAudioPosition(change.positionMap, 3)).toMatchObject({frame: 2, deleted: true}); editor.dispose();
  });
  it('inserts silence without materializing and permits a ready empty document', () => {
    const editor = setup(); command(editor, [{type: 'insert-silence', frame: 2, length: 3, id: 'silent', rightId: 'right'}]);
    expect(pcm(editor).slice(0, 7)).toEqual([0, .125, 0, 0, 0, .25, .375]);
    command(editor, [{type: 'trim', startFrame: 0, endFrame: 0}]); expect(editor.getSnapshot().status).toBe('ready'); expect(pcm(editor)).toEqual([]);
    editor.undo(); expect(editor.sequence.length).toBe(11); editor.dispose();
  });
  it('rejects source range, gain, and duplicate segment IDs', () => {
    const editor = setup(), segment = editor.sequence.segments[0] as AudioAssetSegment;
    for (const op of [
      {type: 'set-gain', segmentIds: [segment.id], gain: -1},
      {type: 'splice', startFrame: 8, deleteCount: 0, segments: [segment]},
      {type: 'splice', startFrame: 8, deleteCount: 0, segments: [{...segment, id: 'different', sourceEnd: 999}]},
    ]) expect(command(editor, [op as AudioEditOperation])).toMatchObject({status: 'failed'});
    expect(editor.getSnapshot().documentRevision).toBe(0); editor.dispose();
  });
  it('keeps dirty identity independent of revision and prunes bounded history', () => {
    const editor = setup({history: {limit: 2}}), id = editor.sequence.segments[0].id;
    command(editor, [{type: 'set-gain', segmentIds: [id], gain: .5}]); editor.markSaved(); const saved = editor.getSnapshot().contentId;
    command(editor, [{type: 'set-gain', segmentIds: [id], gain: .4}]); editor.undo(); expect(editor.getState().dirty).toBe(false); expect(editor.getSnapshot().contentId).toBe(saved);
    editor.redo(); command(editor, [{type: 'set-gain', segmentIds: [id], gain: .3}]); expect(editor.getState().history).toMatchObject({undoCount: 2, trimmedCount: 1}); editor.dispose();
  });
  it('retains no history assets when disabled and releases the current root on disposal', () => {
    const editor = setup({history: false}), assets = editor.getSnapshot().assets, id = (editor.sequence.segments[0] as AudioAssetSegment).assetId;
    command(editor, [{type: 'trim', startFrame: 0, endFrame: 0}]); expect(assets.getDescriptor(id)).toBeUndefined();
    expect(editor.undo()).toMatchObject({status: 'failed', error: {code: 'history-disabled'}}); editor.dispose(); editor.dispose();
  });
  it('prunes assets held only by history, without counting live or externally leased PCM', () => {
    const editor = setup({history: {assetBytes: 0}}), assets = editor.getSnapshot().assets;
    const checkpoint = editor.createCheckpoint(); command(editor, [{type: 'trim', startFrame: 0, endFrame: 0}]);
    expect(editor.getState().history.undoCount).toBe(1); expect(editor.getState().history.historyOnlyBytes).toBe(0);
    checkpoint.release(); editor.clearClipboard();
    expect(editor.getState().history).toMatchObject({undoCount: 0, trimmedCount: 1, historyOnlyBytes: 0});
    expect(assets.getDescriptor(checkpoint.assetIds[0])).toBeUndefined(); editor.dispose();
  });
  it('plans history bytes after the old current lease retires, before committing a deletion', () => {
    const editor = setup({history: {assetBytes: 0}}), assets = editor.getSnapshot().assets;
    const assetId = (editor.sequence.segments[0] as AudioAssetSegment).assetId;
    expect(command(editor, [{type: 'trim', startFrame: 0, endFrame: 0}]).status).toBe('committed');
    expect(editor.getState().history).toMatchObject({undoCount: 0, redoCount: 0, trimmedCount: 1, historyOnlyBytes: 0});
    expect(assets.getDescriptor(assetId)).toBeUndefined(); editor.dispose();
  });
  it('checkpoints outlive the editor and restore with explicit coordinate reset', () => {
    const editor = setup(), checkpoint = editor.createCheckpoint(), assets = editor.getSnapshot().assets;
    command(editor, [{type: 'trim', startFrame: 2, endFrame: 5}]);
    expect(editor.restoreCheckpoint(checkpoint)).toMatchObject({status: 'committed'});
    expect(mapAudioPosition(editor.getSnapshot().change!.positionMap, 2).positionPolicy).toBe('reset-origin');
    expect(editor.getState().history.undoCount).toBe(0); editor.dispose();
    expect(assets.getDescriptor(checkpoint.assetIds[0])).toBeDefined(); checkpoint.release(); checkpoint.release(); expect(assets.getDescriptor(checkpoint.assetIds[0])).toBeUndefined();
  });
  it('rejects released/foreign checkpoints and keeps assets while history restores', () => {
    const editor = setup(), other = setup(), checkpoint = other.createCheckpoint();
    expect(editor.restoreCheckpoint(checkpoint)).toMatchObject({status: 'failed', error: {code: 'invalid-checkpoint'}});
    checkpoint.release(); other.dispose(); const local = editor.createCheckpoint(); local.release(); expect(editor.restoreCheckpoint(local)).toMatchObject({status: 'failed'}); editor.dispose();
  });
  it('transactions reject nesting, await, callback errors and late additions', async () => {
    const editor = setup(); let transaction: AudioEditTransaction | undefined;
    expect(editor.transaction('nested', () => {expect(editor.undo()).toMatchObject({status: 'failed', error: {code: 'reentrant-command'}});})).toMatchObject({status: 'noop'});
    expect(editor.transaction('throw', () => {throw new Error('abort');})).toMatchObject({status: 'failed', error: {code: 'transaction-aborted'}});
    expect(editor.transaction('async', async (tx) => {transaction = tx; await Promise.resolve();})).toMatchObject({status: 'failed', error: {code: 'transaction-aborted'}});
    await Promise.resolve(); expect(() => transaction!.add({type: 'trim', startFrame: 0, endFrame: 0})).toThrow(/returned/); editor.dispose();
  });
  it('orders disposal reentrancy and isolates listener failures', () => {
    const errors = vi.fn(), editor = setup({onListenerError: errors}), order: string[] = [];
    editor.subscribe((s) => {order.push(`a${s.documentRevision}:${s.status}`); if (s.documentRevision && s.status === 'ready') editor.dispose();});
    editor.subscribe((s) => {order.push(`b${s.documentRevision}:${s.status}`); if (s.status === 'disposed') throw new Error('subscriber');});
    command(editor, [{type: 'trim', startFrame: 0, endFrame: 2}]);
    expect(order).toEqual(['a0:ready', 'b0:ready', 'a1:ready', 'a1:disposed', 'b1:disposed']); expect(errors).toHaveBeenCalledTimes(1);
  });
});
describe('Audio clipboard, annotations and sessions', () => {
  it('copies references, cuts atomically and pastes fixed new IDs without PCM snapshots', () => {
    const editor = setup(), original = pcm(editor); const copy = editor.copy({startFrame: 2, endFrame: 4});
    copy.release(); expect(editor.getState().clipboard.length).toBe(2);
    expect(editor.paste(8, {segmentIds: ['pasted']})).toMatchObject({status: 'committed'});
    expect(pcm(editor)).toEqual([...original, .25, .375]);
    expect(editor.cut({startFrame: 0, endFrame: 2})).toMatchObject({status: 'committed'}); editor.undo(); expect(editor.getState().clipboard.length).toBe(2);
    editor.clearClipboard(); expect(editor.paste(0)).toMatchObject({status: 'failed', error: {code: 'clipboard-empty'}}); editor.dispose();
  });
  it('preserves clipboard on failed cut and leaves copy out of content history', () => {
    const editor = setup(), external = editor.copy({startFrame: 0, endFrame: 2}); external.release();
    expect(editor.cut({startFrame: 1, endFrame: 99})).toMatchObject({status: 'failed'});
    expect(editor.getState().clipboard.length).toBe(2); expect(editor.getState().history.undoCount).toBe(0); expect(editor.getState().dirty).toBe(false); editor.dispose();
  });
  it('isolates default sessions, maps selections, cancels superseded drafts and commits once', () => {
    const editor = setup(), a = editor.createInteractionSession(), b = editor.createInteractionSession();
    a.setSelection({startFrame: 4, endFrame: 8}); expect(b.getSnapshot().selection).toEqual({startFrame: 0, endFrame: 0});
    const id = editor.sequence.segments[0].id; a.preview([{type: 'set-gain', segmentIds: [id], gain: .5}]);
    expect(editor.getSnapshot().documentRevision).toBe(0); expect(a.commitDraft()).toMatchObject({status: 'committed'});
    a.preview([{type: 'set-gain', segmentIds: [id], gain: .25}]); command(editor, [{type: 'splice', startFrame: 0, deleteCount: 2, segments: []}]);
    expect(a.getSnapshot().draft).toBeUndefined(); expect(a.getSnapshot().selection).toEqual({startFrame: 2, endFrame: 6});
    editor.undo(); expect(a.getSnapshot().selection).toEqual({startFrame: 4, endFrame: 8}); editor.dispose(); expect(a.getSnapshot().disposed).toBe(true);
  });
  it('draft leases retain inserted assets independently of their import and clean up on cancel', () => {
    const store = createMemoryAudioAssetStore(), original = store.registerClip(clip(), {id: 'original'}), inserted = store.registerClip(clip(2), {id: 'insert'});
    const content = createAudioSequence({sampleRate: 8000, channelLayout: ['mono'], segments: [{kind: 'asset', id: 'a', assetId: 'original', sourceStart: 0, sourceEnd: 8, gain: 1, envelope: []}]}, store);
    const editor = createAudioClipEditor(content, {assets: store}), session = editor.createInteractionSession(); original.release();
    expect(session.preview([{type: 'splice', startFrame: 8, deleteCount: 0, segments: [{kind: 'asset', id: 'b', assetId: 'insert', sourceStart: 0, sourceEnd: 2, gain: 1, envelope: []}]}])).toMatchObject({status: 'preview'});
    inserted.release(); expect(store.getDescriptor('insert')).toBeDefined(); session.cancelDraft(); expect(store.getDescriptor('insert')).toBeUndefined(); editor.dispose();
  });
  it('maps content annotations through deletion, clamps fixed annotations, and restores original roots', () => {
    const content = createAudioSequence({sampleRate: 8000, channelLayout: ['mono'], segments: [{kind: 'silence', id: 's', length: 10}], annotations: [
      {id: 'deleted', startFrame: 4, anchoring: 'content'}, {id: 'span', startFrame: 1, endFrame: 8, anchoring: 'content'},
      {id: 'fixed', startFrame: 9, anchoring: 'fixed'},
    ]});
    const store = createMemoryAudioAssetStore(), editor = createAudioClipEditor(content, {assets: store});
    command(editor, [{type: 'splice', startFrame: 3, deleteCount: 4, segments: [], rightId: 'r'}]);
    expect(editor.sequence.annotations).toEqual([{id: 'span', startFrame: 1, endFrame: 4, anchoring: 'content'}, {id: 'fixed', startFrame: 6, anchoring: 'fixed'}]);
    editor.undo(); expect(editor.sequence.annotations).toEqual(content.annotations); editor.dispose();
  });
  it('pure operation replay preserves supplied segment identity and never generates random IDs', () => {
    const editor = setup(), operations: AudioEditOperation[] = [{type: 'insert-silence', frame: 4, length: 2, id: 'silence', rightId: 'right'}];
    const a = applyAudioOperations(editor.sequence, editor.getSnapshot().assets, operations), b = applyAudioOperations(editor.sequence, editor.getSnapshot().assets, operations);
    expect(a).toEqual(b); editor.dispose();
  });
});
describe('explicit bounded range processing', () => {
  it('only reads the selected range and history restores output without rerunning DSP', async () => {
    const dsp = processor(), process = vi.fn(dsp.process), editor = setup({processors: [{...dsp, process}]});
    const original = pcm(editor); const request = processRequest(editor);
    expect(await editor.processRange(request)).toMatchObject({status: 'committed'});
    expect(process.mock.calls[0][0].channels[0].length).toBe(2); expect(pcm(editor)).toEqual([0, .125, -.25, -.375, .5, .625, .75, .875]);
    editor.undo(); expect(pcm(editor)).toEqual(original); editor.redo(); expect(process).toHaveBeenCalledTimes(1); editor.dispose();
  });
  it('rejects unsafe allocation before invoking a processor', async () => {
    const dsp = processor(), process = vi.fn(dsp.process), editor = setup({processingMaxBytes: 4, processors: [{...dsp, process}]});
    expect(await editor.processRange(processRequest(editor))).toMatchObject({status: 'failed', error: {code: 'resource-limit'}});
    expect(process).not.toHaveBeenCalled(); expect(editor.getSnapshot().documentRevision).toBe(0); editor.dispose();
  });
  it('declares handles, compensates latency, trims tails and only extends explicitly', async () => {
    const dsp = processor({plan: ({rangeLength}) => ({inputBefore: 1, inputAfter: 1, outputLength: rangeLength + 3, latencyFrames: 1, tailFrames: 2}),
      process: async ({channels, selectionOffset, selectionLength}) => {
        expect(channels[0].length).toBe(4); expect(selectionOffset).toBe(1); expect(selectionLength).toBe(2);
        return createAudioClip({sampleRate: 8000, channelData: [Float32Array.from([99, .1, .2, .3, .4])]});
      }});
    const editor = setup({processors: [dsp]});
    expect(await editor.processRange(processRequest(editor))).toMatchObject({status: 'committed'}); expect(editor.sequence.length).toBe(8);
    expect(pcm(editor)[2]).toBeCloseTo(.1); expect(pcm(editor)[3]).toBeCloseTo(.2); editor.undo();
    expect(await editor.processRange(processRequest(editor, {assetId: 'extended', segmentId: 'extended-segment', tailPolicy: 'extend'}))).toMatchObject({status: 'committed'});
    expect(editor.sequence.length).toBe(10); expect(pcm(editor)[5]).toBeCloseTo(.4); editor.dispose();
  });
  it('rejects undeclared or incompatible processor output', async () => {
    for (const output of [clip(3), createAudioClip({sampleRate: 9000, channelData: [new Float32Array(2)]})]) {
      const editor = setup({processors: [processor({process: async () => output})]});
      expect(await editor.processRange(processRequest(editor))).toMatchObject({status: 'failed', error: {code: 'processing-failed'}});
      expect(editor.getSnapshot().documentRevision).toBe(0); editor.dispose();
    }
  });
  it('cancels on AbortSignal and rejects a concurrent job without corrupting the first', async () => {
    let resolve!: (clip: AudioClip) => void;
    const editor = setup({processors: [processor({process: () => new Promise((done) => {resolve = done;})})]});
    const abort = new AbortController(), pending = editor.processRange(processRequest(editor), {signal: abort.signal});
    expect(editor.getState().processing).toBe(true);
    expect(await editor.processRange(processRequest(editor))).toMatchObject({status: 'failed', error: {code: 'processing-busy'}});
    abort.abort(); resolve(clip(2)); expect(await pending).toEqual({status: 'cancelled'}); expect(editor.getState().processing).toBe(false); editor.dispose();
  });
  it('supersedes late output after a revision change and never registers it', async () => {
    let resolve!: (clip: AudioClip) => void;
    const editor = setup({processors: [processor({process: () => new Promise((done) => {resolve = done;})})]});
    const pending = editor.processRange(processRequest(editor));
    command(editor, [{type: 'trim', startFrame: 0, endFrame: 6}]); resolve(clip(2));
    expect(await pending).toEqual({status: 'superseded'}); expect(editor.getSnapshot().assets.getDescriptor('processed')).toBeUndefined(); expect(editor.sequence.length).toBe(6); editor.dispose();
  });
  it('releases job assets even if the editor is disposed while DSP ignores cancellation', async () => {
    let resolve!: (clip: AudioClip) => void;
    const editor = setup({processors: [processor({process: () => new Promise((done) => {resolve = done;})})]});
    const snapshot = editor.getSnapshot(), id = (snapshot.content.segments[0] as AudioAssetSegment).assetId;
    const pending = editor.processRange(processRequest(editor)); editor.dispose(); expect(snapshot.assets.getDescriptor(id)).toBeDefined();
    resolve(clip(2)); expect(await pending).toEqual({status: 'superseded'}); expect(snapshot.assets.getDescriptor(id)).toBeUndefined();
  });
});

describe('processing and lease callback reentrancy', () => {
  it.each(['gain', 'cut'] as const)('does not commit %s or retain candidates after a processor abort disposes the editor', async (operation) => {
    let resolve!: (clip: AudioClip) => void;
    const editor = setup({processors: [processor({process: ({signal}) => new Promise((done) => {
      resolve = done; signal.addEventListener('abort', () => editor.dispose(), {once: true});
    })})]});
    const base = editor.getSnapshot(), id = (base.content.segments[0] as AudioAssetSegment).assetId;
    const session = editor.createInteractionSession(), observed: string[] = [];
    editor.subscribe((snapshot) => observed.push(snapshot.status));
    if (operation === 'cut') editor.copy({startFrame: 0, endFrame: 1}).release();
    const pending = editor.processRange(processRequest(editor));
    const result = operation === 'cut' ? editor.cut({startFrame: 2, endFrame: 4}) :
      command(editor, [{type: 'set-gain', segmentIds: [base.content.segments[0].id], gain: .5}]);
    expect(result).toMatchObject({status: 'failed', error: {code: 'disposed'}});
    expect(editor.getSnapshot()).toMatchObject({status: 'disposed', documentRevision: 0, contentId: base.contentId});
    expect(editor.getState()).toMatchObject({history: {undoCount: 0, redoCount: 0}, clipboard: {hasContent: false}});
    expect(session.getSnapshot().disposed).toBe(true); expect(observed).toEqual(['ready', 'disposed']);
    resolve(clip(2)); expect(await pending).toEqual({status: 'superseded'});
    expect(base.assets.getDescriptor(id)).toBeUndefined(); expect(base.assets.getDescriptor('processed')).toBeUndefined();
    editor.dispose(); expect(editor.getSnapshot().documentRevision).toBe(0);
  });
  it('makes disposal terminal before processor abort callbacks can issue another command', async () => {
    let resolve!: (clip: AudioClip) => void, nested: unknown, statusDuringAbort: string | undefined;
    let stateDuringAbort: ReturnType<ReturnType<typeof setup>['getState']> | undefined;
    const subscribedStates: string[] = [];
    const editor = setup({processors: [processor({process: ({signal}) => new Promise((done) => {
      resolve = done; signal.addEventListener('abort', () => {
        statusDuringAbort = editor.getSnapshot().status;
        stateDuringAbort = editor.getState(); editor.subscribeState((state) => subscribedStates.push(state.document.status));
        nested = command(editor, [{type: 'trim', startFrame: 0, endFrame: 0}]);
        editor.dispose();
      }, {once: true});
    })})]});
    const base = editor.getSnapshot(), id = (base.content.segments[0] as AudioAssetSegment).assetId;
    editor.copy({startFrame: 0, endFrame: 1}).release();
    const pending = editor.processRange(processRequest(editor)); editor.dispose();
    expect(statusDuringAbort).toBe('disposed'); expect(nested).toMatchObject({status: 'failed', error: {code: 'disposed'}});
    expect(stateDuringAbort).toMatchObject({document: {status: 'disposed'}, history: {undoCount: 0, redoCount: 0}, clipboard: {hasContent: false}, processing: false});
    expect(subscribedStates).toEqual(['disposed']);
    expect(editor.getSnapshot()).toMatchObject({status: 'disposed', documentRevision: 0, contentId: base.contentId});
    resolve(clip(2)); expect(await pending).toEqual({status: 'superseded'}); expect(base.assets.getDescriptor(id)).toBeUndefined();
    expect(editor.getState().processing).toBe(false);
  });
  it('prevents a processor plan from nesting edits or another materialization', async () => {
    let nested: unknown;
    const process = vi.fn(async () => clip(2));
    const dsp = processor({plan: ({rangeLength}) => {
      nested = command(editor, [{type: 'trim', startFrame: 0, endFrame: 0}]);
      return {inputBefore: 0, inputAfter: 0, outputLength: rangeLength, latencyFrames: 0, tailFrames: 0};
    }, process});
    const editor = setup({processors: [dsp]});
    expect(await editor.processRange(processRequest(editor))).toMatchObject({status: 'committed'});
    expect(nested).toMatchObject({status: 'failed', error: {code: 'reentrant-command'}}); expect(editor.sequence.length).toBe(8); editor.dispose();
  });
  it('disposal during planning supersedes before allocating or invoking DSP', async () => {
    const process = vi.fn(async () => clip(2));
    const editor = setup({processors: [processor({plan: ({rangeLength}) => {editor.dispose(); return {inputBefore: 0, inputAfter: 0, outputLength: rangeLength, latencyFrames: 0, tailFrames: 0};}, process})]});
    expect(await editor.processRange(processRequest(editor))).toEqual({status: 'superseded'}); expect(process).not.toHaveBeenCalled();
  });
  it('does not publish state again when a subscriber attempts a forbidden processing call', async () => {
    const editor = setup({processors: [processor()]}); let calls = 0; let nested: Promise<unknown> | undefined;
    editor.subscribeState(() => {calls++; nested = editor.processRange(processRequest(editor));});
    expect(calls).toBe(1); expect(await nested).toMatchObject({status: 'failed', error: {code: 'reentrant-command'}}); editor.dispose();
  });
  it('does not turn an empty interior splice into a history item', () => {
    const editor = setup(), base = editor.getSnapshot();
    expect(command(editor, [{type: 'splice', startFrame: 3, deleteCount: 0, segments: []}])).toMatchObject({status: 'noop'});
    expect(command(editor, [{type: 'insert-silence', frame: 3, length: 0, id: 'zero'}])).toMatchObject({status: 'noop'});
    expect(editor.getSnapshot()).toBe(base); editor.dispose();
  });
});

describe('clipboard annotations and callback boundaries', () => {
  it('copies only intersecting annotations and paste creates fixed serializable identities', () => {
    const store = createMemoryAudioAssetStore();
    const sequence = createAudioSequence({sampleRate: 8000, channelLayout: ['mono'], segments: [{kind: 'silence', id: 's', length: 10}], annotations: [
      {id: 'inside', startFrame: 3, anchoring: 'content', label: 'Marker'}, {id: 'outside', startFrame: 8, anchoring: 'content'},
      {id: 'span', startFrame: 1, endFrame: 7, anchoring: 'content'},
    ]});
    const editor = createAudioClipEditor(sequence, {assets: store});
    const copy = editor.copy({startFrame: 2, endFrame: 5});
    expect(copy.content.annotations).toEqual([{id: 'inside', startFrame: 1, anchoring: 'content', label: 'Marker'}, {id: 'span', startFrame: 0, endFrame: 3, anchoring: 'content'}]); copy.release();
    const result = editor.paste(10, {segmentIds: ['pasted']});
    expect(result.status).toBe('committed'); expect(editor.sequence.annotations).toHaveLength(5);
    const newMarker = editor.sequence.annotations.find((entry) => entry.startFrame === 11)!;
    expect(newMarker.id).not.toBe('inside');
    const replay = applyAudioOperations(sequence, store, editor.getSnapshot().change!.operations); expect(replay.content).toEqual(editor.sequence); editor.dispose();
  });
  it('cancels a draft commit when its session is disposed during draft-clearing notification', () => {
    const editor = setup(), session = editor.createInteractionSession(), id = editor.sequence.segments[0].id;
    session.preview([{type: 'set-gain', segmentIds: [id], gain: .5}]);
    session.subscribe((state) => {if (!state.draft && !state.disposed) session.dispose();});
    expect(session.commitDraft()).toMatchObject({status: 'failed', error: {code: 'disposed'}}); expect(editor.getSnapshot().documentRevision).toBe(0); editor.dispose();
  });
  it('does not resurrect an owner disposed by an asset retention callback', () => {
    const store = createMemoryAudioAssetStore(), imported = store.registerClip(clip(), {id: 'a'});
    let shouldDispose = false;
    const assets = {...store, retain(ids: readonly string[]) {const lease = store.retain(ids); if (shouldDispose) editor?.dispose(); return lease;}};
    const sequence = createAudioSequence({sampleRate: 8000, channelLayout: ['mono'], segments: [{kind: 'asset', id: 's', assetId: 'a', sourceStart: 0, sourceEnd: 8}]}, assets);
    const editor = createAudioClipEditor(sequence, {assets}); imported.release(); shouldDispose = true;
    expect(command(editor, [{type: 'set-gain', segmentIds: ['s'], gain: .5}])).toMatchObject({status: 'failed', error: {code: 'disposed'}});
    expect(editor.getSnapshot().status).toBe('disposed'); expect(store.getStats().assets).toBe(0);
  });
});

describe('borrowed asset adapter reentrancy', () => {
  function borrowed(history: AudioClipEditorOptions['history'] = false) {
    const store = createMemoryAudioAssetStore(), imported = store.registerClip(clip(), {id: 'a'});
    let retained = 0;
    const released: number[] = [];
    let onRetain: (() => void) | undefined;
    let onRelease: (() => void) | undefined;
    let onReferenceCount: (() => void) | undefined;
    let throwOnRelease = false;
    const assets = {...store, getReferenceCount(id: string) {
      const count = store.getReferenceCount(id), callback = onReferenceCount; onReferenceCount = undefined; callback?.(); return count;
    }, retain(ids: readonly string[]) {
      const lease = store.retain(ids), leaseId = ++retained, callback = onRetain; onRetain = undefined; callback?.();
      return {assetIds: lease.assetIds, get released() {return lease.released;}, release() {
        released.push(leaseId);
        lease.release(); const releasedCallback = onRelease; onRelease = undefined; releasedCallback?.();
        if (throwOnRelease) throw new Error('cleanup');
      }};
    }};
    const content = createAudioSequence({sampleRate: 8000, channelLayout: ['mono'], segments: [{kind: 'asset', id: 's', assetId: 'a', sourceStart: 0, sourceEnd: 8}]}, assets);
    const errors = vi.fn(), editor = createAudioClipEditor(content, {assets, history, onListenerError: errors}); imported.release();
    return {store, editor, errors, released, onRetain: (callback: () => void) => {onRetain = callback;},
      onRelease: (callback: () => void) => {onRelease = callback;},
      onReferenceCount: (callback: () => void) => {onReferenceCount = callback;}, failRelease: () => {throwOnRelease = true;}};
  }
  it('preserves content, redo, clipboard and drafts on failed history accounting and retries the same command', () => {
    const {editor, store, onReferenceCount} = borrowed({});
    command(editor, [{type: 'set-gain', segmentIds: ['s'], gain: .5}]); editor.undo(); editor.markSaved();
    editor.copy({startFrame: 0, endFrame: 2}).release();
    const session = editor.createInteractionSession();
    session.preview([{type: 'set-gain', segmentIds: ['s'], gain: .25}]);
    const snapshot = editor.getSnapshot(), state = editor.getState(), draft = session.getSnapshot().draft, stats = store.getStats();
    const observed: number[] = []; editor.subscribe((value) => observed.push(value.documentRevision));
    const request = {version: 1 as const, documentId: snapshot.documentId, expectedRevision: snapshot.documentRevision,
      label: 'Retried gain', operations: [{type: 'set-gain' as const, segmentIds: ['s'], gain: .75}]};
    onReferenceCount(() => {throw new Error('Accounting unavailable');});
    expect(editor.execute(request)).toMatchObject({status: 'failed', error: {message: 'Accounting unavailable'}});
    expect(editor.getSnapshot()).toBe(snapshot); expect(editor.getState()).toBe(state);
    expect(session.getSnapshot().draft).toBe(draft); expect(store.getStats()).toEqual(stats);
    expect(observed).toEqual([snapshot.documentRevision]);
    expect(editor.execute(request)).toMatchObject({status: 'committed'});
    expect(observed).toEqual([snapshot.documentRevision, snapshot.documentRevision + 1]);
    expect(editor.getState()).toMatchObject({document: editor.getSnapshot(), dirty: true,
      history: {undoCount: 1, redoCount: 0}, clipboard: {length: 2}});
    expect(session.getSnapshot().draft).toBeUndefined();
    expect(editor.undo().status).toBe('committed'); expect(editor.getSnapshot().contentId).toBe(snapshot.contentId);
    expect(editor.redo().status).toBe('committed'); editor.dispose(); expect(store.getStats().leases).toBe(0);
  });
  it('does not move undo or redo entries before history accounting succeeds', () => {
    const {editor, store, onReferenceCount} = borrowed({});
    command(editor, [{type: 'set-gain', segmentIds: ['s'], gain: .5}]);
    for (const direction of ['undo', 'redo'] as const) {
      const snapshot = editor.getSnapshot(), state = editor.getState(), stats = store.getStats();
      const guard = {documentId: snapshot.documentId, expectedRevision: snapshot.documentRevision};
      onReferenceCount(() => {throw new Error('Accounting unavailable');});
      expect(editor[direction](guard).status).toBe('failed');
      expect(editor.getSnapshot()).toBe(snapshot); expect(editor.getState()).toBe(state); expect(store.getStats()).toEqual(stats);
      expect(editor[direction](guard).status).toBe('committed');
      expect(editor.getState().document).toBe(editor.getSnapshot());
    }
    editor.dispose(); expect(store.getStats().leases).toBe(0);
  });
  it('rejects a history-only descriptor failure before deleting content and retries with the original guard', () => {
    const store = createMemoryAudioAssetStore(), imported = store.registerClip(clip(), {id: 'a'});
    const content = createAudioSequence({sampleRate: 8000, channelLayout: ['mono'], segments: [
      {kind: 'asset', id: 's', assetId: 'a', sourceStart: 0, sourceEnd: 8},
    ]}, store);
    let armed = true, failDescriptor = false;
    const assets = {...store, getReferenceCount(id: string) {if (armed) failDescriptor = true; return store.getReferenceCount(id);},
      getDescriptor(id: string) {if (failDescriptor) throw new Error('Descriptor unavailable'); return store.getDescriptor(id);}};
    const editor = createAudioClipEditor(content, {assets, history: {assetBytes: 0}}); imported.release();
    const snapshot = editor.getSnapshot(), state = editor.getState(), stats = store.getStats();
    const request = {version: 1 as const, documentId: snapshot.documentId, expectedRevision: 0,
      label: 'Delete', operations: [{type: 'trim' as const, startFrame: 0, endFrame: 0}]};
    expect(editor.execute(request)).toMatchObject({status: 'failed', error: {message: 'Descriptor unavailable'}});
    expect(editor.getSnapshot()).toBe(snapshot); expect(editor.getState()).toBe(state); expect(store.getStats()).toEqual(stats);
    armed = false; failDescriptor = false;
    expect(editor.execute(request).status).toBe('committed');
    expect(editor.getState().history).toMatchObject({undoCount: 0, trimmedCount: 1, historyOnlyBytes: 0});
    expect(store.getStats().assets).toBe(0); editor.dispose();
  });
  it('keeps a pending processor current when another command fails its history preflight', async () => {
    const store = createMemoryAudioAssetStore(), imported = store.registerClip(clip(), {id: 'a'});
    const content = createAudioSequence({sampleRate: 8000, channelLayout: ['mono'], segments: [
      {kind: 'asset', id: 's', assetId: 'a', sourceStart: 0, sourceEnd: 8},
    ]}, store);
    let fail = false, signal: AbortSignal | undefined, resolve!: (output: AudioClip) => void;
    const assets = {...store, getReferenceCount(id: string) {if (fail) throw new Error('Accounting unavailable'); return store.getReferenceCount(id);}};
    const editor = createAudioClipEditor(content, {assets, processors: [processor({process: (input) => {
      signal = input.signal; return new Promise<AudioClip>((done) => {resolve = done;});
    }})]}); imported.release();
    const snapshot = editor.getSnapshot(), pending = editor.processRange(processRequest(editor));
    fail = true;
    expect(command(editor, [{type: 'set-gain', segmentIds: ['s'], gain: .5}]).status).toBe('failed');
    expect(editor.getSnapshot()).toBe(snapshot); expect(signal?.aborted).toBe(false); expect(editor.getState().processing).toBe(true);
    fail = false; resolve(clip(2)); expect((await pending).status).toBe('committed');
    expect(editor.getState()).toMatchObject({document: editor.getSnapshot(), processing: false});
    expect(editor.getSnapshot().documentRevision).toBe(1); editor.dispose(); expect(store.getStats().leases).toBe(0);
  });
  it('reports post-adoption accounting failure and evicts unmeasurable history without hiding the commit', () => {
    const {editor, store, errors, onRelease, onReferenceCount} = borrowed({});
    const observed: number[] = []; editor.subscribe((snapshot) => observed.push(snapshot.documentRevision));
    onRelease(() => onReferenceCount(() => {throw new Error('Accounting failed during cleanup');}));
    expect(command(editor, [{type: 'set-gain', segmentIds: ['s'], gain: .5}])).toMatchObject({status: 'committed'});
    expect(editor.getState()).toMatchObject({document: editor.getSnapshot(), history: {undoCount: 0, redoCount: 0, trimmedCount: 1, historyOnlyBytes: 0}});
    expect(observed).toEqual([0, 1]); expect(errors).toHaveBeenCalledWith(expect.objectContaining({message: 'Accounting failed during cleanup'}));
    expect(store.getStats().leases).toBe(1);
    expect(command(editor, [{type: 'set-gain', segmentIds: ['s'], gain: .25}]).status).toBe('committed');
    expect(editor.undo().status).toBe('committed'); expect((editor.sequence.segments[0] as AudioAssetSegment).gain).toBe(.5);
    editor.dispose(); expect(store.getStats().leases).toBe(0);
  });
  it('rejects content edits from history release callbacks without recreating cleared history', () => {
    const {editor, store, onRelease} = borrowed({});
    command(editor, [{type: 'set-gain', segmentIds: ['s'], gain: .5}]);
    const snapshot = editor.getSnapshot();
    let nested: ReturnType<typeof editor.execute> | undefined;
    onRelease(() => {nested = command(editor, [{type: 'set-gain', segmentIds: ['s'], gain: .25}]);});
    editor.clearHistory();
    expect(nested).toMatchObject({status: 'failed', error: {code: 'reentrant-command'}});
    expect(editor.getSnapshot()).toBe(snapshot);
    expect(editor.getState().history).toMatchObject({undoCount: 0, redoCount: 0, historyOnlyBytes: 0});
    expect(command(editor, [{type: 'set-gain', segmentIds: ['s'], gain: .75}]).status).toBe('committed');
    editor.dispose(); expect(store.getStats().leases).toBe(0);
  });
  it('keeps history clearing terminal when releasing a history lease disposes the owner', () => {
    const {editor, store, onRelease, released} = borrowed({});
    command(editor, [{type: 'set-gain', segmentIds: ['s'], gain: .5}]);
    command(editor, [{type: 'set-gain', segmentIds: ['s'], gain: .25}]);
    editor.undo(); const revision = editor.getSnapshot().documentRevision;
    onRelease(() => editor.dispose()); editor.clearHistory();
    expect(editor.getState()).toMatchObject({document: {status: 'disposed', documentRevision: revision},
      history: {undoCount: 0, redoCount: 0, historyOnlyBytes: 0}});
    expect(editor.getState().document).toBe(editor.getSnapshot());
    expect(new Set(released).size).toBe(released.length);
    expect(store.getStats()).toEqual({assets: 0, leases: 0, bytes: 0}); editor.dispose();
  });
  it('keeps cleanup error reporters inside the history clearing guard and continues releasing entries', () => {
    const {editor, store, errors, failRelease} = borrowed({});
    command(editor, [{type: 'set-gain', segmentIds: ['s'], gain: .5}]);
    command(editor, [{type: 'set-gain', segmentIds: ['s'], gain: .25}]);
    const snapshot = editor.getSnapshot(), nested: ReturnType<typeof editor.execute>[] = [];
    errors.mockImplementation(() => {nested.push(command(editor, [{type: 'set-gain', segmentIds: ['s'], gain: .75}]));});
    failRelease(); editor.clearHistory();
    expect(nested).toHaveLength(2);
    for (const result of nested) expect(result).toMatchObject({status: 'failed', error: {code: 'reentrant-command'}});
    expect(editor.getSnapshot()).toBe(snapshot);
    expect(editor.getState().history).toMatchObject({undoCount: 0, redoCount: 0});
    expect(store.getStats().leases).toBe(1);
    errors.mockImplementation(() => {});
    expect(command(editor, [{type: 'set-gain', segmentIds: ['s'], gain: .75}]).status).toBe('committed');
    editor.dispose(); expect(store.getStats().leases).toBe(0);
  });
  it('rejects nested clipboard replacement while clearing and releases the detached clipboard once', () => {
    const {editor, store, onRelease, released} = borrowed();
    editor.copy({startFrame: 0, endFrame: 2}).release();
    onRelease(() => {
      expect(() => editor.copy({startFrame: 2, endFrame: 4})).toThrowError(expect.objectContaining({code: 'reentrant-command'}));
      editor.dispose();
    });
    editor.clearClipboard();
    expect(editor.getState()).toMatchObject({document: {status: 'disposed'}, clipboard: {hasContent: false}});
    expect(new Set(released).size).toBe(released.length); expect(store.getStats()).toEqual({assets: 0, bytes: 0, leases: 0});
    editor.dispose();
  });
  it('releases edit candidates when discarding redo disposes the owner', () => {
    const {editor, store, onRelease} = borrowed({});
    command(editor, [{type: 'set-gain', segmentIds: ['s'], gain: .5}]); editor.undo();
    const base = editor.getSnapshot(), observed: string[] = [];
    editor.subscribe((snapshot) => observed.push(snapshot.status)); onRelease(() => editor.dispose());
    expect(command(editor, [{type: 'set-gain', segmentIds: ['s'], gain: .25}])).toMatchObject({status: 'failed', error: {code: 'disposed'}});
    expect(editor.getSnapshot()).toMatchObject({status: 'disposed', documentRevision: base.documentRevision, contentId: base.contentId});
    expect(editor.getState().history).toMatchObject({undoCount: 0, redoCount: 0});
    expect(observed).toEqual(['ready', 'disposed']); expect(store.getStats()).toEqual({assets: 0, bytes: 0, leases: 0});
    editor.dispose();
  });
  it('releases a restore candidate when history cleanup disposes the owner', () => {
    const {editor, store, onRelease} = borrowed({}), checkpoint = editor.createCheckpoint();
    command(editor, [{type: 'set-gain', segmentIds: ['s'], gain: .5}]);
    const base = editor.getSnapshot(); onRelease(() => editor.dispose());
    expect(editor.restoreCheckpoint(checkpoint)).toMatchObject({status: 'failed', error: {code: 'disposed'}});
    expect(editor.getSnapshot()).toMatchObject({status: 'disposed', documentRevision: base.documentRevision, contentId: base.contentId});
    expect(editor.getState().history).toMatchObject({undoCount: 0, redoCount: 0});
    expect(store.getStats().leases).toBe(1); checkpoint.release();
    expect(store.getStats()).toEqual({assets: 0, bytes: 0, leases: 0}); editor.dispose();
  });
  it('releases replacement clipboard leases when retiring the previous clipboard disposes the owner', () => {
    const {editor, store, onRelease} = borrowed();
    editor.copy({startFrame: 0, endFrame: 1}).release(); onRelease(() => editor.dispose());
    expect(() => editor.copy({startFrame: 2, endFrame: 4})).toThrowError(expect.objectContaining({code: 'disposed'}));
    expect(editor.getSnapshot().status).toBe('disposed'); expect(editor.getState().clipboard.hasContent).toBe(false);
    expect(store.getStats()).toEqual({assets: 0, bytes: 0, leases: 0}); editor.dispose();
  });
  it('does not publish pre-disposal state when history accounting disposes the owner', () => {
    const {editor, store, onReferenceCount} = borrowed({});
    // Allow the pruning check, then dispose from the accounting read for the published state.
    onReferenceCount(() => onReferenceCount(() => editor.dispose()));
    expect(command(editor, [{type: 'set-gain', segmentIds: ['s'], gain: .5}])).toMatchObject({status: 'committed'});
    expect(editor.getSnapshot()).toMatchObject({status: 'disposed', documentRevision: 1});
    expect(editor.getState().document).toBe(editor.getSnapshot());
    expect(editor.getState().history).toMatchObject({historyOnlyBytes: 0, undoCount: 0, redoCount: 0});
    expect(store.getStats()).toEqual({assets: 0, bytes: 0, leases: 0}); editor.dispose();
  });
  it('exposes terminal state to reads and new subscribers before releasing history or clipboard', () => {
    const {editor, store, onRelease} = borrowed({});
    command(editor, [{type: 'set-gain', segmentIds: ['s'], gain: .5}]);
    editor.copy({startFrame: 0, endFrame: 1}).release();
    let stateDuringRelease: ReturnType<typeof editor.getState> | undefined;
    const subscribedStates: string[] = [];
    onRelease(() => {
      stateDuringRelease = editor.getState(); editor.subscribeState((state) => subscribedStates.push(state.document.status));
    });
    editor.dispose();
    expect(stateDuringRelease).toMatchObject({document: {status: 'disposed'}, history: {undoCount: 0, redoCount: 0, historyOnlyBytes: 0}, clipboard: {hasContent: false}, processing: false});
    expect(subscribedStates).toEqual(['disposed']); expect(editor.getState().document).toBe(editor.getSnapshot());
    expect(store.getStats()).toEqual({assets: 0, bytes: 0, leases: 0});
  });
  it('creates a checkpoint for its captured root when retain triggers a later edit', () => {
    const {editor, store, onRetain} = borrowed(), base = editor.getSnapshot();
    onRetain(() => {command(editor, [{type: 'trim', startFrame: 0, endFrame: 0}]);});
    const checkpoint = editor.createCheckpoint();
    expect(checkpoint.contentId).toBe(base.contentId); expect(checkpoint.content).toBe(base.content); expect(editor.sequence.length).toBe(0);
    expect(store.getDescriptor('a')).toBeDefined(); checkpoint.release(); expect(store.getDescriptor('a')).toBeUndefined(); editor.dispose();
  });
  it('releases a candidate draft if retain edits the base before the draft is installed', () => {
    const {editor, store, onRetain} = borrowed(), session = editor.createInteractionSession();
    onRetain(() => {command(editor, [{type: 'trim', startFrame: 0, endFrame: 0}]);});
    expect(session.preview([{type: 'set-gain', segmentIds: ['s'], gain: .5}])).toMatchObject({status: 'failed', error: {code: 'revision-conflict'}});
    expect(session.getSnapshot().draft).toBeUndefined(); expect(store.getDescriptor('a')).toBeUndefined(); editor.dispose();
  });
  it('releases a replacement draft exactly once if retiring its predecessor disposes the session', () => {
    const {editor, store, onRelease, released} = borrowed(), session = editor.createInteractionSession();
    expect(session.preview([{type: 'set-gain', segmentIds: ['s'], gain: .5}]).status).toBe('preview');
    onRelease(() => session.dispose());
    expect(session.preview([{type: 'set-gain', segmentIds: ['s'], gain: .25}]))
      .toMatchObject({status: 'failed', error: {code: 'disposed'}});
    expect(session.getSnapshot()).toMatchObject({disposed: true}); expect(session.getSnapshot().draft).toBeUndefined();
    session.dispose(); editor.dispose();
    expect(released.slice().sort()).toEqual([1, 2, 3]);
    expect(store.getStats()).toEqual({assets: 0, bytes: 0, leases: 0});
  });
  it('rejects nested preview while replacing a draft without orphaning either lease', () => {
    const {editor, store, onRelease, released} = borrowed(), session = editor.createInteractionSession();
    session.preview([{type: 'set-gain', segmentIds: ['s'], gain: .5}]);
    let nested: ReturnType<typeof session.preview> | undefined;
    onRelease(() => {nested = session.preview([{type: 'set-gain', segmentIds: ['s'], gain: .125}]);});
    expect(session.preview([{type: 'set-gain', segmentIds: ['s'], gain: .25}]).status).toBe('preview');
    expect(nested).toMatchObject({status: 'failed', error: {code: 'reentrant-command'}});
    expect(session.getSnapshot().draft?.content.segments[0]).toMatchObject({gain: .25});
    session.dispose(); editor.dispose();
    expect(released.slice().sort()).toEqual([1, 2, 3]);
    expect(store.getStats()).toEqual({assets: 0, bytes: 0, leases: 0});
  });
  it('releases the replacement candidate when retiring its predecessor edits the document', () => {
    const {editor, store, onRelease, released} = borrowed(), session = editor.createInteractionSession();
    session.setSelection({startFrame: 5, endFrame: 7});
    session.preview([{type: 'set-gain', segmentIds: ['s'], gain: .5}]);
    let edit: ReturnType<typeof editor.execute> | undefined;
    onRelease(() => {edit = command(editor, [{type: 'trim', startFrame: 0, endFrame: 0}]);});
    expect(session.preview([{type: 'set-gain', segmentIds: ['s'], gain: .25}]))
      .toMatchObject({status: 'failed', error: {code: 'revision-conflict'}});
    expect(edit).toMatchObject({status: 'committed'});
    expect(session.getSnapshot().selection).toEqual({startFrame: 0, endFrame: 0});
    expect(session.getSnapshot().draft).toBeUndefined(); expect(store.getDescriptor('a')).toBeUndefined();
    session.dispose(); editor.dispose(); expect(released.slice().sort()).toEqual([1, 2, 3, 4]);
    expect(store.getStats()).toEqual({assets: 0, bytes: 0, leases: 0});
  });
  it.each(['editor', 'session'] as const)('keeps the session terminal when draft invalidation disposes the %s', (owner) => {
    const {editor, store, onRelease, released} = borrowed(), session = editor.createInteractionSession();
    session.preview([{type: 'set-gain', segmentIds: ['s'], gain: .5}]);
    const observed: boolean[] = [];
    session.subscribe((snapshot) => observed.push(snapshot.disposed));
    // The commit retires its old current lease before invalidating the draft.
    onRelease(() => onRelease(() => {if (owner === 'editor') editor.dispose(); else session.dispose();}));
    expect(command(editor, [{type: 'set-gain', segmentIds: ['s'], gain: .75}]).status).toBe('committed');
    expect(session.getSnapshot()).toMatchObject({disposed: true}); expect(session.getSnapshot().draft).toBeUndefined();
    expect(observed).toEqual([false, true]);
    session.dispose(); editor.dispose();
    expect(released.slice().sort()).toEqual([1, 2, 3]);
    expect(store.getStats()).toEqual({assets: 0, bytes: 0, leases: 0});
  });
  it('rejects nested preview during document invalidation and preserves the mapped selection', () => {
    const {editor, store, onRelease, released} = borrowed(), session = editor.createInteractionSession();
    session.setSelection({startFrame: 5, endFrame: 7});
    session.preview([{type: 'set-gain', segmentIds: ['s'], gain: .5}]);
    let nested: ReturnType<typeof session.preview> | undefined;
    onRelease(() => onRelease(() => {nested = session.preview([{type: 'set-gain', segmentIds: ['s'], gain: .125}]);}));
    expect(command(editor, [{type: 'trim', startFrame: 2, endFrame: 6}]).status).toBe('committed');
    expect(nested).toMatchObject({status: 'failed', error: {code: 'reentrant-command'}});
    expect(session.getSnapshot().selection).toEqual({startFrame: 3, endFrame: 4});
    expect(session.getSnapshot().draft).toBeUndefined();
    session.dispose(); editor.dispose();
    expect(released.slice().sort()).toEqual([1, 2, 3]);
    expect(store.getStats()).toEqual({assets: 0, bytes: 0, leases: 0});
  });
  it('preserves a newer mapped selection when cancel cleanup edits the document', () => {
    const {editor, store, onRelease, released} = borrowed(), session = editor.createInteractionSession();
    session.setSelection({startFrame: 5, endFrame: 7});
    session.preview([{type: 'set-gain', segmentIds: ['s'], gain: .5}]);
    let nested: ReturnType<typeof session.preview> | undefined;
    let edit: ReturnType<typeof editor.execute> | undefined;
    onRelease(() => {
      expect(session.getSnapshot().draft).toBeUndefined();
      nested = session.preview([{type: 'set-gain', segmentIds: ['s'], gain: .125}]);
      edit = command(editor, [{type: 'trim', startFrame: 2, endFrame: 6}]);
    });
    session.cancelDraft();
    expect(nested).toMatchObject({status: 'failed', error: {code: 'reentrant-command'}});
    expect(edit).toMatchObject({status: 'committed'});
    expect(session.getSnapshot().selection).toEqual({startFrame: 3, endFrame: 4});
    expect(session.getSnapshot().draft).toBeUndefined();
    session.dispose(); editor.dispose();
    expect(released.slice().sort()).toEqual([1, 2, 3]);
    expect(store.getStats()).toEqual({assets: 0, bytes: 0, leases: 0});
  });
  it('exposes terminal session state before draft cleanup and rejects nested commands', () => {
    const {editor, store, onRelease, released} = borrowed(), session = editor.createInteractionSession();
    session.preview([{type: 'set-gain', segmentIds: ['s'], gain: .5}]);
    const observed: boolean[] = [];
    let nested: ReturnType<typeof session.preview> | undefined;
    onRelease(() => {
      session.subscribe((snapshot) => observed.push(snapshot.disposed));
      expect(session.getSnapshot().draft).toBeUndefined();
      nested = session.preview([{type: 'set-gain', segmentIds: ['s'], gain: .125}]);
      session.dispose();
    });
    session.dispose();
    expect(observed).toEqual([true]); expect(nested).toMatchObject({status: 'failed', error: {code: 'disposed'}});
    editor.dispose(); expect(released.slice().sort()).toEqual([1, 2]);
    expect(store.getStats()).toEqual({assets: 0, bytes: 0, leases: 0});
  });
  it('keeps a committed outcome when final draft cleanup attempts a nested preview', () => {
    const {editor, store, onRelease, released} = borrowed(), session = editor.createInteractionSession();
    session.preview([{type: 'set-gain', segmentIds: ['s'], gain: .5}]);
    let nested: ReturnType<typeof session.preview> | undefined;
    // The first release retires committed content; the second releases the held draft.
    onRelease(() => onRelease(() => {nested = session.preview([{type: 'set-gain', segmentIds: ['s'], gain: .125}]);}));
    expect(session.commitDraft()).toMatchObject({status: 'committed', snapshot: {documentRevision: 1}});
    expect(nested).toMatchObject({status: 'failed', error: {code: 'reentrant-command'}});
    expect(editor.sequence.segments[0]).toMatchObject({gain: .5}); expect(session.getSnapshot().draft).toBeUndefined();
    session.dispose(); editor.dispose(); expect(released.slice().sort()).toEqual([1, 2, 3]);
    expect(store.getStats()).toEqual({assets: 0, bytes: 0, leases: 0});
  });
  it('reports cleanup errors while preserving committed results and continuing disposal', () => {
    const {editor, store, failRelease, errors} = borrowed(); failRelease();
    expect(command(editor, [{type: 'set-gain', segmentIds: ['s'], gain: .5}])).toMatchObject({status: 'committed'});
    expect(editor.getSnapshot().documentRevision).toBe(1); expect(errors).toHaveBeenCalledTimes(1);
    editor.dispose(); expect(store.getStats().assets).toBe(0); expect(errors).toHaveBeenCalledTimes(2);
  });
});

describe('command schema validation', () => {
  it('rejects missing required arrays and explicit null defaults', () => {
    const editor = setup(), segment = editor.sequence.segments[0];
    for (const operation of [
      {type: 'splice', startFrame: 0, deleteCount: 8},
      {type: 'set-envelope', segmentId: segment.id},
      {type: 'splice', startFrame: 0, deleteCount: 8, segments: [{...segment, gain: null}]},
      {type: 'splice', startFrame: 0, deleteCount: 8, segments: [{...segment, envelope: null}]},
    ]) expect(command(editor, [operation as never])).toMatchObject({status: 'failed'});
    expect(editor.getSnapshot().documentRevision).toBe(0); editor.dispose();
  });
});

describe('Audio editor structural guard', () => {
  it('returns false instead of throwing when a command property accessor fails', async () => {
    const {isAudioClipEditorPort} = await import('../../src/core/editing');
    const editor = setup();
    const source = {getSnapshot: () => editor.getSnapshot(), subscribe: editor.subscribe.bind(editor),
      get getState() {throw new Error('unavailable');}};
    expect(isAudioClipEditorPort(source)).toBe(false); editor.dispose();
  });
});

describe('history budget for sliced PCM', () => {
  it('prunes history by retained backing bytes instead of visible slice length', () => {
    const original = createAudioClip({sampleRate: 1000, channelData: [new Float32Array(10000)]});
    const editor = createAudioClipEditor(original.slice(1, 1.01), {history: {assetBytes: 1000}});
    const assets = editor.getSnapshot().assets, assetId = (editor.sequence.segments[0] as AudioAssetSegment).assetId;
    expect(command(editor, [{type: 'trim', startFrame: 0, endFrame: 0}])).toMatchObject({status: 'committed'});
    expect(editor.getState().history).toMatchObject({undoCount: 0, trimmedCount: 1});
    expect(assets.getDescriptor(assetId)).toBeUndefined(); editor.dispose();
  });
});

describe('processing output backing budget', () => {
  it('rejects a short result that retains an undeclared large backing buffer', async () => {
    const large = createAudioClip({sampleRate: 8000, channelData: [new Float32Array(10000)]});
    const editor = setup({processingMaxBytes: 1000, processors: [processor({process: async () => large.slice(0, 2 / 8000)})]});
    expect(await editor.processRange(processRequest(editor))).toMatchObject({status: 'failed', error: {code: 'resource-limit'}});
    expect(editor.getSnapshot().documentRevision).toBe(0); expect(editor.getSnapshot().assets.getDescriptor('processed')).toBeUndefined(); editor.dispose();
  });
});
