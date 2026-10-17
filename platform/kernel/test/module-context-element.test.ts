// @vitest-environment jsdom
import {afterEach, describe, expect, it, vi} from 'vitest';
import {ModuleAudioEnvironment, ModuleContext, createModuleHandle, type ModuleHandle} from '../src/module';
import {
  getModuleContextState, hasModuleContextBoundary, isModularComposition,
  notifyModuleChange, notifyModuleContext, observeModuleContext, observeModuleTarget,
  provideModuleContext, requestModuleContext,
} from '../src/elements';

const cleanups: Array<() => void> = [];
const flush = () => new Promise(resolve => setTimeout(resolve, 0));
let sequence = 0;
const context = (id: string) => new ModuleContext({
  id, audio: new ModuleAudioEnvironment({create() { throw new Error('Discovery must not allocate audio'); }}),
});

afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
  document.body.replaceChildren();
});

describe('module context discovery', () => {
  it('borrows the nearest custom provider across shadow roots and skips its own upstream request', () => {
    const tag = `rack-provider-${++sequence}`;
    customElements.define(tag, class extends HTMLElement {});
    const outer = document.createElement('section');
    outer.setAttribute('composition', 'modules');
    const rack = document.createElement(tag);
    const child = document.createElement('span');
    rack.attachShadow({mode: 'open'}).append(child);
    outer.append(rack);
    document.body.append(outer);
    const rootContext = context('root');
    const rackContext = rootContext.derive({id: 'rack'});
    cleanups.push(provideModuleContext(outer, () => rootContext));
    cleanups.push(provideModuleContext(rack, () => rackContext));
    expect(requestModuleContext(rack)).toBe(rootContext);
    expect(requestModuleContext(child)).toBe(rackContext);
    expect(isModularComposition(child)).toBe(true);
    expect(rootContext.audio.peek()).toBeUndefined();
  });

  it('keeps pending boundaries distinct from a genuine root and does not fall through', () => {
    const root = document.createElement('div');
    root.setAttribute('composition', 'modules');
    const inner = document.createElement('div');
    const child = document.createElement('span');
    root.append(inner); inner.append(child); document.body.append(root);
    cleanups.push(provideModuleContext(root, () => context('outer')));
    let available: ModuleContext | undefined = undefined;
    cleanups.push(provideModuleContext(inner, () => available));
    const observed = vi.fn();
    cleanups.push(observeModuleContext(child, observed));
    expect(observed).toHaveBeenLastCalledWith(undefined, 'pending');
    expect(hasModuleContextBoundary(child)).toBe(true);
    expect(getModuleContextState(root)).toBe('missing');
    available = context('inner');
    notifyModuleContext(inner);
    expect(observed).toHaveBeenLastCalledWith(available, 'ready');
  });

  it('waits for an unknown custom ancestor in modular mode and does not revive released observations', async () => {
    const tag = `late-rack-${++sequence}`;
    const root = document.createElement('div');
    root.setAttribute('composition', 'modules');
    const inner = document.createElement(tag);
    const child = document.createElement('span');
    inner.append(child); root.append(inner); document.body.append(root);
    cleanups.push(provideModuleContext(root, () => context('outer')));
    const observed = vi.fn();
    const stop = observeModuleContext(child, observed);
    expect(observed).toHaveBeenLastCalledWith(undefined, 'pending');
    const inside = context('inside');
    customElements.define(tag, class extends HTMLElement {
      connectedCallback() { cleanups.push(provideModuleContext(this, () => inside)); }
    });
    await flush();
    expect(observed).toHaveBeenLastCalledWith(inside, 'ready');
    stop();
    const count = observed.mock.calls.length;
    notifyModuleContext(inner);
    await flush();
    expect(observed).toHaveBeenCalledTimes(count);
  });

  it('does not turn an unrelated legacy custom layout wrapper into a modular boundary', () => {
    const layout = document.createElement('unregistered-layout-wrapper');
    const child = document.createElement('span');
    layout.append(child); document.body.append(layout);
    expect(isModularComposition(child)).toBe(false);
    expect(hasModuleContextBoundary(child)).toBe(false);
    expect(getModuleContextState(child)).toBe('missing');
  });

  it('follows explicit provider replacement without stale cleanup removing the new provider', () => {
    const host = document.createElement('div');
    const child = document.createElement('span');
    host.append(child); document.body.append(host);
    const first = context('first');
    const second = context('second');
    const stopFirst = provideModuleContext(host, () => first);
    stopFirst();
    cleanups.push(provideModuleContext(host, () => second));
    stopFirst();
    expect(requestModuleContext(child)).toBe(second);
  });

  it.each(['open', 'closed'] as const)('borrows a %s shadow slot provider and observes reassignment', async (mode) => {
    const shell = document.createElement('div');
    shell.setAttribute('composition', 'modules');
    const root = shell.attachShadow({mode});
    const first = document.createElement('slot');
    const second = document.createElement('slot');
    first.name = 'selected';
    second.name = 'other';
    root.append(first, second);
    const child = document.createElement('span');
    child.slot = 'selected';
    shell.append(child);
    document.body.append(shell);
    const outer = context('outer');
    const local = context('slot-first');
    const replacement = context('slot-second');
    cleanups.push(provideModuleContext(shell, () => outer));
    cleanups.push(provideModuleContext(first, () => local));
    cleanups.push(provideModuleContext(second, () => replacement));
    const callback = vi.fn();
    cleanups.push(observeModuleContext(child, callback));
    expect(callback).toHaveBeenLastCalledWith(local, 'ready');
    // This mutation is inside the private root; document observers cannot see
    // it and the native slotchange itself is not a composed event.
    first.name = 'unused';
    second.name = 'selected';
    await flush();
    expect(callback).toHaveBeenLastCalledWith(replacement, 'ready');
    expect(outer.audio.peek()).toBeUndefined();
  });

  it('keeps a pending closed-root slot from falling through to the host provider', () => {
    const shell = document.createElement('div');
    const root = shell.attachShadow({mode: 'closed'});
    const slot = document.createElement('slot');
    root.append(slot);
    const child = document.createElement('span');
    shell.append(child); document.body.append(shell);
    cleanups.push(provideModuleContext(shell, () => context('outer')));
    cleanups.push(provideModuleContext(slot, () => undefined));
    expect(requestModuleContext(child)).toBeUndefined();
    expect(getModuleContextState(child)).toBe('pending');
  });

  it('moves observations across closed shadow roots and stops listening to the old provider', async () => {
    const firstShell = document.createElement('div');
    const secondShell = document.createElement('div');
    document.body.append(firstShell, secondShell);
    const firstRoot = firstShell.attachShadow({mode: 'closed'});
    const secondRoot = secondShell.attachShadow({mode: 'closed'});
    const firstProvider = document.createElement('section');
    const secondProvider = document.createElement('section');
    firstRoot.append(firstProvider);
    secondRoot.append(secondProvider);
    const child = document.createElement('span');
    firstProvider.append(child);
    let first = context('first');
    let second = context('second');
    cleanups.push(provideModuleContext(firstProvider, () => first));
    cleanups.push(provideModuleContext(secondProvider, () => second));
    const callback = vi.fn();
    const stop = observeModuleContext(child, callback);
    cleanups.push(stop);
    expect(callback).toHaveBeenLastCalledWith(first, 'ready');
    secondProvider.append(child);
    await flush();
    expect(callback).toHaveBeenLastCalledWith(second, 'ready');
    second = context('second-replaced');
    notifyModuleContext(secondProvider);
    expect(callback).toHaveBeenLastCalledWith(second, 'ready');
    const count = callback.mock.calls.length;
    first = context('old-replaced');
    notifyModuleContext(firstProvider);
    expect(callback).toHaveBeenCalledTimes(count);
    stop();
    notifyModuleContext(secondProvider);
    expect(callback).toHaveBeenCalledTimes(count);
  });
});

