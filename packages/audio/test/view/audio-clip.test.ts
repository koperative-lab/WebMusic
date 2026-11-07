// @vitest-environment jsdom
import {afterEach, describe, expect, it, vi} from 'vitest';
import {createAudioClip, readAudioSequenceRange, type AudioDocumentPlaybackBinding} from '../../src/core';
import {createAudioClipEditor, type AudioClipEditor} from '../../src/view/headless';
import {createAudioViewEditing, type AudioViewEditing} from '../../src/view/headless/audio-editing';
import {audioFadeLength} from '../../src/view/core/clip-edits';
import {createAudioRangeProcessor} from '../../src/view/api/processor';
import {mountAudioClip, type AudioClipHandle, type AudioClipOptions} from '../../src/view/render/audio-clip';
import {AudioClipViewElement, defineAudioClipViewElement} from '../../src/view/element/audio-clip-view';

/** 2 s at 1 kHz drawn at 1000 px/s: one frame per pixel keeps the geometry readable. */
const clip = () => createAudioClip({sampleRate: 1000, channelData: [Float32Array.from({length: 2000}, (_, index) => Math.sin(index / 7) * .5)]});
const cleanups: Array<() => void> = [];
afterEach(() => { for (const cleanup of cleanups.splice(0).reverse()) cleanup(); document.body.replaceChildren(); vi.restoreAllMocks(); });

function mount(options: AudioClipOptions = {}, editorOptions: Parameters<typeof createAudioClipEditor>[1] = {}) {
  const editor = createAudioClipEditor(clip(), editorOptions);
  const editing = createAudioViewEditing(editor, {editable: true});
  const host = document.createElement('div');
  document.body.append(host);
  const onCommit = vi.fn(), onError = vi.fn(), onPreview = vi.fn(), onSeek = vi.fn();
  const handle = mountAudioClip(host, {editing}, {pixelsPerSecond: 1000, onCommit, onError, onPreview, onSeek, ...options});
  cleanups.push(() => { handle.dispose(); editing.dispose(); editor.dispose(); });
  return {editor, editing, host, handle, onCommit, onError, onPreview, onSeek};
}
function pointer(target: Element, type: string, x: number, y = 60, init: MouseEventInit = {}) {
  const event = new MouseEvent(type, {bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, ...init});
  Object.defineProperty(event, 'pointerId', {value: 1});
  target.dispatchEvent(event);
}
function drag(target: Element, from: number, to: number, y = 60, toY = y) {
  pointer(target, 'pointerdown', from, y); pointer(target, 'pointermove', to, toY); pointer(target, 'pointerup', to, toY);
}
const stage = (host: HTMLElement) => host.querySelector('[part~="stage"]')!;
const viewport = (host: HTMLElement) => host.querySelector('[part~="viewport"]')!;
const key = (host: HTMLElement, value: string, init: KeyboardEventInit = {}) =>
  viewport(host).dispatchEvent(new KeyboardEvent('keydown', {key: value, bubbles: true, cancelable: true, ...init}));
const action = (host: HTMLElement, name: string) => host.querySelector<HTMLButtonElement>(`[data-clip-action="${name}"]`)!;
const content = (editor: AudioClipEditor) => editor.getSnapshot().content;
function pcm(editor: AudioClipEditor): Float32Array {
  const channel = new Float32Array(content(editor).length);
  readAudioSequenceRange(content(editor), editor.getSnapshot().assets, 0, [channel]);
  return channel;
}

