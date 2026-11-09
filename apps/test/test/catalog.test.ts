import {describe, expect, it} from 'vitest';
import {CHECKS, GROUPS} from '../src/checks';

// CJK punctuation, ideographs and full-width forms, written as escapes.
const CJK = new RegExp('[\\u3000-\\u9fff\\uff00-\\uffef]');

describe('check catalog', () => {
  it('has unique IDs in known groups, each with steps, expectations and a live canvas', () => {
    const ids = CHECKS.map((check) => check.id);
    expect(new Set(ids).size).toBe(ids.length);
    const groups = new Set(GROUPS.map((group) => group.id));
    for (const check of CHECKS) {
      expect(check.id, check.id).toMatch(/^[A-Z][0-9]+$/);
      expect(groups.has(check.group), check.id).toBe(true);
      expect(check.steps.length, check.id).toBeGreaterThan(0);
      expect(check.expected.length, check.id).toBeGreaterThan(0);
      expect(typeof check.mount, check.id).toBe('function');
    }
  });

  it('is written in English only', () => {
    for (const check of CHECKS) {
      for (const text of [check.title, ...check.steps, ...check.expected]) {
        expect(text.trim(), check.id).not.toBe('');
        expect(text, check.id).not.toMatch(CJK);
      }
    }
  });

  it('resolves every live canvas from the packages’ own modules', async () => {
    const mounts = await Promise.all(CHECKS.map((check) => check.mount()));
    for (const [index, mount] of mounts.entries()) expect(typeof mount, CHECKS[index]!.id).toBe('function');
  });
});
