import type {Effect as KernelEffect} from '@webmusic/kernel/effect';

/** Suggested control sweeps; these are not the AudioParam's legal limits. */
export const PARAM_RANGE: Readonly<Record<string, [number, number, number]>> = {
  frequency: [20, 12_000, 1],
  Q: [0.1, 20, 0.1],
  gain: [0, 1, 0.01],
  pan: [-1, 1, 0.01],
  wet: [0, 1, 0.01],
  dry: [0, 1, 0.01],
  time: [0, 1, 0.01],
  feedback: [0, 0.95, 0.01],
  rate: [0.1, 12, 0.1],
  depth: [0, 1, 0.01],
  threshold: [-60, 0, 1],
  ratio: [1, 20, 0.5],
};

export const PARAM_UNIT: Readonly<Record<string, string>> = {
  frequency: 'Hz', rate: 'Hz', threshold: 'dB', time: 's', pan: 'pan',
  Q: 'ratio', ratio: 'ratio', gain: 'linear-gain', wet: 'linear-gain',
  dry: 'linear-gain', feedback: 'linear-gain', depth: 'linear-gain',
};

export function effectParameters(
  names: readonly string[],
  overrides: KernelEffect['parameterDescriptors'] = {},
): NonNullable<KernelEffect['parameterDescriptors']> {
  return Object.fromEntries(names.map(name => {
    const [min, max, step] = PARAM_RANGE[name];
    return [name, {unit: PARAM_UNIT[name], displayRange: {min, max}, step, ...overrides[name]}];
  }));
}
