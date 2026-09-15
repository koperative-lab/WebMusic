// @vitest-environment jsdom

import {afterEach, describe, expect, it} from 'vitest';
import {boolAttr, cssSizeAttr, defineOnce, numAttr, upgradeProperties} from '../src/elements';

afterEach(() => document.body.replaceChildren());

describe('element helpers', () => {
  it('replays a pre-definition own property through the upgraded setter once', () => {
    const values: unknown[] = [];
    const value = {score: 'borrowed'};
    const element = document.createElement('kernel-property-upgrade-test') as HTMLElement & {source: unknown};
    element.source = value;
    document.body.append(element);
    class TestElement extends HTMLElement {
      set source(next: unknown) { values.push(next); }
      connectedCallback() { upgradeProperties(this, ['source']); }
    }

    defineOnce('kernel-property-upgrade-test', TestElement);
    expect(values).toEqual([value]);
    element.remove();
    document.body.append(element);
    defineOnce('kernel-property-upgrade-test', class extends HTMLElement {});
    expect(values).toEqual([value]);
    expect(customElements.get('kernel-property-upgrade-test')).toBe(TestElement);
  });

  it('keeps zero valid and prevents malformed numeric attributes entering geometry', () => {
    const element = document.createElement('div');
    expect(numAttr(element, 'amount', 12)).toBe(12);
    for (const input of ['', '  ', 'NaN', 'Infinity', '12px']) {
      element.setAttribute('amount', input);
      expect(numAttr(element, 'amount', 12)).toBe(12);
    }
    element.setAttribute('amount', '0');
    expect(numAttr(element, 'amount', 12)).toBe(0);
    element.setAttribute('amount', '-2.5');
    expect(numAttr(element, 'amount', 12, 0, 10)).toBe(0);
    element.setAttribute('amount', '50');
    expect(numAttr(element, 'amount', 12, 0, 10)).toBe(10);
  });

  it('handles explicit false spellings and preserves CSS size expressions', () => {
    const element = document.createElement('div');
    expect(boolAttr(element, 'enabled', true)).toBe(true);
    for (const input of ['FALSE', '0', ' no ', 'Off']) {
      element.setAttribute('enabled', input);
      expect(boolAttr(element, 'enabled', true)).toBe(false);
    }
    element.setAttribute('enabled', '');
    expect(boolAttr(element, 'enabled')).toBe(true);
    expect(cssSizeAttr(element, 'width')).toBeUndefined();
    element.setAttribute('width', ' 640.5 ');
    expect(cssSizeAttr(element, 'width')).toBe('640.5px');
    element.setAttribute('width', 'calc(100% - 2rem)');
    expect(cssSizeAttr(element, 'width')).toBe('calc(100% - 2rem)');
  });
});
