import {afterEach, describe, expect, it} from 'vitest';
import {
  ControlMappings, ManualMessageClock, ModuleAudioEnvironment, ModuleProjectRuntime, ParamHandle, ParamSurface, PresetBank,
  ProjectPluginRegistry, applyParameters, captureParameters, describeSource, parseMessage, parseModuleProject,
  type Message, type ModuleProject, type ProjectPluginFactory,
} from '../src/module';
import {createObjectPlugins, nodeWeights, objectInterfaceOf} from '../src/objects';
import {FakeContext} from './processor-fakes';

const runtimes: ModuleProjectRuntime[] = [];
afterEach(() => { for (const runtime of runtimes.splice(0)) runtime.dispose(); });

function setup(extra: ProjectPluginFactory[] = []) {
  const audio = new FakeContext();
  audio.state = 'running';
  const clock = new ManualMessageClock(0);
  const printed: string[] = [];
  const plugins = new ProjectPluginRegistry();
  for (const plugin of createObjectPlugins({clock: () => clock, print: (name, text) => printed.push(`${name}: ${text}`)})) plugins.register(plugin);
  for (const plugin of extra) plugins.register(plugin);
  const runtime = new ModuleProjectRuntime({audio: new ModuleAudioEnvironment({context: audio as unknown as BaseAudioContext}), plugins});
  runtimes.push(runtime);
  const send = (id: string, text: string, port = 'in0') =>
    (runtime.getModule(id)!.ports!().find(item => item.id === port) as {receive(value: Message): void}).receive(parseMessage(text));
  return {audio, runtime, printed, send};
}

const object = (id: string, contextId: string, name: string, args = '', extra: object = {}) =>
  ({id, contextId, plugin: {id: `webmusic.object.${name}`, version: '1.0.0'}, config: {args, ...extra}});
const cord = (id: string, from: string, to: string, fromPort = 'out0', toPort = 'in0', kind = 'message') =>
  ({id, kind, from: {moduleId: from, port: fromPort}, to: {moduleId: to, port: toPort}, ...(kind === 'audio' ? {mode: 'replace'} : {})});

describe('nested components', () => {
  it('passes messages in through an inlet and out through an outlet', async () => {
    const {runtime, printed, send} = setup();
    const project: ModuleProject = parseModuleProject({schema: 'webmusic.module-project', version: 1, id: 'outer',
      contexts: [{id: 'root'}, {id: 'inside', parentId: 'root', ownerModuleId: 'sub'}],
      modules: [
        object('number', 'root', 'number'),
        {id: 'sub', contextId: 'root', plugin: {id: 'webmusic.object.component', version: '1.0.0'}, config: {inlets: ['message'], outlets: ['message']}},
        object('log', 'root', 'print', 'out'),
        object('in', 'inside', 'inlet', '0'), object('double', 'inside', 'expr', '$i1 * 2'), object('out', 'inside', 'outlet', '0'),
      ],
      connections: [cord('a', 'number', 'sub'), cord('b', 'sub', 'log'), cord('c', 'in', 'double'), cord('d', 'double', 'out')],
    });
    expect((await runtime.restore(project)).status).toBe('committed');
    expect(runtime.snapshot().modules.find(module => module.record.id === 'sub')!.ports.map(port => `${port.kind}/${port.direction}/${port.id}`))
      .toEqual(['message/input/in0', 'message/output/out0']);
    send('number', '21');
    expect(printed).toEqual(['out: 42']);
    expect(runtime.exportProject().contexts.map(context => context.id)).toEqual(['root', 'inside']);
  });

  it('passes audio through inlet~ and outlet~ and leaves unwired contents on the default route', async () => {
    const {audio, runtime} = setup();
    await runtime.restore(parseModuleProject({schema: 'webmusic.module-project', version: 1, id: 'audio',
      contexts: [{id: 'root'}, {id: 'inside', parentId: 'root', ownerModuleId: 'sub'}],
      modules: [
        {id: 'sub', contextId: 'root', plugin: {id: 'webmusic.object.component', version: '1.0.0'}, config: {inlets: ['audio'], outlets: ['audio']}},
        object('in', 'inside', 'inlet~', '0'), object('out', 'inside', 'outlet~', '0'),
      ],
      connections: [cord('a', 'in', 'out', 'out0', 'in0', 'audio')],
    }));
    const [shellIn, shellOut, inletNode, outletNode] = audio.gains.slice(-4);
    expect(runtime.snapshot().modules.map(module => module.status)).toEqual(['ready', 'ready', 'ready']);
    // inlet relay → inlet~ node → outlet~ node → outlet relay
    expect(shellIn!.targets()).toContain(inletNode);
    expect(inletNode!.targets()).toContain(outletNode);
    expect(outletNode!.targets()).toContain(shellOut);
  });

  it('keeps an inlet with no enclosing component harmless', async () => {
    const {runtime} = setup();
    await runtime.restore(parseModuleProject({schema: 'webmusic.module-project', version: 1, id: 'alone', contexts: [{id: 'root'}],
      modules: [object('in', 'root', 'inlet', '0'), object('out', 'root', 'outlet', '0')], connections: [cord('a', 'in', 'out')]}));
    expect(runtime.snapshot().modules.map(module => module.status)).toEqual(['ready', 'ready']);
  });
});

