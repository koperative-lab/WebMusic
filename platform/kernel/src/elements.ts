// ============================================================================
// SSR-safe custom-element base + attribute helpers shared by every element
// module in both families. Extracted from @webscore/view's base.ts (the
// superset of the six per-package copies).
//
// `HTMLElement` does not exist in Node, so `class X extends HTMLElement` at
// module top level throws a ReferenceError the moment the module is imported
// server-side. Extending `HTMLElementBase` instead keeps the modules importable
// anywhere; the `define*` guards already prevent registration outside the
// browser, and the class is never instantiated without a DOM.
// ============================================================================

export const HTMLElementBase = (
  typeof HTMLElement !== "undefined" ? HTMLElement : (class {} as unknown)
) as typeof HTMLElement;

/** Cleanup owned by one connected lifetime of a {@link WebMusicElement}. */
export type ElementCleanup = () => void;

interface ElementMountScope {
  generation: number;
  cleanups: ElementCleanup[];
}

/**
 * Minimal lifecycle base for WebMusic custom elements.
 *
 * It deliberately owns no Shadow DOM, UI profile, presenter, registration or
 * domain state. Subclasses mount those concerns in {@link onMount}, and either
 * return a cleanup or register several cleanups with {@link own}. Every
 * connection gets a fresh cleanup scope, so disconnect/reconnect is safe.
 */
export abstract class WebMusicElement extends HTMLElementBase {
  #mounted = false;
  #generation = 0;
  #cleanups: ElementCleanup[] = [];
  #mountScopes: ElementMountScope[] = [];

