import {afterEach, describe, expect, it, vi} from 'vitest';
import {
  AudioOutputPort, ModuleAudioEnvironment, ModuleProjectRuntime, ParamHandle, ParamSurface,
  ProjectPluginRegistry, createConnectionLease, createProjectEditorBinding, parseModuleProject,
  type ModuleProject, type ProjectFactoryRequest, type ProjectModuleInstance,
} from '../src/module';

class Parameter {
  value = 1;
  setValueAtTime(value: number) {this.value = value; return this;}
  cancelScheduledValues() {return this;}
}
class Node {
  readonly gain = new Parameter(); readonly offset = new Parameter();
  readonly edges = new Set<unknown>();
  readonly disconnect = vi.fn((target?: unknown) => {if (target) this.edges.delete(target); else this.edges.clear();});
  readonly start = vi.fn(); readonly stop = vi.fn();
  constructor(readonly context: Context) {}
  connect(target: unknown) {this.edges.add(target); return target;}
}
class Context {
  currentTime = 0; state = 'running'; sampleRate = 48000;
  readonly destination = new Node(this);
  readonly close = vi.fn();
  readonly createGain = vi.fn(() => new Node(this));
  readonly createConstantSource = vi.fn(() => new Node(this));
  get native(): BaseAudioContext {return this as unknown as BaseAudioContext;}
}
const runtimes: ModuleProjectRuntime[] = [];
afterEach(() => {for (const runtime of runtimes.splice(0)) runtime.dispose();});
function project(overrides: Partial<ModuleProject> = {}): ModuleProject {
  return parseModuleProject({schema: 'webmusic.module-project', version: 1, id: 'editor-project', contexts: [{id: 'root'}, {id: 'nested', parentId: 'root', ownerModuleId: 'desk'}], modules: [
    {id: 'desk', contextId: 'root', plugin: {id: 'processor', version: '1'}, config: {}},
    {id: 'source', contextId: 'nested', plugin: {id: 'processor', version: '1'}, config: {}},
    {id: 'sink', contextId: 'root', plugin: {id: 'processor', version: '1'}, config: {}},
  ], ...overrides});
}
function fixture() {
  const context = new Context(), plugins = new ProjectPluginRegistry(), disposals: ReturnType<typeof vi.fn>[] = [];
  const create = vi.fn((request: ProjectFactoryRequest): ProjectModuleInstance => {
    const node = context.createGain(), audioNode = node as unknown as AudioNode;
    const inputId = typeof request.record.config.inputId === 'string' ? request.record.config.inputId : 'input';
    const port = new AudioOutputPort(audioNode);
    const params = new ParamSurface(['gain', 'gain#1'].map(id => new ParamHandle({id, label: id === 'gain' ? 'Gain' : id, unit: 'ratio', range: {min: 0, max: 2}, defaultValue: 1, modulation: 'audio-rate'})));
    const dispose = vi.fn(() => {port.dispose(); for (const param of params) param.dispose(); node.disconnect();}); disposals.push(dispose);
    return {
      module: {id: request.record.id, params, prepare: () => port.setDefault(request.context.destination?.()), getPort: id => id === 'out' ? port : undefined},
      ports: [
        ...(request.record.config.noInputs ? [] : [{id: inputId, kind: 'audio' as const, direction: 'input' as const}]),
        ...(request.record.config.multipleInputs ? [{id: 'aux', kind: 'audio' as const, direction: 'input' as const}] : []),
        {id: 'out', kind: 'audio', direction: 'output'},
        {id: 'cv', kind: 'control', direction: 'output'}, {id: 'param:gain', kind: 'control', direction: 'input'},
        {id: 'param:stale', kind: 'control', direction: 'input'},
      ],
      childContext: child => request.record.config.inherit ? child : child.derive({id: child.id, destination: () => audioNode}),
      getInput: id => id === inputId ? audioNode : undefined,
      getControl: id => id === 'cv' ? {output: audioNode, rate: 'a-rate', range: {min: -1, max: 1}} : undefined,
      dispose,
    };
  });
  plugins.register({id: 'processor', version: '1', create});
  const connector = vi.fn(() => createConnectionLease(() => {}));
  const runtime = new ModuleProjectRuntime({audio: new ModuleAudioEnvironment({context: context.native}), plugins, connect: connector});
  runtimes.push(runtime);
  return {runtime, context, plugins, create, disposals, connector, editor: createProjectEditorBinding(runtime, {modulationDepth: 0.25})};
}
const audioPatch = {from: {moduleId: 'source', port: 'out'}, to: {moduleId: 'sink', port: 'input'}};
const controlSource = {moduleId: 'source', port: 'cv'};

