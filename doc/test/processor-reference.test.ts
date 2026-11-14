// DSP-A10: the authoring kit and the reference polyphonic processor render
// many blocks without heap growth, and the reference behaves as documented.
// The worklet scope is a structural fake; note fixtures here are synthetic
// test data, never a demo.
import v8 from 'node:v8';
import vm from 'node:vm';
import {describe, expect, it} from 'vitest';
import {PROCESSOR_PROTOCOL_VERSION, type ProcessorNodeOptions} from '@webmusic/kernel/processor';
import {defineProcessor, type ProcessorWorkletScope} from '@webmusic/kernel/processor-worklet';
import {POLY_SYNTH_VOICES, polySynth} from '../shared/processors/poly-synth';
import {polySynthDsp} from '../shared/processors/poly-synth-dsp';

const SAMPLE_RATE = 48000;
const QUANTUM = 128;

interface Instance {
  readonly port: {onmessage: ((event: {data: unknown}) => void) | null};
  process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>): boolean;
}

function realize(overrides: Partial<Record<string, number>> = {}) {
  let Processor: (new (options: {processorOptions: ProcessorNodeOptions}) => Instance) | undefined;
  const posted: unknown[] = [];
  const scope = {
    currentFrame: 0,
    sampleRate: SAMPLE_RATE,
    registerProcessor: (_name: string, processor: unknown) => { Processor = processor as typeof Processor; },
    AudioWorkletProcessor: class { readonly port = {onmessage: null, postMessage: (message: unknown) => { posted.push(message); }}; },
  };
  defineProcessor(polySynth, polySynthDsp, scope as unknown as ProcessorWorkletScope);
  const instance = new Processor!({processorOptions: {protocol: PROCESSOR_PROTOCOL_VERSION, name: 'webmusic.reference.poly-synth@1.0.0'}});
  // Web Audio hands k-rate parameters one value per block; reuse the arrays like it does.
  const parameters = Object.fromEntries((polySynth.params ?? []).map(param =>
    [param.id, new Float32Array([overrides[param.id] ?? param.defaultValue])]));
  const outputs = [[new Float32Array(QUANTUM), new Float32Array(QUANTUM)]];
  const inputs: Float32Array[][] = [];
  let next = 1;
  const post = (gate: 'on' | 'off' | 'cancel', occurrence: number, frame: number, midi = 60, velocity = 0.8) =>
    instance.port.onmessage!({data: {type: 'note', gate, occurrence, midi, cents: 0, velocity, frame, epoch: 0}});
  return {
    posted,
    outputs,
    start(frame: number, midi = 60, velocity = 0.8): number { const occurrence = next++; post('on', occurrence, frame, midi, velocity); return occurrence; },
    release: (occurrence: number, frame: number) => post('off', occurrence, frame),
    cancel: (occurrence: number, frame: number) => post('cancel', occurrence, frame),
    /** Render one block at `frame`; Web Audio zero-fills outputs first. */
    render(frame: number): boolean {
      scope.currentFrame = frame;
      outputs[0][0].fill(0);
      outputs[0][1].fill(0);
      return instance.process(inputs, outputs, parameters);
    },
  };
}

/** Render `blocks` from `from`, returning the peak absolute sample of each block. */
function peaks(synth: ReturnType<typeof realize>, from: number, blocks: number): number[] {
  const result: number[] = [];
  for (let block = 0; block < blocks; block++) {
    synth.render(from + block * QUANTUM);
    let peak = 0;
    for (const sample of synth.outputs[0][0]) peak = Math.max(peak, Math.abs(sample));
    result.push(peak);
  }
  return result;
}

function collector(): () => void {
  v8.setFlagsFromString('--expose-gc');
  return vm.runInNewContext('gc') as () => void;
}

