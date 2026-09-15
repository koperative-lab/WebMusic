// @vitest-environment jsdom

import {describe, expect, it, vi} from 'vitest';
import {createKnob, knobStyle} from '../src/knob';

/** jsdom has no PointerEvent; the kit's own suites synthesize one this way. */
function pointerEvent(type: string, clientX: number, clientY: number, pointerId: number): PointerEvent {
  const event = new MouseEvent(type, {bubbles: true, cancelable: true, clientX, clientY});
  Object.defineProperty(event, 'pointerId', {configurable: true, value: pointerId});
  return event as PointerEvent;
}

/** jsdom reports no layout, so the hit-test needs a rect of its own. */
function withRect(element: HTMLElement, size: number): void {
  element.getBoundingClientRect = () =>
    ({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: size,
      bottom: size,
      width: size,
      height: size,
      toJSON: () => ({}),
    }) as DOMRect;
}

describe('createKnob', () => {
  it('draws a labelled 0…1 dial from SVG, not a native range', () => {
    const knob = createKnob(document, {label: 'Channel volume', value: 0.25});

    expect(knob.element.querySelector('input')).toBeNull();
    expect(knob.element.className).toBe('wui-knob');
    expect(knob.element.getAttribute('role')).toBe('slider');
    expect(knob.element.getAttribute('aria-label')).toBe('Channel volume');
    expect(knob.element.getAttribute('aria-valuenow')).toBe('0.25');
    expect(knob.element.getAttribute('aria-valuetext')).toBe('25%');
    expect(knob.element.tabIndex).toBe(0);
    expect(knob.value).toBe(0.25);

    // Geometry is inline, so the dial is correct with no stylesheet at all.
    expect(knob.track.getAttribute('d')).toMatch(/^M /);
    expect(knob.arc.getAttribute('d')).toMatch(/^M /);
    expect(knob.element.style.border).toBe('');
    expect(knob.track.getAttribute('stroke')).toBe(
      'var(--wm-knob-track, var(--wm-surface-muted, #f3f3f3))',
    );
    expect(knob.pointer.getAttribute('stroke')).toBe(
      'var(--wm-knob-pointer, var(--wm-foreground, #111))',
    );
    // The pointer is a full radius: dead centre (18, 18) out to the rim.
    expect(knob.pointer.getAttribute('x1')).toBe('18');
    expect(knob.pointer.getAttribute('y1')).toBe('18');
    const tip = {
      x: Number(knob.pointer.getAttribute('x2')),
      y: Number(knob.pointer.getAttribute('y2')),
    };
    // Two decimals: the tip is written with `toFixed(2)`.
    expect(Math.hypot(tip.x - 18, tip.y - 18)).toBeCloseTo(18, 2);
    expect(knob.element.style.getPropertyValue('--wui-knob-value')).toBe('25.0%');

    knob.destroy();
  });

  it('reads a press by its ANGLE from the centre, not its height in the box', () => {
    const onInput = vi.fn();
    const knob = createKnob(document, {label: 'Volume', value: 0, onInput});
    withRect(knob.element, 40);

    // Twelve o'clock is the middle of a 270° sweep.
    knob.element.dispatchEvent(pointerEvent('pointerdown', 20, 0, 1));
    expect(onInput).toHaveBeenLastCalledWith(0.5);

    // Three o'clock is 90° round, five sixths of the way up.
    knob.element.dispatchEvent(pointerEvent('pointermove', 40, 20, 1));
    expect(onInput).toHaveBeenLastCalledWith(expect.closeTo(0.8333, 3));

    // Nine o'clock is the mirror of it.
    knob.element.dispatchEvent(pointerEvent('pointermove', 0, 20, 1));
    expect(onInput).toHaveBeenLastCalledWith(expect.closeTo(0.1667, 3));

    knob.destroy();
  });

  it('takes the keyboard through the shared slider lifecycle', () => {
    const onInput = vi.fn();
    const knob = createKnob(document, {label: 'Volume', value: 0.5, keyboardStep: 0.1, onInput});

    knob.element.dispatchEvent(new KeyboardEvent('keydown', {key: 'ArrowUp', bubbles: true}));
    expect(onInput).toHaveBeenLastCalledWith(0.6);

    knob.element.dispatchEvent(new KeyboardEvent('keydown', {key: 'Home', bubbles: true}));
    expect(onInput).toHaveBeenLastCalledWith(0);
    expect(knob.element.getAttribute('aria-valuenow')).toBe('0');

    knob.destroy();
  });

  it('repaints from the owner without echoing back through onInput', () => {
    const onInput = vi.fn();
    const knob = createKnob(document, {label: 'Volume', onInput});

    knob.paint(0.6);
    expect(knob.value).toBe(0.6);
    expect(knob.element.getAttribute('aria-valuenow')).toBe('0.6');
    expect(onInput).not.toHaveBeenCalled();

    knob.paint(0.6, true);
    expect(knob.element.getAttribute('aria-disabled')).toBe('true');
    knob.paint(0.6, false);
    expect(knob.element.getAttribute('aria-disabled')).toBe('false');

    knob.destroy();
  });

  it('clamps whatever it is painted with, so a bad level cannot poison the arc', () => {
    const knob = createKnob(document, {label: 'Volume', value: 4});
    expect(knob.value).toBe(1);

    knob.paint(-2);
    expect(knob.value).toBe(0);

    knob.paint(Number.NaN);
    expect(knob.value).toBe(0);

    knob.destroy();
  });

  it('takes compatibility classes and parts on all four nodes', () => {
    const knob = createKnob(document, {
      label: 'Volume',
      disabled: true,
      classNames: {root: 'host-knob', track: 'host-track', arc: 'host-arc', pointer: 'host-ptr'},
      parts: {root: 'volume', track: 'volume-track', arc: 'volume-arc', pointer: 'volume-ptr'},
    });

    expect(knob.element.className).toBe('wui-knob host-knob');
    expect(knob.element.getAttribute('part')).toBe('knob volume');
    expect(knob.track.getAttribute('part')).toBe('knob-track volume-track');
    expect(knob.arc.getAttribute('part')).toBe('knob-arc volume-arc');
    expect(knob.pointer.getAttribute('part')).toBe('knob-pointer volume-ptr');
    expect(knob.element.getAttribute('aria-disabled')).toBe('true');

    knob.destroy();
  });

  it('releases the slider behaviour on destroy', () => {
    const onInput = vi.fn();
    const knob = createKnob(document, {label: 'Volume', onInput});
    withRect(knob.element, 40);

    knob.destroy();
    knob.element.dispatchEvent(pointerEvent('pointerdown', 40, 20, 2));
    expect(onInput).not.toHaveBeenCalled();
  });

  it('carries only what inline geometry cannot express', () => {
    expect(knobStyle).toContain('.wui-knob:focus-visible');
    expect(knobStyle).toContain("[aria-disabled='true']");
  });
});
