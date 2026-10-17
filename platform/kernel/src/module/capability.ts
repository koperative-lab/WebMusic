/** Identity is the symbol token, not its diagnostic name. Types do not validate arbitrary inputs. */
export interface CapabilityKey<T> {
  readonly name: string;
  readonly identity: symbol;
  readonly type?: T;
}

export function createCapabilityKey<T>(name: string): CapabilityKey<T> {
  if (!name.trim()) throw new TypeError('Capability name must not be empty');
  return Object.freeze({name, identity: Symbol(name)});
}

/** Immutable directory of borrowed capabilities; contained resources are never frozen or disposed. */
export class ModuleCapabilities {
  readonly #values: ReadonlyMap<symbol, unknown>;

  constructor() { this.#values = new Map(); }

  get<T>(key: CapabilityKey<T>): T | undefined {
    return this.#values.get(key.identity) as T | undefined;
  }

  has<T>(key: CapabilityKey<T>): boolean { return this.#values.has(key.identity); }

  with<T>(key: CapabilityKey<T>, value: T): ModuleCapabilities {
    const next = new ModuleCapabilities();
    const values = next.#values as Map<symbol, unknown>;
    for (const [identity, item] of this.#values) values.set(identity, item);
    values.set(key.identity, value);
    return next;
  }
}
