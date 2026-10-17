import {afterEach, describe, expect, it, vi} from 'vitest';
import {ScoreBuilder} from '@webmusic/score';
import {ScoreRackModule} from '@webmusic/score/play/headless';
import {AudioClipPlayer} from '@webmusic/audio/play/headless';
import {createAudioClip} from '@webmusic/audio';
import {
  ModuleAudioEnvironment, ModuleContext, ModuleProjectRuntime, ProjectPluginRegistry, parseModuleProject, AudioOutputPort, createConnectionLease,
  type ProjectFactoryRequest, type ProjectJson, type ProjectModuleInstance,
} from '@webmusic/kernel/module';
import {SessionTransport} from '@webmusic/kernel/session';
import {createWebMusicProjectPlugins} from '../src/project';

class Param {
  value = 1;
  defaultValue = 1;
  minValue = -3.4e38;
  maxValue = 3.4e38;
  automationRate = 'a-rate';
  cancelScheduledValues() { return this; }
  setValueAtTime(value: number) { this.value = value; return this; }
  linearRampToValueAtTime(value: number) { this.value = value; return this; }
}
class Node {
  gain = new Param();
  edges = new Set<unknown>();
  constructor(readonly context: Context) {}
  connect(node: unknown) { this.edges.add(node); return node; }
  disconnect(node?: unknown) { if (node) this.edges.delete(node); else this.edges.clear(); }
}
class Context {
  state = 'running';
  currentTime = 0;
  sampleRate = 48000;
  destination = new Node(this);
  nodes: Node[] = [];
  createGain = vi.fn(() => { const node = new Node(this); this.nodes.push(node); return node; });
  createBuffer(_channels: number, length: number, sampleRate: number) {
    const data = new Float32Array(length);
    return {duration: length / sampleRate, getChannelData: () => data} as unknown as AudioBuffer;
  }
  close = vi.fn();
  get native() { return this as unknown as AudioContext; }
}
const cleanups: Array<() => void> = [];
afterEach(() => { for (const dispose of cleanups.splice(0).reverse()) dispose(); vi.restoreAllMocks(); });

function setup(observe?: (instance: ProjectModuleInstance) => void) {
  const audio = new Context();
  const environment = new ModuleAudioEnvironment({context: audio.native});
  const plugins = new ProjectPluginRegistry();
  for (const factory of createWebMusicProjectPlugins()) plugins.register(observe ? {...factory,
    create: async request => { const instance = await factory.create(request); observe(instance); return instance; },
  } : factory);
  const runtime = new ModuleProjectRuntime({audio: environment, plugins});
  cleanups.push(() => runtime.dispose());
  return {audio, environment, plugins, runtime};
}

