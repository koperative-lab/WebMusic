import {describe, expect, it, vi} from 'vitest';
import {Duration, NoteId, PartId, Pitch, Rational, ScoreBuilder, VoiceId,
  composeScorePositionMaps, createScorePositionMap, mapScorePosition, isScoreDocumentSource, isScoreEditorPort,
  type ScoreEditCommand, type ScoreEditOperation, type ScoreEditTransaction} from '../../src/core/index';
import {createScoreEditor} from '../../src/edit/headless/index';

const a = NoteId('a');
const b = NoteId('b');
function fixture() {
  const builder = new ScoreBuilder();
  const part = PartId('p');
  builder.addPart({id: part, name: 'Piano'});
  for (const [id, onset, midi] of [[a, 0, 60], [b, 3, 64]] as const) {
    builder.addNote(part, {id, pitch: Pitch.fromMidi(midi), onsetQuarters: new Rational(onset),
      duration: Duration.quarter(), voice: VoiceId('v')});
  }
  return builder.build();
}
function command(editor: ReturnType<typeof createScoreEditor>, operations: readonly ScoreEditOperation[]): ScoreEditCommand {
  return {version: 1, documentId: editor.getSnapshot().documentId,
    expectedRevision: editor.getSnapshot().documentRevision, label: 'Test edit', operations};
}
const move = (amount: number): ScoreEditOperation => ({type: 'move-notes', noteIds: [a], deltaQuarters: [amount, 1]});

