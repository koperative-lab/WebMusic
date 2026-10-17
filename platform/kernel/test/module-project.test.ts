import {afterEach, describe, expect, it, vi, type Mock} from 'vitest';
import {
  AudioOutputPort, ModuleAudioEnvironment, ModuleProjectRuntime, ParamHandle, ParamSurface,
  ProjectPluginRegistry, createConnectionLease, parseModuleProject, serializeModuleProject,
  type ConnectionLease, type ModuleProject, type ModuleRegistry, type ProjectFactoryRequest, type ProjectJsonObject, type ProjectModuleInstance,
} from '../src/module';

function document(overrides: Partial<ModuleProject> = {}): ModuleProject {
  return parseModuleProject({schema: 'webmusic.module-project', version: 1, id: 'project',
    contexts: [{id: 'root'}], modules: [
      {id: 'voice', contextId: 'root', plugin: {id: 'gain', version: '1'}, config: {}, params: {gain: 0.4}},
      {id: 'output', contextId: 'root', plugin: {id: 'gain', version: '1'}, config: {}},
    ], connections: [{id: 'route', kind: 'audio', from: {moduleId: 'voice', port: 'out'}, to: {moduleId: 'output', port: 'in'}, mode: 'replace'}],
    ...overrides});
}
class Parameter {
  value = 1;
  automationRate = 'a-rate';
  readonly events: unknown[][] = [];
  onSet?: (value: number) => void;
  setValueAtTime(value: number, time: number) { this.onSet?.(value); this.value = value; this.events.push(['set', value, time]); return this; }
  cancelScheduledValues(time: number) { this.events.push(['cancel', time]); return this; }
  linearRampToValueAtTime(value: number, time: number) { this.events.push(['linear', value, time]); return this; }
  exponentialRampToValueAtTime(value: number, time: number) { this.events.push(['exponential', value, time]); return this; }
}
class Node {
  readonly gain = new Parameter();
  readonly offset = new Parameter();
  readonly frequency = new Parameter();
  readonly edges = new Set<unknown>();
  readonly disconnect = vi.fn((target?: unknown) => { if (target) this.edges.delete(target); else this.edges.clear(); });
  readonly start = vi.fn();
  readonly stop = vi.fn();
  constructor(readonly context: Context) {}
  connect(target: unknown) { this.edges.add(target); return target; }
}
class Context {
  currentTime = 10;
  state = 'running';
  sampleRate = 48000;
  readonly nodes: Node[] = [];
  readonly destination = new Node(this);
  readonly close = vi.fn();
  readonly createGain = vi.fn(() => this.node());
  readonly createConstantSource = vi.fn(() => this.node());
  readonly createOscillator = vi.fn(() => this.node());
  private node(): Node { const node = new Node(this); this.nodes.push(node); return node; }
  get native(): BaseAudioContext { return this as unknown as BaseAudioContext; }
}
interface Instance extends ProjectModuleInstance { readonly node: Node; readonly dispose: Mock<() => void>; readonly request: ProjectFactoryRequest }
function setup() {
  const context = new Context(), plugins = new ProjectPluginRegistry();
  const created: Instance[] = [];
  const create = vi.fn((request: ProjectFactoryRequest): Instance => {
    const node = context.createGain();
    const output = new AudioOutputPort(node as unknown as AudioNode);
    const gain = new ParamHandle({id: 'gain', unit: 'ratio', range: {min: 0, max: 2}, defaultValue: 1, modulation: 'audio-rate', updateTiming: 'scheduled'}, {apply: value => { node.gain.value = value; }});
    const instance: Instance = {
      node, request,
      module: {id: request.record.id, params: new ParamSurface([gain]),
        prepare: () => { output.setDefault(request.context.destination?.()); },
        getPort: id => id === 'out' ? output : undefined},
      ports: [{id: 'out', kind: 'audio', direction: 'output'}, {id: 'in', kind: 'audio', direction: 'input'}],
      getInput: id => id === 'in' ? node as unknown as AudioNode : undefined,
      getControl: id => id === 'cv' ? {output: node as unknown as AudioNode, rate: 'a-rate', range: {min: -1, max: 1}} : undefined,
      childContext: scope => scope,
      dispose: vi.fn(() => { output.dispose(); gain.dispose(); node.disconnect(); }),
    };
    created.push(instance); return instance;
  });
  plugins.register({id: 'gain', version: '1', create});
  const audio = new ModuleAudioEnvironment({context: context.native});
  const runtime = new ModuleProjectRuntime({audio, plugins});
  return {context, plugins, created, create, audio, runtime};
}
const runtimes: ModuleProjectRuntime[] = [];
afterEach(() => { for (const runtime of runtimes.splice(0)) runtime.dispose(); });
function fixture() { const result = setup(); runtimes.push(result.runtime); return result; }

