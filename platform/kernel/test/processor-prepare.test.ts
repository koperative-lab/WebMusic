import {describe, expect, it} from 'vitest';
import {
  isProcessorPrepared, prepareProcessor, ProcessorUnavailableError,
  type ProcessorDefinition,
} from '../src/processor';

const definition: ProcessorDefinition = {id: 'test.gain', version: '1.0.0'};

function fakeContext(addModule?: (url: string) => Promise<void>) {
  const loads: string[] = [];
  const context = {
    audioWorklet: {
      addModule(url: string) {
        loads.push(url);
        return addModule ? addModule(url) : Promise.resolve();
      },
    },
  } as unknown as BaseAudioContext;
  return {context, loads};
}

describe('prepareProcessor', () => {
  it('loads the worklet module once per context and definition', async () => {
    const {context, loads} = fakeContext();
    expect(isProcessorPrepared(context, definition)).toBe(false);
    const first = prepareProcessor(context, definition, {module: 'https://example.test/gain.js'});
    const second = prepareProcessor(context, {...definition}, {module: new URL('https://example.test/other.js')});
    expect(second).toBe(first);
    expect(isProcessorPrepared(context, definition)).toBe(false);
    await first;
    expect(loads).toEqual(['https://example.test/gain.js']);
    expect(isProcessorPrepared(context, definition)).toBe(true);
    await prepareProcessor(context, definition, {module: 'https://example.test/gain.js'});
    expect(loads).toHaveLength(1);
  });

  it('prepares each context separately', async () => {
    const a = fakeContext(), b = fakeContext();
    await prepareProcessor(a.context, definition, {module: '/gain.js'});
    expect(isProcessorPrepared(b.context, definition)).toBe(false);
    await prepareProcessor(b.context, definition, {module: '/gain.js'});
    expect(b.loads).toEqual(['/gain.js']);
  });

  it('rejects a different definition under the same name without loading', async () => {
    const {context, loads} = fakeContext();
    await prepareProcessor(context, definition, {module: '/gain.js'});
    await expect(prepareProcessor(context, {...definition, noteInput: true}, {module: '/changed.js'}))
      .rejects.toThrow(/different definition/);
    expect(loads).toEqual(['/gain.js']);
    expect(isProcessorPrepared(context, definition)).toBe(true);
    expect(isProcessorPrepared(context, {...definition, noteInput: true})).toBe(false);
  });

  it('forgets a failed load so a retry is an explicit new call', async () => {
    let fail = true;
    const {context, loads} = fakeContext(() => fail ? Promise.reject(new Error('404')) : Promise.resolve());
    await expect(prepareProcessor(context, definition, {module: '/gain.js'})).rejects.toThrow('404');
    expect(isProcessorPrepared(context, definition)).toBe(false);
    fail = false;
    await prepareProcessor(context, definition, {module: '/gain.js'});
    expect(loads).toHaveLength(2);
    expect(isProcessorPrepared(context, definition)).toBe(true);
  });

  it('reports a context without AudioWorklet as unavailable', async () => {
    const context = {} as BaseAudioContext;
    await expect(prepareProcessor(context, definition, {module: '/gain.js'})).rejects.toBeInstanceOf(ProcessorUnavailableError);
    expect(isProcessorPrepared(context, definition)).toBe(false);
  });

  it('lets an application register the worklet itself', async () => {
    const context = {} as BaseAudioContext;
    const seen: BaseAudioContext[] = [];
    await prepareProcessor(context, definition, {register: async received => { seen.push(received); }});
    await prepareProcessor(context, definition, {register: () => { throw new Error('not called again'); }});
    expect(seen).toEqual([context]);
    expect(isProcessorPrepared(context, definition)).toBe(true);
  });

  it('rejects invalid input as a rejection, not a throw', async () => {
    const {context, loads} = fakeContext();
    await expect(prepareProcessor(context, {id: '', version: '1'}, {module: '/x.js'})).rejects.toThrow(TypeError);
    await expect(prepareProcessor(undefined as unknown as BaseAudioContext, definition, {module: '/x.js'})).rejects.toThrow(TypeError);
    await expect(prepareProcessor(context, definition, {} as never)).rejects.toThrow(TypeError);
    expect(loads).toEqual([]);
    expect(isProcessorPrepared(context, definition)).toBe(false);
  });
});
