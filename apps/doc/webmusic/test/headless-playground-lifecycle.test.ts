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
  it('builds the object once with its default configuration', async () => {
    const factory = vi.fn((_options: Record<string, unknown>, _stage: HTMLElement) => ({object: {}, dispose: vi.fn()}));
    factories.testHeadlessFactory = factory;
    await import('../src/lib/headless-playground-client');
    await flush();
    expect(factory).toHaveBeenCalledOnce();
    expect(factory.mock.calls[0]![0]).toEqual({});
    expect(factory.mock.calls[0]![1]).toBe(document.querySelector('[data-hl-stage]'));
  });

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

  it('releases subscriptions on navigation and builds a fresh object on return', async () => {
    const off = vi.fn();
    const dispose = vi.fn();
    const factory = vi.fn(() => ({object: {}, on: () => off, dispose}));
    factories.testHeadlessFactory = factory;
    await import('../src/lib/headless-playground-client');
    await flush();
    document.dispatchEvent(new Event('astro:page-load'));
    await flush();
    expect(factory).toHaveBeenCalledOnce();
    document.dispatchEvent(new Event('astro:before-swap'));
    expect(off).toHaveBeenCalledOnce();
    expect(dispose).toHaveBeenCalledOnce();
    document.dispatchEvent(new Event('astro:page-load'));
    await flush();
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

  it('reports construction and operational errors on the one feedback line', async () => {
    let report!: (error: unknown) => void;
    factories.testHeadlessFactory = () => ({
      object: {},
      on: (_name: string, listener: typeof report) => { report = listener; return () => {}; },
      dispose: () => {},
    });
    await import('../src/lib/headless-playground-client');
    await flush();
    const feedback = document.querySelector<HTMLElement>('[data-hl-feedback]')!;
    expect(feedback.hidden).toBe(true);
    report({error: new Error('Route disconnected')});
    expect(feedback.hidden).toBe(false);
    expect(feedback.textContent).toBe('operationError: Route disconnected');
  });

  it('reports a failed construction', async () => {
    factories.testHeadlessFactory = () => Promise.reject(new Error('Score unavailable'));
    await import('../src/lib/headless-playground-client');
    await flush();
    expect(document.querySelector('[data-hl-feedback]')?.textContent).toBe('Construction failed: Score unavailable');
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
});
