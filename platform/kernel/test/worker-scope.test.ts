import {describe, expect, it} from 'vitest';
import {dedicatedWorkerScope} from '../src/worker';

/**
 * Builds a fake global object shaped like a worker realm. `kind` picks which
 * *GlobalScope constructor the fake `self` is an instance of, mirroring how
 * the real hierarchy nests: Dedicated/Shared/Service all extend WorkerGlobalScope.
 */
function fakeGlobals(options: {
  kind?: 'dedicated' | 'shared' | 'service' | 'bare';
  exposeDedicatedConstructor?: boolean;
  postMessage?: boolean;
  addEventListener?: boolean;
} = {}) {
  const {
    kind = 'dedicated',
    exposeDedicatedConstructor = true,
    postMessage = true,
    addEventListener = true,
  } = options;

  class WorkerGlobalScope {}
  class DedicatedWorkerGlobalScope extends WorkerGlobalScope {}
  class SharedWorkerGlobalScope extends WorkerGlobalScope {}
  class ServiceWorkerGlobalScope extends WorkerGlobalScope {}

  const Constructor =
    kind === 'dedicated'
      ? DedicatedWorkerGlobalScope
      : kind === 'shared'
        ? SharedWorkerGlobalScope
        : kind === 'service'
          ? ServiceWorkerGlobalScope
          : WorkerGlobalScope;

  const self = new Constructor() as Record<string, unknown>;
  if (addEventListener) self.addEventListener = () => {};
  if (postMessage) self.postMessage = () => {};

  return {
    WorkerGlobalScope,
    ...(exposeDedicatedConstructor ? {DedicatedWorkerGlobalScope} : {}),
    self,
  };
}

describe('dedicatedWorkerScope', () => {
  it('returns the scope inside a dedicated worker', () => {
    const globals = fakeGlobals();
    expect(dedicatedWorkerScope(globals)).toBe(globals.self);
  });

  it('refuses a main thread with no worker scope at all', () => {
    expect(dedicatedWorkerScope({})).toBeUndefined();
    expect(dedicatedWorkerScope({self: {}})).toBeUndefined();
  });

  it('refuses shared and service worker scopes', () => {
    // Both inherit from WorkerGlobalScope, so a name- or inheritance-only
    // check would register a message handler in the wrong kind of worker.
    expect(dedicatedWorkerScope(fakeGlobals({kind: 'shared'}))).toBeUndefined();
    expect(dedicatedWorkerScope(fakeGlobals({kind: 'service'}))).toBeUndefined();
  });

  it('falls back to capability checks when the dedicated constructor is absent', () => {
    // Some runtimes expose WorkerGlobalScope but not the dedicated subclass.
    const usable = fakeGlobals({kind: 'bare', exposeDedicatedConstructor: false});
    expect(dedicatedWorkerScope(usable)).toBe(usable.self);

    // Without the global postMessage channel it is not a dedicated worker.
    const noPost = fakeGlobals({kind: 'bare', exposeDedicatedConstructor: false, postMessage: false});
    expect(dedicatedWorkerScope(noPost)).toBeUndefined();

    const noListener = fakeGlobals({
      kind: 'bare',
      exposeDedicatedConstructor: false,
      addEventListener: false,
    });
    expect(dedicatedWorkerScope(noListener)).toBeUndefined();
  });

  it('refuses a realm whose WorkerGlobalScope is not a constructor', () => {
    expect(
      dedicatedWorkerScope({WorkerGlobalScope: 'nonsense', self: {postMessage() {}}}),
    ).toBeUndefined();
  });
});
