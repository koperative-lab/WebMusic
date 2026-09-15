// @vitest-environment jsdom

import {afterEach, describe, expect, it, vi} from 'vitest';
import {
  ANALYSIS_SPAN_SELECTOR,
  createAnalysisPlayhead,
  readAnalysisIdleStyle,
  readAnalysisSpans,
} from '../src/analysis';
import {
  harmonyPresenterStyle,
  mountChipStrip,
  mountNameplate,
  mountWheel,
  type NameplateState,
  type WheelState,
} from '../src/harmony';

/**
 * The three read-outs that do not run a clock, and the sheet all four share.
 *
 * jsdom has no `Element.prototype.animate` at all, which is why the nameplate
 * feature-detects it: the pop is the one thing here that cannot be expressed as
 * a declaration, and a read-out that threw on its first chord in a test
 * environment would be a read-out nobody could test. The cases below run it
 * both ways — installed, and absent.
 */

function host(): HTMLElement {
  const node = document.createElement('div');
  document.body.append(node);
  return node;
}

/** Install a WAAPI the environment does not have, and count what it is asked. */
function installAnimate(): ReturnType<typeof vi.fn> {
  const animate = vi.fn(() => ({cancel: vi.fn()}));
  Object.defineProperty(HTMLElement.prototype, 'animate', {
    configurable: true,
    writable: true,
    value: animate,
  });
  return animate;
}