describe('mountAudioClip', () => {
  it('draws a decoded clip read-only without toolbar or focus entry, and releases it', () => {
    const host = document.createElement('div'); document.body.append(host);
    const handle = mountAudioClip(host, {clip: clip()}, {pixelsPerSecond: 1000});
    expect((host.querySelector('[part~="toolbar"]') as HTMLElement).hidden).toBe(true);
    expect(viewport(host).hasAttribute('tabindex')).toBe(false);
    expect(host.querySelector('[part~="hud"]')!.hasAttribute('hidden')).toBe(true);
    expect(handle.visibleRange().startSeconds).toBe(0);
    handle.dispose();
    expect(host.querySelector('[data-audio-clip]')).toBeNull();
  });

  it('shows only the offered toolbar groups and takes focus while editable', () => {
    const {host} = mount({features: ['delete', 'history']});
    expect((host.querySelector('[part~="toolbar"]') as HTMLElement).hidden).toBe(false);
    expect((host.querySelector('[data-group="history"]') as HTMLElement).hidden).toBe(false);
    expect((host.querySelector('[data-group="clipboard"]') as HTMLElement).hidden).toBe(true);
    expect((host.querySelector('[data-group="process"]') as HTMLElement).hidden).toBe(true);
    expect(viewport(host).getAttribute('tabindex')).toBe('0');
  });

  it('selects by dragging, places a cursor on click and extends with Shift', () => {
    const {host, editing} = mount();
    drag(stage(host), 100, 300);
    expect(editing.state.interaction.selection).toEqual({startFrame: 100, endFrame: 300});
    pointer(stage(host), 'pointerdown', 500); pointer(stage(host), 'pointerup', 500);
    expect(editing.state.interaction.selection).toEqual({startFrame: 500, endFrame: 500});
    key(host, 'ArrowRight', {shiftKey: true});
    expect(editing.state.interaction.selection).toEqual({startFrame: 500, endFrame: 510});
    key(host, 'a', {metaKey: true});
    expect(editing.state.interaction.selection).toEqual({startFrame: 0, endFrame: 2000});
  });

  it('snaps range edges to the chosen grid', () => {
    const {host, editing, handle} = mount({snap: '100ms'});
    drag(stage(host), 140, 362);
    expect(editing.state.interaction.selection).toEqual({startFrame: 100, endFrame: 400});
    handle.configure({snap: 'off'});
    drag(stage(host), 140, 362);
    expect(editing.state.interaction.selection).toEqual({startFrame: 140, endFrame: 362});
  });

  it('deletes, trims, splits, marks and undoes through the keyboard', () => {
    const {host, editor, editing, onCommit} = mount();
    editing.select({startFrame: 100, endFrame: 300});
    key(host, 'Delete');
    expect(content(editor).length).toBe(1800);
    key(host, 'z', {metaKey: true});
    expect(content(editor).length).toBe(2000);
    editing.select({startFrame: 500, endFrame: 500});
    key(host, 'k', {ctrlKey: true});
    expect(content(editor).segments).toHaveLength(2);
    key(host, 'm');
    expect(content(editor).annotations).toMatchObject([{startFrame: 500, label: 'Marker 1'}]);
    editing.select({startFrame: 200, endFrame: 700});
    key(host, 't', {metaKey: true});
    expect(content(editor).length).toBe(500);
    expect(onCommit).toHaveBeenCalledTimes(5);
  });

  it('applies range fades, silence and amplify from the toolbar and the gain HUD', () => {
    const {host, editor, editing} = mount();
    editing.select({startFrame: 0, endFrame: 1000});
    action(host, 'fade-in').click();
    expect(Math.abs(pcm(editor)[1])).toBeLessThan(.01);
    editing.select({startFrame: 1500, endFrame: 1600});
    action(host, 'silence').click();
    expect(pcm(editor)[1550]).toBe(0);
    editing.select({startFrame: 1600, endFrame: 1600});
    const before = pcm(editor)[1800];
    const hud = host.querySelector<HTMLElement>('[part~="hud"]')!;
    hud.dispatchEvent(new KeyboardEvent('keydown', {key: 'ArrowUp', bubbles: true}));
    expect(pcm(editor)[1800] / before).toBeCloseTo(10 ** (1 / 20), 3);
  });

  it('drags a fade handle and a segment gain line as one draft each', () => {
    const {host, editor, onPreview, onCommit} = mount();
    const fadeIn = host.querySelector('[data-fade-handle="in"]')!;
    pointer(fadeIn, 'pointerdown', 0, 28); pointer(stage(host), 'pointermove', 250, 28);
    expect(onPreview).toHaveBeenCalled();
    expect(editor.getSnapshot().documentRevision).toBe(0);
    pointer(stage(host), 'pointerup', 250, 28);
    const segment = content(editor).segments[0];
    expect(segment.kind === 'asset' && audioFadeLength(segment.envelope, 2000, 'in')).toBe(250);
    const gainLine = host.querySelector('[data-gain-line]')!;
    const y = Number(gainLine.getAttribute('y1'));
    pointer(gainLine, 'pointerdown', 800, y); pointer(stage(host), 'pointermove', 800, y + 30); pointer(stage(host), 'pointerup', 800, y + 30);
    const quieter = content(editor).segments[0];
    expect(quieter.kind === 'asset' && quieter.gain).toBeLessThan(1);
    expect(onCommit).toHaveBeenCalledTimes(2);
  });

  it('cuts with the razor tool and adds envelope points with the envelope tool', () => {
    const {host, editor, handle} = mount();
    handle.configure({tool: 'split'});
    pointer(stage(host), 'pointerdown', 700); pointer(stage(host), 'pointerup', 700);
    expect(content(editor).segments).toHaveLength(2);
    handle.configure({tool: 'envelope'});
    pointer(stage(host), 'pointerdown', 300, 24 + 135); pointer(stage(host), 'pointerup', 300, 24 + 135);
    const first = content(editor).segments[0];
    expect(first.kind === 'asset' && first.envelope.some((point) => point.frame === 300 && point.gain < 1)).toBe(true);
  });

  it('cancels a handle drag when another consumer commits a revision', () => {
    const {host, editor, editing} = mount();
    const fadeIn = host.querySelector('[data-fade-handle="in"]')!;
    pointer(fadeIn, 'pointerdown', 0, 28); pointer(stage(host), 'pointermove', 250, 28);
    expect(editing.state.interaction.draft).toBeDefined();
    editor.execute({version: 1, documentId: editor.getSnapshot().documentId, expectedRevision: 0, label: 'External', operations: [{type: 'trim', startFrame: 0, endFrame: 1900}]});
    expect(editing.state.interaction.draft).toBeUndefined();
    pointer(stage(host), 'pointerup', 250, 28);
    expect(editor.getSnapshot().documentRevision).toBe(1);
  });

  it('withholds features that are not offered and asks the application to seek from the ruler', () => {
    const {host, editor, editing, onSeek} = mount({features: ['history']});
    editing.select({startFrame: 100, endFrame: 300});
    key(host, 'Delete'); key(host, 'm'); key(host, 'k', {ctrlKey: true});
    expect(content(editor)).toBe(editor.getSnapshot().content);
    expect(editor.getSnapshot().documentRevision).toBe(0);
    pointer(stage(host), 'pointerdown', 750, 10);
    expect(onSeek).toHaveBeenCalledWith(.75);
  });

  it('runs the editor processors on the selection', async () => {
    const {host, editor, editing, onCommit} = mount({}, {processors: [createAudioRangeProcessor('reverse'), createAudioRangeProcessor('invert')]});
    expect((host.querySelector('[data-group="process"]') as HTMLElement).hidden).toBe(false);
    editing.select({startFrame: 0, endFrame: 1000});
    action(host, 'process').click();
    const options = [...host.querySelectorAll<HTMLButtonElement>('[part~="card"] [part~="choice"]')];
    expect(options.find((option) => option.dataset.value === 'normalize')!.disabled).toBe(true);
    const before = pcm(editor)[10];
    options.find((option) => option.dataset.value === 'invert')!.click();
    await vi.waitFor(() => expect(onCommit).toHaveBeenCalled());
    expect(pcm(editor)[10]).toBeCloseTo(-before, 6);
  });

  it('opens adjustment cards over a scrim and closes them with Escape', () => {
    const {host, handle} = mount();
    action(host, 'curve').click();
    const scrim = host.querySelector<HTMLElement>('[part~="overlay"]')!;
    expect(scrim.hidden).toBe(false);
    expect(action(host, 'curve').getAttribute('aria-expanded')).toBe('true');
    host.querySelector<HTMLButtonElement>('[part~="card"] [data-value="cosine"]')!.click();
    expect(handle.settings.fadeCurve).toBe('cosine');
    expect(scrim.hidden).toBe(true);
    action(host, 'values').click();
    host.querySelector('[part~="card"]')!.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', bubbles: true}));
    expect(scrim.hidden).toBe(true);
  });

  it('toggles grid snap with one click and snaps to the ruler quarter ticks without a beat grid', () => {
    const {host, editing, handle} = mount();
    action(host, 'snap').click();
    expect(handle.settings.snap).toBe('grid');
    expect(action(host, 'snap').getAttribute('aria-pressed')).toBe('true');
    expect(host.querySelector('[part~="overlay"]')!.hasAttribute('hidden')).toBe(true);
    // 1000 px/s labels every 0.1 s; quarter ticks are 25 frames apart.
    drag(stage(host), 110, 263);
    expect(editing.state.interaction.selection).toEqual({startFrame: 100, endFrame: 275});
    expect(host.querySelectorAll('[data-ruler-tick]').length).toBeGreaterThan(0);
    action(host, 'snap').click();
    expect(handle.settings.snap).toBe('off');
  });

  it('coalesces wheel zoom into one frame and reports it once the gesture settles', async () => {
    const onSettingsChange = vi.fn();
    const {host, handle} = mount({onSettingsChange});
    for (let index = 0; index < 3; index += 1) {
      viewport(host).dispatchEvent(new WheelEvent('wheel', {deltaY: -100, ctrlKey: true, bubbles: true, cancelable: true}));
    }
    await new Promise((resolve) => requestAnimationFrame(resolve));
    // A mouse notch (deltaY 100) is clamped to 40: about 1.5× per notch.
    expect(handle.settings.pixelsPerSecond).toBeCloseTo(1000 * Math.exp(1.2), 0);
    expect(onSettingsChange).not.toHaveBeenCalled();
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(onSettingsChange).toHaveBeenCalledTimes(1);
    expect(onSettingsChange).toHaveBeenLastCalledWith(expect.objectContaining({pixelsPerSecond: handle.settings.pixelsPerSecond}), 'pixelsPerSecond');
  });

  it('follows a pinch exactly: Chromium wheel deltas and Safari gesture scale', async () => {
    const {host, handle} = mount();
    // Chromium: deltaY = −100 × ln(scale); ten −6.93 deltas double the zoom.
    for (let index = 0; index < 10; index += 1) {
      viewport(host).dispatchEvent(new WheelEvent('wheel', {deltaY: -100 * Math.log(2) / 10, ctrlKey: true, bubbles: true, cancelable: true}));
    }
    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect(handle.settings.pixelsPerSecond).toBeCloseTo(2000, 0);
    const gesture = (type: string, scale: number) => {
      const event = new Event(type, {bubbles: true, cancelable: true});
      Object.assign(event, {scale, clientX: 0});
      viewport(host).dispatchEvent(event);
      return event;
    };
    gesture('gesturestart', 1);
    expect(gesture('gesturechange', 1.5).defaultPrevented).toBe(true);
    gesture('gesturechange', 3);
    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect(handle.settings.pixelsPerSecond).toBeCloseTo(6000, 0);
  });

  it('opens at a working zoom of ten seconds instead of the whole clip', () => {
    const long = createAudioClip({sampleRate: 1000, channelData: [new Float32Array(30_000)]});
    const host = document.createElement('div');
    host.getBoundingClientRect = () => ({width: 500, height: 200, x: 0, y: 0, top: 0, left: 0, right: 500, bottom: 200, toJSON: () => ({})});
    document.body.append(host);
    const handle = mountAudioClip(host, {clip: long});
    cleanups.push(() => handle.dispose());
    expect(handle.settings.pixelsPerSecond).toBe(50);
    handle.configure({pixelsPerSecond: 0});
    expect(handle.settings.pixelsPerSecond).toBe(0);
    handle.configure({autoZoom: true});
    expect(handle.settings.pixelsPerSecond).toBe(50);
  });

  it('rejects invalid settings and an unavailable controller', () => {
    const {handle, editing} = mount();
    expect(() => handle.configure({snap: 'triplet' as never})).toThrow(RangeError);
    expect(() => handle.configure({features: ['echo' as never]})).toThrow(RangeError);
    const host = document.createElement('div');
    const editor = createAudioClipEditor(clip());
    const other: AudioViewEditing = createAudioViewEditing(editor, {editable: true});
    editor.dispose();
    expect(() => mountAudioClip(host, {editing: other})).toThrow(/unavailable/);
    expect(host.childElementCount).toBe(0);
    other.dispose();
    expect(editing.state.available).toBe(true);
  });
});

