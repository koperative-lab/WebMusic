// @vitest-environment jsdom
import {afterEach, describe, expect, it, vi} from 'vitest';
import {mountFretboard, mountKeyboard, type FretboardState, type KeyboardState} from '../src/pitch';

function host() { const element = document.createElement('div'); document.body.append(element); return element; }
afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('explicit keyboard geometry', () => {
  it.each([true, false])('sets exact widths/heights with black-edge padding and held-note range updates (stylesheet=%s)', (stylesheet) => {
    let state: KeyboardState = {low: 61, high: 66, marks: [{midi: 64, label: 'E4'}]};
    const handle = mountKeyboard(host(), {snapshot: () => state}, {
      whiteKeyWidth: 40, blackKeyWidth: 24, whiteKeyHeight: 100, blackKeyHeight: 65, stylesheet, release: 0,
    });
    // D/E/F occupy three white units; two black endpoints reserve half each.
    expect(handle.board.style.width).toBe('160px');
    expect(handle.board.style.minWidth).toBe('160px');
    expect(handle.board.style.height).toBe('100px');
    const black = handle.key(61)!;
    expect(Number.parseFloat(black.style.left) * 1.6).toBeCloseTo(20);
    expect(Number.parseFloat(black.style.width) * 1.6).toBeCloseTo(24);
    expect(black.style.height).toBe('65px');
    const held = handle.key(64)!;
    expect(held.dataset.active).toBe('true');
    state = {...state, low: 60, high: 71};
    handle.update();
    expect(handle.board.style.width).toBe('280px');
    expect(handle.key(64)).toBe(held);
    expect(held.dataset.active).toBe('true');
    handle.destroy();
  });

  it('derives white width from a lone black width and clamps oversize black dimensions', () => {
    const derived = mountKeyboard(host(), {snapshot: () => ({low: 60, high: 64, marks: []})}, {blackKeyWidth: 12.4});
    expect(derived.board.style.width).toBe('60px');
    expect(Number.parseFloat(derived.key(61)!.style.width) * .6).toBeCloseTo(12.4);
    derived.destroy();
    const clamped = mountKeyboard(host(), {snapshot: () => ({low: 60, high: 64, marks: []})}, {
      whiteKeyWidth: 20, blackKeyWidth: 80, whiteKeyHeight: 50, blackKeyHeight: 100,
    });
    expect(Number.parseFloat(clamped.key(61)!.style.width) * .6).toBeCloseTo(20);
    expect(clamped.key(61)!.style.height).toBe('50px');
    clamped.destroy();
  });

  it('keeps responsive CSS sizing for invalid values', () => {
    const handle = mountKeyboard(host(), {snapshot: () => ({marks: []})}, {
      whiteKeyWidth: NaN, blackKeyWidth: -1, whiteKeyHeight: 0, blackKeyHeight: Infinity,
    });
    expect(handle.board.style.width).toBe('');
    expect(handle.board.style.height).toBe('');
    expect(handle.key(61)!.style.height).toBe('');
    expect(handle.element.style.getPropertyValue('--wui-pitch-keyboard-width')).toContain('--wui-pitch-key-min-width');
    handle.destroy();
  });
});

