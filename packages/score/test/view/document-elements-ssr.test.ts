import {describe, expect, it} from 'vitest';

describe('Score document declaration outside a browser', () => {
  it('imports the View Element entry and registers without DOM globals', async () => {
    expect(typeof HTMLElement).toBe('undefined');
    const elements = await import('../../src/view/element');
    expect(elements.ScoreDocumentElement).toBeTypeOf('function');
    expect(() => elements.defineScoreDocumentElement()).not.toThrow();
    expect(() => elements.defineAllViewElements()).not.toThrow();
  });
});
