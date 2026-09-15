// Tests for the shared internal element modules (and SSR-safe imports). These
// run in plain Node — no happy-dom — which is exactly the point of the SSR test.
import {describe, expect, it, vi} from 'vitest';
import {numAttr} from '../../src/play/element/internal/base';
import {PointerSurface} from '@webmusic/ui/note';
import {HTMLElementBase, upgradeProperty} from '../../src/play/element/internal/base';

/** Minimal stand-in for an Element carrying attributes. */
function fakeEl(attrs: Record<string, string | null>): Element {
  return {getAttribute: (name: string) => attrs[name] ?? null} as unknown as Element;
}

describe('numAttr', () => {
  it('returns the fallback when the attribute is missing', () => {
    expect(numAttr(fakeEl({}), 'bpm', 120)).toBe(120);
  });

  it('parses a plain number', () => {
    expect(numAttr(fakeEl({bpm: '90'}), 'bpm', 120)).toBe(90);
  });

  it('falls back on NaN instead of poisoning downstream maths', () => {
    expect(numAttr(fakeEl({bpm: 'abc'}), 'bpm', 120)).toBe(120);
    expect(numAttr(fakeEl({bpm: 'NaN'}), 'bpm', 120)).toBe(120);
    expect(numAttr(fakeEl({bpm: 'Infinity'}), 'bpm', 120)).toBe(120);
  });

  it('treats an empty attribute as missing (Number("") is 0, which would be wrong)', () => {
    expect(numAttr(fakeEl({bpm: ''}), 'bpm', 120)).toBe(120);
    expect(numAttr(fakeEl({bpm: '   '}), 'bpm', 120)).toBe(120);
  });

  it('clamps to the given range', () => {
    expect(numAttr(fakeEl({velocity: '500'}), 'velocity', 100, 1, 127)).toBe(127);
    expect(numAttr(fakeEl({velocity: '-3'}), 'velocity', 100, 1, 127)).toBe(1);
    expect(numAttr(fakeEl({velocity: '64'}), 'velocity', 100, 1, 127)).toBe(64);
  });

  it('clamps the fallback too', () => {
    expect(numAttr(fakeEl({}), 'bars', 2, 4)).toBe(4);
  });
});

describe('PointerSurface', () => {
  function makeSurface() {
    const events: Array<[number, boolean]> = [];
    const surface = new PointerSurface({
      root: () => undefined, // no DOM — highlight lookups just no-op
      keySelector: '.key',
      fire: (midi, on) => events.push([midi, on]),
    });
    return {surface, events};
  }

  it('refcounts presses so only the first/last holder fires', () => {
    const {surface, events} = makeSurface();
    surface.press(60);
    surface.press(60);
    surface.release(60);
    surface.release(60);
    expect(events).toEqual([[60, true], [60, false]]);
  });

  it('ignores releases of notes that are not held', () => {
    const {surface, events} = makeSurface();
    surface.release(61);
    expect(events).toEqual([]);
  });

  it('releaseAll emits a note-off for every held note exactly once', () => {
    const {surface, events} = makeSurface();
    surface.press(60);
    surface.press(64);
    surface.press(64); // second holder of the same note
    surface.press(67);
    events.length = 0;
    surface.releaseAll();
    expect(events.sort((a, b) => a[0] - b[0])).toEqual([[60, false], [64, false], [67, false]]);
    // Everything is forgotten: another releaseAll / release fires nothing.
    surface.releaseAll();
    surface.release(60);
    expect(events.length).toBe(3);
  });
});

describe('SSR safety', () => {
  it('HTMLElementBase exists even without a DOM', () => {
    expect(typeof HTMLElementBase).toBe('function');
  });

  it('importing the whole elements entry in Node does not throw', async () => {
    // Pre-fix, `class X extends HTMLElement` at module top level threw a
    // ReferenceError on import in any non-browser runtime.
    const mod = await import('../../src/play/element/index');
    expect(typeof mod.defineAllElements).toBe('function');
    expect(typeof mod.ScorePlayerElement).toBe('function');
    expect(typeof mod.SimpleScorePlayerElement).toBe('function');
    expect(typeof mod.NoteInputElement).toBe('function');
    // And registering is a safe no-op without customElements.
    expect(() => mod.defineAllElements()).not.toThrow();
  });

  it('registers the canonical and deprecated player tags once with distinct constructors', async () => {
    const mod = await import('../../src/play/element/index');
    const target = globalThis as Record<string, unknown>;
    const previous = target.customElements;
    const registry = new Map<string, CustomElementConstructor>();
    const define = vi.fn((tag: string, constructor: CustomElementConstructor) => {
      registry.set(tag, constructor);
    });
    target.customElements = {
      define,
      get: (tag: string) => registry.get(tag),
    };

    try {
      mod.defineAllElements();
      mod.defineAllElements();

      expect(mod.SimpleScorePlayerElement).not.toBe(mod.ScorePlayerElement);
      expect(registry.get('score-player')).toBe(mod.ScorePlayerElement);
      expect(registry.get('simple-score-player')).toBe(mod.SimpleScorePlayerElement);
      expect(define.mock.calls.filter(([tag]) => tag === 'score-player')).toHaveLength(1);
      expect(define.mock.calls.filter(([tag]) => tag === 'simple-score-player')).toHaveLength(1);
    } finally {
      if (previous === undefined) delete target.customElements;
      else target.customElements = previous;
    }
  });
});

describe('upgradeProperty', () => {
  it('re-routes a pre-upgrade own property through the prototype accessor', () => {
    class Widget {
      stored?: number;
      set value(v: number) {
        this.stored = v;
      }
      get value(): number {
        return this.stored ?? 0;
      }
    }
    const w = new Widget();
    // Simulate "set before upgrade": a plain own property shadowing the accessor.
    Object.defineProperty(w, 'value', {value: 42, configurable: true, writable: true, enumerable: true});
    expect(w.stored).toBeUndefined();
    upgradeProperty(w as unknown as HTMLElement, 'value');
    expect(w.stored).toBe(42);
    expect(w.value).toBe(42);
  });
});
