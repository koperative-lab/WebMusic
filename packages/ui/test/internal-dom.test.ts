// @vitest-environment jsdom

import {describe, expect, it} from 'vitest';
import {clamp, clamp01, finite, finitePositive, setParts} from '../src/internal/dom';

describe('setParts', () => {
  it('de-duplicates across a joined canonical, which four presenters pass', () => {
    const node = document.createElement('div');

    // `'track seek'` is transport's; the caller's own `track` used to survive
    // as a second copy because a joined canonical was one opaque token.
    setParts(node, 'track seek', 'track custom-seek');
    expect(node.getAttribute('part')).toBe('track seek custom-seek');

    setParts(node, 'canvas surface', undefined);
    expect(node.getAttribute('part')).toBe('canvas surface');

    setParts(node, ['strip', 'master'], 'master legacy');
    expect(node.getAttribute('part')).toBe('strip master legacy');
  });

  it('keeps first-seen order, which is what the attribute contract promises', () => {
    const node = document.createElement('div');
    setParts(node, 'region marker', 'b', 'a');
    expect(node.getAttribute('part')).toBe('region marker b a');
  });
});

describe('numeric coercion', () => {
  it('finitePositive rejects zero and below, where finite accepts them', () => {
    expect(finite(0, 48)).toBe(0);
    expect(finitePositive(0, 48)).toBe(48);
    expect(finitePositive(-2, 48)).toBe(48);
    expect(finitePositive(Number.NaN, 48)).toBe(48);
    expect(finitePositive(Number.POSITIVE_INFINITY, 48)).toBe(48);
    expect(finitePositive(160, 48)).toBe(160);
    // Deliberately NOT a string parser: the audio-side `numericSize` helpers
    // parse `string | null`, and merging the two would change their behaviour.
    expect(finitePositive('160' as unknown, 48)).toBe(48);
  });

  it('clamp and clamp01 guard the non-finite inputs a snapshot can carry', () => {
    expect(clamp(Number.NaN, 2, 8)).toBe(2);
    expect(clamp(Number.NaN, 2, 8, 5)).toBe(5);
    expect(clamp01(Number.POSITIVE_INFINITY)).toBe(0);
    expect(clamp01(0.5)).toBe(0.5);
  });
});
