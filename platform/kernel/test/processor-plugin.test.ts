import {afterEach, describe, expect, it, vi} from 'vitest';
import {
  ModuleAudioEnvironment, ModuleProjectRuntime, NoteOutputPort, ProjectPluginRegistry, parseModuleProject,
  type ModuleProject, type ProjectPluginFactory,
} from '../src/module';
import {
  isProcessorPrepared, prepareProcessor, processorPlugin, type ProcessorDefinition, type ProcessorNodeFactory,
} from '../src/processor';
import {FakeContext, FakeWorkletNode} from './processor-fakes';

const synth: ProcessorDefinition = {
  id: 'test.project-poly',
  version: '1.0.0',
  noteInput: true,
  params: [
    {id: 'cutoff', unit: 'hertz', range: {min: 20, max: 20000}, defaultValue: 2000, modulation: 'control-rate'},
    {id: 'release', unit: 'seconds', range: {min: 0, max: 5}, defaultValue: 0.3},
  ],
};

function project(overrides: Partial<ModuleProject> = {}): ModuleProject {
  return parseModuleProject({schema: 'webmusic.module-project', version: 1, id: 'song',
    contexts: [{id: 'root'}],
    modules: [
      {id: 'keys', contextId: 'root', plugin: {id: 'test.keys', version: '1'}, config: {}},
      {id: 'poly', contextId: 'root', plugin: {id: 'test.project-poly', version: '1.0.0'}, config: {voices: 8}, params: {release: 1.5}},
    ],
    connections: [{id: 'play', kind: 'note', from: {moduleId: 'keys', port: 'notes'}, to: {moduleId: 'poly', port: 'notes'}}],
    ...overrides});
}

/** A note producer module, so the project has a note connection to restore. */
function keysPlugin(outputs: NoteOutputPort[]): ProjectPluginFactory {
  return {id: 'test.keys', version: '1', create: ({record}) => {
    const notes = new NoteOutputPort({id: 'notes'});
    outputs.push(notes);
    return {module: {id: record.id, ports: () => [notes]}, ports: [{id: 'notes', kind: 'note', direction: 'output'}], dispose: () => notes.dispose()};
  }};
}

const runtimes: ModuleProjectRuntime[] = [];
afterEach(() => { for (const runtime of runtimes.splice(0)) runtime.dispose(); });

function setup(options: {source?: boolean; failLoad?: boolean} = {}) {
  const audio = new FakeContext();
  audio.state = 'running';
  if (options.failLoad) audio.audioWorklet.addModule = () => Promise.reject(new Error('404 poly.js'));
  const nodes: FakeWorkletNode[] = [];
  const createNode = vi.fn<ProcessorNodeFactory>((received, name, nodeOptions) => {
    const node = new FakeWorkletNode(received as unknown as FakeContext, name, nodeOptions,
      (synth.params ?? []).map(param => ({id: param.id, rate: param.modulation === 'audio-rate' ? 'a-rate' : 'k-rate'})));
    nodes.push(node);
    return node as unknown as AudioWorkletNode;
  });
  const reports: unknown[][] = [];
  const plugins = new ProjectPluginRegistry();
  const keys: NoteOutputPort[] = [];
  plugins.register(keysPlugin(keys));
  plugins.register(processorPlugin(synth, {
    createNode, onReport: (id, data) => reports.push([id, data]),
    ...(options.source ? {source: {module: '/poly.js'}} : {}),
  }));
  const runtime = new ModuleProjectRuntime({audio: new ModuleAudioEnvironment({context: audio as unknown as BaseAudioContext}), plugins});
  runtimes.push(runtime);
  return {audio, native: audio as unknown as BaseAudioContext, nodes, runtime, keys, reports};
}

