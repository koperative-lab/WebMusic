// The object library (DEC-075): Max-style message objects as definitions for
// the object framework. Hot left inlets trigger output; other inlets store.
// Every output carries the time of the message that caused it.

import {
  atomsOf, bang, floatAtom, formatMessage, intAtom, isNumberAtom, message, messageFromAtoms, numberOf,
  parseMessage, symbolAtom,
  type Atom, type JsonValue, type Message,
} from '../module/message';
import {compileExpr} from './expr';
import type {ObjectBehavior, ObjectContext, ObjectDefinition, PortSpec} from './core';

// --- helpers ------------------------------------------------------------------

const ports = (...labels: string[]): readonly PortSpec[] => labels.map(label => ({label}));
const isBang = (value: Message) => value.selector === 'bang';
const isNumber = (value: Message) => value.selector === 'int' || value.selector === 'float';
const numberArg = (args: readonly Atom[], index: number, fallback: number): number => {
  const atom = args[index];
  return isNumberAtom(atom) ? atom.value : fallback;
};
const isFloatArg = (args: readonly Atom[], index: number) => args[index]?.type === 'float';
/** A number message of the right type. */
const numberMessage = (value: number, float: boolean, time?: number) =>
  float ? message('float', [floatAtom(value)], time) : message('int', [intAtom(Math.round(value))], time);
