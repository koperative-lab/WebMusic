// @vitest-environment jsdom
import {afterEach, beforeAll, beforeEach, describe, expect, it, vi} from 'vitest';
import {createAudioClip, createRegion, type AudioDocumentPlaybackBinding, type AudioPeaks} from '../../src/core';
import {createAudioClipEditor} from '../../src/edit/headless';
import {createAudioViewEditing} from '../../src/view/headless/audio-editing';
import type {AudioViewport, AudioWaveformSource, WaveformRenderOptions} from '../../src/view/core/types';

const spies = vi.hoisted(() => ({render: vi.fn()}));
vi.mock('../../src/view/render/waveform', () => ({renderWaveformVisualizer: spies.render}));
import {mountWaveformEditor} from '../../src/view/render/waveform-editor';
import {defineAudioViewElement, type AudioViewElement} from '../../src/view/element/audio-view';

const cleanups: (() => void)[] = [];
beforeAll(() => defineAudioViewElement('editing-audio-view'));
beforeEach(() => {
  spies.render.mockImplementation((host: HTMLElement, _source: AudioPeaks | AudioWaveformSource, options: WaveformRenderOptions) => {
    const node = document.createElement('div'); node.dataset.wave = ''; host.append(node);
    let zoom = options.pixelsPerSecond ?? 100, start = 0;
    const listeners = new Set<(value: AudioViewport) => void>();
    const viewport = () => ({startSeconds: start, endSeconds: start + 4});
    return {redraw: vi.fn(), redrawFrame: vi.fn(), setPlayheadMode: vi.fn(), setPlayheadVisible: vi.fn(),
      setZoom(value: number) { zoom = value; for (const listener of listeners) listener(viewport()); },
      setOffset(value: number) { start = value; for (const listener of listeners) listener(viewport()); },
      setRegions: vi.fn(), viewport, hitTest: (x: number) => ({seconds: start + x / zoom}),
      onViewportChange(listener: (value: AudioViewport) => void) { listeners.add(listener); return () => listeners.delete(listener); },
      dispose: vi.fn(() => node.remove()),
    };
  });
});
afterEach(() => {
  document.body.replaceChildren();
  for (const cleanup of cleanups.splice(0)) cleanup();
  spies.render.mockReset(); vi.restoreAllMocks();
});
function editor() {
  const value = createAudioClipEditor(createAudioClip({sampleRate: 100, channelData: [new Float32Array(1000).fill(.5)]}));
  cleanups.push(() => value.dispose()); return value;
}
function mount() {
  const model = editor(), editing = createAudioViewEditing(model, {editable: true});
  const host = document.createElement('div'); document.body.append(host);
  const onPreview = vi.fn(), onCommit = vi.fn(), onError = vi.fn();
  const handle = mountWaveformEditor(host, editing, {pixelsPerSecond: 100, onPreview, onCommit, onError});
  cleanups.push(() => { handle.dispose(); editing.dispose(); });
  return {model, editing, host, handle, onPreview, onCommit, onError};
}
function field(root: ParentNode, label: string, value: string) { const input = root.querySelector<HTMLInputElement>(`[aria-label="${label}"]`)!; input.value = value; return input; }
function button(root: ParentNode, label: string) { return [...root.querySelectorAll('button')].find((value) => value.textContent === label)!; }
function pointer(surface: HTMLElement, type: string, x: number, id = 1) {
  const event = new MouseEvent(type, {bubbles: true, cancelable: true, clientX: x, clientY: 10, button: 0});
  Object.defineProperty(event, 'pointerId', {value: id}); surface.dispatchEvent(event);
}
function key(surface: HTMLElement, key: string, options: KeyboardEventInit = {}) { surface.dispatchEvent(new KeyboardEvent('keydown', {key, bubbles: true, cancelable: true, ...options})); }

