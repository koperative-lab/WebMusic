// @vitest-environment jsdom

import {afterEach, describe, expect, it, vi} from 'vitest';
import {
  formatControlNumber, mountButton, mountMappingOverlay, mountNodes, mountPresetGrid, mountDial, mountMatrix, mountMenu, mountMessage, mountMultislider, mountNumber,
  mountSlider, mountTabs, mountToggle,
} from '../src/controls';

afterEach(() => { document.body.replaceChildren(); vi.useRealTimers(); });

function host(): HTMLElement {
  const element = document.createElement('div');
  document.body.append(element);
  return element;
}

/** A tiny observable store, as a caller would bind. */
function store<T>(initial: T) {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set: (next: T) => { value = next; for (const listener of listeners) listener(); },
    subscribe: (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener); },
  };
}

const key = (target: Element, name: string, init: KeyboardEventInit = {}) =>
  target.dispatchEvent(new KeyboardEvent('keydown', {key: name, bubbles: true, cancelable: true, ...init}));

describe('single-value controls', () => {
  it('button presses, flashes and follows an active state', () => {
    vi.useFakeTimers();
    const press = vi.fn();
    const handle = mountButton(host(), {snapshot: () => ({active: false}), press}, {flashMs: 50});
    const button = handle.element.querySelector('button')!;
    expect(button.getAttribute('aria-label')).toBe('Bang');
    button.click();
    expect(press).toHaveBeenCalledOnce();
    expect(button.dataset.flash).toBe('true');
    vi.advanceTimersByTime(60);
    expect(button.dataset.flash).toBeUndefined();
    handle.flash();
    expect(button.dataset.flash).toBe('true');
    handle.destroy();
    expect(handle.element.isConnected).toBe(false);
  });

  it('toggle inverts and draws a cross when on', () => {
    const state = store({on: false});
    const handle = mountToggle(host(), {snapshot: () => state.get(), setOn: on => state.set({on}), subscribe: state.subscribe}, {label: 'Run'});
    const button = handle.element.querySelector('button')!;
    button.click();
    expect(button.getAttribute('aria-pressed')).toBe('true');
    expect(button.querySelector('svg')).not.toBeNull();
    button.click();
    expect(button.getAttribute('aria-pressed')).toBe('false');
  });

  it('number box steps with keys, takes typed values and clamps', () => {
    const state = store({value: 5, min: 0, max: 10});
    const handle = mountNumber(host(), {snapshot: () => state.get(), setValue: value => state.set({...state.get(), value}), subscribe: state.subscribe});
    const field = handle.element.querySelector('input')!;
    expect(field.getAttribute('role')).toBe('spinbutton');
    key(field, 'ArrowUp');
    key(field, 'PageUp');
    expect(state.get().value).toBe(10);
    field.focus();
    key(field, '3');
    field.value = '3.7';
    key(field, 'Enter');
    expect(state.get().value).toBe(4);
    expect(field.value).toBe('4');
    expect(field.getAttribute('aria-valuemax')).toBe('10');
    expect(formatControlNumber(0.5, true)).toBe('0.5');
    expect(formatControlNumber(2, true)).toBe('2.0');
  });

  it('slider and dial map their 0…1 control onto the value range and speak the value', () => {
    const state = store({value: 64, min: 0, max: 127});
    const binding = {snapshot: () => state.get(), setValue: (value: number) => state.set({...state.get(), value}), subscribe: state.subscribe};
    const slider = mountSlider(host(), binding);
    const dial = mountDial(host(), binding, {label: 'Cutoff'});
    const fader = slider.element.querySelector<HTMLElement>('.wui-fader')!;
    key(fader, 'End');
    expect(state.get().value).toBe(127);
    expect(fader.getAttribute('aria-valuetext')).toBe('127');
    expect(dial.element.querySelector('.wui-control__readout')!.textContent).toBe('127');
    const knob = dial.element.querySelector<HTMLElement>('.wui-knob')!;
    expect(knob.getAttribute('aria-label')).toBe('Cutoff');
    key(knob, 'Home');
    expect(state.get().value).toBe(0);
  });

  it('a dial turns by dragging: up raises the value, and a press alone sends nothing', () => {
    const state = store({value: 0, min: 0, max: 160});
    const setValue = vi.fn((value: number) => state.set({...state.get(), value}));
    const dial = mountDial(host(), {snapshot: () => state.get(), setValue, subscribe: state.subscribe});
    const knob = dial.element.querySelector<HTMLElement>('.wui-knob')!;
    const pointer = (type: string, clientX: number, clientY: number) => {
      const event = new MouseEvent(type, {bubbles: true, cancelable: true, clientX, clientY});
      Object.defineProperty(event, 'pointerId', {configurable: true, value: 1});
      knob.dispatchEvent(event);
    };
    pointer('pointerdown', 10, 100);
    pointer('pointerup', 10, 100);
    expect(setValue).not.toHaveBeenCalled();
    // Forty pixels up is a quarter of the range: the whole range takes 160 px.
    pointer('pointerdown', 10, 100);
    pointer('pointermove', 10, 60);
    expect(state.get().value).toBe(40);
    pointer('pointermove', 10, 120);
    expect(state.get().value).toBe(0);
    pointer('pointerup', 10, 120);
    expect(dial.element.querySelector('.wui-control__readout')!.textContent).toBe('0');
  });

  it('fills its host when asked to, and keeps its natural size otherwise', () => {
    const state = store({value: 0, min: 0, max: 127});
    const range = {snapshot: () => state.get(), setValue: (value: number) => state.set({...state.get(), value}), subscribe: state.subscribe};
    const natural = mountToggle(host(), {snapshot: () => ({on: false}), setOn: () => {}});
    expect(natural.element.dataset.fill).toBeUndefined();
    const filling = [
      mountToggle(host(), {snapshot: () => ({on: true}), setOn: () => {}}, {fill: true}),
      mountSlider(host(), range, {fill: true}),
      mountDial(host(), range, {fill: true}),
      mountMatrix(host(), {snapshot: () => ({columns: 3, rows: 2, cells: [0, 0, 0, 0, 0, 0]}), setCell: () => {}}, {fill: true}),
      mountPresetGrid(host(), {snapshot: () => ({count: 4, stored: [], current: 0}), recall: () => {}, store: () => {}}, {fill: true}),
    ];
    for (const control of filling) expect(control.element.dataset.fill).toBe('true');
    // The knob gives up its own size; a matrix and a short preset grid share the host between their cells.
    const knob = filling[2]!.element.querySelector<HTMLElement>('.wui-knob')!;
    expect([knob.style.width, knob.style.height, knob.style.flexGrow]).toEqual(['100%', 'auto', '1']);
    expect(filling[3]!.element.style.gridTemplateColumns).toBe('repeat(3, minmax(0, 1fr))');
    expect(filling[4]!.element.style.getPropertyValue('--wui-preset-columns')).toBe('4');
    expect(mountMatrix(host(), {snapshot: () => ({columns: 3, rows: 2, cells: []}), setCell: () => {}}).element.style.gridTemplateColumns).toBe('repeat(3, auto)');
  });

  it('an automatic slider stands upright when it is taller than wide, and keeps the value', () => {
    let observed: (() => void) | undefined;
    const disconnect = vi.fn();
    vi.stubGlobal('ResizeObserver', class { constructor(callback: () => void) { observed = callback; } observe(): void {} disconnect = disconnect; });
    try {
      const state = store({value: 32, min: 0, max: 127});
      const slider = mountSlider(host(), {snapshot: () => state.get(), setValue: (value: number) => state.set({...state.get(), value}), subscribe: state.subscribe}, {fill: true, orientation: 'auto'});
      const size = (width: number, height: number) => {
        Object.defineProperty(slider.element, 'clientWidth', {configurable: true, value: width});
        Object.defineProperty(slider.element, 'clientHeight', {configurable: true, value: height});
        observed!();
      };
      expect(slider.element.querySelector('.wui-fader--horizontal')).not.toBeNull();
      size(48, 160);
      const upright = slider.element.querySelector<HTMLElement>('.wui-fader')!;
      expect(upright.classList.contains('wui-fader--horizontal')).toBe(false);
      expect(slider.element.dataset.orientation).toBe('vertical');
      expect(slider.element.querySelectorAll('.wui-fader')).toHaveLength(1);
      expect(upright.getAttribute('aria-valuetext')).toBe('32');
      key(upright, 'End');
      expect(state.get().value).toBe(127);
      // An empty size, before layout, turns nothing.
      size(0, 0);
      expect(slider.element.dataset.orientation).toBe('vertical');
      size(160, 48);
      expect(slider.element.querySelector('.wui-fader--horizontal')).not.toBeNull();
      expect(slider.element.dataset.orientation).toBeUndefined();
      slider.destroy();
      expect(disconnect).toHaveBeenCalledTimes(1);
    } finally { vi.unstubAllGlobals(); }
  });

  it('message box shows its text and presses', () => {
    const press = vi.fn();
    const handle = mountMessage(host(), {snapshot: () => ({text: 'set 3, 440'}), press});
    const button = handle.element.querySelector('button')!;
    expect(button.textContent).toBe('set 3, 440');
    button.click();
    expect(press).toHaveBeenCalledOnce();
  });

  it('menu opens an adjustment card over a scrim, and steps in place without one', () => {
    const state = store({items: ['low', 'mid', 'high'], index: 0});
    const binding = {snapshot: () => state.get(), select: (index: number) => state.set({...state.get(), index}), subscribe: state.subscribe};
    const stepping = mountMenu(host(), binding, {label: 'Range'});
    const trigger = stepping.element.querySelector('button')!;
    trigger.click();
    expect(state.get().index).toBe(1);
    key(trigger, 'ArrowUp');
    expect(state.get().index).toBe(0);
    expect(trigger.getAttribute('aria-label')).toBe('Range: low');

    const window = host();
    const carded = mountMenu(host(), binding, {label: 'Range', cardHost: window});
    const open = carded.element.querySelector('button')!;
    open.click();
    const dialog = window.querySelector('[role="dialog"]')!;
    expect(window.querySelector('.wui-control__scrim')).not.toBeNull();
    expect(document.activeElement?.textContent).toBe('low');
    key(dialog, 'Escape');
    expect(window.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(open);
    open.click();
    (window.querySelectorAll<HTMLButtonElement>('[role="option"]')[2]!).click();
    expect(state.get().index).toBe(2);
    expect(window.querySelector('[role="dialog"]')).toBeNull();
  });

  it('tabs are a radio group with the current cell inverted', () => {
    const state = store({items: ['a', 'b', 'c'], index: 1});
    const handle = mountTabs(host(), {snapshot: () => state.get(), select: index => state.set({...state.get(), index}), subscribe: state.subscribe});
    const cells = [...handle.element.querySelectorAll('button')];
    expect(cells.map(cell => cell.getAttribute('aria-checked'))).toEqual(['false', 'true', 'false']);
    key(cells[1]!, 'ArrowRight');
    expect(state.get().index).toBe(2);
    cells[0]!.click();
    expect(state.get().index).toBe(0);
  });

  it('multislider sets a bar from the keyboard and reports its values', () => {
    const state = store({values: [0, 5, 10], min: 0, max: 10});
    const handle = mountMultislider(host(), {snapshot: () => state.get(), setValues: values => state.set({...state.get(), values: [...values]}), subscribe: state.subscribe});
    const bars = [...handle.element.querySelectorAll<HTMLElement>('[role="slider"]')];
    expect(bars).toHaveLength(3);
    key(bars[0]!, 'ArrowUp');
    expect(state.get().values).toEqual([1, 5, 10]);
    expect(bars[2]!.querySelector<HTMLElement>('.wui-control__bar-fill')!.style.height).toBe('100%');
  });

  it('matrix toggles cells and moves with the arrow keys', () => {
    const state = store({columns: 2, rows: 2, cells: [0, 0, 0, 0]});
    const handle = mountMatrix(host(), {snapshot: () => state.get(), subscribe: state.subscribe,
      setCell: (column, row, on) => { const cells = [...state.get().cells]; cells[row * 2 + column] = on ? 1 : 0; state.set({...state.get(), cells}); }});
    const cells = [...handle.element.querySelectorAll('button')];
    cells[3]!.click();
    expect(state.get().cells).toEqual([0, 0, 0, 1]);
    expect(cells[3]!.getAttribute('aria-pressed')).toBe('true');
    cells[0]!.focus();
    key(cells[0]!, 'ArrowRight');
    expect(document.activeElement).toBe(cells[1]);
  });

  it('reports a failing command and replaces a control mounted on the same host', () => {
    const errors: unknown[] = [];
    const element = host();
    const first = mountToggle(element, {snapshot: () => ({on: false}), setOn: () => { throw new Error('nope'); }}, {onError: error => errors.push(error)});
    first.element.querySelector('button')!.click();
    expect(String(errors[0])).toMatch(/nope/);
    mountButton(element, {snapshot: () => ({}), press: () => {}});
    expect(first.element.isConnected).toBe(false);
    expect(element.querySelectorAll('.wui-control')).toHaveLength(1);
    const bare = host();
    mountButton(bare, {snapshot: () => ({}), press: () => {}}, {stylesheet: false});
    expect(bare.querySelector('style')).toBeNull();
  });

  it('preset grid recalls stored slots, stores with Shift and clears with Alt', () => {
    const calls: string[] = [];
    const handle = mountPresetGrid(host(), {snapshot: () => ({count: 4, stored: [2], current: 2}),
      recall: slot => calls.push(`recall ${slot}`), store: slot => calls.push(`store ${slot}`), clear: slot => calls.push(`clear ${slot}`)});
    const cells = [...handle.element.querySelectorAll('button')];
    expect(cells.map(cell => cell.dataset.stored)).toEqual(['false', 'true', 'false', 'false']);
    expect(cells[1]!.getAttribute('aria-pressed')).toBe('true');
    cells[1]!.click();
    cells[0]!.click();
    cells[1]!.dispatchEvent(new MouseEvent('click', {shiftKey: true, bubbles: true}));
    cells[1]!.dispatchEvent(new MouseEvent('click', {altKey: true, bubbles: true}));
    key(cells[2]!, 'Enter', {shiftKey: true});
    expect(calls).toEqual(['recall 2', 'store 1', 'store 2', 'clear 2', 'store 3']);
  });

  it('nodes moves the cursor from the keyboard and shows each weight', () => {
    const state = store({nodes: [{x: 0.25, y: 0.5, radius: 0.5}, {x: 0.75, y: 0.5, radius: 0.5}], cursor: {x: 0.5, y: 0.5}, weights: [0.5, 0.5]});
    const handle = mountNodes(host(), {snapshot: () => state.get(), subscribe: state.subscribe,
      setCursor: (x, y) => state.set({...state.get(), cursor: {x, y}, weights: [1 - x, x]})});
    const pad = handle.element.querySelector<HTMLElement>('[role="slider"]')!;
    key(pad, 'ArrowLeft', {shiftKey: true});
    expect(state.get().cursor.x).toBeCloseTo(0.4);
    expect(pad.getAttribute('aria-valuetext')).toMatch(/node 1 60%, node 2 40%/);
    expect(handle.element.querySelectorAll('circle')).toHaveLength(2);
  });

  it('mapping overlay outlines targets only while active and learns or unmaps them', () => {
    const window = host();
    const target = document.createElement('button');
    window.append(target);
    const state = store({active: false, targets: [{id: 'f', label: 'Cutoff', element: target, mapped: 'CC 74'}], learning: undefined as string | undefined});
    const calls: string[] = [];
    const handle = mountMappingOverlay(window, {snapshot: () => state.get(), subscribe: state.subscribe,
      learn: id => { calls.push(`learn ${id}`); state.set({...state.get(), learning: id}); }, unmap: id => calls.push(`unmap ${id}`)});
    expect(handle.element.hidden).toBe(true);
    state.set({...state.get(), active: true});
    const outline = handle.element.querySelector<HTMLButtonElement>('[data-target="f"]')!;
    expect(outline.getAttribute('aria-label')).toBe('Cutoff, mapped to CC 74');
    outline.click();
    const learning = handle.element.querySelector<HTMLButtonElement>('[data-target="f"]')!;
    expect(learning.getAttribute('aria-pressed')).toBe('true');
    key(learning, 'Delete');
    expect(calls).toEqual(['learn f', 'unmap f']);
  });
});
