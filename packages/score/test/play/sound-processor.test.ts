import {describe, expect, it, vi} from 'vitest';
import {prepareProcessor, type ProcessorDefinition, type ProcessorNodeFactory} from '@webmusic/kernel/processor';
import {Sound} from '../../src/play/headless';

// Structural stand-ins: a context with a worklet loader and nodes that record
// what they are sent. Notes are synthetic test fixtures.

const synth: ProcessorDefinition = {
  id: 'test.score-poly',
  version: '1.0.0',
  noteInput: true,
  params: [
    {id: 'cutoff', unit: 'hertz', range: {min: 20, max: 20000}, defaultValue: 2000, modulation: 'control-rate'},
    {id: 'release', unit: 'seconds', range: {min: 0, max: 5}, defaultValue: 0.3},
  ],
};

class FakeParam {
  readonly automationRate: 'a-rate' | 'k-rate';
  constructor(public value: number, rate: 'a-rate' | 'k-rate') { this.automationRate = rate; }
  setValueAtTime(value: number): this { this.value = value; return this; }
}

function fakeContext() {
  let loads = 0;
  let resolveLoad: (() => void) | undefined;
  const context = {
    currentTime: 1,
    sampleRate: 48000,
    state: 'running',
    audioWorklet: {addModule: () => { loads++; return new Promise<void>(resolve => { resolveLoad = resolve; }); }},
    createGain: () => ({context, gain: {value: 1}, connect() {}, disconnect() {}}),
  };
  const destination = {context, connect() {}, disconnect() {}};
  const nodes: {posted: unknown[]; connected: unknown[]; disconnected: number; closed: number; parameters: Map<string, FakeParam>}[] = [];
  const createNode = vi.fn<ProcessorNodeFactory>((_context, _name, options) => {
    const node = {
      posted: [] as unknown[], connected: [] as unknown[], disconnected: 0, closed: 0,
      parameters: new Map((synth.params ?? []).map(param =>
        [param.id, new FakeParam(Number(options.parameterData?.[param.id] ?? 0), param.modulation === 'audio-rate' ? 'a-rate' : 'k-rate')])),
      port: {onmessage: null, postMessage: (message: unknown) => { node.posted.push(message); }, close: () => { node.closed++; }},
      onprocessorerror: null,
      connect(target: unknown) { node.connected.push(target); return target; },
      disconnect() { node.disconnected++; },
    };
    nodes.push(node);
    return node as unknown as AudioWorkletNode;
  });
  return {
    context: context as unknown as AudioContext, destination: destination as unknown as AudioNode, nodes, createNode,
    loads: () => loads, finishLoad: () => resolveLoad?.(),
  };
}

async function prepared() {
  const fake = fakeContext();
  const ready = prepareProcessor(fake.context, synth, {module: '/poly.js'});
  fake.finishLoad();
  await ready;
  return fake;
}

const notes = (posted: unknown[]) => posted
  .filter(message => (message as {type: string}).type === 'note')
  .map(message => {
    const {gate, occurrence, frame} = message as {gate: string; occurrence: number; frame: number};
    return `${gate}${occurrence}@${frame}`;
  });