afterEach(() => {
  document.body.replaceChildren();
  delete (HTMLElement.prototype as {animate?: unknown}).animate;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------

describe('the shared harmony stylesheet', () => {
  it('carries all four roots and the reduced-motion escape', () => {
    for (const root of [
      '.wui-harmony-flow',
      '.wui-harmony-nameplate',
      '.wui-harmony-chip',
      '.wui-harmony-wheel',
    ]) {
      expect(harmonyPresenterStyle).toContain(`${root} {`);
      expect(harmonyPresenterStyle).toContain(`${root}, ${root} *`);
    }
    expect(harmonyPresenterStyle).toContain('@media (prefers-reduced-motion: reduce)');
    // None of the four names a docs class: `check-docs` harvests every `wui-`
    // token out of this package, comments included, and 43 of them are taken.
    expect(harmonyPresenterStyle).not.toContain('.wui-chip ');
    expect(harmonyPresenterStyle).not.toContain('.wui-track ');
    expect(harmonyPresenterStyle).not.toContain('.wui-readout ');
  });
});

describe('mountNameplate', () => {
  const chord = (symbol: string, key?: string): NameplateState['primary'] => ({symbol, key});

  it('keeps the primary symbol’s node for life, because a live region needs it', () => {
    let state: NameplateState = {primary: chord('Am7')};
    let notify = (): void => {};
    const handle = mountNameplate(host(), {
      snapshot: () => state,
      subscribe: (listener) => {
        notify = listener;
        return () => {};
      },
    });
    const symbol = handle.symbol;
    expect(symbol.textContent).toBe('Am7');
    state = {primary: chord('D7')};
    notify();
    // A replaced node inside `aria-live` is a change the reader never hears.
    expect(handle.symbol).toBe(symbol);
    expect(symbol.textContent).toBe('D7');
    expect(symbol.parentElement?.getAttribute('aria-live')).toBe('polite');
    expect(symbol.parentElement?.getAttribute('aria-atomic')).toBe('true');
    handle.destroy();
  });

  it('pops on a change the caller never announced twice', () => {
    const animate = installAnimate();
    let state: NameplateState = {primary: chord('C', 'one')};
    let notify = (): void => {};
    const handle = mountNameplate(host(), {
      snapshot: () => state,
      subscribe: (listener) => {
        notify = listener;
        return () => {};
      },
    });
    expect(animate).toHaveBeenCalledTimes(1);

    // The same spelling, a different event — the identity is what pops, so a
    // chord struck twice reads as twice.
    state = {primary: chord('C', 'two')};
    notify();
    expect(animate).toHaveBeenCalledTimes(2);

    // The same identity: nothing to announce, nothing to pop.
    notify();
    expect(animate).toHaveBeenCalledTimes(2);

    // Opacity only. The symbol is the one line the reader is actually reading,
    // and a word that jumps or scales while being read cannot be read.
    const frames = animate.mock.calls[0]?.[0] as Record<string, unknown>[];
    expect(frames.every((frame) => Object.keys(frame).join() === 'opacity')).toBe(true);
    handle.destroy();
  });

  it('writes the pop’s duration in exactly one number, twice', () => {
    // The Web Animations API takes a number and cannot take a `var()`, so this
    // duration genuinely lives in two places. They are held equal here.
    const declared = /--wui-harmony-motion-pop: var\(--wm-harmony-motion-pop, (\d+)ms\)/.exec(
      harmonyPresenterStyle,
    );
    expect(declared).not.toBeNull();
    const animate = installAnimate();
    const handle = mountNameplate(host(), {snapshot: () => ({primary: chord('C')})});
    expect((animate.mock.calls[0]?.[1] as {duration: number}).duration).toBe(
      Number(declared?.[1]),
    );
    handle.destroy();
  });

  it('does not pop, and does not throw, where there is no WAAPI', () => {
    // jsdom's own state, and the first environment the SSR tripwire reaches.
    expect((HTMLElement.prototype as {animate?: unknown}).animate).toBeUndefined();
    const handle = mountNameplate(host(), {snapshot: () => ({primary: chord('C')})});
    expect(() => handle.pop()).not.toThrow();
    expect(handle.symbol.textContent).toBe('C');
    handle.destroy();
  });

  it('spends no pop at all under reduced motion', () => {
    const animate = installAnimate();
    const handle = mountNameplate(
      host(),
      {snapshot: () => ({primary: chord('C')})},
      {motion: 'stepped'},
    );
    expect(animate).not.toHaveBeenCalled();
    expect(handle.element.dataset.motion).toBe('stepped');
    handle.destroy();
  });

  it('keeps the history and the ghost OUT of the live region', () => {
    const handle = mountNameplate(host(), {
      snapshot: () => ({
        primary: chord('Am7'),
        next: {symbol: 'D7'},
        history: ['C', 'Am7'],
      }),
    });
    const live = handle.element.querySelector('.wui-harmony-nameplate__live')!;
    const history = handle.element.querySelector('.wui-harmony-nameplate__history')!;
    const next = handle.element.querySelector('.wui-harmony-nameplate__next')!;
    // A history inside the live region reads every chord twice: once as the
    // nameplate, once as its own echo.
    expect(live.contains(history)).toBe(false);
    expect(live.contains(next)).toBe(false);
    expect(history.getAttribute('aria-hidden')).toBe('true');
    expect(next.getAttribute('aria-hidden')).toBe('true');
    expect(next.textContent).toBe('D7');
    handle.destroy();
  });

  it('announces the spoken form once, not the symbol and its expansion', () => {
    const handle = mountNameplate(host(), {
      snapshot: () => ({primary: {symbol: 'Cmaj7', full: 'C major seventh'}}),
    });
    expect(handle.symbol.getAttribute('aria-hidden')).toBe('true');
    expect(handle.element.querySelector('.wui-harmony-nameplate__full')?.textContent).toBe(
      'C major seventh',
    );
    handle.destroy();
  });

  it('makes an alternate a button only when pressing it does something', () => {
    const plain = mountNameplate(host(), {
      snapshot: () => ({primary: chord('Am7'), alternates: [{symbol: 'C6', note: 'inversion'}]}),
    });
    // No focusable node with nothing behind it: that is a trap, not an
    // affordance.
    expect(plain.element.querySelectorAll('button')).toHaveLength(0);
    expect(plain.element.querySelector('.wui-harmony-nameplate__alternates')?.textContent).toBe(
      'C6 (inversion)',
    );
    plain.destroy();

    const selectAlternate = vi.fn();
    const live = mountNameplate(host(), {
      snapshot: () => ({primary: chord('Am7'), alternates: [{symbol: 'C6'}]}),
      selectAlternate,
    });
    const button = live.element.querySelector('button')!;
    button.dispatchEvent(new MouseEvent('click', {bubbles: true}));
    expect(selectAlternate).toHaveBeenCalledWith(0, {symbol: 'C6'});
    live.destroy();
  });

  it('does not take a reader’s focus away every time the chord changes', () => {
    // `replaceChildren` destroys and re-creates every alternate `<button>`, and
    // a chord change is exactly the moment a reader is deciding between those
    // readings. Focus went to `<body>` on any `update()` at all — including one
    // whose snapshot was byte-identical.
    let symbol = 'Am7';
    let notify = (): void => {};
    const handle = mountNameplate(host(), {
      snapshot: () => ({
        primary: chord(symbol),
        alternates: [{symbol: 'C6', note: 'inversion'}],
        history: ['F', 'G'],
      }),
      selectAlternate: vi.fn(),
      subscribe: (listener) => {
        notify = listener;
        return () => {};
      },
    });
    const button = handle.element.querySelector('button')!;
    button.focus();
    notify();
    expect(handle.element.querySelector('button')).toBe(button);
    expect(document.activeElement).toBe(button);
    // The chord underneath it changes; the list of readings did not, so neither
    // does the node the reader is standing on.
    symbol = 'C6';
    notify();
    expect(handle.element.querySelector('button')).toBe(button);
    expect(handle.symbol.textContent).toBe('C6');
    handle.destroy();
  });

  it('writes the approach as one custom property, not a sheet of styles', () => {
    let approach = 0.2;
    const handle = mountNameplate(host(), {
      snapshot: () => ({primary: chord('Am7'), next: {symbol: 'D7'}}),
      approach: () => approach,
    });
    handle.tick();
    expect(handle.element.style.getPropertyValue('--wui-harmony-approach')).toBe('0.2');
    approach = 1.4;
    handle.tick();
    // Clamped, because a ghost at 140% opacity is a ghost nobody designed.
    expect(handle.element.style.getPropertyValue('--wui-harmony-approach')).toBe('1');
    handle.destroy();
  });
});

describe('mountChipStrip', () => {
  it('is a list, not a performance: no frame loop, and an `ol` of `li`', () => {
    const raf = vi.spyOn(window, 'requestAnimationFrame');
    const handle = mountChipStrip(host(), {
      snapshot: () => ({
        layout: 'stack',
        items: [
          {id: 'c', start: 0, end: 4, primary: 'C major', meter: 0.9, meterGhost: 0.6},
          {id: 'a', start: 0, end: 4, primary: 'A minor', meter: 0.4},
        ],
      }),
    });
    expect(raf).not.toHaveBeenCalled();
    expect(handle.list.tagName).toBe('OL');
    expect([...handle.list.children].map((node) => node.tagName)).toEqual(['LI', 'LI']);
    expect(handle.list.dataset.layout).toBe('stack');
    handle.destroy();
  });

  it('draws the whole-piece answer behind the part that has been heard', () => {
    const handle = mountChipStrip(host(), {
      snapshot: () => ({items: [{id: 'c', start: 0, end: 4, primary: 'C', meter: 0.25, meterGhost: 0.75}]}),
    });
    const chip = handle.item('c')!;
    // One row of DOM carrying two tracks: they are two readings of ONE
    // quantity, and two rows would invite a comparison of the wrong pair.
    expect(chip.querySelector<HTMLElement>('.wui-harmony-chip__ghost')?.style.width).toBe('75%');
    expect(chip.querySelector<HTMLElement>('.wui-harmony-chip__fill')?.style.width).toBe('25%');
    handle.destroy();
  });

  it('stamps the same span contract the lane does', () => {
    const handle = mountChipStrip(host(), {
      snapshot: () => ({
        items: [
          {id: 'one', start: 0, end: 4, primary: 'I', roman: 'I'},
          {id: 'two', start: 4, end: 8, primary: 'V', spans: [{start: 4, end: 8}]},
        ],
      }),
    });
    expect(readAnalysisSpans(handle.item('one')!)).toEqual([{startQuarters: 0, endQuarters: 4}]);
    expect(handle.item('two')!.dataset.spans).toBe('4:8');
    expect(handle.item('two')!.dataset.startQuarters).toBeUndefined();
    expect(handle.element.querySelectorAll(ANALYSIS_SPAN_SELECTOR)).toHaveLength(2);
    // Stamped last, after the paint, or the first de-highlight restores a box
    // the chip never had.
    expect(readAnalysisIdleStyle(handle.item('one')!)).toBe(handle.item('one')!.style.cssText);
    handle.destroy();
  });

  it('does not put the sounding chip out every time its text changes', () => {
    // The playhead lights a node ONCE and skips it while it stays active. A
    // guard against `style.cssText` therefore never fires while a chip is lit —
    // the comparison is against a string carrying the highlight — so every
    // snapshot update used to reset the sounding chip to its idle box and leave
    // it dark, still carrying the `aria-current` that says it is the one.
    let count = 3;
    let notify = (): void => {};
    const handle = mountChipStrip(host(), {
      snapshot: () => ({
        items: [{id: 'one', start: 0, end: 4, primary: 'I', trailing: `x${count}`}],
      }),
      subscribe: (listener) => {
        notify = listener;
        return () => {};
      },
    });
    const chip = handle.item('one')!;
    const idle = readAnalysisIdleStyle(chip);
    const playhead = createAnalysisPlayhead(handle.element, {scroll: false});
    playhead.update(1);
    expect(chip.style.cssText).toContain('outline');

    count = 4;
    notify();
    expect(chip.querySelector('.wui-harmony-chip__trailing')?.textContent).toBe('x4');
    expect(chip.style.cssText).toContain('outline');
    expect(readAnalysisIdleStyle(chip)).toBe(idle);
    // And it still goes out when the playhead says so, not before.
    playhead.update(9);
    expect(chip.style.cssText).toBe(idle);
    playhead.destroy();
    handle.destroy();
  });

  it('says what is missing rather than rendering nothing', () => {
    const handle = mountChipStrip(host(), {
      snapshot: () => ({items: [], emptyLabel: 'No key yet.'}),
    });
    const empty = handle.element.querySelector('.wui-harmony-chip__empty');
    expect(empty?.textContent).toBe('No key yet.');
    expect(empty?.getAttribute('aria-live')).toBe('polite');
    handle.destroy();
  });
});

describe('mountWheel', () => {
  const KEYS = ['C', 'G', 'D', 'A', 'E', 'B', 'Gb', 'Db', 'Ab', 'Eb', 'Bb', 'F'];

  function circle(overrides: Partial<WheelState> = {}): WheelState {
    return {
      outer: KEYS.map((label, at) => ({id: label, label, weight: at === 0 ? 1 : 0.1})),
      centre: {primary: 'C major', secondary: 'confidence 82%'},
      ...overrides,
    };
  }

  function rotation(node: Element): number {
    return Number.parseFloat(
      /rotate\((-?[\d.]+)deg\)/.exec((node as HTMLElement).style.transform)?.[1] ?? 'NaN',
    );
  }

  it('turns the SHORT way from the last segment to the first', () => {
    // 'F' is the twelfth segment and 'C' the first — the wrap the arithmetic
    // exists for.
    let state = circle({needle: {at: 'F'}});
    let notify = (): void => {};
    const handle = mountWheel(host(), {
      snapshot: () => state,
      subscribe: (listener) => {
        notify = listener;
        return () => {};
      },
    });
    const needle = handle.element.querySelector('.wui-harmony-wheel__needle')!;
    const before = rotation(needle);
    state = circle({needle: {at: 'C'}});
    notify();
    const after = rotation(needle);
    // Plus one segment, not minus eleven. An absolute angle takes the long way
    // round on every wrap and reads as the key lurching backwards through ten
    // keys it never held.
    expect(after).toBeGreaterThan(before);
    expect(after - before).toBeCloseTo(30, 6);
    handle.destroy();
  });

  it('draws whatever number of segments it is given, and never assumes twelve', () => {
    const handle = mountWheel(host(), {
      snapshot: () => ({
        outer: ['a', 'b', 'c', 'd', 'e'].map((id) => ({id, label: id, weight: 1})),
      }),
    });
    expect(handle.element.querySelectorAll('.wui-harmony-wheel__sector')).toHaveLength(5);
    expect(handle.segment('c')).not.toBeNull();
    handle.destroy();
  });

  it('publishes a hidden twin that matches the rings item for item', () => {
    const handle = mountWheel(host(), {
      snapshot: () =>
        circle({
          inner: ['Am', 'Em'].map((label) => ({id: label, label, weight: 1})),
          needle: {at: 'C'},
        }),
    });
    // The SVG says nothing; the list says all of it, with the share each
    // segment holds and which one the needle is on.
    expect(handle.svg.getAttribute('aria-hidden')).toBe('true');
    expect(handle.index.children).toHaveLength(KEYS.length + 2);
    expect(handle.index.children[0]?.textContent).toBe('C 48%');
    expect(handle.index.children[1]?.textContent).toBe('G 5%');
    const current = [...handle.index.children].filter(
      (item) => item.getAttribute('aria-current') === 'true',
    );
    expect(current.map((item) => (item as HTMLElement).dataset.segment)).toEqual(['C']);
    handle.destroy();
  });

  it('keeps the centre read-out’s nodes, because it is a live region now', () => {
    let state = circle({needle: {at: 'C'}});
    let notify = (): void => {};
    const handle = mountWheel(host(), {
      snapshot: () => state,
      subscribe: (listener) => {
        notify = listener;
        return () => {};
      },
    });
    const centre = handle.element.querySelector('.wui-harmony-wheel__centre')!;
    const primary = centre.querySelector('.wui-harmony-wheel__primary')!;
    expect(centre.getAttribute('role')).toBe('status');
    expect(primary.textContent).toBe('C major');
    state = circle({centre: {primary: 'A minor', secondary: 'confidence 61%'}, needle: {at: 'A'}});
    notify();
    expect(centre.querySelector('.wui-harmony-wheel__primary')).toBe(primary);
    expect(primary.textContent).toBe('A minor');
    handle.destroy();
  });

  it('draws an unsure answer as a wedge rather than a confident hair', () => {
    const hair = mountWheel(host(), {snapshot: () => circle({needle: {at: 'C'}})});
    const wedge = mountWheel(host(), {snapshot: () => circle({needle: {at: 'C', spread: 2}})});
    const path = (handle: {element: HTMLElement}): string =>
      handle.element.querySelector('.wui-harmony-wheel__pointer')?.getAttribute('d') ?? '';
    expect(path(hair)).toMatch(/^M[\d.]+ [\d.]+ L/);
    // An arc, not a line: forty per cent confidence should LOOK like forty per
    // cent, and a thin needle on an unsure answer is a picture of certainty.
    expect(path(wedge)).toContain('A');
    hair.destroy();
    wedge.destroy();
  });

  it('stands the shape up before there is anything to put in it', () => {
    const handle = mountWheel(host(), {
      snapshot: () => ({outer: [], emptyLabel: 'Listening…'}),
    });
    expect(handle.element.querySelectorAll('.wui-harmony-wheel__sector')).toHaveLength(12);
    expect(handle.element.querySelector('.wui-harmony-wheel__empty')?.textContent).toBe(
      'Listening…',
    );
    expect(handle.element.querySelector('.wui-harmony-wheel__needle')).not.toBeNull();
    handle.destroy();
  });

  it('hands the host back exactly as it found it', () => {
    const node = host();
    const keep = document.createElement('span');
    node.append(keep);
    const handle = mountWheel(node, {snapshot: () => circle()});
    handle.destroy();
    handle.destroy();
    expect(node.firstElementChild).toBe(keep);
    expect(node.querySelector('.wui-harmony-wheel')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Regressions from the three-lens review of the salvage port.
// ---------------------------------------------------------------------------

describe('harmony read-out regressions', () => {
  it('says no share at all when the ring carries no weights', () => {
    // `total` is the sum of the ring's weights, so an unweighted ring summed to
    // zero and the twin announced "C major 0%, G major 0%, A minor 0%" —
    // twelve segments each claiming to be impossible, which is worse than
    // saying nothing about strength.
    const handle = mountWheel(host(), {
      snapshot: () => ({outer: [{id: 'C', label: 'C major'}, {id: 'G', label: 'G major'}]}),
    });
    const index = handle.element.querySelector('.wui-harmony-wheel__index')!;
    expect([...index.children].map((item) => item.textContent)).toEqual(['C major', 'G major']);
    handle.destroy();

    const weighted = mountWheel(host(), {
      snapshot: () => ({
        outer: [
          {id: 'C', label: 'C major', weight: 3},
          {id: 'G', label: 'G major', weight: 1},
        ],
      }),
    });
    const shares = weighted.element.querySelector('.wui-harmony-wheel__index')!;
    expect([...shares.children].map((item) => item.textContent)).toEqual([
      'C major 75%',
      'G major 25%',
    ]);
    weighted.destroy();
  });

  it('marks one entry current when two rings share a segment id', () => {
    // `sectors` was already keyed on `ring:id`; the twin was keyed on the id
    // alone, so an outer 'C' and an inner 'C' — the ordinary case, not a
    // contrived one — were both told they were the answer.
    const handle = mountWheel(host(), {
      snapshot: () => ({
        outer: [{id: 'C', label: 'C major', weight: 1}],
        inner: [{id: 'C', label: 'C minor', weight: 1}],
        needle: {at: 'C', ring: 'inner'},
      }),
    });
    const index = handle.element.querySelector('.wui-harmony-wheel__index')!;
    const current = [...index.children].filter(
      (item) => item.getAttribute('aria-current') === 'true',
    );
    expect(current).toHaveLength(1);
    expect(current[0]?.textContent).toBe('C minor 100%');
    handle.destroy();
  });

  it('lets the centre speak one fact at a time', () => {
    // `update()` runs on every notify, so an atomic centre re-announced the key
    // name on every tick of a confidence that had moved a percent.
    const handle = mountWheel(host(), {snapshot: () => ({outer: [{id: 'C', label: 'C'}]})});
    const centre = handle.element.querySelector('.wui-harmony-wheel__centre')!;
    expect(centre.getAttribute('role')).toBe('status');
    expect(centre.getAttribute('aria-live')).toBe('polite');
    expect(centre.getAttribute('aria-atomic')).toBeNull();
    handle.destroy();
  });

  it('gives an inert alternate the chip’s class and NOT the pointer', () => {
    // A focusable node with no behaviour is a trap; a pointer cursor over a
    // node that does nothing is the same lie said with a cursor.
    const readings = [{symbol: 'Em/C', note: 'rootless'}];
    const inert = mountNameplate(
      host(),
      {snapshot: (): NameplateState => ({primary: {symbol: 'Cmaj7'}, alternates: readings})},
      {stylesheet: false},
    );
    const item = inert.element.querySelector<HTMLElement>('.wui-harmony-nameplate__alternates li')!;
    expect(item.tagName).toBe('LI');
    expect(item.className).toBe('wui-harmony-nameplate__alternate');
    expect(item.style.cursor).toBe('');
    inert.destroy();

    const pressable = mountNameplate(
      host(),
      {
        snapshot: (): NameplateState => ({primary: {symbol: 'Cmaj7'}, alternates: readings}),
        selectAlternate: vi.fn(),
      },
      {stylesheet: false},
    );
    const button = pressable.element.querySelector<HTMLElement>('button')!;
    expect(button.style.cursor).toBe('pointer');
    pressable.destroy();
    expect(harmonyPresenterStyle).toContain('button.wui-harmony-nameplate__alternate');
  });

  it('rebuilds the alternates when only the reading’s identity changed', () => {
    // The guard keeps a focused button alive across a chord change, and every
    // button closes over the candidate it was built from — so a field the guard
    // omits is a field `selectAlternate` can be handed a stale copy of.
    let alternates = [{symbol: 'Em/C', note: 'rootless', key: 'FIRST', weight: 0.9}];
    const selectAlternate = vi.fn();
    let notify = (): void => {};
    const handle = mountNameplate(host(), {
      snapshot: (): NameplateState => ({primary: {symbol: 'Cmaj7'}, alternates}),
      subscribe: (listener) => {
        notify = listener;
        return () => {};
      },
      selectAlternate,
    });
    alternates = [{symbol: 'Em/C', note: 'rootless', key: 'SECOND', weight: 0.2}];
    notify();
    handle.element.querySelector<HTMLElement>('button')!.click();
    expect(selectAlternate).toHaveBeenCalledWith(0, alternates[0]);
    handle.destroy();
  });

  it('shows a pressable chip as pressable, on both paths', () => {
    const handle = mountChipStrip(
      host(),
      {
        snapshot: () => ({items: [{id: 'a', start: 0, end: 1, primary: 'C'}]}),
        selectItem: vi.fn(),
      },
      {stylesheet: false},
    );
    const chip = handle.element.querySelector<HTMLElement>('.wui-harmony-chip__item')!;
    expect(chip.dataset.selectable).toBe('true');
    expect(chip.style.cursor).toBe('pointer');
    handle.destroy();
    expect(harmonyPresenterStyle).toContain('.wui-harmony-chip__item[data-selectable="true"]');
  });

  it('keeps a chip’s own range when every occurrence is still unplaced', () => {
    const handle = mountChipStrip(host(), {
      snapshot: () => ({
        items: [
          {id: 'a', start: 2, end: 6, primary: 'C', spans: [{start: Number.NaN, end: Number.NaN}]},
        ],
      }),
    });
    const chip = handle.element.querySelector<HTMLElement>('.wui-harmony-chip__item')!;
    expect(chip.dataset.spans).toBeUndefined();
    expect(readAnalysisSpans(chip)).toEqual([{startQuarters: 2, endQuarters: 6}]);
    expect(chip.matches(ANALYSIS_SPAN_SELECTOR)).toBe(true);
    handle.destroy();
  });

  it('sizes a hero symbol on the inline path too', () => {
    // The one option that says "this read-out is standing alone on a stage",
    // and `live-chord` — the view it was added for — pins its nameplate on the
    // now line.
    const hero = mountNameplate(
      host(),
      {snapshot: (): NameplateState => ({primary: {symbol: 'Cmaj7'}, emphasis: 'hero'})},
      {stylesheet: false},
    );
    const symbol = hero.element.querySelector<HTMLElement>('.wui-harmony-nameplate__symbol')!;
    expect(symbol.style.fontSize).toContain('1.35');
    hero.destroy();

    const plain = mountNameplate(
      host(),
      {snapshot: (): NameplateState => ({primary: {symbol: 'Cmaj7'}})},
      {stylesheet: false},
    );
    const plainSymbol = plain.element.querySelector<HTMLElement>('.wui-harmony-nameplate__symbol')!;
    expect(plainSymbol.style.fontSize).not.toContain('1.35');
    plain.destroy();
  });
});


describe('mountNameplate responsive content', () => {
  it.each([true, false])('collapses missing content and restores its layout without replacing the live region (stylesheet=%s)', (stylesheet) => {
    let state: NameplateState = {caption: 'Sounding now', emptyLabel: 'Waiting for notes'};
    const handle = mountNameplate(host(), {snapshot: () => state}, {stylesheet});
    const live = handle.symbol.parentElement;
    const parts = ['symbol', 'next', 'voicing', 'alternates', 'history'];
    for (const part of parts) {
      const node = handle.element.querySelector<HTMLElement>(`.wui-harmony-nameplate__${part}`)!;
      expect(node.hidden).toBe(true);
      expect(getComputedStyle(node).display).toBe('none');
    }
    state = {
      primary: {symbol: 'Cmaj7'},
      next: {symbol: 'Fmaj7'},
      voicing: [{label: 'C4'}],
      alternates: [{symbol: 'Em/C'}],
      history: ['Am7'],
    };
    handle.update();
    expect(handle.symbol.parentElement).toBe(live);
    for (const part of parts) {
      const node = handle.element.querySelector<HTMLElement>(`.wui-harmony-nameplate__${part}`)!;
      expect(node.hidden).toBe(false);
      expect(getComputedStyle(node).display).not.toBe('none');
    }
    expect(getComputedStyle(handle.element.querySelector('.wui-harmony-nameplate__alternates')!).display).toBe('flex');
    expect(getComputedStyle(handle.element.querySelector('.wui-harmony-nameplate__history')!).display).toBe('flex');
    state = {emptyLabel: 'Waiting for notes'};
    handle.update();
    for (const part of parts) {
      expect(getComputedStyle(handle.element.querySelector(`.wui-harmony-nameplate__${part}`)!).display).toBe('none');
    }
    handle.destroy();
  });

  it.each([true, false])('allows long primary and selectable alternate names to wrap (stylesheet=%s)', (stylesheet) => {
    const name = 'Cmaj13addSharpEleven/ExtendedBass';
    const handle = mountNameplate(host(), {
      snapshot: () => ({primary: {symbol: name}, alternates: [{symbol: name, note: 'alternative interpretation'}]}),
      selectAlternate: vi.fn(),
    }, {stylesheet});
    const button = handle.element.querySelector('button')!;
    for (const node of [handle.symbol, button]) {
      const style = getComputedStyle(node);
      expect(style.whiteSpace).toBe('normal');
      expect(style.overflowWrap).toBe('anywhere');
      expect(style.maxWidth).toBe('100%');
    }
    expect(getComputedStyle(button.parentElement!).minWidth).toBe('0');
    expect(handle.symbol.textContent).toBe(name);
    handle.destroy();
  });
});
