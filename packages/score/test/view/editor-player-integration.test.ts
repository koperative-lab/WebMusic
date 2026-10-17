// @vitest-environment jsdom
import {afterEach, describe, expect, it, vi} from 'vitest';
import {Duration, NoteId, Pitch, Rational, ScoreBuilder} from '../../src/core';
import {createScoreEditor, type ScoreEditor} from '../../src/edit/headless';
import {ScorePlayerElement} from '../../src/play/element/score-player';
import {ScoreViewElement} from '../../src/view/element/score-view';

customElements.define('integration-score-player', ScorePlayerElement);
customElements.define('integration-score-view', ScoreViewElement);
const editors: ScoreEditor[] = [];
const noteId = NoteId('editable-note');
function music() {
  const builder = new ScoreBuilder();
  const part = builder.addPart({id: builder.newPartId(), name: 'Piano'});
  builder.addNote(part, {id: noteId, pitch: Pitch.fromMidi(60), onsetQuarters: Rational.ONE,
    duration: new Duration({base: [4, 1]}), voice: builder.newVoiceId()});
  return builder.build();
}
afterEach(() => {
  document.body.replaceChildren();
  for (const editor of editors.splice(0)) editor.dispose();
  vi.restoreAllMocks();
});

describe('editor, native Player and piano-roll integration', () => {
  it.each(['assign', 'replace', 'clear'] as const)('retains paused playback when interactionSession is %s', async change => {
    const editor = createScoreEditor(music()); editors.push(editor);
    const player = document.createElement('integration-score-player') as ScorePlayerElement;
    player.id = 'audition'; player.editor = editor;
    const view = document.createElement('integration-score-view') as ScoreViewElement;
    view.editor = editor; view.editable = true; view.setAttribute('player', '#audition');
    const supplied = editor.createInteractionSession();
    if (change !== 'assign') view.interactionSession = supplied;
    document.body.append(player, view);
    expect((await player.waitForDocumentRevision(editor.getSnapshot())).status).toBe('applied');
    await player.seekNominal(1);
    expect(view.currentTime).toBe(1);
    expect(view.querySelector('[data-playhead]')).not.toBeNull();
    const old = view.interactionSession!;
    const next = change === 'clear' ? undefined : editor.createInteractionSession();
    view.interactionSession = next;
    await new Promise(resolve => setTimeout(resolve, 0));
    expect({viewTime: view.currentTime, playerTime: player.playback.snapshot().nominalSeconds,
      playhead: Boolean(view.querySelector('[data-playhead]')),
      renderedPlayback: view.querySelector('[part="editor"]')?.getAttribute('data-playback-state')})
      .toEqual({viewTime: 1, playerTime: 1, playhead: true, renderedPlayback: 'ready'});
    expect(view.getAttribute('data-playback-state')).toBe('ready');
    expect(view.interactionSession).not.toBe(old);
    if (next) expect(view.interactionSession).toBe(next);
    expect(old.getSnapshot().disposed).toBe(change === 'assign');
    expect(supplied.getSnapshot().disposed).toBe(false);
    // The replacement keeps following the same player after its initial snapshot.
    await player.seekNominal(0.75);
    expect(view.currentTime).toBe(0.75);
  });

  it.each(['assign', 'replace', 'clear'] as const)('keeps a player-free view usable when interactionSession is %s', change => {
    const editor = createScoreEditor(music()); editors.push(editor);
    const view = document.createElement('integration-score-view') as ScoreViewElement;
    view.editor = editor; view.editable = true;
    const supplied = editor.createInteractionSession();
    if (change !== 'assign') view.interactionSession = supplied;
    document.body.append(view);
    const next = change === 'clear' ? undefined : editor.createInteractionSession();
    view.interactionSession = next;
    const session = view.interactionSession!;
    session.setSelection([noteId]);
    expect(view.getAttribute('data-editable-state')).toBe('ready');
    expect(view.currentTime).toBe(0);
    expect(view.querySelector('[data-playhead]')).toBeNull();
    expect(view.querySelector('[part="editor"]')?.getAttribute('data-playback-state')).toBe('unbound');
    expect(session.getSnapshot().selectedNoteIds).toEqual([noteId]);
    view.remove();
    expect(session.getSnapshot().disposed).toBe(change === 'clear');
    expect(supplied.getSnapshot().disposed).toBe(false);
  });

  it('preserves a newer interaction session requested while disposing the old owned session', async () => {
    const editor = createScoreEditor(music()); editors.push(editor);
    const player = document.createElement('integration-score-player') as ScorePlayerElement;
    player.id = 'audition'; player.editor = editor;
    const view = document.createElement('integration-score-view') as ScoreViewElement;
    view.editor = editor; view.editable = true; view.setAttribute('player', '#audition');
    document.body.append(player, view);
    await player.waitForDocumentRevision(editor.getSnapshot()); await player.seekNominal(1);
    const latest = editor.createInteractionSession(); latest.setSelection([noteId]);
    view.interactionSession!.subscribe(state => { if (state.disposed) view.interactionSession = latest; });
    view.interactionSession = editor.createInteractionSession();
    expect(view.interactionSession).toBe(latest);
    expect(view.interactionSession!.getSnapshot().selectedNoteIds).toEqual([noteId]);
    expect(view.currentTime).toBe(1);
    expect(view.querySelector('[data-playhead]')).not.toBeNull();
  });

  it('does not reattach playback when old-session disposal disconnects the view', async () => {
    const editor = createScoreEditor(music()); editors.push(editor);
    const player = document.createElement('integration-score-player') as ScorePlayerElement;
    player.id = 'audition'; player.editor = editor;
    const view = document.createElement('integration-score-view') as ScoreViewElement;
    view.editor = editor; view.editable = true; view.setAttribute('player', '#audition');
    document.body.append(player, view);
    await player.waitForDocumentRevision(editor.getSnapshot()); await player.seekNominal(1);
    const subscribe = vi.spyOn(player.playback, 'subscribe');
    view.interactionSession!.subscribe(state => { if (state.disposed) view.remove(); });
    const supplied = editor.createInteractionSession();
    view.interactionSession = supplied;
    expect(view.isConnected).toBe(false);
    expect(subscribe).not.toHaveBeenCalled();
    expect(supplied.getSnapshot().disposed).toBe(false);
    expect(view.querySelector('[part="editing-surface"]')).toBeNull();
  });

  it('gates stale overlays during a keyboard commit, then restores the applied transport and undo', async () => {
    const editor = createScoreEditor(music()); editors.push(editor);
    const player = document.createElement('integration-score-player') as ScorePlayerElement;
    player.id = 'audition'; player.editor = editor;
    const view = document.createElement('integration-score-view') as ScoreViewElement;
    view.editor = editor; view.editable = true; view.setAttribute('player', '#audition');
    document.body.append(player, view);
    expect((await player.waitForDocumentRevision(editor.getSnapshot())).status).toBe('applied');
    const source = player.playback;
    const session = view.interactionSession!;
    await player.seekNominal(1);
    expect(view.querySelector('[data-playhead]')).toBeTruthy();
    expect(view.currentTime).toBe(1);
    session.setSelection([noteId]);
    view.querySelector('[part="editing-surface"]')!.dispatchEvent(new KeyboardEvent('keydown', {key: 'ArrowRight', bubbles: true}));
    expect(editor.getSnapshot().documentRevision).toBe(1);
    expect(player.documentBinding!.status).toBe('preparing');
    expect(view.querySelector('[data-playhead]')).toBeNull();
    await expect(player.play()).rejects.toMatchObject({code: 'not-ready'});
    expect((await player.waitForDocumentRevision(editor.getSnapshot())).status).toBe('applied');
    expect(view.score).toBe(editor.score);
    expect(view.querySelector('[data-playhead]')).toBeTruthy();
    expect(view.currentTime).toBe(1);
    expect(view.interactionSession).toBe(session);
    expect(player.playback).toBe(source);
    view.querySelector('[part="editing-surface"]')!.dispatchEvent(new KeyboardEvent('keydown', {key: 'z', ctrlKey: true, bubbles: true}));
    expect((await player.waitForDocumentRevision(editor.getSnapshot())).status).toBe('applied');
    expect(editor.score.getNote(noteId)!.onsetQuarters.toJSON()).toEqual([1, 1]);
    expect(view.querySelector('[data-playhead]')).toBeTruthy();
    expect(player.resolvedScore).toBe(editor.score);
  });

  it('keeps an empty editor selector in document mode without falling back to the player', async () => {
    const editor = createScoreEditor(music()); editors.push(editor);
    const player = document.createElement('integration-score-player') as ScorePlayerElement;
    player.id = 'audition'; player.editor = editor; document.body.append(player);
    await player.waitForDocumentRevision(editor.getSnapshot());
    const view = document.createElement('integration-score-view') as ScoreViewElement;
    view.setAttribute('editor', ''); view.setAttribute('player', '#audition'); view.editable = true;
    expect(() => { view.score = music(); }).toThrow('source-conflict');
    document.body.append(view);
    for (let index = 0; index < 10; index++) await Promise.resolve();
    expect(view.getAttribute('data-editor-state')).toBe('missing');
    expect(view.getAttribute('data-editable-state')).toBe('unavailable');
    expect(view.score).toBeUndefined();
    expect(view.querySelector('[part="editing-surface"]')).toBeNull();
  });

  it('rejects an empty src attribute alongside a document, with attribute conflict recovery', () => {
    const editor = createScoreEditor(music()); editors.push(editor);
    const view = document.createElement('integration-score-view') as ScoreViewElement;
    view.setAttribute('src', '');
    expect(() => { view.editor = editor; }).toThrow('source-conflict');
    expect(view.editor).toBeUndefined();
    view.removeAttribute('src'); view.editor = editor; view.editable = true; document.body.append(view);
    view.setAttribute('src', '');
    expect(view.getAttribute('data-editor-state')).toBe('source-conflict');
    expect(view.querySelector('[part="editing-surface"]')).toBeNull();
    view.removeAttribute('src');
    expect(view.getAttribute('data-editor-state')).toBe('ready');
    expect(view.querySelector('[part="editing-surface"]')).toBeTruthy();
  });
});
