// @vitest-environment jsdom
import {afterEach, describe, expect, it, vi} from 'vitest';
import {Duration, NoteId, PartId, Pitch, Rational, ScoreBuilder, VoiceId} from '../../src/core';
import {createScoreEditor, type ScoreEditor} from '../../src/view/headless';
import {ScoreGridViewElement} from '../../src/view/element/score-grid-view';
import {ScoreViewElement} from '../../src/view/element/score-view';

// Editing attachments live on the grid; <score-view> shares the same base binding read-only.
customElements.define('lifecycle-score-grid-view', ScoreGridViewElement);
const editors: ScoreEditor[] = [];
const noteId = NoteId('note');
function editor(midi: number): ScoreEditor {
  const builder = new ScoreBuilder(); const part = PartId('piano');
  builder.addPart({id: part, name: 'Piano'});
  builder.addNote(part, {id: noteId, pitch: Pitch.fromMidi(midi), onsetQuarters: Rational.ZERO,
    duration: Duration.quarter(), voice: VoiceId('1')});
  const value = createScoreEditor(builder.build()); editors.push(value); return value;
}
function view(): ScoreGridViewElement {
  const value = document.createElement('lifecycle-score-grid-view') as ScoreGridViewElement;
  value.editable = true; return value;
}
function expectBound(element: ScoreGridViewElement, target: ScoreEditor): void {
  expect(element.editor).toBe(target);
  expect(element.interactionSession!.getSnapshot().documentId).toBe(target.getSnapshot().documentId);
  expect(element.querySelector('[data-note-id="note"]')?.getAttribute('aria-label')).toContain(target.score.getNote(noteId)!.pitch.toString());
  expect(element.querySelectorAll('[part="surface"]')).toHaveLength(1);
  expect(element.querySelector('[part="grid"]')!.getAttribute('data-edit-state')).toBe('ready');
}
afterEach(() => {
  document.body.replaceChildren();
  for (const value of editors.splice(0)) value.dispose();
  vi.restoreAllMocks();
});

describe('Score View editor attachment cleanup', () => {
  it.each(['source', 'presentation'])('preserves a newer binding during active draft cancellation from %s cleanup', trigger => {
    const added = vi.spyOn(window, 'addEventListener'), removed = vi.spyOn(window, 'removeEventListener');
    const a = editor(60), b = editor(64), c = editor(67), element = view();
    element.editor = a; document.body.append(element);
    const subscriptions: ReturnType<typeof vi.fn>[] = [];
    const subscribe = c.subscribeState.bind(c);
    vi.spyOn(c, 'subscribeState').mockImplementation(listener => {
      const unsubscribe = vi.fn(subscribe(listener)); subscriptions.push(unsubscribe); return unsubscribe;
    });
    const surface = element.querySelector('[part="surface"]')!;
    const pointer = (target: Element, type: string, x: number): void => {
      const event = new MouseEvent(type, {bubbles: true, button: 0, buttons: 1, clientX: x, clientY: 414}); // MIDI 60's row
      Object.defineProperty(event, 'pointerId', {value: 1}); target.dispatchEvent(event);
    };
    pointer(element.querySelector('[data-note-id="note"]')!, 'pointerdown', 58);
    pointer(surface, 'pointermove', 78);
    const session = element.interactionSession!; expect(session.getSnapshot().draft).toBeDefined();
    let armed = true;
    session.subscribe(state => { if (armed && !state.draft) { armed = false; element.editor = c; } });
    if (trigger === 'source') element.editor = b; else element.setAttribute('note-color', '#123456'); // remounts the grid presentation
    expectBound(element, c);
    element.remove(); expect(subscriptions.length).toBeGreaterThan(0);
    expect(subscriptions.every(unsubscribe => unsubscribe.mock.calls.length === 1)).toBe(true);
    const blurListeners = added.mock.calls.filter(([type]) => type === 'blur').map(([, listener]) => listener);
    expect(blurListeners.every(listener => removed.mock.calls.some(([type, removedListener]) => type === 'blur' && listener === removedListener))).toBe(true);
  });

  it('keeps a newer explicit binding requested by the old session disposal callback', () => {
    const a = editor(60), b = editor(64), c = editor(67), element = view();
    element.editor = a; document.body.append(element);
    element.interactionSession!.subscribe(state => { if (state.disposed) element.editor = c; });
    element.editor = b;
    expectBound(element, c);
    element.interactionSession!.setSelection([noteId]);
    element.querySelector('[part="surface"]')!.dispatchEvent(new KeyboardEvent('keydown', {key: 'ArrowUp', bubbles: true}));
    expect(c.score.getNote(noteId)!.pitch.midi).toBe(68);
    expect(b.score.getNote(noteId)!.pitch.midi).toBe(64);
  });

  it('releases every intermediate owned session after reentrant direct property replacement', () => {
    const a = editor(60), b = editor(64), c = editor(67), element = view();
    const made: ReturnType<ScoreEditor['createInteractionSession']>[] = [];
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
    const made: ReturnType<ScoreEditor['createInteractionSession']>[] = [];
    vi.spyOn(b, 'createInteractionSession').mockImplementation(() => { const session = create(); made.push(session); return session; });
    const subscribe = b.subscribeState.bind(b);
    vi.spyOn(b, 'subscribeState').mockImplementation(listener => { element.editor = c; return subscribe(listener); });
    element.editor = a; document.body.append(element); element.editor = b;
    expectBound(element, c); expect(made).toHaveLength(1); expect(made[0].getSnapshot().disposed).toBe(true);
  });
});

describe('read-only Score View editor attachment cleanup', () => {
  customElements.define('lifecycle-score-view', ScoreViewElement);
  const readOnly = (): ScoreViewElement => document.createElement('lifecycle-score-view') as ScoreViewElement;
  function expectDrawn(element: ScoreViewElement, target: ScoreEditor): void {
    expect(element.editor).toBe(target);
    expect(element.interactionSession!.getSnapshot().documentId).toBe(target.getSnapshot().documentId);
    expect([...element.querySelectorAll<SVGElement>('rect.note')].map((note) => Number(note.dataset.pitch)))
      .toEqual([target.score.getNote(noteId)!.pitch.midi]);
  }

  it('keeps a newer explicit binding requested by the old session disposal callback', () => {
    const a = editor(60), b = editor(64), c = editor(67), element = readOnly();
    element.editor = a; document.body.append(element);
    element.interactionSession!.subscribe(state => { if (state.disposed) element.editor = c; });
    element.editor = b;
    expectDrawn(element, c);
    element.remove(); expect(c.getSnapshot().status).toBe('ready');
  });

  it('preserves a fresh connected lifetime created while the old owned session is disposed', () => {
    const model = editor(60), element = readOnly(); element.editor = model; document.body.append(element);
    const old = element.interactionSession!;
    old.subscribe(state => { if (state.disposed) document.body.append(element); });
    element.remove();
    expect(element.isConnected).toBe(true); expectDrawn(element, model);
    expect(element.interactionSession).not.toBe(old); expect(element.interactionSession!.getSnapshot().disposed).toBe(false);
  });

  it('does not adopt a source if old-session cleanup disconnects the view', () => {
    const a = editor(60), b = editor(64), element = readOnly();
    element.editor = a; document.body.append(element);
    element.interactionSession!.subscribe(state => { if (state.disposed) element.remove(); });
    const create = vi.spyOn(b, 'createInteractionSession');
    element.editor = b;
    expect(element.isConnected).toBe(false); expect(element.interactionSession).toBeUndefined();
    expect(create).not.toHaveBeenCalled();
  });
});
