// @vitest-environment jsdom

import {act} from 'react';
import {afterEach, expect, it, vi} from 'vitest';
import {mountApiSandbox} from '../src/components/api-sandbox-client';

let dispose: (() => void) | undefined;

afterEach(async () => {
  await act(async () => { dispose?.(); });
  dispose = undefined;
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('mounts the real React/Sandpack editor without a preview and releases it before remounting', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  // jsdom has no layout/intersection delivery. Drive the real editor's lazy
  // viewport activation through the browser seam, without replacing Sandpack.
  const observers: VisibleIntersectionObserver[] = [];
  class VisibleIntersectionObserver implements IntersectionObserver {
    readonly root = null;
    readonly rootMargin = '0px';
    readonly thresholds = [0];
    readonly targets = new Set<Element>();
    constructor(private callback: IntersectionObserverCallback) { observers.push(this); }
    observe(target: Element): void { this.targets.add(target); }
    unobserve(target: Element): void { this.targets.delete(target); }
    disconnect(): void { this.targets.clear(); }
    takeRecords(): IntersectionObserverEntry[] { return []; }
    enterViewport(): void {
      this.callback([...this.targets].map((target) => ({
        target, isIntersecting: true, intersectionRatio: 1, time: performance.now(),
        boundingClientRect: new DOMRect(0, 0, 640, 340),
        intersectionRect: new DOMRect(0, 0, 640, 340), rootBounds: null,
      })), this);
    }
  }
  vi.stubGlobal('IntersectionObserver', VisibleIntersectionObserver);
  const fetch = vi.fn(() => { throw new Error('The editor-only sandbox must not request network resources'); });
  vi.stubGlobal('fetch', fetch);
  const xhr = vi.spyOn(XMLHttpRequest.prototype, 'open').mockImplementation(() => {
    throw new Error('The editor-only sandbox must not open network requests');
  });
  const host = document.createElement('div');
  const fallback = document.createElement('pre');
  fallback.textContent = 'Readable static fallback';
  host.append(fallback);
  host.dataset.code = JSON.stringify('const message = "Real Sandpack editor";');
  document.body.append(host);

  await act(async () => { dispose = mountApiSandbox(host); });
  await act(async () => { for (const observer of observers) observer.enterViewport(); });
  const firstEditor = host.querySelector('.cm-editor');
  expect(firstEditor).not.toBeNull();
  expect(host.querySelectorAll('.cm-editor')).toHaveLength(1);
  expect(host.querySelector('.cm-content')?.textContent).toContain('Real Sandpack editor');
  expect(host.querySelector('[contenteditable="true"]')).not.toBeNull();
  expect(host.querySelector('iframe')).toBeNull();
  expect(host.dataset.apiSandboxState).toBe('initialized');
  expect(mountApiSandbox(host)).toBe(dispose);

  await act(async () => { dispose?.(); });
  expect(firstEditor?.isConnected).toBe(false);
  expect(host.querySelector('.cm-editor')).toBeNull();
  expect(host.firstChild).toBe(fallback);
  expect(host.dataset.apiSandboxState).toBeUndefined();
  expect(observers.every((observer) => observer.targets.size === 0)).toBe(true);

  await act(async () => { dispose = mountApiSandbox(host); });
  await act(async () => { for (const observer of observers) observer.enterViewport(); });
  expect(host.querySelectorAll('.cm-editor')).toHaveLength(1);
  expect(host.querySelector('.cm-editor')).not.toBe(firstEditor);
  expect(host.querySelector('iframe')).toBeNull();
  await act(async () => { dispose?.(); dispose?.(); });
  expect(host.firstChild).toBe(fallback);
  expect(fetch).not.toHaveBeenCalled();
  expect(xhr).not.toHaveBeenCalled();
});
