// @vitest-environment jsdom
import {afterEach, beforeAll, describe, expect, it, vi} from 'vitest';
import {createAudioClip} from '../../src/core';
import {createAudioClipEditor, type AudioClipEditor} from '../../src/edit/headless';
import {AudioPlayerElement, defineAudioPlayerElement} from '../../src/play/element/audio-player';
import {AudioPlayer, type AudioPlayerTransport} from '../../src/play/headless/audio-player';
import {AudioPlaylist} from '../../src/play/headless/playlist';

const loaded = vi.hoisted(() => ({clip: undefined as unknown}));
vi.mock('../../src/play/api/load', async (original) => ({...await original<object>(), loadClipFromUrl: vi.fn(async () => loaded.clip)}));

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
const node = () => ({connect: vi.fn(), disconnect: vi.fn()});
function context() {
  return {state: 'running', currentTime: 0, destination: node(), close: vi.fn(async () => {}), resume: vi.fn(async () => {}),
    createGain: vi.fn(() => ({...node(), gain: {value: 1}})), createStereoPanner: vi.fn(() => ({...node(), pan: {value: 0}})),
    createAnalyser: vi.fn(() => ({...node(), fftSize: 0, smoothingTimeConstant: 0})),
    createBuffer: vi.fn((channels: number, length: number, sampleRate: number) => {
      const data = Array.from({length: channels}, () => new Float32Array(length));
      return {numberOfChannels: channels, length, sampleRate, duration: length / sampleRate, getChannelData: (channel: number) => data[channel]};
    }),
    createBufferSource: vi.fn(() => ({...node(), playbackRate: {value: 1}, start: vi.fn(), stop: vi.fn()})),
  } as unknown as AudioContext;
}
const clip = (length = 2) => createAudioClip({sampleRate: 1000, channelData: [new Float32Array(length)]});
beforeAll(() => defineAudioPlayerElement());
afterEach(() => {document.body.replaceChildren(); for (const editor of editors.splice(0)) editor.dispose(); vi.restoreAllMocks();});

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
  it('keeps a missing or still-loading declaration pending without an error, then joins when it is ready', async () => {
    const errors: unknown[] = [];
    const element = document.createElement('audio-player') as AudioPlayerElement;
    element.addEventListener('webaudio:error', (event) => errors.push((event as CustomEvent).detail));
    element.setAttribute('editor', '#later'); document.body.append(element); await flush();
    expect(element.getAttribute('data-editor-state')).toBe('missing');
    expect(element.documentBinding.status).toBe('empty');
    // Rebuilding a preloading player while pending must not report the pending state.
    element.setAttribute('preload', ''); element.audioContext = context(); await flush();
    const target = document.createElement('div') as HTMLDivElement & {editor?: AudioClipEditor};
    target.id = 'later'; document.body.append(target); await flush();
    expect(element.getAttribute('data-editor-state')).toBe('unavailable');
    expect(element.documentBinding.status).toBe('empty');
    await expect(element.play()).rejects.toMatchObject({code: 'not-ready'});
    expect(errors).toEqual([]);
    const source = editor(); target.editor = source;
    target.dispatchEvent(new Event('webmusic:sourcechange', {bubbles: true}));
    expect((await element.waitForDocumentRevision(source.getSnapshot())).status).toBe('applied');
    expect(element.getAttribute('data-editor-state')).toBe('ready');
    expect(errors).toEqual([]);
    element.setAttribute('editor', ''); await flush();
    expect(element.getAttribute('data-editor-state')).toBe('invalid');
    expect(element.documentBinding.status).toBe('error'); expect(errors).toHaveLength(1);
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
    element.setAttribute('editor', ''); expect(element.getAttribute('data-editor-state')).toBe('invalid');
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

describe('Audio Player Element source recovery', () => {
  it('recovers when a clip, transport or player that existed before the editor is cleared', async () => {
    const source = editor(); declaration('doc', source);
    const element = player(); element.clip = clip();
    element.setAttribute('editor', '#doc'); await flush();
    expect(element.getAttribute('data-editor-state')).toBe('source-conflict');
    element.clip = undefined; await flush();
    expect((await element.waitForDocumentRevision(source.getSnapshot())).status).toBe('applied');
    expect(element.source.kind).toBe('sequence'); expect(element.clip).toBeUndefined();
    element.removeAttribute('editor'); const queue = {seconds: 0, duration: 1, playing: false, play: vi.fn(), pause: vi.fn(), stop: vi.fn(), seek: vi.fn()} satisfies AudioPlayerTransport;
    element.setTransport(queue); element.setAttribute('editor', '#doc'); await flush();
    expect(element.getAttribute('data-editor-state')).toBe('source-conflict');
    element.setTransport(undefined); await flush();
    expect((await element.waitForDocumentRevision(source.getSnapshot())).status).toBe('applied');
    element.removeAttribute('editor'); const external = new AudioPlayer(clip()); element.player = external;
    const pause = vi.spyOn(external, 'pause'), attach = vi.spyOn(external, 'setDocumentSource');
    element.setAttribute('editor', '#doc'); await flush();
    expect(element.getAttribute('data-editor-state')).toBe('source-conflict');
    expect(pause).not.toHaveBeenCalled(); expect(attach).not.toHaveBeenCalled();
    element.removeAttribute('editor'); expect(attach).not.toHaveBeenCalled(); element.setAttribute('editor', '#doc'); await flush();
    element.player = undefined; await flush();
    expect((await element.waitForDocumentRevision(source.getSnapshot())).status).toBe('applied');
    expect(element.player).not.toBe(external); expect(external.clip).toBeDefined(); expect(external.documentSource).toBeUndefined();
    external.dispose();
  });
  it('recovers after a src-loaded clip is removed from an editor-bound host', async () => {
    const source = editor(); declaration('doc', source); loaded.clip = clip();
    const element = document.createElement('audio-player') as AudioPlayerElement;
    element.audioContext = context(); element.setAttribute('src', '/take.wav'); document.body.append(element); await flush();
    expect(element.clip).toBe(loaded.clip);
    element.setAttribute('editor', '#doc'); await flush();
    expect(element.getAttribute('data-editor-state')).toBe('source-conflict');
    element.removeAttribute('src'); await flush();
    expect((await element.waitForDocumentRevision(source.getSnapshot())).status).toBe('applied');
    expect(element.clip).toBeUndefined(); expect(element.getAttribute('data-editor-state')).toBe('ready');
  });
  it('keeps the document transport when an editor-bound host clears setTransport', async () => {
    const source = editor(); const element = player(source); await element.waitForDocumentRevision(source.getSnapshot());
    const transport = element.transport; element.setTransport(undefined);
    expect(element.transport).toBe(transport); expect(element.source.kind).toBe('sequence');
    expect(element.documentBinding.status).toBe('ready');
  });
  it('reports the retained clip while no player exists', () => {
    const element = document.createElement('audio-player') as AudioPlayerElement; const details: unknown[] = [];
    element.addEventListener('webaudio:sourcechange', (event) => details.push((event as CustomEvent).detail));
    const data = clip(); element.clip = data;
    expect(element.source).toMatchObject({kind: 'clip', clip: data}); expect(details.at(-1)).toMatchObject({kind: 'clip', clip: data});
    document.body.append(element); element.remove();
    expect(element.player).toBeUndefined(); expect(element.clip).toBe(data);
    expect(details.at(-1)).toMatchObject({kind: 'clip', clip: data}); expect(element.source).toMatchObject({kind: 'clip', clip: data});
  });
  it('preloads an editor-bound sequence after its first applied revision', async () => {
    const source = editor(); const ctx = context(); const element = document.createElement('audio-player') as AudioPlayerElement;
    element.setAttribute('preload', ''); element.audioContext = ctx; element.editor = source; document.body.append(element);
    expect(ctx.createGain).not.toHaveBeenCalled();
    expect((await element.waitForDocumentRevision(source.getSnapshot())).status).toBe('applied'); await flush();
    expect(ctx.createGain).toHaveBeenCalledOnce(); expect(ctx.createBuffer).toHaveBeenCalled(); expect(ctx.resume).not.toHaveBeenCalled();
  });
  it('rebinds once a rejected preserves-pitch setting is removed', async () => {
    const source = editor(); const element = document.createElement('audio-player') as AudioPlayerElement; const errors: unknown[] = [];
    element.setAttribute('preserves-pitch', ''); element.editor = source;
    element.addEventListener('webaudio:error', (event) => errors.push((event as CustomEvent).detail));
    document.body.append(element); await flush();
    expect(errors).toEqual([expect.objectContaining({message: expect.stringMatching(/pitch preservation/)})]);
    expect(element.getAttribute('data-editor-state')).toBe('error');
    await expect(element.play()).rejects.toThrow(/pitch preservation/);
    element.removeAttribute('preserves-pitch');
    expect((await element.waitForDocumentRevision(source.getSnapshot())).status).toBe('applied');
    expect(element.getAttribute('data-editor-state')).toBe('ready'); expect(errors).toHaveLength(1);
  });
  it('keeps clip loop attributes away from a borrowed queue, as without editing', () => {
    const element = document.createElement('audio-player') as AudioPlayerElement; element.setAttribute('loop', '');
    document.body.append(element); const errors: unknown[] = [];
    element.addEventListener('webaudio:error', (event) => errors.push((event as CustomEvent).detail));
    const queue = new AudioPlaylist({entries: [{id: 'entry', clip: clip()}]}); const setLoop = vi.spyOn(queue, 'setLoop');
    element.setTransport(queue); element.setAttribute('loop', '0,0.001');
    expect(setLoop).not.toHaveBeenCalled(); expect(errors).toEqual([expect.objectContaining({message: expect.stringMatching(/setLoop/)})]);
    element.remove(); queue.dispose();
  });
});
