import {describe, expect, it, vi} from 'vitest';
import {AudioEditError, createAudioClip, createAudioSequence, createMemoryAudioAssetStore, type AudioDocumentPlaybackBinding} from '../../src/core';
import {createAudioClipEditor} from '../../src/edit/headless';
import {createAudioSequenceWaveform} from '../../src/view/headless/sequence-waveform';
import {audioDocumentPlaybackCompatible, createAudioViewEditing} from '../../src/view/headless/audio-editing';
import {createWaveformViewModel} from '../../src/view/headless/waveform';

const clip = (length = 1024) => createAudioClip({sampleRate: 100, channelData: [Float32Array.from({length}, (_, index) => index % 2 ? .5 : -.25)]});

describe('reference-based waveform projection', () => {
  it('lazily reads only visible source ranges with bounded copy buffers and reuses extrema after gain edits', () => {
    const editor = createAudioClipEditor(clip(8192));
    const snapshot = editor.getSnapshot();
    const read = vi.fn(snapshot.assets.read.bind(snapshot.assets));
    const source = createAudioSequenceWaveform(snapshot.content, {...snapshot.assets, read});
    expect(read).not.toHaveBeenCalled();
    expect(source.readPeaks(0, 1024)).toEqual([{min: -.25, max: .5}]);
    expect(read.mock.calls.every(([, , channels]) => channels.every((channel) => channel.length <= 256))).toBe(true);
    expect(read.mock.calls.reduce((count, [, , channels]) => count + channels[0].length, 0)).toBe(1024);
    const reads = read.mock.calls.length;
    const next = createAudioSequence({...snapshot.content, segments: snapshot.content.segments.map((segment) => segment.kind === 'asset' ? {...segment, gain: .5} : segment)}, snapshot.assets);
    source.setSequence(next);
    expect(read).toHaveBeenCalledTimes(reads);
    expect(source.readPeaks(0, 1024)).toEqual([{min: -.125, max: .25}]);
    expect(read).toHaveBeenCalledTimes(reads);
    source.dispose(); editor.dispose();
  });

  it('bounds peaks by interior envelope points without spreading every point per range', () => {
    const store = createMemoryAudioAssetStore();
    const lease = store.registerClip(createAudioClip({sampleRate: 1000, channelData: [new Float32Array(300_000).fill(1)]}));
    // A zoomed-out range holds more interior points than one call can spread
    // as arguments; the single dip at frame 150,000 bounds every range containing it.
    const envelope = Array.from({length: 150_001}, (_, index) => ({frame: index * 2, gain: index === 75_000 ? .25 : 1}));
    const sequence = createAudioSequence({sampleRate: 1000, channelLayout: ['mono'], segments: [{kind: 'asset', id: 'a', assetId: lease.assetIds[0], sourceStart: 0, sourceEnd: 300_000, gain: 1, envelope}]}, store);
    const source = createAudioSequenceWaveform(sequence, store);
    expect(source.readPeaks(0, 300_000)).toEqual([{min: .25, max: 1}]);
    expect(source.readPeaks(149_000, 151_000)).toEqual([{min: .25, max: 1}]);
    expect(source.readPeaks(0, 1000)).toEqual([{min: 1, max: 1}]);
    source.dispose(); lease.release(); store.dispose();
  });

  it('projects reordered references, silence and boundary envelopes without mutating assets', () => {
    const store = createMemoryAudioAssetStore();
    const lease = store.registerClip(createAudioClip({sampleRate: 10, channelData: [new Float32Array([1, -.5, .25, -.25])]}));
    const segment = {kind: 'asset' as const, id: 'a', assetId: lease.assetIds[0], sourceStart: 0, sourceEnd: 4, gain: 2, envelope: [{frame: 0, gain: 0}, {frame: 4, gain: 1}]};
    const sequence = createAudioSequence({sampleRate: 10, channelLayout: ['mono'], segments: [segment, {kind: 'silence', id: 's', length: 3}, {...segment, id: 'b', sourceStart: 2, gain: 1, envelope: []}]}, store);
    const source = createAudioSequenceWaveform(sequence, store);
    expect(source.readPeaks(0, 1)).toEqual([{min: 0, max: 0}]);
    expect(source.readPeaks(1, 2)).toEqual([{min: -.25, max: -.25}]);
    expect(source.readPeaks(4, 7)).toEqual([{min: 0, max: 0}]);
    expect(source.readPeaks(7, 9)).toEqual([{min: -.25, max: .25}]);
    expect(source.readPeaks(3, 8)).toEqual([{min: -.375, max: .25}]);
    const original = new Float32Array(4); store.read(lease.assetIds[0], 0, [original]);
    expect([...original]).toEqual([1, -.5, .25, -.25]);
    source.dispose(); lease.release(); expect(store.getStats().assets).toBe(0);
  });

  it('retains only its current sequence and releases the asset lease on repeated disposal', () => {
    const store = createMemoryAudioAssetStore(); const lease = store.registerClip(clip());
    const sequence = createAudioSequence({sampleRate: 100, channelLayout: ['mono'], segments: [{kind: 'asset', id: 'a', assetId: lease.assetIds[0], sourceStart: 0, sourceEnd: 1024, gain: 1, envelope: []}]}, store);
    const source = createAudioSequenceWaveform(sequence, store); lease.release();
    expect(store.getStats().leases).toBe(1);
    expect(source.readPeaks(0, 2)).toEqual([{min: -.25, max: .5}]);
    source.setSequence(createAudioSequence({sampleRate: 100, channelLayout: ['mono']}));
    expect(store.getStats().assets).toBe(0); expect(source.readPeaks(0, 0)).toEqual([{min: 0, max: 0}]);
    source.dispose(); source.dispose(); expect(() => source.readPeaks(0, 0)).toThrow('disposed');
  });

  it('keeps a ready empty sequence distinct and rejects invalid frame ranges and format changes', () => {
    const editor = createAudioClipEditor(clip(0)); const current = editor.getSnapshot();
    const source = createAudioSequenceWaveform(current.content, current.assets);
    expect(source.frameCount).toBe(0);
    expect(() => source.readPeaks(-1, 0)).toThrow('range'); expect(() => source.readPeaks(0, 1)).toThrow('range');
    expect(() => source.setSequence(createAudioSequence({sampleRate: 200, channelLayout: ['mono']}))).toThrow('format');
    expect(() => createAudioSequenceWaveform(current.content, current.assets, {cacheEntries: 0})).toThrow('cacheEntries');
    source.dispose(); editor.dispose();
  });

  it('lets Headless waveform columns read a bounded viewport with no work for a hidden view', () => {
    const editor = createAudioClipEditor(clip(10000)); const snapshot = editor.getSnapshot();
    const source = createAudioSequenceWaveform(snapshot.content, snapshot.assets);
    const readPeaks = vi.spyOn(source, 'readPeaks');
    const model = createWaveformViewModel(source, {pixelsPerSecond: 100, viewportWidth: 0});
    expect(model.columns()).toEqual([]); expect(readPeaks).not.toHaveBeenCalled();
    model.timeline.setViewport(20); model.timeline.setOffset(100);
    expect(model.columns()).toHaveLength(20);
    expect(readPeaks.mock.calls[0]).toEqual([100, 101]);
    expect(readPeaks.mock.calls.at(-1)).toEqual([119, 120]);
    source.dispose(); editor.dispose();
  });

  it('serves repeated paints of one viewport from a bounded range cache after asset bins overflow', () => {
    const editor = createAudioClipEditor(clip(8192)); const snapshot = editor.getSnapshot();
    const read = vi.fn(snapshot.assets.read.bind(snapshot.assets));
    // Four asset bins cannot hold one painted viewport of 16 zoomed-out columns.
    const source = createAudioSequenceWaveform(snapshot.content, {...snapshot.assets, read}, {cacheEntries: 4});
    const paint = () => Array.from({length: 16}, (_, x) => source.readPeaks(x * 512, (x + 1) * 512));
    const first = paint(), reads = read.mock.calls.length;
    expect(reads).toBeGreaterThan(0);
    expect(paint()).toEqual(first); expect(read).toHaveBeenCalledTimes(reads);
    expect(Object.isFrozen(first[0]) && Object.isFrozen(first[0][0])).toBe(true);
    source.setSequence(createAudioSequence({...snapshot.content, segments: snapshot.content.segments.map((segment) => segment.kind === 'asset' ? {...segment, gain: .5} : segment)}, snapshot.assets));
    expect(source.readPeaks(0, 512)).toEqual([{min: -.125, max: .25}]);
    source.dispose(); editor.dispose();
  });

  it('bounds the range cache and validates its size', () => {
    const editor = createAudioClipEditor(clip(1024)); const snapshot = editor.getSnapshot();
    const read = vi.fn(snapshot.assets.read.bind(snapshot.assets));
    const source = createAudioSequenceWaveform(snapshot.content, {...snapshot.assets, read}, {cacheEntries: 1, rangeCacheEntries: 2});
    source.readPeaks(0, 300); source.readPeaks(300, 600); const reads = read.mock.calls.length;
    source.readPeaks(0, 300); expect(read).toHaveBeenCalledTimes(reads);
    source.readPeaks(600, 900); source.readPeaks(300, 600); const later = read.mock.calls.length;
    source.readPeaks(0, 300); expect(read.mock.calls.length).toBeGreaterThan(later);
    for (const rangeCacheEntries of [0, 1.5]) expect(() => createAudioSequenceWaveform(snapshot.content, snapshot.assets, {rangeCacheEntries})).toThrow('rangeCacheEntries');
    source.dispose(); editor.dispose();
  });

  it('skips Headless columns beyond a shorter sequence source instead of requesting invalid ranges', () => {
    const editor = createAudioClipEditor(clip(100)); const snapshot = editor.getSnapshot();
    const source = createAudioSequenceWaveform(snapshot.content, snapshot.assets);
    const model = createWaveformViewModel(source, {pixelsPerSecond: 100, viewportWidth: 300, durationSeconds: 3});
    const columns = model.columns();
    expect(columns).toHaveLength(100); expect(columns.at(-1)!.x).toBe(99);
    model.timeline.setZoom(40); expect(model.columns().at(-1)!.x).toBe(39);
    source.dispose(); editor.dispose();
  });
});

