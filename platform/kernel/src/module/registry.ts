import type {InsertChain} from '../effect';
import type {AudioOutputPort} from './audio-port';
import type {ModuleCapabilities} from './capability';
import {createConnectionLease, type ConnectionLease} from './lease';
import type {ParamSurface} from './parameter';

/** Borrowed module view. Commands are explicit capabilities; disposal rights are not included. */
export interface ModuleHandle {
  readonly id: string;
  readonly params?: ParamSurface;
  readonly inserts?: InsertChain;
  readonly capabilities?: ModuleCapabilities;
  getPort?(name: string): AudioOutputPort | undefined;
  prepare?(): Promise<void> | void;
  subscribe?(listener: () => void): () => void;
}

export function createModuleHandle(module: ModuleHandle): ModuleHandle {
  assertModuleId(module.id);
  // Delegate to the original receiver: copying a class prototype would break its private fields.
  return Object.freeze({
    id: module.id,
    get params() { return module.params; },
    get inserts() { return module.inserts; },
    get capabilities() { return module.capabilities; },
    getPort: module.getPort?.bind(module),
    prepare: module.prepare?.bind(module),
    subscribe: module.subscribe?.bind(module),
  });
}

export function assertModuleId(id: string): void {
  if (typeof id !== 'string' || !id.trim() || id !== id.trim()) {
    throw new TypeError('Module ID must be a nonempty trimmed string');
  }
}

export interface ModuleRegistryOptions { onObserverError?: (error: unknown) => void }

/** One explicit scope. Registration borrows modules and never transfers their disposal rights. */
export class ModuleRegistry {
  readonly #entries = new Map<string, {module: ModuleHandle; lease: ConnectionLease}>();
  readonly #listeners = new Set<{callback: () => void}>();
  readonly #onError?: (error: unknown) => void;
  #disposed = false;
  #revision = 0;

  constructor(options: ModuleRegistryOptions = {}) { this.#onError = options.onObserverError; }
  get disposed(): boolean { return this.#disposed; }
  get revision(): number { return this.#revision; }
  get(id: string): ModuleHandle | undefined { return this.#entries.get(id)?.module; }
  snapshot(): readonly ModuleHandle[] { return Object.freeze([...this.#entries.values()].map(entry => entry.module)); }

  register(module: ModuleHandle): ConnectionLease {
    if (this.#disposed) throw new Error('ModuleRegistry is disposed');
    assertModuleId(module.id);
    const id = module.id;
    if (this.#entries.has(id)) throw new Error(`Module is already registered: ${id}`);
    const lease = createConnectionLease(() => {
      if (this.#entries.get(id)?.lease !== lease) return;
      this.#entries.delete(id);
      this.#revision++;
      this.#notify();
    });
    this.#entries.set(id, {module, lease});
    this.#revision++;
    this.#notify();
    return lease;
  }

  subscribe(callback: () => void): () => void {
    if (this.#disposed) throw new Error('ModuleRegistry is disposed');
    const entry = {callback};
    this.#listeners.add(entry);
    this.#call(callback);
    return () => { this.#listeners.delete(entry); };
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    const entries = [...this.#entries.values()];
    this.#entries.clear();
    for (const entry of entries) entry.lease.release();
    this.#revision++;
    this.#notify();
    this.#listeners.clear();
  }

  #call(callback: () => void): void {
    try {
      const result: unknown = callback();
      if (result && typeof (result as PromiseLike<unknown>).then === 'function') {
        void Promise.resolve(result).catch(error => this.#report(error));
      }
    } catch (error) { this.#report(error); }
  }

  #report(error: unknown): void {
    try {
      const result: unknown = this.#onError?.(error);
      if (result && typeof (result as PromiseLike<unknown>).then === 'function') {
        void Promise.resolve(result).catch(() => {});
      }
    } catch { /* Diagnostics cannot undo a committed registration. */ }
  }

  #notify(): void {
    const revision = this.#revision;
    for (const entry of [...this.#listeners]) {
      if (this.#revision !== revision) break;
      if (this.#listeners.has(entry)) this.#call(entry.callback);
    }
  }
}
