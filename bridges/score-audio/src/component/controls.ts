// The UI Kit control of an interface object (DEC-078), bound to the object's
// interface from the Kernel (`objectInterfaceOf`). A rebuild of the graph
// creates a new object instance; `refresh` moves the binding to it without
// remounting the control, so a value being dragged is never replaced.

import {bang, floatAtom, floatMessage, intAtom, intMessage, message, parseMessage, type Message} from '@webmusic/kernel/module';
import type {ObjectInterface} from '@webmusic/kernel/objects';
import {
  mountButton, mountDial, mountMatrix, mountMenu, mountMessage, mountMultislider, mountNodes, mountNumber, mountPresetGrid, mountSlider,
  mountTabs, mountToggle,
  type ButtonHandle, type ControlHandle,
} from '@webmusic/ui/controls';

type Snapshot = Record<string, unknown>;

export interface ObjectControl {
  /** Bind to the object's current interface (or none, while it is unresolved). */
  refresh(next: ObjectInterface | undefined): void;
  destroy(): void;
}

const number = (value: unknown, fallback = 0) => typeof value === 'number' && Number.isFinite(value) ? value : fallback;
const bound = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : undefined;
const numberMessage = (value: number, float: boolean): Message => float ? floatMessage(value) : intMessage(Math.round(value));

/** The interface objects that have a control. */
export const CONTROL_OBJECTS: readonly string[] = Object.freeze(['button', 'toggle', 'number', 'slider', 'dial', 'message', 'menu', 'tab', 'multislider', 'matrix', 'preset', 'nodes']);

/** Mount the control for object `name` into `host`. */
export function mountObjectControl(host: HTMLElement, name: string, options: {cardHost?: HTMLElement; label: string; onError?: (error: unknown) => void}): ObjectControl {
  let iface: ObjectInterface | undefined;
  let release: (() => void) | undefined;
  const listeners = new Set<() => void>();
  const snapshot = (): Snapshot => {
    const value = iface?.snapshot();
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Snapshot : {};
  };
  const send = (value: Message) => iface?.interact(value);
  const subscribe = (notify: () => void) => { listeners.add(notify); return () => { listeners.delete(notify); }; };
  const disabled = () => !iface;
  const common = {label: options.label, onError: options.onError ?? ((error: unknown) => console.error(error))};
  let flashes = 0;
  let handle: ControlHandle;

  switch (name) {
    case 'button':
      handle = mountButton(host, {snapshot: () => ({disabled: disabled()}), press: () => send(bang()), subscribe}, common);
      break;
    case 'toggle':
      handle = mountToggle(host, {snapshot: () => ({on: snapshot().on === true, disabled: disabled()}), setOn: on => send(intMessage(on ? 1 : 0)), subscribe}, common);
      break;
    case 'number':
      handle = mountNumber(host, {snapshot: () => {
        const state = snapshot();
        return {value: number(state.value), min: bound(state.min), max: bound(state.max), float: state.float === true, disabled: disabled()};
      }, setValue: value => send(numberMessage(value, snapshot().float === true)), subscribe}, common);
      break;
    case 'slider':
    case 'dial': {
      const mount = name === 'slider' ? mountSlider : mountDial;
      handle = mount(host, {snapshot: () => {
        const state = snapshot();
        return {value: number(state.value), min: number(state.min), max: number(state.max, 127), float: state.float === true, disabled: disabled()};
      }, setValue: value => send(numberMessage(value, snapshot().float === true)), subscribe}, common);
      break;
    }
    case 'message':
      handle = mountMessage(host, {snapshot: () => ({text: String(snapshot().text ?? ''), disabled: disabled()}), press: () => send(bang()), subscribe}, common);
      break;
    case 'menu':
    case 'tab': {
      const binding = {snapshot: () => {
        const state = snapshot();
        return {items: Array.isArray(state.items) ? state.items.map(String) : [], index: number(state.index), disabled: disabled()};
      }, select: (index: number) => send(intMessage(index)), subscribe};
      handle = name === 'menu' ? mountMenu(host, binding, {...common, cardHost: options.cardHost}) : mountTabs(host, binding, common);
      break;
    }
    case 'multislider':
      handle = mountMultislider(host, {snapshot: () => {
        const state = snapshot();
        return {values: Array.isArray(state.values) ? state.values.map(item => number(item)) : [], min: number(state.min), max: number(state.max, 1), float: state.float === true, disabled: disabled()};
      }, setValues: values => {
        const float = snapshot().float === true;
        send(message('list', values.map(value => float ? floatAtom(value) : intAtom(value))));
      }, subscribe}, common);
      break;
    case 'matrix':
      handle = mountMatrix(host, {snapshot: () => {
        const state = snapshot();
        return {columns: number(state.columns, 4), rows: number(state.rows, 4), cells: Array.isArray(state.cells) ? state.cells.map(item => number(item)) : [], disabled: disabled()};
      }, setCell: (column, row, on) => send(message('list', [intAtom(column), intAtom(row), intAtom(on ? 1 : 0)])), subscribe}, common);
      break;
    case 'preset':
      handle = mountPresetGrid(host, {snapshot: () => {
        const state = snapshot();
        return {count: number(state.count, 16), stored: Array.isArray(state.stored) ? state.stored.map(item => number(item)) : [], current: number(state.current), disabled: disabled()};
      }, recall: slot => send(intMessage(slot)), store: slot => send(parseMessage(`store ${slot}`)), clear: slot => send(parseMessage(`clear ${slot}`)), subscribe}, common);
      break;
    case 'nodes':
      handle = mountNodes(host, {snapshot: () => {
        const state = snapshot();
        const nodes = Array.isArray(state.nodes) ? state.nodes as {x: number; y: number; radius: number}[] : [];
        const cursor = (state.cursor ?? {x: 0.5, y: 0.5}) as {x: number; y: number};
        return {nodes, cursor, weights: Array.isArray(state.weights) ? state.weights.map(item => number(item)) : [], disabled: disabled()};
      }, setCursor: (x, y) => send(parseMessage(`cursor ${x.toFixed(4)} ${y.toFixed(4)}`)),
      moveNode: (index, x, y) => send(parseMessage(`node ${index} ${x.toFixed(4)} ${y.toFixed(4)}`)), subscribe}, common);
      break;
    default:
      throw new Error(`No control for ${name}.`);
  }

  const changed = () => {
    // A button flashes whenever its object counts another bang.
    const count = number(snapshot().flashes, flashes);
    if (count > flashes && 'flash' in handle) (handle as ButtonHandle).flash();
    flashes = count;
    for (const listener of [...listeners]) listener();
  };

  return {
    refresh(next) {
      if (next === iface) return;
      release?.();
      iface = next;
      flashes = number(snapshot().flashes, 0);
      release = next?.subscribe(changed);
      for (const listener of [...listeners]) listener();
    },
    destroy() { release?.(); listeners.clear(); handle.destroy(); },
  };
}
