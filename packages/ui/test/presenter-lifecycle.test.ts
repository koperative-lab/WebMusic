// @vitest-environment jsdom

import {afterEach, describe, expect, it, vi} from 'vitest';
import {mountMixer} from '../src/mixer';
import {mountMacro, mountMacroRack} from '../src/macro';
import {mountRecorder} from '../src/recorder';
import * as faders from '../src/fader';

interface Handle {
  element: HTMLElement;
  update(): void;
  destroy(): void;
}

interface Hooks {
  read?: () => void;
  subscribe?: (notify: () => void) => () => void;
  onError?: (error: unknown) => void;
  command?: () => Promise<void> | void;
}

const macroBinding = (hooks: Hooks) => ({
  snapshot: () => {
    hooks.read?.();
    return {label: 'Macro', value: 0.5, targets: []};
  },
  setValue: () => hooks.command?.(),
  subscribe: hooks.subscribe,
});

const presenters: {name: string; mount: (host: HTMLElement, hooks: Hooks) => Handle; act: (root: HTMLElement) => void}[] = [
  {
    name: 'Mixer',
    mount: (host, hooks) => mountMixer(host, {
      snapshot: () => {
        hooks.read?.();
        return {master: 0.5, channels: [{id: 'piano', label: 'Piano', value: 0.5}]};
      },
      setMaster: () => {},
      setChannel: () => {},
      play: () => hooks.command?.(),
      subscribe: hooks.subscribe,
    }, {onError: hooks.onError}),
    act: (root) => root.querySelector<HTMLButtonElement>('[part~="play"]')!.click(),
  },
  {
    name: 'Recorder',
    mount: (host, hooks) => mountRecorder(host, {
      snapshot: () => {
        hooks.read?.();
        return {recording: false};
      },
      toggleRecording: () => hooks.command?.(),
      subscribe: hooks.subscribe,
    }, {onError: hooks.onError}),
    act: (root) => root.querySelector<HTMLButtonElement>('[part="record"]')!.click(),
  },
  ...[false, true].map((rack) => ({
    name: rack ? 'Macro rack' : 'Macro',
    mount: (host: HTMLElement, hooks: Hooks): Handle => rack
      ? mountMacroRack(host, [macroBinding(hooks)], {onError: hooks.onError})
      : mountMacro(host, macroBinding(hooks), {onError: hooks.onError}),
    act: (root: HTMLElement) => {
      const input = root.querySelector<HTMLInputElement>('input[type="range"]')!;
      input.value = '0.75';
      input.dispatchEvent(new Event('input', {bubbles: true}));
    },
  })),
];

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe.each(presenters)('$name lifecycle', ({mount, act}) => {
  it('contains subscription setup and reporter failures without losing a usable handle', () => {
    const host = document.createElement('div');
    const failure = new Error('subscribe failed');
    const onError = vi.fn(() => { throw new Error('report failed'); });
    let handle: Handle | undefined;
    expect(() => {
      handle = mount(host, {subscribe: () => { throw failure; }, onError});
    }).not.toThrow();
    expect(onError).toHaveBeenCalledOnce();
    expect(onError).toHaveBeenCalledWith(failure);
    expect(handle!.element.parentNode).toBe(host);
    expect(() => handle!.update()).not.toThrow();
    handle!.destroy();
    expect(host.childElementCount).toBe(0);
  });

  it('finishes cleanup once despite a throwing unsubscribe and reporter', () => {
    const host = document.createElement('div');
    const foreign = document.createElement('p');
    host.append(foreign);
    const failure = new Error('unsubscribe failed');
    const stop = vi.fn(() => { throw failure; });
    const onError = vi.fn(() => { throw new Error('report failed'); });
    const handle = mount(host, {subscribe: () => stop, onError});
    expect(() => handle.destroy()).not.toThrow();
    expect(() => handle.destroy()).not.toThrow();
    expect(stop).toHaveBeenCalledOnce();
    expect(onError).toHaveBeenCalledOnce();
    expect(onError).toHaveBeenCalledWith(failure);
    expect([...host.children]).toEqual([foreign]);
    mount(host, {}).destroy();
    expect([...host.children]).toEqual([foreign]);
  });

  it('contains asynchronous error-sink rejections at setup and cleanup', async () => {
    const host = document.createElement('div');
    const failure = new Error('subscription failed');
    const onError = vi.fn(async () => { throw new Error('async report failed'); });
    mount(host, {subscribe: () => { throw failure; }, onError}).destroy();
    mount(host, {subscribe: () => () => { throw failure; }, onError}).destroy();
    await Promise.resolve();
    await Promise.resolve();
    expect(onError).toHaveBeenCalledTimes(2);
    expect(host.childElementCount).toBe(0);
  });

  it('keeps the replacement mounted by a subscription error callback', () => {
    const host = document.createElement('div');
    let replacement: Handle | undefined;
    const failure = new Error('subscribe failed');
    const onError = vi.fn(() => { replacement = mount(host, {}); });
    const stale = mount(host, {subscribe: () => { throw failure; }, onError});
    expect(onError).toHaveBeenCalledWith(failure);
    expect(stale.element.parentNode).toBeNull();
    expect(replacement!.element.parentNode).toBe(host);
    stale.destroy();
    replacement!.destroy();
    expect(host.childElementCount).toBe(0);
  });

  it('releases a late subscription after a synchronous notification replaces its mount', () => {
    const host = document.createElement('div');
    const stop = vi.fn();
    let reads = 0;
    let replacement: Handle | undefined;
    const stale = mount(host, {
      read: () => {
        reads += 1;
        if (reads === 2) replacement = mount(host, {});
      },
      subscribe: (notify) => {
        notify();
        return stop;
      },
    });
    expect(stop).toHaveBeenCalledOnce();
    expect(replacement!.element.parentNode).toBe(host);
    expect(stale.element.parentNode).toBeNull();
    stale.update();
    stale.destroy();
    expect(reads).toBe(2);
    expect(stop).toHaveBeenCalledOnce();
    replacement!.destroy();
    expect(host.childElementCount).toBe(0);
  });

  it('does not subscribe when the first snapshot replaces its mount', () => {
    const host = document.createElement('div');
    let replacement: Handle | undefined;
    const subscribe = vi.fn(() => () => {});
    const stale = mount(host, {read: () => { replacement = mount(host, {}); }, subscribe});
    expect(subscribe).not.toHaveBeenCalled();
    expect(stale.element.parentNode).toBeNull();
    expect(replacement!.element.parentNode).toBe(host);
    stale.destroy();
    replacement!.destroy();
    expect(host.childElementCount).toBe(0);
  });

  it('keeps a replacement mounted during the previous unsubscribe as sole owner', () => {
    const host = document.createElement('div');
    let replacement: Handle | undefined;
    mount(host, {subscribe: () => () => { replacement = mount(host, {}); }});
    const subscribe = vi.fn(() => () => {});
    const attempted = mount(host, {subscribe});
    expect(subscribe).not.toHaveBeenCalled();
    expect(attempted.element.parentNode).toBeNull();
    expect(replacement!.element.parentNode).toBe(host);
    attempted.destroy();
    replacement!.destroy();
    expect(host.childElementCount).toBe(0);
  });

  it('ignores commands and pending rejections after destruction', async () => {
    const host = document.createElement('div');
    let reject!: (error: unknown) => void;
    const pending = new Promise<void>((_resolve, fail) => { reject = fail; });
    const command = vi.fn(() => pending);
    const onError = vi.fn();
    const handle = mount(host, {command, onError});
    const control = handle.element.querySelector<HTMLElement>('button, input[type="range"]')!;
    act(handle.element);
    expect(command).toHaveBeenCalledOnce();
    handle.destroy();
    control.click();
    reject(new Error('late command'));
    await Promise.resolve();
    await Promise.resolve();
    expect(command).toHaveBeenCalledOnce();
    expect(onError).not.toHaveBeenCalled();
    expect(host.childElementCount).toBe(0);
  });
});

