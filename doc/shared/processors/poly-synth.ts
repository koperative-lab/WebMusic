// The reference polyphonic processor's definition: plain data shared by the
// main thread (prepareProcessor, Sound.processor, createProcessorModule) and
// the worklet file. Copy this file and poly-synth-dsp.ts to start your own.
import type {ProcessorDefinition} from '@webmusic/kernel/processor';

/** Voices the reference synth allocates; a 33rd note steals the quietest releasing voice, else the oldest. */
export const POLY_SYNTH_VOICES = 32;

/**
 * A subtractive voice per note: a band-limited sawtooth through a resonant
 * lowpass, shaped by an ADSR envelope. Cutoff follows modulation once per
 * block; the envelope settings apply to notes from the next block on.
 */
export const polySynth: ProcessorDefinition = {
  id: 'webmusic.reference.poly-synth',
  version: '1.0.0',
  noteInput: true,
  audioOutputs: [{id: 'output', channels: 2}],
  tailSeconds: 5,
  params: [
    {id: 'level', label: 'Level', unit: 'ratio', range: {min: 0, max: 1}, defaultValue: 0.2, step: 0.01},
    {id: 'cutoff', label: 'Cutoff', unit: 'hertz', range: {min: 40, max: 18000}, defaultValue: 2400, scale: 'logarithmic', modulation: 'control-rate'},
    {id: 'resonance', label: 'Resonance', unit: 'ratio', range: {min: 0, max: 0.95}, defaultValue: 0.2, step: 0.01},
    {id: 'attack', label: 'Attack', unit: 'seconds', range: {min: 0.001, max: 2}, defaultValue: 0.005, scale: 'logarithmic'},
    {id: 'decay', label: 'Decay', unit: 'seconds', range: {min: 0.005, max: 4}, defaultValue: 0.4, scale: 'logarithmic'},
    {id: 'sustain', label: 'Sustain', unit: 'ratio', range: {min: 0, max: 1}, defaultValue: 0.5, step: 0.01},
    {id: 'release', label: 'Release', unit: 'seconds', range: {min: 0.005, max: 5}, defaultValue: 0.3, scale: 'logarithmic'},
  ],
};