  /** Browser lifecycle entry point. Prefer overriding {@link onMount}. */
  connectedCallback(): void {
    if (this.#mounted) return;
    this.#mounted = true;
    const generation = ++this.#generation;
    const cleanups: ElementCleanup[] = [];
    const scope: ElementMountScope = { generation, cleanups };
    this.#cleanups = cleanups;
    this.#mountScopes.push(scope);

    try {
      const cleanup = this.onMount();
      if (cleanup !== undefined) {
        if (
          this.#mounted &&
          this.#generation === generation &&
          this.#cleanups === cleanups
        ) {
          cleanups.push(cleanup);
        } else {
          // onMount may synchronously disconnect/reconnect before returning.
          // Its returned cleanup belongs to that stale lifetime, never to the
          // newly connected one.
          // The surrounding catch reports a failed cleanup exactly once.
          cleanup();
        }
      }
    } catch (error) {
      const errors: unknown[] = [error];
      if (this.#generation === generation) {
        this.#mounted = false;
        this.#generation += 1;
        if (this.#cleanups === cleanups) this.#cleanups = [];
      }
      errors.push(...this.#drainCleanups(cleanups));
      this.#report(errors);
    } finally {
      const scopeIndex = this.#mountScopes.lastIndexOf(scope);
      if (scopeIndex >= 0) this.#mountScopes.splice(scopeIndex, 1);
    }
  }

  /** Browser lifecycle entry point. Prefer overriding {@link onUnmount}. */
  disconnectedCallback(): void {
    if (!this.#mounted) return;
    this.#mounted = false;
    this.#generation += 1;
    // Detach this lifetime's stack before invoking any user cleanup. A cleanup
    // may synchronously reconnect the element and register a fresh stack.
    const cleanups = this.#cleanups;
    this.#cleanups = [];

    const errors: unknown[] = [];
    try {
      this.onUnmount();
    } catch (error) {
      errors.push(error);
    }
    errors.push(...this.#drainCleanups(cleanups));
    this.#report(errors);
  }

  /** Mount UI and domain bindings for the current connected lifetime. */
  protected onMount(): ElementCleanup | void {}

  /** Run subclass-specific unmount work before owned cleanups are released. */
  protected onUnmount(): void {}

  /**
   * Own a cleanup for the current connected lifetime.
   *
   * Cleanups run once in reverse registration order. Registering outside an
   * active mount is rejected, preventing resources from silently leaking.
   */
  protected own<T extends ElementCleanup>(cleanup: T): T {
    const scope = this.#mountScopes[this.#mountScopes.length - 1];
    if (!scope && !this.#mounted) {
      throw new Error("WebMusicElement can only own cleanup while mounted");
    }
    if (typeof cleanup !== "function") {
      throw new TypeError("WebMusicElement cleanup must be a function");
    }
    if (scope) {
      if (
        this.#mounted &&
        this.#generation === scope.generation &&
        this.#cleanups === scope.cleanups
      ) {
        scope.cleanups.push(cleanup);
      } else {
        // A stale onMount can resume after it synchronously disconnected and a
        // nested connection installed a fresh cleanup scope. Release late
        // ownership immediately instead of attaching it to the new lifetime.
        cleanup();
      }
      return cleanup;
    }
    this.#cleanups.push(cleanup);
    return cleanup;
  }

  /**
   * Handle a mount, unmount or cleanup failure after rollback has completed.
   * Override to integrate an application's error reporting policy.
   */
  protected onLifecycleError(error: unknown): void {
    throw error;
  }

  #drainCleanups(cleanups: ElementCleanup[]): unknown[] {
    const errors: unknown[] = [];
    while (cleanups.length > 0) {
      const cleanup = cleanups.pop();
      try {
        cleanup?.();
      } catch (error) {
        errors.push(error);
      }
    }
    return errors;
  }

  #report(errors: readonly unknown[]): void {
    let reportingFailure: unknown;
    let reportingFailed = false;
    for (const error of errors) {
      try {
        this.onLifecycleError(error);
      } catch (failure) {
        if (!reportingFailed) {
          reportingFailed = true;
          reportingFailure = failure;
        }
      }
    }
    if (reportingFailed) throw reportingFailure;
  }
}

/**
 * Classic "lazy properties" upgrade fix: if a property was assigned on the
 * instance BEFORE the element was upgraded (e.g. `el.score = s` ran before
 * `customElements.define`), the plain own property shadows the class accessor.
 * Re-routing it through the (now installed) prototype setter makes the value
 * take effect. Call from `connectedCallback` for each public property.
 */
export function upgradeProperty(el: HTMLElement, prop: string): void {
  if (Object.prototype.hasOwnProperty.call(el, prop)) {
    const value = (el as unknown as Record<string, unknown>)[prop];
    delete (el as unknown as Record<string, unknown>)[prop];
    (el as unknown as Record<string, unknown>)[prop] = value;
  }
}

/** {@link upgradeProperty} for several properties at once. */
export function upgradeProperties(
  el: HTMLElement,
  props: readonly string[],
): void {
  for (const prop of props) upgradeProperty(el, prop);
}

/**
 * Read a numeric attribute with a fallback and optional clamping. Unlike
 * `Number(this.getAttribute(...))`, an absent, empty or non-numeric value
 * (e.g. `pixels-per-second="abc"` → NaN) falls back instead of poisoning
 * downstream maths (NaN widths, NaN lane heights, …).
 */
export function numAttr(
  el: Element,
  name: string,
  fallback: number,
  min?: number,
  max?: number,
): number {
  const raw = el.getAttribute(name);
  let value = raw == null || raw.trim() === "" ? fallback : Number(raw);
  if (!Number.isFinite(value)) value = fallback;
  if (min !== undefined) value = Math.max(min, value);
  if (max !== undefined) value = Math.min(max, value);
  return value;
}

/**
 * Read a tri-state boolean attribute: absent → `fallback`; present reads
 * `false` / `0` / `no` / `off` (any case) as false and anything else —
 * including the bare attribute — as true.
 */
export function boolAttr(el: Element, name: string, fallback = false): boolean {
  const raw = el.getAttribute(name);
  if (raw == null) return fallback;
  return !/^(false|0|no|off)$/i.test(raw.trim());
}

/**
 * Interpret a size attribute as a CSS length: a bare number is pixels
 * (`width="640"` → `640px`), anything else passes through untouched
 * (`width="100%"`, `height="12rem"`). Empty / absent → `undefined`.
 */
export function cssSizeAttr(el: Element, name: string): string | undefined {
  const raw = el.getAttribute(name)?.trim();
  if (!raw) return undefined;
  return /^-?\d+(\.\d+)?$/.test(raw) ? `${raw}px` : raw;
}

/** Register `ctor` at `tag` once; a no-op outside the browser or if taken. */
export function defineOnce(tag: string, ctor: CustomElementConstructor): void {
  if (typeof customElements !== "undefined" && !customElements.get(tag))
    customElements.define(tag, ctor);
}

export type ElementTargetState = 'ready' | 'missing' | 'invalid' | 'ambiguous';

/** Release the host callback even if an unknown custom element is never defined. */
function observeDefinition(registry: CustomElementRegistry, name: string, onReady: () => void): () => void {
  let callback: (() => void) | undefined = onReady;
  void registry.whenDefined(name).then(
    () => {
      const ready = callback;
      callback = undefined;
      ready?.();
    },
    () => { callback = undefined; },
  );
  return () => { callback = undefined; };
}

/**
 * Observe one unique selector match in the host's own Document/ShadowRoot.
 * The callback runs immediately and after target replacement or late upgrade.
 * The caller owns the returned cleanup for the host's connected lifetime.
 * A custom target replacing a non-reflected object property can dispatch
 * `webmusic:sourcechange` to request a fresh connection to the same element.
 */
export function observeElementTarget(
  host: Element,
  selector: string,
  listener: (target: Element | undefined, state: ElementTargetState) => void,
): () => void {
  const root = host.getRootNode() as ParentNode & Node;
  let active = true;
  let previous: Element | undefined;
  let previousState: ElementTargetState | undefined;
  const waiting = new Set<string>();
  const upgradeCleanups: Array<() => void> = [];
  const registry = host.ownerDocument?.defaultView?.customElements;
  const resolve = (force = false): void => {
    if (!active) return;
    let target: Element | undefined;
    let state: ElementTargetState;
    try {
      const matches = typeof root.querySelectorAll === 'function'
        ? root.querySelectorAll(selector)
        : [root.querySelector(selector)].filter(Boolean);
      state = matches.length > 1 ? 'ambiguous' : matches.length === 1 ? 'ready' : 'missing';
      if (state === 'ready') target = matches[0] ?? undefined;
    } catch {
      state = 'invalid';
    }
    if (target && registry && target.localName.includes('-') && !registry.get(target.localName) && !waiting.has(target.localName)) {
      const name = target.localName;
      waiting.add(name);
      upgradeCleanups.push(observeDefinition(registry, name, () => {
        if (active) resolve(previous?.localName === name);
      }));
    }
    if (!force && target === previous && state === previousState) return;
    previous = target;
    previousState = state;
    listener(target, state);
  };
  // Source replacement is local to the selected element. A different player
  // in the same root must not reset this target's subscribers. Still resolve
  // the selector so a replacement announced before mutation delivery is seen.
  const onSourceChange = (event: Event): void => resolve(event.target === previous);
  const Observer = host.ownerDocument?.defaultView?.MutationObserver;
  const observer = Observer ? new Observer(() => resolve()) : undefined;
  observer?.observe(root, {childList: true, subtree: true, attributes: true});
  root.addEventListener?.('webmusic:sourcechange', onSourceChange);
  try {
    resolve();
  } catch (error) {
    active = false;
    observer?.disconnect();
    for (const cleanup of upgradeCleanups.splice(0)) cleanup();
    root.removeEventListener?.('webmusic:sourcechange', onSourceChange);
    throw error;
  }
  return () => {
    if (!active) return;
    active = false;
    observer?.disconnect();
    for (const cleanup of upgradeCleanups.splice(0)) cleanup();
    root.removeEventListener?.('webmusic:sourcechange', onSourceChange);
  };
}
