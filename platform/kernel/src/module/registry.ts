import type {InsertChain} from '../effect';
import type {AudioInputPort, AudioOutputPort} from './audio-port';
import type {ControlPort} from './control-port';
import type {NoteInputPort, NoteOutputPort} from './note-port';
import type {PortDirection, PortFamily} from './port';
import type {SourcePort} from './source-port';
import type {TransportPort} from './transport-port';
import type {ModuleCapabilities} from './capability';
import {createConnectionLease, type ConnectionLease} from './lease';
import type {ParamSurface} from './parameter';

/** Ports by family; each family's input and output types. */
export interface ModulePortMap {
  audio: AudioOutputPort | AudioInputPort;
  note: NoteOutputPort | NoteInputPort;
  control: ControlPort;
  transport: TransportPort;
  source: SourcePort;
}

/** Any port a module can expose. */
export type ModulePort = ModulePortMap[PortFamily];

/** Borrowed module view. Commands are explicit capabilities; disposal rights are not included. */
export interface ModuleHandle {
  readonly id: string;
  readonly params?: ParamSurface;
  readonly inserts?: InsertChain;
  readonly capabilities?: ModuleCapabilities;
  /** Audio output shortcut; the same port also appears in {@link ModuleHandle.ports}. */
  getPort?(name: string): AudioOutputPort | undefined;
  /** Every currently available port of every family. Order is stable for one revision. */
  ports?(): readonly ModulePort[];
  prepare?(): Promise<void> | void;
  /** Called after any port, parameter or readiness change. */
  subscribe?(listener: () => void): () => void;
}

/**
 * Resolve a module's port by name and family (and optionally direction).
 * Enumerated ports win; an audio output falls back to the `getPort` shortcut.
 */
export function getModulePort<F extends PortFamily>(
  module: ModuleHandle,
  name: string,
  family: F,
  direction?: PortDirection,
): ModulePortMap[F] | undefined {
  const listed = module.ports?.().find(port => port.id === name && port.family === family &&
    (direction === undefined || port.direction === direction));
  if (listed) return listed as ModulePortMap[F];
  if (family === 'audio' && direction !== 'input') return module.getPort?.(name) as ModulePortMap[F] | undefined;
  return undefined;
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
    ports: module.ports?.bind(module),
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
