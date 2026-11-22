import {afterEach, describe, expect, it, vi} from 'vitest';
import {ManualMessageClock, ModuleAudioEnvironment, ModuleProjectRuntime, ProjectPluginRegistry, parseMessage, parseModuleProject, type Message} from '@webmusic/kernel/module';
import {createObjectPlugins} from '@webmusic/kernel/objects';
import {createAudioClip} from '../../src/core';
import {clipOfBuffer, createSamplerPlugins, sharedBuffersFor} from '../../src/play/headless/buffers';

class Node {
  readonly connections = new Set<Node>();
  gain = {value: 1, setValueAtTime: vi.fn(), cancelScheduledValues: vi.fn(), linearRampToValueAtTime: vi.fn(), setTargetAtTime: vi.fn()};
  playbackRate = {value: 1, setValueAtTime: vi.fn()};
  buffer?: unknown; loop = false; loopStart = 0; loopEnd = 0;
  onended: (() => void) | null = null;
  onaudioprocess: ((event: {inputBuffer: FakeBuffer}) => void) | null = null;
  start = vi.fn(); stop = vi.fn();
  constructor(readonly context: Context, readonly kind: string) {}
  connect(destination: Node): Node { this.connections.add(destination); return destination; }
  disconnect(destination?: Node): void { if (destination) this.connections.delete(destination); else this.connections.clear(); }
}
class FakeBuffer {
  readonly channels: Float32Array[];
  constructor(readonly numberOfChannels: number, readonly length: number, readonly sampleRate: number) { this.channels = Array.from({length: numberOfChannels}, () => new Float32Array(length)); }
  get duration() { return this.length / this.sampleRate; }
  getChannelData(channel: number) { return this.channels[channel]!; }
  copyToChannel(source: Float32Array, channel: number, offset = 0) { this.channels[channel]!.set(source, offset); }
}
class Context {
  currentTime = 0; state = 'running'; sampleRate = 100;
  destination = new Node(this, 'destination');
  nodes: Node[] = [];
  resume = async () => {};
  createGain() { return this.node('gain'); }
  createBufferSource() { return this.node('source'); }
  createScriptProcessor() { return this.node('processor'); }
  createBuffer(channels: number, length: number, rate: number) { return new FakeBuffer(channels, length, rate); }
  node(kind: string) { const node = new Node(this, kind); this.nodes.push(node); return node; }
}

const runtimes: ModuleProjectRuntime[] = [];
afterEach(() => { for (const runtime of runtimes.splice(0)) runtime.dispose(); });

function setup() {
  const audio = new Context();
  const clock = new ManualMessageClock(0);
  const printed: string[] = [];
  const plugins = new ProjectPluginRegistry();
  for (const plugin of [...createObjectPlugins({clock: () => clock, print: (name, text) => printed.push(text)}), ...createSamplerPlugins()]) plugins.register(plugin);
  const source = createAudioClip({sampleRate: 100, channelData: [Float32Array.from({length: 200}, (_, i) => i / 200)]});
  const runtime = new ModuleProjectRuntime({audio: new ModuleAudioEnvironment({context: audio as unknown as BaseAudioContext}), plugins, resolveAsset: async () => source});
  runtimes.push(runtime);
  const send = (id: string, text: string, time?: number) => (runtime.getModule(id)!.ports!().find(port => port.id === 'in0') as unknown as {receive(value: Message): void}).receive(parseMessage(text, time));
  return {audio, runtime, printed, send};
}
const object = (id: string, name: string, args: string, extra: object = {}) => ({id, contextId: 'root', plugin: {id: `webmusic.object.${name}`, version: '1.0.0'}, config: {args}, ...extra});
const cord = (id: string, from: string, to: string) => ({id, kind: 'message', from: {moduleId: from, port: 'out0'}, to: {moduleId: to, port: 'in0'}});