describe('presets', () => {
  it('stores, recalls and blends values', () => {
    const bank = new PresetBank();
    bank.store(1, {a: 0, b: [0, 10], c: 1});
    bank.store(2, {a: 10, b: [10, 20]});
    expect(bank.slots).toEqual([1, 2]);
    expect(bank.between(1, 2, 0.25)).toEqual({a: 2.5, b: [2.5, 12.5], c: 1});
    expect(bank.interpolate({1: 1, 2: 3})).toEqual({a: 7.5, b: [7.5, 17.5], c: 1});
    expect(new PresetBank(bank.toJSON()).recall(2)).toEqual({a: 10, b: [10, 20]});
    expect(() => bank.store(0, {})).toThrow();
  });

  it('captures and applies parameters by module and parameter ID', () => {
    const gain = new ParamHandle({id: 'gain', unit: 'ratio', range: {min: 0, max: 1}, defaultValue: 0.5});
    const modules = [{id: 'amp', params: new ParamSurface([gain])}];
    expect(captureParameters(modules)).toEqual({'amp.gain': 0.5});
    expect(applyParameters(modules, {'amp.gain': 4})).toBe(1);
    expect(gain.snapshot.baseValue).toBe(1);
  });

  it('a preset object stores its component, recalls with output and interpolates', async () => {
    const {runtime, printed, send} = setup();
    await runtime.restore(parseModuleProject({schema: 'webmusic.module-project', version: 1, id: 'presets', contexts: [{id: 'root'}],
      modules: [object('p', 'root', 'preset', '8'), object('n', 'root', 'number', '0 100'), object('t', 'root', 'toggle'), object('log', 'root', 'print')],
      connections: [cord('a', 'n', 'log'), cord('b', 't', 'log')]}));
    const view = (id: string) => objectInterfaceOf(runtime.getModule(id))!;
    view('n').interact(parseMessage('10'));
    send('p', 'store 1');
    view('n').interact(parseMessage('50'));
    view('t').interact(parseMessage('1'));
    send('p', 'store 2');
    printed.length = 0;
    send('p', '1');
    expect(printed).toEqual(['print: 10', 'print: 0']);
    expect(view('p').snapshot()).toEqual({count: 8, stored: [1, 2], current: 1});
    send('p', 'interp 1 2 0.5');
    expect(view('n').snapshot()).toMatchObject({value: 30});
    const saved = runtime.exportProject().modules.find(module => module.id === 'p')!.config.state as {slots: Record<string, unknown>};
    expect(Object.keys(saved.slots)).toEqual(['1', '2']);
  });

  it('nodes weigh how far the cursor reaches into each node', async () => {
    expect(nodeWeights([{x: 0, y: 0, radius: 1}, {x: 1, y: 0, radius: 1}], {x: 0.25, y: 0})).toEqual([0.75, 0.25]);
    const {runtime, printed} = setup();
    await runtime.restore(parseModuleProject({schema: 'webmusic.module-project', version: 1, id: 'nodes', contexts: [{id: 'root'}],
      modules: [object('pad', 'root', 'nodes', '2'), object('log', 'root', 'print')], connections: [cord('a', 'pad', 'log')]}));
    objectInterfaceOf(runtime.getModule('pad'))!.interact(parseMessage('cursor 0.5 0.2'));
    expect(printed).toEqual(['print: 1. 0.']);
  });
});

