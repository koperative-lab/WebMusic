/**
 * The kit's shared DOM and number plumbing.
 *
 * Every presenter needs the same four things: add a caller's compatibility
 * classes, stamp a caller's part tokens beside the canonical ones, and coerce
 * an untrusted snapshot number into something safe to paint with. Sixteen
 * modules used to carry their own copy — `setParts` alone existed in four
 * mutually incompatible signatures — so a fix or a hardening landed in one
 * presenter and missed the other fifteen.
 *
 * This module is internal on purpose: it is not a presenter, so publishing it
 * as a subpath would fail the kit's export-surface policy (which requires every
 * published subpath to be a classified presenter with a page, a live demo and
 * an element consumer). It travels inside the presenters that import it, the
 * way `styles.ts` and `fader.ts` already do.
 */

/** Add a caller's space-separated compatibility classes, ignoring blanks. */
export function addClassNames(element: Element, names: string | undefined): void {
  for (const name of names?.trim().split(/\s+/) ?? []) {
    if (name) element.classList.add(name);
  }
}

/**
 * Stamp the canonical part token(s) plus every additional token the caller
 * supplied, de-duplicated in first-seen order.
 *
 * The union of the four historic shapes: `canonical` takes the single token
 * most presenters pass or the list the composite ones do, and `additional` is
 * variadic for the presenters that merge several caller keys onto one node.
 *
 * Both sides are split on whitespace, because four presenters pass a joined
 * canonical — `'track seek'`, `'canvas surface'`, `'region marker'`,
 * `` `button ${modifier}` ``. Treating that as one opaque token made the
 * de-duplication above a lie exactly when it mattered: a caller whose own part
 * repeated a canonical one got it twice in the attribute.
 */
export function setParts(
  element: Element,
  canonical: string | readonly string[],
  ...additional: ReadonlyArray<string | undefined>
): void {
  const split = (value: string | undefined): string[] => value?.trim().split(/\s+/) ?? [];
  const tokens = [
    ...(typeof canonical === 'string' ? split(canonical) : canonical.flatMap(split)),
    ...additional.flatMap(split),
  ].filter(Boolean);
  element.setAttribute('part', [...new Set(tokens)].join(' '));
}

/** A snapshot number, or the fallback when it is absent, non-numeric or NaN/±Infinity. */
export function finite(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/**
 * Clamp an untrusted number into `[minimum, maximum]`. A non-finite value
 * lands on `fallback`, which defaults to the bottom of the range.
 */
export function clamp(
  value: unknown,
  minimum: number,
  maximum: number,
  fallback: number = minimum,
): number {
  return Math.max(minimum, Math.min(maximum, finite(value, fallback)));
}

/** The `0…1` case, which is most of them: progress, level, ratio. */
export function clamp01(value: unknown): number {
  return Math.max(0, Math.min(1, finite(value)));
}

/**
 * Mark a presenter's empty-state node as a live region, so the message it
 * carries is announced when it appears instead of only being visible.
 *
 * Five presenters rendered an empty state that said nothing to a screen reader,
 * each in a different shape — a list item, an absolutely-positioned overlay, a
 * fragment child. They stay in their own layouts: what they share is the
 * announce policy, not the widget, and this keeps that policy in one place.
 * `mountStatus` is the standalone status SURFACE and is a different thing —
 * mounting one inside a `<li>` or an overlay would be forcing two unrelated
 * shapes together.
 */
export function markEmptyState(node: Element): void {
  node.setAttribute('role', 'status');
  node.setAttribute('aria-live', 'polite');
}

/**
 * A positive size, or the fallback. `finite` accepts `0` and negatives, which a
 * width, a height or a device-pixel ratio must not be.
 *
 * Deliberately not a string parser: the audio side has three `numericSize`
 * helpers that take `string | null` and parse it, and merging them here would
 * change their behaviour — `finitePositive('160', 48)` is 48, not 160.
 */
export function finitePositive(value: unknown, fallback: number): number {
  const numeric = finite(value, fallback);
  return numeric > 0 ? numeric : fallback;
}
