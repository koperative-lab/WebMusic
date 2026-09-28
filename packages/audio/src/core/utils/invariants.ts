/** Throw with a message when `condition` is falsy. Narrows the type on success. */
export function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`[webaudio] ${message}`);
}

/** Clamp `value` into the inclusive range [min, max]. */
export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}