describe('keyboard fit to width', () => {
  it.each([true, false])('fits the full range with proportional keys while retaining heights and held notes (stylesheet=%s)', (stylesheet) => {
    const container = host();
    container.style.setProperty('--wui-pitch-key-min-width', '80px');
    let state: KeyboardState = {
      low: 48, high: 84, marks: [{midi: 64, label: 'E4'}],
      octaveLabels: new Map([[84, 'A long octave label']]),
    };
    const handle = mountKeyboard(container, {snapshot: () => state}, {
      fitToWidth: true, whiteKeyWidth: 40, blackKeyWidth: 40,
      whiteKeyHeight: 128, blackKeyHeight: 80, stylesheet, release: 0, follow: 'active',
    });
    expect(handle.board.children).toHaveLength(37);
    expect(handle.board.style.width).toBe('100%');
    expect(Number.parseFloat(handle.board.style.minWidth)).toBe(0);
    expect(handle.board.style.height).toBe('128px');
    expect(handle.key(61)!.style.height).toBe('80px');
    const whiteWidth = Number.parseFloat(handle.key(60)!.style.width);
    expect(whiteWidth * 22).toBeCloseTo(100);
    expect(Number.parseFloat(handle.key(61)!.style.width) / whiteWidth).toBeCloseTo(.62);
    expect(getComputedStyle(handle.element).overflowX).toBe('hidden');
    expect(handle.element.style.getPropertyValue('--wui-pitch-keyboard-width')).toBe('0px');
    const ruler = handle.element.querySelector('.wui-pitch-keyboard__ruler') as HTMLElement;
    expect(ruler.style.width).toBe('100%');
    expect(Number.parseFloat(ruler.style.minWidth)).toBe(0);
    expect((ruler.firstElementChild as HTMLElement).style.maxWidth).toBe(handle.key(84)!.style.width);
    expect(container.style.getPropertyValue('--wui-pitch-key-min-width')).toBe('80px');

    const held = handle.key(64)!;
    state = {...state, low: 61, high: 66};
    handle.update();
    expect(handle.board.children).toHaveLength(6);
    expect(handle.key(64)).toBe(held);
    expect(held.dataset.active).toBe('true');
    const blackStart = handle.key(61)!;
    const blackEnd = handle.key(66)!;
    expect(Number.parseFloat(blackStart.style.left) - Number.parseFloat(blackStart.style.width) / 2).toBeGreaterThanOrEqual(0);
    expect(Number.parseFloat(blackEnd.style.left) + Number.parseFloat(blackEnd.style.width) / 2).toBeLessThanOrEqual(100);
    handle.destroy();
  });

  it('skips scroll following and restores fixed geometry when remounted without fitting', () => {
    const observe = vi.fn();
    vi.stubGlobal('ResizeObserver', class {observe = observe; disconnect() {}});
    const unsubscribe = vi.fn();
    const container = host();
    const sibling = document.createElement('span');
    container.append(sibling);
    let state: KeyboardState = {low: 48, high: 84, marks: []};
    const binding = {snapshot: () => state, subscribe: () => unsubscribe};
    const fitted = mountKeyboard(container, binding, {fitToWidth: true, follow: 'active', whiteKeyWidth: 40});
    expect(observe).not.toHaveBeenCalled();
    Object.defineProperties(fitted.element, {clientWidth: {value: 240}, scrollWidth: {value: 1000}});
    Object.defineProperties(fitted.key(84)!, {offsetLeft: {value: 560}, offsetWidth: {value: 40}});
    state = {...state, marks: [{midi: 84}]};
    fitted.update();
    expect(fitted.element.scrollLeft).toBe(0);
    expect(fitted.element.hasAttribute('tabindex')).toBe(false);

    const fixed = mountKeyboard(container, binding, {fitToWidth: false, whiteKeyWidth: 40});
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(fitted.element.isConnected).toBe(false);
    expect(fixed.board.style.width).toBe('880px');
    expect(getComputedStyle(fixed.element).overflowX).toBe('auto');
    expect(fixed.key(84)!.dataset.active).toBe('true');
    expect(sibling.isConnected).toBe(true);
    fixed.destroy();
    fixed.destroy();
    expect(unsubscribe).toHaveBeenCalledTimes(2);
    expect(container.children).toHaveLength(1);
  });
});

