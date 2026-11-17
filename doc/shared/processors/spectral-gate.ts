// The spectral reference processor's definition: plain data shared by the
// main thread and the worklet file.
import type {ProcessorDefinition} from '@webmusic/kernel/processor';

/**
 * A spectral gate (public DEC-077): each 2048-sample frame, windowed with a
 * Hann window at a quarter-frame hop, keeps only the frequency bins louder
 * than the threshold. Low thresholds pass nearly everything; high ones leave
 * the strongest partials. It delays the sound by one frame.
 */
export const spectralGate: ProcessorDefinition = {
  id: 'webmusic.reference.spectral-gate',
  version: '1.0.0',
  audioInputs: [{id: 'input', channels: 2}],
  audioOutputs: [{id: 'output', channels: 2}],
  params: [{id: 'threshold', label: 'Threshold', unit: 'dB', range: {min: -90, max: 0}, defaultValue: -90, step: 1}],
};

/** Frame size and hop of the gate's analysis. */
export const SPECTRAL_GATE_SIZE = 2048;
