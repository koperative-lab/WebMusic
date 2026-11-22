import {createConnectionLease, type ConnectionLease} from './lease';
import type {ModuleHandle} from './registry';

/**
 * What a source cord carries across a boundary (DEC-089): a module that stands
 * for whichever module is cabled into it. A companion given a relay reads the
 * upstream module's ports, parameters and inserts through it, and hears when
 * the upstream module changes or is replaced, so a view inside a component
 * follows a player outside it exactly as if they were cabled directly.
 *
 * Ownership: a relay borrows what it follows and never disposes it. Each
 * `follow` returns a lease; the newest lease still held wins, as a slot's
 * provided values do, so a rebuild that makes the new cord before releasing
 * the old one never leaves a gap.
 */
export class SourceRelay implements ModuleHandle {
  readonly id: string;
  readonly #followed: {module: ModuleHandle}[] = [];
  readonly #listeners = new Set<() => void>();
  #stop?: () => void;
  #disposed = false;

  constructor(id: string) {
    this.id = id;
  }

  /** The module this relay stands for now, if any. */
  get upstream(): ModuleHandle | undefined { return this.#followed[this.#followed.length - 1]?.module; }
  get params(): ModuleHandle['params'] { return this.upstream?.params; }
  get inserts(): ModuleHandle['inserts'] { return this.upstream?.inserts; }
  get capabilities(): ModuleHandle['capabilities'] { return this.upstream?.capabilities; }
  get disposed(): boolean { return this.#disposed; }

  getPort(name: string): ReturnType<NonNullable<ModuleHandle['getPort']>> {
    return this.upstream?.getPort?.(name);
  }

  ports(): ReturnType<NonNullable<ModuleHandle['ports']>> {
    return this.upstream?.ports?.() ?? [];
  }

  prepare(): Promise<void> | void {
    return this.upstream?.prepare?.();
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => { this.#listeners.delete(listener); };
  }

  /** Stand for `module` until the lease is released. */
  follow(module: ModuleHandle): ConnectionLease {
    if (this.#disposed) throw new Error('SourceRelay is disposed');
    if (module === this || sourceOrigin(module) === this) throw new Error('A source relay cannot follow itself.');
    const entry = {module};
    this.#followed.push(entry);
    this.#changed();
    return createConnectionLease(() => {
      const index = this.#followed.indexOf(entry);
      if (index < 0) return;
      this.#followed.splice(index, 1);
      this.#changed();
    });
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#followed.length = 0;
    this.#stop?.();
    this.#stop = undefined;
    this.#notify();
    this.#listeners.clear();
  }

  #changed(): void {
    // Hear the module now followed, and only that one.
    this.#stop?.();
    this.#stop = this.upstream?.subscribe?.(() => this.#notify());
    this.#notify();
  }

  #notify(): void {
    for (const listener of [...this.#listeners]) {
      try { listener(); } catch (error) { queueMicrotask(() => { throw error; }); }
    }
  }
}

/** The module a source finally comes from: through every relay it crosses, to the first module that is not one. */
export function sourceOrigin(module: ModuleHandle | undefined): ModuleHandle | undefined {
  const seen = new Set<ModuleHandle>();
  let current = module;
  while (current instanceof SourceRelay && !seen.has(current)) {
    seen.add(current);
    current = current.upstream;
  }
  return current;
}
