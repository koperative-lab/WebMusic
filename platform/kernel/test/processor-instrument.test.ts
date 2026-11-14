import {describe, expect, it, vi} from 'vitest';
import {ParamHandle, ParamSurface} from '../src/module/parameter';
import {
  createProcessorInstrument, prepareProcessor, PROCESSOR_IMMEDIATE_FRAME,
  type ProcessorDefinition, type ProcessorNodeFactory,
} from '../src/processor';
import {FakeContext, FakeWorkletNode} from './processor-fakes';

const synth: ProcessorDefinition = {
  id: 'test.poly',
  version: '1.0.0',
  noteInput: true,
  params: [
    {id: 'cutoff', unit: 'hertz', range: {min: 20, max: 20000}, defaultValue: 2000, modulation: 'audio-rate'},
    {id: 'voices', unit: 'count', range: {min: 1, max: 64}, defaultValue: 16},
  ],
};

async function setup(definition: ProcessorDefinition = synth) {
  const audio = new FakeContext();
  await prepareProcessor(audio as unknown as BaseAudioContext, definition, {module: '/poly.js'});
  const nodes: FakeWorkletNode[] = [];
  const createNode = vi.fn<ProcessorNodeFactory>((received, name, options) => {
    const node = new FakeWorkletNode(received as unknown as FakeContext, name, options,
      (definition.params ?? []).map(param => ({id: param.id, rate: param.modulation === 'audio-rate' ? 'a-rate' : 'k-rate'})));
    nodes.push(node);
    return node as unknown as AudioWorkletNode;
  });
  return {audio, nodes, createNode, context: audio as unknown as BaseAudioContext};
}

type Note = {gate: string; occurrence: number; frame: number; midi?: number; velocity?: number};
const notes = (node: FakeWorkletNode): Note[] => node.posted
  .filter(message => (message as {type: string}).type === 'note')
  .map(message => {
    const {gate, occurrence, frame, midi, velocity} = message as Note;
    return gate === 'on' ? {gate, occurrence, frame, midi, velocity} : {gate, occurrence, frame};
  });

