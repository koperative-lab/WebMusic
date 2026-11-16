import {
  mountButton, mountDial, mountMatrix, mountMenu, mountMessage, mountMultislider, mountNumber, mountSlider, mountTabs, mountToggle,
  type ButtonHandle, type ControlHandle, type ControlOptions,
} from '@webmusic/ui/controls';
import type {UiPresenterDemoHandle} from './types';

/**
 * This reference page shows the ten controls over one caller-owned store, the
 * way a component's objects drive them: the button and message box flash the
 * toggle, and every value the controls set is read back from the store.
 */
export function mountControlsDemo(host: HTMLElement): UiPresenterDemoHandle {
  const initial = () => ({
    on: false, number: 64, slider: 64, dial: 0.5, text: '0.5', index: 1,
    values: [0.2, 0.6, 0.4, 0.9, 0.3, 0.7, 0.5, 0.1], cells: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
  });
  let state = initial();
  let options: ControlOptions = {};
  let destroyed = false;
  const listeners = new Set<() => void>();
  const notify = () => { for (const listener of [...listeners]) listener(); };
  const subscribe = (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener); };
  const set = (patch: Partial<typeof state>) => { state = {...state, ...patch}; notify(); };
  const grid = document.createElement('div');
  grid.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fill,minmax(9rem,1fr));gap:.5rem;align-items:start;position:relative';
  host.append(grid);
  let handles: ControlHandle[] = [];
  const slot = () => { const element = document.createElement('div'); grid.append(element); return element; };
  const mount = () => {
    for (const handle of handles) handle.destroy();
    grid.replaceChildren();
    const button: ButtonHandle = mountButton(slot(), {snapshot: () => ({}), press: () => set({on: !state.on})}, options);
    handles = [
      button,
      mountToggle(slot(), {snapshot: () => ({on: state.on}), setOn: on => set({on}), subscribe}, options),
      mountNumber(slot(), {snapshot: () => ({value: state.number, min: 0, max: 127}), setValue: number => set({number}), subscribe}, options),
      mountSlider(slot(), {snapshot: () => ({value: state.slider, min: 0, max: 127}), setValue: slider => set({slider}), subscribe}, options),
      mountDial(slot(), {snapshot: () => ({value: state.dial, min: 0, max: 1, float: true}), setValue: dial => set({dial, text: dial.toFixed(2)}), subscribe}, options),
      mountMessage(slot(), {snapshot: () => ({text: state.text}), press: () => button.flash(), subscribe}, options),
      mountMenu(slot(), {snapshot: () => ({items: ['sine', 'square', 'sawtooth', 'triangle'], index: state.index}), select: index => set({index}), subscribe},
        {...options, cardHost: grid}),
      mountTabs(slot(), {snapshot: () => ({items: ['1', '2', '3', '4'], index: state.index}), select: index => set({index}), subscribe}, options),
      mountMultislider(slot(), {snapshot: () => ({values: state.values, min: 0, max: 1, float: true}), setValues: values => set({values: [...values]}), subscribe}, options),
      mountMatrix(slot(), {snapshot: () => ({columns: 4, rows: 4, cells: state.cells}), subscribe,
        setCell: (column, row, on) => { const cells = [...state.cells]; cells[row * 4 + column] = on ? 1 : 0; set({cells}); }}, options),
    ];
  };
  mount();
  return {
    setOption(name, value) {
      if (destroyed) return;
      if (name === 'label') options = {...options, label: typeof value === 'string' && value ? value : undefined};
      else if (name === 'stylesheet') options = {...options, stylesheet: typeof value === 'boolean' ? value : undefined};
      else return;
      mount();
    },
    reset() {
      if (destroyed) return;
      options = {}; state = initial(); mount(); notify();
    },
    snapshot: () => ({on: state.on, number: state.number, slider: state.slider, index: state.index}),
    subscribe,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      for (const handle of handles) handle.destroy();
      grid.remove();
      listeners.clear();
    },
  };
}