const at = (value: Message, clock: {now(): number}) => value.time ?? clock.now();
const stateNumber = (state: JsonValue | undefined, key: string): number | undefined => {
  if (!state || typeof state !== 'object' || Array.isArray(state)) return undefined;
  const value = (state as Record<string, JsonValue>)[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
};
const stateBoolean = (state: JsonValue | undefined, key: string): boolean =>
  !!state && typeof state === 'object' && !Array.isArray(state) && (state as Record<string, JsonValue>)[key] === true;
const sameAtom = (a: Atom | undefined, b: Atom | undefined) =>
  !!a && !!b && (isNumberAtom(a) && isNumberAtom(b) ? a.value === b.value : a.type === b.type && JSON.stringify(a.value) === JSON.stringify(b.value));
const requireArgs = (name: string, args: readonly Atom[], minimum: number, what: string) => {
  if (args.length < minimum) throw new TypeError(`${name} needs ${what}.`);
};
const positive = (name: string, value: number) => {
  if (!(value > 0)) throw new RangeError(`${name} must be greater than 0.`);
  return value;
};

/** A seedable generator (mulberry32) so a seeded `random` repeats. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// --- time ----------------------------------------------------------------------

const loadbang: ObjectDefinition = {
  name: 'loadbang',
  inlets: () => ports('bang'),
  outlets: () => ports('bang when the component loads'),
  create: ({out}) => ({
    activate: () => out(0, bang()),
    receive: (_index, value) => out(0, bang(value.time)),
  }),
};

const metro: ObjectDefinition = {
  name: 'metro',
  inlets: () => ports('on/off, bang, stop', 'interval (ms)'),
  outlets: () => ports('bang'),
  check: args => { positive('metro interval', numberArg(args, 0, 500)); },
  create: (context) => {
    let interval = stateNumber(context.state, 'interval') ?? numberArg(context.args, 0, 500);
    let running = stateBoolean(context.state, 'running');
    let cancel: (() => void) | undefined;
    const tick = (time: number) => {
      context.out(0, bang(time));
      cancel = context.clock.schedule(time + interval / 1000, tick);
    };
    const start = (time: number) => { cancel?.(); running = true; if (context.active) tick(time); };
    const stop = () => { cancel?.(); cancel = undefined; running = false; };
    return {
      activate: () => { if (running) tick(context.clock.now()); },
      receive: (index, value) => {
        if (index === 1) { const next = numberOf(value); if (next !== undefined && next > 0) interval = next; return; }
        if (value.selector === 'stop' || (isNumber(value) && numberOf(value) === 0)) stop();
        else if (isBang(value) || isNumber(value) || value.selector === 'start') start(at(value, context.clock));
      },
      state: () => ({running, interval}),
      dispose: stop,
    };
  },
};

const delay: ObjectDefinition = {
  name: 'delay',
  inlets: () => ports('bang, stop, or delay time to start', 'delay time (ms)'),
  outlets: () => ports('bang after the delay'),
  create: (context) => {
    let time = numberArg(context.args, 0, 0);
    let cancel: (() => void) | undefined;
    const schedule = (from: number) => {
      cancel?.();
      cancel = context.clock.schedule(from + time / 1000, when => { cancel = undefined; context.out(0, bang(when)); });
    };
    return {
      receive: (index, value) => {
        const number = numberOf(value);
        if (index === 1) { if (number !== undefined && number >= 0) time = number; return; }
        if (value.selector === 'stop') { cancel?.(); cancel = undefined; return; }
        if (isNumber(value) && number !== undefined && number >= 0) time = number;
        if (isBang(value) || isNumber(value)) schedule(at(value, context.clock));
      },
      dispose: () => cancel?.(),
    };
  },
};

const pipe: ObjectDefinition = {
  name: 'pipe',
  inlets: () => ports('value to delay, clear', 'delay time (ms)'),
  outlets: () => ports('the value after the delay'),
  create: (context) => {
    let time = numberArg(context.args, 0, 0);
    const pending = new Set<() => void>();
    return {
      receive: (index, value) => {
        const number = numberOf(value);
        if (index === 1) { if (number !== undefined && number >= 0) time = number; return; }
        if (value.selector === 'clear') { for (const cancel of pending) cancel(); pending.clear(); return; }
        const atoms = atomsOf(value);
        const cancel = context.clock.schedule(at(value, context.clock) + time / 1000, when => {
          pending.delete(cancel);
          context.out(0, messageFromAtoms(atoms, when));
        });
        pending.add(cancel);
      },
      dispose: () => { for (const cancel of pending) cancel(); },
    };
  },
};

const line: ObjectDefinition = {
  name: 'line',
  inlets: () => ports('target, or target and time (ms)', 'ramp time (ms)', 'grain (ms)'),
  outlets: () => ports('ramp values', 'bang at the end'),
  create: (context) => {
    const float = isFloatArg(context.args, 0);
    let current = stateNumber(context.state, 'value') ?? numberArg(context.args, 0, 0);
    let nextTime = 0;
    let grain = numberArg(context.args, 1, 20);
    let cancel: (() => void) | undefined;
    const stop = () => { cancel?.(); cancel = undefined; };
    const ramp = (target: number, duration: number, start: number) => {
      stop();
      if (duration <= 0) { current = target; context.out(0, numberMessage(current, float, start)); context.out(1, bang(start)); return; }
      const from = current, steps = Math.max(1, Math.ceil(duration / grain));
      let step = 0;
      const next = (time: number) => {
        step++;
        current = step >= steps ? target : from + (target - from) * (step / steps);
        context.out(0, numberMessage(current, float, time));
        if (step >= steps) { cancel = undefined; context.out(1, bang(time)); return; }
        cancel = context.clock.schedule(start + (duration / 1000) * ((step + 1) / steps), next);
      };
      cancel = context.clock.schedule(start + (duration / 1000) / steps, next);
    };
    return {
      receive: (index, value) => {
        const atoms = atomsOf(value);
        if (index === 1) { const n = numberOf(value); if (n !== undefined && n >= 0) nextTime = n; return; }
        if (index === 2) { const n = numberOf(value); if (n !== undefined && n > 0) grain = n; return; }
        if (value.selector === 'stop') { stop(); return; }
        if (value.selector === 'set') { const n = numberOf(message('list', atoms.slice(1))); if (n !== undefined) { stop(); current = n; } return; }
        const target = isNumberAtom(atoms[0]) ? atoms[0].value : undefined;
        if (target === undefined) return;
        const duration = isNumberAtom(atoms[1]) ? atoms[1].value : nextTime;
        nextTime = 0;
        ramp(target, duration, at(value, context.clock));
      },
      state: () => ({value: current}),
      dispose: stop,
    };
  },
};

// --- logic ---------------------------------------------------------------------

const counter: ObjectDefinition = {
  name: 'counter',
  inlets: () => ports('bang to count, set, reset, min, max', 'next value'),
  outlets: () => ports('count', 'bang when it wraps'),
  create: (context) => {
    let minimum = context.args.length >= 2 ? numberArg(context.args, 0, 0) : 0;
    let maximum = context.args.length >= 2 ? numberArg(context.args, 1, Infinity) : numberArg(context.args, 0, Infinity);
    let next = stateNumber(context.state, 'next') ?? minimum;
    const emit = (time?: number) => {
      const value = next;
      next = value + 1;
      let wrapped = false;
      if (next > maximum) { next = minimum; wrapped = true; }
      context.out(0, message('int', [intAtom(value)], time));
      if (wrapped) context.out(1, bang(time));
    };
    return {
      receive: (index, value) => {
        const number = numberOf(value);
        if (index === 1) { if (number !== undefined) next = Math.trunc(number); return; }
        switch (value.selector) {
          case 'bang': emit(value.time); return;
          case 'reset': next = minimum; return;
          case 'set': if (number !== undefined) next = Math.trunc(number); return;
          case 'min': if (number !== undefined) minimum = Math.trunc(number); return;
          case 'max': if (number !== undefined) maximum = Math.trunc(number); return;
          case 'int': case 'float': if (number !== undefined) { next = Math.trunc(number); emit(value.time); } return;
        }
      },
      state: () => ({next}),
    };
  },
};

const select: ObjectDefinition = {
  name: 'select',
  inlets: args => args.length === 1 ? ports('value to test', 'value to match') : ports('value to test'),
  outlets: args => [...args.map(atom => ({label: `bang on ${formatMessage(messageFromAtoms([atom]))}`})), {label: 'anything else'}],
  check: args => requireArgs('select', args, 1, 'at least one value to match'),
  create: (context) => {
    const matches = [...context.args];
    return {
      receive: (index, value) => {
        const atoms = atomsOf(value);
        if (index === 1) { if (atoms[0]) matches[0] = atoms[0]; return; }
        const subject = value.selector === 'bang' ? symbolAtom('bang') : atoms[0];
        const found = matches.findIndex(atom => sameAtom(atom, subject));
        if (found >= 0 && atoms.length <= 1) context.out(found, bang(value.time));
        else context.out(matches.length, value);
      },
    };
  },
};

const route: ObjectDefinition = {
  name: 'route',
  inlets: () => ports('message to route'),
  outlets: args => [...args.map(atom => ({label: `rest of ${formatMessage(messageFromAtoms([atom]))}`})), {label: 'anything else'}],
  check: args => requireArgs('route', args, 1, 'at least one value to route'),
  create: (context) => ({
    receive: (_index, value) => {
      const atoms = atomsOf(value);
      const found = context.args.findIndex(atom => sameAtom(atom, atoms[0]));
      if (found < 0) { context.out(context.args.length, value); return; }
      context.out(found, messageFromAtoms(atoms.slice(1), value.time));
    },
  }),
};

const gate: ObjectDefinition = {
  name: 'gate',
  inlets: () => ports('outlet to open (0 closes)', 'message to pass'),
  outlets: args => Array.from({length: Math.max(1, Math.trunc(numberArg(args, 0, 1)))}, (_, index) => ({label: `open ${index + 1}`})),
  create: (context) => {
    const count = Math.max(1, Math.trunc(numberArg(context.args, 0, 1)));
    let open = stateNumber(context.state, 'open') ?? Math.trunc(numberArg(context.args, 1, 0));
    return {
      receive: (index, value) => {
        if (index === 0) { const n = numberOf(value); if (n !== undefined) open = Math.max(0, Math.min(count, Math.trunc(n))); context.changed(); return; }
        if (open > 0) context.out(open - 1, value);
      },
      state: () => ({open}),
    };
  },
};

const switchObject: ObjectDefinition = {
  name: 'switch',
  inlets: args => [{label: 'inlet to pass (0 closes)'}, ...Array.from({length: Math.max(1, Math.trunc(numberArg(args, 0, 2)))}, (_, index) => ({label: `input ${index + 1}`}))],
  outlets: () => ports('the open input'),
  create: (context) => {
    const count = Math.max(1, Math.trunc(numberArg(context.args, 0, 2)));
    let open = stateNumber(context.state, 'open') ?? Math.trunc(numberArg(context.args, 1, 0));
    return {
      receive: (index, value) => {
        if (index === 0) { const n = numberOf(value); if (n !== undefined) open = Math.max(0, Math.min(count, Math.trunc(n))); return; }
        if (index === open) context.out(0, value);
      },
      state: () => ({open}),
    };
  },
};

/** One trigger outlet's conversion. */
function convert(kind: Atom, value: Message): Message {
  const atoms = atomsOf(value);
  const first = atoms[0];
  if (kind.type === 'symbol') {
    switch (kind.value) {
      case 'b': return bang(value.time);
      case 'i': return message('int', [intAtom(isNumberAtom(first) ? first.value : 0)], value.time);
      case 'f': return message('float', [floatAtom(isNumberAtom(first) ? first.value : 0)], value.time);
      case 's': { const named = atoms.find(atom => atom.type === 'symbol'); return message('symbol', [symbolAtom(named?.type === 'symbol' ? named.value : value.selector)], value.time); }
      case 'l': return message('list', atoms, value.time);
      case 'a': return value;
      default: return messageFromAtoms([kind], value.time);
    }
  }
  return messageFromAtoms([kind], value.time);
}

const trigger: ObjectDefinition = {
  name: 'trigger',
  inlets: () => ports('message to distribute'),
  outlets: args => (args.length ? args : [symbolAtom('b'), symbolAtom('b')]).map(atom => ({label: formatMessage(messageFromAtoms([atom]))})),
  create: (context) => {
    const kinds = context.args.length ? context.args : [symbolAtom('b'), symbolAtom('b')];
    return {
      receive: (_index, value) => {
        // Right to left, as in Max: the rightmost outlet fires first.
        for (let index = kinds.length - 1; index >= 0; index--) context.out(index, convert(kinds[index]!, value));
      },
    };
  },
};

/** pack/unpack slot types from arguments: `i`, `f`, `s` or a literal. */
function slots(args: readonly Atom[]): Atom[] {
  const source = args.length ? args : [intAtom(0), intAtom(0)];
  return source.map(atom => {
    if (atom.type === 'symbol' && atom.value === 'i') return intAtom(0);
    if (atom.type === 'symbol' && atom.value === 'f') return floatAtom(0);
    if (atom.type === 'symbol' && atom.value === 's') return symbolAtom('');
    return atom;
  });
}
function coerce(slot: Atom, value: Atom): Atom {
  if (slot.type === 'int') return isNumberAtom(value) ? intAtom(value.value) : slot;
  if (slot.type === 'float') return isNumberAtom(value) ? floatAtom(value.value) : slot;
  if (slot.type === 'symbol') return value.type === 'symbol' ? value : symbolAtom(formatMessage(messageFromAtoms([value])));
  return value;
}

const pack: ObjectDefinition = {
  name: 'pack',
  inlets: args => slots(args).map((_, index) => ({label: index === 0 ? 'first element, outputs the list' : `element ${index + 1}`})),
  outlets: () => ports('list'),
  create: (context) => {
    const values = slots(context.args);
    const output = (time?: number) => context.out(0, message('list', values, time));
    return {
      receive: (index, value) => {
        const atoms = atomsOf(value);
        if (index > 0) { if (atoms[0]) values[index] = coerce(values[index]!, atoms[0]); return; }
        if (value.selector === 'bang') { output(value.time); return; }
        if (value.selector === 'set') { atoms.slice(1).forEach((atom, offset) => { if (offset < values.length) values[offset] = coerce(values[offset]!, atom); }); return; }
        atoms.forEach((atom, offset) => { if (offset < values.length) values[offset] = coerce(values[offset]!, atom); });
        output(value.time);
      },
    };
  },
};

const unpack: ObjectDefinition = {
  name: 'unpack',
  inlets: () => ports('list to split'),
  outlets: args => slots(args).map((_, index) => ({label: `element ${index + 1}`})),
  create: (context) => {
    const types = slots(context.args);
    return {
      receive: (_index, value) => {
        const atoms = atomsOf(value);
        for (let index = Math.min(types.length, atoms.length) - 1; index >= 0; index--) {
          context.out(index, messageFromAtoms([coerce(types[index]!, atoms[index]!)], value.time));
        }
      },
    };
  },
};

const expr: ObjectDefinition = {
  name: 'expr',
  inlets: args => Array.from({length: compileExpr(exprText(args)).inlets}, (_, index) => ({label: index === 0 ? '$1, evaluates' : `$${index + 1}`})),
  outlets: () => ports('result'),
  check: args => { compileExpr(exprText(args)); },
  create: (context) => {
    const compiled = compileExpr(exprText(context.args));
    const inputs = new Array<number>(compiled.inlets).fill(0);
    const evaluate = (time?: number) => {
      const result = compiled.evaluate(inputs, context.environment.random);
      context.out(0, numberMessage(result.value, result.float, time));
    };
    return {
      receive: (index, value) => {
        const atoms = atomsOf(value);
        if (index === 0 && value.selector === 'bang') { evaluate(value.time); return; }
        // A list into the left inlet fills the inlets in order, as in Max.
        atoms.forEach((atom, offset) => { if (isNumberAtom(atom) && index + offset < inputs.length) inputs[index + offset] = atom.value; });
        if (index === 0) evaluate(value.time);
      },
    };
  },
};
const exprText = (args: readonly Atom[]) => args.map(atom => atom.type === 'symbol' ? atom.value : formatMessage(messageFromAtoms([atom]))).join(' ');

const scale: ObjectDefinition = {
  name: 'scale',
  inlets: () => ports('value to scale', 'input low', 'input high', 'output low', 'output high'),
  outlets: () => ports('scaled value'),
  check: args => requireArgs('scale', args, 4, 'input low, input high, output low and output high'),
  create: (context) => {
    const range = [0, 1, 2, 3].map(index => numberArg(context.args, index, 0));
    const exponent = numberArg(context.args, 4, 1);
    const float = [0, 1, 2, 3].some(index => isFloatArg(context.args, index));
    return {
      receive: (index, value) => {
        const number = numberOf(value);
        if (number === undefined) return;
        if (index > 0) { range[index - 1] = number; return; }
        const [inLow, inHigh, outLow, outHigh] = range as [number, number, number, number];
        const span = inHigh - inLow;
        const fraction = span === 0 ? 0 : (number - inLow) / span;
        const shaped = exponent === 1 ? fraction : Math.sign(fraction) * Math.abs(fraction) ** exponent;
        context.out(0, numberMessage(outLow + shaped * (outHigh - outLow), float || value.selector === 'float', value.time));
      },
    };
  },
};

const random: ObjectDefinition = {
  name: 'random',
  inlets: () => ports('bang for a number, seed', 'range'),
  outlets: () => ports('random int from 0'),
  create: (context) => {
    let range = Math.max(1, Math.trunc(numberArg(context.args, 0, 2)));
    let next = context.args.length >= 2 ? seeded(numberArg(context.args, 1, 0)) : context.environment.random;
    return {
      receive: (index, value) => {
        const number = numberOf(value);
        if (index === 1) { if (number !== undefined && number >= 1) range = Math.trunc(number); return; }
        if (value.selector === 'seed') { next = number === undefined || number === 0 ? context.environment.random : seeded(number); return; }
        if (value.selector === 'bang') context.out(0, message('int', [intAtom(Math.floor(next() * range))], value.time));
      },
    };
  },
};

const print: ObjectDefinition = {
  name: 'print',
  inlets: () => ports('anything to print'),
  outlets: () => [],
  create: (context) => {
    const name = context.args[0]?.type === 'symbol' ? context.args[0].value : 'print';
    return {
      receive: (_index, value) => {
        const text = formatMessage(value);
        if (context.environment.print) context.environment.print(name, text, context.id);
        else console.log(`${name}: ${text}`);
      },
    };
  },
};

// --- message to sound ----------------------------------------------------------

/** A ConstantSourceNode control output whose value follows messages on the scheduled sample. */
function constantControl(context: ObjectContext, initial: number) {
  const audio = context.audio();
  const node = audio.createConstantSource();
  node.offset.value = initial;
  node.start();
  const segments: {start: number; from: number; end: number; to: number}[] = [];
  const valueAt = (time: number): number => {
    let value = initial;
    for (const segment of segments) {
      if (time >= segment.end) value = segment.to;
      else if (time >= segment.start) value = segment.from + (segment.to - segment.from) * ((time - segment.start) / Math.max(1e-9, segment.end - segment.start));
    }
    return value;
  };
  const when = (value: Message) => Math.max(audio.currentTime, value.time ?? audio.currentTime);
  return {
    control: Object.freeze({output: node, rate: 'a-rate' as const, range: Object.freeze({min: -1, max: 1})}),
    /** Jump to `value` at `time`. */
    set(value: number, time: number) {
      node.offset.cancelScheduledValues(time);
      node.offset.setValueAtTime(value, time);
      segments.splice(0, segments.length, {start: time, from: value, end: time, to: value});
    },
    /** Ramp through `[target, ms]` pairs from `time`. */
    ramp(pairs: readonly [number, number][], time: number) {
      let start = time, from = valueAt(time);
      node.offset.cancelScheduledValues(time);
      node.offset.setValueAtTime(from, time);
      segments.splice(0, segments.length);
      for (const [target, ms] of pairs) {
        const end = start + Math.max(0, ms) / 1000;
        if (end > start) node.offset.linearRampToValueAtTime(target, end); else node.offset.setValueAtTime(target, end);
        segments.push({start, from, end, to: target});
        start = end; from = target;
      }
      return start;
    },
    when,
    current: () => valueAt(audio.currentTime),
    dispose() { try { node.stop(); } catch { /* Already stopped. */ } node.disconnect(); },
  };
}

const sig: ObjectDefinition = {
  name: 'sig',
  inlets: () => ports('value'),
  outlets: () => [],
  create: (context): ObjectBehavior => {
    const initial = stateNumber(context.state, 'value') ?? numberArg(context.args, 0, 0);
    const output = constantControl(context, initial);
    let last = initial;
    return {
      control: output.control,
      receive: (_index, value) => {
        const number = numberOf(value);
        if (number === undefined) return;
        last = number;
        output.set(number, output.when(value));
      },
      state: () => ({value: last}),
      dispose: () => output.dispose(),
    };
  },
};

const ramp: ObjectDefinition = {
  name: 'ramp',
  inlets: () => ports('target, or target and time (ms) pairs'),
  outlets: () => ports('bang at the end'),
  create: (context): ObjectBehavior => {
    const initial = stateNumber(context.state, 'value') ?? numberArg(context.args, 0, 0);
    const output = constantControl(context, initial);
    let cancel: (() => void) | undefined;
    return {
      control: output.control,
      receive: (_index, value) => {
        const atoms = atomsOf(value).filter(isNumberAtom).map(atom => atom.value);
        if (value.selector === 'stop') { const time = output.when(value); output.set(output.current(), time); cancel?.(); return; }
        if (!atoms.length) return;
        const time = output.when(value);
        if (atoms.length === 1) { output.set(atoms[0]!, time); return; }
        const pairs: [number, number][] = [];
        for (let index = 0; index + 1 < atoms.length; index += 2) pairs.push([atoms[index]!, atoms[index + 1]!]);
        const end = output.ramp(pairs, time);
        cancel?.();
        cancel = context.clock.schedule(end, when => { cancel = undefined; context.out(0, bang(when)); });
      },
      state: () => ({value: output.current()}),
      dispose: () => { cancel?.(); output.dispose(); },
    };
  },
};

// --- interface objects ---------------------------------------------------------

/** A number held by number boxes, sliders and dials. */
function numberInterface(name: string, defaults: {min: number; max: number; float: boolean}): ObjectDefinition {
  return {
    name,
    interface: true,
    inlets: () => ports('value to set and output, set, bang'),
    outlets: () => ports('value'),
    create: (context) => {
      const float = defaults.float || isFloatArg(context.args, 0) || isFloatArg(context.args, 1);
      const min = numberArg(context.args, 0, defaults.min), max = numberArg(context.args, 1, defaults.max);
      const clamp = (value: number) => {
        const bounded = Math.min(Math.max(min, max), Math.max(Math.min(min, max), value));
        return float ? bounded : Math.round(bounded);
      };
      let value = clamp(stateNumber(context.state, 'value') ?? Math.min(Math.max(0, Math.min(min, max)), Math.max(min, max)));
      const output = (time?: number) => context.out(0, numberMessage(value, float, time));
      return {
        receive: (_index, input) => {
          const number = numberOf(input);
          if (input.selector === 'bang') { output(input.time); return; }
          if (input.selector === 'set') { if (number !== undefined) { value = clamp(number); context.changed(); } return; }
          if (number === undefined) return;
          value = clamp(number);
          context.changed();
          output(input.time);
        },
        state: () => ({value}),
        snapshot: () => ({value, min, max, float}),
      };
    },
  };
}

const button: ObjectDefinition = {
  name: 'button',
  interface: true,
  inlets: () => ports('anything flashes and outputs a bang'),
  outlets: () => ports('bang'),
  create: (context) => {
    let flashes = 0;
    return {
      receive: (_index, value) => { flashes++; context.changed(); context.out(0, bang(value.time)); },
      snapshot: () => ({flashes}),
    };
  },
};

const toggle: ObjectDefinition = {
  name: 'toggle',
  interface: true,
  inlets: () => ports('bang flips, a number sets, set'),
  outlets: () => ports('0 or 1'),
  create: (context) => {
    let on = stateNumber(context.state, 'value') === 1;
    const output = (time?: number) => context.out(0, message('int', [intAtom(on ? 1 : 0)], time));
    return {
      receive: (_index, value) => {
        const number = numberOf(value);
        if (value.selector === 'set') { if (number !== undefined) { on = number !== 0; context.changed(); } return; }
        if (value.selector === 'bang') on = !on;
        else if (number !== undefined) on = number !== 0;
        else return;
        context.changed();
        output(value.time);
      },
      state: () => ({value: on ? 1 : 0}),
      snapshot: () => ({on}),
    };
  },
};

const messageBox: ObjectDefinition = {
  name: 'message',
  interface: true,
  inlets: () => ports('bang outputs, $1… fill from any message, set'),
  outlets: () => ports('the message'),
  create: (context) => {
    let text = typeof (context.state as {text?: unknown} | undefined)?.text === 'string'
      ? (context.state as {text: string}).text
      : context.args.map(atom => formatMessage(messageFromAtoms([atom]))).join(' ');
    const output = (inputs: readonly Atom[], time?: number) => {
      // Commas separate messages sent one after another.
      for (const part of text.split(',')) {
        const filled = part.replace(/\$([1-9])/g, (_, digit: string) => {
          const atom = inputs[Number(digit) - 1];
          return atom ? formatMessage(messageFromAtoms([atom])) : '0';
        }).trim();
        if (filled) context.out(0, parseMessage(filled, time));
      }
    };
    return {
      receive: (_index, value) => {
        if (value.selector === 'set') { text = value.atoms.map(atom => formatMessage(messageFromAtoms([atom]))).join(' '); context.changed(); return; }
        output(value.selector === 'bang' ? [] : atomsOf(value), value.time);
      },
      state: () => ({text}),
      snapshot: () => ({text}),
    };
  },
};

/** menu and tab: a choice among symbol arguments. */
function choiceInterface(name: string): ObjectDefinition {
  return {
    name,
    interface: true,
    inlets: () => ports('index to choose and output, set, bang'),
    outlets: () => ports('index', 'item'),
    check: args => requireArgs(name, args, 1, 'at least one item'),
    create: (context) => {
      const items = context.args.map(atom => atom.type === 'symbol' ? atom.value : formatMessage(messageFromAtoms([atom])));
      const clamp = (value: number) => Math.max(0, Math.min(items.length - 1, Math.trunc(value)));
      let index = clamp(stateNumber(context.state, 'value') ?? 0);
      const output = (time?: number) => {
        // Right to left: the item, then the index.
        context.out(1, messageFromAtoms([symbolAtom(items[index]!)], time));
        context.out(0, message('int', [intAtom(index)], time));
      };
      return {
        receive: (_index, value) => {
          const number = numberOf(value);
          if (value.selector === 'bang') { output(value.time); return; }
          if (value.selector === 'set') { if (number !== undefined) { index = clamp(number); context.changed(); } return; }
          if (number === undefined) return;
          index = clamp(number);
          context.changed();
          output(value.time);
        },
        state: () => ({value: index}),
        snapshot: () => ({items, index}),
      };
    },
  };
}

const multislider: ObjectDefinition = {
  name: 'multislider',
  interface: true,
  inlets: () => ports('list to set and output, set, bang'),
  outlets: () => ports('list of values'),
  create: (context) => {
    const count = Math.max(1, Math.min(128, Math.trunc(numberArg(context.args, 0, 8))));
    const min = numberArg(context.args, 1, 0), max = numberArg(context.args, 2, 1);
    const float = context.args.length < 3 || isFloatArg(context.args, 1) || isFloatArg(context.args, 2);
    const clamp = (value: number) => {
      const bounded = Math.min(Math.max(min, max), Math.max(Math.min(min, max), value));
      return float ? bounded : Math.round(bounded);
    };
    const saved = (context.state as {values?: unknown} | undefined)?.values;
    const values = Array.from({length: count}, (_, index) => clamp(Array.isArray(saved) && typeof saved[index] === 'number' ? saved[index] as number : min));
    const output = (time?: number) => context.out(0, message('list', values.map(value => float ? floatAtom(value) : intAtom(value)), time));
    const assign = (atoms: readonly Atom[]) => atoms.forEach((atom, index) => { if (isNumberAtom(atom) && index < count) values[index] = clamp(atom.value); });
    return {
      receive: (_index, value) => {
        const atoms = atomsOf(value);
        if (value.selector === 'bang') { output(value.time); return; }
        if (value.selector === 'set') { assign(atoms.slice(1)); context.changed(); return; }
        if (!atoms.some(isNumberAtom)) return;
        assign(atoms);
        context.changed();
        output(value.time);
      },
      state: () => ({values: [...values]}),
      snapshot: () => ({values: [...values], min, max, float}),
    };
  },
};

const matrix: ObjectDefinition = {
  name: 'matrix',
  interface: true,
  inlets: () => ports('column row value, clear, bang'),
  outlets: () => ports('column row value'),
  create: (context) => {
    const columns = Math.max(1, Math.min(32, Math.trunc(numberArg(context.args, 0, 4))));
    const rows = Math.max(1, Math.min(32, Math.trunc(numberArg(context.args, 1, 4))));
    const saved = (context.state as {cells?: unknown} | undefined)?.cells;
    const cells = Array.from({length: columns * rows}, (_, index) => Array.isArray(saved) && saved[index] === 1 ? 1 : 0);
    const cell = (column: number, row: number, value: number, time?: number) =>
      context.out(0, message('list', [intAtom(column), intAtom(row), intAtom(value)], time));
    return {
      receive: (_index, value) => {
        if (value.selector === 'clear') { cells.fill(0); context.changed(); return; }
        if (value.selector === 'bang') {
          for (let row = 0; row < rows; row++) for (let column = 0; column < columns; column++) if (cells[row * columns + column]) cell(column, row, 1, value.time);
          return;
        }
        const set = value.selector === 'set';
        const numbers = (set ? value.atoms : atomsOf(value)).filter(isNumberAtom).map(atom => Math.trunc(atom.value));
        if (numbers.length < 3) return;
        const [column, row, on] = numbers as [number, number, number];
        if (column < 0 || column >= columns || row < 0 || row >= rows) return;
        cells[row * columns + column] = on ? 1 : 0;
        context.changed();
        if (!set) cell(column, row, on ? 1 : 0, value.time);
      },
      state: () => ({cells: [...cells]}),
      snapshot: () => ({columns, rows, cells: [...cells]}),
    };
  },
};

/** Every object in the library, by name. */
export const OBJECT_DEFINITIONS: readonly ObjectDefinition[] = Object.freeze([
  loadbang, metro, delay, pipe, line,
  counter, select, route, gate, switchObject, trigger, pack, unpack, expr, scale, random, print,
  sig, ramp,
  button, toggle,
  numberInterface('number', {min: -Infinity, max: Infinity, float: false}),
  numberInterface('slider', {min: 0, max: 127, float: false}),
  numberInterface('dial', {min: 0, max: 127, float: false}),
  messageBox, choiceInterface('menu'), choiceInterface('tab'), multislider, matrix,
]);

