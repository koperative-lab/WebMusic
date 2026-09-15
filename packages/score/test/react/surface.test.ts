import {describe, expect, it} from 'vitest';
import {componentSurfaceStyle} from '../../src/react/surface';

describe('React component surfaces', () => {
  it('uses the shared white, gray and evenly padded component contract', () => {
    expect(componentSurfaceStyle('transport')).toMatchObject({
      boxSizing: 'border-box',
      padding:
        'var(--wm-transport-surface-padding, var(--wm-component-padding, .6rem))',
      border:
        'var(--wm-transport-surface-border, var(--wm-component-border, 1px solid var(--wm-border, #d8d8d8)))',
      borderRadius:
        'var(--wm-transport-surface-radius, var(--wm-component-radius, var(--wm-control-radius, 0)))',
      background:
        'var(--wm-transport-surface-background, var(--wm-component-background, var(--wm-surface, #fff)))',
    });
  });
});