it('releases every Mixer fader when a child destroy fails', () => {
  const originalCreate = faders.createFader;
  const destroyed: number[] = [];
  const failure = new Error('fader cleanup failed');
  let sequence = 0;
  vi.spyOn(faders, 'createFader').mockImplementation((...args) => {
    const control = originalCreate(...args);
    const originalDestroy = control.destroy;
    const id = sequence++;
    control.destroy = () => {
      originalDestroy();
      destroyed.push(id);
      if (id === 1) throw failure;
    };
    return control;
  });
  const host = document.createElement('div');
  const onError = vi.fn();
  const handle = mountMixer(host, {
    snapshot: () => ({master: 1, channels: [
      {id: 'one', label: 'One', value: 1},
      {id: 'two', label: 'Two', value: 1},
    ]}),
    setMaster: () => {}, setChannel: () => {},
  }, {onError});
  handle.destroy();
  expect(destroyed).toEqual([1, 2, 0]);
  expect(onError).toHaveBeenCalledWith(failure);
  expect(host.childElementCount).toBe(0);
});

it('continues Macro rack cleanup after a child handle throws', () => {
  const host = document.createElement('div');
  const stop = vi.fn();
  const onError = vi.fn();
  const failure = new Error('child cleanup failed');
  const handle = mountMacroRack(host, [macroBinding({}), macroBinding({subscribe: () => stop})], {onError});
  const first = handle.items[0]!;
  const destroyFirst = first.destroy;
  first.destroy = () => { destroyFirst(); throw failure; };
  handle.destroy();
  expect(stop).toHaveBeenCalledOnce();
  expect(onError).toHaveBeenCalledWith(failure);
  expect(host.childElementCount).toBe(0);
});
