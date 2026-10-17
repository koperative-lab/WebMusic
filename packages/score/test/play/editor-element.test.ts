// @vitest-environment jsdom
import {afterEach, beforeAll, describe, expect, it} from 'vitest';
import {Duration, NoteId, Pitch, Rational, ScoreBuilder, type Score, type ScoreDocumentPlaybackBinding} from '../../src/core';
import {createScoreEditor, type ScoreEditor} from '../../src/edit/headless';
import {defineScoreDocumentElement, type ScoreDocumentElement} from '../../src/edit/element';
import {ScorePlayerElement} from '../../src/play/element/score-player';
import type {PresetPlayerHandle, PresetPlayerOptions} from '../../src/play/element/internal/preset-player';
import type {ScorePlayer} from '../../src/play/headless/score-player';

class InspectablePlayer extends ScorePlayerElement {
  readonly engines: ScorePlayer[] = [];
  protected override mountScore(score: Score, options: PresetPlayerOptions): PresetPlayerHandle {
    const handle = super.mountScore(score, options);
    this.engines.push(handle.player!);
    return handle;
  }
}
const editors: ScoreEditor[] = [];
const flush = async () => { for (let index = 0; index < 20; index++) await Promise.resolve(); };
const noteId = NoteId('note');
function music(pitch = 'C4'): Score {
  const builder = new ScoreBuilder();
  const part = builder.addPart({id: builder.newPartId(), name: 'Piano'});
  builder.addNote(part, {id: noteId, pitch: Pitch.parse(pitch), onsetQuarters: Rational.ZERO,
    duration: Duration.quarter(), voice: builder.newVoiceId()});
  return builder.build();
}
function editor(pitch = 'C4'): ScoreEditor {
  const value = createScoreEditor(music(pitch)); editors.push(value); return value;
}
function player(source?: ScoreEditor): InspectablePlayer {
  const element = document.createElement('test-editor-player') as InspectablePlayer;
  if (source) element.editor = source;
  document.body.append(element);
  return element;
}
beforeAll(() => {
  customElements.define('test-editor-player', InspectablePlayer);
  defineScoreDocumentElement();
});
afterEach(() => {
  document.body.replaceChildren();
  for (const value of editors.splice(0)) value.dispose();
});

