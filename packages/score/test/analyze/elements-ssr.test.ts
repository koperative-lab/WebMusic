// @vitest-environment node

// ---------------------------------------------------------------------------
// The cases that need NO document, split out of `elements.test.ts` when that
// file moved to jsdom. Two distinct reasons, one per describe:
//
//   · `elements module (SSR safety)` is about the absence of a DOM and cannot
//     be expressed anywhere else. `expect(customElements).toBeUndefined()`
//     fails under jsdom by construction, and `new ChordAnalysisElement()` in a
//     document is a statement about the custom-element registry, not about
//     rendering a page on a server.
//   · `define functions` is about the `define*` plumbing rather than about the
//     DOM — but it installs a FAKE registry on `globalThis` to count `define`
//     calls. Under jsdom that assignment succeeds and overwrites
//     `window.customElements` for every later describe in the file (measured);
//     here there is no registry to damage.
//
// Second job, and the reason this file must keep importing the element module
// rather than only the `define*` helpers: it is the score-side SSR tripwire.
// The import runs in `node`, so it goes red the moment anything in the
// element's static import closure touches a browser global at module scope.
// ---------------------------------------------------------------------------

import {afterEach, describe, expect, it, vi} from 'vitest';
import {
  ChordAnalysisElement,
  IntervalAnalysisElement, ScaleAnalysisElement, RhythmAnalysisElement,
  defineAllAnalysisElements,
  defineChordAnalysisElement,
  defineIntervalAnalysisElement, defineScaleAnalysisElement, defineRhythmAnalysisElement,
} from '../../src/analyze/element/index';
import * as elements from '../../src/analyze/element/index';
import {ScoreBuilder} from '../../src/core';
import {distributions, rhythmPatterns} from '../../src/analyze';
import {createScoreReport} from '../../src/analyze/headless';

describe('elements module (SSR safety)', () => {
  it('does not export retired Element classes or registration helpers', () => {
    expect(Object.keys(elements).sort()).toEqual([
      'ChordAnalysisElement', 'IntervalAnalysisElement', 'ScaleAnalysisElement', 'RhythmAnalysisElement',
      'defineAllAnalysisElements', 'defineChordAnalysisElement', 'defineIntervalAnalysisElement',
      'defineScaleAnalysisElement', 'defineRhythmAnalysisElement',
    ].sort());
  });

  it('keeps reports, distributions and rhythm analysis available as data APIs', () => {
    const score = new ScoreBuilder().build();
    expect(createScoreReport(score).rows.find((row) => row.label === 'Notes')?.value).toBe('0');
    expect(distributions(score).pitchClasses).toHaveLength(12);
    expect(rhythmPatterns(score)).toEqual([]);
  });

  it('imports and constructs in Node without document/customElements', () => {
    expect(typeof ChordAnalysisElement).toBe('function');
    for (const ctor of [IntervalAnalysisElement, ScaleAnalysisElement, RhythmAnalysisElement]) expect(typeof ctor).toBe('function');
    expect(() => new ChordAnalysisElement()).not.toThrow();
    for (const ctor of [IntervalAnalysisElement, ScaleAnalysisElement, RhythmAnalysisElement]) expect(() => new ctor()).not.toThrow();
  });

  it('define functions are no-ops without customElements', () => {
    expect((globalThis as Record<string, unknown>).customElements).toBeUndefined();
    expect(() => defineChordAnalysisElement()).not.toThrow();
    for (const define of [defineIntervalAnalysisElement, defineScaleAnalysisElement, defineRhythmAnalysisElement]) expect(() => define()).not.toThrow();
    expect(() => defineAllAnalysisElements()).not.toThrow();
  });
});

describe('define functions', () => {
  const globals = globalThis as Record<string, unknown>;
  // Saved, not assumed absent: the case above proves it is undefined *today*,
  // and a restore keeps that an assertion rather than a precondition.
  const previous = globals.customElements;

  afterEach(() => {
    if (previous === undefined) delete globals.customElements;
    else globals.customElements = previous;
  });

  it('register once and are idempotent', () => {
    const registry = new Map<string, CustomElementConstructor>();
    const define = vi.fn((tag: string, ctor: CustomElementConstructor) => registry.set(tag, ctor));
    globals.customElements = {
      get: (tag: string) => registry.get(tag),
      define,
    };

    defineChordAnalysisElement();
    defineChordAnalysisElement();
    defineChordAnalysisElement();
    defineChordAnalysisElement();

    expect(define).toHaveBeenCalledTimes(1);
    expect(registry.get('score-chord-analysis')).toBe(ChordAnalysisElement);
    expect(registry.has('score-live-chord-analysis')).toBe(false);
  });

  it('registers only the four supported capabilities through defineAllAnalysisElements', () => {
    const registry = new Map<string, CustomElementConstructor>();
    const define = vi.fn((tag: string, ctor: CustomElementConstructor) => registry.set(tag, ctor));
    globals.customElements = {
      get: (tag: string) => registry.get(tag),
      define,
    };

    defineAllAnalysisElements();
    defineAllAnalysisElements();

    expect([...registry.keys()].sort()).toEqual(['score-chord-analysis', 'score-interval-analysis', 'score-rhythm-analysis', 'score-scale-analysis']);
    expect(define).toHaveBeenCalledTimes(4);
    for (const tag of [
      'score-analysis', 'analysis-histogram', 'rhythm-patterns', 'analysis-view', 'analysis-timeline',
      'key-analysis', 'interval-analysis', 'rhythm-analysis', 'motif-analysis', 'rhythm-pattern-analysis',
      'key-wheel', 'key-candidates', 'pitch-evidence', 'chord-history',
    ]) expect(registry.has(tag)).toBe(false);
  });
});
