// @vitest-environment jsdom
import {afterEach, describe, expect, it, vi} from 'vitest';
import {observeElementSource} from '../src/elements';

interface Source {value: number}
const accepts = (value: unknown): value is Source => Boolean(value && typeof (value as Source).value === 'number');
const cleanups: Array<() => void> = [];
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
let nextTag = 0;
afterEach(() => { for (const stop of cleanups.splice(0)) stop(); document.body.replaceChildren(); });

describe('observeElementSource', () => {
  it('gives explicit objects priority and never falls back after invalid input', () => {
    const host = document.createElement('div');
    const target = Object.assign(document.createElement('div'), {editor: {value: 1}});
    target.id = 'owner';
    document.body.append(host, target);
    const listener = vi.fn();
    const source = {value: 2};
    cleanups.push(observeElementSource(host, {source, selector: '#owner', property: 'editor', accepts}, listener));
    expect(listener).toHaveBeenLastCalledWith({state: 'ready', source, target: undefined});
    cleanups.push(observeElementSource(host, {source: null, selector: '#owner', property: 'editor', accepts}, listener));
    expect(listener.mock.lastCall?.[0].state).toBe('invalid');
    cleanups.push(observeElementSource(host, {source: undefined, selector: '#owner', property: 'editor', accepts}, listener));
    expect(listener).toHaveBeenLastCalledWith({state: 'ready', source: target.editor, target});
  });

  it('distinguishes missing, invalid, ambiguous, unavailable and malformed sources', () => {
    const host = document.createElement('div');
    const first = document.createElement('div');
    const second = document.createElement('div');
    first.className = second.className = 'owner';
    first.id = 'first'; second.id = 'second';
    document.body.append(host, first, second);
    for (const [selector, state] of [['#missing', 'missing'], ['[', 'invalid'], ['.owner', 'ambiguous'], ['#first', 'unavailable']]) {
      const listener = vi.fn();
      cleanups.push(observeElementSource(host, {selector, property: 'editor', accepts}, listener));
      expect(listener.mock.lastCall?.[0].state).toBe(state);
    }
    Object.defineProperty(second, 'editor', {get() { throw new Error('getter failure'); }});
    const listener = vi.fn();
    cleanups.push(observeElementSource(host, {selector: '#second', property: 'editor', accepts}, listener));
    expect(listener.mock.lastCall?.[0].state).toBe('invalid');
    expect(listener.mock.lastCall?.[0].error.message).toBe('getter failure');
  });

  it('follows late availability, replacement and removal without owning sources', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    const listener = vi.fn();
    const stop = observeElementSource(host, {selector: '#owner', property: 'editor', accepts}, listener);
    cleanups.push(stop);
    const first = Object.assign(document.createElement('div'), {editor: undefined as Source | undefined});
    first.id = 'owner';
    document.body.append(first);
    await flush();
    expect(listener.mock.lastCall?.[0].state).toBe('unavailable');
    first.editor = {value: 1};
    first.dispatchEvent(new Event('webmusic:sourcechange', {bubbles: true}));
    expect(listener.mock.lastCall?.[0].source).toBe(first.editor);
    const second = Object.assign(document.createElement('div'), {editor: {value: 2}});
    second.id = 'owner'; first.replaceWith(second);
    await flush();
    expect(listener.mock.lastCall?.[0].source).toBe(second.editor);
    second.remove();
    await flush();
    expect(listener.mock.lastCall?.[0].state).toBe('missing');
    stop(); const calls = listener.mock.calls.length;
    document.body.append(first);
    await flush();
    expect(listener).toHaveBeenCalledTimes(calls);
  });

  it('resolves late custom-element upgrades only within the host root', async () => {
    const tag = `source-upgrade-${nextTag++}`;
    const outside = Object.assign(document.createElement('div'), {editor: {value: 99}});
    outside.id = 'owner';
    const shell = document.createElement('div');
    document.body.append(outside, shell);
    const root = shell.attachShadow({mode: 'open'});
    const host = document.createElement('div');
    const target = document.createElement(tag); target.id = 'owner';
    root.append(host, target);
    const listener = vi.fn();
    cleanups.push(observeElementSource(host, {selector: '#owner', property: 'editor', accepts}, listener));
    expect(listener.mock.lastCall?.[0].state).toBe('unavailable');
    customElements.define(tag, class extends HTMLElement {editor = {value: 3};});
    await flush();
    expect(listener.mock.lastCall?.[0]).toEqual({state: 'ready', target, source: {value: 3}});
  });

  it('does not swallow consumer errors or retain observers after initial failure', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    const listener = vi.fn(() => { throw new Error('consumer'); });
    expect(() => observeElementSource(host, {selector: '#owner', property: 'editor', accepts}, listener)).toThrow('consumer');
    const target = document.createElement('div'); target.id = 'owner'; document.body.append(target);
    await flush();
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