describe('Sound.processor', () => {
  it('requires note input and known parameter values', () => {
    expect(() => Sound.processor({id: 'test.fx', version: '1.0.0', audioInputs: [{id: 'in', channels: 2}]})).toThrow(/no note input/);
    expect(() => Sound.processor(synth, {values: {gain: 1}})).toThrow(/no parameter gain/);
  });

  it('advertises exact scheduling and exposes the bus gain followed by the processor parameters', () => {
    const sound = Sound.processor(synth, {values: {release: 1}});
    expect(sound.params.handles.map(handle => handle.descriptor.id)).toEqual(['busGain', 'cutoff', 'release']);
    expect(sound.params.get('release')!.snapshot.baseValue).toBe(1);
  });

  it('refuses to connect when unprepared and given no source', () => {
    const {context, destination, createNode} = fakeContext();
    void context;
    const sound = Sound.processor(synth, {createNode});
    expect(() => sound.connect(destination)).toThrow(/not prepared .*prepareProcessor/);
    expect(createNode).not.toHaveBeenCalled();
  });

  it('places attacks and their scheduled ends on exact frames, returning occurrence handles', async () => {
    const {destination, nodes, createNode} = await prepared();
    const sound = Sound.processor(synth, {createNode});
    sound.connect(destination);
    expect(sound.supportsScheduledCancellation && sound.supportsScheduledDuration && sound.supportsScheduledRetiming && sound.supportsNoteOccurrences).toBe(true);
    const first = sound.noteOn(60, 127, 2, 0.5);
    const second = sound.noteOn(60, 64, 2.25, 1);
    expect([first, second]).toEqual([1, 2]);
    expect(notes(nodes[0].posted)).toEqual(['on1@96000', 'off1@120000', 'on2@108000', 'off2@156000']);
    expect((nodes[0].posted[0] as {velocity: number}).velocity).toBe(1);
    expect((nodes[0].posted[2] as {velocity: number}).velocity).toBeCloseTo(64 / 127);
  });

  it('keeps the scheduled end when the player releases at or after it, and moves it when earlier', async () => {
    const {destination, nodes, createNode} = await prepared();
    const sound = Sound.processor(synth, {createNode});
    sound.connect(destination);
    const late = sound.noteOn(62, 100, 2, 1);
    const early = sound.noteOn(64, 100, 2, 1);
    sound.noteOffById(late, 3.004);
    sound.noteOffById(early, 2.5);
    expect(notes(nodes[0].posted).slice(4)).toEqual(['off2@120000']);
  });

  it('withdraws a voice cancelled before its onset and releases one cancelled while sounding', async () => {
    const {destination, nodes, createNode} = await prepared();
    const sound = Sound.processor(synth, {createNode});
    sound.connect(destination);
    const future = sound.noteOn(60, 100, 3, 1);
    const sounding = sound.noteOn(67, 100, 1.5, 2);
    sound.cancelScheduledNote(future, 2);
    sound.cancelScheduledNote(sounding, 2);
    expect(notes(nodes[0].posted).slice(4)).toEqual(['cancel1@96000', 'off2@96000']);
  });

  it('retimes a scheduled end later or earlier until it is reached', async () => {
    const {context, destination, nodes, createNode} = await prepared();
    const sound = Sound.processor(synth, {createNode});
    sound.connect(destination);
    const handle = sound.noteOn(60, 100, 2, 1);
    sound.retimeScheduledNote(handle, 4);
    sound.retimeScheduledNote(handle, 3.5);
    (context as unknown as {currentTime: number}).currentTime = 3.6;
    sound.retimeScheduledNote(handle, 5);
    expect(notes(nodes[0].posted).slice(2)).toEqual(['off1@192000', 'off1@168000']);
  });

  it('releases every open voice of a pitch for pitch-only callers', async () => {
    const {destination, nodes, createNode} = await prepared();
    const sound = Sound.processor(synth, {createNode});
    sound.connect(destination);
    sound.noteOn(60, 100, 2, Infinity);
    sound.noteOn(60, 100, 2.1, Infinity);
    sound.noteOn(61, 100, 2.1, Infinity);
    sound.noteOff(60, 2.5);
    expect(notes(nodes[0].posted).slice(3)).toEqual(['off1@120000', 'off2@120000']);
  });

  it('drives the node parameters from the Sound surface across reconnections', async () => {
    const {context, destination, nodes, createNode} = await prepared();
    const sound = Sound.processor(synth, {createNode, values: {release: 2}});
    const disconnect = sound.connect(destination);
    expect(nodes[0].parameters.get('release')!.value).toBe(2);
    sound.params.get('release')!.setBaseValue(1);
    expect(nodes[0].parameters.get('release')!.value).toBe(1);
    disconnect();
    expect([nodes[0].disconnected, nodes[0].closed]).toEqual([1, 1]);
    expect(nodes[0].posted.at(-1)).toEqual({type: 'close'});
    sound.connect(destination);
    sound.params.get('release')!.setBaseValue(0.5);
    expect(nodes[1].parameters.get('release')!.value).toBe(0.5);
    expect(nodes[0].parameters.get('release')!.value).toBe(1);
    void context;
    sound.dispose();
  });

  it('prepares from source on connect, stays silent until ready and resolves readiness', async () => {
    const {destination, nodes, createNode, loads, finishLoad} = fakeContext();
    const sound = Sound.processor(synth, {createNode, source: {module: '/poly.js'}});
    sound.connect(destination);
    expect(loads()).toBe(1);
    const early = sound.noteOn(60, 100, 2, 1);
    expect(typeof early).toBe('number');
    sound.noteOffById(early, 2.5);
    expect(nodes).toHaveLength(0);
    finishLoad();
    await sound.ready;
    expect(nodes).toHaveLength(1);
    expect(sound.noteOn(60, 100, 3, 1)).toBe(1);
  });

  it('does not build a node when disconnected during preparation', async () => {
    const {destination, nodes, createNode, finishLoad} = fakeContext();
    const sound = Sound.processor(synth, {createNode, source: {module: '/poly.js'}});
    const disconnect = sound.connect(destination);
    const ready = sound.ready;
    disconnect();
    finishLoad();
    await ready;
    expect(nodes).toHaveLength(0);
  });
});
