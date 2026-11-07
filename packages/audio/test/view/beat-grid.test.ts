// @vitest-environment jsdom
import {afterEach, describe, expect, it, vi} from 'vitest';
import {
  audioSequenceTempoGrid, createAudioClip, createAudioSequence, createMemoryAudioAssetStore, sameAudioTimeline,
  type AudioDocumentPlaybackBinding,
} from '../../src/core';
import {applyAudioOperations} from '../../src/view/core/edit-operations';
import {createAudioClipEditor, type AudioClipEditor} from '../../src/view/headless';
import {createAudioViewEditing} from '../../src/view/headless/audio-editing';
import {mountAudioClip, type AudioClipOptions} from '../../src/view/render/audio-clip';
import {AudioClipViewElement, defineAudioClipViewElement} from '../../src/view/element/audio-clip-view';

/** 4 s at 1 kHz drawn at 1000 px/s: one frame per pixel. 120 BPM is a beat every 500 frames. */
const clip = () => createAudioClip({sampleRate: 1000, channelData: [Float32Array.from({length: 4000}, (_, index) => Math.sin(index / 7) * .5)]});
const grid = {bpm: 120, anchorFrame: 100, beatsPerBar: 4};
const cleanups: Array<() => void> = [];
afterEach(() => { for (const cleanup of cleanups.splice(0).reverse()) cleanup(); document.body.replaceChildren(); vi.useRealTimers(); vi.restoreAllMocks(); });

function store() {
  const assets = createMemoryAudioAssetStore();
  const lease = assets.registerClip(clip(), {id: 'asset'});
  const sequence = createAudioSequence({sampleRate: 1000, channelLayout: ['mono'],
    segments: [{kind: 'asset', id: 'a', assetId: 'asset', sourceStart: 0, sourceEnd: 4000}], beatGrid: grid}, assets);
  cleanups.push(() => { lease.release(); assets.dispose(); });
  return {assets, sequence};
}

describe('document beat grid', () => {
  it('validates and converts the grid to a Kernel tempo grid in seconds', () => {
    const {sequence} = store();
    expect(sequence.beatGrid).toEqual(grid);
    expect(audioSequenceTempoGrid(sequence)).toEqual({bpm: 120, anchor: .1, beatsPerBar: 4});
    const base = {sampleRate: 1000, channelLayout: ['mono']};
    expect(() => createAudioSequence({...base, beatGrid: {bpm: 0, anchorFrame: 0, beatsPerBar: 4}})).toThrow(/bpm/);
    expect(() => createAudioSequence({...base, beatGrid: {bpm: 120, anchorFrame: -1, beatsPerBar: 4}})).toThrow(/anchor/);
    expect(() => createAudioSequence({...base, beatGrid: {bpm: 120, anchorFrame: 0, beatsPerBar: 0}})).toThrow(/beats per bar/);
  });

  it('sets and removes the grid with one operation, rejecting unknown fields', () => {
    const {assets, sequence} = store();
    const changed = applyAudioOperations(sequence, assets, [{type: 'set-beat-grid', grid: {...grid, bpm: 96}}]);
    expect(changed.content.beatGrid?.bpm).toBe(96);
    expect(changed.steps).toEqual([]);
    expect(sameAudioTimeline(sequence, changed.content)).toBe(true);
    expect(applyAudioOperations(sequence, assets, [{type: 'set-beat-grid', grid: null}]).content.beatGrid).toBeUndefined();
    expect(() => applyAudioOperations(sequence, assets, [{type: 'set-beat-grid', grid: {...grid, swing: 1} as never}])).toThrow(/grid/);
  });

  it('moves the anchor with content edited before it and keeps the bar phase through a deletion', () => {
    const {assets, sequence} = store();
    // Deleting 50 frames before the anchor shifts it left.
    const before = applyAudioOperations(sequence, assets, [{type: 'splice', startFrame: 0, deleteCount: 50, segments: [], rightId: 'b'}]);
    expect(before.content.beatGrid?.anchorFrame).toBe(50);
    // Trimming away the anchor moves it to the next downbeat (2100), shifted by the trim.
    const trimmed = applyAudioOperations(sequence, assets, [{type: 'trim', startFrame: 300, endFrame: 4000}]);
    expect(trimmed.content.beatGrid?.anchorFrame).toBe(1800);
    // Edits after the anchor leave the constant-tempo grid in place.
    const after = applyAudioOperations(sequence, assets, [{type: 'splice', startFrame: 1000, deleteCount: 100, segments: [], rightId: 'c'}]);
    expect(after.content.beatGrid?.anchorFrame).toBe(100);
  });
});

