// @vitest-environment jsdom
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {AudioOutputPort, getModulePort, ModuleAudioEnvironment, ModuleContext} from '@webmusic/kernel/module';
import {createAudioClip, type AudioClip} from '../../src/core';
import {AudioPlaylist} from '../../src/play/headless/playlist';
import {AudioPlayer} from '../../src/play/headless/audio-player';
import {AudioMixer} from '../../src/play/headless/mixer';
import {defineAudioPlaylistElement, type AudioPlaylistElement} from '../../src/play/element/audio-playlist';
import {defineAudioPlayerElement, type AudioPlayerElement} from '../../src/play/element/audio-player';

function node() { return {connect: vi.fn(), disconnect: vi.fn()}; }

class StubAudioContext {
  state = 'running';
  currentTime = 0;
  destination: {connect: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn>; context?: unknown} = {...node(), context: this};
  sources: Array<{onended: (() => void) | null}> = [];
  resume = vi.fn(async () => {});
  close = vi.fn(async () => {});
  createGain = vi.fn(() => ({...node(), context: this, gain: {value: 1}}));
  createStereoPanner = vi.fn(() => ({...node(), context: this, pan: {value: 0}}));
  createAnalyser = vi.fn(() => ({...node(), context: this, fftSize: 0, smoothingTimeConstant: 0}));
  createBuffer = vi.fn((channels: number, length: number, sampleRate: number) => ({
    numberOfChannels: channels, length, sampleRate, duration: length / sampleRate,
    getChannelData: () => new Float32Array(length),
  }));
  createBufferSource = vi.fn(() => {
    const source = {...node(), context: this, buffer: null, playbackRate: {value: 1}, loop: false, loopStart: 0, loopEnd: 0,
      onended: null as (() => void) | null, start: vi.fn(), stop: vi.fn()};
    this.sources.push(source);
    return source;
  });
}

function clip(seconds = 1): AudioClip {
  return createAudioClip({sampleRate: 1_000, channelData: [new Float32Array(seconds * 1_000)]});
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
beforeEach(() => { vi.stubGlobal('AudioContext', StubAudioContext); });
afterEach(() => { document.body.replaceChildren(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
defineAudioPlaylistElement();
defineAudioPlayerElement();

describe('a group backend publishes its output through the borrowing player (DEC-068)', () => {
  it('keeps one queue output port across entries and lists it on the player module', async () => {
    const context = new StubAudioContext() as unknown as AudioContext;
    const queue = new AudioPlaylist({audioContext: context, entries: [{id: 'a', clip: clip()}, {id: 'b', clip: clip()}]});
    const player = new AudioPlayer();
    player.setTransport(queue);
    const changed = vi.fn();
    const stop = player.module.subscribe!(changed);
    expect(queue.peekOutputPort()).toBeUndefined();
    expect(player.module.getPort!('output')).toBeUndefined();

    await queue.play();
    const port = queue.peekOutputPort()!;
    expect(port.id).toBe('output');
    expect(changed).toHaveBeenCalled();
    expect(getModulePort(player.module, 'output', 'audio', 'output')).toBe(port);
    expect(player.module.getPort!('main')).toBe(port);
    await queue.next();
    expect(queue.peekOutputPort()).toBe(port);
    expect(player.module.ports!()).toContain(port);

    player.setTransport(undefined);
    expect(player.module.ports!()).not.toContain(port);
    stop();
    queue.dispose();
    expect(port.disposed).toBe(true);
    player.dispose();
  });

  it('lists each committed mixer channel as a channel:<id> tap and the master through its transport', () => {
    const context = new StubAudioContext() as unknown as AudioContext;
    const mixer = new AudioMixer({audioContext: context});
    const source = new AudioOutputPort(context.createGain() as unknown as AudioNode);
    const lease = mixer.admitAudio('lead', source);
    const tap = getModulePort(mixer.module, 'channel:lead', 'audio', 'output') as AudioOutputPort;
    expect(tap.id).toBe('channel:lead');
    expect(mixer.module.getPort!('channel:lead')).toBe(tap);
    expect(mixer.transport.peekOutputPort!()).toBe(mixer.outputPort);
    const analyser = context.createAnalyser();
    const branch = tap.tap(analyser);
    branch.release();
    lease.release();
    expect(mixer.module.getPort!('channel:lead')).toBeUndefined();
    expect(tap.disposed).toBe(true);
    mixer.dispose();
  });
});

describe('a borrowed queue shares the scope clock', () => {
  it('adopts the module scope AudioContext before it builds audio, and refuses to migrate later', async () => {
    const scopeContext = new StubAudioContext() as unknown as AudioContext;
    const moduleContext = new ModuleContext({id: 'scope', audio: new ModuleAudioEnvironment({context: scopeContext})});
    const queue = new AudioPlaylist({entries: [{id: 'a', clip: clip()}]});
    const player = new AudioPlayer(undefined, {moduleContext});
    player.setTransport(queue);
    // Preparation adopts the scope's context, then builds the entry and the queue bus in it.
    await player.preload();
    expect(queue.peekOutputPort()!.context).toBe(scopeContext);
    expect(() => queue.adoptAudioContext(new StubAudioContext() as unknown as AudioContext)).toThrow(/another AudioContext/);
    queue.dispose();
    player.dispose();
  });

  it('fails preparation over an entry that did not load, so a Session never starts on it', async () => {
    const failure = new Error('decode failed');
    const queue = new AudioPlaylist({audioContext: new StubAudioContext() as unknown as AudioContext, skipFailed: false,
      entries: [{id: 'a', src: '/a.wav'}], loadEntry: () => Promise.reject(failure)});
    await expect(queue.preload()).rejects.toBe(failure);
    expect(queue.loadError).toBe(failure);
    queue.dispose();
  });
});

describe('<audio-player> over a nested playlist is one Session queue source', () => {
  it('keeps one participant across entries and re-anchors the Session at each entry', async () => {
    const element = document.createElement('audio-player') as AudioPlayerElement;
    const list = document.createElement('audio-playlist') as AudioPlaylistElement;
    list.entries = [{id: 'a', clip: clip(2)}, {id: 'b', clip: clip(2)}];
    element.append(list);
    document.body.append(element);
    await flush();
    const session = element.sessionTransport!;
    await vi.waitFor(() => expect(session.participantCount).toBe(1));
    await session.play();
    expect(list.playing).toBe(true);
    await session.seek(1.5);
    expect(session.position).toBeGreaterThanOrEqual(1.5);
    await list.playlist!.next();
    await vi.waitFor(() => expect(session.position).toBeLessThan(0.5));
    expect(session.participantCount).toBe(1);
    expect(list.playlist!.index).toBe(1);
    expect(element.module!.getPort!('output')).toBe(list.playlist!.peekOutputPort());
    // The player's own controls command the Session, which drives the queue.
    element.pause();
    await vi.waitFor(() => expect(session.snapshot.paused).toBe(true));
    expect(list.playing).toBe(false);
    await element.play();
    expect(session.snapshot.paused).toBe(false);
    expect(list.playing).toBe(true);
    element.remove();
  });
});
