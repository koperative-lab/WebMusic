import {afterEach, describe, expect, it} from 'vitest';
import {ModuleAudioEnvironment, ModuleProjectRuntime, NoteInputPort, NoteOutputPort, ProjectPluginRegistry, parseMessage, parseModuleProject, type Message, type NoteEvent} from '@webmusic/kernel/module';
import {createObjectPlugins} from '@webmusic/kernel/objects';
import {MidiAccessSource, createMidiPlugins, type MidiAccessLike, type MidiDeviceInput, type MidiDeviceOutput} from '../src/play/headless';

class Device implements MidiDeviceInput {
  onmidimessage: MidiDeviceInput['onmidimessage'] = null;
  constructor(readonly id: string, readonly name: string) {}
  play(...data: number[]) { this.onmidimessage?.({data}); }
}
class Output implements MidiDeviceOutput {
  readonly sent: number[][] = [];
  constructor(readonly id: string, readonly name: string) {}
  send(data: number[] | Uint8Array) { this.sent.push([...data]); }
}
class FakeContext {
  currentTime = 0; state = 'running'; sampleRate = 48000;
  destination: unknown = this.node();
  resume = async () => {};
  node() { return {context: this, gain: {value: 1, setValueAtTime() {}, cancelScheduledValues() {}, linearRampToValueAtTime() {}}, connect() {}, disconnect() {}}; }
  createGain() { return this.node(); }
}

const runtimes: ModuleProjectRuntime[] = [];
afterEach(() => { for (const runtime of runtimes.splice(0)) runtime.dispose(); });

function setup() {
  const keys = new Device('in-1', 'Keys'), pads = new Device('in-2', 'Pads');
  const synth = new Output('out-1', 'Synth');
  const access: MidiAccessLike = {inputs: new Map([[keys.id, keys], [pads.id, pads]]), outputs: new Map([[synth.id, synth]])};
  const source = new MidiAccessSource(async () => access);
  const printed: string[] = [];
  const plugins = new ProjectPluginRegistry();
  for (const plugin of [...createObjectPlugins({print: (_, text) => printed.push(text)}), ...createMidiPlugins(source)]) plugins.register(plugin);
  const runtime = new ModuleProjectRuntime({audio: new ModuleAudioEnvironment({context: new FakeContext() as unknown as BaseAudioContext}), plugins});
  runtimes.push(runtime);
  return {keys, pads, synth, source, runtime, printed};
}
const object = (id: string, name: string, args = '', device?: string) => ({id, contextId: 'root', plugin: {id: `webmusic.object.${name}`, version: '1.0.0'}, config: {args, ...(device ? {device} : {})}});

describe('MIDI objects', () => {
  it('lets several objects listen to one device and restores its handler', async () => {
    const {keys, pads, runtime, printed} = setup();
    const previous = () => {};
    keys.onmidimessage = previous;
    await runtime.restore(parseModuleProject({schema: 'webmusic.module-project', version: 1, id: 'm', contexts: [{id: 'root'}],
      modules: [object('notes', 'notein', '', 'Keys'), object('cc', 'ctlin', '', 'Keys'), object('pad', 'ctlin', '', 'Pads'), object('log', 'print')],
      connections: [{id: 'c', kind: 'message', from: {moduleId: 'cc', port: 'controls'}, to: {moduleId: 'log', port: 'in0'}}]}));
    const heard: NoteEvent[] = [];
    new NoteInputPort({accept: event => heard.push(event)}).connect(runtime.getModule('notes')!.ports!().find(port => port.id === 'notes') as NoteOutputPort);
    keys.play(0x90, 60, 100);
    keys.play(0xb0, 74, 64);
    pads.play(0xb0, 1, 2);
    expect(heard.map(event => [event.gate, event.pitch.midi])).toEqual([['on', 60]]);
    expect(printed).toEqual(['cc 74 64 0']);
    runtime.dispose();
    expect(keys.onmidimessage).toBe(previous);
    expect(pads.onmidimessage).toBeNull();
  });

  it('sends messages and notes to the chosen output, and lists devices', async () => {
    const {synth, source, runtime} = setup();
    await runtime.restore(parseModuleProject({schema: 'webmusic.module-project', version: 1, id: 'o', contexts: [{id: 'root'}],
      modules: [object('raw', 'midiout', '', 'Synth'), object('play', 'noteout', '2')]}));
    (runtime.getModule('raw')!.ports!().find(port => port.id === 'midi') as unknown as {receive(value: Message): void}).receive(parseMessage('cc 7 100 1'));
    const notes = new NoteOutputPort();
    (runtime.getModule('play')!.ports!().find(port => port.id === 'notes') as NoteInputPort).connect(notes);
    notes.emit({occurrenceId: 'a', sourceId: 's', pitch: {midi: 64}, velocity: 1, gate: 'on', axis: 'performance-seconds', time: 0, epoch: 0});
    expect(synth.sent).toEqual([[0xb1, 7, 100], [0x92, 64, 127]]);
    expect((await source.devices()).map(device => `${device.direction} ${device.name}`)).toEqual(['input Keys', 'input Pads', 'output Synth']);
  });

  it('leaves objects unresolved, not the graph failed, when access is refused', async () => {
    const plugins = new ProjectPluginRegistry();
    for (const plugin of createMidiPlugins(new MidiAccessSource(async () => { throw new DOMException('Permission denied', 'NotAllowedError'); }))) plugins.register(plugin);
    const runtime = new ModuleProjectRuntime({audio: new ModuleAudioEnvironment({context: new FakeContext() as unknown as BaseAudioContext}), plugins});
    runtimes.push(runtime);
    const result = await runtime.restore(parseModuleProject({schema: 'webmusic.module-project', version: 1, id: 'r', contexts: [{id: 'root'}], modules: [object('notes', 'notein')]}));
    expect(result.status).toBe('committed');
    expect(runtime.snapshot().modules[0]).toMatchObject({status: 'unresolved', diagnostic: expect.stringMatching(/not granted/)});
  });

  it('leaves an object unresolved when its device is missing', async () => {
    const {runtime} = setup();
    await runtime.restore(parseModuleProject({schema: 'webmusic.module-project', version: 1, id: 'x', contexts: [{id: 'root'}],
      modules: [object('notes', 'notein', '', 'Nowhere'), object('bad', 'notein', '16')]}));
    expect(runtime.snapshot().modules.map(module => module.status)).toEqual(['unresolved', 'unresolved']);
  });
});