function mount(options: AudioClipOptions = {}) {
  const editor = createAudioClipEditor(clip());
  editor.execute({version: 1, documentId: editor.getSnapshot().documentId, expectedRevision: 0, label: 'Grid', operations: [{type: 'set-beat-grid', grid}]});
  editor.clearHistory();
  const editing = createAudioViewEditing(editor, {editable: true});
  const host = document.createElement('div');
  document.body.append(host);
  const onCommit = vi.fn(), onSeek = vi.fn(), onBeatJump = vi.fn(), onSettingsChange = vi.fn();
  const handle = mountAudioClip(host, {editing}, {pixelsPerSecond: 1000, grid: true, onCommit, onSeek, onBeatJump, onSettingsChange, ...options});
  cleanups.push(() => { handle.dispose(); editing.dispose(); editor.dispose(); });
  return {editor, editing, host, handle, onCommit, onSeek, onBeatJump, onSettingsChange};
}
function pointer(target: Element, type: string, x: number, y = 60, init: MouseEventInit = {}) {
  const event = new MouseEvent(type, {bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, ...init});
  Object.defineProperty(event, 'pointerId', {value: 1});
  target.dispatchEvent(event);
}
const stage = (host: HTMLElement) => host.querySelector('[part~="stage"]')!;
const viewport = (host: HTMLElement) => host.querySelector('[part~="viewport"]')!;
const key = (host: HTMLElement, value: string, init: KeyboardEventInit = {}) =>
  viewport(host).dispatchEvent(new KeyboardEvent('keydown', {key: value, bubbles: true, cancelable: true, ...init}));
const action = (host: HTMLElement, name: string) => host.querySelector<HTMLButtonElement>(`[data-clip-action="${name}"]`)!;
const group = (host: HTMLElement, name: string) => host.querySelector<HTMLElement>(`[data-group="${name}"]`)!;
const gridOf = (editor: AudioClipEditor) => editor.getSnapshot().content.beatGrid;

