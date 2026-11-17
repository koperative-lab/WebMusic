// User scripts in a Worker (DEC-078), as Max's js object and its patcher
// scripting: code runs on its own thread with no DOM and no page state, and
// reaches the host only through messages and the functions the host offers.
//
// Scope of the isolation: a script cannot see or change the page, Studio or
// the audio graph except through what it is given, and an endless loop stalls
// only its own thread. `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`
// and `importScripts` are removed as a convenience, but a dynamic `import()`
// still reaches the network: this is not a security boundary for code you do
// not trust.
//
// Ownership: a sandbox owns its Worker and Blob URL and terminates both on
// `terminate()`. Pending calls reject then.

import {floatAtom, intAtom, message, symbolAtom, type Atom, type Message} from '../module/message';
import type {ObjectDefinition, PortSpec} from './core';
import type {JsonValue} from '../module/message';

/** The part of a Worker a sandbox uses; injectable for tests. */
export interface ScriptWorkerLike {
  onmessage: ((event: {data: unknown}) => void) | null;
  onerror: ((event: {message?: string}) => void) | null;
  postMessage(data: unknown): void;
  terminate(): void;
}

export interface ScriptSandboxOptions {
  /** Host functions the script may call as `<namespace>.<name>(...args)`; each returns a value or a promise. Arguments and results are structured-cloned. */
  readonly api?: Readonly<Record<string, (...args: never[]) => unknown>>;
  /** The global name of `api` in the script. Defaults to `host`. */
  readonly namespace?: string;
  /** Receives `post(...)` output from the script. */
  readonly onPost?: (text: string) => void;
  /** Receives `outlet(index, ...values)` from the script. */
  readonly onOutlet?: (index: number, values: readonly unknown[]) => void;
  /** Receives errors thrown by the script outside a call. */
  readonly onError?: (error: Error) => void;
  /** Create the worker from the prelude's source text. Defaults to a module-less Worker from a Blob URL. */
  readonly createWorker?: (source: string) => ScriptWorkerLike;
}

/** The source the Worker runs first. Exported for tests that run it elsewhere. */
export const SCRIPT_PRELUDE = String.raw`
'use strict';
for (const name of ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'importScripts']) {
  try { Object.defineProperty(self, name, {value: undefined, configurable: false, writable: false}); } catch {}
}
const pending = new Map();
let nextCall = 0;
const format = value => {
  if (typeof value === 'string') return value;
  try { const text = JSON.stringify(value); return text === undefined ? String(value) : text; } catch { return String(value); }
};
const post = (...values) => postMessage({type: 'post', text: values.map(format).join(' ')});
const outlet = (index, ...values) => postMessage({type: 'outlet', index, values: JSON.parse(JSON.stringify(values))});
const hostCall = (name, args) => new Promise((resolve, reject) => {
  const id = ++nextCall;
  pending.set(id, {resolve, reject});
  postMessage({type: 'host', id, name, args});
});
let program;
// Input with await runs in an async function, as a browser console does:
// top-level declarations become globals so later input sees them, and the
// last statement's value is returned when it is an expression.
const evaluateAsync = code => {
  const body = code.replace(/(^|[;\n{}])(\s*)(?:var|let|const)\s+([A-Za-z_$][\w$]*)\s*=/g, '$1$2globalThis.$3 =').trim().replace(/;+\s*$/, '');
  const cut = body.lastIndexOf(';');
  const head = body.slice(0, cut + 1), tail = body.slice(cut + 1);
  const statement = /^\s*(if|for|while|do|switch|try|return|throw|function|class|async\s+function)\b|^\s*[{}]?\s*$/.test(tail);
  if (!statement) {
    try { return (0, eval)('(async () => {\n' + head + '\nreturn (' + tail + '\n);\n})()'); }
    catch (error) { if (!(error instanceof SyntaxError)) throw error; }
  }
  return (0, eval)('(async () => {\n' + body + '\n})()');
};
self.post = post;
self.outlet = outlet;
const fail = (id, error) => postMessage({type: 'result', id, error: {name: error && error.name || 'Error', message: error && error.message || String(error)}});
self.onmessage = async ({data}) => {
  if (data.type === 'setup') {
    const space = {};
    for (const name of data.api) space[name] = (...args) => hostCall(name, args);
    self[data.namespace] = Object.freeze(space);
    return;
  }
  if (data.type === 'reply') {
    const call = pending.get(data.id);
    if (!call) return;
    pending.delete(data.id);
    if (data.error) call.reject(Object.assign(new Error(data.error.message), {name: data.error.name}));
    else call.resolve(data.value);
    return;
  }
  try {
    if (data.type === 'load') {
      program = new Function('outlet', 'post', 'let inlet = 0, messagename = "";\n' + data.code +
        '\n;return {enter(index, name) { inlet = index; messagename = name; },' +
        ' find(name) { return /^[A-Za-z_$][\\w$]*$/.test(name) ? eval("typeof " + name + " === \\"function\\" ? " + name + " : undefined") : undefined; }};')(outlet, post);
      postMessage({type: 'result', id: data.id, value: null});
    } else if (data.type === 'message') {
      if (!program) return;
      const {inlet, selector, values} = data;
      const named = selector === 'int' ? 'msg_int' : selector === 'float' ? 'msg_float' : selector;
      program.enter(inlet, selector);
      const direct = program.find(named);
      if (direct) { await direct(...values); return; }
      const anything = program.find('anything');
      if (anything) await anything(selector, ...values);
    } else if (data.type === 'eval') {
      const run = /\bawait\b/.test(data.code) ? evaluateAsync(data.code) : (0, eval)(data.code);
      const value = await run;
      postMessage({type: 'result', id: data.id, value: value === undefined ? null : JSON.parse(JSON.stringify(value) ?? 'null'), text: value === undefined ? 'undefined' : format(value)});
    }
  } catch (error) {
    if (data.id !== undefined) fail(data.id, error);
    else postMessage({type: 'error', error: {name: error && error.name || 'Error', message: error && error.message || String(error)}});
  }
};
`;

