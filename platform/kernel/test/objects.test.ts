import {afterEach, describe, expect, it} from 'vitest';
import {
  ManualMessageClock, ModuleAudioEnvironment, ModuleProjectRuntime, ParamHandle, ParamSurface, ProjectPluginRegistry,
  formatMessage, parseMessage, parseModuleProject, type Message, type ModuleProject, type ProjectPluginFactory,
} from '../src/module';
import {OBJECT_NAMES, compileExpr, createObjectPlugins, objectInterfaceOf} from '../src/objects';
import {FakeContext, FakeNode, FakeParam} from './processor-fakes';

class ObjectContext extends FakeContext {
  readonly sources: {offset: FakeParam; started: boolean; stopped: boolean}[] = [];
  createConstantSource() {
    const node = Object.assign(new FakeNode(this, 'constant'), {offset: new FakeParam(0, 'a-rate'), started: false, stopped: false,
      start() { node.started = true; }, stop() { node.stopped = true; }});
    this.sources.push(node);
    return node;
  }
}

type Spec = readonly [id: string, text: string];
type Wire = readonly [from: string, to: string, kind?: 'message' | 'control'];

const runtimes: ModuleProjectRuntime[] = [];
afterEach(() => { for (const runtime of runtimes.splice(0)) runtime.dispose(); });

/** A project of objects: `[id, 'metro 250']`, cords as `'a:0'` → `'b:1'` (outlet, inlet). */
function project(objects: readonly Spec[], wires: readonly Wire[], states: Record<string, unknown> = {}, extra: readonly object[] = []): ModuleProject {
  return parseModuleProject({schema: 'webmusic.module-project', version: 1, id: 'component',
    contexts: [{id: 'root'}],
    modules: [...extra, ...objects.map(([id, text]) => {
      const [name, ...args] = text.split(' ');
      return {id, contextId: 'root', plugin: {id: `webmusic.object.${name}`, version: '1.0.0'},
        config: {args: args.join(' '), ...(states[id] === undefined ? {} : {state: states[id]})}};
    })],
    connections: wires.filter(wire => wire[2] !== 'control').map(([from, to], index) => {
      const [fromId, outlet] = from.split(':'), toId = to.slice(0, to.indexOf(':')), inlet = to.slice(to.indexOf(':') + 1);
      return {id: `c${index}`, kind: 'message', from: {moduleId: fromId, port: `out${outlet}`},
        to: {moduleId: toId, port: inlet.startsWith('param') ? inlet : `in${inlet}`}};
    }),
  });
}

function setup(extra: ProjectPluginFactory[] = []) {
  const audio = new ObjectContext();
  audio.state = 'running';
  audio.currentTime = 0;
  const clock = new ManualMessageClock(0);
  const printed: string[] = [];
  const errors: unknown[] = [];
  let seed = 0.5;
  const plugins = new ProjectPluginRegistry();
  for (const plugin of createObjectPlugins({clock: () => clock, print: (name, text) => printed.push(`${name}: ${text}`),
    random: () => seed, onError: error => errors.push(error)})) plugins.register(plugin);
  for (const plugin of extra) plugins.register(plugin);
  const runtime = new ModuleProjectRuntime({audio: new ModuleAudioEnvironment({context: audio as unknown as BaseAudioContext}), plugins});
  runtimes.push(runtime);
  const send = (id: string, text: string, inlet = 0) => {
    const port = runtime.getModule(id)!.ports!().find(item => item.id === `in${inlet}`) as {receive(value: Message): void};
    port.receive(parseMessage(text));
  };
  const advance = (seconds: number) => { audio.currentTime = seconds; clock.advance(seconds); };
  return {audio, clock, runtime, printed, errors, send, advance, setSeed: (value: number) => { seed = value; }};
}

async function run(objects: readonly Spec[], wires: readonly Wire[], states?: Record<string, unknown>) {
  const harness = setup();
  expect((await harness.runtime.restore(project(objects, wires, states))).status).toBe('committed');
  return harness;
}

