// @vitest-environment jsdom

import {afterEach, describe, expect, it, vi} from 'vitest';
import {observeElementTarget} from '../src/elements';

const cleanups: Array<() => void> = [];
let nextTag = 0;
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  document.body.replaceChildren();
});

describe('observeElementTarget', () => {
  it('reports invalid, missing and ambiguous selectors without choosing another target', () => {
    const host = document.createElement('div');
    document.body.append(host);
    for (const [selector, state] of [['[', 'invalid'], ['#absent', 'missing']] as const) {
      const listener = vi.fn();
      cleanups.push(observeElementTarget(host, selector, listener));
      expect(listener).toHaveBeenLastCalledWith(undefined, state);
    }
    const first = document.createElement('div');
    const second = document.createElement('div');
    first.className = second.className = 'owner';
    document.body.append(first, second);
    const listener = vi.fn();
    cleanups.push(observeElementTarget(host, '.owner', listener));
    expect(listener).toHaveBeenLastCalledWith(undefined, 'ambiguous');
  });

  it('follows late insertion, replacement and removal, and stops after cleanup', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    const listener = vi.fn();
    const stop = observeElementTarget(host, '#owner', listener);
    cleanups.push(stop);
    const first = document.createElement('div');
    first.id = 'owner';
    document.body.append(first);
    await flush();
    expect(listener).toHaveBeenLastCalledWith(first, 'ready');
    const replacement = first.cloneNode() as HTMLElement;
    first.replaceWith(replacement);
    await flush();
    expect(listener).toHaveBeenLastCalledWith(replacement, 'ready');
    replacement.remove();
    await flush();
    expect(listener).toHaveBeenLastCalledWith(undefined, 'missing');
    stop();
    stop();
    const calls = listener.mock.calls.length;
    document.body.append(first);
    await flush();
    expect(listener).toHaveBeenCalledTimes(calls);
  });

  it('keeps discovery inside the caller ShadowRoot', () => {
    const outside = document.createElement('div');
    outside.id = 'owner';
    const shell = document.createElement('div');
    document.body.append(outside, shell);
    const root = shell.attachShadow({mode: 'open'});
    const host = document.createElement('div');
    const inside = document.createElement('div');
    inside.id = 'owner';
    root.append(host, inside);
    const listener = vi.fn();
    cleanups.push(observeElementTarget(host, '#owner', listener));
    expect(listener).toHaveBeenCalledExactlyOnceWith(inside, 'ready');
  });

  it('reconnects the same target after custom-element upgrade or explicit source change', async () => {
    const name = `webmusic-target-test-${nextTag++}`;
    const host = document.createElement('div');
    const target = document.createElement(name);
    target.id = 'owner';
    document.body.append(host, target);
    const listener = vi.fn();
    cleanups.push(observeElementTarget(host, '#owner', listener));
    customElements.define(name, class extends HTMLElement {});
    await flush();
    expect(listener).toHaveBeenCalledTimes(2);
    target.dispatchEvent(new Event('webmusic:sourcechange', {bubbles: true}));
    expect(listener).toHaveBeenCalledTimes(3);
  });

  it('does not deliver a pending custom-element upgrade after cleanup', async () => {
    const name = `webmusic-target-test-${nextTag++}`;
    const host = document.createElement('div');
    const target = document.createElement(name);
    document.body.append(host, target);
    const listener = vi.fn();
    const stop = observeElementTarget(host, name, listener);
    stop();
    customElements.define(name, class extends HTMLElement {});
    await flush();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('does not reconnect another target when an unrelated source changes', () => {
    const host = document.createElement('div');
    const target = document.createElement('div');
    target.id = 'owner';
    const unrelated = document.createElement('div');
    document.body.append(host, target, unrelated);
    const listener = vi.fn();
    cleanups.push(observeElementTarget(host, '#owner', listener));

    unrelated.dispatchEvent(new Event('webmusic:sourcechange', {bubbles: true}));
    expect(listener).toHaveBeenCalledExactlyOnceWith(target, 'ready');

    const replacement = target.cloneNode() as HTMLElement;
    target.replaceWith(replacement);
    replacement.dispatchEvent(new Event('webmusic:sourcechange', {bubbles: true}));
    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener).toHaveBeenLastCalledWith(replacement, 'ready');
  });

  it('does not reconnect a replacement when the removed target is defined later', async () => {
    const name = `webmusic-target-test-${nextTag++}`;
    const host = document.createElement('div');
    const target = document.createElement(name);
    target.id = 'owner';
    document.body.append(host, target);
    const listener = vi.fn();
    cleanups.push(observeElementTarget(host, '#owner', listener));

    const replacement = document.createElement('div');
    replacement.id = 'owner';
    target.replaceWith(replacement);
    await flush();
    expect(listener).toHaveBeenCalledTimes(2);
    customElements.define(name, class extends HTMLElement {});
    await flush();
    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener).toHaveBeenLastCalledWith(replacement, 'ready');
  });

  it('can select a reserved hyphenated name without an unhandled registry rejection', async () => {
    const host = document.createElement('div');
    const target = document.createElement('annotation-xml');
    document.body.append(host, target);
    const listener = vi.fn();
    cleanups.push(observeElementTarget(host, 'annotation-xml', listener));
    await flush();
    expect(listener).toHaveBeenCalledExactlyOnceWith(target, 'ready');
  });

  it('releases observers when the initial callback throws', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    const listener = vi.fn(() => { throw new Error('consumer failure'); });
    expect(() => observeElementTarget(host, '#owner', listener)).toThrow('consumer failure');
    const target = document.createElement('div');
    target.id = 'owner';
    document.body.append(target);
    await flush();
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
