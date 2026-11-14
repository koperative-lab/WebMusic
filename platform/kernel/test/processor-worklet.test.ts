import {describe, expect, it, vi} from 'vitest';
import {PROCESSOR_PROTOCOL_VERSION, type ProcessorDefinition, type ProcessorNodeOptions} from '../src/processor';
import {defineProcessor, type ProcessorBlock, type ProcessorImplementation, type ProcessorWorkletScope} from '../src/processor-worklet';

const definition: ProcessorDefinition = {
  id: 'test.gain',
  version: '1.0.0',
  audioInputs: [{id: 'input', channels: 1}],
  audioOutputs: [{id: 'output', channels: 1}],
  params: [{id: 'gain', unit: 'ratio', range: {min: 0, max: 2}, defaultValue: 1, modulation: 'audio-rate'}],
};

interface Instance {
  readonly port: {onmessage: ((event: {data: unknown}) => void) | null; postMessage(message: unknown): void};
  process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>): boolean;
}
type Registered = (new (options?: {processorOptions?: ProcessorNodeOptions}) => Instance) & {parameterDescriptors: unknown};

function fakeScope() {
  const registered = new Map<string, Registered>();
  const posted: unknown[] = [];
  const scope = {
    currentFrame: 0,
    sampleRate: 48000,
    registerProcessor(name: string, processor: unknown) {
      if (registered.has(name)) throw new Error(`already registered: ${name}`);
      registered.set(name, processor as Registered);
    },
    AudioWorkletProcessor: class {
      readonly port = {onmessage: null, postMessage: (message: unknown) => { posted.push(message); }};
    },
  };
  return {scope: scope as ProcessorWorkletScope & {currentFrame: number}, registered, posted};
}

const gain: ProcessorImplementation<{blocks: number}> = {
  create: () => ({blocks: 0}),
  process(state, block) {
    state.blocks++;
    const input = block.inputs[0][0], output = block.outputs[0][0], values = block.params.gain;
    for (let index = 0; index < output.length; index++) {
      output[index] = input[index] * (values.length > 1 ? values[index] : values[0]);
    }
  },
};

const quantum = () => [[new Float32Array(4).fill(0.5)]];