describe('<audio-clip-view>', () => {
  defineAudioClipViewElement('test-audio-clip-view');
  const element = () => document.createElement('test-audio-clip-view') as AudioClipViewElement;

  it('edits a borrowed editor, reflects settings and announces them', () => {
    const editor = createAudioClipEditor(clip());
    cleanups.push(() => editor.dispose());
    const view = element(); view.editor = editor; view.editable = true; view.setAttribute('pixels-per-second', '1000');
    document.body.append(view);
    expect(view.getAttribute('data-editable-state')).toBe('ready');
    const changes = vi.fn();
    view.addEventListener('clipsettingschange', changes);
    view.querySelector<HTMLButtonElement>('[data-clip-action="split"]')!.click();
    expect(view.getAttribute('tool')).toBe('split');
    expect(changes.mock.calls[0][0].detail.changed).toBe('tool');
    const commits = vi.fn();
    view.addEventListener('webaudio:editcommit', commits);
    view.interactionSession!.setSelection({startFrame: 0, endFrame: 100});
    view.querySelector('[part~="viewport"]')!.dispatchEvent(new KeyboardEvent('keydown', {key: 'Delete', bubbles: true}));
    expect(commits).toHaveBeenCalled();
    view.remove();
    expect(editor.getSnapshot().status).toBe('ready');
  });

  it('draws an assigned clip read-only and rejects a conflicting editor', () => {
    const view = element(); view.clip = clip(); document.body.append(view);
    expect(view.querySelector('[data-audio-clip]')).not.toBeNull();
    expect((view.querySelector('[part~="toolbar"]') as HTMLElement).hidden).toBe(true);
    expect(() => { view.editor = createAudioClipEditor(clip()); }).toThrow(/source-conflict/);
    expect(view.tools).toContain('fade');
    view.tools = ['split', 'history'];
    expect(view.getAttribute('tools')).toBe('split history');
    view.setAttribute('snap', 'nonsense');
    expect(view.snap).toBe('off');
  });

  it('shows the playhead only while the player applies the editor revision', () => {
    const editor = createAudioClipEditor(clip());
    cleanups.push(() => editor.dispose());
    const player = document.createElement('div') as unknown as HTMLElement & {seconds: number; documentBinding: AudioDocumentPlaybackBinding; seek: ReturnType<typeof vi.fn>};
    player.id = 'clip-player'; player.seconds = .5; player.seek = vi.fn();
    player.documentBinding = {status: 'preparing', attempt: 1, documentCoordinates: true, applied: {documentId: editor.getSnapshot().documentId, documentRevision: 0}};
    const view = element(); view.editor = editor; view.setAttribute('input', '#clip-player');
    document.body.append(player, view);
    expect(view.getAttribute('data-playback-state')).toBe('pending');
    expect(view.querySelector('[data-playhead]')).toBeNull();
    player.documentBinding = {...player.documentBinding, status: 'ready'};
    player.dispatchEvent(new CustomEvent('webaudio:timeupdate', {detail: {seconds: .5}}));
    expect(view.getAttribute('data-playback-state')).toBe('ready');
    expect(view.querySelector('[data-playhead]')).not.toBeNull();
  });
});

// Keep the handle type referenced for readers of this suite.
export type {AudioClipHandle};
