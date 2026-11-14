// The WebAssembly reference processor: gain computed in WebAssembly, output
// streamed into a shared ring when there is one, peak reports otherwise. The
// worklet scope is a structural fake; the input signal is a test fixture.
import v8 from 'node:v8';
import vm from 'node:vm';
import {describe, expect, it} from 'vitest';
import {PROCESSOR_PROTOCOL_VERSION, ProcessorRing, type ProcessorNodeOptions} from '@webmusic/kernel/processor';
import {defineProcessor, type ProcessorWorkletScope} from '@webmusic/kernel/processor-worklet';
import {WASM_GAIN_BYTES, wasmGain} from '../shared/processors/wasm-gain';
import {wasmGainDsp} from '../shared/processors/wasm-gain-dsp';

const SAMPLE_RATE = 48000;
const QUANTUM = 128;

interface Instance {
  process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>): boolean;
}

function realize(ring?: ProcessorRing) {
  let Processor: (new (options: {processorOptions: ProcessorNodeOptions}) => Instance) | undefined;
  const posted: unknown[] = [];
  const scope = {
    currentFrame: 0,
    sampleRate: SAMPLE_RATE,
    registerProcessor: (_name: string, processor: unknown) => { Processor = processor as typeof Processor; },
    AudioWorkletProcessor: class { readonly port = {onmessage: null, postMessage: (message: unknown) => { posted.push(message); }}; },
  };
  defineProcessor(wasmGain, wasmGainDsp, scope as unknown as ProcessorWorkletScope);
  const instance = new Processor!({processorOptions: {
    protocol: PROCESSOR_PROTOCOL_VERSION, name: 'webmusic.reference.wasm-gain@1.0.0',
    wasm: new WebAssembly.Module(WASM_GAIN_BYTES), ...(ring && {ring: ring.buffer}),
  }});
  const input = [new Float32Array(QUANTUM), new Float32Array(QUANTUM)];
  for (let frame = 0; frame < QUANTUM; frame++) { input[0][frame] = Math.sin(frame / 8) * 0.8; input[1][frame] = -input[0][frame]; }
  return {
    posted, scope, instance, input,
    inputs: [input],
    outputs: [[new Float32Array(QUANTUM), new Float32Array(QUANTUM)]],
    parameters: {gain: new Float32Array([0.5])},
  };
}

/** Render one block at `frame`; Web Audio zero-fills outputs first. */
function render(synth: ReturnType<typeof realize>, frame: number): boolean {
  synth.scope.currentFrame = frame;
  synth.outputs[0][0].fill(0);
  synth.outputs[0][1].fill(0);
  return synth.instance.process(synth.inputs, synth.outputs, synth.parameters);
}

describe('WebAssembly reference processor', () => {
  it('applies its gain in WebAssembly on every channel', () => {
    const synth = realize();
    expect(render(synth, 0)).toBe(true);
    for (let channel = 0; channel < 2; channel++) {
      for (let frame = 0; frame < QUANTUM; frame++) {
        expect(synth.outputs[0][channel][frame]).toBeCloseTo(synth.input[channel][frame] * 0.5, 6);
      }
    }
  });

  it('streams its output into the shared ring when it has one, and reports its peak when it does not', () => {
    const ring = ProcessorRing.create(16384);
    const streaming = realize(ring);
    for (let block = 0; block < 10; block++) render(streaming, block * QUANTUM);
    expect(ring.available).toBe(10 * QUANTUM);
    const head = new Float32Array(QUANTUM);
    ring.read(head);
    expect([...head]).toEqual([...streaming.outputs[0][0]]);
    expect(streaming.posted).toEqual([]);

    const reporting = realize();
    for (let block = 0; block < 400; block++) render(reporting, block * QUANTUM);
    // Four reports a second: about 1.07 s rendered.
    expect(reporting.posted).toHaveLength(5);
    expect((reporting.posted[1] as {data: number}).data).toBeCloseTo(0.4, 2);
  });

  it('allocates nothing per block with two nodes running, through the WebAssembly calls and the ring', () => {
    v8.setFlagsFromString('--expose-gc');
    const gc = vm.runInNewContext('gc') as () => void;
    const ring = ProcessorRing.create(16384);
    const reader = new Float32Array(16384);
    // Two nodes, each with its own WebAssembly instance, as a page with two inserts has.
    const first = realize(ring);
    const second = realize();
    const step = (block: number) => {
      render(first, block * QUANTUM);
      render(second, block * QUANTUM);
      if (block % 64 === 0) ring.read(reader);
    };
    for (let block = 0; block < 2000; block++) step(block);
    gc();
    const start = v8.getHeapStatistics().used_heap_size;
    for (let block = 2000; block < 42000; block++) step(block);
    // A fixed tens of kilobytes is measurement overhead; 16 bytes a block would add 640 kB.
    expect(v8.getHeapStatistics().used_heap_size - start).toBeLessThan(128 * 1024);
  }, 30_000);
});