describe('ScoreEditor transactions and history', () => {
  it('checks Score domain ports and retains session ownership through its lifecycle', () => {
    const editor = createScoreEditor(fixture());
    const id = editor.getSnapshot().documentId;
    expect(isScoreDocumentSource(editor)).toBe(true);
    expect(isScoreEditorPort(editor)).toBe(true);
    const readOnly = {getSnapshot: () => editor.getSnapshot(), subscribe: editor.subscribe.bind(editor)};
    expect(isScoreDocumentSource(readOnly)).toBe(true);
    expect(isScoreEditorPort(readOnly)).toBe(false);
    expect(isScoreDocumentSource({...readOnly, getSnapshot: () => ({...editor.getSnapshot(), content: {}})})).toBe(false);
    expect(isScoreDocumentSource({...readOnly, getSnapshot: () => { throw new Error('unavailable'); }})).toBe(false);
    const session = editor.createInteractionSession();
    session.preview([move(1)]);
    session.cancelDraft();
    editor.transaction('Move', (tx) => tx.add(move(1)));
    expect(session.getSnapshot().documentId).toBe(id);
    session.dispose();
    expect(session.getSnapshot().documentId).toBe(id);
    editor.dispose();
  });
  it('publishes one revision for an ordered batch and retains old immutable input', () => {
    const original = fixture();
    const editor = createScoreEditor(original);
    const observed: number[] = [];
    editor.subscribe((snapshot) => observed.push(snapshot.documentRevision));
    const result = editor.execute(command(editor, [move(2), {type: 'set-velocity', noteIds: [a], velocity: 96}]));
    expect(result.status).toBe('committed');
    expect(observed).toEqual([0, 1]);
    expect(original.getNote(a)!.onsetQuarters.toFloat()).toBe(0);
    expect(editor.score.getNote(a)!.onsetQuarters.toFloat()).toBe(2);
    expect(editor.score.getNote(a)!.velocity).toBe(96);
    expect(editor.getState().history.undoCount).toBe(1);
    const savedId = editor.getSnapshot().contentId;
    editor.markSaved();
    expect(editor.getState().dirty).toBe(false);
    expect(editor.undo().status).toBe('committed');
    expect(editor.getSnapshot().documentRevision).toBe(2);
    expect(editor.score).toBe(original);
    expect(editor.getState().dirty).toBe(true);
    expect(editor.redo().status).toBe('committed');
    expect(editor.getSnapshot().documentRevision).toBe(3);
    expect(editor.getSnapshot().contentId).toBe(savedId);
    expect(editor.getState().dirty).toBe(false);
  });

  it('rejects a failing final operation without changing content, history or notifications', () => {
    const editor = createScoreEditor(fixture());
    const before = editor.getSnapshot();
    const listener = vi.fn();
    editor.subscribe(listener);
    const result = editor.execute(command(editor, [move(1), {type: 'delete-notes', noteIds: [NoteId('missing')]}]));
    expect(result).toMatchObject({status: 'failed', error: {code: 'unknown-note'}});
    expect(editor.getSnapshot()).toBe(before);
    expect(editor.getState().history.undoCount).toBe(0);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('rejects stale/foreign/unsupported/accessor envelopes without touching state', () => {
    const editor = createScoreEditor(fixture());
    const request = command(editor, [move(1)]);
    editor.execute(request);
    expect(editor.execute(request)).toMatchObject({status: 'failed', error: {code: 'revision-conflict'}});
    expect(editor.execute({...command(editor, []), documentId: 'other'})).toMatchObject({status: 'failed', error: {code: 'document-mismatch'}});
    expect(editor.execute({...command(editor, []), version: 2} as unknown as ScoreEditCommand)).toMatchObject({status: 'failed', error: {code: 'invalid-command'}});
    const getter = vi.fn(() => 1);
    const invalid = {...command(editor, [])};
    Object.defineProperty(invalid, 'version', {get: getter, enumerable: true});
    expect(editor.execute(invalid).status).toBe('failed');
    expect(getter).not.toHaveBeenCalled();
    expect(editor.getSnapshot().documentRevision).toBe(1);
  });

  it('keeps redo for net-zero batches and clears it only on an effective new branch', () => {
    const editor = createScoreEditor(fixture());
    editor.execute(command(editor, [move(1)]));
    editor.undo();
    const before = editor.getSnapshot();
    expect(editor.execute(command(editor, [move(1), move(-1)])).status).toBe('noop');
    expect(editor.getSnapshot()).toBe(before);
    expect(editor.getState().history.canRedo).toBe(true);
    editor.execute(command(editor, [{type: 'set-velocity', noteIds: [b], velocity: 20}]));
    expect(editor.getState().history.canRedo).toBe(false);
  });

  it('bounds retained transactions across undo and redo and exposes trimming', () => {
    const editor = createScoreEditor(fixture(), {history: {limit: 2}});
    for (let i = 0; i < 4; i++) editor.execute(command(editor, [move(1)]));
    expect(editor.getState().history).toMatchObject({undoCount: 2, redoCount: 0, trimmedCount: 2});
    editor.undo(); editor.undo();
    expect(editor.undo().status).toBe('noop');
    expect(editor.score.getNote(a)!.onsetQuarters.toFloat()).toBe(2);
    expect(editor.getState().history).toMatchObject({undoCount: 0, redoCount: 2});
    editor.clearHistory();
    expect(editor.getState().history.redoCount).toBe(0);
    expect(createScoreEditor(fixture()).getState().history.limit).toBe(100);
    expect(() => createScoreEditor(fixture(), {history: {limit: 0}})).toThrow();
  });

  it('notifies history/save state without republishing unchanged content to borrowers', () => {
    const editor = createScoreEditor(fixture());
    const source = vi.fn();
    const state = vi.fn();
    editor.subscribe(source); editor.subscribeState(state);
    editor.execute(command(editor, [move(1)]));
    editor.markSaved(); editor.clearHistory();
    expect(source).toHaveBeenCalledTimes(2);
    expect(state).toHaveBeenCalledTimes(4);
    expect(editor.getSnapshot().documentRevision).toBe(1);
  });

  it('supports external checkpoints with monotonic revision, origin and explicit reset', () => {
    const editor = createScoreEditor(fixture(), {history: false});
    const checkpoint = editor.createCheckpoint();
    editor.execute(command(editor, [move(2)]));
    expect(editor.undo()).toMatchObject({status: 'failed', error: {code: 'history-disabled'}});
    const restored = editor.restoreCheckpoint(checkpoint);
    expect(restored).toMatchObject({status: 'committed', change: {origin: 'restore', fromRevision: 1, toRevision: 2}});
    expect(editor.score).toBe(checkpoint.content);
    expect(editor.getState().dirty).toBe(false);
    if (restored.status === 'committed') expect(mapScorePosition(restored.change.positionMap, new Rational(3)).positionPolicy).toBe('reset-origin');
    expect(editor.restoreCheckpoint({...checkpoint})).toMatchObject({status: 'failed', error: {code: 'invalid-checkpoint'}});
    expect(createScoreEditor(fixture()).restoreCheckpoint(checkpoint).status).toBe('failed');
  });

  it('clears local branches on external restore and preserves independent documents', () => {
    const editor = createScoreEditor(fixture());
    const other = createScoreEditor(editor.score);
    const checkpoint = editor.createCheckpoint();
    editor.execute(command(editor, [move(2)]));
    editor.restoreCheckpoint(checkpoint);
    expect(editor.getState().history).toMatchObject({undoCount: 0, redoCount: 0});
    expect(other.getSnapshot().documentId).not.toBe(editor.getSnapshot().documentId);
    expect(other.getSnapshot().documentRevision).toBe(0);
  });

  it('restores checkpoint identity even when current notes have equal values at another root', () => {
    const editor = createScoreEditor(fixture());
    const checkpoint = editor.createCheckpoint();
    editor.execute(command(editor, [move(1)]));
    editor.execute(command(editor, [move(-1)]));
    expect(editor.getState().dirty).toBe(true);
    expect(editor.restoreCheckpoint(checkpoint).status).toBe('committed');
    expect(editor.getSnapshot().documentRevision).toBe(3);
    expect(editor.getSnapshot().contentId).toBe(checkpoint.contentId);
    expect(editor.getState().dirty).toBe(false);
    expect(editor.getState().history.undoCount).toBe(0);
  });

  it('captures transaction operations at add-time, closes builders and rejects nesting', () => {
    const editor = createScoreEditor(fixture());
    let builder: ScoreEditTransaction | undefined;
    const mutable = {type: 'move-notes' as const, noteIds: [a], deltaQuarters: [1, 1] as [number, number]};
    expect(editor.transaction('Drag', (tx) => {
      builder = tx;
      tx.add(mutable);
      mutable.deltaQuarters[0] = 99;
      expect(editor.transaction('Nested', () => {})).toMatchObject({status: 'failed', error: {code: 'reentrant-command'}});
      expect(editor.execute(command(editor, [move(4)])).status).toBe('failed');
    }).status).toBe('committed');
    expect(editor.score.getNote(a)!.onsetQuarters.toFloat()).toBe(1);
    expect(() => builder!.add(move(1))).toThrow();
    expect(editor.transaction('Throw', (tx) => { tx.add(move(1)); throw new Error('abort'); })).toMatchObject({status: 'failed', error: {code: 'transaction-aborted'}});
    expect(editor.getSnapshot().documentRevision).toBe(1);
  });

  it('aborts an async transaction and consumes its closed-builder continuation', async () => {
    const editor = createScoreEditor(fixture());
    const result = editor.transaction('Async', async (tx) => { tx.add(move(1)); await Promise.resolve(); tx.add(move(2)); });
    expect(result).toMatchObject({status: 'failed', error: {code: 'transaction-aborted'}});
    await Promise.resolve(); await Promise.resolve();
    expect(editor.getSnapshot().documentRevision).toBe(0);
  });

  it('isolates observer failures and blocks commands during initial and update delivery', () => {
    const errors = vi.fn();
    const editor = createScoreEditor(fixture(), {onListenerError: errors});
    const observed: number[] = [];
    editor.subscribe(() => { throw new Error('listener'); });
    editor.subscribe((snapshot) => {
      observed.push(snapshot.documentRevision);
      expect(editor.execute(command(editor, [move(1)]))).toMatchObject({status: 'failed', error: {code: 'reentrant-command'}});
    });
    expect(editor.execute(command(editor, [move(1)])).status).toBe('committed');
    expect(observed).toEqual([0, 1]);
    expect(errors).toHaveBeenCalledTimes(2);
  });

  it('handles disposal inside a callback without older snapshots following disposal', () => {
    const editor = createScoreEditor(fixture());
    const states: string[] = [];
    editor.subscribe((snapshot) => { if (snapshot.documentRevision === 1) editor.dispose(); });
    const off = editor.subscribe((snapshot) => states.push(`${snapshot.documentRevision}:${snapshot.status}`));
    editor.execute(command(editor, [move(1)]));
    expect(states).toEqual(['0:ready', '1:disposed']);
    expect(editor.undo()).toMatchObject({status: 'failed', error: {code: 'disposed'}});
    editor.dispose(); off(); off();
    expect(states).toHaveLength(2);
  });

  it('does not commit a transaction after its callback disposes the editor', () => {
    const editor = createScoreEditor(fixture());
    expect(editor.transaction('Dispose', (tx) => { tx.add(move(1)); editor.dispose(); })).toMatchObject({status: 'failed', error: {code: 'disposed'}});
    expect(editor.getSnapshot().documentRevision).toBe(0);
  });

  it('does not invoke guard accessors or resurrect a disposed editor through restore', () => {
    const editor = createScoreEditor(fixture());
    const checkpoint = editor.createCheckpoint();
    editor.execute(command(editor, [move(1)]));
    const getter = vi.fn(() => { editor.dispose(); return checkpoint.documentId; });
    const guard = {get documentId() { return getter(); }, expectedRevision: 1};
    expect(editor.restoreCheckpoint(checkpoint, guard)).toMatchObject({status: 'failed', error: {code: 'invalid-command'}});
    expect(getter).not.toHaveBeenCalled();
    expect(editor.getSnapshot().status).toBe('ready');
    editor.dispose();
    expect(editor.restoreCheckpoint(checkpoint)).toMatchObject({status: 'failed', error: {code: 'disposed'}});
    expect(editor.getSnapshot().status).toBe('disposed');
  });
});

describe('Score interaction sessions', () => {
  it('publishes coherent terminal editor state before session disposal callbacks', () => {
    const editor = createScoreEditor(fixture());
    const session = editor.createInteractionSession();
    editor.execute(command(editor, [move(1)]));
    const statuses: string[] = [];
    session.subscribe((snapshot) => {
      if (!snapshot.disposed) return;
      expect(editor.getState().history.undoCount).toBe(0);
      editor.subscribeState((state) => statuses.push(state.document.status));
    });
    editor.dispose();
    expect(statuses).toEqual(['disposed']);
  });
  it('guards initial/session publication and cancels commit when a callback disposes its session', () => {
    const editor = createScoreEditor(fixture());
    const session = editor.createInteractionSession();
    const off = session.subscribe(() => {
      expect(() => session.setSelection([a])).toThrow();
      expect(session.preview([move(1)])).toMatchObject({status: 'failed', error: {code: 'reentrant-command'}});
      expect(session.commitDraft()).toMatchObject({status: 'failed', error: {code: 'reentrant-command'}});
    });
    session.preview([move(1)]);
    off();
    session.subscribe((snapshot) => { if (!snapshot.draft) session.dispose(); });
    expect(session.commitDraft()).toMatchObject({status: 'failed', error: {code: 'disposed'}});
    expect(editor.getSnapshot().documentRevision).toBe(0);
  });
  it('keeps selection/drafts outside history and commits one shared-session gesture', () => {
    const editor = createScoreEditor(fixture());
    const session = editor.createInteractionSession();
    const separate = editor.createInteractionSession();
    session.setSelection([a]);
    session.preview([move(1)]); session.preview([move(2)]);
    expect(editor.getSnapshot().documentRevision).toBe(0);
    expect(editor.getState().dirty).toBe(false);
    expect(session.getSnapshot().draft!.content.getNote(a)!.onsetQuarters.toFloat()).toBe(2);
    expect(separate.getSnapshot().selectedNoteIds).toEqual([]);
    expect(session.commitDraft().status).toBe('committed');
    expect(editor.getState().history.undoCount).toBe(1);
    expect(session.getSnapshot().draft).toBeUndefined();
    editor.undo();
    expect(session.getSnapshot().selectedNoteIds).toEqual([a]);
  });

  it('cancels conflicting drafts and prunes selection without restoring selection on undo', () => {
    const editor = createScoreEditor(fixture());
    const session = editor.createInteractionSession();
    session.setSelection([a]); session.preview([move(1)]);
    editor.execute(command(editor, [{type: 'delete-notes', noteIds: [a]}]));
    expect(session.getSnapshot()).toMatchObject({selectedNoteIds: []});
    expect(session.getSnapshot().draft).toBeUndefined();
    expect(session.commitDraft().status).toBe('noop');
    editor.undo();
    expect(session.getSnapshot().selectedNoteIds).toEqual([]);
    session.preview([move(1)]); session.cancelDraft();
    expect(editor.getSnapshot().documentRevision).toBe(2);
    session.dispose(); session.dispose();
    expect(editor.getSnapshot().status).toBe('ready');
    expect(session.preview([move(1)]).status).toBe('failed');
    const owned = editor.createInteractionSession();
    editor.dispose();
    expect(owned.getSnapshot().disposed).toBe(true);
  });
});

describe('Score position map composition', () => {
  it('composes skipped revisions without recovering a coordinate lost to an earlier clamp', () => {
    const shrink = createScorePositionMap('doc', 1, 2, new Rational(3));
    const undo = createScorePositionMap('doc', 2, 3, new Rational(10));
    const combined = composeScorePositionMaps(shrink, undo);
    expect(combined.steps).toHaveLength(1);
    expect(mapScorePosition(combined, new Rational(7))).toMatchObject({quarters: new Rational(3), clamped: true});
    expect(() => composeScorePositionMaps(shrink, createScorePositionMap('doc', 4, 5, Rational.ONE))).toThrow();
    expect(() => composeScorePositionMaps(shrink, createScorePositionMap('other', 2, 3, Rational.ONE))).toThrow();
  });

  it('keeps an explicit reset through subsequent revisions and validates coordinates', () => {
    const reset = createScorePositionMap('doc', 1, 2, Rational.ONE, 'reset-origin');
    const combined = composeScorePositionMaps(reset, createScorePositionMap('doc', 2, 5, new Rational(4)));
    expect(mapScorePosition(combined, new Rational(7))).toMatchObject({quarters: Rational.ZERO, positionPolicy: 'reset-origin'});
    expect(() => mapScorePosition(combined, new Rational(-1))).toThrow();
    expect(() => createScorePositionMap('doc', 0, 0, Rational.ONE)).toThrow();
  });
});