describe('object library', () => {
  it('lists every planned object as a plugin', () => {
    expect(OBJECT_NAMES).toEqual(['loadbang', 'metro', 'delay', 'pipe', 'line', 'counter', 'select', 'route', 'gate', 'switch',
      'trigger', 'pack', 'unpack', 'expr', 'scale', 'random', 'print', 'sig', 'ramp', 'button', 'toggle', 'number', 'slider',
      'dial', 'message', 'menu', 'tab', 'multislider', 'matrix', 'preset', 'nodes', 'component', 'inlet', 'outlet', 'inlet~', 'outlet~']);
    expect(createObjectPlugins().map(plugin => plugin.id)).toContain('webmusic.object.metro');
  });

  it('counts metro ticks, selects zero and flashes a button at the tick time (MSG-A1)', async () => {
    const {advance, printed, runtime} = await run(
      [['go', 'loadbang'], ['tick', 'metro 250'], ['count', 'counter 7'], ['zero', 'select 0'], ['flash', 'button'], ['log', 'print n']],
      [['go:0', 'tick:0'], ['tick:0', 'count:0'], ['count:0', 'zero:0'], ['zero:0', 'flash:0'], ['count:0', 'log:0']]);
    const button = objectInterfaceOf(runtime.getModule('flash'))!;
    expect(printed).toEqual(['n: 0']);
    expect(button.snapshot()).toEqual({flashes: 1});
    advance(2.05);
    expect(printed.slice(-1)).toEqual(['n: 0']);
    expect(printed).toHaveLength(9);
    expect(button.snapshot()).toEqual({flashes: 2});
  });

  it('does nothing until its graph commits, and keeps state across a rebuild (MSG-A5)', async () => {
    const harness = setup();
    const objects: Spec[] = [['tick', 'metro 100'], ['count', 'counter'], ['log', 'print']];
    const wires: Wire[] = [['tick:0', 'count:0'], ['count:0', 'log:0']];
    await harness.runtime.restore(project(objects, wires));
    harness.send('tick', '1');
    harness.advance(0.25);
    expect(harness.printed).toEqual(['print: 0', 'print: 1', 'print: 2']);
    const saved = harness.runtime.exportProject();
    expect(saved.modules.find(module => module.id === 'tick')?.config.state).toEqual({running: true, interval: 100});
    expect(saved.modules.find(module => module.id === 'count')?.config.state).toEqual({next: 3});
    await harness.runtime.restore(saved);
    expect(harness.printed).toEqual(['print: 0', 'print: 1', 'print: 2', 'print: 3']);
    harness.advance(0.36);
    expect(harness.printed.slice(-1)).toEqual(['print: 4']);
  });

  it('fires trigger right to left and fans out in connection order (MSG-A2)', async () => {
    const {send, printed} = await run(
      [['t', 'trigger b i f s'], ['a', 'print a'], ['b', 'print b'], ['c', 'print c'], ['d', 'print d']],
      [['t:0', 'a:0'], ['t:1', 'b:0'], ['t:2', 'c:0'], ['t:3', 'd:0']]);
    send('t', '2.7 x');
    expect(printed).toEqual(['d: x', 'c: 2.7', 'b: 2', 'a: bang']);
  });

  it('routes, gates, switches, packs and unpacks', async () => {
    const {send, printed} = await run(
      [['r', 'route freq amp'], ['g', 'gate 2'], ['s', 'switch 2 1'], ['p', 'pack 0 0.5 s'], ['u', 'unpack 0 0.'], ['log', 'print']],
      [['r:0', 'log:0'], ['r:2', 'log:0'], ['g:1', 'log:0'], ['s:0', 'log:0'], ['p:0', 'log:0'], ['u:0', 'log:0'], ['u:1', 'log:0']]);
    send('r', 'freq 440'); send('r', 'other 1');
    send('g', '9', 1); send('g', '2'); send('g', 'hello', 1);
    send('s', 'a', 1); send('s', 'b', 2);
    send('p', '7', 1); send('p', 'name', 2); send('p', '3');
    send('u', '1 2 3');
    expect(printed).toEqual(['print: 440', 'print: other 1', 'print: hello', 'print: a', 'print: 3 7. name', 'print: 2.', 'print: 1']);
  });

  it('evaluates expr with Max typing, scales and draws seeded randoms', async () => {
    const {send, printed, setSeed} = await run(
      [['e', 'expr $i1 / $i2 + $f3'], ['sc', 'scale 0 127 0. 1.'], ['rnd', 'random 10'], ['log', 'print']],
      [['e:0', 'log:0'], ['sc:0', 'log:0'], ['rnd:0', 'log:0']]);
    send('e', '2', 1); send('e', '0.25', 2); send('e', '7');
    send('sc', '127');
    setSeed(0.75); send('rnd', 'bang');
    expect(printed).toEqual(['print: 3.25', 'print: 1.', 'print: 7']);
    expect(compileExpr('$i1 > 2 ? 10 : max($i1, -3)').evaluate([1]).value).toBe(1);
    expect(compileExpr('7 / 2').evaluate([])).toEqual({value: 3, float: false});
    expect(() => compileExpr('foo(1)')).toThrow(/no function/);
    expect(() => compileExpr('1 +')).toThrow(SyntaxError);
  });

  it('times delay, pipe and line on the clock', async () => {
    const {send, advance, printed} = await run(
      [['d', 'delay 100'], ['p', 'pipe 50'], ['l', 'line 0. 50'], ['log', 'print']],
      [['d:0', 'log:0'], ['p:0', 'log:0'], ['l:0', 'log:0'], ['l:1', 'log:0']]);
    send('d', 'bang'); send('p', '1 2');
    advance(0.06);
    expect(printed).toEqual(['print: 1 2']);
    advance(0.11);
    expect(printed).toEqual(['print: 1 2', 'print: bang']);
    send('l', '1 100');
    advance(0.4);
    expect(printed.slice(2)).toEqual(['print: 0.5', 'print: 1.', 'print: bang']);
  });

  it('sets a parameter from a message cord (MSG-A3)', async () => {
    const handle = new ParamHandle({id: 'frequency', unit: 'Hz', range: {min: 20, max: 20000}, defaultValue: 1000});
    const filter: ProjectPluginFactory = {id: 'test.filter', version: '1', create: ({record}) => ({
      module: {id: record.id, params: new ParamSurface([handle])}, ports: [], dispose: () => {}})};
    const harness = setup([filter]);
    await harness.runtime.restore(project([['n', 'number']], [['n:0', 'f:param:frequency']], {},
      [{id: 'f', contextId: 'root', plugin: {id: 'test.filter', version: '1'}, config: {}}]));
    objectInterfaceOf(harness.runtime.getModule('n'))!.interact(parseMessage('440'));
    expect(handle.snapshot.baseValue).toBe(440);
  });

  it('drives sig and ramp control outputs on the scheduled time (MSG-A4)', async () => {
    const {audio, send, runtime} = await run([['s', 'sig 0.5'], ['r', 'ramp']], []);
    expect(runtime.snapshot().modules[0]!.ports.map(port => `${port.kind}/${port.id}`)).toEqual(['message/in0', 'control/output']);
    const [sig, ramp] = audio.sources;
    expect(sig!.started).toBe(true);
    const timed = parseMessage('0.25', 0.5);
    (runtime.getModule('s')!.ports!()[0] as {receive(value: Message): void}).receive(timed);
    expect(sig!.offset.writes.at(-1)).toEqual({value: 0.25, time: 0.5});
    send('r', '1 100 0 50');
    expect(ramp!.offset.writes.map(write => write.value)).toEqual([0, 1, 0]);
    expect(ramp!.offset.writes.at(-1)!.time).toBeCloseTo(0.15);
    runtime.dispose();
    expect(sig!.stopped).toBe(true);
  });

  it('holds interface values, with set changing them silently', async () => {
    const {send, printed, runtime} = await run(
      [['t', 'toggle'], ['n', 'number 0 10'], ['f', 'slider 0. 1.'], ['m', 'message $1 times, done'], ['menu', 'menu low mid high'],
        ['ms', 'multislider 3 0 10'], ['x', 'matrix 2 2'], ['log', 'print']],
      [['t:0', 'log:0'], ['n:0', 'log:0'], ['f:0', 'log:0'], ['m:0', 'log:0'], ['menu:0', 'log:0'], ['menu:1', 'log:0'], ['ms:0', 'log:0'], ['x:0', 'log:0']]);
    const view = (id: string) => objectInterfaceOf(runtime.getModule(id))!;
    view('t').interact(parseMessage('bang'));
    send('t', 'set 0');
    send('n', '99');
    view('f').interact(parseMessage('0.25'));
    send('m', '3');
    view('menu').interact(parseMessage('2'));
    view('ms').interact(parseMessage('1 20 3'));
    view('x').interact(parseMessage('1 0 1'));
    expect(printed).toEqual(['print: 1', 'print: 10', 'print: 0.25', 'print: 3 times', 'print: done', 'print: high', 'print: 2',
      'print: 1 10 3', 'print: 1 0 1']);
    expect([view('t').snapshot(), view('n').snapshot(), view('menu').snapshot(), view('x').snapshot()]).toEqual([
      {on: false}, {value: 10, min: 0, max: 10, float: false}, {items: ['low', 'mid', 'high'], index: 2}, {columns: 2, rows: 2, cells: [0, 1, 0, 0]}]);
    expect(formatMessage(parseMessage('3 times'))).toBe('3 times');
  });

  it('keeps an object with bad arguments as an unresolved module with the reason', async () => {
    const harness = setup();
    expect((await harness.runtime.restore(project([['s', 'select'], ['e', 'expr 1 +'], ['log', 'print']], [['s:0', 'log:0']]))).status).toBe('committed');
    const modules = harness.runtime.snapshot().modules;
    expect(modules.map(module => module.status)).toEqual(['unresolved', 'unresolved', 'ready']);
    expect(harness.runtime.snapshot().unresolved.map(item => item.reason).join(' ')).toMatch(/select needs at least one value.*expr: expected a value/s);
  });
});