describe('shared buffers', () => {
  it('loads a named buffer from its asset and shares it with groove', async () => {
    const {audio, runtime, printed, send} = setup();
    await runtime.restore(parseModuleProject({schema: 'webmusic.module-project', version: 1, id: 'b', contexts: [{id: 'root'}],
      assets: [{id: 'a', uri: 'Arabesque%20No.1.wav'}],
      modules: [object('buf', 'buffer', 'loop', {assets: {source: 'a'}}), object('play', 'groove', 'loop'), object('log', 'print', '')],
      connections: [cord('c', 'buf', 'log')]}));
    const store = sharedBuffersFor(audio as unknown as BaseAudioContext);
    expect(store.get('loop')?.duration).toBe(2);
    send('buf', 'bang');
    expect(printed).toEqual(['loop 2. 1']);
    send('play', 'loop 0.5 1.5');
    send('play', 'bang', 0.25);
    const source = audio.nodes.find(node => node.kind === 'source')!;
    expect(source.start).toHaveBeenCalledWith(0.25, 0.5);
    expect([source.loop, source.loopStart, source.loopEnd]).toEqual([true, 0.5, 1.5]);
    send('play', 'stop', 1);
    expect(source.stop).toHaveBeenCalledWith(1);
    expect(clipOfBuffer(store.get('loop')!).duration).toBe(2);
    runtime.dispose();
    expect(store.get('loop')).toBeUndefined();
  });

  it('records its input into the buffer and bangs', async () => {
    const {audio, runtime, printed, send} = setup();
    await runtime.restore(parseModuleProject({schema: 'webmusic.module-project', version: 1, id: 'r', contexts: [{id: 'root'}],
      modules: [object('buf', 'buffer', 'take 0.5'), object('rec', 'record', 'take'), object('log', 'print', '')],
      connections: [cord('c', 'rec', 'log')]}));
    const store = sharedBuffersFor(audio as unknown as BaseAudioContext);
    expect(store.get('take')?.length).toBe(50);
    const changed = vi.fn();
    store.subscribe('take', changed);
    send('rec', 'start');
    const processor = audio.nodes.find(node => node.kind === 'processor')!;
    const chunk = new FakeBuffer(1, 4, 100); chunk.channels[0]!.set([1, 2, 3, 4]);
    processor.onaudioprocess!({inputBuffer: chunk});
    processor.onaudioprocess!({inputBuffer: chunk});
    send('rec', 'stop');
    expect(Array.from(store.get('take')!.getChannelData(1))).toEqual([1, 2, 3, 4, 1, 2, 3, 4]);
    expect(changed).toHaveBeenCalledTimes(1);
    expect(printed).toEqual(['bang']);
  });

  it('refuses an unnamed buffer', async () => {
    const {runtime} = setup();
    await runtime.restore(parseModuleProject({schema: 'webmusic.module-project', version: 1, id: 'u', contexts: [{id: 'root'}], modules: [object('buf', 'buffer', '')]}));
    expect(runtime.snapshot().modules[0]!.status).not.toBe('ready');
  });
});

describe('renderAudioClipEditor', () => {
  it('renders an edited clip back to samples', async () => {
    const {createAudioClipEditor, renderAudioClipEditor} = await import('../../src/view/headless');
    const editor = createAudioClipEditor(createAudioClip({sampleRate: 8000, channelData: [Float32Array.from({length: 8}, (_, i) => i)]}));
    editor.execute({version: 1, documentId: editor.getSnapshot().documentId, expectedRevision: 0, label: 'Trim', operations: [{type: 'trim', startFrame: 2, endFrame: 6}]});
    const clip = await renderAudioClipEditor(editor);
    expect([clip.sampleRate, Array.from(clip.channelData(0)!)]).toEqual([8000, [2, 3, 4, 5]]);
    editor.dispose();
  });
});

describe('buffer ownership', () => {
  it('keeps recorded samples across a rebuild with the same buffer, and releases with its owner', async () => {
    const {audio, runtime} = setup();
    const project = (args: string) => parseModuleProject({schema: 'webmusic.module-project', version: 1, id: 'k', contexts: [{id: 'root'}], modules: [object('buf', 'buffer', args)]});
    await runtime.restore(project('keep 0.5'));
    const store = sharedBuffersFor(audio as unknown as BaseAudioContext);
    const take = audio.createBuffer(2, 7, 100) as unknown as AudioBuffer;
    store.set('keep', take);
    await runtime.restore(project('keep 0.5'));
    expect(store.get('keep')).toBe(take);
    await runtime.restore(project('keep 2'));
    expect(store.get('keep')?.length).toBe(200);
    runtime.dispose();
    expect(store.get('keep')).toBeUndefined();
  });
});

describe('overlapping rebuilds', () => {
  it('keeps a buffer when a pending rebuild is cancelled', async () => {
    const {audio, runtime} = setup();
    const project = (extra: object[] = []) => parseModuleProject({schema: 'webmusic.module-project', version: 1, id: 'o', contexts: [{id: 'root'}],
      assets: [{id: 'a', uri: 'Arabesque%20No.1.wav'}], modules: [object('buf', 'buffer', 'keep 0.5'), ...extra]});
    await runtime.restore(project());
    const store = sharedBuffersFor(audio as unknown as BaseAudioContext);
    const kept = store.get('keep');
    // The candidate claims `keep`, then waits for its asset and is cancelled.
    const pending = runtime.restore(project([object('wav', 'buffer', 'other', {assets: {source: 'a'}})]));
    await Promise.resolve();
    runtime.cancelRestore();
    expect((await pending).status).toBe('cancelled');
    expect(store.get('keep')).toBe(kept);
  });
});