describe('Score Player Element editor binding', () => {
  it('applies edits and undo through the same native player, publisher and clock', async () => {
    const source = editor();
    const element = player(source);
    expect((await element.waitForDocumentRevision(source.getSnapshot())).status).toBe('applied');
    const engine = element.engines[0];
    const clock = engine.clock;
    const playback = element.playback;
    source.transaction('Move', (tx) => tx.add({type: 'move-notes', noteIds: [noteId], deltaQuarters: [1, 1]}));
    await expect(element.play()).rejects.toThrow('ready');
    expect((await element.waitForDocumentRevision(source.getSnapshot())).status).toBe('applied');
    expect(element.resolvedScore).toBe(source.score);
    expect(element.playback.snapshot()).toMatchObject({documentId: source.getSnapshot().documentId,
      documentRevision: 1, readiness: 'ready', documentBinding: {documentCoordinates: true}});
    expect(element.engines).toEqual([engine]);
    expect(engine.clock).toBe(clock);
    expect(element.playback).toBe(playback);
    source.undo();
    expect((await element.waitForDocumentRevision(source.getSnapshot())).status).toBe('applied');
    expect(element.resolvedScore!.getNote(noteId)!.onsetQuarters.toFloat()).toBe(0);
    expect(element.playback.snapshot().documentRevision).toBe(2);
    element.remove();
    expect(source.getSnapshot().status).toBe('ready');
  });

  it('rejects programmatic source conflicts atomically and recovers attribute conflicts in place', async () => {
    const source = editor();
    const element = player(source);
    await element.waitForDocumentRevision(source.getSnapshot());
    const engine = element.engines[0];
    expect(() => { element.score = music('D4'); }).toThrow('cannot be combined');
    expect(element.score).toBeUndefined();
    expect(element.editor).toBe(source);
    element.setAttribute('src', '/ignored.mid');
    expect(element.getAttribute('data-editor-state')).toBe('source-conflict');
    expect(element.playback.snapshot().readiness).toBe('error');
    expect(element.querySelector<HTMLButtonElement>('button')!.disabled).toBe(true);
    await expect(element.play()).rejects.toMatchObject({code: 'source-conflict'});
    element.removeAttribute('src');
    await flush();
    expect(element.getAttribute('data-editor-state')).toBe('ready');
    expect(element.engines).toEqual([engine]);
    expect(element.querySelector<HTMLButtonElement>('button')!.disabled).toBe(false);
    await element.seekNominal(0.25);
    expect(element.playback.snapshot().nominalSeconds).toBe(0.25);
  });

  it('handles late declarations, owned editor replacement, removal and reconnect', async () => {
    const element = document.createElement('test-editor-player') as InspectablePlayer;
    element.setAttribute('editor', '#declaration');
    document.body.append(element);
    expect(element.getAttribute('data-editor-state')).toBe('missing');
    const declaration = document.createElement('score-document') as ScoreDocumentElement;
    declaration.id = 'declaration'; declaration.score = music();
    document.body.append(declaration);
    await flush();
    const first = declaration.editor!;
    expect((await element.waitForDocumentRevision(first.getSnapshot())).status).toBe('applied');
    const engine = element.engines[0];
    declaration.score = music('D4');
    const second = declaration.editor!;
    expect((await element.waitForDocumentRevision(second.getSnapshot())).status).toBe('applied');
    expect(element.engines).toEqual([engine]);
    expect(element.editor).toBe(second);
    expect(first.getSnapshot().status).toBe('disposed');
    declaration.remove();
    await flush();
    await expect(element.play()).rejects.toThrow('editor');
    expect(engine.documentSource).toBeUndefined();
    document.body.append(declaration);
    await flush();
    expect((await element.waitForDocumentRevision(declaration.editor!.getSnapshot())).status).toBe('applied');
    expect(element.engines).toEqual([engine]);
  });

  it('publishes paused source errors and recovery, and blocks every seek entry while conflicted', async () => {
    const source = editor();
    const element = player(source);
    await element.waitForDocumentRevision(source.getSnapshot());
    await element.seekNominal(0.125);
    const states: ScoreDocumentPlaybackBinding[] = [];
    const errors: Array<{operation: string; error: {code: string}}> = [];
    let seeks = 0;
    element.addEventListener('webscore:documentstatechange', (event) => states.push((event as CustomEvent<ScoreDocumentPlaybackBinding>).detail));
    element.addEventListener('webscore:error', (event) => errors.push((event as CustomEvent).detail));
    element.addEventListener('webscore:seek', () => { seeks += 1; });
    element.setAttribute('src', '/conflict.mid');
    expect(states.map((state) => state.status)).toEqual(['error']);
    expect(states[0].error).toMatchObject({code: 'source-conflict'});
    await expect(element.play()).rejects.toMatchObject({code: 'source-conflict'});
    await expect(element.seekNominal(0.25)).rejects.toMatchObject({code: 'source-conflict'});
    await expect(element.playback.seekNominal!(0.25)).rejects.toMatchObject({code: 'source-conflict'});
    element.seek(0.25);
    element.seekFraction(0.75);
    expect(element.engines[0].nominalSeconds).toBe(0.125);
    expect(seeks).toBe(0);
    expect(errors.filter((event) => event.operation === 'seek').map((event) => event.error.code)).toEqual(['source-conflict', 'source-conflict']);
    element.removeAttribute('src');
    expect(states.map((state) => state.status)).toEqual(['error', 'ready']);
    await element.seekNominal(0.25);
    expect(element.engines[0].nominalSeconds).toBe(0.25);
    expect(seeks).toBe(1);
  });

  it('does not publish an obsolete source error after its state callback repairs the declaration', async () => {
    const source = editor();
    const element = player(source);
    await element.waitForDocumentRevision(source.getSnapshot());
    const errors: unknown[] = [];
    element.addEventListener('webscore:error', (event) => errors.push((event as CustomEvent).detail));
    element.addEventListener('webscore:documentstatechange', (event) => {
      if ((event as CustomEvent<ScoreDocumentPlaybackBinding>).detail.status === 'error') element.removeAttribute('src');
    });
    element.setAttribute('src', '/conflict.mid');
    expect(element.getAttribute('data-editor-state')).toBe('ready');
    expect(element.playback.snapshot().readiness).toBe('ready');
    expect(errors).toEqual([]);
  });

  it('restores selector resolution after clearing an object source and never falls back from invalid selectors', async () => {
    const source = editor();
    const declared = editor('E4');
    const target = document.createElement('div'); target.id = 'port';
    Object.assign(target, {editor: declared}); document.body.append(target);
    const element = player(source);
    element.setAttribute('editor', '#port');
    await element.waitForDocumentRevision(source.getSnapshot());
    expect(element.editor).toBe(source);
    element.editor = undefined;
    expect((await element.waitForDocumentRevision(declared.getSnapshot())).status).toBe('applied');
    expect(element.editor).toBe(declared);
    expect(() => { element.editor = {} as ScoreEditor; }).toThrow('Expected a Score');
    expect(element.editor).toBe(declared);
    element.setAttribute('editor', '[');
    expect(element.getAttribute('data-editor-state')).toBe('invalid');
    expect(element.resolvedScore).toBeUndefined();
    await expect(element.play()).rejects.toThrow('editor');
  });

  it('keeps two editors isolated and settles a waiter superseded by detach', async () => {
    const first = editor(); const second = editor('G4');
    const left = player(first); const right = player(second);
    await Promise.all([left.waitForDocumentRevision(first.getSnapshot()), right.waitForDocumentRevision(second.getSnapshot())]);
    first.transaction('Move', (tx) => tx.add({type: 'move-notes', noteIds: [noteId], deltaQuarters: [1, 1]}));
    const pending = left.waitForDocumentRevision(first.getSnapshot());
    left.remove();
    expect((await pending).status).toBe('superseded');
    expect(right.playback.snapshot().documentRevision).toBe(0);
    expect(right.resolvedScore).toBe(second.score);
  });
});