describe('project editor structural adapter', () => {
  it('exposes retained module identities, signed layout and readonly live default routes', async () => {
    const {runtime, editor} = fixture();
    expect(editor.snapshot()).toEqual({modules: [], connections: [], disabled: true});
    await runtime.restore(project({layout: {modules: [{moduleId: 'source', x: -20, y: 40, collapsed: true}]}}));
    const state = editor.snapshot();
    expect(state.disabled).toBe(false);
    expect(state.modules.find(module => module.id === 'source')).toMatchObject({position: {x: -20, y: 40}});
    expect(state.connections).toContainEqual(expect.objectContaining({from: {moduleId: 'source', port: 'out'}, to: {moduleId: 'desk', port: 'input'}, mode: 'default', editable: false}));
    expect(() => editor.disconnect(state.connections[0].id)).toThrow('Default routes');
  });

  it('projects effective inherited default ownership through organizational contexts to a custom single input', async () => {
    const {runtime, editor} = fixture(), base = project();
    const restored = await runtime.restore(project({
      contexts: [...base.contexts, {id: 'group', parentId: 'nested'}],
      modules: base.modules.map(module => module.id === 'source' ? {...module, contextId: 'group'} : module.id === 'desk' ? {...module, config: {inputId: 'in'}} : module),
    }));
    expect(restored.snapshot.modules.find(module => module.record.id === 'source')?.defaultOwnerModuleId).toBe('desk');
    expect(runtime.snapshot().modules.find(module => module.record.id === 'source')?.defaultOwnerModuleId).toBe('desk');
    expect(editor.snapshot().connections.filter(connection => connection.mode === 'default')).toEqual([
      expect.objectContaining({from: {moduleId: 'source', port: 'out'}, to: {moduleId: 'desk', port: 'in'}}),
    ]);
    expect(runtime.snapshot().modules.find(module => module.record.id === 'desk')?.defaultOwnerModuleId).toBeUndefined();
  });

  it('uses effective routing when a declared owner only forwards its inherited context', async () => {
    const {runtime, editor} = fixture(), base = project();
    await runtime.restore(project({
      contexts: [...base.contexts, {id: 'group', parentId: 'nested', ownerModuleId: 'folder'}],
      modules: [...base.modules.map(module => module.id === 'source' ? {...module, contextId: 'group'} : module),
        {id: 'folder', contextId: 'nested', plugin: {id: 'processor', version: '1'}, config: {inherit: true}}],
    }));
    expect(runtime.snapshot().modules.find(module => module.record.id === 'source')?.defaultOwnerModuleId).toBe('desk');
    expect(editor.snapshot().connections.find(connection => connection.mode === 'default' && connection.from.moduleId === 'source')?.to).toEqual({moduleId: 'desk', port: 'input'});
  });

  it('stops at the actual changed owner and omits ambiguous multiple-input routes', async () => {
    const {runtime, editor} = fixture(), base = project();
    const child = project({
      contexts: [...base.contexts, {id: 'group', parentId: 'nested', ownerModuleId: 'inner'}],
      modules: [...base.modules.map(module => module.id === 'source' ? {...module, contextId: 'group'} : module),
        {id: 'inner', contextId: 'nested', plugin: {id: 'processor', version: '1'}, config: {inputId: 'in'}}],
    });
    await runtime.restore(child);
    expect(editor.snapshot().connections.find(connection => connection.mode === 'default' && connection.from.moduleId === 'source')?.to).toEqual({moduleId: 'inner', port: 'in'});
    await runtime.restore({...child, modules: child.modules.map(module => module.id === 'inner' ? {...module, config: {multipleInputs: true}} : module)});
    expect(runtime.snapshot().modules.find(module => module.record.id === 'source')?.defaultOwnerModuleId).toBe('inner');
    expect(editor.snapshot().connections.some(connection => connection.mode === 'default' && connection.from.moduleId === 'source')).toBe(false);
    expect(editor.snapshot().connections.some(connection => connection.mode === 'default' && connection.from.moduleId === 'inner')).toBe(true);
  });

  it('does not draw through an unavailable owner or a changed destination without an input descriptor', async () => {
    const {runtime, editor} = fixture(), base = project();
    const child = project({
      contexts: [...base.contexts, {id: 'group', parentId: 'nested', ownerModuleId: 'inner'}],
      modules: [...base.modules.map(module => module.id === 'source' ? {...module, contextId: 'group'} : module),
        {id: 'inner', contextId: 'nested', plugin: {id: 'absent', version: '1'}, config: {}}],
    });
    await runtime.restore(child);
    expect(runtime.snapshot().modules.find(module => module.record.id === 'source')?.status).toBe('unresolved');
    expect(editor.snapshot().connections.some(connection => connection.mode === 'default' && connection.from.moduleId === 'source')).toBe(false);
    await runtime.restore({...child, modules: child.modules.map(module => module.id === 'inner' ? {...module, plugin: {id: 'processor', version: '1'}, config: {noInputs: true}} : module)});
    expect(runtime.snapshot().modules.find(module => module.record.id === 'source')?.status).toBe('ready');
    expect(runtime.snapshot().modules.find(module => module.record.id === 'source')?.defaultOwnerModuleId).toBeUndefined();
    expect(editor.snapshot().connections.some(connection => connection.mode === 'default' && connection.from.moduleId === 'source')).toBe(false);
  });

  it('keeps default audio for send/tap, restores it after replacement removal, and preserves playing instances', async () => {
    const {runtime, editor, create, disposals} = fixture(); await runtime.restore(project());
    const source = runtime.getModule('source'), session = runtime.session;
    await editor.connect({...audioPatch, mode: 'send'});
    await editor.connect({...audioPatch, mode: 'tap'});
    expect(editor.snapshot().connections.filter(connection => connection.mode === 'default')).toHaveLength(1);
    await editor.connect({...audioPatch, mode: 'replace'});
    expect(editor.snapshot().connections.some(connection => connection.mode === 'default')).toBe(false);
    const replacement = editor.snapshot().connections.find(connection => connection.mode === 'replace')!;
    editor.disconnect(replacement.id);
    expect(editor.snapshot().connections.filter(connection => connection.mode === 'default')).toHaveLength(1);
    expect(runtime.getModule('source')).toBe(source); expect(runtime.session).toBe(session);
    expect(create).toHaveBeenCalledTimes(3); expect(disposals.every(dispose => dispose.mock.calls.length === 0)).toBe(true);
  });

  it('separates native param:-prefixed ports from collision-safe parameter inputs and routes their distinct commands', async () => {
    const {runtime, editor, connector} = fixture(); await runtime.restore(project());
    const ports = editor.snapshot().modules.find(module => module.id === 'sink')!.ports;
    const gain = ports.find(port => port.parameterId === 'gain')!;
    expect(gain.id).not.toBe('param:gain'); expect(gain.id).not.toBe('param:gain#1');
    expect(new Set(ports.map(port => port.id)).size).toBe(ports.length);
    await editor.connect({from: controlSource, to: {moduleId: 'sink', port: 'param:gain'}, mode: 'connect'});
    expect(connector).toHaveBeenCalledOnce();
    expect(runtime.exportProject().connections[0].to.port).toBe('param:gain');
    expect(runtime.exportProject().modulations).toEqual([]);
    await editor.connect({from: controlSource, to: {moduleId: 'sink', port: gain.id}, mode: 'connect'});
    expect(runtime.exportProject().modulations).toEqual([{id: 'patch-2', source: controlSource, target: {moduleId: 'sink', param: 'gain'}, depth: 0.25}]);
    const mapped = editor.snapshot().connections.find(connection => connection.id.startsWith('modulation:'))!;
    expect(mapped.to.port).toBe(gain.id); expect(mapped.status).toBe('connected');
    expect(editor.snapshot().modules.find(module => module.id === 'sink')!.ports.find(port => port.parameterId === 'gain')!.label).toBe('Gain');
    editor.disconnect(mapped.id);
    expect(runtime.exportProject().modulations).toEqual([]); expect(runtime.exportProject().connections).toHaveLength(1);
  });

  it('retains unavailable plugin plugs and keeps connection and modulation namespaces independent', async () => {
    const {runtime, editor} = fixture(), base = project();
    await runtime.restore(project({modules: base.modules.map(module => module.id === 'sink' ? {...module, plugin: {id: 'absent', version: '2'}} : module),
      connections: [{id: 'same', kind: 'control', from: controlSource, to: {moduleId: 'sink', port: 'param:gain'}}],
      modulations: [{id: 'same', source: controlSource, target: {moduleId: 'sink', param: 'gain'}, depth: 1}],
    }));
    const state = editor.snapshot(), missing = state.modules.find(module => module.id === 'sink')!;
    expect(missing.status).toBe('unresolved'); expect(missing.diagnostic).toContain('absent@2');
    expect(new Set(missing.ports.map(port => port.id)).size).toBe(2);
    const connection = state.connections.find(record => record.id === 'connection:same')!;
    const modulation = state.connections.find(record => record.id === 'modulation:same')!;
    expect(connection.status).toBe('unresolved'); expect(modulation.status).toBe('unresolved');
    expect(connection.to.port).not.toBe(modulation.to.port);
    editor.disconnect('connection:same');
    expect(runtime.exportProject().connections).toEqual([]); expect(runtime.exportProject().modulations).toHaveLength(1);
    await expect(editor.connect({from: controlSource, to: modulation.to, mode: 'connect'})).rejects.toThrow('unavailable');
  });

  it('does not draw a missing parameter mapping onto an unrelated native plug with a similar name', async () => {
    const {runtime, editor} = fixture();
    await runtime.restore(project({modulations: [{id: 'lost', source: controlSource, target: {moduleId: 'sink', param: 'stale'}, depth: 1}]}));
    const state = editor.snapshot(), mapping = state.connections.find(record => record.id === 'modulation:lost')!;
    expect(mapping.status).toBe('unresolved'); expect(mapping.to.port).not.toBe('param:stale');
    expect(state.modules.find(module => module.id === 'sink')!.ports.some(port => port.id === mapping.to.port)).toBe(false);
  });

  it('moves saved layout independently of routing, preserves extra layout fields and borrows runtime lifetime', async () => {
    const {runtime, editor, create, disposals, context} = fixture();
    await runtime.restore(project({layout: {modules: [{moduleId: 'source', x: 10, y: 20, collapsed: true}]}}));
    const notify = vi.fn(), unsubscribe = editor.subscribe(notify), source = runtime.getModule('source');
    editor.moveModule('source', {x: -40, y: -10});
    expect(runtime.exportProject().layout.modules).toEqual([{moduleId: 'source', x: -40, y: -10, collapsed: true}]);
    expect(runtime.getModule('source')).toBe(source); expect(create).toHaveBeenCalledTimes(3);
    expect(notify).toHaveBeenCalled(); unsubscribe(); const count = notify.mock.calls.length;
    editor.moveModule('source', {x: 0, y: 0}); expect(notify).toHaveBeenCalledTimes(count);
    expect(disposals.every(dispose => dispose.mock.calls.length === 0)).toBe(true); expect(context.close).not.toHaveBeenCalled();
    expect(() => editor.moveModule('gone', {x: 0, y: 0})).toThrow('Unknown module');
  });

  it('rejects incompatible modes and directions without altering saved wiring', async () => {
    const {runtime, editor} = fixture(); await runtime.restore(project());
    await expect(editor.connect({...audioPatch, mode: 'connect'})).rejects.toThrow('Audio patches');
    await expect(editor.connect({from: controlSource, to: {moduleId: 'sink', port: 'param:gain'}, mode: 'send'})).rejects.toThrow('connect mode');
    await expect(editor.connect({from: audioPatch.to, to: audioPatch.from, mode: 'replace'})).rejects.toThrow('compatible');
    expect(runtime.exportProject().connections).toEqual([]);
    runtime.dispose(); expect(editor.snapshot().disabled).toBe(true);
    await expect(editor.connect({...audioPatch, mode: 'send'})).rejects.toThrow('not editable');
  });
});
