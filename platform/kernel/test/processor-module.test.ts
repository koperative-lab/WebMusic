import {describe, expect, it, vi} from 'vitest';
import {checkModuleConformance} from '../src/module/conformance';
import {ModuleAudioEnvironment, ModuleContext} from '../src/module/context';
import {createConnectionLease} from '../src/module/lease';
import {NoteOutputPort, type NoteEvent} from '../src/module/note-port';
import {SessionTransport} from '../src/session';
import {
  createProcessorModule, isProcessorPrepared, prepareProcessor, PROCESSOR_PROTOCOL_VERSION,
  ProcessorUnavailableError, type ProcessorDefinition, type ProcessorNodeFactory,
} from '../src/processor';

// Structural stand-ins for the Web Audio objects a processor module touches.
// They record connections so tests can assert the managed graph exactly.

class FakeNode {
  readonly edges: {destination: FakeNode; output: number; input: number}[] = [];
  channelCount = 2;
  channelCountMode = 'max';
  channelInterpretation = 'speakers';
  disconnected = 0;
  constructor(readonly context: FakeContext, readonly label: string) {}
  connect(destination: FakeNode, output = 0, input = 0): FakeNode {
    this.edges.push({destination, output, input});
    return destination;
  }
  disconnect(destination?: FakeNode): void {
    if (destination) {
      const index = this.edges.findIndex(edge => edge.destination === destination);
      if (index >= 0) this.edges.splice(index, 1);
      return;
    }
    this.disconnected++;
    this.edges.length = 0;
  }
  targets(): FakeNode[] { return this.edges.map(edge => edge.destination); }
}

class FakeParam {
  readonly writes: {value: number; time: number}[] = [];
  constructor(public value: number, readonly automationRate: 'a-rate' | 'k-rate') {}
  setValueAtTime(value: number, time: number): this {
    this.value = value;
    this.writes.push({value, time});
    return this;
  }
}

class FakeWorkletNode extends FakeNode {
  readonly parameters = new Map<string, FakeParam>();
  readonly posted: unknown[] = [];
  closed = 0;
  onprocessorerror: (() => void) | null = null;
  readonly port = {
    onmessage: null as ((event: {data: unknown}) => void) | null,
    postMessage: (message: unknown) => { this.posted.push(message); },
    close: () => { this.closed++; },
  };
  constructor(context: FakeContext, readonly name: string, readonly options: AudioWorkletNodeOptions,
    params: readonly {id: string; rate: 'a-rate' | 'k-rate'}[]) {
    super(context, 'worklet');
    for (const {id, rate} of params) this.parameters.set(id, new FakeParam(Number(options.parameterData?.[id] ?? 0), rate));
  }
  receive(data: unknown): void { this.port.onmessage?.({data}); }
}

class FakeContext {
  state = 'suspended';
  sampleRate = 48000;
  currentTime = 1.5;
  readonly destination = new FakeNode(this, 'destination');
  readonly gains: FakeNode[] = [];
  readonly audioWorklet = {addModule: () => Promise.resolve()};
  createGain(): FakeNode {
    const gain = new FakeNode(this, `gain${this.gains.length}`);
    this.gains.push(gain);
    return gain;
  }
}

const gain: ProcessorDefinition = {
  id: 'test.stereo-gain',
  version: '1.0.0',
  audioInputs: [{id: 'input', channels: 2}, {id: 'sidechain', channels: 1}],
  audioOutputs: [{id: 'output', channels: 2}, {id: 'monitor', channels: 1}],
  params: [
    {id: 'gain', unit: 'ratio', range: {min: 0, max: 2}, defaultValue: 1, modulation: 'audio-rate'},
    {id: 'smooth', unit: 'seconds', range: {min: 0, max: 1}, defaultValue: 0.01, modulation: 'control-rate'},
    {id: 'mode', unit: 'index', range: {min: 0, max: 3}, defaultValue: 0},
  ],
  latencySamples: 96,
};

