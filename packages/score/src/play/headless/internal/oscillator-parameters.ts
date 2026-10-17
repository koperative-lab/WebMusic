import {ParamHandle, ParamSurface} from '@webmusic/kernel/module';
import type {OscillatorSynthOptions} from '../audio-contracts';
import {envelopeSettings} from './voice-envelope';

export const OSCILLATOR_PARAMETER_KEYS = [
  'gain', 'detune', 'cutoff', 'resonance', 'attackSeconds', 'decaySeconds', 'sustainLevel', 'releaseSeconds',
] as const;

export type OscillatorParameterKey = typeof OSCILLATOR_PARAMETER_KEYS[number];

/** Configuration handles can exist before any context or voice is created. */
export function createOscillatorParameters(options: OscillatorSynthOptions = {}): ParamSurface {
  envelopeSettings(options, 0.012, 0.08);
  const descriptors: Record<OscillatorParameterKey, {value: number; min: number; max: number; unit: string; label: string; step: number}> = {
    gain: {value: options.gain ?? 0.16, min: 0, max: 4, unit: 'ratio', label: 'Voice gain', step: 0.01},
    detune: {value: options.detune ?? 0, min: -12000, max: 12000, unit: 'cents', label: 'Detune', step: 1},
    cutoff: {value: options.cutoff ?? 20000, min: 0, max: 48000, unit: 'Hz', label: 'Cutoff', step: 1},
    resonance: {value: options.resonance ?? 0.7, min: 0, max: 1000, unit: 'dB', label: 'Resonance', step: 0.1},
    attackSeconds: {value: options.attackSeconds ?? 0.012, min: 0, max: 60, unit: 's', label: 'Attack (next notes)', step: 0.001},
    decaySeconds: {value: options.decaySeconds ?? 0, min: 0, max: 60, unit: 's', label: 'Decay (next notes)', step: 0.001},
    sustainLevel: {value: options.sustainLevel ?? 1, min: 0, max: 1, unit: 'ratio', label: 'Sustain (next notes)', step: 0.01},
    releaseSeconds: {value: options.releaseSeconds ?? 0.08, min: 0, max: 60, unit: 's', label: 'Release (next notes)', step: 0.001},
  };
  const displayRanges: Record<OscillatorParameterKey, {min: number; max: number}> = {
    gain: {min: 0, max: 1}, detune: {min: -1200, max: 1200},
    cutoff: {min: 20, max: 12000}, resonance: {min: 0, max: 20},
    attackSeconds: {min: 0, max: 2}, decaySeconds: {min: 0, max: 2},
    sustainLevel: {min: 0, max: 1}, releaseSeconds: {min: 0, max: 5},
  };
  return new ParamSurface(OSCILLATOR_PARAMETER_KEYS.map((id) => {
    const {value, min, max, unit, label, step} = descriptors[id];
    const range = {min: Math.min(min, value), max: Math.max(max, value)};
    const hint = displayRanges[id];
    return new ParamHandle({
      id, label, unit, range,
      displayRange: {min: Math.max(range.min, hint.min), max: Math.min(range.max, hint.max)},
      defaultValue: value, step, updateTiming: ['gain', 'detune', 'cutoff', 'resonance'].includes(id) ? 'scheduled' : 'synchronous', modulation: ['gain', 'detune', 'cutoff', 'resonance'].includes(id) ? 'audio-rate' : 'none',
    });
  }));
}
