/** The five signal families a module port can carry (DEC-068). */
export type PortFamily = 'audio' | 'note' | 'control' | 'transport' | 'source';
export type PortDirection = 'input' | 'output';
/** `single` accepts one producer (or, for an output, one main route); `sum` accepts several. */
export type PortMultiplicity = 'single' | 'sum';
/** Observable resolution state. `detached` is terminal for a disposed or revoked port. */
export type PortReadiness = 'unresolved' | 'preparing' | 'ready' | 'error' | 'detached';

export const PORT_FAMILIES: readonly PortFamily[] = Object.freeze(['audio', 'note', 'control', 'transport', 'source']);
const directions: readonly PortDirection[] = ['input', 'output'];
const multiplicities: readonly PortMultiplicity[] = ['single', 'sum'];
const readinessStates: readonly PortReadiness[] = ['unresolved', 'preparing', 'ready', 'error', 'detached'];

/** Fields every port declares, whatever its family. */
export interface ModulePortInfo {
  readonly id: string;
  readonly family: PortFamily;
  readonly direction: PortDirection;
  readonly multiplicity: PortMultiplicity;
  readonly schemaVersion: number;
  readonly readiness: PortReadiness;
}

/** Validate the common declaration fields; family-specific checks belong to each port type. */
export function assertPortInfo(port: ModulePortInfo): void {
  if (!port || typeof port !== 'object') throw new TypeError('Port must be an object');
  if (typeof port.id !== 'string' || !port.id.trim() || port.id !== port.id.trim()) {
    throw new TypeError('Port ID must be a nonempty trimmed string');
  }
  if (!PORT_FAMILIES.includes(port.family)) throw new TypeError(`Unknown port family: ${String(port.family)}`);
  if (!directions.includes(port.direction)) throw new TypeError(`Unknown port direction: ${String(port.direction)}`);
  if (!multiplicities.includes(port.multiplicity)) throw new TypeError(`Unknown port multiplicity: ${String(port.multiplicity)}`);
  if (!Number.isInteger(port.schemaVersion) || port.schemaVersion < 1) throw new TypeError('Port schemaVersion must be a positive integer');
  if (!readinessStates.includes(port.readiness)) throw new TypeError(`Unknown port readiness: ${String(port.readiness)}`);
}

/**
 * Ordered, reentrancy-safe listener set shared by the port families. A
 * listener removed during delivery is not called; one listener's failure is
 * reported and does not starve the others.
 */
export class PortListeners<T> {
  readonly #entries = new Set<{listener: (value: T) => void}>();
  readonly #onError?: (error: unknown) => void;

  constructor(onError?: (error: unknown) => void) { this.#onError = onError; }
  get size(): number { return this.#entries.size; }

  add(listener: (value: T) => void): () => void {
    if (typeof listener !== 'function') throw new TypeError('Listener must be a function');
    const entry = {listener};
    this.#entries.add(entry);
    return () => { this.#entries.delete(entry); };
  }

  emit(value: T): void {
    for (const entry of [...this.#entries]) {
      if (!this.#entries.has(entry)) continue;
      try {
        const result: unknown = entry.listener(value);
        if (result && typeof (result as PromiseLike<unknown>).then === 'function') {
          void Promise.resolve(result).catch(error => this.#report(error));
        }
      } catch (error) { this.#report(error); }
    }
  }

  clear(): void { this.#entries.clear(); }

  #report(error: unknown): void {
    try { this.#onError?.(error); } catch { /* Delivery continues after a diagnostic failure. */ }
  }
}
