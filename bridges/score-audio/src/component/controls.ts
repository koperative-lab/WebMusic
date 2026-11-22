// The UI Kit control of an interface object (DEC-078), bound to the object's
// interface from the Kernel (`objectInterfaceOf`). A rebuild of the graph
// creates a new object instance; `refresh` moves the binding to it without
// remounting the control, so a value being dragged is never replaced.
//
// A control fills its host (DEC-080): the host is a box of the size the
// author gave it, or of the control's natural size from `controlSize`.

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

/** One cell of a control's natural size, in CSS pixels. */
const CELL = 32;

/**
 * The natural size of the control of object `name`, in CSS pixels: the size
 * of its box until the author resizes it. `text` is the box text, whose
 * arguments decide how many cells a matrix, a preset grid or tabs have.
 */
export function controlSize(name: string, text: string = name): {width: number; height: number} {
  const words = text.trim().split(/\s+/).slice(1);
  const count = (index: number, fallback: number, most: number) => {
    const value = Number(words[index]);
    return Number.isInteger(value) && value >= 1 ? Math.min(most, value) : fallback;
  };
  // The controls draw text in a small monospace face: about 7.5 px a character.
  const wide = (characters: number) => Math.ceil(characters * 7.5) + 18;
  const within = (value: number, least: number, most: number) => Math.min(most, Math.max(least, value));
  switch (name) {
    case 'number': return {width: 96, height: CELL};
    case 'slider': case 'menu': return {width: 128, height: CELL};
    case 'dial': return {width: 48, height: 64};
    case 'message': return {width: within(wide(words.join(' ').length), 48, 320), height: CELL};
    case 'tab': return {width: within(words.reduce((sum, word) => sum + wide(word.length), 0), 64, 480), height: CELL};
    case 'multislider': return {width: 128, height: 96};
    case 'matrix': return {width: count(0, 4, 32) * CELL, height: count(1, 4, 32) * CELL};
    case 'preset': { const slots = count(0, 16, 64); return {width: Math.min(8, slots) * CELL, height: Math.ceil(slots / 8) * CELL}; }
    case 'nodes': return {width: 160, height: 160};
    default: return {width: CELL, height: CELL};
  }
}

/** Mount the control for object `name` into `host`; the control fills the host. */
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
  const common = {label: options.label, fill: true, onError: options.onError ?? ((error: unknown) => console.error(error))};
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
      const binding = {snapshot: () => {
        const state = snapshot();
        return {value: number(state.value), min: number(state.min), max: number(state.max, 127), float: state.float === true, disabled: disabled()};
      }, setValue: (value: number) => send(numberMessage(value, snapshot().float === true)), subscribe};
      // A slider stands upright in a box taller than it is wide.
      handle = name === 'slider' ? mountSlider(host, binding, {...common, orientation: 'auto'}) : mountDial(host, binding, common);
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
