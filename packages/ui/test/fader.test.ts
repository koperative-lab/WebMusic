// @vitest-environment jsdom

import {describe, expect, it, vi} from 'vitest';
import {createFader, faderStyle} from '../src/fader';

/** jsdom has no PointerEvent; the kit's own suites synthesize one this way. */
function pointerEvent(type: string, clientX: number, clientY: number, pointerId: number): PointerEvent {
  const event = new MouseEvent(type, {bubbles: true, cancelable: true, clientX, clientY});
  Object.defineProperty(event, 'pointerId', {configurable: true, value: pointerId});
  return event as PointerEvent;
}

/** jsdom reports no layout, so the hit-test needs a rect of its own. */
function withRect(element: HTMLElement, rect: {width: number; height: number}): void {
  element.getBoundingClientRect = () =>
    ({x: 0, y: 0, top: 0, left: 0, right: rect.width, bottom: rect.height, ...rect, toJSON: () => ({})}) as DOMRect;
}

describe('createFader', () => {
  it('draws a labelled 0…1 slider from plain elements, not a native range', () => {
    const fader = createFader(document, {label: 'Channel volume', value: 0.25});

    // A native input's handle can only be styled through pseudo-elements, which
    // a stylesheet-less host cannot reach — hence real nodes.
    expect(fader.element.querySelector('input')).toBeNull();
    expect(fader.element.className).toBe('wui-fader');
    expect(fader.element.getAttribute('role')).toBe('slider');
    expect(fader.element.getAttribute('aria-label')).toBe('Channel volume');
    expect(fader.element.getAttribute('aria-orientation')).toBe('vertical');
    expect(fader.element.getAttribute('aria-valuenow')).toBe('0.25');
    expect(fader.element.getAttribute('aria-valuetext')).toBe('25%');
    expect(fader.element.tabIndex).toBe(0);
    expect(fader.value).toBe(0.25);

    // Geometry is inline, so the control is correct with no stylesheet at all.
    expect(fader.fill.style.height).toBe('25%');
    expect(fader.fill.style.position).toBe('absolute');
    expect(fader.element.style.getPropertyValue('--wui-fader-fill')).toBe('25.0%');
    expect(fader.thumb.style.bottom).toContain('25.0%');
    expect(fader.element.style.border).toBe(
      '1px solid var(--wm-fader-track-border, transparent)',
    );
    expect(fader.element.style.border).not.toContain('#111');

    fader.destroy();
  });

  it('commits a pointer move against the track it was drawn in', () => {
    const onInput = vi.fn();
    const fader = createFader(document, {label: 'Volume', orientation: 'horizontal', value: 0, onInput});
    withRect(fader.element, {width: 200, height: 14});

    expect(fader.element.className).toBe('wui-fader wui-fader--horizontal');
    expect(fader.element.getAttribute('aria-orientation')).toBe('horizontal');

    fader.element.dispatchEvent(pointerEvent('pointerdown', 150, 7, 1));

    expect(onInput).toHaveBeenCalledTimes(1);
    expect(onInput).toHaveBeenCalledWith(0.75);
    expect(fader.value).toBe(0.75);
    expect(fader.fill.style.width).toBe('75%');

    fader.destroy();
  });

  it('takes the keyboard through the shared slider lifecycle', () => {
    const onInput = vi.fn();
    const fader = createFader(document, {label: 'Volume', value: 0.5, keyboardStep: 0.1, onInput});

    fader.element.dispatchEvent(new KeyboardEvent('keydown', {key: 'ArrowUp', bubbles: true}));
    expect(onInput).toHaveBeenLastCalledWith(0.6);

    fader.element.dispatchEvent(new KeyboardEvent('keydown', {key: 'Home', bubbles: true}));
    expect(onInput).toHaveBeenLastCalledWith(0);
    expect(fader.element.getAttribute('aria-valuenow')).toBe('0');

    fader.destroy();
  });

  it('repaints from the owner without echoing back through onInput', () => {
    const onInput = vi.fn();
    const fader = createFader(document, {label: 'Volume', onInput});

    fader.paint(0.6);
    expect(fader.value).toBe(0.6);
    expect(fader.element.getAttribute('aria-valuenow')).toBe('0.6');
    expect(onInput).not.toHaveBeenCalled();

    fader.paint(0.6, true);
    expect(fader.element.getAttribute('aria-disabled')).toBe('true');
    fader.paint(0.6, false);
    expect(fader.element.getAttribute('aria-disabled')).toBe('false');

    fader.destroy();
  });

  it('clamps whatever it is painted with, so a bad level cannot poison the track', () => {
    const fader = createFader(document, {label: 'Volume', value: 4});
    expect(fader.value).toBe(1);

    fader.paint(-2);
    expect(fader.value).toBe(0);
    expect(fader.fill.style.height).toBe('0%');

    fader.paint(Number.NaN);
    expect(fader.value).toBe(0);

    fader.destroy();
  });

  it('takes compatibility classes and parts on all three nodes', () => {
    const fader = createFader(document, {
      label: 'Volume',
      orientation: 'horizontal',
      disabled: true,
      classNames: {root: 'host-volume', fill: 'host-fill', thumb: 'host-thumb'},
      parts: {root: 'volume', fill: 'volume-fill', thumb: 'volume-thumb'},
    });

    expect(fader.element.className).toBe('wui-fader wui-fader--horizontal host-volume');
    expect(fader.element.getAttribute('part')).toBe('fader volume');
    expect(fader.fill.className).toBe('wui-fader__fill host-fill');
    expect(fader.fill.getAttribute('part')).toBe('fader-fill volume-fill');
    expect(fader.thumb.getAttribute('part')).toBe('fader-thumb volume-thumb');
    expect(fader.element.getAttribute('aria-disabled')).toBe('true');

    fader.destroy();
  });

  it('releases the slider behaviour on destroy', () => {
    const onInput = vi.fn();
    const fader = createFader(document, {label: 'Volume', orientation: 'horizontal', onInput});
    withRect(fader.element, {width: 100, height: 14});

    fader.destroy();
    fader.element.dispatchEvent(pointerEvent('pointerdown', 50, 7, 2));
    expect(onInput).not.toHaveBeenCalled();
  });

  it('carries only what inline geometry cannot express', () => {
    // Colour and size are tokens on the nodes themselves; the sheet is just the
    // focus ring and the disabled affordance.
    expect(faderStyle).toContain('.wui-fader:focus-visible');
    expect(faderStyle).toContain("[aria-disabled='true']");
  });
});
