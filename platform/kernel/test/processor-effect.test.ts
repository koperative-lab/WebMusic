import {describe, expect, it, vi} from 'vitest';
import {InsertChain} from '../src/effect';
import {
  prepareProcessor, PROCESSOR_PROTOCOL_VERSION, processorEffect,
  type ProcessorDefinition, type ProcessorNodeFactory,
} from '../src/processor';

// Structural stand-ins: enough of Web Audio for InsertChain's managed edges
// and for the node a processor effect realizes.

class FakeNode {
  readonly connections = new Set<FakeNode>();
  disconnected = 0;
  constructor(readonly context: FakeContext) {}
  connect(destination: FakeNode): FakeNode { this.connections.add(destination); return destination; }
  disconnect(destination?: FakeNode): void {
    if (destination) { this.connections.delete(destination); return; }
    this.disconnected++;
    this.connections.clear();
  }
}

class FakeParam {
  readonly defaultValue: number;
  constructor(public value: number, readonly minValue: number, readonly maxValue: number, readonly automationRate: 'a-rate' | 'k-rate') {
    this.defaultValue = value;
  }
}

class FakeWorkletNode extends FakeNode {
  readonly parameters = new Map<string, FakeParam>();
  closed = 0;
  onprocessorerror: (() => void) | null = null;
  readonly port = {
    onmessage: null as ((event: {data: unknown}) => void) | null,
    postMessage: () => {},
    close: () => { this.closed++; },
  };
  constructor(context: FakeContext, readonly name: string, readonly options: AudioWorkletNodeOptions, definition: ProcessorDefinition) {
    super(context);
    for (const param of definition.params ?? []) {
      this.parameters.set(param.id, new FakeParam(Number(options.parameterData?.[param.id]), param.range.min, param.range.max,
        param.modulation === 'audio-rate' ? 'a-rate' : 'k-rate'));
    }
  }
  receive(data: unknown): void { this.port.onmessage?.({data}); }
}

class FakeContext {
  currentTime = 0;
  readonly audioWorklet = {addModule: () => Promise.resolve()};
  createGain(): FakeNode { return new FakeNode(this); }
}

const clip: ProcessorDefinition = {
  id: 'test.soft-clip',
  version: '1.0.0',
  audioInputs: [{id: 'input', channels: 2}],
  params: [
    {id: 'drive', unit: 'ratio', range: {min: 1, max: 20}, defaultValue: 1, modulation: 'audio-rate'},
    {id: 'curve', unit: 'index', range: {min: 0, max: 2}, defaultValue: 0},
  ],
};

async function setup(definition: ProcessorDefinition = clip) {
  const context = new FakeContext();
  const audio = context as unknown as BaseAudioContext;
  await prepareProcessor(audio, definition, {module: '/clip.js'});
  const nodes: FakeWorkletNode[] = [];
  const createNode = vi.fn<ProcessorNodeFactory>((received, name, options) => {
    const node = new FakeWorkletNode(received as unknown as FakeContext, name, options, definition);
    nodes.push(node);
    return node as unknown as AudioWorkletNode;
  });
  return {context, audio, nodes, createNode};
}