async function setup(definition: ProcessorDefinition = gain) {
  const audio = new FakeContext();
  const context = new ModuleContext({id: 'root', audio: new ModuleAudioEnvironment({context: audio as unknown as BaseAudioContext})});
  await prepareProcessor(audio as unknown as BaseAudioContext, definition, {module: '/gain.js'});
  const nodes: FakeWorkletNode[] = [];
  const createNode = vi.fn<ProcessorNodeFactory>((received, name, options) => {
    const node = new FakeWorkletNode(received as unknown as FakeContext, name, options,
      (definition.params ?? []).map(param => ({id: param.id, rate: param.modulation === 'audio-rate' ? 'a-rate' : 'k-rate'})));
    nodes.push(node);
    return node as unknown as AudioWorkletNode;
  });
  return {audio, context, nodes, createNode};
}

describe('createProcessorModule', () => {
  it('creates one node with the definition buses, initial parameters and protocol options', async () => {
    const {context, createNode, nodes} = await setup();
    const module = createProcessorModule(context, gain, {id: 'fx', createNode, config: {curve: 'soft'}, params: {gain: 1.5}});
    expect(createNode).toHaveBeenCalledTimes(1);
    const [node] = nodes;
    expect(node.name).toBe('test.stereo-gain@1.0.0');
    expect(node.options).toEqual({
      numberOfInputs: 2,
      numberOfOutputs: 2,
      outputChannelCount: [2, 1],
      parameterData: {gain: 1.5, smooth: 0.01, mode: 0},
      processorOptions: {protocol: PROCESSOR_PROTOCOL_VERSION, name: 'test.stereo-gain@1.0.0', config: {curve: 'soft'}},
    });
    expect(module.state).toBe('ready');
    expect(module.node).toBe(node);
    expect(module.latencySeconds).toBe(96 / 48000);
  });

  it('exposes inputs, outputs and parameters as typed ports in definition order', async () => {
    const {context, createNode} = await setup();
    const module = createProcessorModule(context, gain, {id: 'fx', createNode});
    expect(module.ports().map(port => `${port.family}/${port.direction}/${port.id}`)).toEqual([
      'audio/input/input', 'audio/input/sidechain', 'audio/output/output', 'audio/output/monitor', 'control/input/params',
    ]);
    expect(module.getPort('monitor')).toBe(module.ports()[3]);
    expect(module.getPort('input')).toBeUndefined();
    expect(module.getInput('sidechain')).toBe(module.ports()[1]);
    expect(module.getInput('sidechain')!.latencySeconds).toBe(96 / 48000);
    expect([...module.params].map(handle => handle.descriptor.id)).toEqual(['gain', 'smooth', 'mode']);
  });

  it('gives each input an entry node with its declared channel count and each output its own exit', async () => {
    const {audio, context, createNode, nodes} = await setup();
    const module = createProcessorModule(context, gain, {id: 'fx', createNode, route: 'none'});
    const [node] = nodes;
    const [mainIn, sideIn, mainOut, monitorOut] = audio.gains;
    expect([mainIn.channelCount, mainIn.channelCountMode, sideIn.channelCount, sideIn.channelCountMode]).toEqual([2, 'explicit', 1, 'explicit']);
    expect(mainIn.edges).toEqual([{destination: node, output: 0, input: 0}]);
    expect(sideIn.edges).toEqual([{destination: node, output: 0, input: 1}]);
    expect(node.edges).toEqual([
      {destination: mainOut, output: 0, input: 0},
      {destination: monitorOut, output: 1, input: 0},
    ]);
    expect(module.getInput('input')!.node).toBe(mainIn);
    expect(module.getPort('output')!.node).toBe(mainOut);
  });

  it('routes the first output to the default destination and only that one', async () => {
    const {audio, context, createNode} = await setup();
    const module = createProcessorModule(context, gain, {id: 'fx', createNode});
    const [, , mainOut, monitorOut] = audio.gains;
    expect(mainOut.targets()).toEqual([audio.destination]);
    expect(monitorOut.targets()).toEqual([]);
    module.dispose();
    expect(mainOut.targets()).toEqual([]);
  });

  it('routes through the scope admission when the context has one', async () => {
    const {context, createNode} = await setup();
    const released = vi.fn();
    const admit = vi.fn(() => createConnectionLease(released));
    const scoped = context.derive({id: 'desk', admit});
    const module = createProcessorModule(scoped, gain, {id: 'fx', createNode});
    expect(admit).toHaveBeenCalledWith(module, module.getPort('output'));
    module.dispose();
    expect(released).toHaveBeenCalledTimes(1);
  });

  it('registers once in the scope and releases the registration on disposal', async () => {
    const {context, createNode} = await setup();
    const module = createProcessorModule(context, gain, {id: 'fx', createNode});
    expect(context.registry.get('fx')).toBe(module);
    expect(() => createProcessorModule(context, gain, {id: 'fx', createNode})).toThrow(/already registered/);
    module.dispose();
    expect(context.registry.get('fx')).toBeUndefined();
  });

  it('drives modulatable parameters through their handles and writes the others directly', async () => {
    const {audio, context, createNode, nodes} = await setup();
    const module = createProcessorModule(context, gain, {id: 'fx', createNode});
    const [node] = nodes;
    module.params.get('gain')!.setBaseValue(0.5);
    module.params.get('smooth')!.setBaseValue(0.2);
    expect(node.parameters.get('gain')!.value).toBe(0.5);
    expect(node.parameters.get('smooth')!.value).toBe(0.2);
    audio.currentTime = 3;
    module.params.get('mode')!.setBaseValue(2);
    expect(node.parameters.get('mode')!.writes).toEqual([{value: 2, time: 3}]);
    expect(() => module.params.get('mode')!.bindAudioParam(audio as unknown as BaseAudioContext, node.parameters.get('mode') as unknown as AudioParam))
      .toThrow(/does not support native modulation/);
  });

  it('posts configuration to the processor', async () => {
    const {context, createNode, nodes} = await setup();
    const module = createProcessorModule(context, gain, {id: 'fx', createNode});
    module.configure({curve: 'hard'});
    expect(nodes[0].posted).toEqual([{type: 'config', data: {curve: 'hard'}}]);
    module.dispose();
    expect(() => module.configure({})).toThrow(/disposed/);
  });

  it('reports processor failure once and keeps its routes', async () => {
    const {audio, context, createNode, nodes} = await setup();
    const module = createProcessorModule(context, gain, {id: 'fx', createNode});
    const changes = vi.fn();
    module.subscribe(changes);
    nodes[0].receive({type: 'error', message: 'boom'});
    nodes[0].onprocessorerror!();
    expect(module.state).toBe('error');
    expect(module.error).toBe('boom');
    expect(changes).toHaveBeenCalledTimes(1);
    expect(audio.gains[2].targets()).toEqual([audio.destination]);
  });

  it('treats an uncaught processor error event as a failure', async () => {
    const {context, createNode, nodes} = await setup();
    const module = createProcessorModule(context, gain, {id: 'fx', createNode});
    nodes[0].onprocessorerror!();
    expect(module.state).toBe('error');
    expect(module.error).toMatch(/uncaught/);
  });

  it('delivers author observations and isolates a failing observer', async () => {
    const {context, createNode, nodes} = await setup();
    const onCleanupError = vi.fn();
    const seen: unknown[] = [];
    createProcessorModule(context, gain, {id: 'fx', createNode, onCleanupError, onReport: data => {
      seen.push(data);
      if (data === 'bad') throw new Error('observer failed');
    }});
    nodes[0].receive({type: 'data', data: {level: 0.5}});
    nodes[0].receive({type: 'data', data: 'bad'});
    nodes[0].receive({type: 'unknown'});
    expect(seen).toEqual([{level: 0.5}, 'bad']);
    expect(onCleanupError).toHaveBeenCalledTimes(1);
  });

  it('releases everything it owns, once, and leaves the context open', async () => {
    const {audio, context, createNode, nodes} = await setup();
    const module = createProcessorModule(context, gain, {id: 'fx', createNode});
    const changes = vi.fn();
    module.subscribe(changes);
    const [node] = nodes;
    const ports = module.ports();
    module.dispose();
    module.dispose();
    expect(module.state).toBe('detached');
    expect(changes).toHaveBeenCalledTimes(1);
    expect(node.disconnected).toBe(1);
    expect(node.closed).toBe(1);
    expect(node.port.onmessage).toBeNull();
    expect(node.onprocessorerror).toBeNull();
    expect(audio.gains.every(entry => entry.disconnected === 1)).toBe(true);
    expect(ports.every(port => port.readiness === 'detached')).toBe(true);
    expect([...module.params].every(handle => handle.snapshot.disposed)).toBe(true);
    expect(audio.state).toBe('suspended');
    expect(module.subscribe(() => {})).toBeTypeOf('function');
  });

  it('continues cleanup after an individual failure', async () => {
    const {context, createNode, nodes} = await setup();
    const onCleanupError = vi.fn();
    const module = createProcessorModule(context, gain, {id: 'fx', createNode, onCleanupError});
    nodes[0].port.close = () => { throw new Error('close failed'); };
    module.dispose();
    expect(onCleanupError).toHaveBeenCalledWith(expect.objectContaining({message: 'close failed'}));
    expect(nodes[0].disconnected).toBe(1);
    expect(context.registry.get('fx')).toBeUndefined();
  });

  it('rolls back every acquired resource when construction fails', async () => {
    const {audio, context} = await setup();
    let created: FakeWorkletNode | undefined;
    const missingParam: ProcessorNodeFactory = (received, name, options) => {
      created = new FakeWorkletNode(received as unknown as FakeContext, name, options, [{id: 'gain', rate: 'a-rate'}]);
      return created as unknown as AudioWorkletNode;
    };
    expect(() => createProcessorModule(context, gain, {id: 'fx', createNode: missingParam})).toThrow(/no AudioParam smooth/);
    expect(created!.disconnected).toBe(1);
    expect(created!.closed).toBe(1);
    expect(audio.gains).toEqual([]);
    expect(context.registry.get('fx')).toBeUndefined();
  });

  it('throws without creating a node when the processor is not prepared in that context', async () => {
    const {createNode} = await setup();
    const other = new FakeContext();
    const context = new ModuleContext({id: 'other', audio: new ModuleAudioEnvironment({context: other as unknown as BaseAudioContext})});
    expect(isProcessorPrepared(other as unknown as BaseAudioContext, gain)).toBe(false);
    expect(() => createProcessorModule(context, gain, {id: 'fx', createNode})).toThrow(/not prepared/);
    const unprepared = new ModuleContext({id: 'lazy', audio: new ModuleAudioEnvironment({create: () => other as unknown as BaseAudioContext})});
    expect(() => createProcessorModule(unprepared, gain, {id: 'fx', createNode})).toThrow(/prepared audio context/);
    expect(createNode).not.toHaveBeenCalled();
  });

  it('rejects requests it cannot honour before creating anything', async () => {
    const {context, createNode} = await setup();
    expect(() => createProcessorModule(context, gain, {id: 'fx', createNode, session: 'shared' as never})).toThrow(/session mode/);
    expect(() => createProcessorModule(context, gain, {id: 'fx', createNode, params: {missing: 1}})).toThrow(/no parameter missing/);
    expect(() => createProcessorModule(context, gain, {id: 'fx', createNode, params: {gain: 5}})).toThrow(RangeError);
    expect(() => createProcessorModule(context, gain, {id: 'fx', createNode, route: 'auto' as never})).toThrow(/route/);
    expect(createNode).toHaveBeenCalledTimes(0);
  });

  it('reports a missing AudioWorkletNode as unavailable', async () => {
    const {context} = await setup();
    expect(() => createProcessorModule(context, gain, {id: 'fx'})).toThrow(ProcessorUnavailableError);
    expect(context.registry.get('fx')).toBeUndefined();
  });

  it('passes the module conformance kit', async () => {
    const {context, createNode} = await setup();
    const report = await checkModuleConformance(() => {
      const module = createProcessorModule(context, gain, {id: 'fx', createNode});
      return {module, dispose: () => module.dispose()};
    }, {expectedId: 'fx', repetitions: 3});
    expect(report).toMatchObject({passed: true, instances: 3, failures: []});
  });

  it('creates a generator with no inputs and no parameters', async () => {
    const tone: ProcessorDefinition = {id: 'test.tone', version: '1.0.0'};
    const {audio, context, createNode, nodes} = await setup(tone);
    const module = createProcessorModule(context, tone, {id: 'tone', createNode});
    expect(nodes[0].options).toMatchObject({numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2]});
    expect(module.ports().map(port => port.id)).toEqual(['output']);
    expect(audio.gains[0].targets()).toEqual([audio.destination]);
    const report = await checkModuleConformance(() => {
      const created = createProcessorModule(context, tone, {id: 'tone2', createNode});
      return {module: created, dispose: () => created.dispose()};
    });
    expect(report.passed).toBe(true);
  });

  describe('note input', () => {
    const synth: ProcessorDefinition = {id: 'test.synth', version: '1.0.0', noteInput: true};
    const event = (gate: NoteEvent['gate'], occurrenceId: string, time: number, extra: Partial<NoteEvent> = {}): NoteEvent => ({
      occurrenceId, sourceId: 'keys', pitch: {midi: 60}, velocity: 0.5, gate, axis: 'audio-context-seconds', time, epoch: 0, ...extra,
    });

    it('exposes a notes input between the audio inputs and outputs', async () => {
      const {context, createNode} = await setup(synth);
      const module = createProcessorModule(context, synth, {id: 'synth', createNode});
      expect(module.ports().map(port => `${port.family}/${port.direction}/${port.id}`)).toEqual(['note/input/notes', 'audio/output/output']);
      expect(module.notes).toBe(module.ports()[0]);
    });

    it('posts each change with an integer occurrence and an absolute frame', async () => {
      const {context, createNode, nodes} = await setup(synth);
      const module = createProcessorModule(context, synth, {id: 'synth', createNode});
      module.notes!.accept(event('on', 'a', 2, {pitch: {midi: 64, cents: -12}}));
      module.notes!.accept(event('on', 'b', 2.5));
      module.notes!.accept(event('off', 'a', 3));
      expect(nodes[0].posted).toEqual([
        {type: 'note', gate: 'on', occurrence: 1, midi: 64, cents: -12, velocity: 0.5, frame: 96000, epoch: 0},
        {type: 'note', gate: 'on', occurrence: 2, midi: 60, cents: 0, velocity: 0.5, frame: 120000, epoch: 0},
        {type: 'note', gate: 'off', occurrence: 1, midi: 60, cents: 0, velocity: 0.5, frame: 144000, epoch: 0},
      ]);
    });

    it('keeps same-pitch occurrences from two sources apart and ignores unknown releases', async () => {
      const {context, createNode, nodes} = await setup(synth);
      const module = createProcessorModule(context, synth, {id: 'synth', createNode});
      module.notes!.accept(event('on', 'n', 1));
      module.notes!.accept(event('on', 'n', 1, {sourceId: 'midi'}));
      module.notes!.accept(event('off', 'n', 2, {sourceId: 'midi'}));
      module.notes!.accept(event('off', 'missing', 2));
      module.notes!.accept(event('on', 'n', 3));
      expect(nodes[0].posted.map(message => {
        const note = message as {gate: string; occurrence: number};
        return `${note.gate}${note.occurrence}`;
      })).toEqual(['on1', 'on2', 'off2']);
    });

    it('plays live gestures now and rejects axes it cannot place', async () => {
      const {context, createNode, nodes} = await setup(synth);
      const module = createProcessorModule(context, synth, {id: 'synth', createNode});
      module.notes!.accept(event('on', 'k', 12.5, {axis: 'performance-seconds'}));
      expect(nodes[0].posted[0]).toMatchObject({gate: 'on', frame: -1});
      expect(() => module.notes!.accept(event('on', 's', 1, {axis: 'session-seconds'}))).toThrow(/session-seconds axis/);
    });

    it('uses a supplied noteTime mapping', async () => {
      const {context, createNode, nodes} = await setup(synth);
      const module = createProcessorModule(context, synth, {
        id: 'synth', createNode, noteTime: note => note.axis === 'session-seconds' ? 10 + note.time : undefined,
      });
      module.notes!.accept(event('on', 's', 0.5, {axis: 'session-seconds'}));
      expect(nodes[0].posted[0]).toMatchObject({frame: 504000});
      expect(() => module.notes!.accept(event('on', 'a', 1))).toThrow(/audio-context-seconds axis/);
    });

    it('cancels what a producer started when its connection is released', async () => {
      const {context, createNode, nodes} = await setup(synth);
      const module = createProcessorModule(context, synth, {id: 'synth', createNode});
      const keys = new NoteOutputPort();
      const lease = module.notes!.connect(keys);
      keys.emit(event('on', 'a', 1));
      lease.release();
      expect(nodes[0].posted.at(-1)).toMatchObject({gate: 'cancel', occurrence: 1});
    });

    it('cancels held notes on disposal before closing the processor port', async () => {
      const {context, createNode, nodes} = await setup(synth);
      const module = createProcessorModule(context, synth, {id: 'synth', createNode});
      const keys = new NoteOutputPort();
      module.notes!.connect(keys);
      keys.emit(event('on', 'a', 1));
      module.notes!.accept(event('on', 'direct', 1));
      const port = nodes[0].port;
      const close = port.close;
      let postedBeforeClose = 0;
      port.close = () => { postedBeforeClose = nodes[0].posted.length; close(); };
      module.dispose();
      expect(nodes[0].posted.slice(2).map(message => (message as {gate: string; occurrence: number}).occurrence).sort()).toEqual([1, 2]);
      expect(nodes[0].posted.slice(2).every(message => (message as {gate: string}).gate === 'cancel')).toBe(true);
      expect(postedBeforeClose).toBe(4);
      expect(module.notes!.readiness).toBe('detached');
    });

    it('counts late notes the processor reports and notifies subscribers', async () => {
      const {context, createNode, nodes} = await setup(synth);
      const module = createProcessorModule(context, synth, {id: 'synth', createNode});
      const changes = vi.fn();
      module.subscribe(changes);
      nodes[0].receive({type: 'late', count: 3});
      nodes[0].receive({type: 'late', count: 2});
      expect(module.lateNotes).toBe(5);
      expect(changes).toHaveBeenCalledTimes(2);
    });

    it('passes the module conformance kit with its notes port', async () => {
      const {context, createNode} = await setup(synth);
      const report = await checkModuleConformance(() => {
        const module = createProcessorModule(context, synth, {id: 'synth', createNode});
        return {module, dispose: () => module.dispose()};
      });
      expect(report.failures).toEqual([]);
    });
  });

  describe('Session', () => {
    const follower: ProcessorDefinition = {id: 'test.follower', version: '1.0.0', noteInput: true, transport: true};
    type Posted = {type: string; gate?: string; occurrence?: number; running?: boolean; originFrame?: number; originSeconds?: number; epoch?: number};

    async function inSession(definition: ProcessorDefinition = follower) {
      const world = await setup(definition);
      const session = new SessionTransport(() => world.audio.currentTime, {leadInSeconds: 0, driftCheckIntervalMs: 0, tick: {createWorker: () => null}});
      const scope = world.context.derive({id: 'session', session});
      return {...world, session, scope};
    }
    const posted = (node: {posted: unknown[]}) => node.posted as Posted[];
    const note = (gate: NoteEvent['gate'], occurrenceId: string, axis: string, time = 2): NoteEvent => ({
      occurrenceId, sourceId: 'src', pitch: {midi: 60}, velocity: 1, gate, axis, time, epoch: 0,
    });

    it('copies the current anchor at once, then every new anchor, to the audio thread', async () => {
      const {audio, session, scope, createNode, nodes} = await inSession();
      createProcessorModule(scope, follower, {id: 'p', createNode});
      expect(posted(nodes[0])).toEqual([expect.objectContaining({type: 'transport', running: false, originSeconds: 0})]);
      audio.currentTime = 2;
      await session.play();
      expect(posted(nodes[0]).at(-1)).toMatchObject({type: 'transport', running: true, originFrame: 96000, originSeconds: 0});
      audio.currentTime = 3;
      await session.seek(10);
      expect(posted(nodes[0]).at(-1)).toMatchObject({type: 'transport', running: true, originFrame: 144000, originSeconds: 10});
      audio.currentTime = 4;
      await session.pause();
      expect(posted(nodes[0]).at(-1)).toMatchObject({type: 'transport', running: false, originSeconds: 11});
      session.dispose();
    });

    it('flushes on invalidation and forgets scheduled notes, but keeps live gestures', async () => {
      const {audio, session, scope, createNode, nodes} = await inSession();
      const module = createProcessorModule(scope, follower, {id: 'p', createNode});
      await session.play();
      module.notes!.accept(note('on', 'scheduled', 'audio-context-seconds'));
      module.notes!.accept(note('on', 'live', 'performance-seconds'));
      const before = posted(nodes[0]).length;
      audio.currentTime = 2.5;
      await session.seek(4);
      const since = posted(nodes[0]).slice(before);
      expect(since.filter(message => message.type === 'flush')).toHaveLength(1);
      expect(since.findIndex(message => message.type === 'flush')).toBeLessThan(since.findIndex(message => message.type === 'transport' && message.running));
      const count = posted(nodes[0]).length;
      module.notes!.accept(note('off', 'scheduled', 'audio-context-seconds', 3));
      expect(posted(nodes[0])).toHaveLength(count);
      module.notes!.accept(note('off', 'live', 'performance-seconds', 3));
      expect(posted(nodes[0]).at(-1)).toMatchObject({type: 'note', gate: 'off', occurrence: 2});
      session.dispose();
    });

    it('only sends transport anchors to a transport definition, and flushes only with note input', async () => {
      const {session, scope, createNode, nodes} = await inSession({id: 'test.keys', version: '1.0.0', noteInput: true});
      createProcessorModule(scope, {id: 'test.keys', version: '1.0.0', noteInput: true}, {id: 'k', createNode});
      await session.play();
      await session.seek(2);
      expect(posted(nodes[0]).map(message => message.type)).not.toContain('transport');
      expect(posted(nodes[0]).map(message => message.type)).toContain('flush');
      session.dispose();
    });

    it('ignores the Session with session: none and when nothing needs it', async () => {
      const {session, scope, createNode, nodes} = await inSession();
      createProcessorModule(scope, follower, {id: 'p', createNode, session: 'none'});
      await session.play();
      await session.seek(2);
      expect(nodes[0].posted).toEqual([]);
      session.dispose();
    });

    it('stops following the Session when disposed', async () => {
      const {session, scope, createNode, nodes} = await inSession();
      const module = createProcessorModule(scope, follower, {id: 'p', createNode});
      module.dispose();
      const count = nodes[0].posted.length;
      await session.play();
      await session.seek(5);
      expect(nodes[0].posted).toHaveLength(count);
      session.dispose();
    });

    it('creates a transport processor without a Session; it simply reads stopped', async () => {
      const {context, createNode, nodes} = await setup(follower);
      const module = createProcessorModule(context, follower, {id: 'p', createNode});
      expect(module.state).toBe('ready');
      expect(nodes[0].posted).toEqual([]);
    });
  });
});