function defaultWorker(source: string): ScriptWorkerLike {
  if (typeof Worker === 'undefined' || typeof Blob === 'undefined' || typeof URL === 'undefined') throw new Error('Scripts need Web Workers.');
  const url = URL.createObjectURL(new Blob([source], {type: 'text/javascript'}));
  const worker = new Worker(url);
  // The worker has read its source; the URL is not needed again.
  URL.revokeObjectURL(url);
  return worker as unknown as ScriptWorkerLike;
}

const toError = (error: {name?: string; message?: string} | undefined) => Object.assign(new Error(error?.message ?? 'Script error'), {name: error?.name ?? 'Error'});

/** One user script on its own thread. */
export class ScriptSandbox {
  readonly #worker: ScriptWorkerLike;
  readonly #options: ScriptSandboxOptions;
  readonly #calls = new Map<number, {resolve(value: {value: unknown; text?: string}): void; reject(error: Error): void}>();
  #next = 0;
  #terminated = false;

  constructor(options: ScriptSandboxOptions = {}) {
    this.#options = options;
    this.#worker = (options.createWorker ?? defaultWorker)(SCRIPT_PRELUDE);
    this.#worker.onmessage = event => this.#receive(event.data as Record<string, unknown>);
    this.#worker.onerror = event => options.onError?.(new Error(event.message ?? 'Script error'));
    const api = options.api ?? {};
    this.#worker.postMessage({type: 'setup', namespace: options.namespace ?? 'host', api: Object.keys(api)});
  }