describe('processorPlugin', () => {
  it('registers under the definition identity and describes the processor ports', () => {
    const plugin = processorPlugin({...synth, audioInputs: [{id: 'side', channels: 1}]});
    expect([plugin.id, plugin.version]).toEqual(['test.project-poly', '1.0.0']);
    expect(Object.isFrozen(plugin)).toBe(true);
  });

  it('restores a prepared processor with its config, saved parameters and note connection', async () => {
    const {native, nodes, runtime, keys} = setup();
    await prepareProcessor(native, synth, {module: '/poly.js'});
    expect((await runtime.restore(project())).status).toBe('committed');
    expect(runtime.snapshot().modules.map(module => module.status)).toEqual(['ready', 'ready']);
    expect(runtime.snapshot().modules[1].ports.map(port => `${port.kind}/${port.direction}/${port.id}`))
      .toEqual(['note/input/notes', 'audio/output/output']);
    expect(nodes[0].options.processorOptions).toMatchObject({config: {voices: 8}});
    expect(nodes[0].parameters.get('release')!.value).toBe(1.5);
    keys[0].emit({occurrenceId: 'a', sourceId: 'keys', pitch: {midi: 60}, velocity: 1, gate: 'on', axis: 'audio-context-seconds', time: 2, epoch: 0});
    expect(nodes[0].posted.at(-1)).toMatchObject({type: 'note', gate: 'on', midi: 60, frame: 96000});
  });

  it('saves live parameter values and the record, and releases the node with the project', async () => {
    const {native, nodes, runtime} = setup();
    await prepareProcessor(native, synth, {module: '/poly.js'});
    await runtime.restore(project());
    runtime.resources?.module('poly')?.params?.get('cutoff')?.setBaseValue(800);
    const saved = runtime.exportProject();
    expect(saved.modules[1]).toEqual({...project().modules[1], params: {release: 1.5, cutoff: 800}});
    runtime.dispose();
    expect([nodes[0].disconnected, nodes[0].closed]).toEqual([1, 1]);
  });

  it('keeps an unprepared processor unresolved with its record and routes, and recovers once prepared', async () => {
    const {native, nodes, runtime} = setup();
    await runtime.restore(project());
    const [, poly] = runtime.snapshot().modules;
    expect(poly.status).toBe('unresolved');
    expect(poly.diagnostic).toMatch(/not prepared .*no source/);
    expect(runtime.snapshot().unresolved.map(item => `${item.kind}:${item.id}`)).toEqual(['module:poly', 'connection:play']);
    expect(runtime.exportProject().modules[1]).toEqual(project().modules[1]);
    expect(runtime.exportProject().connections).toEqual(project().connections);
    expect(nodes).toHaveLength(0);
    await prepareProcessor(native, synth, {module: '/poly.js'});
    await runtime.retryMissing();
    expect(runtime.snapshot().unresolved).toEqual([]);
    expect(nodes[0].parameters.get('release')!.value).toBe(1.5);
  });

  it('prepares from its source during restore', async () => {
    const {native, runtime} = setup({source: true});
    await runtime.restore(project());
    expect(isProcessorPrepared(native, synth)).toBe(true);
    expect(runtime.snapshot().modules[1].status).toBe('ready');
  });

  it('keeps the module unresolved with the reason when its source fails to load', async () => {
    const {runtime} = setup({source: true, failLoad: true});
    expect((await runtime.restore(project())).status).toBe('committed');
    expect(runtime.snapshot().modules[1].diagnostic).toMatch(/could not be prepared: .*404 poly\.js/);
    expect(runtime.snapshot().modules[0].status).toBe('ready');
  });

  it('leaves a project saved with another processor version unresolved', async () => {
    const {native, runtime} = setup();
    await prepareProcessor(native, synth, {module: '/poly.js'});
    const older = project({modules: [project().modules[0], {...project().modules[1], plugin: {id: 'test.project-poly', version: '0.9.0'}}]});
    await runtime.restore(older);
    expect(runtime.snapshot().modules[1].diagnostic).toBe('Missing plugin test.project-poly@0.9.0.');
    expect(runtime.exportProject().modules[1].plugin.version).toBe('0.9.0');
  });

  it('relays processor reports with the module ID', async () => {
    const {native, nodes, runtime, reports} = setup();
    await prepareProcessor(native, synth, {module: '/poly.js'});
    await runtime.restore(project());
    nodes[0].receive({type: 'data', data: {peak: 0.5}});
    expect(reports).toEqual([['poly', {peak: 0.5}]]);
  });
});
