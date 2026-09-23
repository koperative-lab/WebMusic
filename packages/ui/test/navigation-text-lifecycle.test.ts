// @vitest-environment jsdom

import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {mountMinimap} from '../src/minimap';
import {mountStatus} from '../src/status';
import {mountTimeline} from '../src/timeline';

interface Handle {
  element: HTMLElement;
  update(): void;
  destroy(): void;
}
interface Options {
  getText?: () => {label: string; loading: string};
  onError?: (error: unknown) => void;
}
type Subscribe = (notify: () => void) => () => void;

const handles: Handle[] = [];
const keep = <T extends Handle>(handle: T): T => { handles.push(handle); return handle; };
const host = (): HTMLElement => {
  const node = document.createElement('div');
  document.body.append(node);
  return node;
};
const cases = [
  {
    name: 'Timeline',
    mount: (target: HTMLElement, options: Options, subscribe?: Subscribe) => keep(mountTimeline(target, {
      snapshot: () => ({duration: 8, regions: []}), subscribe,
    }, options)),
    read: (handle: Handle) => handle.element.getAttribute('aria-label'),
  },
  {
    name: 'Status',
    mount: (target: HTMLElement, options: Options, subscribe?: Subscribe) => keep(mountStatus(target, {
      snapshot: () => ({kind: 'loading'}), subscribe,
    }, options)),
    read: (handle: Handle) => handle.element.textContent,
  },
  {
    name: 'Minimap',
    mount: (target: HTMLElement, options: Options, subscribe?: Subscribe) => keep(mountMinimap(target, {
      snapshot: () => ({minimum: 0, maximum: 100, start: 20, end: 40}), draw() {}, subscribe,
    }, options)),
    read: (handle: Handle) => handle.element.querySelector('[role="slider"]')?.getAttribute('aria-label'),
  },
];

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});
afterEach(() => {
  for (const handle of handles.splice(0)) handle.destroy();
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('navigation presenter text lifecycle', () => {
  it.each(cases)('$name keeps the latest reentrant text and bounds repeated refreshes', ({mount, read}) => {
    let label = 'Initial';
    let reenter = false;
    let repeat = false;
    const onError = vi.fn();
    const getText = vi.fn(() => {
      const previous = label;
      if (reenter) {
        reenter = repeat;
        label = 'Latest';
        handle?.update();
      }
      return {label: previous, loading: previous};
    });
    const handle: Handle = mount(host(), {getText, onError});
    getText.mockClear();
    reenter = true;
    handle.update();
    expect(getText).toHaveBeenCalledTimes(2);
    expect(read(handle)).toBe('Latest');
    expect(onError).not.toHaveBeenCalled();

    getText.mockClear();
    repeat = reenter = true;
    handle.update();
    expect(getText.mock.calls.length).toBeLessThanOrEqual(40);
    expect(onError).toHaveBeenCalledOnce();
    expect(onError.mock.calls[0]![0].message).toContain('update did not stabilize');

    repeat = reenter = false;
    label = 'Recovered';
    handle.update();
    expect(read(handle)).toBe('Recovered');
  });

  it.each(cases)('$name does not subscribe after text replaces the initial mount', ({mount, read}) => {
    const target = host();
    const subscribe = vi.fn(() => vi.fn());
    let replacement: Handle | undefined;
    const stale = mount(target, {getText: () => {
      replacement = mount(target, {getText: () => ({label: 'Replacement', loading: 'Replacement'})});
      return {label: 'Stale', loading: 'Stale'};
    }}, subscribe);
    expect(subscribe).not.toHaveBeenCalled();
    stale.update();
    stale.destroy();
    expect(replacement?.element.parentElement).toBe(target);
    expect(read(replacement!)).toBe('Replacement');
  });

  it.each(cases)('$name releases a subscription returned after synchronous replacement', ({mount}) => {
    const target = host();
    const release = vi.fn();
    let replacement: Handle | undefined;
    const stale = mount(target, {}, () => {
      replacement = mount(target, {});
      return release;
    });
    expect(release).toHaveBeenCalledOnce();
    stale.destroy();
    expect(release).toHaveBeenCalledOnce();
    expect(replacement?.element.parentElement).toBe(target);
  });

  it('coalesces a Minimap brush gesture with an external text refresh', () => {
    let reenter = false;
    let label = 'Initial';
    const setRange = vi.fn();
    const handle = keep(mountMinimap(host(), {
      snapshot: () => ({minimum: 0, maximum: 100, start: 20, end: 40}), draw() {}, setRange,
    }, {getText: () => {
      const previous = label;
      if (reenter) { reenter = false; label = 'Latest'; handle.update(); }
      return {label: previous};
    }}));
    reenter = true;
    handle.brush.dispatchEvent(new KeyboardEvent('keydown', {key: 'ArrowRight', bubbles: true}));
    expect(handle.brush.getAttribute('aria-label')).toBe('Latest');
    expect(handle.brush.getAttribute('aria-valuenow')).toBe('25');
    expect(setRange).toHaveBeenCalledExactlyOnceWith(25, 45);
  });
});
