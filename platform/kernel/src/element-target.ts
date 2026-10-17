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