describe('waveform editing renderer', () => {
  it('selects a frame range without content changes, then trims one draft on release', () => {
    const {model, handle, host, onPreview, onCommit} = mount();
    pointer(handle.surface, 'pointerdown', 100); pointer(handle.surface, 'pointermove', 300); pointer(handle.surface, 'pointerup', 300);
    expect(model.getSnapshot().documentRevision).toBe(0);
    expect(host.querySelector('[part="selection"] div')?.getAttribute('data-end-frame')).toBe('300');
    const tool = host.querySelector<HTMLSelectElement>('[aria-label="Pointer tool"]')!; tool.value = 'trim'; tool.dispatchEvent(new Event('change'));
    pointer(handle.surface, 'pointerdown', 400); pointer(handle.surface, 'pointermove', 600); pointer(handle.surface, 'pointermove', 700);
    expect(onPreview).toHaveBeenCalledTimes(2); expect(model.getSnapshot().documentRevision).toBe(0);
    expect(host.querySelector('[data-edit-state]')?.getAttribute('data-edit-state')).toBe('draft');
    pointer(handle.surface, 'pointerup', 700);
    expect(model.getSnapshot().content.length).toBe(300); expect(model.getState().history.undoCount).toBe(1); expect(onCommit).toHaveBeenCalledOnce();
  });

  it('keeps the clipboard when copy or cut shortcuts run with only a cursor', () => {
    const {model, handle, editing} = mount();
    pointer(handle.surface, 'pointerdown', 100); pointer(handle.surface, 'pointermove', 300); pointer(handle.surface, 'pointerup', 300);
    key(handle.surface, 'c', {ctrlKey: true});
    expect(model.getState().clipboard).toMatchObject({hasContent: true, length: 200});
    pointer(handle.surface, 'pointerdown', 500); pointer(handle.surface, 'pointerup', 500);
    expect(editing.state.interaction.selection).toEqual({startFrame: 500, endFrame: 500});
    key(handle.surface, 'c', {ctrlKey: true}); key(handle.surface, 'x', {ctrlKey: true});
    expect(model.getState().clipboard).toMatchObject({hasContent: true, length: 200});
    expect(model.getSnapshot().documentRevision).toBe(0);
  });

  it('leaves an Escape that cancels nothing to enclosing handlers', () => {
    const {handle, editing} = mount();
    const escape = () => { const event = new KeyboardEvent('keydown', {key: 'Escape', bubbles: true, cancelable: true}); handle.surface.dispatchEvent(event); return event; };
    expect(escape().defaultPrevented).toBe(false);
    expect(editing.preview([{type: 'trim', startFrame: 100, endFrame: 300}]).status).toBe('preview');
    expect(escape().defaultPrevented).toBe(true);
    expect(editing.state.interaction.draft).toBeUndefined();
  });

  it('places the cursor on a click near a selected edge and adjusts that edge only by dragging', () => {
    const {handle, editing} = mount();
    pointer(handle.surface, 'pointerdown', 100); pointer(handle.surface, 'pointermove', 300); pointer(handle.surface, 'pointerup', 300);
    expect(editing.state.interaction.selection).toEqual({startFrame: 100, endFrame: 300});
    pointer(handle.surface, 'pointerdown', 302); pointer(handle.surface, 'pointerup', 302);
    expect(editing.state.interaction.selection).toEqual({startFrame: 302, endFrame: 302});
    pointer(handle.surface, 'pointerdown', 100); pointer(handle.surface, 'pointermove', 300); pointer(handle.surface, 'pointerup', 300);
    pointer(handle.surface, 'pointerdown', 298); pointer(handle.surface, 'pointermove', 400); pointer(handle.surface, 'pointerup', 400);
    expect(editing.state.interaction.selection).toEqual({startFrame: 100, endFrame: 400});
  });

  it.each(['pointercancel', 'lostpointercapture', 'blur'])('cancels a trim on %s without a content commit', (event) => {
    const {model, handle, host, editing, onCommit} = mount();
    const tool = host.querySelector<HTMLSelectElement>('[aria-label="Pointer tool"]')!; tool.value = 'trim';
    pointer(handle.surface, 'pointerdown', 100); pointer(handle.surface, 'pointermove', 300);
    handle.surface.dispatchEvent(new Event(event)); pointer(handle.surface, 'pointerup', 300);
    expect(editing.state.interaction.draft).toBeUndefined(); expect(model.getSnapshot().documentRevision).toBe(0); expect(onCommit).not.toHaveBeenCalled();
  });

  it('cancels on Escape, external revision, editable change and disposal', () => {
    const {model, handle, host, editing, onCommit} = mount();
    const tool = host.querySelector<HTMLSelectElement>('[aria-label="Pointer tool"]')!; tool.value = 'trim';
    const drag = () => { pointer(handle.surface, 'pointerdown', 100); pointer(handle.surface, 'pointermove', 300); };
    drag(); key(handle.surface, 'Escape'); expect(editing.state.interaction.draft).toBeUndefined();
    drag(); editing.execute('Insert', [{type: 'insert-silence', frame: 0, length: 100, id: 'silence'}]); pointer(handle.surface, 'pointerup', 300);
    expect(model.getSnapshot().content.length).toBe(1100); expect(onCommit).not.toHaveBeenCalled();
    drag(); editing.setEditable(false); pointer(handle.surface, 'pointerup', 300); expect(model.getSnapshot().documentRevision).toBe(1);
    editing.setEditable(true); drag(); handle.dispose(); expect(editing.state.interaction.draft).toBeUndefined(); expect(model.getSnapshot().documentRevision).toBe(1);
  });

  it.each(['dispose', 'blur', 'window-blur', 'pointercancel', 'lostpointercapture', 'zoom', 'tool'])('preserves a shared draft on passive %s', (action) => {
    const model = editor(), session = model.createInteractionSession();
    const editing = createAudioViewEditing(model, {editable: true, interactionSession: session});
    const host = document.createElement('div'); document.body.append(host);
    const handle = mountWaveformEditor(host, editing);
    cleanups.push(() => {handle.dispose(); editing.dispose(); session.dispose();});
    expect(session.preview([{type: 'trim', startFrame: 100, endFrame: 300}]).status).toBe('preview');
    const draft = session.getSnapshot().draft;
    if (action === 'dispose') handle.dispose();
    else if (action === 'zoom') handle.setZoom(200);
    else if (action === 'tool') host.querySelector('select')!.dispatchEvent(new Event('change'));
    else if (action === 'window-blur') window.dispatchEvent(new Event('blur'));
    else handle.surface.dispatchEvent(new Event(action));
    expect(session.getSnapshot().draft).toBe(draft);
    expect(model.getSnapshot().documentRevision).toBe(0);
  });

  it.each(['zoom', 'tool'])('cancels its own active trim on %s and retains explicit shared cancellation', (action) => {
    const {model, editing, host, handle, onCommit} = mount();
    const tool = host.querySelector<HTMLSelectElement>('[aria-label="Pointer tool"]')!; tool.value = 'trim';
    editing.select({startFrame: 20, endFrame: 40});
    pointer(handle.surface, 'pointerdown', 100); pointer(handle.surface, 'pointermove', 300);
    expect(editing.state.interaction.draft).toBeDefined();
    if (action === 'zoom') handle.setZoom(200); else tool.dispatchEvent(new Event('change'));
    pointer(handle.surface, 'pointerup', 300);
    expect(editing.state.interaction.draft).toBeUndefined();
    expect(editing.state.interaction.selection).toEqual({startFrame: 20, endFrame: 40});
    expect(model.getSnapshot().documentRevision).toBe(0); expect(onCommit).not.toHaveBeenCalled();
    editing.preview([{type: 'trim', startFrame: 100, endFrame: 300}]); handle.cancel();
    expect(editing.state.interaction.draft).toBeUndefined();
    editing.preview([{type: 'trim', startFrame: 100, endFrame: 300}]); key(handle.surface, 'Escape');
    expect(editing.state.interaction.draft).toBeUndefined();
  });

  it('provides exact numeric selection, delete, undo/redo and rejects invalid ranges', () => {
    const {model, host, onError} = mount();
    field(host, 'Start frame', '101'); field(host, 'End frame', '303'); button(host, 'Select frames').click();
    button(host, 'Delete selection').click(); expect(model.getSnapshot().content.length).toBe(798);
    button(host, 'Undo').click(); expect(model.getSnapshot().content.length).toBe(1000);
    button(host, 'Redo').click(); expect(model.getSnapshot().content.length).toBe(798);
    field(host, 'Start frame', '3.5'); button(host, 'Select frames').click(); expect(onError).toHaveBeenCalledOnce(); expect(model.getSnapshot().documentRevision).toBe(3);
  });

  it('retains both pending range endpoints through focus changes and playback updates', () => {
    const {model, host, handle, editing} = mount();
    const document = model.getSnapshot();
    const binding: AudioDocumentPlaybackBinding = {status: 'ready', attempt: 1, documentCoordinates: true,
      applied: {documentId: document.documentId, documentRevision: 0}};
    field(host, 'Start frame', '101').focus();
    field(host, 'End frame', '303').focus();
    handle.updatePlayback(binding, .25);
    const select = button(host, 'Select frames'); select.focus();
    handle.updatePlayback(binding, .5); select.click();
    expect(editing.state.interaction.selection).toEqual({startFrame: 101, endFrame: 303});
    button(host, 'Delete selection').click();
    expect(model.getSnapshot().content.length).toBe(798);
  });

  it('retains pending segment gain when focus moves to Apply before playback synchronization', () => {
    const {model, host, handle} = mount();
    const document = model.getSnapshot();
    const binding: AudioDocumentPlaybackBinding = {status: 'ready', attempt: 1, documentCoordinates: true,
      applied: {documentId: document.documentId, documentRevision: 0}};
    field(host, 'Segment gain', '0.25').focus();
    const apply = button(host, 'Apply segment gain'); apply.focus();
    handle.updatePlayback(binding, .25); apply.click();
    expect(model.getSnapshot().content.segments[0]).toMatchObject({gain: .25});
    expect(model.getState().history.undoCount).toBe(1);
  });

  it('refreshes same-ID segment lengths after trim, undo and redo while preserving the chosen segment', () => {
    const {model, host, handle, editing} = mount();
    editing.select({startFrame: 500, endFrame: 500}); button(host, 'Split at start').click();
    const segment = host.querySelector<HTMLSelectElement>('[aria-label="Segment"]')!;
    const chosen = model.sequence.segments[1].id;
    segment.value = chosen; segment.dispatchEvent(new Event('change'));
    editing.select({startFrame: 100, endFrame: 700}); button(host, 'Trim to selection').click();
    expect([...segment.options].map(option => option.textContent)).toEqual(['1: asset, 400 frames', '2: asset, 200 frames']);
    expect(segment.value).toBe(chosen);
    button(host, 'Undo').click();
    expect([...segment.options].map(option => option.textContent)).toEqual(['1: asset, 500 frames', '2: asset, 500 frames']);
    expect(segment.value).toBe(chosen);
    button(host, 'Redo').click();
    expect([...segment.options].map(option => option.textContent)).toEqual(['1: asset, 400 frames', '2: asset, 200 frames']);
    expect(segment.value).toBe(chosen);
    field(host, 'Segment gain', '0.25').focus();
    button(host, 'Apply segment gain').focus(); handle.updatePlayback(undefined, .25);
    expect(segment.selectedOptions[0].textContent).toBe('2: asset, 200 frames');
    button(host, 'Apply segment gain').click();
    expect(model.sequence.segments[1]).toMatchObject({id: chosen, gain: .25});
  });

  it('refreshes focused inputs when shared selection or committed content changes', () => {
    const {model, host, editing} = mount();
    const start = field(host, 'Start frame', '101'), end = field(host, 'End frame', '303');
    start.focus(); editing.session.setSelection({startFrame: 200, endFrame: 400});
    expect([start.value, end.value]).toEqual(['200', '400']);
    start.value = '250'; end.focus();
    editing.session.setSelection({startFrame: 200, endFrame: 400});
    expect([start.value, end.value]).toEqual(['200', '400']);
    const gain = field(host, 'Segment gain', '0.1'); gain.focus();
    const id = model.sequence.segments[0].id;
    editing.execute('External gain', [{type: 'set-gain', segmentIds: [id], gain: .5}]);
    expect(gain.value).toBe('0.5');
    button(host, 'Apply segment gain').click();
    expect(model.getSnapshot().documentRevision).toBe(1);
    gain.value = '0.2'; gain.focus(); editing.undo();
    expect(gain.value).toBe('1');
    expect([start.value, end.value]).toEqual(['200', '400']);
  });

  it('rebinds pending gain to the explicitly selected segment', () => {
    const {model, host, handle, editing} = mount();
    editing.select({startFrame: 500, endFrame: 500}); button(host, 'Split at start').click();
    const gain = field(host, 'Segment gain', '0.25'); gain.focus();
    const segment = host.querySelector<HTMLSelectElement>('[aria-label="Segment"]')!;
    segment.value = model.sequence.segments[1].id; segment.dispatchEvent(new Event('change'));
    expect(gain.value).toBe('1');
    gain.value = '0.4'; button(host, 'Apply segment gain').focus();
    handle.updatePlayback(undefined, .25); button(host, 'Apply segment gain').click();
    expect(model.sequence.segments[0]).toMatchObject({gain: 1});
    expect(model.sequence.segments[1]).toMatchObject({gain: .4});
  });

  it('rejects a stale numeric command when draft cancellation triggers an external revision', () => {
    const {model, host, editing, onError} = mount();
    field(host, 'Segment gain', '0.25');
    let reenter = false;
    const off = editing.subscribe(() => {
      if (!reenter) return;
      reenter = false;
      model.transaction('External gain', tx => tx.add({type: 'set-gain', segmentIds: [model.sequence.segments[0].id], gain: .5}));
    });
    try {
      reenter = true; button(host, 'Apply segment gain').click();
      expect(model.sequence.segments[0]).toMatchObject({gain: .5});
      expect(model.getSnapshot().documentRevision).toBe(1);
      expect(onError).toHaveBeenCalledWith(expect.objectContaining({code: 'revision-conflict'}));
    } finally { off(); }
  });

  it.each(['Trim to selection', 'Delete selection', 'Split at start', 'Insert silence', 'keyboard delete'])('abandons %s when cancellation changes its selected frame target', (command) => {
    const {model, editing, host, handle, onCommit, onError} = mount();
    editing.select({startFrame: 100, endFrame: 300});
    let armed = false;
    const off = editing.subscribe(() => {
      if (!armed) return;
      armed = false;
      editing.session.setSelection({startFrame: 500, endFrame: 800});
    });
    try {
      armed = true;
      if (command === 'keyboard delete') key(handle.surface, 'Delete'); else button(host, command).click();
      expect(model.getSnapshot().documentRevision).toBe(0);
      expect(model.sequence.length).toBe(1000);
      expect(editing.state.interaction.selection).toEqual({startFrame: 500, endFrame: 800});
      expect(model.getState().history.undoCount).toBe(0);
      expect(onCommit).not.toHaveBeenCalled();
      expect(onError).not.toHaveBeenCalled();
    } finally { off(); }
  });

  it.each(['Apply segment gain', 'Fade in segment', 'Fade out segment'])('abandons %s when a shared draft cancellation changes its segment target', (command) => {
    const {model, editing, host, onCommit, onError} = mount();
    model.transaction('Split', tx => tx.add({type: 'split', segmentId: model.sequence.segments[0].id,
      frame: 500, leftId: 'left', rightId: 'right'}));
    const segment = host.querySelector<HTMLSelectElement>('[aria-label="Segment"]')!;
    segment.value = 'left'; segment.dispatchEvent(new Event('change'));
    editing.preview([{type: 'trim', startFrame: 0, endFrame: 1000}]);
    field(host, 'Segment gain', '0.25');
    let armed = true;
    const off = editing.session.subscribe(snapshot => {
      if (!armed || snapshot.draft) return;
      armed = false;
      segment.value = 'right'; segment.dispatchEvent(new Event('change'));
    });
    try {
      button(host, command).click();
      expect(model.getSnapshot().documentRevision).toBe(1);
      expect(model.sequence.segments).toMatchObject([{id: 'left', gain: 1, envelope: []}, {id: 'right', gain: 1, envelope: []}]);
      expect(segment.value).toBe('right');
      expect(model.getState().history.undoCount).toBe(1);
      expect(onCommit).not.toHaveBeenCalled(); expect(onError).not.toHaveBeenCalled();
    } finally { off(); }
  });

  it.each(['Trim to selection', 'Delete selection'])('abandons %s when cancellation changes only the range end', (command) => {
    const {model, editing, host, onCommit} = mount();
    editing.select({startFrame: 100, endFrame: 300});
    let armed = false;
    const off = editing.subscribe(() => {
      if (!armed) return;
      armed = false;
      editing.select({startFrame: 100, endFrame: 800});
    });
    try {
      armed = true; button(host, command).click();
      expect(model.getSnapshot().documentRevision).toBe(0);
      expect(editing.state.interaction.selection).toEqual({startFrame: 100, endFrame: 800});
      expect(onCommit).not.toHaveBeenCalled();
    } finally { off(); }
  });

  it.each(['select', 'trim'])('rejects commands reentered while disposing an active %s gesture', (tool) => {
    const {model, editing, host, handle, onCommit} = mount();
    host.querySelector<HTMLSelectElement>('[aria-label="Pointer tool"]')!.value = tool;
    pointer(handle.surface, 'pointerdown', 100); pointer(handle.surface, 'pointermove', 300);
    let armed = false;
    const off = editing.subscribe(() => {
      if (!armed) return;
      armed = false;
      button(host, 'Delete selection').click();
      handle.dispose();
    });
    try {
      armed = true; handle.dispose();
      expect(model.getSnapshot().documentRevision).toBe(0);
      expect(editing.state.interaction.draft).toBeUndefined();
      expect(host.querySelector('[part="editor"]')).toBeNull();
      expect(onCommit).not.toHaveBeenCalled();
    } finally { off(); }
  });

  it.each(['Split at start', 'Insert silence'])('allows %s when cancellation changes only the selection end', (command) => {
    const {model, editing, host, onCommit} = mount();
    editing.select({startFrame: 100, endFrame: 300});
    field(host, 'Silence frames', '33');
    let armed = false;
    const off = editing.subscribe(() => {
      if (!armed) return;
      armed = false;
      editing.session.setSelection({startFrame: 100, endFrame: 800});
    });
    try {
      armed = true; button(host, command).click();
      expect(model.getSnapshot().documentRevision).toBe(1);
      expect(model.sequence.length).toBe(command === 'Insert silence' ? 1033 : 1000);
      expect(onCommit).toHaveBeenCalledOnce();
    } finally { off(); }
  });

  it.each(['Trim to selection', 'Delete selection'])('allows %s when cancellation changes only the unrelated segment control', (command) => {
    const {model, editing, host, onCommit} = mount();
    model.transaction('Split', tx => tx.add({type: 'split', segmentId: model.sequence.segments[0].id,
      frame: 500, leftId: 'left', rightId: 'right'}));
    const segment = host.querySelector<HTMLSelectElement>('[aria-label="Segment"]')!;
    editing.select({startFrame: 100, endFrame: 300});
    let armed = false;
    const off = editing.subscribe(() => {
      if (!armed) return;
      armed = false;
      segment.value = 'right'; segment.dispatchEvent(new Event('change'));
    });
    try {
      armed = true; button(host, command).click();
      expect(model.getSnapshot().documentRevision).toBe(2);
      expect(model.sequence.length).toBe(command === 'Trim to selection' ? 200 : 800);
      expect(onCommit).toHaveBeenCalledOnce();
    } finally { off(); }
  });

  it.each(['Apply segment gain', 'Fade in segment', 'Fade out segment'])('allows %s when cancellation changes only the unrelated frame range', (command) => {
    const {model, editing, host, onCommit} = mount();
    editing.select({startFrame: 100, endFrame: 300});
    field(host, 'Segment gain', '0.25');
    let armed = false;
    const off = editing.subscribe(() => {
      if (!armed) return;
      armed = false;
      editing.session.setSelection({startFrame: 500, endFrame: 800});
    });
    try {
      armed = true; button(host, command).click();
      expect(model.getSnapshot().documentRevision).toBe(1);
      expect(editing.state.interaction.selection).toEqual({startFrame: 500, endFrame: 800});
      expect(model.sequence.segments[0]).toMatchObject(command === 'Apply segment gain' ? {gain: .25}
        : {envelope: [{frame: 0, gain: command === 'Fade in segment' ? 0 : 1}, {frame: 1000, gain: command === 'Fade in segment' ? 1 : 0}]});
      expect(onCommit).toHaveBeenCalledOnce();
    } finally { off(); }
  });

  it.each(['readonly', 'controller disposal', 'renderer disposal'])('abandons a command when cancellation triggers %s', (change) => {
    const {model, editing, host, handle, onCommit} = mount();
    editing.select({startFrame: 100, endFrame: 300});
    let armed = false;
    const off = editing.subscribe(() => {
      if (!armed) return;
      armed = false;
      if (change === 'readonly') editing.setEditable(false);
      else if (change === 'controller disposal') editing.dispose();
      else handle.dispose();
    });
    try {
      armed = true; button(host, 'Delete selection').click();
      expect(model.getSnapshot().documentRevision).toBe(0);
      expect(onCommit).not.toHaveBeenCalled();
    } finally { off(); }
  });

  it('replaces command feedback when another consumer commits a revision', () => {
    const {model, host, editing} = mount();
    editing.select({startFrame: 100, endFrame: 200}); button(host, 'Delete selection').click();
    const status = host.querySelector('[part="editing-status"]')!;
    expect(status.textContent).toContain('Delete audio.');
    model.transaction('External processing', tx => tx.add({type: 'insert-silence', frame: 0, length: 20, id: 'external'}));
    expect(status.textContent).toContain('External processing.');
    expect(status.textContent).toContain('revision 2');
    expect(status.textContent).not.toContain('Delete audio.');
  });

  it('splits, applies gain/fades and inserts silence through semantic commands', () => {
    const {model, host} = mount();
    field(host, 'Start frame', '500'); field(host, 'End frame', '500'); button(host, 'Select frames').click(); button(host, 'Split at start').click();
    expect(model.getSnapshot().content.segments).toHaveLength(2);
    field(host, 'Segment gain', '0.25'); button(host, 'Apply segment gain').click();
    expect(model.getSnapshot().content.segments[0]).toMatchObject({gain: .25});
    button(host, 'Fade in segment').click(); expect(model.getSnapshot().content.segments[0]).toMatchObject({envelope: [{frame: 0, gain: 0}, {frame: 500, gain: 1}]});
    button(host, 'Fade out segment').click(); expect(model.getSnapshot().content.segments[0]).toMatchObject({envelope: [{frame: 0, gain: 1}, {frame: 500, gain: 0}]});
    field(host, 'Silence frames', '33'); button(host, 'Insert silence').click(); expect(model.getSnapshot().content.length).toBe(1033);
  });

  it('scopes clipboard and history shortcuts to its surface and never steals text field keys', () => {
    const {model, host, handle, editing} = mount();
    key(handle.surface, 'a', {ctrlKey: true}); key(handle.surface, 'c', {ctrlKey: true});
    key(handle.surface, 'x', {ctrlKey: true}); expect(model.getSnapshot().content.length).toBe(0);
    key(handle.surface, 'v', {ctrlKey: true}); expect(model.getSnapshot().content.length).toBe(1000);
    key(handle.surface, 'z', {metaKey: true}); expect(model.getSnapshot().content.length).toBe(0);
    key(handle.surface, 'z', {metaKey: true, shiftKey: true}); expect(model.getSnapshot().content.length).toBe(1000);
    key(handle.surface, 'Home'); key(handle.surface, 'ArrowRight', {shiftKey: true}); expect(editing.state.interaction.selection).toEqual({startFrame: 0, endFrame: 1});
    key(field(host, 'Start frame', '40'), 'Delete'); expect(model.getSnapshot().content.length).toBe(1000);
  });

  it('extends from one keyboard anchor in either direction and across that anchor', () => {
    const {editing, handle, model} = mount();
    editing.select({startFrame: 100, endFrame: 100});
    key(handle.surface, 'ArrowLeft', {shiftKey: true}); key(handle.surface, 'ArrowLeft', {shiftKey: true});
    expect(editing.state.interaction.selection).toEqual({startFrame: 98, endFrame: 100});
    for (let i = 0; i < 4; i++) key(handle.surface, 'ArrowRight', {shiftKey: true});
    expect(editing.state.interaction.selection).toEqual({startFrame: 100, endFrame: 102});
    key(handle.surface, 'Home', {shiftKey: true}); key(handle.surface, 'ArrowLeft', {shiftKey: true});
    expect(editing.state.interaction.selection).toEqual({startFrame: 0, endFrame: 100});
    key(handle.surface, 'End', {shiftKey: true}); key(handle.surface, 'ArrowRight', {shiftKey: true});
    expect(editing.state.interaction.selection).toEqual({startFrame: 100, endFrame: 1000});
    expect(model.getSnapshot().documentRevision).toBe(0);
  });

  it('resets the keyboard anchor on external selection, pointer selection and ordinary movement', () => {
    const {editing, handle} = mount();
    editing.select({startFrame: 100, endFrame: 100}); key(handle.surface, 'ArrowLeft', {shiftKey: true});
    // The same range can be selected externally with a different moving endpoint.
    editing.session.setSelection({startFrame: 99, endFrame: 100}); key(handle.surface, 'ArrowRight', {shiftKey: true});
    expect(editing.state.interaction.selection).toEqual({startFrame: 99, endFrame: 101});
    editing.session.setSelection({startFrame: 200, endFrame: 200}); key(handle.surface, 'ArrowLeft', {shiftKey: true});
    expect(editing.state.interaction.selection).toEqual({startFrame: 199, endFrame: 200});
    pointer(handle.surface, 'pointerdown', 400); pointer(handle.surface, 'pointerup', 400);
    key(handle.surface, 'ArrowLeft', {shiftKey: true});
    expect(editing.state.interaction.selection).toEqual({startFrame: 399, endFrame: 400});
    key(handle.surface, 'ArrowRight'); key(handle.surface, 'ArrowRight', {shiftKey: true});
    expect(editing.state.interaction.selection).toEqual({startFrame: 400, endFrame: 401});
  });

  it('hides the playhead until the applied document and revision match', () => {
    const {model, handle, host} = mount();
    const document = model.getSnapshot();
    const binding: AudioDocumentPlaybackBinding = {status: 'ready', attempt: 1, documentCoordinates: true,
      applied: {documentId: document.documentId, documentRevision: 0}};
    handle.updatePlayback(binding, 2);
    expect(host.querySelector('[data-playback-state]')?.getAttribute('data-playback-state')).toBe('ready');
    expect(spies.render.mock.results.at(-1)?.value.setPlayheadVisible).toHaveBeenLastCalledWith(true);
    model.execute({version: 1, label: 'Trim', documentId: document.documentId, expectedRevision: 0, operations: [{type: 'trim', startFrame: 0, endFrame: 500}]});
    expect(host.querySelector('[data-playback-state]')?.getAttribute('data-playback-state')).toBe('pending');
    expect(spies.render.mock.results.at(-1)?.value.setPlayheadVisible).toHaveBeenLastCalledWith(false);
  });

  it.each([[400, 400, 400], [400, 402, 401], [400, 600, 400]])('treats a Trim press at %i moved to %i and released at %i as a click without a commit', (down, move, up) => {
    const {model, editing, host, handle, onCommit} = mount();
    host.querySelector<HTMLSelectElement>('[aria-label="Pointer tool"]')!.value = 'trim';
    pointer(handle.surface, 'pointerdown', down); pointer(handle.surface, 'pointermove', move); pointer(handle.surface, 'pointerup', up);
    expect(model.sequence.length).toBe(1000); expect(model.getSnapshot().documentRevision).toBe(0);
    expect(editing.state.interaction.draft).toBeUndefined(); expect(onCommit).not.toHaveBeenCalled();
    expect(editing.state.interaction.selection).toEqual({startFrame: down, endFrame: down});
  });

  it.each(['', '-1'])('rejects segment gain %j through the error path without committing', (value) => {
    const {model, host, onError, onCommit} = mount();
    field(host, 'Segment gain', value); button(host, 'Apply segment gain').click();
    expect(onError).toHaveBeenCalledOnce(); expect(onCommit).not.toHaveBeenCalled();
    expect(model.getSnapshot().documentRevision).toBe(0); expect(model.sequence.segments[0]).toMatchObject({gain: 1});
  });

  it('applies typed frames before form range commands and rejects invalid frames without changing anything', () => {
    const {model, editing, host, handle, onError} = mount();
    editing.select({startFrame: 0, endFrame: 0});
    field(host, 'Start frame', '100'); field(host, 'End frame', '300').dispatchEvent(new Event('input', {bubbles: true}));
    expect(button(host, 'Trim to selection').disabled).toBe(false);
    button(host, 'Delete selection').click();
    expect(model.sequence.length).toBe(800); expect(model.getState().history.undoCount).toBe(1);
    editing.select({startFrame: 500, endFrame: 700}); field(host, 'Start frame', '');
    button(host, 'Trim to selection').click();
    expect(onError).toHaveBeenCalledOnce(); expect(model.getSnapshot().documentRevision).toBe(1);
    expect(editing.state.interaction.selection).toEqual({startFrame: 500, endFrame: 700});
    field(host, 'Start frame', '10'); field(host, 'End frame', '20'); key(handle.surface, 'Delete');
    expect(model.sequence.length).toBe(600);
    field(host, 'Start frame', '10'); field(host, 'End frame', '20'); field(host, 'Silence frames', '');
    button(host, 'Insert silence').click();
    expect(onError).toHaveBeenCalledTimes(2); expect(model.sequence.length).toBe(600);
    expect(editing.state.interaction.selection).toEqual({startFrame: 500, endFrame: 500});
    field(host, 'Silence frames', '5'); button(host, 'Insert silence').click();
    expect(model.sequence.length).toBe(605); expect(model.sequence.segments[1]).toMatchObject({kind: 'silence', length: 5});
  });

  it('reapplies later regions and the requested playhead mode when content rebuilds the drawing', () => {
    const model = editor(), editing = createAudioViewEditing(model);
    const host = document.createElement('div'); document.body.append(host);
    const handle = mountWaveformEditor(host, editing, {pixelsPerSecond: 100});
    cleanups.push(() => { handle.dispose(); editing.dispose(); });
    const regions = [createRegion({startSeconds: 1, endSeconds: 2, label: 'Cue'})];
    handle.setRegions(regions); handle.setPlayheadMode('center');
    model.execute({version: 1, label: 'Trim', documentId: model.getSnapshot().documentId, expectedRevision: 0, operations: [{type: 'trim', startFrame: 0, endFrame: 500}]});
    expect(spies.render).toHaveBeenCalledTimes(2);
    expect(spies.render.mock.calls[1][2]).toMatchObject({regions, playheadMode: 'center'});
    editing.setEditable(true);
    expect(spies.render.mock.results[1].value.setPlayheadMode).toHaveBeenLastCalledWith('position');
    editing.select({startFrame: 0, endFrame: 100}); button(host, 'Delete selection').click();
    expect(spies.render.mock.calls[2][2]).toMatchObject({regions, playheadMode: 'position'});
    editing.setEditable(false);
    expect(spies.render.mock.results[2].value.setPlayheadMode).toHaveBeenLastCalledWith('center');
  });

  it.each(['external commit', 'undo shortcut'])('drops a stale drag after an %s without nesting a session command', (change) => {
    const {model, editing, host, handle} = mount();
    const failed = vi.spyOn(console, 'error').mockImplementation(() => {});
    model.transaction('Setup', tx => tx.add({type: 'insert-silence', frame: 0, length: 100, id: 'setup'}));
    host.querySelector<HTMLSelectElement>('[aria-label="Pointer tool"]')!.value = 'trim';
    pointer(handle.surface, 'pointerdown', 100); pointer(handle.surface, 'pointermove', 300);
    expect(editing.state.interaction.draft).toBeDefined();
    if (change === 'undo shortcut') key(handle.surface, 'z', {ctrlKey: true});
    else model.transaction('External gain', tx => tx.add({type: 'set-gain', segmentIds: [model.sequence.segments[1].id], gain: .5}));
    expect(failed).not.toHaveBeenCalled();
    expect(editing.state.interaction.draft).toBeUndefined();
    expect(host.querySelector('[part="editing-status"]')?.textContent).toContain('revision 2');
    expect(host.querySelector('[part="editor"]')?.getAttribute('data-edit-state')).toBe('ready');
    pointer(handle.surface, 'pointerup', 300);
    expect(model.getSnapshot().documentRevision).toBe(2); expect(model.sequence.length).toBe(change === 'undo shortcut' ? 1000 : 1100);
  });

  it.each(['pointercancel', 'lostpointercapture'])('ignores %s from another pointer during an active trim', (type) => {
    const {model, editing, host, handle, onCommit} = mount();
    host.querySelector<HTMLSelectElement>('[aria-label="Pointer tool"]')!.value = 'trim';
    pointer(handle.surface, 'pointerdown', 100); pointer(handle.surface, 'pointermove', 300);
    pointer(handle.surface, type, 0, 2);
    expect(editing.state.interaction.draft).toBeDefined();
    pointer(handle.surface, 'pointerup', 300);
    expect(model.sequence.length).toBe(200); expect(onCommit).toHaveBeenCalledOnce();
  });

  it('ignores invalid zoom values without changing geometry or the active gesture', () => {
    const {editing, host, handle} = mount();
    const rendered = spies.render.mock.results.at(-1)!.value, setZoom = vi.spyOn(rendered, 'setZoom');
    host.querySelector<HTMLSelectElement>('[aria-label="Pointer tool"]')!.value = 'trim';
    pointer(handle.surface, 'pointerdown', 100);
    for (const value of [Number.NaN, 0, -2, Number.POSITIVE_INFINITY]) handle.setZoom(value);
    pointer(handle.surface, 'pointermove', 300);
    expect(setZoom).not.toHaveBeenCalled(); expect(editing.state.interaction.draft).toBeDefined();
    expect(editing.state.interaction.selection).toEqual({startFrame: 100, endFrame: 300});
    const range = host.querySelector<HTMLElement>('[part="selection"] div')!;
    expect([range.style.left, range.style.width]).toEqual(['100px', '200px']);
  });

  it('measures pointer frames and places the selection overlay in the drawing box rather than the styled surface', () => {
    const {editing, host, handle} = mount();
    const drawing = host.querySelector('[data-wave]')!.parentElement!;
    const rect = (left: number) => ({left, top: 0, right: left + 400, bottom: 128, width: 400, height: 128, x: left, y: 0, toJSON() {}}) as DOMRect;
    handle.surface.getBoundingClientRect = () => rect(0); drawing.getBoundingClientRect = () => rect(20);
    pointer(handle.surface, 'pointerdown', 120); pointer(handle.surface, 'pointermove', 320); pointer(handle.surface, 'pointerup', 320);
    expect(editing.state.interaction.selection).toEqual({startFrame: 100, endFrame: 300});
    const overlay = host.querySelector<HTMLElement>('[part="selection"]')!;
    expect(drawing.contains(overlay)).toBe(true); expect(overlay.querySelector('div')!.style.left).toBe('100px');
    editing.select({startFrame: 0, endFrame: 100}); button(host, 'Delete selection').click();
    expect(drawing.lastElementChild).toBe(overlay);
  });

  it('publishes the clamped window when a rebuilt drawing cannot keep the previous offset', () => {
    const base = spies.render.getMockImplementation()!;
    spies.render.mockImplementation((host: HTMLElement, source: AudioWaveformSource, options: WaveformRenderOptions) => {
      const rendered = base(host, source, options), setOffset = rendered.setOffset;
      rendered.setOffset = (value: number) => setOffset(Math.max(0, Math.min(value, options.durationSeconds! - 4)));
      return rendered;
    });
    const {host, handle, editing} = mount();
    const views: AudioViewport[] = []; handle.onViewportChange((view) => views.push(view));
    handle.setOffset(5); expect(views.at(-1)).toEqual({startSeconds: 5, endSeconds: 9});
    editing.select({startFrame: 0, endFrame: 800}); button(host, 'Delete selection').click();
    expect(views.at(-1)).toEqual({startSeconds: 0, endSeconds: 4}); expect(handle.viewport().startSeconds).toBe(0);
  });

  it('rejects an unavailable controller before acquiring DOM, listeners or the asset lease', () => {
    const model = editor(), snapshot = model.getSnapshot(), segment = snapshot.content.segments[0];
    const assetId = segment.kind === 'asset' ? segment.assetId : '', references = snapshot.assets.getReferenceCount(assetId);
    const editing = createAudioViewEditing(model, {editable: true}); editing.dispose();
    const host = document.createElement('div'); document.body.append(host);
    const added = vi.spyOn(window, 'addEventListener');
    expect(() => mountWaveformEditor(host, editing)).toThrow(/unavailable/);
    expect(host.childElementCount).toBe(0); expect(spies.render).not.toHaveBeenCalled();
    expect(added.mock.calls.some(([type]) => type === 'blur')).toBe(false);
    expect(snapshot.assets.getReferenceCount(assetId)).toBe(references);
  });

  it('rolls back DOM, listeners and the asset lease when the first drawing fails', () => {
    const model = editor(), snapshot = model.getSnapshot(), segment = snapshot.content.segments[0];
    const assetId = segment.kind === 'asset' ? segment.assetId : '', references = snapshot.assets.getReferenceCount(assetId);
    const editing = createAudioViewEditing(model, {editable: true}); cleanups.push(() => editing.dispose());
    const host = document.createElement('div'); document.body.append(host);
    const added = vi.spyOn(window, 'addEventListener'), removed = vi.spyOn(window, 'removeEventListener');
    spies.render.mockImplementationOnce(() => { throw new Error('paint failed'); });
    expect(() => mountWaveformEditor(host, editing)).toThrow('paint failed');
    expect(host.childElementCount).toBe(0); expect(snapshot.assets.getReferenceCount(assetId)).toBe(references);
    const blur = added.mock.calls.filter(([type]) => type === 'blur').map(([, listener]) => listener);
    expect(blur.every((listener) => removed.mock.calls.some(([type, value]) => type === 'blur' && value === listener))).toBe(true);
  });

  it('exposes the focusable application surface only while editing is operable', () => {
    const model = editor(), editing = createAudioViewEditing(model);
    const host = document.createElement('div'); document.body.append(host);
    const handle = mountWaveformEditor(host, editing);
    cleanups.push(() => { handle.dispose(); editing.dispose(); });
    for (const name of ['tabindex', 'role', 'aria-label', 'aria-describedby']) expect(handle.surface.hasAttribute(name)).toBe(false);
    editing.setEditable(true);
    expect(handle.surface.getAttribute('tabindex')).toBe('0'); expect(handle.surface.getAttribute('role')).toBe('application');
    expect(handle.surface.getAttribute('aria-describedby')).toBe(host.querySelector('[part="editing-instructions"]')!.id);
    editing.setEditable(false); expect(handle.surface.hasAttribute('role')).toBe(false);
  });

  it('rewrites the live status only when its text changes and holds announcements during a pointer drag', () => {
    const {host, handle} = mount();
    const status = host.querySelector('[part="editing-status"]')!;
    const observer = new MutationObserver(() => {}); observer.observe(status, {childList: true, characterData: true, subtree: true});
    handle.updatePlayback(undefined, .25); handle.updatePlayback(undefined, .5);
    expect(observer.takeRecords()).toHaveLength(0);
    pointer(handle.surface, 'pointerdown', 100); expect(status.getAttribute('aria-busy')).toBe('true');
    pointer(handle.surface, 'pointermove', 300); pointer(handle.surface, 'pointerup', 300);
    expect(status.hasAttribute('aria-busy')).toBe(false); expect(status.textContent).toContain('Frames 100–300');
    observer.disconnect();
  });

  it('moves and extends by one second with PageUp and PageDown', () => {
    const {editing, handle} = mount();
    editing.select({startFrame: 250, endFrame: 250});
    key(handle.surface, 'PageDown'); expect(editing.state.interaction.selection).toEqual({startFrame: 350, endFrame: 350});
    key(handle.surface, 'PageDown', {shiftKey: true}); key(handle.surface, 'ArrowRight', {shiftKey: true});
    expect(editing.state.interaction.selection).toEqual({startFrame: 350, endFrame: 451});
    key(handle.surface, 'PageUp'); expect(editing.state.interaction.selection).toEqual({startFrame: 250, endFrame: 250});
    for (let i = 0; i < 4; i++) key(handle.surface, 'PageUp');
    expect(editing.state.interaction.selection).toEqual({startFrame: 0, endFrame: 0});
  });
});

