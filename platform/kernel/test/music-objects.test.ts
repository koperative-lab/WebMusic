import {afterEach, describe, expect, it} from 'vitest';
import {
  ManualMessageClock, ModuleAudioEnvironment, ModuleProjectRuntime, NoteInputPort, NoteOutputPort, ProjectPluginRegistry,
  formatMessage, multichannelPlugin, parseMessage, parseModuleProject,
  type Message, type NoteEvent, type ProjectPluginFactory,
} from '../src/module';
import {createObjectPlugins, toOsc} from '../src/objects';
import {FakeContext, FakeNode} from './processor-fakes';

class MusicContext extends FakeContext {
  createChannelSplitter(channels: number) { return Object.assign(new FakeNode(this, `split${channels}`), {numberOfOutputs: channels}); }
  createChannelMerger(channels: number) { return Object.assign(new FakeNode(this, `merge${channels}`), {numberOfInputs: channels}); }
}

const runtimes: ModuleProjectRuntime[] = [];
afterEach(() => { for (const runtime of runtimes.splice(0)) runtime.dispose(); });

function setup(extra: ProjectPluginFactory[] = []) {
  const audio = new MusicContext();
  audio.state = 'running';
  audio.currentTime = 0;
  const clock = new ManualMessageClock(0);
  const printed: string[] = [];
  const plugins = new ProjectPluginRegistry();
  for (const plugin of [...createObjectPlugins({clock: () => clock, print: (name, text) => printed.push(`${name}: ${text}`)}), ...extra]) plugins.register(plugin);
  const runtime = new ModuleProjectRuntime({audio: new ModuleAudioEnvironment({context: audio as unknown as BaseAudioContext}), plugins});
  runtimes.push(runtime);
  const port = <T>(id: string, name: string) => runtime.getModule(id)!.ports!().find(item => item.id === name) as T;
  const send = (id: string, text: string, inlet = 'in0') => port<{receive(value: Message): void}>(id, inlet).receive(parseMessage(text));
  const advance = (seconds: number) => { audio.currentTime = seconds; clock.advance(seconds); };
  return {audio, runtime, printed, port, send, advance};
}

const object = (id: string, name: string, args = '', contextId = 'root', extra: object = {}) =>
  ({id, contextId, plugin: {id: `webmusic.object.${name}`, version: '1.0.0'}, config: {args, ...extra}});
const cord = (id: string, from: string, to: string, kind = 'message', fromPort = 'out0', toPort = 'in0') =>
  ({id, kind, from: {moduleId: from, port: fromPort}, to: {moduleId: to, port: toPort}});

describe('musical time in objects', () => {
  it('reports the transport and locks a metro to the beat while it plays', async () => {
    const {runtime, printed, send, advance} = setup();
    await runtime.restore(parseModuleProject({schema: 'webmusic.module-project', version: 1, id: 'm', contexts: [{id: 'root'}],
      session: {positionSeconds: 0, rate: 1, tempo: {bpm: 120, beatsPerBar: 4, beatUnit: 4}},
      modules: [object('t', 'transport'), object('beat', 'metro', '4n'), object('log', 'print')],
      connections: [cord('a', 't', 'log'), cord('b', 't', 'log', 'message', 'out1'), cord('c', 'beat', 'log')]}));
    send('t', 'bang');
    expect(printed).toEqual(['print: 120.', 'print: 1 1 0']);
    printed.length = 0;
    send('beat', '1');
    advance(1);
    expect(printed).toEqual([]);
    runtime.updateTempo({bpm: 60});
    expect(runtime.exportProject().session.tempo).toEqual({bpm: 60, beatsPerBar: 4, beatUnit: 4});
  });
});

describe('makenote', () => {
  it('plays a note at the message time and releases it after the duration', async () => {
    const {runtime, port, advance} = setup();
    await runtime.restore(parseModuleProject({schema: 'webmusic.module-project', version: 1, id: 'n', contexts: [{id: 'root'}],
      modules: [object('make', 'makenote', '64 250')]}));
    const heard: NoteEvent[] = [];
    new NoteInputPort({accept: event => heard.push(event)}).connect(port<NoteOutputPort>('make', 'notes'));
    port<{receive(value: Message): void}>('make', 'in0').receive(parseMessage('60', 0.5));
    port<{receive(value: Message): void}>('make', 'in0').receive(parseMessage('62 0 100'));
    expect(heard.map(event => [event.gate, event.pitch.midi, event.time, event.velocity])).toEqual([['on', 60, 0.5, 64 / 127]]);
    advance(0.76);
    expect(heard.map(event => [event.gate, event.time])).toEqual([['on', 0.5], ['off', 0.75]]);
    port<{receive(value: Message): void}>('make', 'in2').receive(parseMessage('8n'));
    port<{receive(value: Message): void}>('make', 'in0').receive(parseMessage('67 100', 1));
    advance(1.3);
    expect(heard.at(-1)).toMatchObject({gate: 'off', time: 1.25, pitch: {midi: 67}});
  });
});