  get terminated(): boolean { return this.#terminated; }

  /** Compile `code` as an object script; rejects with its syntax or top-level error. */
  async load(code: string): Promise<void> { await this.#request({type: 'load', code}); }

  /** Run REPL input in the script's global scope; resolves with the value and its printed form. `await` makes it async. */
  async evaluate(code: string): Promise<{value: unknown; text: string}> {
    const result = await this.#request({type: 'eval', code});
    return {value: result.value, text: result.text ?? 'undefined'};
  }

  /** Hand a message to the loaded object script's handler; fire and forget. */
  deliver(inlet: number, value: Message): void {
    if (this.#terminated) return;
    this.#worker.postMessage({type: 'message', inlet, selector: value.selector, values: value.atoms.map(atom => atom.value)});
  }

  terminate(): void {
    if (this.#terminated) return;
    this.#terminated = true;
    this.#worker.onmessage = null;
    this.#worker.onerror = null;
    this.#worker.terminate();
    for (const call of this.#calls.values()) call.reject(new Error('The script was stopped.'));
    this.#calls.clear();
  }

  #request(data: Record<string, unknown>): Promise<{value: unknown; text?: string}> {
    if (this.#terminated) return Promise.reject(new Error('The script was stopped.'));
    const id = ++this.#next;
    return new Promise((resolve, reject) => {
      this.#calls.set(id, {resolve, reject});
      this.#worker.postMessage({...data, id});
    });
  }

  #receive(data: Record<string, unknown>): void {
    if (this.#terminated || !data || typeof data !== 'object') return;
    switch (data.type) {
      case 'post': this.#options.onPost?.(String(data.text)); return;
      case 'outlet': this.#options.onOutlet?.(Number(data.index), Array.isArray(data.values) ? data.values : []); return;
      case 'error': this.#options.onError?.(toError(data.error as never)); return;
      case 'result': {
        const call = this.#calls.get(Number(data.id));
        if (!call) return;
        this.#calls.delete(Number(data.id));
        if (data.error) call.reject(toError(data.error as never));
        else call.resolve({value: data.value, text: typeof data.text === 'string' ? data.text : undefined});
        return;
      }
      case 'host': void this.#host(Number(data.id), String(data.name), Array.isArray(data.args) ? data.args : []);
    }
  }

  async #host(id: number, name: string, args: unknown[]): Promise<void> {
    const fn = this.#options.api?.[name];
    try {
      if (!fn) throw new Error(`No host function ${name}.`);
      const value = await fn(...(args as never[]));
      if (!this.#terminated) this.#worker.postMessage({type: 'reply', id, value: value === undefined ? null : value});
    } catch (error) {
      if (!this.#terminated) this.#worker.postMessage({type: 'reply', id, error: {name: error instanceof Error ? error.name : 'Error', message: error instanceof Error ? error.message : String(error)}});
    }
  }
}

/** A script value as an atom: integers stay ints, other numbers floats, strings symbols. */
export function scriptAtom(value: unknown): Atom {
  if (typeof value === 'number') return Number.isInteger(value) ? intAtom(value) : floatAtom(value);
  if (typeof value === 'string') return symbolAtom(value);
  if (typeof value === 'boolean') return intAtom(value ? 1 : 0);
  if (Array.isArray(value)) return {type: 'array', value: value as never} as Atom;
  return {type: 'dict', value: (value ?? null) as never} as Atom;
}

/** Values from `outlet(...)` as a message: one number or symbol, a leading word as selector, else a list. */
export function scriptMessage(values: readonly unknown[]): Message {
  if (!values.length) return message('bang');
  const atoms = values.map(scriptAtom);
  const [first, ...rest] = atoms;
  if (atoms.length === 1) return message(first!.type === 'int' ? 'int' : first!.type === 'float' ? 'float' : first!.type === 'symbol' ? 'symbol' : 'list', atoms);
  if (first!.type === 'symbol') return message((first as {value: string}).value, rest);
  return message('list', atoms);
}

const count = (atom: Atom | undefined, fallback: number) => atom && (atom.type === 'int') && atom.value >= 1 && atom.value <= 16 ? atom.value : fallback;
const ports = (n: number, label: string): PortSpec[] => Array.from({length: n}, (_, index) => ({label: `${label} ${index}`}));

/**
 * `js [inlets=1] [outlets=1]`: the code in `config.state.code` runs in a
 * ScriptSandbox. A message at inlet i calls the function named by its
 * selector (`bang`, `msg_int`, `msg_float`, `list`, or any word), else
 * `anything(selector, …values)`, with `inlet` and `messagename` set. The
 * script sends with `outlet(index, …values)` and writes to the console with
 * `post(…)`. Outputs arrive asynchronously and untimed.
 */
export const JS_DEFINITION: ObjectDefinition = Object.freeze<ObjectDefinition>({
    name: 'js',
    inlets: args => ports(count(args[0], 1), 'messages to the script, inlet'),
    outlets: args => ports(count(args[1], 1), 'outlet'),
    create(context) {
      const state = context.state as {code?: unknown} | undefined;
      const code = typeof state?.code === 'string' ? state.code : 'function bang() { outlet(0, "bang"); }';
      const outlets = count(context.args[1], 1);
      let sandbox: ScriptSandbox | undefined;
      try {
        sandbox = new ScriptSandbox({
          createWorker: context.environment.createScriptWorker,
          onPost: text => { if (context.environment.print) context.environment.print('js', text, context.id); else console.log(`js: ${text}`); },
          onOutlet: (index, values) => { if (Number.isInteger(index) && index >= 0 && index < outlets) context.out(index, scriptMessage(values)); },
          onError: error => context.fail(error),
        });
        sandbox.load(code).catch(error => context.fail(error));
      } catch (error) { context.fail(error); }
      return {
        receive: (index, value) => sandbox?.deliver(index, value),
        state: () => ({code}),
        dispose: () => sandbox?.terminate(),
      };
    },
});

/** The `js` object's state, for editors that change its code. */
export function scriptState(code: string): JsonValue { return {code}; }
