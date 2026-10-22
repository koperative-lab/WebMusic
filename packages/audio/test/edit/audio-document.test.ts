// @vitest-environment jsdom
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {createAudioClip, type AudioClip} from '../../src/core';
import {AudioDocumentElement, defineAudioDocumentElement, defineAllAudioElements} from '../../src/edit/element';
import {AudioClipEditor} from '../../src/edit/headless';
import {loadAudioDocument} from '../../src/edit/element/internal/audio-document-loader';
import {createAudioRangeProcessor} from '../../src/edit/api/processor';

vi.mock('../../src/edit/element/internal/audio-document-loader', () => ({loadAudioDocument: vi.fn()}));
const load = vi.mocked(loadAudioDocument);
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
function clip(length = 60): AudioClip {
  return createAudioClip({sampleRate: 8000, channelData: [new Float32Array(length)]});
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {resolve = yes; reject = no;});
  return {promise, resolve, reject};
}
beforeEach(() => { defineAudioDocumentElement(); load.mockReset(); });
afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); });

describe('AudioDocumentElement', () => {
  it('registers idempotently and owns a nonvisual editor only while connected', () => {
    defineAllAudioElements(); defineAllAudioElements();
    expect(customElements.get('audio-document')).toBe(AudioDocumentElement);
    const element = document.createElement('audio-document') as AudioDocumentElement;
    element.clip = clip();
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

  it('notifies borrowers before disposing superseded owners, including reentrant replacement', () => {
    const element = document.createElement('audio-document') as AudioDocumentElement;
    element.clip = clip(); document.body.append(element);
    const first = element.editor!;
    let second = first;
    element.addEventListener('webmusic:sourcechange', () => {
      expect(element.editor).not.toBe(first);
      expect(first.getSnapshot().status).toBe('ready');
      second = element.editor!;
      element.clip = clip(64);
    }, {once: true});
    element.clip = clip(62);
    expect(element.editor!.getSnapshot().content.length).toBe(64);
    expect(element.editor!.getSnapshot().status).toBe('ready');
    expect(first.getSnapshot().status).toBe('disposed');
    expect(second.getSnapshot().status).toBe('disposed');
  });

  it('keeps valid ownership and configuration when programmatic input is invalid', () => {
    const element = document.createElement('audio-document') as AudioDocumentElement;
    const input = clip(); element.clip = input; document.body.append(element);
    const editor = element.editor;
    expect(() => { element.clip = {} as AudioClip; }).toThrow('AudioClip');
    expect(element.clip).toBe(input);
    expect(element.editor).toBe(editor);
    expect(element.status).toBe('ready');
  });

  it('does not dispose a fresh owner when clearing callbacks reconnect the declaration', () => {
    const element = document.createElement('audio-document') as AudioDocumentElement;
    element.clip = clip(); document.body.append(element);
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
    const first = deferred<AudioClip>(); const second = deferred<AudioClip>();
    load.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const element = document.createElement('audio-document') as AudioDocumentElement;
    element.src = '/first.wav'; document.body.append(element);
    expect(element.status).toBe('loading');
    first.resolve(clip()); await flush();
    const editor = element.editor;
    const sourceChanged = vi.fn(); const failed = vi.fn();
    element.addEventListener('webmusic:sourcechange', sourceChanged);
    element.addEventListener('webaudio:error', failed);
    element.src = '/second.wav';
    expect(element.editor).toBe(editor);
    second.reject(new Error('download failed')); await flush();
    expect(element.status).toBe('error');
    expect(element.error).toEqual(new Error('download failed'));
    expect(element.loadedSrc).toBe('/first.wav');
    expect(element.editor).toBe(editor);
    expect(sourceChanged).not.toHaveBeenCalled();
    expect(failed).toHaveBeenCalledTimes(1);
  });

  it('aborts stale loads and ignores their success or failure, including disconnect', async () => {
    const first = deferred<AudioClip>(); const second = deferred<AudioClip>(); const third = deferred<AudioClip>();
    load.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise).mockReturnValueOnce(third.promise);
    const element = document.createElement('audio-document') as AudioDocumentElement;
    element.src = '/first.wav'; document.body.append(element);
    const signal = load.mock.calls[0][1]!.signal!;
    element.src = '/second.wav';
    expect(signal.aborted).toBe(true);
    second.resolve(clip(62)); await flush();
    const editor = element.editor;
    first.resolve(clip(60)); await flush();
    expect(element.editor).toBe(editor);
    expect(element.loadedSrc).toBe('/second.wav');
    element.src = '/third.wav';
    const lastSignal = load.mock.calls[2][1]!.signal!;
    element.remove();
    expect(lastSignal.aborted).toBe(true);
    third.reject(new Error('late failure')); await flush();
    expect(element.status).toBe('disposed');
    expect(element.editor).toBeUndefined();
    expect(element.error).toBeUndefined();
  });

  it('handles reentrant loading callbacks without starting a superseded request', async () => {
    load.mockResolvedValue(clip(65));
    const element = document.createElement('audio-document') as AudioDocumentElement;
    element.src = '/first.wav';
    element.addEventListener('webaudio:documentstatechange', () => { element.src = '/new.wav'; }, {once: true});
    document.body.append(element); await flush();
    expect(load).toHaveBeenCalledTimes(1);
    expect(load.mock.calls[0][0]).toBe('/new.wav');
    expect(element.loadedSrc).toBe('/new.wav');
  });


  it('keeps the latest explicit input and disposes the candidate superseded by an abort callback', async () => {
    const pending = deferred<AudioClip>(), element = document.createElement('audio-document') as AudioDocumentElement;
    const first = clip(80), latest = clip(160);
    element.loader = load;
    load.mockImplementationOnce((_url, options) => {
      options!.signal!.addEventListener('abort', () => { element.clip = latest; }, {once: true});
      return pending.promise;
    });
    element.src = '/pending.wav'; document.body.append(element);
    const changes = vi.fn(); element.addEventListener('webmusic:sourcechange', changes);
    const dispose = vi.spyOn(AudioClipEditor.prototype, 'dispose');
    element.clip = first;
    const editor = element.editor!;
    expect(element.clip).toBe(latest);
    expect(editor.sequence.length).toBe(160);
    expect(element.status).toBe('ready'); expect(changes).toHaveBeenCalledTimes(1);
    const abandoned = dispose.mock.contexts.find((value): value is AudioClipEditor => value instanceof AudioClipEditor && value !== editor)!;
    expect(abandoned).toBeDefined(); expect(abandoned.getSnapshot().status).toBe('disposed');
    pending.reject(new Error('Late cancelled input')); await flush();
    expect(element.editor).toBe(editor); expect(element.error).toBeUndefined();
  });

  it('keeps a newer URL load when abort clears the pending explicit input', async () => {
    const pending = deferred<AudioClip>(), replacement = deferred<AudioClip>();
    const element = document.createElement('audio-document') as AudioDocumentElement;
    load.mockImplementationOnce((_url, options) => {
      options!.signal!.addEventListener('abort', () => { element.clip = undefined; }, {once: true});
      return pending.promise;
    }).mockReturnValueOnce(replacement.promise);
    element.src = '/pending.wav'; document.body.append(element);
    const dispose = vi.spyOn(AudioClipEditor.prototype, 'dispose');
    element.clip = clip(80);
    expect(element.clip).toBeUndefined(); expect(element.editor).toBeUndefined();
    expect(element.status).toBe('loading'); expect(load).toHaveBeenCalledTimes(2);
    expect(dispose).toHaveBeenCalledTimes(1);
    expect((dispose.mock.contexts[0] as AudioClipEditor).getSnapshot().status).toBe('disposed');
    replacement.resolve(clip(160)); await flush();
    const newest = element.editor!;
    expect(newest.sequence.length).toBe(160);
    expect(element.loadedSrc).toBe('/pending.wav');
    pending.resolve(clip()); await flush(); expect(element.editor).toBe(newest);
  });

  it('returns superseded when retry cancellation installs a newer explicit input', async () => {
    const pending = deferred<AudioClip>(), element = document.createElement('audio-document') as AudioDocumentElement;
    let newest: AudioClipEditor | undefined;
    load.mockImplementationOnce((_url, options) => {
      options!.signal!.addEventListener('abort', () => { element.clip = clip(160); newest = element.editor; }, {once: true});
      return pending.promise;
    });
    element.src = '/pending.wav'; document.body.append(element);
    expect(await element.reload()).toEqual({status: 'superseded'});
    expect(element.editor).toBe(newest); expect(newest!.getSnapshot().status).toBe('ready');
    pending.resolve(clip()); await flush(); expect(element.editor).toBe(newest);
  });

  it('releases an explicit candidate if cancellation disconnects the declaration', () => {
    const element = document.createElement('audio-document') as AudioDocumentElement;
    load.mockImplementationOnce((_url, options) => {
      options!.signal!.addEventListener('abort', () => element.remove(), {once: true});
      return new Promise(() => {});
    });
    element.src = '/pending.wav'; document.body.append(element);
    const dispose = vi.spyOn(AudioClipEditor.prototype, 'dispose');
    element.clip = clip(80);
    expect(element.editor).toBeUndefined(); expect(element.status).toBe('disposed');
    expect(dispose).toHaveBeenCalledTimes(1);
    expect((dispose.mock.contexts[0] as AudioClipEditor).getSnapshot().status).toBe('disposed');
  });

  it('keeps a fresh owner when an abort callback reconnects during disconnect', () => {
    const element = document.createElement('audio-document') as AudioDocumentElement;
    let newest: AudioClipEditor | undefined;
    load.mockImplementationOnce((_url, options) => {
      options!.signal!.addEventListener('abort', () => {
        element.clip = clip(160); document.body.append(element); newest = element.editor;
      }, {once: true});
      return new Promise(() => {});
    });
    element.src = '/pending.wav'; document.body.append(element); element.remove();
    expect(element.isConnected).toBe(true); expect(element.editor).toBe(newest);
    expect(newest!.getSnapshot().status).toBe('ready'); expect(element.status).toBe('ready');
  });

  it.each([
    ['abort', 'resolve'], ['abort', 'reject'], ['sourcechange', 'resolve'], ['sourcechange', 'reject'],
  ] as const)('releases the previous lifetime when %s reconnects into a URL load that will %s', async (trigger, outcome) => {
    const pending = deferred<AudioClip>(), replacement = deferred<AudioClip>();
    const element = document.createElement('audio-document') as AudioDocumentElement;
    const signals: AbortSignal[] = [];
    load.mockImplementationOnce((_url, options) => {
      signals.push(options!.signal!);
      if (trigger === 'abort') options!.signal!.addEventListener('abort', () => document.body.append(element), {once: true});
      return pending.promise;
    }).mockImplementationOnce((_url, options) => { signals.push(options!.signal!); return replacement.promise; });
    element.clip = clip(); element.src = '/pending.wav'; document.body.append(element);
    const previous = element.editor!;
    element.clip = undefined;
    const observed: Array<AudioClipEditor | undefined> = [];
    element.addEventListener('webmusic:sourcechange', () => {
      observed.push(element.editor);
      if (trigger === 'sourcechange' && !element.isConnected) document.body.append(element);
    });
    element.remove();
    expect(element.isConnected).toBe(true); expect(element.status).toBe('loading');
    expect(element.editor).toBeUndefined(); expect(observed).toEqual([undefined]);
    expect(previous.getSnapshot().status).toBe('disposed');
    expect(signals).toHaveLength(2); expect(signals[0].aborted).toBe(true); expect(signals[1].aborted).toBe(false);
    if (outcome === 'resolve') replacement.resolve(clip(160));
    else replacement.reject(new Error('New connection failed'));
    await flush();
    const newest = element.editor;
    if (outcome === 'resolve') {
      expect(newest!.sequence.length).toBe(160);
      expect(newest!.getSnapshot().status).toBe('ready');
    } else { expect(element.status).toBe('error'); expect(newest).toBeUndefined(); }
    pending.resolve(clip()); await flush(); expect(element.editor).toBe(newest);
    expect(signals[1].aborted).toBe(false);
  });

  it('honors explicit input, configurable history and explicit clearing', async () => {
    load.mockResolvedValue(clip(65));
    const element = document.createElement('audio-document') as AudioDocumentElement;
    element.setAttribute('history', 'false');
    element.clip = clip(); element.src = '/ignored.wav'; document.body.append(element);
    const editor = element.editor;
    expect(editor!.getState().history.enabled).toBe(false);
    element.src = '/later.wav';
    expect(element.editor).toBe(editor);
    expect(load).not.toHaveBeenCalled();
    element.clip = undefined; await flush();
    expect(element.loadedSrc).toBe('/later.wav');
    element.removeAttribute('src');
    expect(element.editor).toBeUndefined();
    expect(element.status).toBe('empty');
    expect(await element.reload()).toEqual({status: 'empty'});
  });

  it('starts one URL load when a parsed declaration upgrades', async () => {
    load.mockResolvedValue(clip());
    const host = document.createElement('div');
    host.innerHTML = '<audio-document-upgrade src="/parsed.wav"></audio-document-upgrade>'; document.body.append(host);
    customElements.define('audio-document-upgrade', class extends AudioDocumentElement {});
    const element = host.firstElementChild as AudioDocumentElement;
    expect(load).toHaveBeenCalledTimes(1); expect(load.mock.calls[0][1]!.signal!.aborted).toBe(false);
    await flush(); expect(element.status).toBe('ready'); expect(element.loadedSrc).toBe('/parsed.wav');
  });

  it('gives processors replaced during a pending URL load to its editor without restarting it', async () => {
    const pending = deferred<AudioClip>(); load.mockReturnValueOnce(pending.promise);
    const element = document.createElement('audio-document') as AudioDocumentElement;
    element.src = '/pending.wav'; document.body.append(element);
    element.processors = [createAudioRangeProcessor('reverse')];
    expect(load).toHaveBeenCalledTimes(1); expect(load.mock.calls[0][1]!.signal!.aborted).toBe(false);
    pending.resolve(clip(4)); await flush();
    const editor = element.editor!, snapshot = editor.getSnapshot();
    expect((await editor.processRange({documentId: snapshot.documentId, expectedRevision: 0, startFrame: 1, endFrame: 3, processorId: 'reverse',
      processorVersion: 1, parameters: {}, assetId: 'reversed', segmentId: 'processed', rightId: 'tail'})).status).toBe('committed');
    load.mockResolvedValueOnce(clip(4)); element.processors = [];
    expect(load).toHaveBeenCalledTimes(2); await flush(); expect(element.editor).not.toBe(editor);
  });

  it('keeps the editor when ignored history settings change while history is disabled', () => {
    const element = document.createElement('audio-document') as AudioDocumentElement;
    element.setAttribute('history', 'false'); element.clip = clip(); document.body.append(element);
    const editor = element.editor!;
    editor.transaction('Silence', (tx) => tx.add({type: 'insert-silence', frame: 0, length: 10, id: 'silence'}));
    element.setAttribute('history-limit', '5'); element.setAttribute('history', 'off');
    expect(element.editor).toBe(editor); expect(editor.getSnapshot().documentRevision).toBe(1);
    element.setAttribute('history', 'true');
    expect(element.editor).not.toBe(editor); expect(element.editor!.getState().history.limit).toBe(5);
  });

  it('reports invalid history or format without silently loading another input', async () => {
    const element = document.createElement('audio-document') as AudioDocumentElement;
    element.setAttribute('history-limit', '0'); document.body.append(element);
    expect((await element.reload()).status).toBe('failed');
    expect(element.status).toBe('error');
    element.setAttribute('history-limit', '3');
    element.setAttribute('format', 'wrong'); element.src = '/invalid.wav';
    expect((await element.reload()).status).toBe('failed');
    expect(load).not.toHaveBeenCalled();
  });
});

describe('AudioDocumentElement injected loaders', () => {
  it('forwards configured resource limits, explicit format and cancellation to the borrowed loader', async () => {
    const pending = deferred<AudioClip>();
    const loader = vi.fn(() => pending.promise);
    const element = document.createElement('audio-document') as AudioDocumentElement;
    const limits = {maxInputBytes: 128, maxDecodedFrames: 60, maxDecodedBytes: 240, maxChannels: 1, timeoutMs: 0};
    element.loadOptions = limits; element.loader = loader; element.setAttribute('format', 'wav'); element.src = '/injected';
    document.body.append(element);
    expect(load).not.toHaveBeenCalled(); expect(loader).toHaveBeenCalledTimes(1);
    const options = (loader.mock.calls[0] as unknown as [string, {signal: AbortSignal}])[1];
    expect(loader).toHaveBeenCalledWith('/injected', {...limits, format: 'wav', signal: options.signal});
    expect(options.signal.aborted).toBe(false); element.remove(); expect(options.signal.aborted).toBe(true);
    pending.resolve(clip()); await flush(); expect(element.editor).toBeUndefined();
  });
});
