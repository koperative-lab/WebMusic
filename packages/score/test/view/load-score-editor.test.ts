import {afterEach, describe, expect, it, vi} from 'vitest';
import {Duration, NoteId, Pitch, Rational, ScoreBuilder, type Score} from '../../src/core';
import type {LoadScoreOptions} from '../../src/io/load';
import {loadScoreEditor, type ScoreEditor} from '../../src/view/headless';
import {createScoreEditor} from '../../src/view/headless/score-editor';

const io = vi.hoisted(() => ({load: vi.fn<(url: string, options?: LoadScoreOptions) => Promise<Score>>()}));
vi.mock('../../src/io/load', () => ({loadScoreFromUrl: io.load}));
vi.mock('../../src/view/headless/score-editor', async (original) => {
  const actual = await original<typeof import('../../src/view/headless/score-editor')>();
  return {...actual, createScoreEditor: vi.fn(actual.createScoreEditor)};
});

const noteId = NoteId('note');
function music(): Score {
  const builder = new ScoreBuilder();
  const part = builder.addPart({id: builder.newPartId(), name: 'Piano'});
  builder.addNote(part, {id: noteId, pitch: Pitch.parse('C4'), onsetQuarters: Rational.ZERO,
    duration: Duration.quarter(), voice: builder.newVoiceId()});
  return builder.build();
}
const move = (editor: ScoreEditor) => editor.transaction('Move', (tx) => tx.add({type: 'move-notes', noteIds: [noteId], deltaQuarters: [1, 1]}));
const editors: ScoreEditor[] = [];
async function load(...args: Parameters<typeof loadScoreEditor>): Promise<ScoreEditor> {
  const editor = await loadScoreEditor(...args); editors.push(editor); return editor;
}
afterEach(() => {
  for (const editor of editors.splice(0)) editor.dispose();
  io.load.mockReset();
  vi.mocked(createScoreEditor).mockClear();
});

describe('loadScoreEditor', () => {
  it('loads a URL into a ready caller-owned editor with the default history', async () => {
    const score = music();
    io.load.mockResolvedValue(score);
    const editor = await load('/piece.mid');
    expect(io.load).toHaveBeenCalledWith('/piece.mid', {});
    expect(editor.score).toBe(score);
    expect(editor.getSnapshot().status).toBe('ready');
    expect(editor.getState().history).toMatchObject({enabled: true, limit: 100});
    move(editor);
    editor.undo();
    expect(editor.score.getNote(noteId)!.onsetQuarters.toFloat()).toBe(0);
  });

  it('honours a history limit and disabled history', async () => {
    io.load.mockImplementation(async () => music());
    const limited = await load('/a.mid', {history: {limit: 2}});
    move(limited); move(limited); move(limited);
    expect(limited.getState().history).toMatchObject({enabled: true, limit: 2, undoCount: 2, trimmedCount: 1});
    const disabled = await load('/b.mid', {history: false});
    move(disabled);
    expect(disabled.getState().history).toMatchObject({enabled: false, undoCount: 0});
    expect(disabled.getState().history.canUndo).toBe(false);
    disabled.undo();
    expect(disabled.score.getNote(noteId)!.onsetQuarters.toFloat()).toBe(1);
  });

  it('passes load options through without editor options', async () => {
    io.load.mockResolvedValue(music());
    const controller = new AbortController();
    await load('/piece.xml', {format: 'musicxml', signal: controller.signal, timeoutMs: 500, maxInputBytes: 1024, history: false});
    expect(io.load).toHaveBeenCalledOnce();
    const [url, options] = io.load.mock.calls[0]!;
    expect(url).toBe('/piece.xml');
    expect(options).toEqual({format: 'musicxml', signal: controller.signal, timeoutMs: 500, maxInputBytes: 1024});
  });

  it('rejects an unsupported format with a TypeError before loading', async () => {
    await expect(loadScoreEditor('/piece.wav', {format: 'wav' as never})).rejects.toBeInstanceOf(TypeError);
    expect(io.load).not.toHaveBeenCalled();
    expect(createScoreEditor).not.toHaveBeenCalled();
  });

  it('propagates a loader failure and creates no editor', async () => {
    const failure = new Error('network down');
    io.load.mockRejectedValue(failure);
    await expect(loadScoreEditor('/missing.mid')).rejects.toBe(failure);
    expect(createScoreEditor).not.toHaveBeenCalled();
  });

  it('rejects and creates no editor when aborted before the load settles', async () => {
    let resolve!: (score: Score) => void;
    io.load.mockReturnValue(new Promise<Score>((done) => { resolve = done; }));
    const controller = new AbortController();
    const pending = loadScoreEditor('/slow.mid', {signal: controller.signal});
    await vi.waitFor(() => expect(io.load).toHaveBeenCalledOnce());
    controller.abort();
    // A loader that ignores the signal and still resolves must not yield an editor.
    resolve(music());
    await expect(pending).rejects.toMatchObject({name: 'AbortError'});
    expect(createScoreEditor).not.toHaveBeenCalled();
  });

  it('forwards onListenerError to the created editor', async () => {
    io.load.mockResolvedValue(music());
    const onListenerError = vi.fn();
    const editor = await load('/piece.mid', {onListenerError});
    const failure = new Error('listener failed');
    editor.subscribeState(() => { throw failure; });
    move(editor);
    expect(onListenerError).toHaveBeenCalledWith(failure);
  });
});