describe('reference poly synth (DSP-A10)', () => {
  it('renders 10 minutes of dense polyphony without heap growth', () => {
    const gc = collector();
    const synth = realize();
    const blocks = Math.ceil((600 * SAMPLE_RATE) / QUANTUM);
    // Note changes allocate on arrival by design; post them all before measuring
    // so the measured span is process() alone: a chord of 6 every 250 ms, each
    // held 400 ms, so up to 12 voices sound and the queue drains as it plays.
    const period = SAMPLE_RATE / 4;
    for (let onset = 0; onset < blocks * QUANTUM; onset += period) {
      for (let voice = 0; voice < 6; voice++) {
        const occurrence = synth.start(onset + voice, 48 + ((onset / period + voice * 7) % 36));
        synth.release(occurrence, onset + 0.4 * SAMPLE_RATE);
      }
    }
    const warmup = 2000;
    for (let block = 0; block < warmup; block++) synth.render(block * QUANTUM);
    gc();
    const before = process.memoryUsage().heapUsed;
    let sounding = 0;
    for (let block = warmup; block < blocks; block++) {
      synth.render(block * QUANTUM);
      if (synth.outputs[0][0][0] !== 0) sounding++;
    }
    gc();
    const growth = process.memoryUsage().heapUsed - before;
    // The note queue only shrinks while it drains; anything else would show here.
    expect(growth).toBeLessThan(64 * 1024);
    expect(sounding).toBeGreaterThan((blocks - warmup) * 0.9);
    expect(synth.posted.filter(message => (message as {type: string}).type !== 'late')).toEqual([]);

    // Churn: with no collection in between, heap use rises if a block
    // allocates anything, even garbage. A fixed ~30–50 kB is measurement
    // overhead, the same for 1,000 or 40,000 blocks; 40,000 blocks allocating
    // 16 bytes each would add 640 kB.
    const churn = (from: number, count: number): number => {
      gc();
      const start = v8.getHeapStatistics().used_heap_size;
      for (let block = 0; block < count; block++) synth.render((from + block) * QUANTUM);
      return v8.getHeapStatistics().used_heap_size - start;
    };
    churn(blocks, 1000);
    expect(churn(blocks + 1000, 40000)).toBeLessThan(128 * 1024);
  }, 30_000);

  it('starts a note on its exact frame and leaves the frames before it silent', () => {
    const synth = realize({attack: 0.001});
    synth.start(128 + 77);
    synth.render(0);
    synth.render(128);
    const left = synth.outputs[0][0];
    expect([...left.subarray(0, 77)].every(sample => sample === 0)).toBe(true);
    expect([...left.subarray(78)].some(sample => sample !== 0)).toBe(true);
    // Mono voice on both channels.
    expect([...synth.outputs[0][1]]).toEqual([...left]);
  });

  it('releases to silence within the release time and then frees the voice', () => {
    const synth = realize({release: 0.05});
    const occurrence = synth.start(0);
    synth.release(occurrence, 4800);
    const levels = peaks(synth, 0, 120);
    const releaseBlock = Math.floor(4800 / QUANTUM);
    expect(levels[releaseBlock - 1]).toBeGreaterThan(0.01);
    // −60 dB in 50 ms, then idle: nothing at all is rendered.
    expect(levels[releaseBlock + Math.ceil(0.06 * SAMPLE_RATE / QUANTUM)]).toBeLessThan(1e-3);
    expect(levels.at(-1)).toBe(0);
  });

  it('withdraws a note cancelled before its onset, and fades a sounding one within 3 ms', () => {
    const silent = realize();
    const never = silent.start(1000);
    silent.cancel(never, 500);
    expect(peaks(silent, 0, 40).every(level => level === 0)).toBe(true);

    const sounding = realize();
    const note = sounding.start(0);
    peaks(sounding, 0, 20);
    sounding.cancel(note, 20 * QUANTUM);
    const after = peaks(sounding, 20 * QUANTUM, 3);
    expect(after[0]).toBeGreaterThan(0);
    expect(after[2]).toBe(0);
  });

  it('keeps same-pitch occurrences independent', () => {
    const synth = realize({release: 0.01});
    const first = synth.start(0, 64);
    synth.start(64, 64);
    synth.release(first, 1280);
    // The second C keeps sounding after the first is released and gone.
    expect(peaks(synth, 0, 60).slice(-10).every(level => level > 0.01)).toBe(true);
  });

  it(`steals a voice beyond ${POLY_SYNTH_VOICES} notes without failing`, () => {
    const synth = realize();
    for (let index = 0; index <= POLY_SYNTH_VOICES; index++) synth.start(index * 10, 40 + index);
    expect(peaks(synth, 0, 20).every(level => Number.isFinite(level) && level < 4)).toBe(true);
    expect(synth.posted).toEqual([]);
  });
});
