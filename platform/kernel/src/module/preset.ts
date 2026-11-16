import type {ModuleHandle} from './registry';

// ============================================================================
// Presets (DEC-076): named sets of values captured from parameter surfaces,
// recalled whole or blended. Pure data and arithmetic; what the values are
// read from and written to belongs to the caller.
// ============================================================================

/** A preset's values by key; an array blends element by element. */
export type PresetValues = Readonly<Record<string, number | readonly number[]>>;

/** Slots of stored values, recalled whole or interpolated. */
export class PresetBank {
  readonly #slots = new Map<number, PresetValues>();

  constructor(initial?: Readonly<Record<string, PresetValues>>) {
    for (const [slot, values] of Object.entries(initial ?? {})) this.store(Number(slot), values);
  }

  /** Stored slot numbers, ascending. */
  get slots(): readonly number[] { return [...this.#slots.keys()].sort((a, b) => a - b); }

  has(slot: number): boolean { return this.#slots.has(slot); }

  store(slot: number, values: PresetValues): void {
    if (!Number.isInteger(slot) || slot < 1) throw new RangeError('A preset slot is a positive integer.');
    const copy: Record<string, number | readonly number[]> = {};
    for (const [key, value] of Object.entries(values)) {
      if (Array.isArray(value)) { if (value.every(Number.isFinite)) copy[key] = Object.freeze([...value]); }
      else if (Number.isFinite(value)) copy[key] = value as number;
    }
    this.#slots.set(slot, Object.freeze(copy));
  }

  recall(slot: number): PresetValues | undefined { return this.#slots.get(slot); }

  clear(slot: number): void { this.#slots.delete(slot); }

  /**
   * Blend stored slots by weight. Weights are normalized; a key present in
   * only some slots takes those slots' share. Numbers and arrays of equal
   * length blend linearly; anything else takes the heaviest slot's value.
   */
  interpolate(weights: Readonly<Record<number, number>>): PresetValues {
    const entries = Object.entries(weights)
      .map(([slot, weight]) => [this.#slots.get(Number(slot)), Math.max(0, weight)] as const)
      .filter((entry): entry is readonly [PresetValues, number] => !!entry[0] && entry[1] > 0);
    const result: Record<string, number | readonly number[]> = {};
    if (!entries.length) return result;
    const keys = new Set(entries.flatMap(([values]) => Object.keys(values)));
    for (const key of keys) {
      const present = entries.filter(([values]) => values[key] !== undefined);
      const total = present.reduce((sum, [, weight]) => sum + weight, 0);
      const first = present[0]![0][key]!;
      if (typeof first === 'number' && present.every(([values]) => typeof values[key] === 'number')) {
        result[key] = present.reduce((sum, [values, weight]) => sum + (values[key] as number) * weight, 0) / total;
      } else if (Array.isArray(first) && present.every(([values]) => Array.isArray(values[key]) && (values[key] as readonly number[]).length === first.length)) {
        result[key] = first.map((_, index) => present.reduce((sum, [values, weight]) => sum + (values[key] as readonly number[])[index]! * weight, 0) / total);
      } else {
        result[key] = [...present].sort((a, b) => b[1] - a[1])[0]![0][key]!;
      }
    }
    return result;
  }

  /** Blend two slots: `fraction` 0 is `from`, 1 is `to`. */
  between(from: number, to: number, fraction: number): PresetValues {
    const amount = Math.min(1, Math.max(0, fraction));
    return this.interpolate(from === to ? {[from]: 1} : {[from]: 1 - amount, [to]: amount});
  }

  toJSON(): Record<string, Record<string, number | number[]>> {
    return Object.fromEntries(this.slots.map(slot => [String(slot), Object.fromEntries(Object.entries(this.#slots.get(slot)!).map(([key, value]) => [key, Array.isArray(value) ? [...value] : value as number]))]));
  }
}

/** The base values of every parameter of `modules`, keyed `moduleId.parameterId`. */
export function captureParameters(modules: Iterable<ModuleHandle>): Record<string, number> {
  const values: Record<string, number> = {};
  for (const module of modules) {
    for (const handle of module.params ?? []) {
      if (!handle.snapshot.disposed) values[`${module.id}.${handle.descriptor.id}`] = handle.snapshot.baseValue;
    }
  }
  return values;
}

/** Set every parameter of `modules` that `values` names, clamped to its range. Returns how many were set. */
export function applyParameters(modules: Iterable<ModuleHandle>, values: PresetValues): number {
  let applied = 0;
  for (const module of modules) {
    for (const handle of module.params ?? []) {
      const value = values[`${module.id}.${handle.descriptor.id}`];
      if (typeof value !== 'number' || handle.snapshot.disposed) continue;
      const {min, max} = handle.descriptor.range;
      try { handle.setBaseValue(Math.min(max, Math.max(min, value))); applied++; } catch { /* A refused write leaves that parameter. */ }
    }
  }
  return applied;
}