describe('poly', () => {
  it('sends each note to one voice, steals the oldest, and broadcasts message inlets', async () => {
    const {runtime, port, printed} = setup();
    await runtime.restore(parseModuleProject({schema: 'webmusic.module-project', version: 1, id: 'p',
      contexts: [{id: 'root'}, {id: 'v1', parentId: 'root', ownerModuleId: 'poly'}, {id: 'v2', parentId: 'root', ownerModuleId: 'poly'}],
      modules: [
        {id: 'poly', contextId: 'root', plugin: {id: 'webmusic.object.poly', version: '1.0.0'}, config: {voices: 2, inlets: ['message'], outlets: ['message']}},
        object('log', 'print'),
        object('voice1', 'voice', '', 'v1'), object('in1', 'inlet', '0', 'v1'), object('out1', 'outlet', '0', 'v1'),
        object('voice2', 'voice', '', 'v2'), object('in2', 'inlet', '0', 'v2'), object('out2', 'outlet', '0', 'v2'),
      ],
      connections: [cord('a', 'in1', 'out1'), cord('b', 'in2', 'out2'), cord('c', 'poly', 'log')]}));
    const voices = [[] as string[], [] as string[]];
    ['voice1', 'voice2'].forEach((id, index) => new NoteInputPort({accept: event => voices[index]!.push(`${event.gate} ${event.pitch.midi}`)}).connect(port<NoteOutputPort>(id, 'notes')));
    const keys = new NoteOutputPort();
    port<NoteInputPort>('poly', 'notes').connect(keys);
    const note = (id: string, midi: number, gate: 'on' | 'off') => keys.emit({occurrenceId: id, sourceId: 'k', pitch: {midi}, velocity: 0.5, gate, axis: 'performance-seconds', time: 0, epoch: 0});
    note('a', 60, 'on'); note('b', 64, 'on'); note('c', 67, 'on');
    note('b', 64, 'off');
    expect(voices).toEqual([['on 60', 'cancel 60', 'on 67'], ['on 64', 'off 64']]);
    port<{receive(value: Message): void}>('poly', 'in0').receive(parseMessage('7'));
    expect(printed).toEqual(['print: 7', 'print: 7']);
  });
});

describe('multichannel', () => {
  it('runs one instance per channel between a splitter and a merger', async () => {
    const created: string[] = [];
    const gain: ProjectPluginFactory = {id: 'test.gain', version: '1', create: ({record, context}) => {
      created.push(record.id);
      const node = context.audio.prepare().createGain();
      return {module: {id: record.id}, ports: [], getInput: () => node, dispose: () => {}};
    }};
    const {runtime} = setup([multichannelPlugin(gain)]);
    await runtime.restore(parseModuleProject({schema: 'webmusic.module-project', version: 1, id: 'mc', contexts: [{id: 'root'}],
      modules: [{id: 'g', contextId: 'root', plugin: {id: 'test.mc.gain', version: '1'}, config: {channels: 3, config: {}}}]}));
    expect(created).toEqual(['g.0', 'g.1', 'g.2']);
    expect(runtime.snapshot().modules[0]!.ports.map(port => port.id)).toEqual(['input', 'output']);
  });
});

describe('OSC objects', () => {
  it('turns address messages into OSC packets', () => {
    expect(toOsc(parseMessage('/synth/cutoff 0.5 3 saw'))).toEqual({address: '/synth/cutoff', args: [{type: 'f', value: 0.5}, {type: 'i', value: 3}, {type: 's', value: 'saw'}]});
    expect(toOsc(parseMessage('cutoff 1'))).toBeUndefined();
    expect(formatMessage(parseMessage('/a 1'))).toBe('/a 1');
  });
});

