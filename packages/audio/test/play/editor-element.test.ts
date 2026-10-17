// @vitest-environment jsdom
import {afterEach, beforeAll, describe, expect, it} from 'vitest';
import {createAudioClip} from '../../src/core';
import {createAudioClipEditor, type AudioClipEditor} from '../../src/edit/headless';
import {AudioPlayerElement, defineAudioPlayerElement} from '../../src/play/element/audio-player';
import {AudioPlayer} from '../../src/play/headless/audio-player';

const editors: AudioClipEditor[] = [];
const flush = async () => { for (let index = 0; index < 30; index++) await Promise.resolve(); };
function editor() {
  const value = createAudioClipEditor(createAudioClip({sampleRate: 1000, channelData: [new Float32Array(1000)]}));
  editors.push(value); return value;
}
function player(source?: AudioClipEditor) {
  const element = document.createElement('audio-player') as AudioPlayerElement;
  if (source) element.editor = source;
  document.body.append(element); return element;
}
function declaration(id: string, source: AudioClipEditor) {
  const element = document.createElement('div') as HTMLDivElement & {editor: AudioClipEditor};
  element.id = id; element.editor = source; document.body.append(element); return element;
}
beforeAll(() => defineAudioPlayerElement());
afterEach(() => {document.body.replaceChildren(); for (const editor of editors.splice(0)) editor.dispose();});

describe('Audio Player Element document binding', () => {
  it('applies document edits and undo through the same player and sequence transport', async () => {
    const source = editor(); const element = player(source);
    expect((await element.waitForDocumentRevision(source.getSnapshot())).status).toBe('applied');
    const native = element.player; const transport = element.transport; const events: unknown[] = [];
    element.addEventListener('webaudio:sourcechange', (event) => events.push((event as CustomEvent).detail));
    const result = source.transaction('Silence', (tx) => tx.add({type: 'insert-silence', frame: 0, length: 100, id: 'silence'}));
    expect(result.status).toBe('committed');
    expect((await element.waitForDocumentRevision(source.getSnapshot())).status).toBe('applied');
    expect(element.player).toBe(native); expect(element.transport).toBe(transport); expect(element.clip).toBeUndefined();
    expect(element.source).toMatchObject({kind: 'sequence', documentRevision: 1}); expect(element.duration).toBe(1.1);
    expect(events.at(-1)).toMatchObject({kind: 'sequence', documentRevision: 1});
    source.undo(); await element.waitForDocumentRevision(source.getSnapshot()); expect(element.duration).toBe(1);
    element.remove(); expect(source.getSnapshot().status).toBe('ready'); expect(element.player).toBeUndefined();
  });
  it('rejects object conflicts before mutation and makes invalid attributes unavailable until fixed', async () => {
    const source = editor(); const element = player(source); await element.waitForDocumentRevision(source.getSnapshot());
    const native = element.player;
    expect(() => {element.clip = createAudioClip({sampleRate: 1000, channelData: [new Float32Array(2)]});}).toThrow(/cannot be combined/);
    const external = new AudioPlayer(); expect(() => {element.player = external;}).toThrow(/cannot be combined/); external.dispose();
    element.setAttribute('src', '');
    expect(element.getAttribute('data-editor-state')).toBe('source-conflict');
    await expect(element.play()).rejects.toMatchObject({code: 'source-conflict'});
    expect(element.shadowRoot?.querySelector<HTMLButtonElement>('button')?.disabled).toBe(true);
    element.removeAttribute('src'); await flush();
    expect(element.documentBinding.status).toBe('ready'); expect(element.player).toBe(native);
    expect(element.shadowRoot?.querySelector<HTMLButtonElement>('button')?.disabled).toBe(false);
  });
  it('resolves late HTML targets, replacement and removal without retaining the removed transport', async () => {
    const element = document.createElement('audio-player') as AudioPlayerElement;
    element.setAttribute('editor', '#owner'); document.body.append(element);
    expect(element.getAttribute('data-editor-state')).toBe('missing');
    const first = editor(); const owner = declaration('owner', first); await flush();
    expect((await element.waitForDocumentRevision(first.getSnapshot())).status).toBe('applied');
    const transport = element.transport;
    const second = editor(); owner.editor = second; owner.dispatchEvent(new CustomEvent('webmusic:sourcechange', {bubbles: true, composed: true}));
    await flush(); expect((await element.waitForDocumentRevision(second.getSnapshot())).status).toBe('applied');
    expect(element.transport).not.toBe(transport); expect(element.editor).toBe(second);
    owner.remove(); await flush(); expect(element.transport).toBeUndefined(); expect(element.source.kind).toBe('empty');
    await expect(element.play()).rejects.toMatchObject({code: 'not-ready'});
    document.body.append(owner); await flush(); expect((await element.waitForDocumentRevision(second.getSnapshot())).status).toBe('applied');
  });
  it('handles ambiguous/empty selectors and explicit precedence without cross-document leakage', async () => {
    const first = editor(); const second = editor(); declaration('same', first); declaration('same', second);
    const element = document.createElement('audio-player') as AudioPlayerElement; element.setAttribute('editor', '#same'); document.body.append(element);
    expect(element.getAttribute('data-editor-state')).toBe('ambiguous');
    element.editor = first; await element.waitForDocumentRevision(first.getSnapshot()); expect(element.editor).toBe(first);
    const other = player(second); await other.waitForDocumentRevision(second.getSnapshot());
    first.transaction('Silence', (tx) => tx.add({type: 'insert-silence', frame: 0, length: 100, id: 's'}));
    await element.waitForDocumentRevision(first.getSnapshot()); expect(other.duration).toBe(1); expect(element.duration).toBe(1.1);
    element.editor = undefined; expect(element.getAttribute('data-editor-state')).toBe('ambiguous');
    element.setAttribute('editor', ''); expect(element.getAttribute('data-editor-state')).toBe('missing');
    await expect(element.play()).rejects.toMatchObject({code: 'not-ready'});
  });
  it('does not reattach obsolete owners after reentrant sourcechange replacement', async () => {
    const first = editor(); const second = editor(); const element = player(first);
    let replaced = false;
    element.addEventListener('webaudio:documentstatechange', () => {
      if (!replaced && element.documentBinding.status === 'ready') {replaced = true; element.editor = second;}
    });
    await flush(); expect(element.editor).toBe(second);
    expect((await element.waitForDocumentRevision(second.getSnapshot())).status).toBe('applied');
    expect(element.source).toMatchObject({kind: 'sequence', documentId: second.getSnapshot().documentId});
  });
});