describe('processorEffect', () => {
  it('realizes one node per slot that is both the input and the output', async () => {
    const {audio, nodes, createNode} = await setup();
    const effect = processorEffect(clip, {createNode, config: {oversample: 2}});
    const first = effect.createAudioNodes(audio);
    const second = effect.createAudioNodes(audio);
    expect(nodes).toHaveLength(2);
    expect(first.input).toBe(nodes[0]);
    expect(first.output).toBe(nodes[0]);
    expect(second.input).not.toBe(first.input);
    expect(nodes[0].options).toEqual({
      numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2],
      channelCount: 2, channelCountMode: 'explicit', channelInterpretation: 'speakers',
      parameterData: {drive: 1, curve: 0},
      processorOptions: {protocol: PROCESSOR_PROTOCOL_VERSION, name: 'test.soft-clip@1.0.0', config: {oversample: 2}},
    });
    expect(Object.keys(first.params!)).toEqual(['drive', 'curve']);
    expect(first.params!.drive).toBe(nodes[0].parameters.get('drive'));
  });

  it('plugs into an InsertChain with the definition parameters', async () => {
    const {audio, nodes, createNode} = await setup();
    const chain = new InsertChain(audio);
    chain.setSlot({id: 'clip', recipe: processorEffect(clip, {createNode})});
    const [node] = nodes;
    expect((chain.input as unknown as FakeNode).connections.has(node)).toBe(true);
    expect(node.connections.has(chain.output as unknown as FakeNode)).toBe(true);
    const [instance] = chain.instances;
    const drive = instance.params.get('drive')!;
    const curve = instance.params.get('curve')!;
    expect(drive.descriptor).toMatchObject({unit: 'ratio', range: {min: 1, max: 20}, modulation: 'audio-rate'});
    expect(curve.descriptor).toMatchObject({unit: 'index', modulation: 'none'});
    drive.setBaseValue(6);
    curve.setBaseValue(2);
    expect(node.parameters.get('drive')!.value).toBe(6);
    expect(node.parameters.get('curve')!.value).toBe(2);
    expect(() => curve.bindAudioParam(audio, node.parameters.get('curve') as unknown as AudioParam)).toThrow(/native modulation/);
  });

  it('retires the node when the slot is replaced or the chain disposed', async () => {
    const {audio, nodes, createNode} = await setup();
    const chain = new InsertChain(audio);
    const effect = processorEffect(clip, {createNode});
    chain.setSlot({id: 'clip', recipe: effect});
    chain.setSlot({id: 'clip', recipe: processorEffect(clip, {createNode, label: 'Clip B'})});
    expect(nodes).toHaveLength(2);
    expect([nodes[0].disconnected, nodes[0].closed, nodes[0].port.onmessage]).toEqual([1, 1, null]);
    expect(nodes[1].closed).toBe(0);
    chain.dispose();
    expect([nodes[1].disconnected, nodes[1].closed]).toEqual([1, 1]);
  });

  it('keeps the working graph when the processor is not prepared in that context', async () => {
    const {audio, nodes, createNode} = await setup();
    const other = new FakeContext() as unknown as BaseAudioContext;
    const chain = new InsertChain(other);
    expect(() => chain.setSlot({id: 'clip', recipe: processorEffect(clip, {createNode})})).toThrow(/not prepared/);
    expect(chain.instances).toEqual([]);
    expect((chain.input as unknown as FakeNode).connections.has(chain.output as unknown as FakeNode)).toBe(true);
    expect(nodes).toHaveLength(0);
    expect(audio).toBeDefined();
  });

  it('closes a half-built node when its parameters do not match the definition', async () => {
    const {audio} = await setup();
    let built: FakeWorkletNode | undefined;
    const wrong: ProcessorNodeFactory = (received, name, options) => {
      built = new FakeWorkletNode(received as unknown as FakeContext, name, options, {...clip, params: [clip.params![0]]});
      return built as unknown as AudioWorkletNode;
    };
    expect(() => processorEffect(clip, {createNode: wrong}).createAudioNodes(audio)).toThrow(/no AudioParam curve/);
    expect([built!.disconnected, built!.closed]).toEqual([1, 1]);
  });

  it('reports a processor failure once per realization and forwards observations', async () => {
    const {audio, nodes, createNode} = await setup();
    const onError = vi.fn();
    const onReport = vi.fn();
    const effect = processorEffect(clip, {createNode, onError, onReport});
    effect.createAudioNodes(audio);
    nodes[0].receive({type: 'data', data: 0.25});
    nodes[0].receive({type: 'error', message: 'boom'});
    nodes[0].onprocessorerror!();
    expect(onReport).toHaveBeenCalledWith(0.25);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith('boom');
  });

  it('labels the recipe and repeats disposal safely', async () => {
    const {audio, nodes, createNode} = await setup();
    const effect = processorEffect(clip, {createNode});
    expect(effect.label).toBe('test.soft-clip');
    const bundle = effect.createAudioNodes(audio);
    bundle.dispose!();
    bundle.dispose!();
    expect(nodes[0].closed).toBe(1);
  });

  it('rejects definitions an insert cannot carry', () => {
    expect(() => processorEffect({id: 'test.tone', version: '1.0.0'})).toThrow(/no audio input/);
    expect(() => processorEffect({...clip, noteInput: true})).toThrow(/note input/);
    expect(() => processorEffect({...clip, transport: true})).toThrow(/transport/);
  });
});
