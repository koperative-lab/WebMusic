import {afterEach, describe, expect, it, vi} from 'vitest';
import {ModuleAudioEnvironment, ModuleContext} from '../src/module';
import {
  createProcessorInstrument, createProcessorModule, prepareProcessor, processorCapabilities, processorEffect,
  ProcessorRing, ProcessorUnavailableError, type ProcessorDefinition, type ProcessorNodeFactory, type ProcessorNodeOptions,
} from '../src/processor';
import {defineProcessor, type ProcessorSetup, type ProcessorWorkletScope} from '../src/processor-worklet';
import {FakeContext, FakeWorkletNode} from './processor-fakes';

// A 102-byte module exporting `memory` and `gain(n: i32)`, which multiplies
// the first n float32 values in memory by the float32 at byte 512. Test fixture only.
const GAIN_WASM = new Uint8Array([
  0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 1, 127, 0, 3, 2, 1, 0, 5, 3, 1, 0, 1, 7, 17, 2, 6, 109, 101, 109, 111,
  114, 121, 2, 0, 4, 103, 97, 105, 110, 0, 0, 10, 57, 1, 55, 2, 1, 127, 1, 125, 65, 128, 4, 42, 2, 0, 33, 2, 2, 64, 3, 64,
  32, 1, 32, 0, 79, 13, 1, 32, 1, 65, 2, 116, 32, 1, 65, 2, 116, 42, 2, 0, 32, 2, 148, 56, 2, 0, 32, 1, 65, 1, 106, 33,
  1, 12, 0, 11, 11, 11,
]);

afterEach(() => vi.unstubAllGlobals());

function nodes(definition: ProcessorDefinition) {
  const created: FakeWorkletNode[] = [];
  const createNode = vi.fn<ProcessorNodeFactory>((received, name, options) => {
    const node = new FakeWorkletNode(received as unknown as FakeContext, name, options, []);
    created.push(node);
    return node as unknown as AudioWorkletNode;
  });
  void definition;
  return {created, createNode};
}
const optionsOf = (node: FakeWorkletNode) => node.options.processorOptions as ProcessorNodeOptions;

describe('ProcessorRing', () => {
  it('passes samples in order across the wrap and keeps one slot empty', () => {
    const ring = ProcessorRing.create(8);
    const out = new Float32Array(8);
    expect(ring.write([1, 2, 3, 4, 5])).toBe(5);
    expect(ring.read(out.subarray(0, 3))).toBe(3);
    expect(ring.write([6, 7, 8, 9, 10, 11])).toBe(5); // capacity 8 holds 7
    expect(ring.available).toBe(7);
    expect(ring.read(out)).toBe(7);
    expect([...out.subarray(0, 7)]).toEqual([4, 5, 6, 7, 8, 9, 10]);
    expect(ring.dropped).toBe(1);
    expect(ring.available).toBe(0);
  });

  it('shares state with a ring attached to the same buffer, as the other thread does', () => {
    const writer = ProcessorRing.create(256);
    const reader = new ProcessorRing(writer.buffer);
    writer.write(new Float32Array([0.5, -0.5]), 0, 2);
    const out = new Float32Array(4);
    expect(reader.read(out)).toBe(2);
    expect([...out.subarray(0, 2)]).toEqual([0.5, -0.5]);
    expect(writer.available).toBe(0);
  });

  it('rejects a buffer that is not a ring and a capacity below 2', () => {
    expect(() => new ProcessorRing(new SharedArrayBuffer(10))).toThrow(TypeError);
    expect(() => ProcessorRing.create(1)).toThrow(RangeError);
  });
});

describe('processorCapabilities', () => {
  it('reports shared memory only on a cross-origin isolated page', () => {
    expect(processorCapabilities().sharedMemory).toBe(false);
    vi.stubGlobal('crossOriginIsolated', true);
    expect(processorCapabilities().sharedMemory).toBe(true);
    expect(processorCapabilities().wasm).toBe(true);
    expect(processorCapabilities().audioWorklet).toBe(false);
  });
});

