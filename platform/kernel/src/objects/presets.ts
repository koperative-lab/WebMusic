// `preset` and `nodes` (DEC-076): the Max preset object and an interpolation
// pad. A preset captures every parameter and every value-holding interface
// object of its own component (the modules of its context's registry), and
// recalls or blends them; recalling an interface object makes it output, as
// in Max.

import {
  floatAtom, intAtom, isNumberAtom, message, atomsOf,
  type Atom, type JsonValue, type Message,
} from '../module/message';
import {PresetBank, applyParameters, captureParameters, type PresetValues} from '../module/preset';
import type {ModuleHandle} from '../module/registry';
import {OBJECT_INTERFACE, type ObjectContext, type ObjectDefinition} from './core';

const numberArg = (args: readonly Atom[], index: number, fallback: number) => {
  const atom = args[index];
  return isNumberAtom(atom) ? atom.value : fallback;
};

/** The one value an interface object holds, as a number or list, with how to set it back. */
function interfaceValue(module: ModuleHandle): {value: number | number[]; restore(value: number | readonly number[]): Message} | undefined {
  const iface = module.capabilities?.get(OBJECT_INTERFACE);
  const snapshot = iface?.snapshot() as Record<string, JsonValue> | null | undefined;
  if (!iface || !snapshot || typeof snapshot !== 'object') return undefined;
  const float = snapshot.float === true;
  const number = (value: number) => float ? floatAtom(value) : intAtom(Math.round(value));
  switch (iface.kind) {
    case 'toggle': return {value: snapshot.on ? 1 : 0, restore: value => message('int', [intAtom(Number(value) >= 0.5 ? 1 : 0)])};
    case 'number': case 'slider': case 'dial':
      return typeof snapshot.value === 'number' ? {value: snapshot.value, restore: value => message(float ? 'float' : 'int', [number(Number(value))])} : undefined;
    case 'menu': case 'tab':
      return typeof snapshot.index === 'number' ? {value: snapshot.index, restore: value => message('int', [intAtom(Math.round(Number(value)))])} : undefined;
    case 'multislider':
      return Array.isArray(snapshot.values) ? {value: snapshot.values.map(Number), restore: value => message('list', (value as readonly number[]).map(number))} : undefined;
    default: return undefined;
  }
}

/** Capture the values of every other module in the preset's component. */
function capture(context: ObjectContext): PresetValues {
  const modules = context.scope.registry.snapshot().filter(module => module.id !== context.id);
  const values: Record<string, number | readonly number[]> = captureParameters(modules);
  for (const module of modules) {
    const held = interfaceValue(module);
    if (held) values[`${module.id}#value`] = held.value;
  }
  return values;
}

function apply(context: ObjectContext, values: PresetValues): void {
  const modules = context.scope.registry.snapshot().filter(module => module.id !== context.id);
  applyParameters(modules, values);
  for (const module of modules) {
    const value = values[`${module.id}#value`];
    const held = value === undefined ? undefined : interfaceValue(module);
    if (held) module.capabilities?.get(OBJECT_INTERFACE)?.interact(held.restore(value!));
  }
}

