import {describe, expect, it} from 'vitest';

describe('Score View Element entry outside a browser', () => {
  it('imports the View Element entry and registers without DOM globals or a document element', async () => {
    expect(typeof HTMLElement).toBe('undefined');
    const elements = await import('../../src/view/element');
    expect(() => elements.defineAllViewElements()).not.toThrow();
    expect(() => elements.defineAllViewElements()).not.toThrow();
    expect(Object.keys(elements).filter((name) => /ScoreDocument/.test(name))).toEqual([]);
  });
});
