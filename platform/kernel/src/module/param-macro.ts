import type {ParamHandle} from './parameter';

export interface ParamMacroTarget {
  readonly target: ParamHandle;
  /** Mapping endpoints in this target's native unit; reversal is allowed. */
  readonly min: number;
  readonly max: number;
}

/** A normalized controller writing the same shared base handles as ordinary UI. */
export class ParamMacro {
  readonly targets: readonly ParamMacroTarget[];
  private current: number;
  private disposed = false;
  private applying = false;
  private readonly listeners = new Set<{listener: (value: number) => void}>();

  constructor(targets: Iterable<ParamMacroTarget>, options: {value?: number} = {}) {
    const entries = [...targets];
    const seen = new Set<ParamHandle>();
    for (const entry of entries) {
      if (seen.has(entry.target)) throw new Error('A macro cannot map one parameter twice.');
      seen.add(entry.target);
      const {min, max} = entry.target.descriptor.range;
      if (!Number.isFinite(entry.min) || !Number.isFinite(entry.max) || Math.min(entry.min, entry.max) < min || Math.max(entry.min, entry.max) > max) throw new RangeError('Macro mapping endpoints must fit the target legal range.');
      if (entry.target.snapshot.disposed) throw new Error('Macro target is disposed.');
    }
    this.current = options.value ?? 0;
    this.validate(this.current);
    this.targets = Object.freeze(entries.map(entry => Object.freeze({...entry})));
  }

  get value(): number { return this.current; }

  setValue(value: number): void {
    if (this.disposed) throw new Error('Macro is disposed.');
    if (this.applying) throw new Error('Macro updates cannot re-enter.');
    this.validate(value);
    const changes = this.targets.map(entry => {
      if (entry.target.snapshot.disposed) throw new Error('Macro target is disposed.');
      return {target: entry.target, before: entry.target.snapshot.baseValue, after: entry.min + value * (entry.max - entry.min)};
    });
    this.applying = true;
    let applied = 0;
    try {
      for (const change of changes) {
        change.target.setBaseValue(change.after);
        applied++;
        if (this.disposed) throw new Error('Macro disposed during update.');
      }
      this.current = value;
    } catch (error) {
      // Restore successful writes where possible; a backend may reject rollback,
      // so target snapshots remain authoritative and no atomic DSP claim is made.
      for (const change of changes.slice(0, applied).reverse()) {
        try { change.target.setBaseValue(change.before); } catch { /* Preserve original rejection. */ }
      }
      throw error;
    } finally { this.applying = false; }
    for (const entry of [...this.listeners]) {
      if (this.current !== value || this.disposed) break;
      if (!this.listeners.has(entry)) continue;
      try {
        const result: unknown = entry.listener(value);
        if (result != null && typeof (result as {then?: unknown}).then === 'function') void Promise.resolve(result).catch(() => {});
      } catch { /* Observers cannot roll back a committed macro. */ }
    }
  }

  subscribe(listener: (value: number) => void): () => void {
    if (this.disposed) return () => {};
    const entry = {listener};
    this.listeners.add(entry);
    return () => { this.listeners.delete(entry); };
  }

  dispose(): void { this.disposed = true; this.listeners.clear(); }

  private validate(value: number): void {
    if (!Number.isFinite(value) || value < 0 || value > 1) throw new RangeError('Macro value must be in [0, 1].');
  }
}
