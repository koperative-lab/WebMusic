import {describe, expect, it} from 'vitest';
import {UI_COMPOSITION_CATALOG} from '../../doc/shared/ui-catalog.ts';
import {LIBRARY, byTag} from '../src/catalog.ts';
import {ELEMENT_ENTRIES, resolveDefines} from '../src/elements.ts';
import {CATEGORIES, RECIPES} from '../src/recipes.ts';
import {plainText, summaryFromPage} from '../summaries.ts';

describe('library catalog', () => {
  it('lists every public element exactly once, and only those', () => {
    const tags = LIBRARY.map((entry) => entry.tag);
    expect(new Set(tags).size).toBe(tags.length);
    expect([...tags].sort()).toEqual(UI_COMPOSITION_CATALOG.map((entry) => entry.tag).sort());
    expect(RECIPES.map((recipe) => recipe.tag).sort()).toEqual([...tags].sort());
  });

  it('puts every element in a known functional category, in category order', () => {
    const order = CATEGORIES.map((category) => category.id);
    const seen = LIBRARY.map((entry) => order.indexOf(entry.category.id));
    expect(seen.every((index) => index >= 0)).toBe(true);
    expect(seen).toEqual([...seen].sort((a, b) => a - b));
    for (const category of CATEGORIES) expect(LIBRARY.some((entry) => entry.category.id === category.id), category.id).toBe(true);
  });

  it('carries a documentation summary, entry and reference route for each element', () => {
    for (const entry of LIBRARY) {
      expect(entry.summary.length, entry.tag).toBeGreaterThan(20);
      expect(entry.summary, entry.tag).not.toMatch(/[`*[\]]/);
      expect(entry.entry, entry.tag).toMatch(/^@webmusic\/(score|audio)\/(play|view|analyze)\/element$/);
      expect(entry.href, entry.tag).toMatch(/^\/(score|audio)\/element\//);
    }
    expect(byTag('score-player')?.family).toBe('Score');
    expect(byTag('nope')).toBeUndefined();
  });

  it('resolves every recipe’s define function from the packages’ own element entries', async () => {
    const imports = new Map<string, string[]>();
    for (const entry of LIBRARY) imports.set(entry.entry, [...(imports.get(entry.entry) ?? []), entry.recipe.define]);
    for (const entry of imports.keys()) expect(ELEMENT_ENTRIES[entry], entry).toBeTypeOf('function');
    const defines = await resolveDefines(imports);
    expect(defines).toHaveLength(LIBRARY.length);
  });

  it('only writes attributes the element observes', () => {
    for (const entry of LIBRARY) {
      const observed = new Set(entry.spec.params.map((param) => param.name));
      for (const name of Object.keys(entry.recipe.attributes ?? {})) {
        if (name === 'id') continue;
        expect(observed.has(name), `${entry.tag} ${name}`).toBe(true);
      }
    }
  });
});

describe('documentation summaries', () => {
  it('takes the first sentence under the element heading, else the description', () => {
    const page = '---\ntitle: X\ndescription: "Fallback text."\n---\n\n## `<demo-tag>`\n\nFirst **bold** [link](/x/) sentence. Second one.\n';
    expect(summaryFromPage(page, 'demo-tag')).toBe('First bold link sentence.');
    expect(summaryFromPage(page, 'other-tag')).toBe('Fallback text.');
    expect(plainText('Use `<score-player>` and <Badge text="x" />.')).toBe('Use <score-player> and .');
  });
});

describe('types', () => {
  it('lists every value of an element’s type attribute, and none for elements without one', () => {
    expect(byTag('audio-meter')?.types).toEqual(['vu', 'loudness', 'waveform', 'oscilloscope', 'spectrum', 'spectrogram', 'stereometer']);
    expect(byTag('score-view')?.types).toEqual(['piano-roll', 'staff', 'waterfall']);
    expect(byTag('score-player')?.types).toEqual([]);
    const cards = LIBRARY.reduce((sum, entry) => sum + Math.max(1, entry.types.length), 0);
    expect(cards).toBeGreaterThan(LIBRARY.length);
  });
});