describe('explicit fretboard geometry', () => {
  it.each(['horizontal', 'vertical'] as const)('uses exact fret and string spacing while keeping round dots (%s)', (orientation) => {
    let state: FretboardState = {orientation, strings: 6, fretCount: 5, firstFret: 0, marks: [{stringIndex: 1, fret: 2, label: 'B'}]};
    const handle = mountFretboard(host(), {snapshot: () => state}, {fretWidth: 44, stringSpacing: 20, stringWidth: 1.75, release: 0});
    const box = handle.svg.getAttribute('viewBox')!.split(' ').map(Number);
    const scaleX = Number.parseFloat(handle.svg.style.width) / box[2];
    const scaleY = Number.parseFloat(handle.svg.style.height) / box[3];
    expect(scaleX).toBeCloseTo(scaleY, 3);
    const fretAxis = orientation === 'horizontal' ? 'x1' : 'y1';
    const stringAxis = orientation === 'horizontal' ? 'y1' : 'x1';
    const wires = [...handle.svg.querySelectorAll('[data-fret].wui-pitch-fretboard__wire')];
    expect((Number(wires[1].getAttribute(fretAxis)) - Number(wires[0].getAttribute(fretAxis))) * scaleX).toBeCloseTo(44, 2);
    const strings = [...handle.svg.querySelectorAll('.wui-pitch-fretboard__string')];
    expect((Number(strings[1].getAttribute(stringAxis)) - Number(strings[0].getAttribute(stringAxis))) * scaleY).toBeCloseTo(20, 2);
    expect(strings.every((string) => string.getAttribute('stroke-width') === '1.75' && string.getAttribute('vector-effect') === 'non-scaling-stroke')).toBe(true);
    const dot = handle.dot(1, 2)!;
    const radius = dot.querySelector('circle')!.getAttribute('r');
    state = {...state, firstFret: 1};
    handle.update();
    expect(handle.dot(1, 2)).toBe(dot);
    expect(dot.querySelector('circle')!.getAttribute('r')).toBe(radius);
    handle.destroy();
  });

  it('ignores resize expansion for a requested fret width and releases observers', () => {
    const callbacks: ResizeObserverCallback[] = [];
    const disconnect = vi.fn();
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: ResizeObserverCallback) { callbacks.push(callback); }
      observe() {}
      disconnect = disconnect;
    });
    const handle = mountFretboard(host(), {snapshot: () => ({marks: []})}, {fretWidth: 35});
    const before = handle.svg.getAttribute('viewBox');
    for (const callback of callbacks) callback([{contentRect: {width: 1600, height: 190}} as ResizeObserverEntry], {} as ResizeObserver);
    expect(handle.svg.getAttribute('viewBox')).toBe(before);
    handle.destroy();
    expect(disconnect).toHaveBeenCalledTimes(2);
  });

  it('uses original responsive geometry for invalid dimensions while allowing a pixel string stroke alone', () => {
    const handle = mountFretboard(host(), {snapshot: () => ({marks: []})}, {fretWidth: 0, stringSpacing: NaN, stringWidth: 2});
    expect(handle.svg.style.height).toContain('--wui-pitch-fretboard-unit');
    expect(handle.svg.querySelector('.wui-pitch-fretboard__string')!.getAttribute('stroke-width')).toBe('2');
    expect(handle.svg.querySelector('.wui-pitch-fretboard__string')!.getAttribute('vector-effect')).toBe('non-scaling-stroke');
    handle.destroy();
  });

  it.each(['horizontal', 'vertical'] as const)('keeps outer-string circles and thick strings inside the frame at narrow spacing (%s)', (orientation) => {
    const handle = mountFretboard(host(), {snapshot: () => ({orientation, strings: 6, fretCount: 4, marks: [
      {stringIndex: 0, fret: 1, label: 'A'}, {stringIndex: 5, fret: 1, label: 'B'},
    ]})}, {fretWidth: 30, stringSpacing: 1, stringWidth: 4});
    const [left, top, width, height] = handle.svg.getAttribute('viewBox')!.split(' ').map(Number);
    const axis = orientation === 'horizontal' ? 'cy' : 'cx';
    const min = orientation === 'horizontal' ? top : left;
    const max = min + (orientation === 'horizontal' ? height : width);
    for (const string of [0, 5]) {
      const circle = handle.dot(string, 1)!.querySelector('circle')!;
      const centre = Number(circle.getAttribute(axis));
      const radius = Number(circle.getAttribute('r'));
      expect(centre - radius).toBeGreaterThanOrEqual(min);
      expect(centre + radius).toBeLessThanOrEqual(max);
    }
    const strings = [...handle.svg.querySelectorAll('.wui-pitch-fretboard__string')];
    const key = orientation === 'horizontal' ? 'y1' : 'x1';
    const scale = Number.parseFloat(handle.svg.style.height) / height;
    expect((Number(strings[1].getAttribute(key)) - Number(strings[0].getAttribute(key))) * scale).toBeCloseTo(1, 2);
    expect(Number(strings[0].getAttribute(key)) - 2 / scale).toBeGreaterThanOrEqual(min);
    expect(Number(strings[5].getAttribute(key)) + 2 / scale).toBeLessThanOrEqual(max);
    handle.destroy();
  });
});
