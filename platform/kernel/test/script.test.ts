import vm from 'node:vm';
import {afterEach, describe, expect, it} from 'vitest';
import {ManualMessageClock, ModuleAudioEnvironment, ModuleProjectRuntime, ProjectPluginRegistry, formatMessage, parseMessage, parseModuleProject, type Message} from '../src/module';
import {ScriptSandbox, createObjectPlugins, scriptMessage, type ScriptWorkerLike} from '../src/objects';
import {FakeContext} from './processor-fakes';

/** Runs the prelude in a fresh VM context, as a Worker would, with cloned messages between threads. */
function vmWorker(source: string): ScriptWorkerLike {
  const worker: ScriptWorkerLike = {onmessage: null, onerror: null, postMessage: data => { queueMicrotask(() => (global.onmessage as ((event: {data: unknown}) => void) | null)?.({data: structuredClone(data)})); }, terminate() {}};
  const global: Record<string, unknown> = {console, structuredClone, queueMicrotask, postMessage: (data: unknown) => queueMicrotask(() => worker.onmessage?.({data: structuredClone(data)}))};
  global.self = global;
  vm.runInContext(source, vm.createContext(global));
  return worker;
}
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

describe('ScriptSandbox', () => {
  it('runs REPL input in a persistent global scope and calls host functions', async () => {
    const calls: unknown[][] = [];
    const posted: string[] = [];
    const sandbox = new ScriptSandbox({createWorker: vmWorker, namespace: 'patch', onPost: text => posted.push(text),
      api: {add: (text: string) => { calls.push(['add', text]); return 'obj1'; }, fail: () => { throw new Error('no such object'); }}});
    expect((await sandbox.evaluate('var count = 2; count * 21')).text).toBe('42');
    expect((await sandbox.evaluate('const id = await patch.add("metro 4n"); post("made", id); id')).text).toBe('obj1');
    expect((await sandbox.evaluate('id + "!"')).text).toBe('obj1!');
    expect((await sandbox.evaluate('for (const x of [1]) { await patch.add("x" + x); }')).text).toBe('undefined');
    expect(calls).toEqual([['add', 'metro 4n'], ['add', 'x1']]);
    expect(posted).toEqual(['made obj1']);
    expect((await sandbox.evaluate('count + 1')).value).toBe(3);
    await expect(sandbox.evaluate('await patch.fail()')).rejects.toThrow('no such object');
    await expect(sandbox.evaluate('nope(')).rejects.toMatchObject({name: 'SyntaxError'});
    expect((await sandbox.evaluate('[typeof fetch, typeof WebSocket, typeof importScripts]')).value).toEqual(['undefined', 'undefined', 'undefined']);
    sandbox.terminate();
    await expect(sandbox.evaluate('1')).rejects.toThrow('stopped');
  });

  it('turns outlet values into messages', () => {
    expect(formatMessage(scriptMessage([3]))).toBe('3');
    expect(formatMessage(scriptMessage([0.5]))).toBe('0.5');
    expect(scriptMessage(['set', 2])).toMatchObject({selector: 'set'});
    expect(scriptMessage([1, 'a']).selector).toBe('list');
    expect(scriptMessage([]).selector).toBe('bang');
  });
});

describe('js object', () => {
  const runtimes: ModuleProjectRuntime[] = [];
  afterEach(() => { for (const runtime of runtimes.splice(0)) runtime.dispose(); });

  it('calls handlers by selector and sends from its outlets', async () => {
    const audio = new FakeContext();
    const printed: string[] = [];
    const failures: unknown[] = [];
    const plugins = new ProjectPluginRegistry();
    for (const plugin of createObjectPlugins({clock: () => new ManualMessageClock(0), createScriptWorker: vmWorker, print: (name, text) => printed.push(`${name}: ${text}`), onError: error => failures.push(error)})) plugins.register(plugin);
    const runtime = new ModuleProjectRuntime({audio: new ModuleAudioEnvironment({context: audio as unknown as BaseAudioContext}), plugins});
    runtimes.push(runtime);
    const code = `
      let total = 0;
      function msg_int(v) { total += v; outlet(0, total); }
      function bang() { outlet(1, 'reset', inlet); total = 0; }
      function anything(name, ...values) { post(name, messagename, values.length); }`;
    await runtime.restore(parseModuleProject({schema: 'webmusic.module-project', version: 1, id: 's', contexts: [{id: 'root'}],
      modules: [
        {id: 'js', contextId: 'root', plugin: {id: 'webmusic.object.js', version: '1.0.0'}, config: {args: '2 2', state: {code}}},
        {id: 'sum', contextId: 'root', plugin: {id: 'webmusic.object.print', version: '1.0.0'}, config: {args: 'sum'}},
        {id: 'other', contextId: 'root', plugin: {id: 'webmusic.object.print', version: '1.0.0'}, config: {args: 'other'}},
      ],
      connections: [
        {id: 'a', kind: 'message', from: {moduleId: 'js', port: 'out0'}, to: {moduleId: 'sum', port: 'in0'}},
        {id: 'b', kind: 'message', from: {moduleId: 'js', port: 'out1'}, to: {moduleId: 'other', port: 'in0'}},
      ]}));
    const inlet = (index: number) => runtime.getModule('js')!.ports!().find(port => port.id === `in${index}`) as unknown as {receive(value: Message): void};
    await settle();
    inlet(0).receive(parseMessage('2'));
    inlet(0).receive(parseMessage('5'));
    inlet(1).receive(parseMessage('bang'));
    inlet(0).receive(parseMessage('color red 3'));
    await settle(); await settle();
    expect(printed).toEqual(['sum: 2', 'sum: 7', 'other: reset 1', 'js: color color 2']);
    expect(runtime.exportProject().modules[0]!.config).toMatchObject({state: {code}});
    expect(failures).toEqual([]);
  });

  it('reports a script that does not compile', async () => {
    const failures: unknown[] = [];
    const plugins = new ProjectPluginRegistry();
    for (const plugin of createObjectPlugins({createScriptWorker: vmWorker, onError: error => failures.push(error)})) plugins.register(plugin);
    const runtime = new ModuleProjectRuntime({audio: new ModuleAudioEnvironment({context: new FakeContext() as unknown as BaseAudioContext}), plugins});
    runtimes.push(runtime);
    await runtime.restore(parseModuleProject({schema: 'webmusic.module-project', version: 1, id: 'e', contexts: [{id: 'root'}],
      modules: [{id: 'js', contextId: 'root', plugin: {id: 'webmusic.object.js', version: '1.0.0'}, config: {args: '', state: {code: 'function ('}}}]}));
    await settle(); await settle();
    expect(String(failures[0])).toMatch(/SyntaxError/);
  });
});
