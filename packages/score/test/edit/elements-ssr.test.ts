import {describe, expect, it} from 'vitest';

describe('Score Edit Element entries outside a browser', () => {
  it('imports declaration and registration entries without DOM globals', async () => {
    expect(typeof HTMLElement).toBe('undefined');
    const elements = await import('../../src/edit/element');
    expect(elements.ScoreDocumentElement).toBeTypeOf('function');
    expect(() => elements.defineAllElements()).not.toThrow();
    const auto = await import('../../src/edit/element/auto');
    expect(auto.ScoreDocumentElement).toBe(elements.ScoreDocumentElement);
  });
});
