// @vitest-environment jsdom
import {afterEach, describe, expect, it, vi} from 'vitest';
import {createAudioClip} from '../../src/core';
import {createAudioClipEditor, type AudioClipEditor} from '../../src/view/headless';
import {AudioViewElement} from '../../src/view/element/audio-view';

// Rendering is exercised by the waveform suites; this fixture isolates Element
// attachment ownership while keeping real editors, sessions and commands.
vi.mock('../../src/view/render/waveform', () => ({renderWaveformVisualizer: (host: HTMLElement, _source: unknown, options: {durationSeconds?: number}) => {
  const surface = document.createElement('div'); surface.dataset.testWaveform = String(options.durationSeconds); host.append(surface);
  return {redraw() {}, redrawFrame() {}, setPlayheadMode() {}, setPlayheadVisible() {}, setZoom() {}, setOffset() {},
    setRegions() {}, viewport: () => ({startSeconds: 0, endSeconds: 1}), hitTest: (x: number) => ({seconds: x / 8000}),
    onViewportChange: () => () => {}, dispose: () => surface.remove()};
}}));
customElements.define('lifecycle-audio-view', AudioViewElement);
const editors: AudioClipEditor[] = [];
function editor(length: number): AudioClipEditor {
  const value = createAudioClipEditor(createAudioClip({sampleRate: 8000, channelData: [new Float32Array(length)]}));
  editors.push(value); return value;
}
function view(): AudioViewElement {
  return document.createElement('lifecycle-audio-view') as AudioViewElement;
}
/** The read-only view follows exactly one editor: its session, and one drawing of its content. */
function expectBound(element: AudioViewElement, target: AudioClipEditor): void {
  expect(element.editor).toBe(target);
  expect(element.interactionSession!.getSnapshot().documentId).toBe(target.getSnapshot().documentId);
  const drawings = element.querySelectorAll<HTMLElement>('[data-test-waveform]');
  expect(drawings).toHaveLength(1);
  expect(Number(drawings[0].dataset.testWaveform)).toBeCloseTo(target.getSnapshot().content.length / 8000, 6);
}
afterEach(() => {
  document.body.replaceChildren();
  for (const value of editors.splice(0)) value.dispose();
  vi.restoreAllMocks();
});

describe('Audio View editor attachment cleanup', () => {
  it('keeps following its editor and a shared draft when its presentation is rebuilt', () => {
    const a = editor(60), element = view();
    element.editor = a; document.body.append(element);
    const session = element.interactionSession!;
    expect(session.preview([{type: 'trim', startFrame: 0, endFrame: 20}]).status).toBe('preview');
    element.setAttribute('wave-color', 'red');
    expect(element.editor).toBe(a);
    expect(session.getSnapshot().draft).toBeDefined();
    expect(element.querySelector<HTMLElement>('[data-test-waveform]')!.dataset.testWaveform).toBe(String(20 / 8000));
  });

  it.each(['source'])('preserves a newer binding during active draft cancellation from %s cleanup', trigger => {
    const added = vi.spyOn(window, 'addEventListener'), removed = vi.spyOn(window, 'removeEventListener');
    const a = editor(60), b = editor(64), c = editor(67), element = view();
    element.editor = a; document.body.append(element);
    // A shared draft is drawn by the read-only view; replacing the editor disposes its session and draft.
    const session = element.interactionSession!;
    expect(session.preview([{type: 'trim', startFrame: 10, endFrame: 40}]).status).toBe('preview');
    expect(element.querySelector<HTMLElement>('[data-test-waveform]')!.dataset.testWaveform).toBe(String(30 / 8000));
    let armed = true;
    session.subscribe(state => { if (armed && !state.draft) { armed = false; element.editor = c; } });
    if (trigger === 'source') element.editor = b; else element.setAttribute('wave-color', 'red');
    expectBound(element, c); element.remove();
    const snapshot = c.getSnapshot(), asset = snapshot.content.segments[0];
    expect(asset.kind).toBe('asset');
    if (asset.kind === 'asset') expect(snapshot.assets.getReferenceCount(asset.assetId)).toBe(1);
    const blurListeners = added.mock.calls.filter(([type]) => type === 'blur').map(([, listener]) => listener);
    expect(blurListeners.every(listener => removed.mock.calls.some(([type, removedListener]) => type === 'blur' && listener === removedListener))).toBe(true);
  });

  it('keeps a newer explicit binding requested by the old session disposal callback', () => {
    const a = editor(60), b = editor(64), c = editor(67), element = view();
    element.editor = a; document.body.append(element);
    element.interactionSession!.subscribe(state => { if (state.disposed) element.editor = c; });
    element.editor = b;
    expectBound(element, c);
    // The view follows edits made elsewhere to the editor it settled on.
    c.execute({version: 1, documentId: c.getSnapshot().documentId, expectedRevision: 0, label: 'Trim',
      operations: [{type: 'trim', startFrame: 0, endFrame: 66}]});
    expectBound(element, c);
    expect(b.getSnapshot().content.length).toBe(64);
  });

  it('releases every intermediate owned session after reentrant direct property replacement', () => {
    const a = editor(60), b = editor(64), c = editor(67), element = view();
    const made: ReturnType<AudioClipEditor['createInteractionSession']>[] = [];
    const create = c.createInteractionSession.bind(c);
    vi.spyOn(c, 'createInteractionSession').mockImplementation(() => { const session = create(); made.push(session); return session; });
    element.editor = a; document.body.append(element);
    element.interactionSession!.subscribe(state => { if (state.disposed) element.editor = c; });
    element.editor = b; expectBound(element, c);
    element.remove();
    expect(made.length).toBeGreaterThan(0);
    expect(made.every(session => session.getSnapshot().disposed)).toBe(true);
    expect(c.getSnapshot().status).toBe('ready');
  });

  it('does not adopt a source if old-session cleanup disconnects the view', () => {
    const a = editor(60), b = editor(64), element = view();
    element.editor = a; document.body.append(element);
    element.interactionSession!.subscribe(state => { if (state.disposed) element.remove(); });
    const create = vi.spyOn(b, 'createInteractionSession');
    element.editor = b;
    expect(element.isConnected).toBe(false); expect(element.interactionSession).toBeUndefined();
    expect(create).not.toHaveBeenCalled(); expect(b.getSnapshot().status).toBe('ready');
  });

  it('preserves a fresh connected lifetime created while the old owned session is disposed', () => {
    const model = editor(60), element = view(); element.editor = model; document.body.append(element);
    const old = element.interactionSession!;
    old.subscribe(state => { if (state.disposed) document.body.append(element); });
    element.remove();
    expect(element.isConnected).toBe(true); expectBound(element, model);
    expect(element.interactionSession).not.toBe(old); expect(element.interactionSession!.getSnapshot().disposed).toBe(false);
  });

  it('releases a candidate whose initial source subscription requests a newer editor', () => {
    const a = editor(60), b = editor(64), c = editor(67), element = view();
    const create = b.createInteractionSession.bind(b);
    const made: ReturnType<AudioClipEditor['createInteractionSession']>[] = [];
    vi.spyOn(b, 'createInteractionSession').mockImplementation(() => { const session = create(); made.push(session); return session; });
    const subscribe = b.subscribeState.bind(b);
    vi.spyOn(b, 'subscribeState').mockImplementation(listener => { element.editor = c; return subscribe(listener); });
    element.editor = a; document.body.append(element); element.editor = b;
    expectBound(element, c); expect(made).toHaveLength(1); expect(made[0].getSnapshot().disposed).toBe(true);
  });
});
