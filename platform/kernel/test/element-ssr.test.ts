// @vitest-environment node

import {describe, expect, it} from 'vitest';
import {HTMLElementBase, WebMusicElement} from '../src/elements';

describe('element lifecycle SSR surface', () => {
  it('can be imported and subclassed without browser globals', () => {
    expect(typeof HTMLElement).toBe('undefined');
    expect(typeof HTMLElementBase).toBe('function');

    class ServerDeclaredElement extends WebMusicElement {}

    expect(typeof ServerDeclaredElement).toBe('function');
  });
});