describe('Audio View editing sessions', () => {
  it('returns the original failure when a synchronous observer clears the displayed error', () => {
    const editor = createAudioClipEditor(clip()); const view = createAudioViewEditing(editor);
    let observed: AudioEditError | undefined;
    const off = view.subscribe((state) => {
      if (state.error) { observed = state.error; view.cancel(); }
    });
    const result = view.execute('Trim', [{type: 'trim', startFrame: 0, endFrame: 10}]);
    expect(result.status).toBe('failed');
    if (result.status === 'failed') {
      expect(result.error).toBeInstanceOf(AudioEditError); expect(result.error).toBe(observed);
      expect(result.error.message).toBe('Editing is disabled');
    }
    expect(view.state.error).toBeUndefined(); expect(editor.getSnapshot().documentRevision).toBe(0);
    off(); view.dispose(); editor.dispose();
  });

  it('keeps local selections separate and borrows a shared session without disposing it', () => {
    const editor = createAudioClipEditor(clip());
    const first = createAudioViewEditing(editor), second = createAudioViewEditing(editor);
    first.select({startFrame: 4, endFrame: 12}); expect(second.state.interaction.selection).toEqual({startFrame: 0, endFrame: 0});
    const shared = createAudioViewEditing(editor, {interactionSession: first.session});
    shared.select({startFrame: 2, endFrame: 7}); expect(first.state.interaction.selection).toEqual({startFrame: 2, endFrame: 7});
    shared.dispose(); expect(first.session.getSnapshot().disposed).toBe(false);
    first.dispose(); expect(editor.getSnapshot().status).toBe('ready'); second.dispose(); editor.dispose();
  });

  it('rejects foreign sessions and readonly mutation, and cancels a draft when editable is disabled', () => {
    const editor = createAudioClipEditor(clip()), other = createAudioClipEditor(clip());
    const foreign = other.createInteractionSession();
    expect(() => createAudioViewEditing(editor, {interactionSession: foreign})).toThrow('belong');
    const view = createAudioViewEditing(editor);
    expect(view.execute('Trim', [{type: 'trim', startFrame: 0, endFrame: 10}]).status).toBe('failed');
    view.setEditable(true); expect(view.preview([{type: 'trim', startFrame: 0, endFrame: 10}]).status).toBe('preview');
    expect(editor.getSnapshot().documentRevision).toBe(0);
    view.setEditable(false); expect(view.state.interaction.draft).toBeUndefined();
    view.dispose(); foreign.dispose(); editor.dispose(); other.dispose();
  });

  it('commits one draft then undo/redo at fresh revisions and cancels external revisions', () => {
    const editor = createAudioClipEditor(clip()); const view = createAudioViewEditing(editor, {editable: true});
    view.preview([{type: 'trim', startFrame: 10, endFrame: 20}]); view.preview([{type: 'trim', startFrame: 10, endFrame: 30}]);
    expect(view.commit('Trim').status).toBe('committed'); expect(editor.getState().history.undoCount).toBe(1);
    expect(editor.getSnapshot().content.length).toBe(20); expect(view.undo().status).toBe('committed');
    expect(editor.getSnapshot().content.length).toBe(1024); expect(view.redo().status).toBe('committed');
    view.preview([{type: 'trim', startFrame: 0, endFrame: 10}]); editor.undo(); expect(view.state.interaction.draft).toBeUndefined();
    expect(editor.getSnapshot().documentRevision).toBe(4); view.dispose(); editor.dispose();
  });

  it('cancels from a subscriber after a revision already discarded the draft without a reentrant command', () => {
    const editor = createAudioClipEditor(clip()); const view = createAudioViewEditing(editor, {editable: true});
    const failed = vi.spyOn(console, 'error').mockImplementation(() => {});
    view.preview([{type: 'trim', startFrame: 0, endFrame: 10}]);
    let armed = true, cancelled = false;
    const off = view.subscribe((state) => {
      if (!armed || state.interaction.draft) return;
      armed = false; view.cancel(); cancelled = true;
    });
    editor.execute({version: 1, documentId: editor.getSnapshot().documentId, expectedRevision: 0, label: 'External', operations: [{type: 'insert-silence', frame: 0, length: 5, id: 'external'}]});
    expect(cancelled).toBe(true); expect(failed).not.toHaveBeenCalled();
    expect(view.state.interaction.draft).toBeUndefined(); expect(view.state.document.documentRevision).toBe(1);
    off(); failed.mockRestore(); view.dispose(); editor.dispose();
  });

  it('copy releases its returned lease while editor clipboard survives for paste/cut', () => {
    const editor = createAudioClipEditor(clip()); const view = createAudioViewEditing(editor, {editable: true});
    const copy = vi.spyOn(editor, 'copy');
    view.select({startFrame: 0, endFrame: 10}); expect(view.copy()).toEqual({status: 'copied', length: 10});
    expect(copy.mock.results[0].value.released).toBe(true); expect(editor.getState().clipboard.hasContent).toBe(true);
    expect(view.cut().status).toBe('committed'); expect(editor.getSnapshot().content.length).toBe(1014);
    expect(view.paste().status).toBe('committed'); expect(editor.getSnapshot().content.length).toBe(1024);
    view.dispose(); editor.dispose();
  });

  it('requires ready, exact applied identity/revision and valid coordinates for playback paint', () => {
    const editor = createAudioClipEditor(clip()); const document = editor.getSnapshot();
    const binding: AudioDocumentPlaybackBinding = {status: 'ready', attempt: 1, documentCoordinates: true,
      applied: {documentId: document.documentId, documentRevision: 0}};
    expect(audioDocumentPlaybackCompatible(document, binding)).toBe(true);
    for (const incompatible of [undefined, {...binding, status: 'preparing' as const}, {...binding, documentCoordinates: false},
      {...binding, applied: {...binding.applied!, documentRevision: 1}}, {...binding, applied: {...binding.applied!, documentId: 'other'}}]) {
      expect(audioDocumentPlaybackCompatible(document, incompatible)).toBe(false);
    }
    editor.dispose(); expect(audioDocumentPlaybackCompatible(editor.getSnapshot(), binding)).toBe(false);
  });
});