describe('versioned module project data', () => {
  it('round-trips exact stable IDs, source references and unavailable plugin configuration', () => {
    const project = document({assets: [{id: 'midi', uri: 'app:lead.mid', mediaType: 'audio/midi'}], modules: [
      {id: 'voice', contextId: 'root', plugin: {id: 'not-installed', version: '2.4'}, label: 'Lead', config: {envelope: [0.1, 0.2, 0.5, 0.3]}, assets: {source: 'midi'}, params: {cutoff: 1200}},
      {id: 'output', contextId: 'root', plugin: {id: 'gain', version: '1'}, config: {}},
    ], layout: {modules: [{moduleId: 'voice', x: 100, y: 50}]}});
    expect(parseModuleProject(serializeModuleProject(project))).toEqual(project);
    expect(Object.isFrozen(project.modules[0].config)).toBe(true);
    expect(project.modules[0].plugin.version).toBe('2.4');
  });

  it('rejects accessors without invoking them and rejects native/prototype data', () => {
    const read = vi.fn(() => 'value');
    const data = {...document(), config: {}};
    Object.defineProperty(data, 'id', {get: read, enumerable: true});
    expect(() => parseModuleProject(data)).toThrow('accessors');
    expect(read).not.toHaveBeenCalled();
    expect(() => parseModuleProject('{"schema":"webmusic.module-project","version":1,"__proto__":{"polluted":true}}')).toThrow('unsafe');
    expect(() => parseModuleProject({...document(), modules: [{...document().modules[0], config: {node: new Date()}}]})).toThrow('plain prototypes');
    expect(({} as {polluted?: boolean}).polluted).toBeUndefined();
  });

  it('rejects cycles, sparse arrays, oversized structures, nonfinite numbers and unsupported versions', () => {
    const cyclic: Record<string, unknown> = {}; cyclic.self = cyclic;
    expect(() => parseModuleProject(cyclic)).toThrow('cycles');
    expect(() => parseModuleProject({...document(), assets: Array(2)})).toThrow('holes');
    expect(() => parseModuleProject({...document(), id: 'a'.repeat(300)})).toThrow('256');
    expect(() => parseModuleProject({...document(), session: {positionSeconds: Infinity, rate: 1}})).toThrow('finite');
    expect(() => parseModuleProject({...document(), version: 2})).toThrow('schema/version');
  });

  it('rejects encoded JSON that escapes beyond the parser text limit', () => {
    const initial = document();
    const config = Object.fromEntries(Array.from({length: 6}, (_, index) => [`text${index}`, '\u0001'.repeat(60000)]));
    const accepted = document({modules: [{...initial.modules[0], config}, initial.modules[1]]});
    expect(() => serializeModuleProject(accepted)).toThrow('Project JSON text exceeds size limit.');
    expect(() => parseModuleProject(JSON.stringify(accepted))).toThrow('Project JSON text exceeds size limit.');
    const smaller = document({modules: [{...initial.modules[0], config: {text: '\u0001'.repeat(60000)}}, initial.modules[1]]});
    expect(parseModuleProject(serializeModuleProject(smaller))).toEqual(smaller);
  });

  it('checks indentation against the same text limit without rejecting compact output', () => {
    let config: ProjectJsonObject = Object.fromEntries(Array.from({length: 4}, (_, index) => [`values${index}`, Array<number>(10000).fill(0)]));
    for (let depth = 0; depth < 24; depth++) config = {nested: config};
    const initial = document();
    const accepted = document({modules: [{...initial.modules[0], config}, initial.modules[1]]});
    expect(parseModuleProject(serializeModuleProject(accepted))).toEqual(accepted);
    expect(() => serializeModuleProject(accepted, 2)).toThrow('Project JSON text exceeds size limit.');
  });

  it('rejects identity collisions, dangling references, context cycles and owner dependency cycles', () => {
    const project = document();
    expect(() => document({modules: [project.modules[0], project.modules[0]]})).toThrow('duplicate ID');
    expect(() => document({contexts: [{id: 'root'}, {id: 'child', parentId: 'missing'}]})).toThrow('Missing parent');
    expect(() => document({contexts: [{id: 'root'}, {id: 'a', parentId: 'b'}, {id: 'b', parentId: 'a'}]})).toThrow('cycle');
    expect(() => document({contexts: [{id: 'root'}, {id: 'child', parentId: 'root', ownerModuleId: 'voice'}], modules: [{...project.modules[0], contextId: 'child'}, project.modules[1]]})).toThrow('direct parent');
    expect(() => document({modules: [{...project.modules[0], assets: {source: 'missing'}}, project.modules[1]]})).toThrow('missing asset');
  });

  it('rejects duplicate replacement routes, audio feedback, duplicate automation and unordered timelines', () => {
    const project = document();
    expect(() => document({connections: [...project.connections, {...project.connections[0], id: 'duplicate'}]})).toThrow('one replacement');
    expect(() => document({connections: [...project.connections, {id: 'back', kind: 'audio', from: {moduleId: 'output', port: 'out'}, to: {moduleId: 'voice', port: 'in'}}]})).toThrow('feedback');
    const track = {id: 'lane', target: {moduleId: 'voice', param: 'gain'}, points: [{type: 'set' as const, timeSeconds: 0, value: 0.5}]};
    expect(() => document({automation: [track, {...track, id: 'second'}]})).toThrow('one project automation');
    expect(() => document({automation: [{...track, points: [{type: 'set', timeSeconds: 1, value: 0.5}, {type: 'linear', timeSeconds: 0, value: 1}]}]})).toThrow('ordered');
  });
});