describe('clip view beat grid', () => {
  it('draws beat and bar lines with the anchor only while the grid is shown', () => {
    const {host, handle} = mount();
    expect(host.querySelectorAll('[data-grid-bar]').length).toBeGreaterThan(0);
    expect(host.querySelector('[data-grid-bar="1"]')).not.toBeNull();
    expect(host.querySelectorAll('[data-grid-beat]').length).toBeGreaterThan(0);
    expect(host.querySelector('[data-grid-anchor]')).not.toBeNull();
    handle.configure({grid: false});
    expect(host.querySelector('[data-grid-bar]')).toBeNull();
  });

  it('draws finer subdivisions as it zooms in and snaps to the finest drawn line', () => {
    const {host, handle, editing} = mount({snap: 'grid'});
    // 500 px per beat: lines down to 1/32 beat, 15.6 px apart.
    expect(host.querySelectorAll('[data-grid-sub]').length).toBeGreaterThan(0);
    pointer(stage(host), 'pointerdown', 380); pointer(stage(host), 'pointerup', 380);
    expect(editing.state.interaction.selection.startFrame).toBe(381);
    handle.configure({pixelsPerSecond: 10});
    // 5 px per beat: bars only.
    expect(host.querySelector('[data-grid-sub]')).toBeNull();
    expect(host.querySelector('[data-grid-beat]')).toBeNull();
    expect(host.querySelector('[data-grid-bar]')).not.toBeNull();
  });

  it('swaps the toolbar to the grid tools in Grid Edit and back', () => {
    const {host, onSettingsChange} = mount();
    expect(group(host, 'grid-shift').hidden).toBe(true);
    action(host, 'grid-edit').click();
    expect(onSettingsChange).toHaveBeenLastCalledWith(expect.objectContaining({gridEdit: true}), 'gridEdit');
    expect(group(host, 'grid-shift').hidden).toBe(false);
    expect(group(host, 'clipboard').hidden).toBe(true);
    expect(host.querySelector<HTMLInputElement>('[part~="bpm"]')!.value).toBe('120.00');
    key(host, 'Escape');
    expect(group(host, 'grid-shift').hidden).toBe(true);
  });

  it('nudges, stretches, scales and re-meters the grid, each as one undoable commit', () => {
    const {host, editor} = mount({gridEdit: true});
    action(host, 'grid-later').click();
    expect(gridOf(editor)?.anchorFrame).toBe(101);
    action(host, 'grid-earlier').dispatchEvent(new MouseEvent('click', {bubbles: true, shiftKey: true}));
    expect(gridOf(editor)?.anchorFrame).toBe(91);
    action(host, 'grid-shrink').click();
    expect(gridOf(editor)?.bpm).toBeCloseTo(120.01);
    key(host, ',', {});
    expect(gridOf(editor)?.bpm).toBeCloseTo(120);
    action(host, 'grid-half').click();
    expect(gridOf(editor)?.bpm).toBe(60);
    action(host, 'grid-meter').click();
    host.querySelector<HTMLButtonElement>('[part~="choice"][data-value="3"]')!.click();
    expect(gridOf(editor)?.beatsPerBar).toBe(3);
    expect(editor.getState().history.undoCount).toBe(6);
    editor.undo();
    expect(gridOf(editor)?.beatsPerBar).toBe(4);
  });

  it('types a tempo, sets the downbeat at the cursor and removes the grid', () => {
    const {host, editor, editing} = mount({gridEdit: true});
    const field = host.querySelector<HTMLInputElement>('[part~="bpm"]')!;
    field.value = '93.5';
    field.dispatchEvent(new Event('change'));
    expect(gridOf(editor)?.bpm).toBe(93.5);
    editing.select({startFrame: 777, endFrame: 777});
    key(host, 'd');
    expect(gridOf(editor)?.anchorFrame).toBe(777);
    action(host, 'grid-clear').click();
    expect(gridOf(editor)).toBeUndefined();
    expect(action(host, 'grid-earlier').disabled).toBe(true);
    // The downbeat command creates a new grid when none exists.
    action(host, 'grid-downbeat').click();
    expect(gridOf(editor)).toEqual({bpm: 120, anchorFrame: 777, beatsPerBar: 4});
  });

  it('moves the whole grid by dragging in Grid Edit and places the cursor on a click', () => {
    const {host, editor, editing, onCommit} = mount({gridEdit: true});
    pointer(stage(host), 'pointerdown', 300); pointer(stage(host), 'pointermove', 340); pointer(stage(host), 'pointerup', 340);
    expect(gridOf(editor)?.anchorFrame).toBe(140);
    expect(onCommit.mock.calls.at(-1)?.[0].change.label).toBe('Move beat grid');
    pointer(stage(host), 'pointerdown', 900); pointer(stage(host), 'pointerup', 900);
    expect(editing.state.interaction.selection).toEqual({startFrame: 900, endFrame: 900});
    expect(gridOf(editor)?.anchorFrame).toBe(140);
  });

  it('previews tapped tempo and commits it after the run pauses', () => {
    vi.useFakeTimers();
    const {host, editor, editing} = mount({gridEdit: true});
    // Tap through the button with stubbed clock readings.
    const now = vi.spyOn(performance, 'now');
    for (const time of [20_000, 20_600, 21_200, 21_800]) { now.mockReturnValue(time); action(host, 'grid-tap').click(); }
    expect(editing.state.interaction.draft?.content.beatGrid?.bpm).toBeCloseTo(100);
    expect(gridOf(editor)?.bpm).toBe(120);
    vi.advanceTimersByTime(1600);
    expect(gridOf(editor)?.bpm).toBeCloseTo(100);
    expect(editor.getState().history.undoCount).toBe(1);
  });

  it('snaps to beats and bars, quantizes ruler seeks and jumps by bars', () => {
    const {host, editing, onSeek, onBeatJump, handle} = mount({snap: 'beat', quantize: true});
    pointer(stage(host), 'pointerdown', 380); pointer(stage(host), 'pointermove', 1290); pointer(stage(host), 'pointerup', 1290);
    expect(editing.state.interaction.selection).toEqual({startFrame: 600, endFrame: 1100});
    handle.configure({snap: 'bar'});
    pointer(stage(host), 'pointerdown', 2300); pointer(stage(host), 'pointerup', 2300);
    expect(editing.state.interaction.selection.startFrame).toBe(2100);
    pointer(stage(host), 'pointerdown', 1270, 10);
    expect(onSeek).toHaveBeenLastCalledWith(1.1, {quantized: true});
    // Without playback, PageDown moves the cursor a bar; with playback it asks for a beat jump.
    editing.select({startFrame: 100, endFrame: 100});
    key(host, 'PageDown');
    expect(editing.state.interaction.selection.startFrame).toBe(2100);
    handle.updatePlayback({seconds: .3});
    key(host, 'PageUp', {shiftKey: true});
    expect(onBeatJump).toHaveBeenLastCalledWith(-16);
  });
});

