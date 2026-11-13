import {readFileSync} from 'node:fs';
import {describe, expect, it} from 'vitest';

// The site stylesheet must never outrank a component's own zero-specificity
// rules inside a demo: a bare `button { color: inherit }` once painted pressed
// toolbar icons in the same ink as their fill.
const css = readFileSync(new URL('../src/styles/site.css', import.meta.url), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');
const topLevel = (selector: string): string[] => {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < selector.length; index++) {
    const char = selector[index];
    if (char === '(') depth++;
    else if (char === ')') depth--;
    else if (char === ',' && depth === 0) {
      parts.push(selector.slice(start, index).trim());
      start = index + 1;
    }
  }
  return [...parts, selector.slice(start).trim()];
};
const ELEMENT = /^(?:a|button|input|select|textarea|img|svg|video|canvas|table|th|td|p|ul|ol|li|code|pre|h[1-6])$/;

describe('site stylesheet resets', () => {
  it('has no bare element selector at the top level', () => {
    const selectors = [...css.matchAll(/(?:^|})\s*([^{}@]+?)\s*\{/g)]
      .flatMap((match) => topLevel(match[1]));
    expect(selectors.filter((selector) => ELEMENT.test(selector))).toEqual([]);
  });

  it('keeps element resets at zero specificity and outside demos', () => {
    for (const reset of [':where(button)', ':where(img, svg, video, canvas)']) {
      const rule = css.split('\n').find((line) => line.startsWith(reset));
      expect(rule, reset).toBeDefined();
      expect(rule, reset).toContain(':where(:not(.not-content *))');
    }
  });
});
