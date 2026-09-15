// @vitest-environment jsdom

import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

const {cleanups} = vi.hoisted(() => ({cleanups: [] as Array<() => void>}));
vi.mock('../src/components/demo-lifecycle', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/components/demo-lifecycle')>();
  return {
    ...actual,
    mountDemos: (...args: Parameters<typeof actual.mountDemos>) => {
      const cleanup = actual.mountDemos(...args);
      cleanups.push(cleanup);
      return cleanup;
    },
  };
});

const flush = async (): Promise<void> => {
  for (let i = 0; i < 6; i++) await Promise.resolve();
};
const factories = window as unknown as Record<string, unknown>;

beforeEach(() => {
  vi.resetModules();
  document.body.innerHTML = `<div data-wm-hl data-hl-factory="testHeadlessFactory" data-hl-errors='["operationError"]'>
    <div data-hl-stage></div>
    <button data-hl-command="play" data-hl-kind="action"></button>
    <p data-hl-feedback hidden></p>
  </div>`;
});

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  delete factories.testHeadlessFactory;
  document.body.replaceChildren();
  await flush();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('HeadlessPlayground lifetime', () => {
  it('releases a factory result that settles after the panel was removed', async () => {
    let resolve!: (value: unknown) => void;
    const pending = new Promise((done) => { resolve = done; });
    const instance = {object: {}, on: vi.fn(), dispose: vi.fn()};
    factories.testHeadlessFactory = () => pending;
    await import('../src/lib/headless-playground-client');
    document.body.replaceChildren();
    await flush();
    resolve(instance);
    await flush();
    expect(instance.dispose).toHaveBeenCalledOnce();
    expect(instance.on).not.toHaveBeenCalled();
  });

  it('releases subscriptions and remounts without duplicate command listeners', async () => {
    const play = vi.fn();
    const off = vi.fn();
    const dispose = vi.fn();
    const factory = vi.fn(() => ({object: {play}, on: () => off, dispose}));
    factories.testHeadlessFactory = factory;
    await import('../src/lib/headless-playground-client');
    await flush();
    const button = document.querySelector('button')!;
    button.click();
    document.dispatchEvent(new Event('astro:page-load'));
    await flush();
    expect(factory).toHaveBeenCalledOnce();
    document.dispatchEvent(new Event('astro:before-swap'));
    expect(off).toHaveBeenCalledOnce();
    expect(dispose).toHaveBeenCalledOnce();
    button.click();
    expect(play).toHaveBeenCalledOnce();
    document.dispatchEvent(new Event('astro:page-load'));
    await flush();
    button.click();
    expect(play).toHaveBeenCalledTimes(2);
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it('waits for a late factory registration without polling or duplicate construction', async () => {
    await import('../src/lib/headless-playground-client');
    const factory = vi.fn(() => ({object: {}, on: () => vi.fn(), dispose: vi.fn()}));
    factories.testHeadlessFactory = factory;
    window.dispatchEvent(new Event('wm:headless-factory-ready'));
    window.dispatchEvent(new Event('wm:headless-factory-ready'));
    await flush();
    expect(factory).toHaveBeenCalledOnce();
  });

  it('still disposes the owned instance when an unsubscribe fails', async () => {
    const dispose = vi.fn();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    factories.testHeadlessFactory = () => ({
      object: {},
      on: () => () => { throw new Error('unsubscribe failed'); },
      dispose,
    });
    await import('../src/lib/headless-playground-client');
    await flush();
    document.dispatchEvent(new Event('astro:before-swap'));
    expect(dispose).toHaveBeenCalledOnce();
  });

  it('uses resolved construction and reports real promise outcomes without a state inspector', async () => {
    document.body.innerHTML = `<div data-wm-hl data-hl-factory="testHeadlessFactory" data-hl-errors='["operationError"]'>
      <div data-hl-stage></div><button data-hl-command="seekQuarters" data-hl-kind="action"></button>
      <pre data-hl-readout></pre><p data-hl-feedback hidden></p>
    </div>`;
    const object = {state: {quarters: 0}, seekQuarters: vi.fn()};
    const invoke = vi.fn(async () => { object.state = {quarters: 4}; return {status: 'committed', quarters: 4}; });
    factories.testHeadlessFactory = () => ({object, construction: 'createScoreMapView({score})', invoke,
      on: () => () => {}, dispose: () => {}});
    await import('../src/lib/headless-playground-client');
    await flush();
    expect(document.querySelector('[data-hl-readout]')?.textContent).toBe('createScoreMapView({score})');
    document.querySelector('button')!.click();
    await flush();
    expect(invoke).toHaveBeenCalledWith('seekQuarters', []);
    expect(object.seekQuarters).not.toHaveBeenCalled();
    expect(document.querySelector('[data-hl-feedback]')?.textContent).toContain('committed');
  });

  it('repeats numeric commands with Enter without duplicating their later change event', async () => {
    document.body.innerHTML = `<div data-wm-hl data-hl-factory="testHeadlessFactory" data-hl-errors='["operationError"]'>
      <div data-hl-stage></div><input data-hl-command="noteOn" data-hl-kind="number" value="60" />
    </div>`;
    const noteOn = vi.fn();
    factories.testHeadlessFactory = () => ({object: {noteOn}, on: () => () => {}, dispose: () => {}});
    await import('../src/lib/headless-playground-client');
    await flush();
    const input = document.querySelector('input')!;
    for (let count = 0; count < 2; count += 1) input.dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', bubbles: true}));
    input.dispatchEvent(new Event('change', {bubbles: true}));
    expect(noteOn).toHaveBeenCalledTimes(2);
    input.value = '64';
    input.dispatchEvent(new Event('input', {bubbles: true}));
    input.dispatchEvent(new Event('change', {bubbles: true}));
    expect(noteOn).toHaveBeenLastCalledWith(64);
    expect(noteOn).toHaveBeenCalledTimes(3);
  });

  it('discards promise completion after Reset reconstructs the instance', async () => {
    document.body.innerHTML = `<div data-wm-hl data-hl-factory="testHeadlessFactory" data-hl-errors='["operationError"]'>
      <div data-hl-stage></div><button data-hl-command="seek" data-hl-kind="action"></button>
      <button data-hl-reset></button><p data-hl-feedback hidden></p>
    </div>`;
    let resolve!: (value: unknown) => void;
    factories.testHeadlessFactory = () => ({object: {seek: () => new Promise((done) => {resolve = done;})},
      on: () => () => {}, dispose: () => {}});
    await import('../src/lib/headless-playground-client');
    await flush();
    document.querySelector<HTMLButtonElement>('[data-hl-command]')!.click();
    document.querySelector<HTMLButtonElement>('[data-hl-reset]')!.click();
    await flush();
    resolve({status: 'committed'});
    await flush();
    expect(document.querySelector('[data-hl-feedback]')?.textContent).not.toContain('committed');
  });

  it('reports operational and command errors without an Events panel', async () => {
    let report!: (error: unknown) => void;
    factories.testHeadlessFactory = () => ({
      object: {play: () => Promise.reject(new Error('Audio unavailable'))},
      on: (_name: string, listener: typeof report) => { report = listener; return () => {}; },
      dispose: () => {},
    });
    await import('../src/lib/headless-playground-client');
    await flush();
    report({error: new Error('Route disconnected')});
    const feedback = document.querySelector<HTMLElement>('[data-hl-feedback]')!;
    expect(feedback.hidden).toBe(false);
    expect(feedback.textContent).toContain('Route disconnected');
    document.querySelector('button')!.click();
    await flush();
    expect(feedback.textContent).toContain('Audio unavailable');
  });

  it('restores visible option defaults and clears command input on Reset', async () => {
    document.body.innerHTML = `<div data-wm-hl data-hl-factory="testHeadlessFactory">
      <div data-hl-stage></div>
      <select data-hl-option="playback" data-hl-kind="enum"><option>none</option><option selected>player</option></select>
      <input data-hl-command="seek" data-hl-kind="number" />
      <button data-hl-reset></button><p data-hl-feedback></p>
    </div>`;
    const factory = vi.fn((_options: Record<string, unknown>) => ({object: {}, dispose: () => {}}));
    factories.testHeadlessFactory = factory;
    await import('../src/lib/headless-playground-client');
    await flush();
    const select = document.querySelector('select')!;
    select.value = 'none';
    document.querySelector('input')!.value = '6';
    document.querySelector('button')!.click();
    await flush();
    expect(select.value).toBe('player');
    expect(document.querySelector('input')!.value).toBe('');
    expect(factory.mock.calls.at(-1)?.[0]).toEqual({playback: 'player'});
  });

  it.each(['sync', 'promise', 'pending'] as const)('preserves operational errors over %s command feedback', async (mode) => {
    let report!: (error: unknown) => void;
    let complete!: () => void;
    const failure = () => report({error: new Error('Backend noteOff failed')});
    factories.testHeadlessFactory = () => ({
      object: {play() {
        if (mode === 'pending') return new Promise<void>((resolve) => { complete = resolve; });
        failure();
        return mode === 'promise' ? Promise.resolve() : undefined;
      }},
      on: (_name: string, listener: typeof report) => { report = listener; return () => {}; },
      dispose() {},
    });
    await import('../src/lib/headless-playground-client');
    await flush();
    document.querySelector('button')!.click();
    if (mode === 'pending') { failure(); complete(); }
    await flush();
    expect(document.querySelector('[data-hl-feedback]')?.textContent).toBe('operationError: Backend noteOff failed');
  });

  it('retains an operational error published while attaching its subscription', async () => {
    factories.testHeadlessFactory = () => ({
      object: {},
      on: (_name: string, listener: (error: unknown) => void) => {
        listener(new Error('Source unavailable'));
        return () => {};
      },
      dispose() {},
    });
    await import('../src/lib/headless-playground-client');
    await flush();
    expect(document.querySelector('[data-hl-feedback]')?.textContent).toBe('operationError: Source unavailable');
  });

  it.each(['reset', 'option', 'command'] as const)('ignores stale clipboard success and failure after a %s', async (action) => {
    document.querySelector('[data-wm-hl]')!.insertAdjacentHTML('beforeend', `
      <button data-hl-reset></button><button data-hl-copy></button>
      <input data-hl-option="speed" data-hl-kind="number" value="1" />
      <pre data-hl-readout>new Player()</pre>`);
    factories.testHeadlessFactory = () => ({object: {play() {}}, dispose() {}});
    let resolve!: () => void;
    let reject!: (error: Error) => void;
    const writeText = vi.fn(() => new Promise<void>((done, fail) => { resolve = done; reject = fail; }));
    vi.stubGlobal('navigator', {clipboard: {writeText}});
    await import('../src/lib/headless-playground-client');
    await flush();
    for (const fail of [false, true]) {
      document.querySelector<HTMLButtonElement>('[data-hl-copy]')!.click();
      if (action === 'option') {
        const option = document.querySelector<HTMLInputElement>('[data-hl-option]')!;
        option.value = '2';
        option.dispatchEvent(new Event('change', {bubbles: true}));
      } else document.querySelector<HTMLButtonElement>(action === 'reset' ? '[data-hl-reset]' : '[data-hl-command]')!.click();
      await flush();
      const expected = document.querySelector('[data-hl-feedback]')?.textContent;
      if (fail) reject(new Error('Old clipboard failure')); else resolve();
      await flush();
      expect(document.querySelector('[data-hl-feedback]')?.textContent).toBe(expected);
    }
  });
});
