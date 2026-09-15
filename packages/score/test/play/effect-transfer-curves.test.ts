import {describe, expect, it} from 'vitest';
import {Effect} from '../../src/play/headless';

/** Web Audio 1.0 WaveShaper curve interpolation, independent of the recipe. */
function transfer(curve: Float32Array, input: number): number {
  const position = (curve.length - 1) * (input + 1) / 2;
  const low = Math.max(0, Math.min(curve.length - 1, Math.floor(position)));
  const high = Math.min(curve.length - 1, low + 1);
  return curve[low] + (curve[high] - curve[low]) * (position - low);
}

describe('effect transfer functions on the Web Audio input axis', () => {
  it.each([
    ['distortion', () => Effect.distortion({amount: 0.4})],
    ['bitcrusher', () => Effect.bitcrusher({bits: 6})],
    ['16-bit bitcrusher', () => Effect.bitcrusher({bits: 16})],
  ] as const)('%s preserves silence and symmetric positive/negative input', (_name, recipe) => {
    const node = {curve: null as Float32Array | null};
    const context = {createWaveShaper: () => node} as unknown as AudioContext;
    recipe().build(context);
    expect(node.curve).not.toBeNull();
    expect(transfer(node.curve!, 0)).toBeCloseTo(0, 8);
    for (const amplitude of [0.01, 0.1, 0.37, 0.8, 1]) {
      expect(transfer(node.curve!, amplitude)).toBeCloseTo(-transfer(node.curve!, -amplitude), 7);
    }
  });
});
