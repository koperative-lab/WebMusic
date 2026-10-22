// @vitest-environment jsdom
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {Score, ScoreBuilder, PartId, NoteId, Pitch, Duration, Rational, VoiceId} from '../../src/core';
import {ScoreDocumentElement, defineScoreDocumentElement, defineAllElements} from '../../src/edit/element';
import {ScoreEditor} from '../../src/edit/headless';
import {loadScoreFromUrl} from '../../src/io/load';

vi.mock('../../src/io/load', () => ({loadScoreFromUrl: vi.fn()}));
const load = vi.mocked(loadScoreFromUrl);
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
function score(midi = 60): Score {
  const builder = new ScoreBuilder();
  builder.addPart({id: PartId('part'), name: 'Part', staves: 1});
  builder.addNote(PartId('part'), {id: NoteId('note'), pitch: Pitch.fromMidi(midi),
    onsetQuarters: Rational.ZERO, duration: Duration.quarter(), voice: VoiceId('voice')});
  return builder.build();
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {resolve = yes; reject = no;});
  return {promise, resolve, reject};
}
beforeEach(() => { defineScoreDocumentElement(); load.mockReset(); });
afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); });

describe('ScoreDocumentElement', () => {
  it('registers idempotently and owns a nonvisual editor only while connected', () => {
    defineAllElements(); defineAllElements();
    expect(customElements.get('score-document')).toBe(ScoreDocumentElement);
    const element = document.createElement('score-document') as ScoreDocumentElement;
    element.score = score();
    expect(element.editor).toBeUndefined();
    document.body.append(element);
    const first = element.editor!;
    expect(element.status).toBe('ready');
    expect(element.style.display).toBe('none');
    expect(element.shadowRoot).toBeNull();
    expect(first.getState().history.limit).toBe(100);
    element.remove();
    expect(element.status).toBe('disposed');
    expect(element.editor).toBeUndefined();
    expect(first.getSnapshot().status).toBe('disposed');
    document.body.append(element);
    expect(element.editor!.getSnapshot().documentId).not.toBe(first.getSnapshot().documentId);
  });

  it('keeps the editor when ignored history settings change while history is disabled', async () => {
    const element = document.createElement('score-document') as ScoreDocumentElement;
    element.setAttribute('history', 'false'); element.score = score(); document.body.append(element);
    const editor = element.editor!;
    expect(editor.transaction('Transpose', (tx) => tx.add({type: 'transpose-notes', noteIds: [NoteId('note')], semitones: 2})).status).toBe('committed');
    element.setAttribute('history-limit', '5'); element.setAttribute('history', 'off'); await flush();
    expect(element.editor).toBe(editor); expect(editor.score.getNote(NoteId('note'))!.pitch.midi).toBe(62);
    element.setAttribute('history', 'true'); await flush();
    expect(element.editor).not.toBe(editor); expect(element.editor!.getState().history.limit).toBe(5);
  });

  it('notifies borrowers before disposing superseded owners, including reentrant replacement', () => {
    const element = document.createElement('score-document') as ScoreDocumentElement;
    element.score = score(); document.body.append(element);
    const first = element.editor!;
    let second = first;
    element.addEventListener('webmusic:sourcechange', () => {
      expect(element.editor).not.toBe(first);
      expect(first.getSnapshot().status).toBe('ready');
      second = element.editor!;
      element.score = score(64);
    }, {once: true});
    element.score = score(62);
    expect(element.editor!.score.notes[0].pitch.midi).toBe(64);
    expect(element.editor!.getSnapshot().status).toBe('ready');
    expect(first.getSnapshot().status).toBe('disposed');
    expect(second.getSnapshot().status).toBe('disposed');
  });

  it('keeps valid ownership and configuration when programmatic input is invalid', () => {
    const element = document.createElement('score-document') as ScoreDocumentElement;
    const input = score(); element.score = input; document.body.append(element);
    const editor = element.editor;
    expect(() => { element.score = {} as Score; }).toThrow('Score');
    expect(element.score).toBe(input);
    expect(element.editor).toBe(editor);
    expect(element.status).toBe('ready');
  });

  it('validates a Score assigned while disconnected when loading begins', async () => {
    const duplicate = () => {
      const base = score();
      return new Score({id: base.id, metadata: base.metadata, parts: [base.parts[0], base.parts[0]],
        timeMap: base.timeMap, measures: base.measures});
    };
    const element = document.createElement('score-document') as ScoreDocumentElement;
    const invalid = duplicate();
    element.score = invalid;
    expect(element.score).toBe(invalid);
    const errors: unknown[] = [];
    element.addEventListener('webscore:error', (event) => errors.push((event as CustomEvent).detail));
    document.body.append(element);
    await flush();
    expect(element.status).toBe('error');
    expect(element.editor).toBeUndefined();
    expect(errors).toMatchObject([{operation: 'document-load'}]);
    element.score = score();
    expect(() => { element.score = duplicate(); }).toThrow();
    expect(element.status).toBe('ready');
  });

  it('does not dispose a fresh owner when clearing callbacks reconnect the declaration', () => {
    const element = document.createElement('score-document') as ScoreDocumentElement;
    element.score = score(); document.body.append(element);
    const first = element.editor!;
    element.addEventListener('webmusic:sourcechange', () => {
      expect(element.editor).toBeUndefined();
      document.body.append(element);
    }, {once: true});
    element.remove();
    expect(element.isConnected).toBe(true);
    expect(first.getSnapshot().status).toBe('disposed');
    expect(element.editor).not.toBe(first);
    expect(element.editor!.getSnapshot().status).toBe('ready');
    expect(element.status).toBe('ready');
  });

  it('retains the last successful editor and URL after failed URL replacement', async () => {
    const first = deferred<Score>(); const second = deferred<Score>();
    load.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const element = document.createElement('score-document') as ScoreDocumentElement;
    element.src = '/first.mid'; document.body.append(element);
    expect(element.status).toBe('loading');
    first.resolve(score()); await flush();
    const editor = element.editor;
    const sourceChanged = vi.fn(); const failed = vi.fn();
    element.addEventListener('webmusic:sourcechange', sourceChanged);
    element.addEventListener('webscore:error', failed);
    element.src = '/second.mid';
    expect(element.editor).toBe(editor);
    second.reject(new Error('download failed')); await flush();
    expect(element.status).toBe('error');
    expect(element.error).toEqual(new Error('download failed'));
    expect(element.loadedSrc).toBe('/first.mid');
    expect(element.editor).toBe(editor);
    expect(sourceChanged).not.toHaveBeenCalled();
    expect(failed).toHaveBeenCalledTimes(1);
  });

  it('aborts stale loads and ignores their success or failure, including disconnect', async () => {
    const first = deferred<Score>(); const second = deferred<Score>(); const third = deferred<Score>();
    load.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise).mockReturnValueOnce(third.promise);
    const element = document.createElement('score-document') as ScoreDocumentElement;
    element.src = '/first.mid'; document.body.append(element);
    const signal = load.mock.calls[0][1]!.signal!;
    element.src = '/second.mid';
    expect(signal.aborted).toBe(true);
    second.resolve(score(62)); await flush();
    const editor = element.editor;
    first.resolve(score(60)); await flush();
    expect(element.editor).toBe(editor);
    expect(element.loadedSrc).toBe('/second.mid');
    element.src = '/third.mid';
    const lastSignal = load.mock.calls[2][1]!.signal!;
    element.remove();
    expect(lastSignal.aborted).toBe(true);
    third.reject(new Error('late failure')); await flush();
    expect(element.status).toBe('disposed');
    expect(element.editor).toBeUndefined();
    expect(element.error).toBeUndefined();
  });

  it('handles reentrant loading callbacks without starting a superseded request', async () => {
    load.mockResolvedValue(score(65));
    const element = document.createElement('score-document') as ScoreDocumentElement;
    element.src = '/first.mid';
    element.addEventListener('webscore:documentstatechange', () => { element.src = '/new.mid'; }, {once: true});
    document.body.append(element); await flush();
    expect(load).toHaveBeenCalledTimes(1);
    expect(load.mock.calls[0][0]).toBe('/new.mid');
    expect(element.loadedSrc).toBe('/new.mid');
  });


  it('keeps the latest explicit input and disposes the candidate superseded by an abort callback', async () => {
    const pending = deferred<Score>(), element = document.createElement('score-document') as ScoreDocumentElement;
    const first = score(62), latest = score(64);
    load.mockImplementationOnce((_url, options) => {
      options!.signal!.addEventListener('abort', () => { element.score = latest; }, {once: true});
      return pending.promise;
    });
    element.src = '/pending.mid'; document.body.append(element);
    const changes = vi.fn(); element.addEventListener('webmusic:sourcechange', changes);
    const dispose = vi.spyOn(ScoreEditor.prototype, 'dispose');
    element.score = first;
    const editor = element.editor!;
    expect(element.score).toBe(latest);
    expect(editor.score.notes[0].pitch.midi).toBe(64);
    expect(element.status).toBe('ready'); expect(changes).toHaveBeenCalledTimes(1);
    const abandoned = dispose.mock.contexts.find((value): value is ScoreEditor => value instanceof ScoreEditor && value !== editor)!;
    expect(abandoned).toBeDefined(); expect(abandoned.getSnapshot().status).toBe('disposed');
    pending.reject(new Error('Late cancelled input')); await flush();
    expect(element.editor).toBe(editor); expect(element.error).toBeUndefined();
  });

  it('keeps a newer URL load when abort clears the pending explicit input', async () => {
    const pending = deferred<Score>(), replacement = deferred<Score>();
    const element = document.createElement('score-document') as ScoreDocumentElement;
    load.mockImplementationOnce((_url, options) => {
      options!.signal!.addEventListener('abort', () => { element.score = undefined; }, {once: true});
      return pending.promise;
    }).mockReturnValueOnce(replacement.promise);
    element.src = '/pending.mid'; document.body.append(element);
    const dispose = vi.spyOn(ScoreEditor.prototype, 'dispose');
    element.score = score(62);
    expect(element.score).toBeUndefined(); expect(element.editor).toBeUndefined();
    expect(element.status).toBe('loading'); expect(load).toHaveBeenCalledTimes(2);
    expect(dispose).toHaveBeenCalledTimes(1);
    expect((dispose.mock.contexts[0] as ScoreEditor).getSnapshot().status).toBe('disposed');
    replacement.resolve(score(64)); await flush();
    const newest = element.editor!;
    expect(newest.score.notes[0].pitch.midi).toBe(64);
    expect(element.loadedSrc).toBe('/pending.mid');
    pending.resolve(score()); await flush(); expect(element.editor).toBe(newest);
  });

  it('returns superseded when retry cancellation installs a newer explicit input', async () => {
    const pending = deferred<Score>(), element = document.createElement('score-document') as ScoreDocumentElement;
    let newest: ScoreEditor | undefined;
    load.mockImplementationOnce((_url, options) => {
      options!.signal!.addEventListener('abort', () => { element.score = score(64); newest = element.editor; }, {once: true});
      return pending.promise;
    });
    element.src = '/pending.mid'; document.body.append(element);
    expect(await element.reload()).toEqual({status: 'superseded'});
    expect(element.editor).toBe(newest); expect(newest!.getSnapshot().status).toBe('ready');
    pending.resolve(score()); await flush(); expect(element.editor).toBe(newest);
  });

  it('releases an explicit candidate if cancellation disconnects the declaration', () => {
    const element = document.createElement('score-document') as ScoreDocumentElement;
    load.mockImplementationOnce((_url, options) => {
      options!.signal!.addEventListener('abort', () => element.remove(), {once: true});
      return new Promise(() => {});
    });
    element.src = '/pending.mid'; document.body.append(element);
    const dispose = vi.spyOn(ScoreEditor.prototype, 'dispose');
    element.score = score(62);
    expect(element.editor).toBeUndefined(); expect(element.status).toBe('disposed');
    expect(dispose).toHaveBeenCalledTimes(1);
    expect((dispose.mock.contexts[0] as ScoreEditor).getSnapshot().status).toBe('disposed');
  });

  it('keeps a fresh owner when an abort callback reconnects during disconnect', () => {
    const element = document.createElement('score-document') as ScoreDocumentElement;
    let newest: ScoreEditor | undefined;
    load.mockImplementationOnce((_url, options) => {
      options!.signal!.addEventListener('abort', () => {
        element.score = score(64); document.body.append(element); newest = element.editor;
      }, {once: true});
      return new Promise(() => {});
    });
    element.src = '/pending.mid'; document.body.append(element); element.remove();
    expect(element.isConnected).toBe(true); expect(element.editor).toBe(newest);
    expect(newest!.getSnapshot().status).toBe('ready'); expect(element.status).toBe('ready');
  });

  it.each([
    ['abort', 'resolve'], ['abort', 'reject'], ['sourcechange', 'resolve'], ['sourcechange', 'reject'],
  ] as const)('releases the previous lifetime when %s reconnects into a URL load that will %s', async (trigger, outcome) => {
    const pending = deferred<Score>(), replacement = deferred<Score>();
    const element = document.createElement('score-document') as ScoreDocumentElement;
    const signals: AbortSignal[] = [];
    load.mockImplementationOnce((_url, options) => {
      signals.push(options!.signal!);
      if (trigger === 'abort') options!.signal!.addEventListener('abort', () => document.body.append(element), {once: true});
      return pending.promise;
    }).mockImplementationOnce((_url, options) => { signals.push(options!.signal!); return replacement.promise; });
    element.score = score(); element.src = '/pending.mid'; document.body.append(element);
    const previous = element.editor!;
    element.score = undefined;
    const observed: Array<ScoreEditor | undefined> = [];
    element.addEventListener('webmusic:sourcechange', () => {
      observed.push(element.editor);
      if (trigger === 'sourcechange' && !element.isConnected) document.body.append(element);
    });
    element.remove();
    expect(element.isConnected).toBe(true); expect(element.status).toBe('loading');
    expect(element.editor).toBeUndefined(); expect(observed).toEqual([undefined]);
    expect(previous.getSnapshot().status).toBe('disposed');
    expect(signals).toHaveLength(2); expect(signals[0].aborted).toBe(true); expect(signals[1].aborted).toBe(false);
    if (outcome === 'resolve') replacement.resolve(score(64));
    else replacement.reject(new Error('New connection failed'));
    await flush();
    const newest = element.editor;
    if (outcome === 'resolve') {
      expect(newest!.score.notes[0].pitch.midi).toBe(64);
      expect(newest!.getSnapshot().status).toBe('ready');
    } else { expect(element.status).toBe('error'); expect(newest).toBeUndefined(); }
    pending.resolve(score()); await flush(); expect(element.editor).toBe(newest);
    expect(signals[1].aborted).toBe(false);
  });

  it('honors explicit input, configurable history and explicit clearing', async () => {
    load.mockResolvedValue(score(65));
    const element = document.createElement('score-document') as ScoreDocumentElement;
    element.setAttribute('history', 'false');
    element.score = score(); element.src = '/ignored.mid'; document.body.append(element);
    const editor = element.editor;
    expect(editor!.getState().history.enabled).toBe(false);
    element.src = '/later.mid';
    expect(element.editor).toBe(editor);
    expect(load).not.toHaveBeenCalled();
    element.score = undefined; await flush();
    expect(element.loadedSrc).toBe('/later.mid');
    element.removeAttribute('src');
    expect(element.editor).toBeUndefined();
    expect(element.status).toBe('empty');
    expect(await element.reload()).toEqual({status: 'empty'});
  });

  it('reports invalid history or format without silently loading another input', async () => {
    const element = document.createElement('score-document') as ScoreDocumentElement;
    element.setAttribute('history-limit', '0'); document.body.append(element);
    expect((await element.reload()).status).toBe('failed');
    expect(element.status).toBe('error');
    element.setAttribute('history-limit', '3');
    element.setAttribute('format', 'wrong'); element.src = '/invalid.mid';
    expect((await element.reload()).status).toBe('failed');
    expect(load).not.toHaveBeenCalled();
  });
});