describe('Audio View document borrowing', () => {
  const view = () => document.createElement('editing-audio-view') as AudioViewElement;
  it('requires an explicit editor for editable and reports independent source conflicts including empty attributes', () => {
    const element = view(); element.editable = true; document.body.append(element);
    expect(element.textContent).toContain('requires a ready audio editor'); expect(element.getAttribute('data-editable-state')).toBe('unavailable');
    const model = editor(); element.editor = model; expect(element.getAttribute('data-editor-state')).toBe('ready');
    element.setAttribute('src', ''); expect(element.getAttribute('data-editor-state')).toBe('source-conflict'); expect(element.querySelector('[part="editing-surface"]')).toBeNull();
    element.removeAttribute('src'); expect(element.querySelector('[part="editing-surface"]')).not.toBeNull();
    element.setAttribute('peaks-src', ''); expect(element.getAttribute('data-editor-state')).toBe('source-conflict');
    element.removeAttribute('peaks-src'); expect(element.getAttribute('data-editor-state')).toBe('ready');
  });

  it('keeps its editing surface when the bound player reports a load-state change', () => {
    const player = document.createElement('div'); player.id = 'load-state-player'; document.body.append(player);
    const element = view(); element.editor = editor(); element.editable = true; element.setAttribute('player', '#load-state-player');
    document.body.append(element);
    const surface = element.querySelector('[part="editing-surface"]');
    expect(surface).not.toBeNull();
    player.dispatchEvent(new Event('webaudio:loadstatechange'));
    expect(element.querySelector('[part="editing-surface"]')).toBe(surface);
  });

  const independentSources = {
    clip: () => createAudioClip({sampleRate: 100, channelData: [new Float32Array(10)]}),
    peaks: () => ({sampleRate: 100, channels: 1, baseSamplesPerPeak: 1, levels: []}),
    spectrogram: () => ({times: [0], frequencies: [10], magnitudes: new Float32Array([1]), binsPerFrame: 1}),
    frequencyData: () => [{times: [0], frequencies: [10], magnitudes: new Float32Array([1]), binsPerFrame: 1}],
  };
  function assignSource(element: AudioViewElement, name: keyof typeof independentSources, value: ReturnType<typeof independentSources[typeof name]> | undefined) {
    if (name === 'clip') element.clip = value as AudioViewElement['clip'];
    else if (name === 'peaks') element.peaks = value as AudioViewElement['peaks'];
    else if (name === 'spectrogram') element.spectrogram = value as AudioViewElement['spectrogram'];
    else element.frequencyData = value as AudioViewElement['frequencyData'];
  }
  it.each(Object.keys(independentSources) as Array<keyof typeof independentSources>)('rejects independent .%s before changing a ready document binding', (name) => {
    const model = editor(), element = view(); element.editor = model; element.editable = true; document.body.append(element);
    const session = element.interactionSession!, surface = element.querySelector('[part="editing-surface"]');
    session.setSelection({startFrame: 10, endFrame: 20});
    expect(() => assignSource(element, name, independentSources[name]())).toThrow(/source-conflict/);
    expect(element[name]).toBeUndefined(); expect(element.editor).toBe(model); expect(element.interactionSession).toBe(session);
    expect(session.getSnapshot()).toMatchObject({disposed: false, selection: {startFrame: 10, endFrame: 20}});
    expect(element.getAttribute('data-editor-state')).toBe('ready'); expect(element.querySelector('[part="editing-surface"]')).toBe(surface);
  });

  it.each(Object.keys(independentSources) as Array<keyof typeof independentSources>)('rejects .editor before replacing independent .%s', (name) => {
    const model = editor(), element = view(), source = independentSources[name](); assignSource(element, name, source); document.body.append(element);
    const presentation = element.firstElementChild;
    expect(() => {element.editor = model;}).toThrow(/source-conflict/);
    expect(element[name]).toBe(source); expect(element.editor).toBeUndefined(); expect(element.firstElementChild).toBe(presentation);
    expect(element.hasAttribute('data-editor-state')).toBe(false);
    assignSource(element, name, undefined); element.editor = model; expect(element.getAttribute('data-editor-state')).toBe('ready');
  });

  it.each(['src', 'peaks-src'])('rejects .editor when the independent %s attribute is present, including empty values', (name) => {
    const element = view(), model = editor(); element.setAttribute(name, '');
    expect(() => {element.editor = model;}).toThrow(/source-conflict/); expect(element.editor).toBeUndefined();
    element.removeAttribute(name); element.editor = model; expect(element.editor).toBe(model);
  });

  it('rejects invalid editor and mismatched session replacements without releasing a ready binding', () => {
    const model = editor(), other = editor(), element = view();
    const shared = model.createInteractionSession(), foreign = other.createInteractionSession();
    cleanups.push(() => {shared.dispose(); foreign.dispose();});
    element.editor = model; element.interactionSession = shared; document.body.append(element);
    const surface = element.querySelector('[part="editing-surface"]');
    expect(() => {element.editor = {} as typeof model;}).toThrow(/AudioClipEditorPort/);
    expect(() => {element.editor = other;}).toThrow(/another document/);
    expect(() => {element.interactionSession = foreign;}).toThrow(/another document/);
    expect(element.editor).toBe(model); expect(element.interactionSession).toBe(shared);
    expect(element.querySelector('[part="editing-surface"]')).toBe(surface); expect(shared.getSnapshot().disposed).toBe(false);
  });

  it('discovers late HTML owners, replacements, missing and ambiguous selectors and explicit precedence', async () => {
    const element = view(); element.setAttribute('editor', '#document'); document.body.append(element);
    expect(element.getAttribute('data-editor-state')).toBe('missing');
    const first = editor(), second = editor(); const owner = document.createElement('div') as unknown as HTMLElement & {editor: typeof first};
    owner.id = 'document'; owner.editor = first; document.body.append(owner); await tick(); expect(element.editor).toBe(first);
    owner.editor = second; owner.dispatchEvent(new CustomEvent('webmusic:sourcechange', {bubbles: true})); expect(element.editor).toBe(second);
    element.editor = first; owner.remove(); await tick(); expect(element.editor).toBe(first);
    element.editor = undefined; expect(element.getAttribute('data-editor-state')).toBe('missing');
    document.body.append(owner); const duplicate = owner.cloneNode() as typeof owner; duplicate.editor = first; document.body.append(duplicate); await tick();
    expect(element.getAttribute('data-editor-state')).toBe('ambiguous');
    duplicate.remove(); await tick(); expect(element.editor).toBe(second);
    element.remove(); expect(second.getSnapshot().status).toBe('ready');
  });

  it('borrows shared selection and leaves it and the editor alive after disconnect', () => {
    const model = editor(), session = model.createInteractionSession(); const a = view(), b = view();
    a.editor = model; b.editor = model; a.interactionSession = session; b.interactionSession = session; a.editable = b.editable = true;
    document.body.append(a, b); session.setSelection({startFrame: 10, endFrame: 20});
    expect(a.textContent).toContain('Frames 10–20'); expect(b.textContent).toContain('Frames 10–20');
    session.preview([{type: 'trim', startFrame: 10, endFrame: 20}]); const draft = session.getSnapshot().draft;
    a.remove(); expect(session.getSnapshot().disposed).toBe(false); expect(session.getSnapshot().draft).toBe(draft);
    expect(model.getSnapshot().status).toBe('ready'); b.remove(); expect(session.getSnapshot().draft).toBe(draft); session.dispose();
  });

  it('releases the rendered source lease when an application-owned editor is disposed', () => {
    const model = editor(), element = view(), snapshot = model.getSnapshot();
    const assetId = snapshot.content.segments[0].kind === 'asset' ? snapshot.content.segments[0].assetId : '';
    element.editor = model; element.editable = true; document.body.append(element);
    model.dispose();
    expect(element.textContent).toContain('Audio editor unavailable');
    expect(element.querySelector('[part="editing-surface"]')).toBeNull();
    expect(snapshot.assets.getDescriptor(assetId)).toBeUndefined();
  });

  it('keeps region annotation separate and prevents simultaneous content gestures', () => {
    const element = view(), model = editor(); element.editor = model; element.editable = true; element.annotate = true;
    element.regions = [createRegion({startSeconds: 1, endSeconds: 2, label: 'Cue'})]; document.body.append(element);
    expect(element.getAttribute('data-editable-state')).toBe('annotation');
    const surface = element.querySelector<HTMLElement>('[part="editing-surface"]')!;
    pointer(surface, 'pointerdown', 100); pointer(surface, 'pointermove', 300); pointer(surface, 'pointerup', 300);
    expect(model.getSnapshot().documentRevision).toBe(0); expect(element.regions).toHaveLength(1);
    element.annotate = false; expect(element.getAttribute('data-editable-state')).toBe('ready');
  });

  it('reports clip-only sequence modes unavailable, while a passive explicit clip remains usable', () => {
    const element = view(), model = editor(); element.editor = model; element.type = 'spectrogram'; element.editable = true; document.body.append(element);
    expect(element.textContent).toContain('Sequence documents support waveform'); expect(element.getAttribute('data-editable-state')).toBe('unsupported-type');
    element.type = 'waveform'; element.editor = undefined; element.editable = false;
    element.clip = createAudioClip({sampleRate: 100, channelData: [new Float32Array(10)]});
    expect(element.querySelector('[data-wave]')).not.toBeNull();
  });

  it('gates player events and seeking until exact applied revision readiness', () => {
    const model = editor(), snapshot = model.getSnapshot();
    const player = document.createElement('div') as unknown as HTMLElement & {seconds: number; duration: number; playing: boolean; seek: ReturnType<typeof vi.fn>; documentBinding: AudioDocumentPlaybackBinding};
    player.id = 'edit-player'; player.seconds = 2; player.duration = 10; player.playing = false; player.seek = vi.fn();
    player.documentBinding = {status: 'preparing', attempt: 1, documentCoordinates: true, applied: {documentId: snapshot.documentId, documentRevision: 0}};
    const element = view(); element.editor = model; element.interactive = true; element.setAttribute('player', '#edit-player'); document.body.append(player, element);
    key(element, 'ArrowRight'); expect(player.seek).not.toHaveBeenCalled(); expect(element.getAttribute('data-playback-state')).toBe('pending');
    player.documentBinding = {...player.documentBinding, status: 'ready'}; player.dispatchEvent(new CustomEvent('webaudio:documentstatechange'));
    key(element, 'ArrowRight'); expect(player.seek).toHaveBeenCalled(); expect(element.getAttribute('data-playback-state')).toBe('ready');
    player.documentBinding = {...player.documentBinding, applied: {...player.documentBinding.applied!, documentRevision: 1}};
    player.dispatchEvent(new CustomEvent('webaudio:documentstatechange')); player.seek.mockClear(); key(element, 'ArrowRight'); expect(player.seek).not.toHaveBeenCalled();
  });

  it('discovers a late player and removes its applied overlay on removal or ambiguity', async () => {
    const model = editor(), snapshot = model.getSnapshot(), element = view();
    element.editor = model; element.editable = true; element.setAttribute('player', '#late-player'); document.body.append(element);
    expect(element.getAttribute('data-playback-state')).toBe('unbound');
    const player = document.createElement('div') as unknown as HTMLElement & {documentBinding: AudioDocumentPlaybackBinding};
    player.id = 'late-player'; player.documentBinding = {status: 'ready', attempt: 1, documentCoordinates: true,
      applied: {documentId: snapshot.documentId, documentRevision: 0}};
    document.body.append(player); await tick(); expect(element.getAttribute('data-playback-state')).toBe('ready');
    const duplicate = document.createElement('div'); duplicate.id = 'late-player'; document.body.append(duplicate); await tick();
    expect(element.getAttribute('data-playback-state')).toBe('unbound');
    duplicate.remove(); await tick(); expect(element.getAttribute('data-playback-state')).toBe('ready');
    player.remove(); await tick(); expect(element.getAttribute('data-playback-state')).toBe('unbound');
  });

  it.each(Object.keys(independentSources) as Array<keyof typeof independentSources>)('keeps the document session when an empty .%s is cleared again', (name) => {
    const model = editor(), element = view(); element.editor = model; element.editable = true; document.body.append(element);
    const session = element.interactionSession!, surface = element.querySelector('[part="editing-surface"]');
    session.setSelection({startFrame: 10, endFrame: 20});
    assignSource(element, name, undefined);
    expect(element.interactionSession).toBe(session);
    expect(session.getSnapshot()).toMatchObject({disposed: false, selection: {startFrame: 10, endFrame: 20}});
    expect(element.querySelector('[part="editing-surface"]')).toBe(surface);
  });

  it('removes document playback state with the editor binding', () => {
    const model = editor(), element = view(); element.editor = model; document.body.append(element);
    expect(element.getAttribute('data-playback-state')).toBe('unbound');
    element.editor = undefined;
    expect(element.hasAttribute('data-playback-state')).toBe(false); expect(element.hasAttribute('data-editor-state')).toBe(false);
  });

  it('keeps an editable scrub view in position geometry and pannable, and centers it again when read-only', () => {
    const model = editor(), element = view();
    element.editor = model; element.editable = true; element.interactive = true; element.dragMode = 'scrub'; document.body.append(element);
    expect(spies.render.mock.calls.at(-1)![2]).toMatchObject({playheadMode: 'position'});
    element.panTo(2); expect(element.visibleRange()?.startSeconds).toBe(2);
    element.editable = false;
    expect(spies.render.mock.calls.at(-1)![2]).toMatchObject({playheadMode: 'center'});
    expect(element.getAttribute('role')).toBe('slider');
    expect(element.querySelector('[part="editing-surface"]')!.hasAttribute('role')).toBe(false);
  });

  it('does not repaint paused playback for selection-only publications', () => {
    const model = editor(), snapshot = model.getSnapshot();
    const player = document.createElement('div') as unknown as HTMLElement & {seconds: number; duration: number; playing: boolean; documentBinding: AudioDocumentPlaybackBinding};
    player.id = 'paused-player'; player.seconds = 2; player.duration = 10; player.playing = false;
    player.documentBinding = {status: 'ready', attempt: 1, documentCoordinates: true, applied: {documentId: snapshot.documentId, documentRevision: 0}};
    const element = view(); element.editor = model; element.editable = true; element.setAttribute('player', '#paused-player');
    document.body.append(player, element);
    expect(element.getAttribute('data-playback-state')).toBe('ready');
    const rendered = spies.render.mock.results.at(-1)!.value; rendered.redraw.mockClear(); rendered.redrawFrame.mockClear();
    const surface = element.querySelector<HTMLElement>('[part="editing-surface"]')!;
    pointer(surface, 'pointerdown', 100); for (const x of [150, 200, 250]) pointer(surface, 'pointermove', x); pointer(surface, 'pointerup', 250);
    key(surface, 'ArrowRight', {shiftKey: true});
    expect(element.interactionSession!.getSnapshot().selection).toEqual({startFrame: 100, endFrame: 251});
    expect(rendered.redraw).not.toHaveBeenCalled(); expect(rendered.redrawFrame).not.toHaveBeenCalled();
    player.seconds = 3; player.dispatchEvent(new CustomEvent('webaudio:documentstatechange'));
    expect(rendered.redraw).toHaveBeenCalledWith(3, false);
  });
});
async function tick() { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); }
