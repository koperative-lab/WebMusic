// @vitest-environment jsdom
import {afterEach, describe, expect, it, vi} from 'vitest';
import {createAudioClip} from '../../src/core';
import {createAudioClipEditor, type AudioClipEditor} from '../../src/edit/headless';
import {AudioViewElement} from '../../src/view/element/audio-view';

// Rendering is exercised by the waveform suites; this fixture isolates Element
// attachment ownership while keeping real editors, sessions and commands.
vi.mock('../../src/view/render/waveform', () => ({renderWaveformVisualizer: (host: HTMLElement) => {
  const surface = document.createElement('div'); host.append(surface);
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
  const value = document.createElement('lifecycle-audio-view') as AudioViewElement;
  value.editable = true; return value;
}
function declaration(value: AudioClipEditor): HTMLDivElement & {editor: AudioClipEditor} {
  const owner = Object.assign(document.createElement('div'), {editor: value});
  owner.id = 'document'; document.body.append(owner); return owner;
}
function publish(owner: HTMLDivElement & {editor: AudioClipEditor}, value: AudioClipEditor): void {
  owner.editor = value; owner.dispatchEvent(new CustomEvent('webmusic:sourcechange', {bubbles: true}));
}
function expectBound(element: AudioViewElement, target: AudioClipEditor): void {
  expect(element.editor).toBe(target);
  expect(element.interactionSession!.getSnapshot().documentId).toBe(target.getSnapshot().documentId);
  expect(element.querySelector('[part="editing-status"]')?.textContent).toContain(`of ${target.getSnapshot().content.length}`);
  expect(element.querySelectorAll('[part="editing-surface"]')).toHaveLength(1);
}
afterEach(() => {
  document.body.replaceChildren();
  for (const value of editors.splice(0)) value.dispose();
  vi.restoreAllMocks();
});

describe('Audio View editor attachment cleanup', () => {
  it.each(['source', 'presentation'])('preserves a newer binding during active draft cancellation from %s cleanup', trigger => {
    const added = vi.spyOn(window, 'addEventListener'), removed = vi.spyOn(window, 'removeEventListener');
    const a = editor(60), b = editor(64), c = editor(67), owner = declaration(a), element = view();
    element.setAttribute('editor', '#document'); document.body.append(element);
    const surface = element.querySelector('[part="editing-surface"]')!;
    const tool = element.querySelector<HTMLSelectElement>('[aria-label="Pointer tool"]')!; tool.value = 'trim';
    const pointer = (type: string, x: number): void => {
      const event = new MouseEvent(type, {bubbles: true, button: 0, clientX: x, clientY: 10});
      Object.defineProperty(event, 'pointerId', {value: 1}); surface.dispatchEvent(event);
    };
    pointer('pointerdown', 10); pointer('pointermove', 40);
    const session = element.interactionSession!; expect(session.getSnapshot().draft).toBeDefined();
    let armed = true;
    session.subscribe(state => { if (armed && !state.draft) { armed = false; element.editor = c; } });
    if (trigger === 'source') publish(owner, b); else element.setAttribute('wave-color', 'red');
    expectBound(element, c); element.remove();
    const snapshot = c.getSnapshot(), asset = snapshot.content.segments[0];
    expect(asset.kind).toBe('asset');
    if (asset.kind === 'asset') expect(snapshot.assets.getReferenceCount(asset.assetId)).toBe(1);
    const blurListeners = added.mock.calls.filter(([type]) => type === 'blur').map(([, listener]) => listener);
    expect(blurListeners.every(listener => removed.mock.calls.some(([type, removedListener]) => type === 'blur' && listener === removedListener))).toBe(true);
  });

  it('keeps a newer explicit binding requested by the old session disposal callback', () => {
    const a = editor(60), b = editor(64), c = editor(67), owner = declaration(a), element = view();
    element.setAttribute('editor', '#document'); document.body.append(element);
    element.interactionSession!.subscribe(state => { if (state.disposed) element.editor = c; });
    publish(owner, b);
    expectBound(element, c);
    element.interactionSession!.setSelection({startFrame: 0, endFrame: 1});
    element.querySelector('[part="editing-surface"]')!.dispatchEvent(new KeyboardEvent('keydown', {key: 'Delete', bubbles: true}));
    expect(c.getSnapshot().content.length).toBe(66);
    expect(b.getSnapshot().content.length).toBe(64);
  });

  it('keeps a nested selector-source replacement and continues observing later replacements', () => {
    const a = editor(60), b = editor(64), c = editor(67), d = editor(69), owner = declaration(a), element = view();
    element.setAttribute('editor', '#document'); document.body.append(element);
    element.interactionSession!.subscribe(state => { if (state.disposed) publish(owner, c); });
    publish(owner, b); expectBound(element, c);
    const session = element.interactionSession!;
    publish(owner, d); expectBound(element, d); expect(session.getSnapshot().disposed).toBe(true);
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
    const a = editor(60), b = editor(64), owner = declaration(a), element = view();
    element.setAttribute('editor', '#document'); document.body.append(element);
    element.interactionSession!.subscribe(state => { if (state.disposed) element.remove(); });
    const create = vi.spyOn(b, 'createInteractionSession');
    publish(owner, b);
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
