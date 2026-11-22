import {afterEach, describe, expect, it} from 'vitest';
import {
  ModuleAudioEnvironment, ModuleProjectRuntime, NoteOutputPort, ProjectPluginRegistry, WAM_MODULE, parseModuleProject, wamPlugin,
  type NoteInputPort, type WamConstructorLike,
} from '../src/module';
import {FakeContext, FakeNode} from './processor-fakes';

class FakeWamNode extends FakeNode {
  readonly scheduled: unknown[] = [];
  readonly set: Record<string, number> = {};
  destroyed = false;
  async getParameterInfo() {
    return {cutoff: {id: 'cutoff', label: 'Cutoff', type: 'float' as const, defaultValue: 1000, minValue: 20, maxValue: 20000, units: 'Hz', exponent: 1},
      mode: {id: 'mode', type: 'choice' as const, defaultValue: 0, minValue: 0, maxValue: 3}};
  }
  async getParameterValues() { return {cutoff: {value: 800}}; }
  async setParameterValues(values: Record<string, {value: number}>) { for (const [id, entry] of Object.entries(values)) this.set[id] = entry.value; }
  async getState() { return {preset: 'warm', cutoff: this.set.cutoff}; }
  scheduleEvents(...events: unknown[]) { this.scheduled.push(...events); }
  destroy() { this.destroyed = true; }
}

const runtimes: ModuleProjectRuntime[] = [];
afterEach(() => { for (const runtime of runtimes.splice(0)) runtime.dispose(); });

function setup(load: (url: string) => Promise<WamConstructorLike>) {
  const audio = new FakeContext();
  audio.state = 'running';
  audio.currentTime = 1;
  const groups: unknown[] = [];
  const plugins = new ProjectPluginRegistry();
  plugins.register(wamPlugin({hostGroup: context => { groups.push(context); return 'host-group'; }, load}));
  const runtime = new ModuleProjectRuntime({audio: new ModuleAudioEnvironment({context: audio as unknown as BaseAudioContext}), plugins});
  runtimes.push(runtime);
  return {audio, runtime, groups};
}
const record = (id: string, url: string, state?: object) => ({id, contextId: 'root', plugin: {id: 'webmusic.wam', version: '1.0.0'}, config: {url, ...(state ? {state} : {})}});
const project = (...modules: object[]) => parseModuleProject({schema: 'webmusic.module-project', version: 1, id: 'w', contexts: [{id: 'root'}], modules});

describe('wamPlugin', () => {
  it('exposes a WAM as ports, parameters, notes and a GUI', async () => {
    let node!: FakeWamNode;
    const created: unknown[] = [];
    const {audio, runtime, groups} = setup(async () => ({async createInstance(group, context, state) {
      created.push([group, state]);
      node = new FakeWamNode(context as unknown as FakeContext, 'wam');
      return {audioNode: node as never, descriptor: {name: 'Fake synth', hasAudioInput: false, hasAudioOutput: true, hasMidiInput: true}, createGui: async () => ({} as Element)};
    }}));
    await runtime.restore(project(record('synth', 'https://plugins.example/synth/index.js', {preset: 'init'})));
    expect(groups).toEqual([audio]);
    expect(created).toEqual([['host-group', {preset: 'init'}]]);
    expect(runtime.snapshot().modules[0]!.ports.map(port => port.id)).toEqual(['notes', 'output']);
    const params = runtime.getModule('synth')!.params!;
    expect(params.get('cutoff')!.snapshot.baseValue).toBe(800);
    expect(params.get('mode')!.descriptor.step).toBe(1);
    params.get('cutoff')!.setBaseValue(2000);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(node.set).toEqual({cutoff: 2000});
    expect(runtime.exportProject().modules[0]!.config).toEqual({url: 'https://plugins.example/synth/index.js', state: {preset: 'warm', cutoff: 2000}});
    const keys = new NoteOutputPort();
    (runtime.getModule('synth')!.ports!()[0] as NoteInputPort).connect(keys);
    keys.emit({occurrenceId: 'a', sourceId: 'k', pitch: {midi: 60}, velocity: 1, gate: 'on', axis: 'audio-context-seconds', time: 2, epoch: 0});
    keys.emit({occurrenceId: 'a', sourceId: 'k', pitch: {midi: 60}, velocity: 0, gate: 'off', axis: 'performance-seconds', time: 0, epoch: 0});
    expect(node.scheduled).toEqual([{type: 'wam-midi', time: 2, data: {bytes: [0x90, 60, 127]}}, {type: 'wam-midi', time: 1, data: {bytes: [0x80, 60, 0]}}]);
    expect(runtime.getModule('synth')!.capabilities!.get(WAM_MODULE)!.name).toBe('Fake synth');
    runtime.dispose();
    expect(node.destroyed).toBe(true);
  });

  it('leaves a module unresolved when the WAM fails to load or its URL is refused', async () => {
    const {runtime} = setup(async () => { throw new Error('404'); });
    await runtime.restore(project(record('a', 'https://plugins.example/missing.js'), record('b', 'javascript:alert(1)'), record('c', '')));
    expect(runtime.snapshot().modules.map(module => [module.status, module.diagnostic])).toEqual([
      ['unresolved', expect.stringMatching(/did not load: 404/)],
      ['unresolved', expect.stringMatching(/does not load/)],
      ['unresolved', expect.stringMatching(/URL/)],
    ]);
  });
});