describe('WebAssembly preparation', () => {
  const wasmVoice: ProcessorDefinition = {id: 'test.wasm-gain', version: '1.0.0', audioInputs: [{id: 'input', channels: 1}], wasm: true};

  it('compiles bytes once per context and hands the module to every node', async () => {
    const audio = new FakeContext();
    const context = audio as unknown as BaseAudioContext;
    await prepareProcessor(context, wasmVoice, {module: '/gain.js', wasm: GAIN_WASM});
    const scope = new ModuleContext({id: 'root', audio: new ModuleAudioEnvironment({context})});
    const {created, createNode} = nodes(wasmVoice);
    createProcessorModule(scope, wasmVoice, {id: 'a', createNode, route: 'none'});
    createProcessorModule(scope, wasmVoice, {id: 'b', createNode, route: 'none'});
    const [first, second] = created.map(node => optionsOf(node).wasm);
    expect(first).toBeInstanceOf(WebAssembly.Module);
    expect(second).toBe(first);
    expect(WebAssembly.Module.exports(first!).map(entry => entry.name)).toEqual(['memory', 'gain']);
  });

  it('fetches a URL and accepts an already compiled module', async () => {
    const fetched = vi.fn(async () => new Response(GAIN_WASM));
    vi.stubGlobal('fetch', fetched);
    const audio = new FakeContext() as unknown as BaseAudioContext;
    await prepareProcessor(audio, wasmVoice, {module: '/gain.js', wasm: '/gain.wasm'});
    expect(fetched).toHaveBeenCalledWith('/gain.wasm');
    const compiled = new WebAssembly.Module(GAIN_WASM);
    const other = new FakeContext() as unknown as BaseAudioContext;
    await prepareProcessor(other, wasmVoice, {module: '/gain.js', wasm: compiled});
    const instrumentVoice: ProcessorDefinition = {...wasmVoice, audioInputs: [], noteInput: true, version: '1.0.1'};
    await prepareProcessor(other, instrumentVoice, {module: '/gain.js', wasm: compiled});
    const {created, createNode} = nodes(instrumentVoice);
    createProcessorInstrument(other, instrumentVoice, {createNode});
    // An already compiled module is passed through, not recompiled.
    expect(optionsOf(created[0]).wasm).toBe(compiled);
  });

  it('requires wasm in the source when the definition declares it, and rejects a broken binary before registering', async () => {
    const audio = new FakeContext();
    const addModule = vi.spyOn(audio.audioWorklet, 'addModule');
    const context = audio as unknown as BaseAudioContext;
    await expect(prepareProcessor(context, wasmVoice, {module: '/gain.js'})).rejects.toThrow(/source needs wasm/);
    await expect(prepareProcessor(context, wasmVoice, {module: '/gain.js', wasm: new Uint8Array([0, 1, 2])})).rejects.toThrow();
    expect(addModule).not.toHaveBeenCalled();
    const fetched = vi.fn(async () => new Response('missing', {status: 404}));
    vi.stubGlobal('fetch', fetched);
    await expect(prepareProcessor(context, wasmVoice, {module: '/gain.js', wasm: '/missing.wasm'})).rejects.toThrow(/404/);
    // Each failure is forgotten, so a corrected retry succeeds.
    await prepareProcessor(context, wasmVoice, {module: '/gain.js', wasm: GAIN_WASM});
  });

  it('hands the kit the module, which the processor instantiates with its own memory', () => {
    let setup: ProcessorSetup | undefined;
    let Processor: (new (options: {processorOptions: ProcessorNodeOptions}) => unknown) | undefined;
    const scope = {
      currentFrame: 0, sampleRate: 48000,
      registerProcessor: (_name: string, processor: unknown) => { Processor = processor as typeof Processor; },
      AudioWorkletProcessor: class { readonly port = {onmessage: null, postMessage() {}}; },
    };
    defineProcessor(wasmVoice, {create(received) { setup = received; return null; }, process() {}}, scope as unknown as ProcessorWorkletScope);
    const compiled = new WebAssembly.Module(GAIN_WASM);
    new Processor!({processorOptions: {protocol: 1, name: 'test.wasm-gain@1.0.0', wasm: compiled}});
    expect(setup!.wasm).toBe(compiled);
    const instance = new WebAssembly.Instance(setup!.wasm!, {});
    const memory = new Float32Array((instance.exports.memory as WebAssembly.Memory).buffer, 0, 129);
    memory.set([1, 2, 4]);
    memory[128] = 0.25;
    (instance.exports.gain as (n: number) => void)(3);
    expect([...memory.subarray(0, 3)]).toEqual([0.25, 0.5, 1]);
    expect(setup!.ring).toBeUndefined();
  });
});