describe('<audio-clip-view> grid attributes', () => {
  it('reflects grid settings and seeks a playing player with the beat phase kept', async () => {
    defineAudioClipViewElement();
    const editor = createAudioClipEditor(clip());
    editor.execute({version: 1, documentId: editor.getSnapshot().documentId, expectedRevision: 0, label: 'Grid', operations: [{type: 'set-beat-grid', grid}]});
    const player = Object.assign(document.createElement('div'), {
      id: 'deck', seconds: .225, playing: true, seek: vi.fn(),
      get documentBinding(): AudioDocumentPlaybackBinding {
        const snapshot = editor.getSnapshot();
        return {status: 'ready', attempt: 1, applied: {documentId: snapshot.documentId, documentRevision: snapshot.documentRevision}, documentCoordinates: true};
      },
    });
    const view = document.createElement('audio-clip-view') as AudioClipViewElement;
    view.setAttribute('input', '#deck');
    view.setAttribute('grid', '');
    view.setAttribute('quantize', '');
    view.setAttribute('editable', '');
    view.setAttribute('pixels-per-second', '1000');
    document.body.append(player, view);
    view.editor = editor;
    cleanups.push(() => { view.remove(); editor.dispose(); });
    expect(view.grid).toBe(true);
    expect(view.quantize).toBe(true);
    expect(view.gridEdit).toBe(false);
    view.querySelector<HTMLButtonElement>('[data-clip-action="grid-edit"]')!.click();
    expect(view.getAttribute('grid-edit')).toBe('');
    // 0.225 s is a quarter into beat 0 (anchor 0.1); a click near 1.1 s lands a quarter into that beat.
    pointer(view.querySelector('[part~="stage"]')!, 'pointerdown', 1270, 10);
    expect(player.seek).toHaveBeenLastCalledWith(expect.closeTo(1.225, 6));
    view.tools = ['delete', 'history'];
    expect(view.gridEdit).toBe(false);
  });
});