describe('owned project restoration', () => {
  it('prepares one graph, captures live parameters/macros, and keeps storage and audio ownership external', async () => {
    const {runtime, context, created} = fixture();
    await expect(runtime.restore(document({macros: [{id: 'level', value: 0.4, targets: [{moduleId: 'voice', param: 'gain', min: 0, max: 1}]}], session: {positionSeconds: 2, rate: 1.5, loop: {startSeconds: 1, endSeconds: 4}}}))).resolves.toMatchObject({status: 'committed'});
    expect(runtime.session?.snapshot).toMatchObject({paused: true, position: 2, rate: 1.5});
    expect(created).toHaveLength(2);
    expect(created[0].node.edges.has(created[1].node)).toBe(true);
    expect(created[0].module.params?.get('gain')?.snapshot.baseValue).toBe(0.4);
    runtime.getMacro('level')!.setValue(0.7);
    const saved = runtime.exportProject();
    expect(saved.modules[0].params?.gain).toBe(0.7);
    expect(saved.macros[0].value).toBe(0.7);
    runtime.dispose(); runtime.dispose();
    expect(created.every(instance => instance.dispose.mock.calls.length === 1)).toBe(true);
    expect(context.close).not.toHaveBeenCalled();
  });

  it('renames, reorders and moves modules without rebuilding or changing IDs/connections', async () => {
    const {runtime, create, created} = fixture();
    await runtime.restore(document());
    const session = runtime.session, original = runtime.getModule('voice');
    runtime.updatePresentation({modules: [{id: 'output', label: 'New output'}, {id: 'voice', label: 'Renamed lead'}]});
    runtime.updateLayout({modules: [{moduleId: 'voice', x: -20, y: 40}]});
    expect(runtime.getModule('voice')).toBe(original);
    expect(runtime.session).toBe(session);
    expect(create).toHaveBeenCalledTimes(2);
    expect(created.every(instance => instance.dispose.mock.calls.length === 0)).toBe(true);
    expect(runtime.exportProject().modules.map(module => module.id)).toEqual(['output', 'voice']);
    expect(runtime.exportProject().connections[0].from.moduleId).toBe('voice');
    expect(runtime.exportProject().layout.modules[0]).toEqual({moduleId: 'voice', x: -20, y: 40});
  });

  it('retains missing exact plugin versions and incident routes, then retries after registration', async () => {
    const {runtime, plugins, create} = fixture();
    const initial = document();
    const missing = document({modules: [initial.modules[0], {...initial.modules[1], plugin: {id: 'gain', version: '2'}}]});
    await runtime.restore(missing);
    expect(runtime.snapshot().modules[1].status).toBe('unresolved');
    expect(runtime.snapshot().unresolved.map(item => item.kind)).toContain('connection');
    expect(runtime.exportProject().modules[1].plugin.version).toBe('2');
    expect(runtime.exportProject().connections).toEqual(missing.connections);
    plugins.register({id: 'gain', version: '2', create});
    await runtime.retryMissing();
    expect(runtime.snapshot().unresolved).toEqual([]);
    expect(runtime.snapshot().modules.every(module => module.status === 'ready')).toBe(true);
  });

  it('retains unsupported domain signals without silently connecting them', async () => {
    const {runtime} = fixture();
    await runtime.restore(document({connections: [{id: 'notes', kind: 'note', from: {moduleId: 'voice', port: 'notes'}, to: {moduleId: 'output', port: 'notes'}}]}));
    expect(runtime.snapshot().unresolved).toEqual([{kind: 'connection', id: 'notes', reason: 'Signal endpoints or a matching connector are unavailable.'}]);
    expect(runtime.exportProject().connections[0].kind).toBe('note');
  });

  it('builds nested scopes after owners and leaves descendants unresolved when the owner is absent', async () => {
    const {runtime, created} = fixture();
    const project = document({contexts: [{id: 'root'}, {id: 'nested', parentId: 'root', ownerModuleId: 'output'}], modules: [
      {id: 'voice', contextId: 'nested', plugin: {id: 'gain', version: '1'}, config: {}},
      {id: 'output', contextId: 'root', plugin: {id: 'gain', version: '1'}, config: {}},
    ]});
    await runtime.restore(project);
    expect(created.map(instance => instance.module.id)).toEqual(['output', 'voice']);
    expect(created[1].request.context.registry).not.toBe(created[0].request.context.registry);
    expect(created[1].request.context.session).toBe(created[0].request.context.session);
    await runtime.restore({...project, modules: project.modules.map(module => module.id === 'output' ? {...module, plugin: {id: 'absent', version: '1'}} : module)});
    expect(runtime.getModule('voice')).toBeUndefined();
    expect(runtime.snapshot().unresolved.some(item => item.kind === 'context' && item.id === 'nested')).toBe(true);
  });

  it('keeps the old running graph intact when candidate construction or parameter application fails', async () => {
    const {runtime, plugins, created, context} = fixture();
    await runtime.restore(document());
    await runtime.session!.play();
    const original = runtime.getModule('voice'), oldSession = runtime.session;
    const oldGate = context.nodes[0];
    plugins.register({id: 'bad', version: '1', create: () => { throw new Error('factory failed'); }});
    await expect(runtime.restore({...document(), modules: [{...document().modules[0], plugin: {id: 'bad', version: '1'}}, document().modules[1]]})).rejects.toThrow('factory failed');
    expect(runtime.getModule('voice')).toBe(original);
    expect(runtime.session).toBe(oldSession);
    expect(oldSession!.snapshot.paused).toBe(false);
    expect(oldGate.gain.value).toBe(1);
    expect(created.slice(0, 2).every(instance => instance.dispose.mock.calls.length === 0)).toBe(true);
    await expect(runtime.restore({...document(), modules: [{...document().modules[0], params: {gain: 3}}, document().modules[1]]})).rejects.toThrow();
    expect(runtime.getModule('voice')).toBe(original);
    expect(created.at(-1)!.dispose).toHaveBeenCalledOnce();
  });

  it.each(['throwing exporter', 'unsafe exported config', 'throwing ports'] as const)('rejects a %s before replacing the running graph', async failure => {
    const {runtime, plugins, create, created, context} = fixture();
    await runtime.restore(document());
    await runtime.session!.play();
    const original = runtime.getModule('voice'), oldSession = runtime.session, oldGate = context.nodes[0];
    plugins.register({id: 'bad-snapshot', version: '1', create: request => {
      const instance = create(request);
      return {...instance,
        get ports() { if (failure === 'throwing ports') throw new Error('Port descriptor failure.'); return instance.ports; },
        exportConfig: (): ProjectJsonObject => {
          if (failure === 'throwing exporter') throw new Error('Export failure.');
          return failure === 'unsafe exported config' ? {constructor: 'forbidden'} : {};
        },
      };
    }});
    const initial = document();
    await expect(runtime.restore({...initial, modules: [{...initial.modules[0], plugin: {id: 'bad-snapshot', version: '1'}}, initial.modules[1]]})).rejects.toThrow(/Export failure|unsafe|Port descriptor failure/);
    expect(runtime.getModule('voice')).toBe(original);
    expect(runtime.session).toBe(oldSession);
    expect(oldSession!.snapshot.paused).toBe(false);
    expect(oldGate.gain.value).toBe(1);
    expect(created.slice(0, 2).every(instance => instance.dispose.mock.calls.length === 0)).toBe(true);
    expect(created.slice(2).every(instance => instance.dispose.mock.calls.length === 1)).toBe(true);
  });

  it('returns and publishes the prevalidated committed snapshot without reading exporters again', async () => {
    const {runtime, plugins, create} = fixture();
    await runtime.restore(document());
    const listener = vi.fn();
    runtime.subscribe(listener);
    let reads = 0;
    plugins.register({id: 'one-snapshot', version: '1', create: request => ({...create(request), exportConfig: () => {
      if (++reads > 1) throw new Error('Exporter read after commit.');
      return {captured: true};
    }})});
    const initial = document();
    const result = await runtime.restore({...initial, modules: [{...initial.modules[0], plugin: {id: 'one-snapshot', version: '1'}}, initial.modules[1]]});
    expect(result.status).toBe('committed');
    expect(result.snapshot.project!.modules[0].config).toEqual({captured: true});
    expect(result.snapshot).toMatchObject({restoring: false, disposed: false});
    expect(listener.mock.calls.at(-1)![0]).toBe(result.snapshot);
    expect(reads).toBe(1);
  });

  it('honors cancellation re-entry while capturing a candidate snapshot', async () => {
    const {runtime, plugins, create, created} = fixture();
    await runtime.restore(document());
    const original = runtime.getModule('voice');
    plugins.register({id: 'cancel-export', version: '1', create: request => ({...create(request), exportConfig: () => {
      runtime.cancelRestore(); return {};
    }})});
    const initial = document();
    await expect(runtime.restore({...initial, modules: [{...initial.modules[0], plugin: {id: 'cancel-export', version: '1'}}, initial.modules[1]]})).resolves.toMatchObject({status: 'cancelled'});
    expect(runtime.getModule('voice')).toBe(original);
    expect(created.slice(2).every(instance => instance.dispose.mock.calls.length === 1)).toBe(true);
  });

  it('keeps the old output active if candidate activation fails and retires the candidate', async () => {
    const {runtime, context, created} = fixture();
    await runtime.restore(document());
    const original = runtime.getModule('voice'), oldGate = context.nodes[0];
    const createGain = context.createGain.getMockImplementation()!;
    let first = true;
    context.createGain.mockImplementation(() => {
      const node = createGain();
      if (first) { first = false; node.gain.onSet = value => { if (value === 1) throw new Error('activation failed'); }; }
      return node;
    });
    await expect(runtime.restore(document())).rejects.toThrow('activation failed');
    expect(runtime.getModule('voice')).toBe(original);
    expect(oldGate.gain.value).toBe(1);
    expect(created.slice(2).every(instance => instance.dispose.mock.calls.length === 1)).toBe(true);
  });

  it('cancels pending factories promptly and disposes their late owned result exactly once', async () => {
    const {runtime, plugins, create, created} = fixture();
    await runtime.restore(document());
    let resolve!: (instance: ProjectModuleInstance) => void;
    let request!: ProjectFactoryRequest;
    plugins.register({id: 'slow', version: '1', create: value => { request = value; return new Promise(result => { resolve = result; }); }});
    const original = runtime.getModule('voice');
    const pending = runtime.restore({...document(), modules: [{...document().modules[0], plugin: {id: 'slow', version: '1'}}, document().modules[1]]});
    await vi.waitFor(() => expect(request).toBeDefined());
    runtime.cancelRestore();
    await expect(pending).resolves.toMatchObject({status: 'cancelled'});
    expect(runtime.getModule('voice')).toBe(original);
    resolve(create(request));
    await vi.waitFor(() => expect(created.at(-1)!.dispose).toHaveBeenCalledOnce());
    expect(request.signal.aborted).toBe(true);
  });

  it('uses an explicit asset resolver and preserves the graph on rejected asset resolution', async () => {
    const {audio, plugins, create} = fixture();
    const resolver = vi.fn(async () => { throw new Error('asset denied'); });
    const runtime = new ModuleProjectRuntime({audio, plugins, resolveAsset: resolver}); runtimes.push(runtime);
    await runtime.restore(document());
    const original = runtime.getModule('voice');
    plugins.register({id: 'asset', version: '1', create: async request => { await request.resolveAsset('source'); return create(request); }});
    const initial = document();
    await expect(runtime.restore({...initial, assets: [{id: 'source', uri: 'app:private'}], modules: [{...initial.modules[0], plugin: {id: 'asset', version: '1'}, assets: {source: 'source'}}, initial.modules[1]]})).rejects.toThrow('asset denied');
    expect(runtime.getModule('voice')).toBe(original);
    expect(resolver).toHaveBeenCalledWith({id: 'source', uri: 'app:private'}, expect.any(AbortSignal));
  });

  it('changes an explicit connection without recreating playing modules', async () => {
    const {runtime, create, created} = fixture();
    await runtime.restore(document({connections: []}));
    await runtime.session!.play();
    const session = runtime.session, original = runtime.getModule('voice');
    await runtime.connect(document().connections[0]);
    expect(created[0].node.edges.has(created[1].node)).toBe(true);
    runtime.disconnect('route');
    expect(created[0].node.edges.has(created[1].node)).toBe(false);
    expect(created[0].node.edges.has(created[0].request.context.destination!())).toBe(true);
    expect(runtime.getModule('voice')).toBe(original);
    expect(runtime.session).toBe(session);
    expect(session!.snapshot.paused).toBe(false);
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('suppresses an unresolved explicit replacement and restores its default only on explicit disconnect', async () => {
    const {runtime, created} = fixture();
    const initial = document();
    await runtime.restore({...initial, modules: [initial.modules[0], {...initial.modules[1], plugin: {id: 'missing', version: '1'}}]});
    const source = created[0], normal = source.request.context.destination!();
    expect(source.node.edges.has(normal)).toBe(false);
    expect(source.module.getPort!('out')!.replaced).toBe(true);
    expect(runtime.snapshot().unresolved.some(item => item.kind === 'connection')).toBe(true);
    runtime.disconnect('route');
    expect(source.node.edges).toEqual(new Set([normal]));
    expect(source.module.getPort!('out')!.replaced).toBe(false);
  });

  it('adds and removes CV mappings surgically while preserving the same base and instances', async () => {
    const {runtime, create} = fixture();
    await runtime.restore(document());
    const original = runtime.getModule('voice');
    await runtime.connectModulation({id: 'cv', source: {moduleId: 'output', port: 'cv'}, target: {moduleId: 'voice', param: 'gain'}, depth: 0.2});
    expect(original!.params!.get('gain')!.snapshot.modulationRange).toEqual({min: 0.2, max: 0.6000000000000001});
    expect(runtime.exportProject().modulations).toHaveLength(1);
    runtime.disconnectModulation('cv');
    expect(original!.params!.get('gain')!.snapshot.modulationRange).toEqual({min: 0.4, max: 0.4});
    expect(runtime.exportProject().modulations).toEqual([]);
    expect(runtime.getModule('voice')).toBe(original);
    expect(create).toHaveBeenCalledTimes(2);
  });

  it.each((['connect', 'disconnect', 'connectModulation', 'disconnectModulation'] as const).flatMap(operation =>
    (['exporter', 'ports'] as const).map(failure => ({operation, failure}))))('rolls back $operation when its $failure snapshot read fails', async ({operation, failure}) => {
    const {runtime, plugins, create, context, created} = fixture();
    let failSnapshot = false;
    plugins.register({id: 'exporting', version: '1', create: request => {
      const instance = create(request);
      return {...instance,
        get ports() { if (failSnapshot && failure === 'ports') throw new Error('Snapshot read failed.'); return instance.ports; },
        exportConfig: () => {
          if (failSnapshot && failure === 'exporter') throw new Error('Snapshot read failed.');
          return {};
        },
      };
    }});
    const connection = document().connections[0];
    const modulation = {id: 'cv', source: {moduleId: 'output', port: 'cv'}, target: {moduleId: 'voice', param: 'gain'}, depth: 0.2};
    const initial = document({connections: operation === 'disconnect' ? [connection] : [],
      modulations: operation === 'disconnectModulation' ? [modulation] : []});
    await runtime.restore({...initial, modules: [{...initial.modules[0], plugin: {id: 'exporting', version: '1'}}, initial.modules[1]]});
    const original = runtime.getModule('voice');
    const parameter = original!.params!.get('gain')!;
    failSnapshot = true;
    const edit = () => operation === 'connect' ? runtime.connect(connection)
      : operation === 'disconnect' ? runtime.disconnect(connection.id)
      : operation === 'connectModulation' ? runtime.connectModulation(modulation)
      : runtime.disconnectModulation(modulation.id);
    await expect(Promise.resolve().then(edit)).rejects.toThrow('Snapshot read failed.');
    failSnapshot = false;
    expect(runtime.exportProject().connections).toEqual(initial.connections);
    expect(runtime.exportProject().modulations).toEqual(initial.modulations);
    expect(created[0].node.edges.has(created[1].node)).toBe(operation === 'disconnect');
    expect(original!.getPort!('out')!.replaced).toBe(operation === 'disconnect');
    expect(parameter.audio(context.native).mappings).toHaveLength(operation === 'disconnectModulation' ? 1 : 0);
    expect(runtime.getModule('voice')).toBe(original);
  });

  it.each(['connect', 'disconnect', 'connectModulation', 'disconnectModulation'] as const)('returns and publishes one prepared snapshot for %s', async operation => {
    const {runtime, plugins, create} = fixture();
    let countReads = false, reads = 0;
    plugins.register({id: 'exporting', version: '1', create: request => ({...create(request), exportConfig: () => {
      if (countReads && ++reads > 1) throw new Error('Exporter read after edit commit.');
      return {};
    }})});
    const connection = document().connections[0];
    const modulation = {id: 'cv', source: {moduleId: 'output', port: 'cv'}, target: {moduleId: 'voice', param: 'gain'}, depth: 0.2};
    const initial = document({connections: operation === 'disconnect' ? [connection] : [],
      modulations: operation === 'disconnectModulation' ? [modulation] : []});
    await runtime.restore({...initial, modules: [{...initial.modules[0], plugin: {id: 'exporting', version: '1'}}, initial.modules[1]]});
    const listener = vi.fn();
    runtime.subscribe(listener);
    listener.mockClear();
    countReads = true;
    const snapshot = await (operation === 'connect' ? runtime.connect(connection)
      : operation === 'disconnect' ? runtime.disconnect(connection.id)
      : operation === 'connectModulation' ? runtime.connectModulation(modulation)
      : runtime.disconnectModulation(modulation.id));
    expect(reads).toBe(1);
    expect(listener).toHaveBeenCalledExactlyOnceWith(snapshot);
    expect(snapshot.project!.connections).toEqual(operation === 'connect' ? [connection] : []);
    expect(snapshot.project!.modulations).toEqual(operation === 'connectModulation' ? [modulation] : []);
  });

  it('publishes parameter changes from connector retirement after the validated edit snapshot', async () => {
    const {audio, plugins} = fixture();
    const runtime = new ModuleProjectRuntime({audio, plugins, connect: ({to}) => createConnectionLease(() => {
      to.module.params!.get('gain')!.setBaseValue(0.2);
    })}); runtimes.push(runtime);
    await runtime.restore(document({connections: [{id: 'notes', kind: 'note', from: {moduleId: 'voice', port: 'notes'}, to: {moduleId: 'output', port: 'notes'}}]}));
    const listener = vi.fn();
    runtime.subscribe(listener);
    listener.mockClear();
    const committed = runtime.disconnect('notes');
    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener.mock.calls[0][0]).toBe(committed);
    const updated = listener.mock.calls[1][0];
    expect(updated.revision).toBeGreaterThan(committed.revision);
    expect(updated.project.connections).toEqual([]);
    expect(updated.project.modules.find((module: {id: string}) => module.id === 'output').params.gain).toBe(0.2);
    expect(runtime.exportProject().modules[1].params!.gain).toBe(0.2);
  });

  it.each([false, true])('publishes ownership changes after the committed edit snapshot when retirement overrides automation (throws: %s)', async throws => {
    const {audio, plugins} = fixture();
    const errors = vi.fn();
    const runtime = new ModuleProjectRuntime({audio, plugins, onCleanupError: errors, connect: ({to}) => createConnectionLease(() => {
      to.module.params!.get('gain')!.setBaseValue(0.2);
      if (throws) throw new Error('Retirement failed after its override.');
    })}); runtimes.push(runtime);
    await runtime.restore(document({connections: [{id: 'notes', kind: 'note', from: {moduleId: 'voice', port: 'notes'}, to: {moduleId: 'output', port: 'notes'}}],
      automation: [{id: 'fade', target: {moduleId: 'output', param: 'gain'}, points: [{type: 'set', value: 1, timeSeconds: 0}]}]}));
    const listener = vi.fn();
    runtime.subscribe(listener);
    listener.mockClear();
    const committed = runtime.disconnect('notes');
    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener.mock.calls[0][0]).toBe(committed);
    expect(committed.project!.automation[0].enabled).toBe(true);
    const final = listener.mock.calls[1][0];
    expect(final.revision).toBeGreaterThan(committed.revision);
    expect(final.project.automation[0].enabled).toBe(false);
    expect(final.project.modules[1].params.gain).toBe(0.2);
    expect(final.project).toEqual(runtime.exportProject());
    expect(errors).toHaveBeenCalledTimes(throws ? 1 : 0);
  });

  it('publishes immediate automation base changes made during connector retirement', async () => {
    const {audio, plugins, context} = fixture();
    const runtime = new ModuleProjectRuntime({audio, plugins, connect: ({to}) => createConnectionLease(() => {
      to.module.params!.get('gain')!.scheduleAutomation(context.native, [{type: 'set', time: context.currentTime, value: 0.2}]);
    })}); runtimes.push(runtime);
    await runtime.restore(document({connections: [{id: 'notes', kind: 'note', from: {moduleId: 'voice', port: 'notes'}, to: {moduleId: 'output', port: 'notes'}}]}));
    const parameter = runtime.getModule('output')!.params!.get('gain')!;
    const baseRevision = parameter.snapshot.baseRevision;
    const listener = vi.fn();
    runtime.subscribe(listener);
    listener.mockClear();
    const committed = runtime.disconnect('notes');
    expect(parameter.snapshot.baseRevision).toBe(baseRevision);
    expect(parameter.snapshot.baseValue).toBe(0.2);
    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener.mock.calls[0][0]).toBe(committed);
    const updated = listener.mock.calls[1][0];
    expect(updated.revision).toBeGreaterThan(committed.revision);
    expect(updated.project.connections).toEqual([]);
    expect(updated.project.modules.find((module: {id: string}) => module.id === 'output').params.gain).toBe(0.2);
    expect(runtime.exportProject().modules[1].params!.gain).toBe(0.2);
  });

  it('publishes existing modulation depth changes made during connector retirement', async () => {
    const {audio, plugins, context} = fixture();
    const runtime = new ModuleProjectRuntime({audio, plugins, connect: ({to}) => createConnectionLease(() => {
      to.module.params!.get('gain')!.audio(context.native).mappings[0].setDepth(0.7);
    })}); runtimes.push(runtime);
    await runtime.restore(document({connections: [{id: 'notes', kind: 'note', from: {moduleId: 'output', port: 'notes'}, to: {moduleId: 'voice', port: 'notes'}}],
      modulations: [{id: 'cv', source: {moduleId: 'output', port: 'cv'}, target: {moduleId: 'voice', param: 'gain'}, depth: 0.2}]}));
    const listener = vi.fn();
    runtime.subscribe(listener);
    listener.mockClear();
    const committed = runtime.disconnect('notes');
    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener.mock.calls[0][0]).toBe(committed);
    expect(listener.mock.calls[1][0].project.modulations[0].depth).toBe(0.7);
  });

  it('reports a failed retirement notification without rejecting the committed disconnect', async () => {
    const {audio, plugins, create} = fixture();
    let failExport = false;
    plugins.register({id: 'exporting', version: '1', create: request => ({...create(request), exportConfig: () => {
      if (failExport) throw new Error('Post-commit export failed.');
      return {};
    }})});
    const errors = vi.fn();
    const runtime = new ModuleProjectRuntime({audio, plugins, onCleanupError: errors, connect: ({to}) => createConnectionLease(() => {
      to.module.params!.get('gain')!.setBaseValue(0.2);
      failExport = true;
    })}); runtimes.push(runtime);
    const initial = document();
    await runtime.restore({...initial, modules: [initial.modules[0], {...initial.modules[1], plugin: {id: 'exporting', version: '1'}}],
      connections: [{id: 'notes', kind: 'note', from: {moduleId: 'voice', port: 'notes'}, to: {moduleId: 'output', port: 'notes'}}]});
    const listener = vi.fn();
    runtime.subscribe(listener);
    listener.mockClear();
    const committed = runtime.disconnect('notes');
    expect(committed.project!.connections).toEqual([]);
    expect(listener).toHaveBeenCalledExactlyOnceWith(committed);
    expect(errors).toHaveBeenCalledOnce();
    expect(errors.mock.calls[0][0]).toEqual(new Error('Post-commit export failed.'));
    failExport = false;
    expect(runtime.exportProject().connections).toEqual([]);
    expect(runtime.exportProject().modules[1].params!.gain).toBe(0.2);
  });

  it.each(['connect', 'disconnect'] as const)('guards %s topology callbacks before another edit can alter its document', async operation => {
    const {runtime, plugins, create} = fixture();
    let reenter = false, nestedFailure: unknown;
    plugins.register({id: 'reentrant-input', version: '1', create: request => {
      const instance = create(request);
      return {...instance, getInput: port => {
        if (reenter) {
          reenter = false;
          try { runtime.disconnect('route'); } catch (error) { nestedFailure = error; }
        }
        return instance.getInput!(port);
      }};
    }});
    const route = document().connections[0], send = {...route, id: 'send', mode: 'send' as const};
    const initial = document({connections: operation === 'connect' ? [route] : [route, send]});
    await runtime.restore({...initial, modules: [initial.modules[0], {...initial.modules[1], plugin: {id: 'reentrant-input', version: '1'}}]});
    reenter = true;
    if (operation === 'connect') await runtime.connect(send);
    else runtime.disconnect(send.id);
    expect(nestedFailure).toBeInstanceOf(Error);
    expect(String(nestedFailure)).toContain('cannot overlap');
    expect(runtime.exportProject().connections).toEqual(operation === 'connect' ? [route, send] : [route]);
    expect(runtime.getModule('voice')!.getPort!('out')!.replaced).toBe(true);
    runtime.disconnect(route.id);
    expect(runtime.getModule('voice')!.getPort!('out')!.replaced).toBe(false);
  });

  it('releases the edit guard after document and topology validation failures', async () => {
    const {runtime} = fixture();
    await runtime.restore(document());
    await expect(runtime.connect(document().connections[0])).rejects.toThrow('duplicate ID');
    expect(() => runtime.disconnect('missing')).toThrow('Unknown project connection');
    await expect(runtime.connect({id: 'feedback', kind: 'audio', from: {moduleId: 'output', port: 'out'}, to: {moduleId: 'voice', port: 'in'}})).rejects.toThrow('feedback');
    await expect(runtime.connectModulation({id: 'bad', source: {moduleId: 'missing', port: 'cv'}, target: {moduleId: 'voice', param: 'gain'}, depth: 0.2})).rejects.toThrow('missing module');
    expect(() => runtime.disconnectModulation('missing')).toThrow('Unknown project modulation');
    runtime.disconnect('route');
    expect(runtime.exportProject().connections).toEqual([]);
  });

  it('restores Session-relative automation baseline and preserves manual override on export/reload', async () => {
    const {runtime} = fixture();
    await runtime.restore(document({session: {positionSeconds: 2, rate: 1}, automation: [{
      id: 'fade', target: {moduleId: 'voice', param: 'gain'}, points: [
        {type: 'set', value: 0.2, timeSeconds: 0}, {type: 'linear', value: 1, timeSeconds: 4},
      ], initialValue: 0.4,
    }]}));
    expect(runtime.snapshot().unresolved).toEqual([]);
    expect(runtime.getModule('voice')!.params!.get('gain')!.snapshot.baseValue).toBeCloseTo(0.6);
    const saved = runtime.exportProject();
    expect(saved.automation[0]).toMatchObject({enabled: true, initialValue: 0.4});
    await runtime.restore(saved);
    expect(runtime.getModule('voice')!.params!.get('gain')!.snapshot.baseValue).toBeCloseTo(0.6);
    runtime.getModule('voice')!.params!.get('gain')!.setBaseValue(0.8);
    const manual = runtime.exportProject();
    expect(manual.automation[0]).toMatchObject({enabled: false, initialValue: 0.4});
    await runtime.restore(manual);
    expect(runtime.getModule('voice')!.params!.get('gain')!.snapshot.baseValue).toBe(0.8);
    expect(runtime.exportProject().automation[0].points).toEqual(saved.automation[0].points);
  });

  it.each([false, true])('publishes the disabled automation track after a manual base override (playing: %s)', async playing => {
    const {runtime} = fixture();
    await runtime.restore(document({automation: [{id: 'fade', target: {moduleId: 'voice', param: 'gain'},
      points: [{type: 'set', value: 1, timeSeconds: 0}, {type: 'linear', value: 2, timeSeconds: 1}]}]}));
    if (playing) await runtime.session!.play();
    const delivered: ModuleProject[] = [];
    const unsubscribe = runtime.subscribe(snapshot => { if (snapshot.project) delivered.push(snapshot.project); });
    runtime.getModule('voice')!.params!.get('gain')!.setBaseValue(0.3);
    const saved = delivered.at(-1)!;
    unsubscribe();
    expect(saved.automation[0].enabled).toBe(false);
    expect(saved).toEqual(runtime.exportProject());
    await runtime.restore(saved);
    expect(runtime.getModule('voice')!.params!.get('gain')!.snapshot.baseValue).toBe(0.3);
    expect(runtime.exportProject().automation[0].enabled).toBe(false);
  });

  it('publishes final ownership even when a module observer forwards the base write before the ownership watcher', async () => {
    const {runtime, plugins, create} = fixture();
    plugins.register({id: 'forwarding', version: '1', create: request => {
      const instance = create(request), listeners = new Set<() => void>();
      const unsubscribe = instance.module.params!.get('gain')!.subscribe(() => { for (const listener of listeners) listener(); });
      return {...instance, module: {...instance.module, subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener); }; }},
        dispose: () => { unsubscribe(); instance.dispose(); }};
    }});
    const initial = document({automation: [{id: 'fade', target: {moduleId: 'voice', param: 'gain'}, points: [{type: 'set', value: 1, timeSeconds: 0}]}]});
    await runtime.restore({...initial, modules: [{...initial.modules[0], plugin: {id: 'forwarding', version: '1'}}, initial.modules[1]]});
    const listener = vi.fn();
    runtime.subscribe(listener);
    listener.mockClear();
    runtime.getModule('voice')!.params!.get('gain')!.setBaseValue(0.3);
    const final = listener.mock.calls.at(-1)![0].project;
    expect(final.automation[0].enabled).toBe(false);
    expect(final).toEqual(runtime.exportProject());
    await runtime.restore(final);
    expect(runtime.getModule('voice')!.params!.get('gain')!.snapshot.baseValue).toBe(0.3);
  });

  it('allows a final ownership observer to dispose the graph without reviving or double-disposing it', async () => {
    const {runtime, created} = fixture();
    await runtime.restore(document({automation: [{id: 'fade', target: {moduleId: 'voice', param: 'gain'}, points: [{type: 'set', value: 1, timeSeconds: 0}]}]}));
    let disabledNotifications = 0;
    runtime.subscribe(snapshot => {
      if (snapshot.project?.automation[0].enabled === false) { disabledNotifications++; runtime.dispose(); }
    });
    expect(() => runtime.getModule('voice')!.params!.get('gain')!.setBaseValue(0.3)).not.toThrow();
    expect(disabledNotifications).toBe(1);
    expect(runtime.snapshot().disposed).toBe(true);
    expect(created.every(instance => instance.dispose.mock.calls.length === 1)).toBe(true);
  });

  it('preserves unwrapped loop progress and once-only automation across save/reload', async () => {
    const {runtime} = fixture();
    await runtime.restore(document({session: {positionSeconds: 10.5, rate: 1, loop: {startSeconds: 0, endSeconds: 4}}, automation: [{
      id: 'once', target: {moduleId: 'voice', param: 'gain'}, loop: 'once', initialValue: 0.4,
      points: [{type: 'set', value: 0.2, timeSeconds: 0}, {type: 'linear', value: 1, timeSeconds: 12}],
    }]}));
    expect(runtime.session!.snapshot.position).toBe(2.5);
    const saved = runtime.exportProject();
    expect(saved.session.positionSeconds).toBe(10.5);
    expect(runtime.getModule('voice')!.params!.get('gain')!.snapshot.baseValue).toBeCloseTo(0.9);
    await runtime.restore(serializeModuleProject(saved));
    expect(runtime.session!.snapshot.position).toBe(2.5);
    expect(runtime.exportProject().session.positionSeconds).toBe(10.5);
    expect(runtime.getModule('voice')!.params!.get('gain')!.snapshot.baseValue).toBeCloseTo(0.9);
  });

  it('rejects a new feedback edge through a nested default before altering the playing graph', async () => {
    const {runtime, plugins, create, created} = fixture();
    plugins.register({id: 'container', version: '1', create: request => {
      const instance = create(request);
      return {...instance, childContext: child => child.derive({id: child.id, admit: null, destination: () => instance.node as unknown as AudioNode})};
    }});
    const initial = document();
    await runtime.restore({...initial, contexts: [{id: 'root'}, {id: 'nested', parentId: 'root', ownerModuleId: 'output'}],
      modules: [{...initial.modules[0], contextId: 'nested'}, {...initial.modules[1], plugin: {id: 'container', version: '1'}}], connections: []});
    await expect(runtime.connect({id: 'back', kind: 'audio', from: {moduleId: 'output', port: 'out'}, to: {moduleId: 'voice', port: 'in'}, mode: 'send'})).rejects.toThrow('feedback');
    expect(runtime.exportProject().connections).toEqual([]);
    expect(created.every(instance => instance.dispose.mock.calls.length === 0)).toBe(true);
  });

  it('rejects unpatch when restoring a nested default would introduce feedback', async () => {
    const {runtime, plugins, create} = fixture();
    plugins.register({id: 'container', version: '1', create: request => {
      const instance = create(request);
      return {...instance, childContext: child => child.derive({id: child.id, admit: null, destination: () => instance.node as unknown as AudioNode})};
    }});
    const initial = document();
    await runtime.restore({...initial, contexts: [{id: 'root'}, {id: 'nested', parentId: 'root', ownerModuleId: 'output'}],
      modules: [{...initial.modules[0], contextId: 'nested'}, {...initial.modules[1], plugin: {id: 'container', version: '1'}}, {...initial.modules[1], id: 'sink'}],
      connections: [
        {id: 'feed', kind: 'audio', from: {moduleId: 'output', port: 'out'}, to: {moduleId: 'voice', port: 'in'}, mode: 'send'},
        {id: 'escape', kind: 'audio', from: {moduleId: 'voice', port: 'out'}, to: {moduleId: 'sink', port: 'in'}, mode: 'replace'},
      ]});
    expect(() => runtime.disconnect('escape')).toThrow('feedback');
    expect(runtime.exportProject().connections.map(connection => connection.id)).toEqual(['feed', 'escape']);
    expect(runtime.getModule('voice')!.getPort!('out')!.replaced).toBe(true);
  });

  it('does not borrow the outer context when an explicit owner lacks a child-context capability', async () => {
    const {runtime, plugins, create} = fixture();
    plugins.register({id: 'non-container', version: '1', create: request => ({...create(request), childContext: undefined})});
    const initial = document();
    await runtime.restore({...initial, contexts: [{id: 'root'}, {id: 'nested', parentId: 'root', ownerModuleId: 'output'}],
      modules: [{...initial.modules[0], contextId: 'nested'}, {...initial.modules[1], plugin: {id: 'non-container', version: '1'}}]});
    expect(runtime.getModule('output')).toBeDefined();
    expect(runtime.getModule('voice')).toBeUndefined();
    expect(runtime.snapshot().unresolved.some(item => item.kind === 'context' && item.id === 'nested')).toBe(true);
  });

  it.each(['throws', 'invalid scope'] as const)('disposes a fresh child registry when its owner %s before adoption', async failure => {
    const {runtime, plugins, create, created} = fixture();
    await runtime.restore(document());
    const original = runtime.getModule('voice');
    const fresh: {registry?: ModuleRegistry; registration?: ConnectionLease} = {};
    plugins.register({id: 'failed-container', version: '1', create: request => ({...create(request), childContext: child => {
      fresh.registry = child.registry;
      fresh.registration = child.registry.register({id: 'plugin-observer'});
      if (failure === 'throws') throw new Error('Child scope failure.');
      return child.derive({id: 'wrong-id'});
    }})});
    const initial = document();
    await expect(runtime.restore({...initial, contexts: [{id: 'root'}, {id: 'nested', parentId: 'root', ownerModuleId: 'output'}],
      modules: [{...initial.modules[0], contextId: 'nested'}, {...initial.modules[1], plugin: {id: 'failed-container', version: '1'}}]})).rejects.toThrow(failure === 'throws' ? 'Child scope failure' : 'preserve its ID');
    expect(fresh.registry?.disposed).toBe(true);
    expect(fresh.registration?.active).toBe(false);
    expect(runtime.getModule('voice')).toBe(original);
    expect(created[0].dispose).not.toHaveBeenCalled();
    expect(created.at(-1)!.dispose).toHaveBeenCalledOnce();
  });

  it('rejects an already released custom connector lease without replacing the current graph', async () => {
    const {audio, plugins} = fixture();
    const release = vi.fn();
    const runtime = new ModuleProjectRuntime({audio, plugins, connect: () => ({active: false, release})}); runtimes.push(runtime);
    await runtime.restore(document());
    const original = runtime.getModule('voice');
    await expect(runtime.restore(document({connections: [{id: 'notes', kind: 'note', from: {moduleId: 'voice', port: 'notes'}, to: {moduleId: 'output', port: 'notes'}}]}))).rejects.toThrow('active connection lease');
    expect(runtime.getModule('voice')).toBe(original);
    expect(release).toHaveBeenCalledOnce();
  });

  it('cleans a synchronously returned candidate if its factory cancels restoration reentrantly', async () => {
    const {runtime, plugins, create, created} = fixture();
    await runtime.restore(document());
    const original = runtime.getModule('voice');
    plugins.register({id: 'cancel', version: '1', create: request => { runtime.cancelRestore(); return create(request); }});
    const initial = document();
    await expect(runtime.restore({...initial, modules: [{...initial.modules[0], plugin: {id: 'cancel', version: '1'}}, initial.modules[1]]})).resolves.toMatchObject({status: 'cancelled'});
    await vi.waitFor(() => expect(created.at(-1)!.dispose).toHaveBeenCalledOnce());
    expect(runtime.getModule('voice')).toBe(original);
  });

  it('rejects a reused active factory instance without disposing the running owner', async () => {
    const {runtime, plugins, created} = fixture();
    await runtime.restore(document());
    const original = runtime.getModule('voice');
    plugins.register({id: 'reuse', version: '1', create: () => created[0]});
    const initial = document();
    await expect(runtime.restore({...initial, modules: [{...initial.modules[0], plugin: {id: 'reuse', version: '1'}}, initial.modules[1]]})).rejects.toThrow('fresh owned');
    expect(runtime.getModule('voice')).toBe(original);
    expect(created[0].dispose).not.toHaveBeenCalled();
  });

  it('accepts a self-registered identical module and rejects a conflicting owner', async () => {
    const {runtime, plugins, create, created} = fixture();
    plugins.register({id: 'registered', version: '1', create: request => {
      const instance = create(request);
      const lease = request.context.registry.register(instance.module);
      const dispose = instance.dispose;
      return {...instance, dispose: vi.fn(() => { lease.release(); dispose(); })};
    }});
    const initial = document();
    await runtime.restore({...initial, modules: initial.modules.map(module => ({...module, plugin: {id: 'registered', version: '1'}}))});
    expect(runtime.context!.registry.snapshot()).toHaveLength(2);
    runtime.dispose();
    expect(created.every(instance => instance.dispose.mock.calls.length === 1)).toBe(true);
  });

  it('lets a reentrant restore observer supersede stale work before any stale factory executes', async () => {
    const {runtime, create} = fixture();
    let replaced = false;
    let newest!: Promise<unknown>;
    runtime.subscribe(snapshot => {
      if (snapshot.restoring && !replaced) {
        replaced = true;
        newest = runtime.restore({...document(), id: 'newer'});
      }
    });
    await expect(runtime.restore(document())).resolves.toMatchObject({status: 'cancelled'});
    await newest;
    expect(runtime.exportProject().id).toBe('newer');
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('continues all owned cleanup after throwing hooks and leaves the borrowed context open', async () => {
    const {audio, plugins, create, context, created} = fixture();
    const errors = vi.fn();
    plugins.register({id: 'throwing', version: '1', create: request => {
      const instance = create(request);
      return {...instance, dispose: () => { instance.dispose(); throw new Error('cleanup failed'); }};
    }});
    const runtime = new ModuleProjectRuntime({audio, plugins, onCleanupError: errors}); runtimes.push(runtime);
    await runtime.restore({...document(), modules: document().modules.map(module => ({...module, plugin: {id: 'throwing', version: '1'}}))});
    runtime.dispose();
    expect(created.every(instance => instance.dispose.mock.calls.length === 1)).toBe(true);
    expect(errors).toHaveBeenCalledTimes(2);
    expect(context.close).not.toHaveBeenCalled();
  });

  it('does not expose factory disposal through borrowed current resources', async () => {
    const {runtime, plugins, create} = fixture();
    plugins.register({id: 'extra', version: '1', create: request => {
      const instance = create(request);
      Object.assign(instance.module, {dispose: vi.fn()});
      return instance;
    }});
    const initial = document();
    await runtime.restore({...initial, modules: initial.modules.map(module => ({...module, plugin: {id: 'extra', version: '1'}}))});
    expect(runtime.resources?.module('voice')).toBe(runtime.getModule('voice'));
    expect('dispose' in runtime.getModule('voice')!).toBe(false);
  });

  it('keeps exact registry versions and precise removal leases independent', () => {
    const registry = new ProjectPluginRegistry();
    const factory = {id: 'plugin', version: '1', create: vi.fn()};
    const lease = registry.register(factory);
    registry.register({...factory, version: '2'});
    expect(() => registry.register(factory)).toThrow('already registered');
    lease.release(); lease.release();
    expect(registry.get('plugin', '1')).toBeUndefined();
    expect(registry.get('plugin', '2')).toBeDefined();
    const changed = {id: 'mutable', version: '1', create: vi.fn()};
    const stable = registry.register(changed);
    changed.id = 'changed'; changed.version = '2';
    expect(registry.get('mutable', '1')).toMatchObject({id: 'mutable', version: '1'});
    stable.release();
    expect(registry.get('mutable', '1')).toBeUndefined();
  });
});
