// The WebAssembly reference processor's DSP. The kit hands `create` the module
// compiled during preparation; the processor instantiates it with its own
// memory and calls into it once per channel per block.
import type {ProcessorImplementation, ProcessorRing} from '@webmusic/kernel/processor-worklet';

/** Float index of the gain factor in the instance's memory (byte 512). */
const FACTOR = 128;

export interface WasmGainState {
  /** The instance's memory as floats: 0–127 hold the block, 128 the gain factor. */
  readonly memory: Float32Array;
  /** Integer arguments only: floats cross the boundary in memory (see wasm-gain.ts). */
  readonly gain: (frames: number) => void;
  readonly ring: ProcessorRing | undefined;
  readonly report: (data: unknown) => void;
  readonly reportEvery: number;
  nextReport: number;
  /**
   * Running peak. A fractional number that changes every block lives in a
   * typed array: stored in an object field, it can allocate a box per write.
   */
  readonly peak: Float64Array;
}

export const wasmGainDsp: ProcessorImplementation<WasmGainState> = {
  create({wasm, ring, report, sampleRate}) {
    if (!wasm) throw new Error('The wasm-gain processor needs its WebAssembly module.');
    const instance = new WebAssembly.Instance(wasm, {});
    const memory = instance.exports.memory as WebAssembly.Memory;
    return {
      memory: new Float32Array(memory.buffer, 0, 129),
      gain: instance.exports.gain as (frames: number) => void,
      ring,
      report,
      reportEvery: Math.floor(sampleRate / 4),
      nextReport: 0,
      peak: new Float64Array(1),
    };
  },

  process(state, block) {
    const input = block.inputs[0];
    const output = block.outputs[0];
    if (!input || input.length === 0) return;
    const scratch = state.memory;
    scratch[FACTOR] = block.params.gain[0];
    const peak = state.peak;
    for (let channel = 0; channel < output.length; channel++) {
      const from = input[channel] ?? input[0];
      const to = output[channel];
      const frames = to.length;
      scratch.set(from);
      state.gain(frames);
      for (let frame = 0; frame < frames; frame++) {
        const sample = scratch[frame];
        to[frame] = sample;
        if (channel === 0 && (sample > peak[0] || -sample > peak[0])) peak[0] = sample < 0 ? -sample : sample;
      }
    }
    if (state.ring) {
      // Every output sample of the first channel, for a scope on the main thread.
      state.ring.write(output[0]);
    } else if (block.frame >= state.nextReport) {
      // Without shared memory: a bounded-rate summary over the message port.
      state.report(peak[0]);
      peak[0] = 0;
      state.nextReport = block.frame + state.reportEvery;
    }
  },
};