describe('defineProcessor', () => {
  it('registers id@version with the definition parameters', () => {
    const {scope, registered} = fakeScope();
    defineProcessor(definition, gain, scope);
    expect([...registered.keys()]).toEqual(['test.gain@1.0.0']);
    expect(registered.get('test.gain@1.0.0')!.parameterDescriptors).toEqual([
      {name: 'gain', defaultValue: 1, minValue: 0, maxValue: 2, automationRate: 'a-rate'},
    ]);
  });

  it('runs the author process over one reused block', () => {
    const {scope, registered} = fakeScope();
    const blocks: ProcessorBlock[] = [];
    defineProcessor(definition, {...gain, process(state, block) { blocks.push(block); gain.process(state, block); }}, scope);
    const instance = new (registered.get('test.gain@1.0.0')!)();
    const first = quantum();
    expect(instance.process(quantum(), first, {gain: new Float32Array([2])})).toBe(true);
    expect([...first[0][0]]).toEqual([1, 1, 1, 1]);
    scope.currentFrame = 128;
    const second = quantum();
    expect(instance.process(quantum(), second, {gain: new Float32Array([0, 1, 2, 0])})).toBe(true);
    expect([...second[0][0]]).toEqual([0, 0.5, 1, 0]);
    expect(blocks[1]).toBe(blocks[0]);
    expect(blocks[1].frame).toBe(128);
    expect(blocks[1].sampleRate).toBe(48000);
  });

  it('hands create the resolved definition, sample rate and config', () => {
    const {scope, registered, posted} = fakeScope();
    let setup: Parameters<typeof gain.create>[0] | undefined;
    defineProcessor(definition, {...gain, create(received) { setup = received; received.report({ready: true}); return {blocks: 0}; }}, scope);
    new (registered.get('test.gain@1.0.0')!)({
      processorOptions: {protocol: PROCESSOR_PROTOCOL_VERSION, name: 'test.gain@1.0.0', config: {mode: 'soft'}},
    });
    expect(setup!.definition.name).toBe('test.gain@1.0.0');
    expect(setup!.sampleRate).toBe(48000);
    expect(setup!.config).toEqual({mode: 'soft'});
    expect(posted).toEqual([{type: 'data', data: {ready: true}}]);
  });

  it('delivers config messages and ignores other traffic', () => {
    const {scope, registered} = fakeScope();
    const received: unknown[] = [];
    defineProcessor(definition, {...gain, message(_state, data) { received.push(data); }}, scope);
    const instance = new (registered.get('test.gain@1.0.0')!)();
    instance.port.onmessage!({data: {type: 'config', data: 1}});
    instance.port.onmessage!({data: {type: 'unknown', data: 2}});
    instance.port.onmessage!({data: undefined});
    expect(received).toEqual([1]);
  });

  it('reports a process error once, silences the block and stops', () => {
    const {scope, registered, posted} = fakeScope();
    let calls = 0;
    defineProcessor(definition, {...gain, process(_state, block) { calls++; block.outputs[0][0].fill(9); throw new Error('boom'); }}, scope);
    const instance = new (registered.get('test.gain@1.0.0')!)();
    const output = quantum();
    expect(instance.process(quantum(), output, {gain: new Float32Array([1])})).toBe(false);
    expect([...output[0][0]]).toEqual([0, 0, 0, 0]);
    expect(instance.process(quantum(), quantum(), {gain: new Float32Array([1])})).toBe(false);
    expect(calls).toBe(1);
    expect(posted).toEqual([{type: 'error', message: 'boom'}]);
  });

  it('reports a create error and never processes', () => {
    const {scope, registered, posted} = fakeScope();
    let calls = 0;
    defineProcessor(definition, {create() { throw new Error('no memory'); }, process() { calls++; }}, scope);
    const instance = new (registered.get('test.gain@1.0.0')!)();
    expect(instance.process(quantum(), quantum(), {gain: new Float32Array([1])})).toBe(false);
    expect(calls).toBe(0);
    expect(posted).toEqual([{type: 'error', message: 'no memory'}]);
  });

  it('refuses a module that speaks another protocol version', () => {
    const {scope, registered, posted} = fakeScope();
    defineProcessor(definition, gain, scope);
    const instance = new (registered.get('test.gain@1.0.0')!)({
      processorOptions: {protocol: PROCESSOR_PROTOCOL_VERSION + 1, name: 'test.gain@1.0.0'},
    });
    expect(instance.process(quantum(), quantum(), {gain: new Float32Array([1])})).toBe(false);
    expect(posted).toHaveLength(1);
    expect((posted[0] as {type: string}).type).toBe('error');
  });

  it('rejects an invalid definition or implementation before registering', () => {
    const {scope, registered} = fakeScope();
    expect(() => defineProcessor({id: '', version: '1'}, gain, scope)).toThrow(TypeError);
    expect(() => defineProcessor(definition, {create: gain.create} as never, scope)).toThrow(TypeError);
    expect(registered.size).toBe(0);
  });

  it('explains itself outside a worklet scope', () => {
    expect(() => defineProcessor(definition, gain)).toThrow(/inside an AudioWorklet module/);
  });
});