describe('shared ring', () => {
  const scope: ProcessorDefinition = {id: 'test.scope', version: '1.0.0', audioInputs: [{id: 'input', channels: 1}], sharedRing: {capacity: 1024}};
  const strict: ProcessorDefinition = {...scope, id: 'test.strict-scope', sharedRing: {capacity: 1024, required: true}};

  async function setup(isolated: boolean) {
    if (isolated) vi.stubGlobal('crossOriginIsolated', true);
    const audio = new FakeContext();
    const context = audio as unknown as BaseAudioContext;
    await prepareProcessor(context, scope, {module: '/scope.js'});
    return {context, modules: new ModuleContext({id: 'root', audio: new ModuleAudioEnvironment({context})})};
  }

  it('gives each module its own ring on an isolated page and reads what the processor writes', async () => {
    const {modules} = await setup(true);
    const {created, createNode} = nodes(scope);
    const first = createProcessorModule(modules, scope, {id: 'a', createNode, route: 'none'});
    const second = createProcessorModule(modules, scope, {id: 'b', createNode, route: 'none'});
    expect(first.ring?.capacity).toBe(1024);
    expect(second.ring).not.toBe(first.ring);
    const writer = new ProcessorRing(optionsOf(created[0]).ring!);
    writer.write([0.1, 0.2, 0.3]);
    const out = new Float32Array(8);
    expect(first.ring!.read(out)).toBe(3);
    expect(second.ring!.available).toBe(0);
  });

  it('runs without a ring where memory cannot be shared, and an insert never gets one', async () => {
    const plain = await setup(false);
    const {created, createNode} = nodes(scope);
    expect(createProcessorModule(plain.modules, scope, {id: 'a', createNode, route: 'none'}).ring).toBeUndefined();
    expect(optionsOf(created[0]).ring).toBeUndefined();
    vi.stubGlobal('crossOriginIsolated', true);
    processorEffect(scope, {createNode}).createAudioNodes(plain.context);
    expect(optionsOf(created[1]).ring).toBeUndefined();
  });

  it('refuses to prepare a processor that requires the ring on a page without isolation', async () => {
    const audio = new FakeContext();
    const addModule = vi.spyOn(audio.audioWorklet, 'addModule');
    const failure = prepareProcessor(audio as unknown as BaseAudioContext, strict, {module: '/scope.js'});
    await expect(failure).rejects.toBeInstanceOf(ProcessorUnavailableError);
    await expect(failure).rejects.toThrow(/cross-origin isolated/);
    expect(addModule).not.toHaveBeenCalled();
    vi.stubGlobal('crossOriginIsolated', true);
    await prepareProcessor(audio as unknown as BaseAudioContext, strict, {module: '/scope.js'});
  });

  it('hands the kit a writer over the node ring', () => {
    let setupSeen: ProcessorSetup | undefined;
    let Processor: (new (options: {processorOptions: ProcessorNodeOptions}) => unknown) | undefined;
    const worklet = {
      currentFrame: 0, sampleRate: 48000,
      registerProcessor: (_name: string, processor: unknown) => { Processor = processor as typeof Processor; },
      AudioWorkletProcessor: class { readonly port = {onmessage: null, postMessage() {}}; },
    };
    defineProcessor(scope, {create(received) { setupSeen = received; return null; }, process() {}}, worklet as unknown as ProcessorWorkletScope);
    const reader = ProcessorRing.create(1024);
    new Processor!({processorOptions: {protocol: 1, name: 'test.scope@1.0.0', ring: reader.buffer}});
    setupSeen!.ring!.write([1, 2]);
    expect(reader.available).toBe(2);
  });
});