describe('standard WebMusic project factories', () => {
  it('restores actual effect parameters and nested normal routing with stable IDs', async () => {
    const {runtime, audio} = setup();
    const project = parseModuleProject({schema: 'webmusic.module-project', version: 1, id: 'desk',
      contexts: [{id: 'root'}, {id: 'channel', parentId: 'root', ownerModuleId: 'bus'}],
      modules: [
        {id: 'bus', contextId: 'root', plugin: {id: 'webmusic.audio-bus', version: '1.0.0'}, config: {gain: 0.7}},
        {id: 'voice', contextId: 'channel', plugin: {id: 'webmusic.effect', version: '1.0.0'}, config: {type: 'gain'}, params: {gain: 0.3}},
      ],
    });
    expect((await runtime.restore(project)).status).toBe('committed');
    const bus = runtime.getModule('bus')!, voice = runtime.getModule('voice')!;
    expect(voice.getPort?.('output')?.defaultDestination).toBe(bus.inserts?.input);
    expect(voice.params?.get('gain')?.snapshot.baseValue).toBe(0.3);
    voice.params!.get('gain')!.setBaseValue(0.6);
    const exported = runtime.exportProject();
    expect(exported.modules[1].params?.gain).toBe(0.6);
    runtime.updateLayout({modules: [{moduleId: 'voice', x: 40, y: 80}]});
    expect(runtime.getModule('voice')).toBe(voice);
    await runtime.restore(exported);
    expect(runtime.getModule('voice')).not.toBe(voice);
    expect(runtime.getModule('voice')?.params?.get('gain')?.snapshot.baseValue).toBe(0.6);
    expect(voice.getPort?.('output')?.disposed).toBe(true);
    runtime.dispose();
    expect(audio.close).not.toHaveBeenCalled();
    expect(audio.nodes.every(node => node.edges.size === 0)).toBe(true);
  });

  it('keeps the active graph when a known plugin configuration cannot be constructed', async () => {
    const {runtime} = setup();
    const project = {schema: 'webmusic.module-project', version: 1, id: 'desk', contexts: [{id: 'root'}],
      modules: [{id: 'bus', contextId: 'root', plugin: {id: 'webmusic.audio-bus', version: '1.0.0'}, config: {gain: 0.7}}]};
    await runtime.restore(project);
    const bus = runtime.getModule('bus');
    await expect(runtime.restore({...project, modules: [{...project.modules[0], config: {gain: 'invalid'}}]})).rejects.toThrow('gain');
    expect(runtime.getModule('bus')).toBe(bus);
    expect(bus?.getPort?.('output')?.disposed).toBe(false);
  });

  it.each(['webmusic.score-player', 'webmusic.audio-player'])('borrows assets and creates a lazy owned %s participant', async id => {
    const audio = new Context();
    const environment = new ModuleAudioEnvironment({context: audio.native});
    const session = new SessionTransport(() => audio.currentTime);
    cleanups.push(() => session.dispose());
    const context = new ModuleContext({id: 'root', audio: environment, session});
    const asset = id === 'webmusic.score-player' ? new ScoreBuilder().build() : createAudioClip({sampleRate: 48000, channelData: [new Float32Array(480)]});
    const request: ProjectFactoryRequest = {record: {id: 'lead', contextId: 'root', plugin: {id, version: '1.0.0'}, config: {}},
      context, signal: new AbortController().signal, asset: () => undefined, resolveAsset: async () => asset};
    const plugin = createWebMusicProjectPlugins().find(plugin => plugin.id === id)!;
    const instance = await plugin.create(request);
    cleanups.push(() => instance.dispose());
    expect(instance.module.id).toBe('lead');
    expect(context.registry.get('lead')).toBe(instance.module);
    expect(session.participantCount).toBe(1);
    const child = instance.childContext!(context.derive({id: 'child'}));
    expect(child.id).toBe('child');
    expect(child.target).toBe(instance.module);
    expect(child.audio).toBe(environment);
    expect(child.session).toBe(session);
    expect(audio.createGain).not.toHaveBeenCalled();
    instance.dispose(); instance.dispose();
    expect(context.registry.get('lead')).toBeUndefined();
    expect(session.participantCount).toBe(0);
    expect(audio.close).not.toHaveBeenCalled();
  });

  it('restores and exports Rack channel mixes by stable module ID, including unresolved channels', async () => {
    const racks: ScoreRackModule[] = [];
    const {runtime} = setup(instance => { if (instance.module instanceof ScoreRackModule) racks.push(instance.module); });
    await runtime.restore({schema: 'webmusic.module-project', version: 1, id: 'rack',
      contexts: [{id: 'root'}, {id: 'parts', parentId: 'root', ownerModuleId: 'desk'}], modules: [
        {id: 'desk', contextId: 'root', plugin: {id: 'webmusic.score-rack', version: '1.0.0'}, config: {masterVolume: 0.8, channels: {
          first: {volume: 0.3, muted: true}, second: {volume: 0.7, solo: true}, missing: {volume: 0.4, solo: false},
        }}},
        {id: 'first', contextId: 'parts', plugin: {id: 'webmusic.effect', version: '1.0.0'}, config: {type: 'gain'}},
        {id: 'second', contextId: 'parts', plugin: {id: 'webmusic.effect', version: '1.0.0'}, config: {type: 'gain'}},
      ]});
    const rack = racks[0];
    expect(rack.masterVolume).toBe(0.8);
    expect(rack.list().map(({id, volume, muted, solo}) => ({id, volume, muted, solo}))).toEqual([
      {id: 'first', volume: 0.3, muted: true, solo: false}, {id: 'second', volume: 0.7, muted: false, solo: true},
    ]);
    rack.setVolume('first', 0.6); rack.mute('first', false); rack.solo('second', false);
    const saved = runtime.exportProject();
    expect(saved.modules[0].config.channels).toEqual({first: {volume: 0.6, muted: false, solo: false},
      second: {volume: 0.7, muted: false, solo: false}, missing: {volume: 0.4, solo: false}});
    await runtime.restore(saved);
    const restored = racks[1];
    expect(restored.list().map(channel => channel.volume)).toEqual([0.6, 0.7]);
  });

  it('validates Rack channel state before allocating or registering a Rack', async () => {
    const {audio, environment} = setup();
    const context = new ModuleContext({id: 'root', audio: environment});
    const plugin = createWebMusicProjectPlugins().find(plugin => plugin.id === 'webmusic.score-rack')!;
    const invalidChannels: ProjectJson[] = [{lead: {volume: 2}}, {lead: {muted: 'yes'}}, []];
    for (const channels of invalidChannels) {
      const request: ProjectFactoryRequest = {record: {id: 'desk', contextId: 'root', plugin, config: {channels}},
        context, signal: new AbortController().signal, asset: () => undefined, resolveAsset: async () => undefined};
      expect(() => plugin.create(request)).toThrow();
      expect(context.registry.get('desk')).toBeUndefined();
    }
    expect(audio.createGain).not.toHaveBeenCalled();
  });

  it('releases an insert candidate if admission disposes its owning module reentrantly', async () => {
    const {audio, environment} = setup();
    const released = vi.fn();
    const context = new ModuleContext({id: 'root', audio: environment, admit: (_module, port) => {
      instance.dispose(); port.setDefault(audio.destination as unknown as AudioNode);
      return createConnectionLease(() => { port.setDefault(undefined); released(); });
    }});
    const plugin = createWebMusicProjectPlugins().find(plugin => plugin.id === 'webmusic.effect')!;
    const instance: ProjectModuleInstance = await plugin.create({record: {id: 'gain', contextId: 'root', plugin, config: {type: 'gain'}}, context,
      signal: new AbortController().signal, asset: () => undefined, resolveAsset: async () => undefined});
    expect(() => instance.module.prepare!()).toThrow('cancelled');
    expect(released).toHaveBeenCalledOnce();
    expect(context.registry.get('gain')).toBeUndefined();
    expect(audio.nodes.every(node => node.edges.size === 0)).toBe(true);
    expect(instance.module.getPort?.('output')).toBeUndefined();
  });

  it('releases an Audio admission that arrives after reentrant factory disposal', async () => {
    const {audio, environment} = setup();
    const port = new AudioOutputPort(audio.createGain() as unknown as AudioNode);
    cleanups.push(() => port.dispose());
    vi.spyOn(AudioClipPlayer.prototype, 'preload').mockResolvedValue();
    vi.spyOn(AudioClipPlayer.prototype, 'outputPort', 'get').mockReturnValue(port);
    const released = vi.fn();
    const context = new ModuleContext({id: 'root', audio: environment, admit: () => {
      instance.dispose();
      return createConnectionLease(released);
    }});
    const plugin = createWebMusicProjectPlugins().find(plugin => plugin.id === 'webmusic.audio-player')!;
    const instance: ProjectModuleInstance = await plugin.create({record: {id: 'clip', contextId: 'root', plugin, config: {}}, context,
      signal: new AbortController().signal, asset: () => undefined,
      resolveAsset: async () => createAudioClip({sampleRate: 48000, channelData: [new Float32Array(480)]})});
    await expect(instance.module.prepare!()).rejects.toThrow('cancelled');
    expect(released).toHaveBeenCalledOnce();
    expect(context.registry.get('clip')).toBeUndefined();
  });

  it('disposes a newly created LFO when its factory was disposed during native allocation', async () => {
    const {audio, environment} = setup();
    const session = new SessionTransport(() => audio.currentTime);
    cleanups.push(() => session.dispose());
    const context = new ModuleContext({id: 'root', audio: environment, session});
    const plugin = createWebMusicProjectPlugins().find(plugin => plugin.id === 'webmusic.lfo')!;
    const instance = await plugin.create({record: {id: 'lfo', contextId: 'root', plugin, config: {}}, context,
      signal: new AbortController().signal, asset: () => undefined, resolveAsset: async () => undefined});
    const create = audio.createGain.getMockImplementation()!;
    audio.createGain.mockImplementationOnce(() => { instance.dispose(); return create(); });
    expect(() => instance.module.prepare!()).toThrow('cancelled');
    expect(instance.getControl?.('output')).toBeUndefined();
    expect(context.registry.get('lfo')).toBeUndefined();
    expect(audio.nodes.every(node => node.edges.size === 0)).toBe(true);
  });

  it('rejects wrong or cancelled source assets before publishing a module', async () => {
    const {environment} = setup();
    const context = new ModuleContext({id: 'root', audio: environment});
    const controller = new AbortController();
    const plugin = createWebMusicProjectPlugins()[0];
    const request: ProjectFactoryRequest = {record: {id: 'lead', contextId: 'root', plugin, config: {}}, context,
      signal: controller.signal, asset: () => undefined, resolveAsset: async () => ({})};
    await expect(plugin.create(request)).rejects.toThrow('Score');
    controller.abort();
    await expect(plugin.create(request)).rejects.toThrow();
    expect(context.registry.snapshot()).toHaveLength(0);
  });
});
