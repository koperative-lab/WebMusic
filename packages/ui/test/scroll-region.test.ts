// @vitest-environment jsdom
import {afterEach, describe, expect, it} from 'vitest';
import {mountScrollRegion} from '../src/stage';

afterEach(() => document.body.replaceChildren());

describe('native scroll region ownership', () => {
  it('provides one named keyboard stop without replacing content or taking scroll position', () => {
    const viewport = document.createElement('div');
    const content = document.createElement('div');
    viewport.append(content); document.body.append(viewport);
    viewport.scrollTop = 120; viewport.scrollLeft = 45;
    const handle = mountScrollRegion(viewport, {label: 'Score time window', hideScrollbar: true});
    expect(handle.element).toBe(viewport);
    expect(viewport.getAttribute('role')).toBe('region');
    expect(viewport.getAttribute('aria-label')).toBe('Score time window');
    expect(viewport.tabIndex).toBe(0);
    viewport.focus(); expect(document.activeElement).toBe(viewport);
    expect(viewport.scrollTop).toBe(120); expect(viewport.scrollLeft).toBe(45);
    const style = viewport.querySelector('style')!;
    expect(style.textContent).toContain('scrollbar-width: none');
    expect(style.textContent).toContain('::-webkit-scrollbar');
    handle.destroy(); handle.destroy();
    expect(viewport.hasAttribute('tabindex')).toBe(false);
    expect(viewport.hasAttribute('role')).toBe(false);
    expect(viewport.hasAttribute('aria-label')).toBe(false);
    expect([...viewport.children]).toEqual([content]);
    expect(viewport.className).toBe('');
    expect(viewport.scrollTop).toBe(120); expect(viewport.scrollLeft).toBe(45);
  });

  it('preserves authored focus and naming, including changes while mounted', () => {
    const viewport = document.createElement('div');
    viewport.setAttribute('tabindex', '-1'); viewport.setAttribute('role', 'group');
    viewport.setAttribute('aria-labelledby', 'track-heading');
    const handle = mountScrollRegion(viewport, {label: 'Unused fallback'});
    expect(viewport.getAttribute('tabindex')).toBe('-1');
    expect(viewport.getAttribute('role')).toBe('group');
    expect(viewport.hasAttribute('aria-label')).toBe(false);
    expect(viewport.querySelector('style')).toBeNull();
    handle.destroy();
    expect(viewport.getAttribute('aria-labelledby')).toBe('track-heading');
    expect(viewport.getAttribute('tabindex')).toBe('-1');
    viewport.removeAttribute('tabindex'); viewport.removeAttribute('role');
    const next = mountScrollRegion(viewport, {label: 'Time window'});
    viewport.setAttribute('tabindex', '2'); viewport.setAttribute('role', 'navigation');
    next.destroy();
    expect(viewport.getAttribute('tabindex')).toBe('2');
    expect(viewport.getAttribute('role')).toBe('navigation');
  });

  it('releases an old mount before replacement and leaves the replacement intact on repeated cleanup', () => {
    const viewport = document.createElement('div');
    const first = mountScrollRegion(viewport, {label: 'First', hideScrollbar: true});
    const second = mountScrollRegion(viewport, {label: 'Second'});
    expect(viewport.querySelector('style')).toBeNull();
    expect(viewport.getAttribute('aria-label')).toBe('Second');
    first.destroy();
    expect(viewport.getAttribute('tabindex')).toBe('0');
    expect(viewport.getAttribute('aria-label')).toBe('Second');
    second.destroy();
    expect(viewport.hasAttribute('tabindex')).toBe(false);
    expect(viewport.hasAttribute('aria-label')).toBe(false);
  });
});
