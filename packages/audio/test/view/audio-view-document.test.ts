// @vitest-environment jsdom
import {afterEach, beforeAll, beforeEach, describe, expect, it, vi} from 'vitest';
import {createAudioClip, createRegion, type AudioDocumentPlaybackBinding, type AudioPeaks} from '../../src/core';
import {createAudioClipEditor} from '../../src/view/headless';
import type {AudioViewport, AudioWaveformSource, WaveformRenderOptions} from '../../src/view/core/types';

const spies = vi.hoisted(() => ({render: vi.fn()}));
vi.mock('../../src/view/render/waveform', () => ({renderWaveformVisualizer: spies.render}));
import {AudioViewElement, defineAudioViewElement} from '../../src/view/element/audio-view';

const cleanups: (() => void)[] = [];
beforeAll(() => defineAudioViewElement('document-audio-view'));
beforeEach(() => {
  spies.render.mockImplementation((host: HTMLElement, source: AudioPeaks | AudioWaveformSource, options: WaveformRenderOptions) => {
    const node = document.createElement('div'); node.dataset.wave = String(options.durationSeconds ?? ''); host.append(node);
    let start = 0;
    const listeners = new Set<(value: AudioViewport) => void>();
    const viewport = () => ({startSeconds: start, endSeconds: start + 4});
    return {source, redraw: vi.fn(), redrawFrame: vi.fn(), setPlayheadMode: vi.fn(), setPlayheadVisible: vi.fn(),
      setZoom: vi.fn(), setOffset(value: number) { start = value; for (const listener of listeners) listener(viewport()); },
      setRegions: vi.fn(), viewport, hitTest: (x: number) => ({seconds: start + x / 100}),
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
const view = () => document.createElement('document-audio-view') as AudioViewElement;
const wave = (element: Element) => element.querySelector<HTMLElement>('[data-wave]');
function key(target: HTMLElement, value: string, options: KeyboardEventInit = {}) { target.dispatchEvent(new KeyboardEvent('keydown', {key: value, bubbles: true, cancelable: true, ...options})); }
async function tick() { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); }

describe('Audio View as a read-only document follower', () => {
  it('has no editing contract and draws the editor content without edit chrome', () => {
    expect(AudioViewElement.observedAttributes).not.toContain('editable');
    const element = view(); element.setAttribute('editable', ''); element.editor = editor(); document.body.append(element);
    expect(wave(element)!.dataset.wave).toBe('10');
    expect(element.querySelector('button, input, select, details')).toBeNull();
    expect(element.hasAttribute('data-editable-state')).toBe(false);
    expect(element.interactionSession).toBeDefined();
  });

  it('redraws after an edit, undo or shared draft, but not for a selection-only change', () => {
    const model = editor(), element = view(); element.editor = model; document.body.append(element);
    const before = spies.render.mock.calls.length;
    element.interactionSession!.setSelection({startFrame: 10, endFrame: 20});
    expect(spies.render.mock.calls.length).toBe(before);
    model.execute({version: 1, documentId: model.getSnapshot().documentId, expectedRevision: 0, label: 'Trim', operations: [{type: 'trim', startFrame: 0, endFrame: 500}]});
    expect(wave(element)!.dataset.wave).toBe('5');
    element.interactionSession!.preview([{type: 'trim', startFrame: 0, endFrame: 200}]);
    expect(wave(element)!.dataset.wave).toBe('2');
    element.interactionSession!.cancelDraft();
    model.undo();
    expect(wave(element)!.dataset.wave).toBe('10');
  });

  it('reports independent source conflicts including empty attributes', () => {
    const element = view(), model = editor(); element.editor = model; document.body.append(element);
    expect(element.getAttribute('data-editor-state')).toBe('ready');
    element.setAttribute('src', ''); expect(element.getAttribute('data-editor-state')).toBe('source-conflict'); expect(wave(element)).toBeNull();
    element.removeAttribute('src'); expect(wave(element)).not.toBeNull();
    element.setAttribute('peaks-src', ''); expect(element.getAttribute('data-editor-state')).toBe('source-conflict');
    element.removeAttribute('peaks-src'); expect(element.getAttribute('data-editor-state')).toBe('ready');
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
    const model = editor(), element = view(); element.editor = model; document.body.append(element);
    const session = element.interactionSession!, drawing = wave(element);
    session.setSelection({startFrame: 10, endFrame: 20});
    expect(() => assignSource(element, name, independentSources[name]())).toThrow(/source-conflict/);
    expect(element[name]).toBeUndefined(); expect(element.editor).toBe(model); expect(element.interactionSession).toBe(session);
    expect(session.getSnapshot()).toMatchObject({disposed: false, selection: {startFrame: 10, endFrame: 20}});
    expect(wave(element)).toBe(drawing);
  });

  it.each(Object.keys(independentSources) as Array<keyof typeof independentSources>)('rejects .editor before replacing independent .%s', (name) => {
    const model = editor(), element = view(), source = independentSources[name](); assignSource(element, name, source); document.body.append(element);
    expect(() => {element.editor = model;}).toThrow(/source-conflict/);
    expect(element[name]).toBe(source); expect(element.editor).toBeUndefined();
    assignSource(element, name, undefined); element.editor = model; expect(element.getAttribute('data-editor-state')).toBe('ready');
  });

  it('rejects invalid editor and mismatched session replacements without releasing a ready binding', () => {
    const model = editor(), other = editor(), element = view();
    const shared = model.createInteractionSession(), foreign = other.createInteractionSession();
    cleanups.push(() => {shared.dispose(); foreign.dispose();});
    element.editor = model; element.interactionSession = shared; document.body.append(element);
    expect(() => {element.editor = {} as typeof model;}).toThrow(/AudioClipEditorPort/);
    expect(() => {element.editor = other;}).toThrow(/another document/);
    expect(() => {element.interactionSession = foreign;}).toThrow(/another document/);
    expect(element.editor).toBe(model); expect(element.interactionSession).toBe(shared); expect(shared.getSnapshot().disposed).toBe(false);
  });

  it('takes editors only through the property', () => {
    expect(AudioViewElement.observedAttributes).not.toContain('editor');
    const first = editor(), element = view(); element.setAttribute('editor', '#document'); document.body.append(element);
    expect(element.editor).toBeUndefined();
    element.editor = first; expect(element.getAttribute('data-editor-state')).toBe('ready');
    element.editor = undefined; expect(element.hasAttribute('data-editor-state')).toBe(false);
    expect(first.getSnapshot().status).toBe('ready');
  });

  it('leaves a shared session, its draft and the editor alive after disconnect', () => {
    const model = editor(), session = model.createInteractionSession(); const a = view(), b = view();
    a.editor = model; b.editor = model; a.interactionSession = session; b.interactionSession = session;
    document.body.append(a, b);
    session.preview([{type: 'trim', startFrame: 10, endFrame: 20}]); const draft = session.getSnapshot().draft;
    a.remove(); expect(session.getSnapshot().disposed).toBe(false); expect(session.getSnapshot().draft).toBe(draft);
    expect(model.getSnapshot().status).toBe('ready'); b.remove(); session.dispose();
  });

  it('releases the drawing when an application-owned editor is disposed', () => {
    const model = editor(), element = view(); element.editor = model; document.body.append(element);
    model.dispose();
    expect(element.textContent).toContain('Audio editor unavailable');
    expect(wave(element)).toBeNull();
  });

  it('keeps region annotation working beside a borrowed editor', () => {
    const element = view(), model = editor(); element.editor = model; element.annotate = true;
    element.regions = [createRegion({startSeconds: 1, endSeconds: 2, label: 'Cue'})]; document.body.append(element);
    expect(element.regions).toHaveLength(1); expect(model.getSnapshot().documentRevision).toBe(0);
  });

  it('reports clip-only types unavailable for a document, while a passive explicit clip remains usable', () => {
    const element = view(), model = editor(); element.editor = model; element.type = 'spectrogram'; document.body.append(element);
    expect(element.textContent).toContain('Sequence documents support waveform');
    // One short visible line; the explanation is announced but visually hidden.
    expect(element.querySelector('.wui-status__message')?.textContent).toBe('Waveform only');
    const detail = element.querySelector<HTMLElement>('[data-status-detail]')!;
    expect(detail.closest('[role="status"]')).not.toBeNull();
    expect(detail.style.position).toBe('absolute');
    expect(detail.style.width).toBe('1px');
    element.type = 'waveform'; element.editor = undefined;
    element.clip = createAudioClip({sampleRate: 100, channelData: [new Float32Array(10)]});
    expect(wave(element)).not.toBeNull();
  });

  it('gates seeking until exact applied revision readiness', () => {
    const model = editor(), snapshot = model.getSnapshot();
    const player = document.createElement('div') as unknown as HTMLElement & {seconds: number; duration: number; playing: boolean; seek: ReturnType<typeof vi.fn>; documentBinding: AudioDocumentPlaybackBinding};
    player.id = 'edit-player'; player.seconds = 2; player.duration = 10; player.playing = false; player.seek = vi.fn();
    player.documentBinding = {status: 'preparing', attempt: 1, documentCoordinates: true, applied: {documentId: snapshot.documentId, documentRevision: 0}};
    const element = view(); element.editor = model; element.interactive = true; element.setAttribute('input', '#edit-player'); document.body.append(player, element);
    key(element, 'ArrowRight'); expect(player.seek).not.toHaveBeenCalled(); expect(element.getAttribute('data-playback-state')).toBe('pending');
    player.documentBinding = {...player.documentBinding, status: 'ready'}; player.dispatchEvent(new CustomEvent('webaudio:documentstatechange'));
    key(element, 'ArrowRight'); expect(player.seek).toHaveBeenCalled(); expect(element.getAttribute('data-playback-state')).toBe('ready');
  });

  it('discovers a late player and drops its overlay on removal or ambiguity', async () => {
    const model = editor(), snapshot = model.getSnapshot(), element = view();
    element.editor = model; element.setAttribute('input', '#late-player'); document.body.append(element);
    expect(element.getAttribute('data-playback-state')).toBe('unbound');
    const player = document.createElement('div') as unknown as HTMLElement & {documentBinding: AudioDocumentPlaybackBinding};
    player.id = 'late-player'; player.documentBinding = {status: 'ready', attempt: 1, documentCoordinates: true, applied: {documentId: snapshot.documentId, documentRevision: 0}};
    document.body.append(player); await tick(); expect(element.getAttribute('data-playback-state')).toBe('ready');
    const duplicate = document.createElement('div'); duplicate.id = 'late-player'; document.body.append(duplicate); await tick();
    expect(element.getAttribute('data-playback-state')).toBe('unbound');
    player.remove(); duplicate.remove(); await tick(); expect(element.getAttribute('data-playback-state')).toBe('unbound');
  });

  it('removes document playback state with the editor binding', () => {
    const model = editor(), element = view(); element.editor = model; document.body.append(element);
    expect(element.getAttribute('data-playback-state')).toBe('unbound');
    element.editor = undefined;
    expect(element.hasAttribute('data-playback-state')).toBe(false); expect(element.hasAttribute('data-editor-state')).toBe(false);
  });
});
