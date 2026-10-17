import {describe, expect, it, vi} from 'vitest';
import {createCapabilityKey, ModuleCapabilities} from '../src/module/capability';
import {ModuleAudioEnvironment, ModuleContext} from '../src/module/context';
import {createConnectionLease} from '../src/module/lease';
import {createModuleHandle, ModuleRegistry, type ModuleHandle} from '../src/module/registry';
import type {SessionTransport} from '../src/session';

function audioContext() {
  const state = {state: 'suspended', close: vi.fn(async () => { state.state = 'closed'; })};
  return {state, context: state as unknown as BaseAudioContext};
}

describe('modular resource foundations', () => {
  it('revokes a lease before reentrant cleanup and never repeats a failed cleanup', () => {
    const cleanup = vi.fn(() => {
      expect(lease.active).toBe(false);
      lease.release();
      throw new Error('cleanup failed');
    });
    const lease = createConnectionLease(cleanup);

    expect(() => lease.release()).toThrow('cleanup failed');
    expect(lease.active).toBe(false);
    expect(() => lease.release()).not.toThrow();
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it('distinguishes capability identities with the same diagnostic name', () => {
    const first = createCapabilityKey<number>('gain');
    const second = createCapabilityKey<number>('gain');
    const empty = new ModuleCapabilities();
    const populated = empty.with(first, 0);

    expect(first.identity).not.toBe(second.identity);
    expect(empty.has(first)).toBe(false);
    expect(populated.has(first)).toBe(true);
    expect(populated.get(first)).toBe(0);
    expect(populated.has(second)).toBe(false);
    expect(populated.get(second)).toBeUndefined();
  });

  it('borrows capability resources without freezing or disposing them', () => {
    const key = createCapabilityKey<{value: number; dispose(): void}>('resource');
    const resource = {value: 1, dispose: vi.fn()};
    const capabilities = new ModuleCapabilities().with(key, resource);

    resource.value = 2;
    expect(capabilities.get(key)).toBe(resource);
    expect(capabilities.get(key)?.value).toBe(2);
    expect(Object.isFrozen(resource)).toBe(false);
    expect(resource.dispose).not.toHaveBeenCalled();
  });

  it('creates a borrowed view without changing the receiver of class capabilities', () => {
    class OwnedModule {
      readonly id = 'lead';
      #preparations = 0;
      readonly dispose = vi.fn();
      prepare(): void { this.#preparations++; }
      get preparations(): number { return this.#preparations; }
    }
    const owner = new OwnedModule();
    const view = createModuleHandle(owner);

    expect(view.id).toBe('lead');
    expect(Object.isFrozen(view)).toBe(true);
    expect(Object.isFrozen(owner)).toBe(false);
    expect(() => view.prepare?.()).not.toThrow();
    expect(owner.preparations).toBe(1);
    expect('dispose' in view).toBe(false);
    expect(owner.dispose).not.toHaveBeenCalled();
  });

  it('rejects duplicate IDs without replacing or disposing the current registration', () => {
    const registry = new ModuleRegistry();
    const original = {id: 'lead', dispose: vi.fn()};
    const replacement = {id: 'lead', dispose: vi.fn()};
    const lease = registry.register(original);

    expect(() => registry.register(replacement)).toThrow(/registered|duplicate/i);
    expect(registry.get('lead')).toBe(original);
    expect(lease.active).toBe(true);
    expect(original.dispose).not.toHaveBeenCalled();
    expect(replacement.dispose).not.toHaveBeenCalled();
    registry.dispose();
    expect(lease.active).toBe(false);
    expect(original.dispose).not.toHaveBeenCalled();
  });

  it('cannot remove a replacement registration through an old lease', () => {
    const registry = new ModuleRegistry();
    const original: ModuleHandle = {id: 'lead'};
    const replacement: ModuleHandle = {id: 'lead'};
    const oldLease = registry.register(original);
    let replaceOnRemoval = true;
    let replacementLease: ReturnType<ModuleRegistry['register']> | undefined;
    const off = registry.subscribe(() => {
      if (replaceOnRemoval && !registry.get('lead')) {
        replaceOnRemoval = false;
        replacementLease = registry.register(replacement);
      }
    });

    oldLease.release();
    oldLease.release();
    expect(registry.get('lead')).toBe(replacement);
    expect(replacementLease?.active).toBe(true);
    expect(registry.snapshot()).toEqual([replacement]);
    off();
    registry.dispose();
  });

  it('returns a revoked lease when a registration observer disposes the scope', () => {
    const registry = new ModuleRegistry();
    const module = {id: 'lead', dispose: vi.fn()};
    registry.subscribe(() => {
      if (registry.get('lead')) registry.dispose();
    });

    const lease = registry.register(module);
    expect(registry.disposed).toBe(true);
    expect(lease.active).toBe(false);
    expect(registry.snapshot()).toEqual([]);
    expect(() => registry.register({id: 'later'})).toThrow(/disposed/i);
    expect(module.dispose).not.toHaveBeenCalled();
  });

  it('keeps independent subscription leases for the same callback', () => {
    const registry = new ModuleRegistry();
    const listener = vi.fn();
    const firstOff = registry.subscribe(listener);
    const secondOff = registry.subscribe(listener);
    listener.mockClear();

    firstOff();
    registry.register({id: 'lead'});
    expect(listener).toHaveBeenCalledTimes(1);
    secondOff();
    registry.register({id: 'bass'});
    expect(listener).toHaveBeenCalledTimes(1);
    registry.dispose();
  });

  it('contains observer failures after committing registration and retains borrowed modules', () => {
    const onObserverError = vi.fn();
    const registry = new ModuleRegistry({onObserverError});
    registry.subscribe(() => { throw new Error('observer failure'); });
    const module = {id: 'lead', dispose: vi.fn()};

    expect(() => registry.register(module)).not.toThrow();
    expect(registry.get('lead')).toBe(module);
    expect(onObserverError).toHaveBeenCalled();
    expect(Object.isFrozen(registry.snapshot())).toBe(true);
    registry.dispose();
    registry.dispose();
    expect(module.dispose).not.toHaveBeenCalled();
  });
});

describe('modular audio environments and bounded contexts', () => {
  it('allocates only on explicit preparation and closes an owned context once', () => {
    const {context, state} = audioContext();
    const create = vi.fn(() => context);
    const audio = new ModuleAudioEnvironment({create});

    expect(audio.peek()).toBeUndefined();
    expect(create).not.toHaveBeenCalled();
    expect(audio.prepare()).toBe(context);
    expect(audio.prepare()).toBe(context);
    expect(create).toHaveBeenCalledTimes(1);
    audio.dispose();
    audio.dispose();
    expect(state.close).toHaveBeenCalledTimes(1);
    expect(audio.peek()).toBeUndefined();
    expect(() => audio.prepare()).toThrow(/disposed/i);
  });

  it('never closes an injected context or calls the unused factory', () => {
    const {context, state} = audioContext();
    const create = vi.fn(() => { throw new Error('must not allocate'); });
    const audio = new ModuleAudioEnvironment({context, create});

    expect(audio.peek()).toBe(context);
    expect(audio.prepare()).toBe(context);
    audio.dispose();
    expect(create).not.toHaveBeenCalled();
    expect(state.close).not.toHaveBeenCalled();
  });

  it('rejects a closed context without attempting to resume or replace it', () => {
    const {context, state} = audioContext();
    state.state = 'closed';
    const audio = new ModuleAudioEnvironment({context});
    expect(() => audio.prepare()).toThrow(/closed/i);
    audio.dispose();
    expect(state.close).not.toHaveBeenCalled();
  });

  it('releases an owned candidate when its factory disposes the environment', () => {
    const {context, state} = audioContext();
    const audio = new ModuleAudioEnvironment({create: () => {
      audio.dispose();
      return context;
    }});

    expect(() => audio.prepare()).toThrow(/disposed|cancel/i);
    expect(audio.disposed).toBe(true);
    expect(audio.peek()).toBeUndefined();
    expect(state.close).toHaveBeenCalledTimes(1);
  });

  it('rejects recursive preparation without allocating a second context', () => {
    const create = vi.fn((): BaseAudioContext => audio.prepare());
    const audio = new ModuleAudioEnvironment({create});

    expect(() => audio.prepare()).toThrow(/re.?entr|prepar/i);
    expect(create).toHaveBeenCalledTimes(1);
    expect(audio.peek()).toBeUndefined();
    audio.dispose();
  });

  it('derives explicit capability boundaries without allocating audio or disposing lenders', () => {
    const {context, state} = audioContext();
    const create = vi.fn(() => context);
    const audio = new ModuleAudioEnvironment({create});
    const registry = new ModuleRegistry();
    const target = {id: 'lead', dispose: vi.fn()};
    const session = {dispose: vi.fn()} as unknown as SessionTransport;
    const destination = vi.fn(() => undefined);
    const parent = new ModuleContext({id: 'parent', audio, registry, target, session, destination});
    const child = parent.derive({id: 'child', target: null, session: null, admit: null});

    expect(child.audio).toBe(audio);
    expect(child.registry).toBe(registry);
    expect(child.destination).toBe(destination);
    expect(child.target).toBeUndefined();
    expect(child.session).toBeUndefined();
    expect(parent.target).toBe(target);
    expect(parent.session).toBe(session);
    expect(create).not.toHaveBeenCalled();
    expect(destination).not.toHaveBeenCalled();
    registry.dispose();
    audio.dispose();
    expect(target.dispose).not.toHaveBeenCalled();
    expect(session.dispose).not.toHaveBeenCalled();
    expect(state.close).not.toHaveBeenCalled();
  });
});
