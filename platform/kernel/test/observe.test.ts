import {afterEach, describe, expect, it} from 'vitest';
import {
  ManualMessageClock, MessageDebugger, ModuleAudioEnvironment, ModuleProjectRuntime, ProjectPluginRegistry, formatMessage, parseMessage, parseModuleProject,
  type Message, type ProbeEvent,
} from '../src/module';
import {createObjectPlugins} from '../src/objects';
import {FakeContext, FakeNode} from './processor-fakes';

class ProbeContext extends FakeContext {
  createAnalyser() { return Object.assign(new FakeNode(this, 'analyser'), {fftSize: 2048}); }
  createConstantSource() { return Object.assign(new FakeNode(this, 'constant'), {offset: {value: 0, setValueAtTime() {}, cancelScheduledValues() {}, linearRampToValueAtTime() {}}, start() {}, stop() {}}); }
}

const runtimes: ModuleProjectRuntime[] = [];
afterEach(() => { for (const runtime of runtimes.splice(0)) runtime.dispose(); });

function setup() {
  const audio = new ProbeContext();
  audio.state = 'running';
  audio.currentTime = 0;
  const clock = new ManualMessageClock(0);
  const printed: string[] = [];
  const plugins = new ProjectPluginRegistry();
  for (const plugin of createObjectPlugins({clock: () => clock, print: (_name, text) => printed.push(text)})) plugins.register(plugin);
  const runtime = new ModuleProjectRuntime({audio: new ModuleAudioEnvironment({context: audio as unknown as BaseAudioContext}), plugins});
  runtimes.push(runtime);
  const send = (id: string, text: string) => (runtime.getModule(id)!.ports!().find(port => port.id === 'in0') as unknown as {receive(value: Message): void}).receive(parseMessage(text));
  const advance = (seconds: number) => { audio.currentTime = seconds; clock.advance(seconds); };
  return {audio, clock, runtime, printed, send, advance};
}
const object = (id: string, name: string, args = '') => ({id, contextId: 'root', plugin: {id: `webmusic.object.${name}`, version: '1.0.0'}, config: {args}});
const cord = (id: string, from: string, to: string, fromPort = 'out0', toPort = 'in0') => ({id, kind: 'message', from: {moduleId: from, port: fromPort}, to: {moduleId: to, port: toPort}});
const project = (modules: object[], connections: object[]) => parseModuleProject({schema: 'webmusic.module-project', version: 1, id: 'o', contexts: [{id: 'root'}], modules, connections});

describe('runtime observation', () => {
  it('reports each delivery before it happens, in order and depth, without changing it', async () => {
    const {runtime, printed, send} = setup();
    await runtime.restore(project(
      [object('t', 'trigger', 'b f'), object('a', 'print', 'a'), object('b', 'print', 'b')],
      [cord('right', 't', 'b', 'out1'), cord('left', 't', 'a', 'out0')],
    ));
    const seen: string[] = [];
    const stop = runtime.observe(event => {
      if (event.kind === 'message') seen.push(`${event.connectionId}:${formatMessage(event.message)}@${event.depth} after [${printed.join(',')}]`);
    });
    send('t', '3');
    expect(printed).toEqual(['3.', 'bang']);
    expect(seen).toEqual(['right:3.@1 after []', 'left:bang@1 after [3.]']);
    stop();
    send('t', '4');
    expect(seen).toHaveLength(2);
  });

  it('keeps observing across a rebuild and reports a throwing observer instead of failing delivery', async () => {
    const {runtime, printed, send} = setup();
    const events: ProbeEvent[] = [];
    runtime.observe(() => { throw new Error('view broke'); });
    runtime.observe(event => events.push(event));
    const graph = project([object('n', 'number'), object('p', 'print')], [cord('c', 'n', 'p')]);
    await runtime.restore(graph);
    await runtime.restore(graph);
    send('n', '5');
    expect(printed).toEqual(['5']);
    expect(events.map(event => [event.kind, event.connectionId, event.sequence])).toEqual([['message', 'c', 1]]);
  });

  it('follows an audio output with a signal probe across rebuilds', async () => {
    const {runtime} = setup();
    await runtime.restore(project([object('s', 'sig', '0.5')], []));
    const probe = runtime.probeSignal({moduleId: 's', port: 'output'});
    expect(probe.connected).toBe(true);
    await runtime.restore(project([object('s', 'sig', '0.25')], []));
    expect(probe.connected).toBe(true);
    await runtime.restore(project([], []));
    expect(probe.connected).toBe(false);
    probe.release();
    expect(probe.connected).toBe(false);
  });
});

describe('MessageDebugger', () => {
  it('traces and breaks on a cord, holds timed events and steps them', async () => {
    const {clock, runtime, printed, send, advance} = setup();
    await runtime.restore(project([object('m', 'metro', '100'), object('c', 'counter', '9'), object('p', 'print')],
      [cord('tick', 'm', 'c'), cord('count', 'c', 'p')]));
    const debug = new MessageDebugger(runtime, clock);
    const hits: string[] = [];
    debug.onHit(hit => hits.push(`${hit.watchpoint.id}:${hit.event.kind === 'message' ? formatMessage(hit.event.message) : ''}`));
    debug.set({id: 'w', connectionId: 'count', mode: 'break', condition: event => event.kind === 'message' && formatMessage(event.message) === '2'});
    send('m', '1');
    advance(0.35);
    expect(printed).toEqual(['0', '1', '2']);
    expect(hits).toEqual(['w:2']);
    expect(debug.paused).toBe(true);
    advance(1);
    expect(printed).toHaveLength(3);
    expect(debug.step()).toBe(true);
    expect(printed).toEqual(['0', '1', '2', '3']);
    debug.continue();
    expect(debug.paused).toBe(false);
    // Resuming shifts held events by the time spent holding: no burst of missed ticks.
    advance(1.05);
    expect(printed).toEqual(['0', '1', '2', '3']);
    advance(1.15);
    expect(printed).toEqual(['0', '1', '2', '3', '4']);
    debug.dispose();
  });
});