describe('defineProcessor note queue', () => {
  const synth: ProcessorDefinition = {id: 'test.synth', version: '1.0.0', noteInput: true};
  type Seen = {gate: string; occurrence: number; midi: number; frameOffset: number; frame: number; epoch: number};

  function instrument() {
    const {scope, registered, posted} = fakeScope();
    const seen: Seen[] = [];
    defineProcessor(synth, {
      create: () => null,
      process() {},
      note(_state, event) { seen.push({gate: event.gate, occurrence: event.occurrence, midi: event.midi, frameOffset: event.frameOffset, frame: scope.currentFrame, epoch: event.epoch}); },
    }, scope);
    const instance = new (registered.get('test.synth@1.0.0')!)();
    const note = (gate: 'on' | 'off' | 'cancel', occurrence: number, frame: number, epoch = 0, midi = 60) =>
      instance.port.onmessage!({data: {type: 'note', gate, occurrence, midi, cents: 0, velocity: 1, frame, epoch}});
    const render = (frame: number) => {
      scope.currentFrame = frame;
      return instance.process([], [[new Float32Array(128)]], {});
    };
    return {seen, posted, note, render, scope};
  }

  it('requires note() when the definition declares note input', () => {
    const {scope} = fakeScope();
    expect(() => defineProcessor(synth, {create: () => null, process() {}}, scope)).toThrow(/needs note/);
  });

  it('delivers each change before the process call of its block, at its frame offset, in time order', () => {
    const {seen, note, render} = instrument();
    note('on', 2, 300);
    note('on', 1, 130);
    note('off', 1, 250);
    render(0);
    expect(seen).toEqual([]);
    render(128);
    expect(seen).toEqual([
      {gate: 'on', occurrence: 1, midi: 60, frameOffset: 2, frame: 128, epoch: 0},
      {gate: 'off', occurrence: 1, midi: 60, frameOffset: 122, frame: 128, epoch: 0},
    ]);
    render(256);
    expect(seen.at(-1)).toMatchObject({gate: 'on', occurrence: 2, frameOffset: 44});
  });

  it('keeps arrival order at equal frames and never lets a release overtake its onset', () => {
    const {seen, note, render} = instrument();
    note('on', 1, 10);
    note('on', 2, 10);
    note('off', 1, 5);
    render(0);
    expect(seen.map(event => `${event.gate}${event.occurrence}@${event.frameOffset}`)).toEqual(['on1@10', 'on2@10', 'off1@10']);
  });

  it('plays a late change at the block start and reports the count at a bounded rate', () => {
    const {seen, posted, note, render} = instrument();
    render(0);
    note('on', 1, 10);
    note('on', 2, 20);
    render(128);
    expect(seen.map(event => event.frameOffset)).toEqual([0, 0]);
    expect(posted).toEqual([{type: 'late', count: 2}]);
    note('off', 1, 30);
    render(256);
    expect(posted).toHaveLength(1);
    render(256 + 48000 / 4);
    expect(posted).toEqual([{type: 'late', count: 2}, {type: 'late', count: 1}]);
  });

  it('does not count a past-time cancel as late', () => {
    const {seen, posted, note, render} = instrument();
    note('on', 1, 0);
    render(0);
    note('cancel', 1, 0);
    render(128);
    render(128 + 48000);
    expect(seen.map(event => `${event.gate}@${event.frameOffset}`)).toEqual(['on@0', 'cancel@0']);
    expect(posted).toEqual([]);
  });

  it('plays an immediate gesture at the next block without counting it late', () => {
    const {seen, posted, note, render} = instrument();
    render(0);
    note('on', 1, -1);
    render(128);
    expect(seen).toEqual([{gate: 'on', occurrence: 1, midi: 60, frameOffset: 0, frame: 128, epoch: 0}]);
    expect(posted).toEqual([]);
  });

  it('withdraws a note cancelled before its onset so it never sounds', () => {
    const {seen, note, render} = instrument();
    note('on', 1, 200);
    note('off', 1, 300);
    note('cancel', 1, 50);
    render(128);
    render(256);
    expect(seen).toEqual([]);
  });

  it('cancels a sounding note at its frame', () => {
    const {seen, note, render} = instrument();
    note('on', 1, 0);
    render(0);
    note('cancel', 1, 140);
    render(128);
    expect(seen.map(event => `${event.gate}@${event.frameOffset}`)).toEqual(['on@0', 'cancel@12']);
  });

  it('releases same-pitch occurrences independently', () => {
    const {seen, note, render} = instrument();
    note('on', 1, 0, 0, 64);
    note('on', 2, 1, 0, 64);
    note('off', 1, 10, 0, 64);
    render(0);
    note('off', 2, 200, 0, 64);
    render(128);
    expect(seen.map(event => `${event.gate}${event.occurrence}`)).toEqual(['on1', 'on2', 'off1', 'off2']);
  });

  it('ignores releases for unknown occurrences and duplicate onsets', () => {
    const {seen, note, render} = instrument();
    note('off', 9, 0);
    note('on', 1, 0);
    note('on', 1, 1);
    render(0);
    expect(seen.map(event => `${event.gate}${event.occurrence}`)).toEqual(['on1']);
  });

  it('withdraws unsounded onsets of an older epoch but keeps every release', () => {
    const {seen, note, render} = instrument();
    note('on', 1, 0, 0);
    render(0);
    note('on', 2, 300, 0);
    note('off', 1, 310, 0);
    note('on', 3, 320, 1);
    note('on', 4, 330, 0);
    render(256);
    expect(seen.map(event => `${event.gate}${event.occurrence}/${event.epoch}`)).toEqual(['on1/0', 'off1/0', 'on3/1']);
  });

  it('ignores note messages when the definition has no note input', () => {
    const {scope, registered} = fakeScope();
    const note = vi.fn();
    defineProcessor(definition, {...gain, note}, scope);
    const instance = new (registered.get('test.gain@1.0.0')!)();
    instance.port.onmessage!({data: {type: 'note', gate: 'on', occurrence: 1, midi: 60, cents: 0, velocity: 1, frame: 0, epoch: 0}});
    instance.process(quantum(), quantum(), {gain: new Float32Array([1])});
    expect(note).not.toHaveBeenCalled();
  });

  it('stops after a note() error like a process() error', () => {
    const {scope, registered, posted} = fakeScope();
    defineProcessor(synth, {create: () => null, process() {}, note() { throw new Error('voice overflow'); }}, scope);
    const instance = new (registered.get('test.synth@1.0.0')!)();
    instance.port.onmessage!({data: {type: 'note', gate: 'on', occurrence: 1, midi: 60, cents: 0, velocity: 1, frame: 0, epoch: 0}});
    expect(instance.process([], [[new Float32Array(128)]], {})).toBe(false);
    expect(posted).toEqual([{type: 'error', message: 'voice overflow'}]);
  });
});
