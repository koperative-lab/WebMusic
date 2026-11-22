// The spectral reference processor's DSP, built on the worklet kit's
// spectral frame: analysis, the caller's change, resynthesis and
// overlap-add. Everything is allocated in `create`; `process` allocates nothing.
import {createSpectralFrame, type ProcessorImplementation, type SpectralFrame} from '@webmusic/kernel/processor-worklet';
import {SPECTRAL_GATE_SIZE} from './spectral-gate';

export interface SpectralGateState {
  readonly frames: SpectralFrame[];
  readonly gates: ((real: Float32Array, imag: Float32Array) => void)[];
  /** The threshold as a squared bin magnitude, in a typed array so writes never box. */
  readonly limit: Float64Array;
}

export const spectralGateDsp: ProcessorImplementation<SpectralGateState> = {
  create() {
    const limit = new Float64Array(1);
    // A full-scale sine's bin is size / 4 high under a Hann window.
    const scale = SPECTRAL_GATE_SIZE / 4;
    const gate = (real: Float32Array, imag: Float32Array) => {
      const floor = limit[0]! * scale * scale;
      for (let bin = 0; bin < real.length; bin++) {
        if (real[bin]! * real[bin]! + imag[bin]! * imag[bin]! < floor) { real[bin] = 0; imag[bin] = 0; }
      }
    };
    return {
      frames: [createSpectralFrame({size: SPECTRAL_GATE_SIZE}), createSpectralFrame({size: SPECTRAL_GATE_SIZE})],
      gates: [gate, gate],
      limit,
    };
  },

  process(state, block) {
    const input = block.inputs[0];
    const output = block.outputs[0];
    if (!output) return;
    const decibels = block.params.threshold![0]!;
    state.limit[0] = decibels <= -90 ? 0 : 10 ** (decibels / 10);
    for (let channel = 0; channel < output.length && channel < state.frames.length; channel++) {
      const from = input?.[channel] ?? input?.[0];
      if (!from) continue;
      state.frames[channel]!.process(from, output[channel]!, state.gates[channel]!);
    }
  },
};