const preset: ObjectDefinition = {
  name: 'preset',
  interface: true,
  inlets: () => [{label: 'slot to recall, store n, clear n, interp a b f, weights …'}],
  outlets: () => [{label: 'the slot recalled'}],
  create: (context) => {
    const count = Math.max(1, Math.min(64, Math.trunc(numberArg(context.args, 0, 16))));
    const saved = (context.state as {slots?: Record<string, PresetValues>} | undefined)?.slots;
    const bank = new PresetBank(saved && typeof saved === 'object' ? saved : undefined);
    let current = 0;
    const recall = (slot: number, time?: number) => {
      const values = bank.recall(slot);
      if (!values) return;
      current = slot;
      apply(context, values);
      context.changed();
      context.out(0, message('int', [intAtom(slot)], time));
    };
    return {
      receive: (_index, value) => {
        const numbers = atomsOf(value).filter(isNumberAtom).map(atom => atom.value);
        switch (value.selector) {
          case 'int': case 'float': recall(Math.trunc(numbers[0]!), value.time); return;
          case 'bang': if (current) recall(current, value.time); return;
          case 'store': {
            const slot = Math.trunc(numbers[0] ?? 0);
            if (slot < 1 || slot > count) return;
            bank.store(slot, capture(context));
            current = slot;
            context.changed();
            return;
          }
          case 'clear': bank.clear(Math.trunc(numbers[0] ?? 0)); context.changed(); return;
          case 'interp': {
            const [from, to, fraction] = numbers;
            if (from === undefined || to === undefined || fraction === undefined) return;
            apply(context, bank.between(Math.trunc(from), Math.trunc(to), fraction));
            current = 0;
            context.changed();
            return;
          }
          case 'weights': {
            apply(context, bank.interpolate(Object.fromEntries(numbers.map((weight, index) => [index + 1, weight]))));
            current = 0;
            context.changed();
            return;
          }
        }
      },
      state: () => ({slots: bank.toJSON()}),
      snapshot: () => ({count, stored: [...bank.slots], current}),
    };
  },
};

interface Node { x: number; y: number; radius: number }

/** Each node's weight: how far the cursor reaches inside it, normalized to sum to 1. */
export function nodeWeights(nodes: readonly Node[], cursor: {x: number; y: number}): number[] {
  const raw = nodes.map(node => Math.max(0, 1 - Math.hypot(cursor.x - node.x, cursor.y - node.y) / node.radius));
  const total = raw.reduce((sum, weight) => sum + weight, 0);
  return total > 0 ? raw.map(weight => weight / total) : raw;
}

const nodes: ObjectDefinition = {
  name: 'nodes',
  interface: true,
  inlets: () => [{label: 'cursor x y, node i x y'}],
  outlets: () => [{label: 'weights, one per node'}],
  create: (context) => {
    const count = Math.max(2, Math.min(12, Math.trunc(numberArg(context.args, 0, 4))));
    const saved = context.state as {nodes?: Node[]; cursor?: {x: number; y: number}} | undefined;
    // Default nodes sit on a circle; the canvas is the unit square.
    const placed: Node[] = Array.isArray(saved?.nodes) && saved!.nodes.length === count ? saved!.nodes.map(node => ({...node}))
      : Array.from({length: count}, (_, index) => {
        const angle = (index / count) * Math.PI * 2 - Math.PI / 2;
        return {x: 0.5 + 0.3 * Math.cos(angle), y: 0.5 + 0.3 * Math.sin(angle), radius: 0.45};
      });
    let cursor = saved?.cursor && Number.isFinite(saved.cursor.x) ? {...saved.cursor} : {x: 0.5, y: 0.5};
    const clamp = (value: number) => Math.min(1, Math.max(0, value));
    const output = (time?: number) => context.out(0, message('list', nodeWeights(placed, cursor).map(weight => floatAtom(weight)), time));
    return {
      receive: (_index, value) => {
        const numbers = atomsOf(value).filter(isNumberAtom).map(atom => atom.value);
        if (value.selector === 'cursor' && numbers.length >= 2) { cursor = {x: clamp(numbers[0]!), y: clamp(numbers[1]!)}; context.changed(); output(value.time); return; }
        if (value.selector === 'node' && numbers.length >= 3) {
          const node = placed[Math.trunc(numbers[0]!)];
          if (!node) return;
          node.x = clamp(numbers[1]!); node.y = clamp(numbers[2]!);
          if (numbers[3] !== undefined && numbers[3] > 0) node.radius = Math.min(1, numbers[3]);
          context.changed();
          output(value.time);
          return;
        }
        if (value.selector === 'bang') output(value.time);
      },
      state: () => ({nodes: placed.map(node => ({...node})), cursor: {...cursor}}),
      snapshot: () => ({nodes: placed.map(node => ({...node})), cursor: {...cursor}, weights: nodeWeights(placed, cursor)}),
    };
  },
};

export const PRESET_DEFINITIONS: readonly ObjectDefinition[] = Object.freeze([preset, nodes]);