describe('control mappings', () => {
  const setupMappings = () => {
    const cutoff = new ParamHandle({id: 'frequency', unit: 'Hz', range: {min: 20, max: 20000}, displayRange: {min: 100, max: 1100}, defaultValue: 500});
    const changes: unknown[] = [];
    const mappings = new ControlMappings({resolve: target => target.param === 'frequency' ? cutoff : undefined, onChange: next => changes.push(next)});
    return {cutoff, mappings, changes};
  };

  it('learns the next control and maps it onto the display range', () => {
    const {cutoff, mappings, changes} = setupMappings();
    mappings.learn({moduleId: 'filter', param: 'frequency'});
    expect(mappings.learning).toEqual({moduleId: 'filter', param: 'frequency'});
    expect(mappings.handle({kind: 'cc', controller: 74, value: 0, channel: 2})).toBe(true);
    expect(mappings.mappings).toEqual([{id: 'map1', source: {kind: 'cc', controller: 74, channel: 2}, target: {moduleId: 'filter', param: 'frequency'}}]);
    expect(changes).toHaveLength(1);
    mappings.handle({kind: 'cc', controller: 74, value: 127, channel: 2});
    expect(cutoff.snapshot.baseValue).toBe(1100);
    mappings.handle({kind: 'cc', controller: 74, value: 127, channel: 3});
    mappings.handle({kind: 'cc', controller: 1, value: 0, channel: 2});
    expect(cutoff.snapshot.baseValue).toBe(1100);
    expect(describeSource(mappings.mappings[0]!.source)).toBe('CC 74 ch 3');
  });

  it('maps pitch bend and toggles a key between the range ends', () => {
    const {cutoff, mappings} = setupMappings();
    mappings.set([
      {id: 'bend', source: {kind: 'pitchbend'}, target: {moduleId: 'f', param: 'frequency'}, min: 200, max: 400},
      {id: 'key', source: {kind: 'key', key: 'a'}, target: {moduleId: 'f', param: 'frequency'}},
    ]);
    mappings.handle({kind: 'pitchbend', value: 0, channel: 0});
    expect(cutoff.snapshot.baseValue).toBeCloseTo(300, 0);
    mappings.handle({kind: 'key', key: 'a', down: true});
    expect(cutoff.snapshot.baseValue).toBe(1100);
    mappings.handle({kind: 'key', key: 'a', down: false});
    mappings.handle({kind: 'key', key: 'a', down: true});
    expect(cutoff.snapshot.baseValue).toBe(100);
    mappings.remove('key');
    expect(mappings.mappings.map(mapping => mapping.id)).toEqual(['bend']);
  });

  it('saves mappings, comments, groups and presentation in a project', () => {
    const project = parseModuleProject({schema: 'webmusic.module-project', version: 1, id: 'p', contexts: [{id: 'root'}],
      modules: [object('a', 'root', 'toggle'), object('b', 'root', 'number')],
      layout: {modules: [{moduleId: 'a', x: 0, y: 0}], presentation: [{moduleId: 'b', x: 5, y: 5}],
        comments: [{id: 'c1', contextId: 'root', text: 'Start here', x: 1, y: 2}], groups: [{id: 'g1', moduleIds: ['a', 'b']}]},
      mappings: [{id: 'm', source: {kind: 'cc', controller: 7}, target: {moduleId: 'b', param: 'gain'}}]});
    expect(project.layout.comments![0]!.text).toBe('Start here');
    expect(project.mappings![0]!.source).toEqual({kind: 'cc', controller: 7});
    expect(() => parseModuleProject({...project, layout: {...project.layout, groups: [{id: 'g', moduleIds: ['a']}]}})).toThrow(/at least two/);
    expect(() => parseModuleProject({...project, mappings: [{id: 'm', source: {kind: 'cc', controller: 7}, target: {moduleId: 'z', param: 'x'}}]})).toThrow(/missing module z/);
  });
});