describe('createProcessorInstrument', () => {
  it('requires note input and a prepared processor', async () => {
    const {context, createNode} = await setup();
    expect(() => createProcessorInstrument(context, {id: 'test.fx', version: '1.0.0', audioInputs: [{id: 'in', channels: 2}]}, {createNode}))
      .toThrow(/no note input/);
    expect(() => createProcessorInstrument(context, {...synth, version: '2.0.0'}, {createNode})).toThrow(/not prepared/);
    expect(createNode).not.toHaveBeenCalled();
  });

  it('places notes on the audio clock and returns a new occurrence for each start', async () => {
    const {context, nodes, createNode} = await setup();
    const instrument = createProcessorInstrument(context, synth, {createNode});
    expect(instrument.node).toBe(nodes[0]);
    const first = instrument.start(60, 0.5, 2);
    const second = instrument.start(60, 1, 2.5);
    instrument.release(first, 3);
    expect([first, second]).toEqual([1, 2]);
    expect(notes(nodes[0])).toEqual([
      {gate: 'on', occurrence: 1, frame: 96000, midi: 60, velocity: 0.5},
      {gate: 'on', occurrence: 2, frame: 120000, midi: 60, velocity: 1},
      {gate: 'off', occurrence: 1, frame: 144000},
    ]);
  });

  it('applies a time at or before currentTime at the next block', async () => {
    const {context, nodes, createNode, audio} = await setup();
    const instrument = createProcessorInstrument(context, synth, {createNode});
    const occurrence = instrument.start(64, 1, audio.currentTime);
    instrument.cancel(occurrence, 0);
    expect(notes(nodes[0]).map(note => note.frame)).toEqual([PROCESSOR_IMMEDIATE_FRAME, PROCESSOR_IMMEDIATE_FRAME]);
  });

  it('validates notes and refuses them after disposal', async () => {
    const {context, createNode} = await setup();
    const instrument = createProcessorInstrument(context, synth, {createNode});
    expect(() => instrument.start(128, 1, 2)).toThrow(RangeError);
    expect(() => instrument.start(60, 1.5, 2)).toThrow(RangeError);
    expect(() => instrument.start(60, 1, Number.NaN)).toThrow(RangeError);
    expect(() => instrument.release(0, 2)).toThrow(TypeError);
    instrument.dispose();
    expect(() => instrument.start(60, 1, 2)).toThrow(/disposed/);
  });

  it('owns its parameter handles by default, starting from the given values', async () => {
    const {context, nodes, createNode} = await setup();
    const instrument = createProcessorInstrument(context, synth, {createNode, values: {voices: 8}});
    expect(nodes[0].options.parameterData).toEqual({cutoff: 2000, voices: 8});
    instrument.params.get('voices')!.setBaseValue(12);
    expect(nodes[0].parameters.get('voices')!.value).toBe(12);
    instrument.dispose();
    expect(instrument.params.get('voices')!.snapshot.disposed).toBe(true);
    expect(() => createProcessorInstrument(context, synth, {createNode, values: {gain: 1}})).toThrow(/no parameter gain/);
  });

  it('binds borrowed handles and leaves them alive after disposal', async () => {
    const {context, nodes, createNode} = await setup();
    const params = new ParamSurface((synth.params ?? []).map(descriptor => new ParamHandle(descriptor)));
    params.get('cutoff')!.setBaseValue(800);
    const first = createProcessorInstrument(context, synth, {createNode, params});
    expect(first.params).toBe(params);
    expect(nodes[0].parameters.get('cutoff')!.value).toBe(800);
    first.dispose();
    params.get('cutoff')!.releaseAudio(context);
    // The same handles drive the next realization.
    createProcessorInstrument(context, synth, {createNode, params});
    params.get('voices')!.setBaseValue(4);
    expect(params.get('voices')!.snapshot.disposed).toBe(false);
    expect(nodes[1].parameters.get('voices')!.value).toBe(4);
    expect(nodes[0].parameters.get('voices')!.value).toBe(16);
  });

  it('rejects borrowed handles that are missing or modulate differently', async () => {
    const {context, createNode} = await setup();
    const [cutoff] = synth.params!;
    expect(() => createProcessorInstrument(context, synth, {createNode, params: new ParamSurface([new ParamHandle(cutoff)])}))
      .toThrow(/voices has no handle/);
    const flat = new ParamSurface([new ParamHandle({...cutoff, modulation: 'none'}), new ParamHandle(synth.params![1])]);
    expect(() => createProcessorInstrument(context, synth, {createNode, params: flat})).toThrow(/audio-rate modulation/);
  });

  it('reports failure once and late notes as they arrive', async () => {
    const {context, nodes, createNode} = await setup();
    const onError = vi.fn();
    const onLateNotes = vi.fn();
    const instrument = createProcessorInstrument(context, synth, {createNode, onError, onLateNotes});
    nodes[0].receive({type: 'late', count: 2});
    nodes[0].receive({type: 'late', count: 1});
    expect(instrument.lateNotes).toBe(3);
    expect(onLateNotes.mock.calls).toEqual([[2], [1]]);
    nodes[0].receive({type: 'error', message: 'boom'});
    nodes[0].receive({type: 'error', message: 'again'});
    expect([instrument.state, instrument.error]).toEqual(['error', 'boom']);
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('stops the processor, disconnects and closes once on disposal', async () => {
    const {context, nodes, createNode} = await setup();
    const instrument = createProcessorInstrument(context, synth, {createNode});
    instrument.dispose();
    instrument.dispose();
    expect(nodes[0].posted.at(-1)).toEqual({type: 'close'});
    expect([nodes[0].disconnected, nodes[0].closed, nodes[0].port.onmessage]).toEqual([1, 1, null]);
    expect(instrument.state).toBe('detached');
  });
});