describe('explicit module target observations', () => {
  it('has no implicit fallback, handles readiness/replacement and releases its subscriptions', async () => {
    const host = document.createElement('div'); document.body.append(host);
    const callback = vi.fn();
    const stop = observeModuleTarget(host, '#target', callback);
    expect(callback).toHaveBeenLastCalledWith(undefined);
    const target = document.createElement('div') as HTMLDivElement & {module?: ModuleHandle};
    target.id = 'target';
    document.body.append(target);
    await flush();
    const off = vi.fn();
    const module = createModuleHandle({id: 'lead', subscribe: () => off});
    target.module = module;
    notifyModuleChange(target);
    expect(callback).toHaveBeenLastCalledWith(module);
    target.remove();
    await flush();
    expect(callback).toHaveBeenLastCalledWith(undefined);
    expect(off).toHaveBeenCalledTimes(1);
    stop(); stop();
    const count = callback.mock.calls.length;
    document.body.append(target);
    await flush();
    expect(callback).toHaveBeenCalledTimes(count);
  });

  it('produces one initial callback for a module with an immediate subscription', () => {
    const host = document.createElement('div');
    const target = document.createElement('div') as HTMLDivElement & {module?: ModuleHandle};
    target.id = 'target';
    target.module = createModuleHandle({id: 'lead', subscribe(listener) { listener(); return () => {}; }});
    document.body.append(host, target);
    const callback = vi.fn();
    cleanups.push(observeModuleTarget(host, '#target', callback));
    expect(callback).toHaveBeenCalledExactlyOnceWith(target.module);
  });

  it('rejects ambiguous explicit selection instead of binding an arbitrary module', () => {
    const host = document.createElement('div');
    const first = document.createElement('div'); first.className = 'target';
    const second = first.cloneNode() as HTMLElement;
    document.body.append(host, first, second);
    const callback = vi.fn();
    cleanups.push(observeModuleTarget(host, '.target', callback));
    expect(callback).toHaveBeenLastCalledWith(undefined);
  });

  it('releases an immediate module subscription when the initial callback throws', async () => {
    const host = document.createElement('span');
    const target = document.createElement('div') as HTMLDivElement & {module?: ModuleHandle};
    target.id = 'target';
    const off = vi.fn();
    target.module = {id: 'lead', subscribe(listener) { listener(); return off; }};
    document.body.append(host, target);
    const failure = new Error('initial callback');
    const callback = vi.fn(() => { throw failure; });
    expect(() => observeModuleTarget(host, '#target', callback)).toThrow(failure);
    expect(off).toHaveBeenCalledOnce();
    notifyModuleChange(target);
    target.remove();
    await flush();
    expect(callback).toHaveBeenCalledOnce();
  });

  it('invalidates a callback captured by a subscription that throws before returning cleanup', async () => {
    const host = document.createElement('span');
    const target = document.createElement('div') as HTMLDivElement & {module?: ModuleHandle};
    target.id = 'target';
    let late: (() => void) | undefined;
    const failure = new Error('subscribe failed');
    target.module = {id: 'lead', subscribe(listener) { late = listener; listener(); throw failure; }};
    document.body.append(host, target);
    const callback = vi.fn();
    expect(() => observeModuleTarget(host, '#target', callback)).toThrow(failure);
    late?.();
    notifyModuleChange(target);
    target.remove();
    await flush();
    expect(callback).not.toHaveBeenCalled();
  });

  it('retires a synchronously superseded subscription before notifying the current module', () => {
    const host = document.createElement('span');
    const target = document.createElement('div') as HTMLDivElement & {module?: ModuleHandle};
    target.id = 'target';
    document.body.append(host, target);
    const firstOff = vi.fn();
    const secondOff = vi.fn();
    let stale: (() => void) | undefined;
    const second: ModuleHandle = {id: 'second', subscribe: () => secondOff};
    target.module = {id: 'first', subscribe(listener) {
      stale = listener;
      listener();
      target.module = second;
      notifyModuleChange(target);
      return firstOff;
    }};
    const callback = vi.fn();
    const stop = observeModuleTarget(host, '#target', callback);
    cleanups.push(stop);
    expect(firstOff).toHaveBeenCalledOnce();
    expect(callback).toHaveBeenCalledExactlyOnceWith(second);
    stale?.();
    expect(callback).toHaveBeenCalledOnce();
    stop();
    expect(secondOff).toHaveBeenCalledOnce();
  });

  it('handles unsubscribe reentry without losing the replacement subscription', () => {
    const host = document.createElement('span');
    const target = document.createElement('div') as HTMLDivElement & {module?: ModuleHandle};
    target.id = 'target';
    document.body.append(host, target);
    const secondOff = vi.fn();
    const secondSubscribe = vi.fn(() => secondOff);
    const second: ModuleHandle = {id: 'second', subscribe: secondSubscribe};
    target.module = {id: 'first', subscribe: () => () => notifyModuleChange(target)};
    const callback = vi.fn();
    const stop = observeModuleTarget(host, '#target', callback);
    cleanups.push(stop);
    target.module = second;
    notifyModuleChange(target);
    expect(secondSubscribe).toHaveBeenCalledOnce();
    expect(callback).toHaveBeenLastCalledWith(second);
    stop();
    expect(secondOff).toHaveBeenCalledOnce();
  });

  it('rebinds a selector in the current shadow root after a connected host moves', async () => {
    const firstShell = document.createElement('div');
    const secondShell = document.createElement('div');
    document.body.append(firstShell, secondShell);
    const firstRoot = firstShell.attachShadow({mode: 'closed'});
    const secondRoot = secondShell.attachShadow({mode: 'closed'});
    const first = document.createElement('div') as HTMLDivElement & {module?: ModuleHandle};
    const second = document.createElement('div') as HTMLDivElement & {module?: ModuleHandle};
    first.id = second.id = 'selected';
    const firstOff = vi.fn();
    first.module = {id: 'first', subscribe: () => firstOff};
    second.module = {id: 'second'};
    const host = document.createElement('span');
    firstRoot.append(first, host);
    secondRoot.append(second);
    const callback = vi.fn();
    cleanups.push(observeModuleTarget(host, '#selected', callback));
    expect(callback).toHaveBeenLastCalledWith(first.module);
    secondRoot.append(host);
    await flush();
    expect(callback).toHaveBeenLastCalledWith(second.module);
    expect(firstOff).toHaveBeenCalledOnce();
    const count = callback.mock.calls.length;
    notifyModuleChange(first);
    expect(callback).toHaveBeenCalledTimes(count);
    second.module = {id: 'second-replaced'};
    notifyModuleChange(second);
    expect(callback).toHaveBeenLastCalledWith(second.module);
  });
});
