import type {ModuleContext} from './module/context';
import type {ModuleHandle} from './module/registry';
import {observeElementTarget} from './element-target';

const requestEvent = 'webmusic-context-request';
const contextEvent = 'webmusic:contextchange';
const moduleEvent = 'webmusic:modulechange';
const providers = new WeakMap<Element, () => ModuleContext | undefined>();

export type ModuleContextState = 'ready' | 'pending' | 'missing';
interface ContextRequest {
  requester: Element;
  claimed: boolean;
  context?: ModuleContext;
}

function parentElement(element: Element): Element | undefined {
  if (element.assignedSlot) return element.assignedSlot;
  if (element.parentElement) return element.parentElement;
  const root = element.getRootNode();
  return 'host' in root ? (root as ShadowRoot).host : undefined;
}

function unknownCustomElement(element: Element): boolean {
  return element.localName.includes('-') &&
    !element.ownerDocument.defaultView?.customElements.get(element.localName);
}

function boundary(host: Element): Element | undefined {
  for (let element = parentElement(host); element; element = parentElement(element)) {
    if (providers.has(element) || element.hasAttribute('composition') ||
      (isModularComposition(host) && unknownCustomElement(element))) return element;
  }
  return undefined;
}

function dispatch(host: Element, name: string, detail?: unknown): void {
  const Constructor = host.ownerDocument.defaultView?.CustomEvent;
  if (Constructor) host.dispatchEvent(new Constructor(name, {bubbles: true, composed: true, detail}));
}

/** Nearest explicit composition mode; crossing ShadowRoot uses its host, never private tree scanning. */
export function isModularComposition(host: Element): boolean {
  for (let element: Element | undefined = host; element; element = parentElement(element)) {
    if (element.hasAttribute('composition')) return element.getAttribute('composition') === 'modules';
  }
  return false;
}

/** Provide a pending boundary until read() returns a context. Disposal revokes only this provider. */
export function provideModuleContext(host: Element, read: () => ModuleContext | undefined): () => void {
  if (providers.has(host)) throw new Error('Element already provides a module context');
  providers.set(host, read);
  const onRequest = (event: Event): void => {
    const request = (event as CustomEvent<ContextRequest>).detail;
    if (!request || request.claimed || request.requester === host) return;
    // The composed path includes slot providers visible to this listener even in a closed root.
    const nearest = event.composedPath().find(candidate => {
      if (candidate === request.requester || !('nodeType' in candidate) || candidate.nodeType !== 1) return false;
      const element = candidate as Element;
      return providers.has(element) || element.hasAttribute('composition') ||
        (isModularComposition(request.requester) && unknownCustomElement(element));
    });
    if (nearest !== host) return;
    request.claimed = true;
    request.context = read();
  };
  // Native slotchange is not composed. A provider inside a closed root can
  // announce reassignment without exposing or scanning its private tree.
  const onSlotChange = (): void => notifyModuleContext(host);
  host.addEventListener(requestEvent, onRequest);
  host.addEventListener('slotchange', onSlotChange);
  notifyModuleContext(host);
  let active = true;
  return () => {
    if (!active) return;
    active = false;
    host.removeEventListener(requestEvent, onRequest);
    host.removeEventListener('slotchange', onSlotChange);
    if (providers.get(host) === read) providers.delete(host);
    notifyModuleContext(host);
  };
}

function resolveContext(host: Element): {context?: ModuleContext; state: ModuleContextState} {
  const nearest = boundary(host);
  const request: ContextRequest = {requester: host, claimed: false};
  dispatch(host, requestEvent, request);
  return {context: request.context, state: request.context ? 'ready' : request.claimed || nearest ? 'pending' : 'missing'};
}

export function requestModuleContext(host: Element): ModuleContext | undefined { return resolveContext(host).context; }
export function getModuleContextState(host: Element): ModuleContextState { return resolveContext(host).state; }
export function hasModuleContextBoundary(host: Element): boolean { return resolveContext(host).state !== 'missing'; }
export function notifyModuleContext(host: Element): void { dispatch(host, contextEvent); }
export function notifyModuleChange(host: Element): void { dispatch(host, moduleEvent); }

/** Discovery is synchronous; observations re-evaluate after provider changes, upgrades and layout moves. */
export function observeModuleContext(
  host: Element,
  callback: (context: ModuleContext | undefined, state: ModuleContextState) => void,
): () => void {
  let active = true;
  let initialized = false;
  let previous: ModuleContext | undefined;
  let previousState: ModuleContextState | undefined;
  const waiting = new Map<string, {ready?: () => void}>();
  const registry = host.ownerDocument.defaultView?.customElements;
  const roots = new Set<EventTarget>();
  const Observer = host.ownerDocument.defaultView?.MutationObserver;
  const observer = Observer ? new Observer(() => resolve()) : undefined;
  const refreshRoots = (): void => {
    const next = new Set<EventTarget>([host.ownerDocument, host.getRootNode()]);
    for (let element = parentElement(host); element; element = parentElement(element)) next.add(element.getRootNode());
    if (next.size === roots.size && [...next].every(root => roots.has(root))) return;
    observer?.disconnect();
    for (const root of roots) {
      root.removeEventListener(contextEvent, resolve);
      root.removeEventListener('slotchange', resolve);
    }
    roots.clear();
    for (const root of next) {
      roots.add(root);
      root.addEventListener(contextEvent, resolve);
      root.addEventListener('slotchange', resolve);
      if ('nodeType' in root) observer?.observe(root as Node, {
        childList: true, subtree: true, attributes: true, attributeFilter: ['composition', 'slot', 'name'],
      });
    }
  };
  const resolve = (): void => {
    if (!active) return;
    refreshRoots();
    for (let element = parentElement(host); element; element = parentElement(element)) {
      if (unknownCustomElement(element) && registry && !waiting.has(element.localName)) {
        const name = element.localName;
        const entry = {ready: resolve as (() => void) | undefined};
        waiting.set(name, entry);
        // A never-defined custom element must not retain a released host.
        void registry.whenDefined(name).then(() => {
          const ready = entry.ready;
          entry.ready = undefined;
          ready?.();
        }, () => { entry.ready = undefined; });
      }
    }
    const {context, state} = resolveContext(host);
    if (initialized && context === previous && state === previousState) return;
    initialized = true;
    previous = context;
    previousState = state;
    callback(context, state);
  };
  const dispose = (): void => {
    if (!active) return;
    active = false;
    observer?.disconnect();
    for (const root of roots) {
      root.removeEventListener(contextEvent, resolve);
      root.removeEventListener('slotchange', resolve);
    }
    roots.clear();
    for (const entry of waiting.values()) entry.ready = undefined;
    waiting.clear();
  };
  try { resolve(); } catch (error) { dispose(); throw error; }
  return dispose;
}

/** Observe an explicit same-root selector's .module and its public capability invalidations. */
export function observeModuleTarget(
  host: Element,
  selector: string,
  callback: (target: ModuleHandle | undefined) => void,
): () => void {
  let active = true;
  let target: Element | undefined;
  let stopModule: (() => void) | undefined;
  let stopElement: (() => void) | undefined;
  let module: ModuleHandle | undefined;
  let subscription: object | undefined;
  let reading = false;
  let dirty = false;
  let selectionRoot: Node | undefined;
  const Observer = host.ownerDocument.defaultView?.MutationObserver;
  const observer = Observer ? new Observer(() => refreshSelection()) : undefined;

  const dispose = (): void => {
    if (!active) return;
    active = false;
    subscription = undefined;
    observer?.disconnect();
    target?.removeEventListener(moduleEvent, onChange);
    target = undefined;
    module = undefined;
    const releases = [stopElement, stopModule];
    stopElement = stopModule = undefined;
    let failure: unknown;
    for (const release of releases) {
      try { release?.(); } catch (error) { failure ??= error; }
    }
    if (failure !== undefined) throw failure;
  };

  const read = (): void => {
    if (!active) return;
    if (reading) { dirty = true; return; }
    reading = true;
    try {
      do {
        dirty = false;
        const current = (target as (Element & {module?: ModuleHandle}) | undefined)?.module;
        if (!active) return;
        if (current !== module || (current !== undefined && subscription === undefined)) {
          // Invalidate callbacks before any external unsubscribe can re-enter.
          subscription = undefined;
          module = current;
          const release = stopModule;
          stopModule = undefined;
          release?.();
          if (!active) return;
          if (dirty) continue;
          const token = {};
          subscription = token;
          let subscribing = true;
          const stop = current?.subscribe?.(() => {
            if (!active || subscription !== token) return;
            // Coalesce immediate subscription delivery until its disposer is
            // available, so an initial callback failure can release it.
            if (!subscribing) read();
          });
          subscribing = false;
          if (active && subscription === token) stopModule = stop;
          else stop?.();
        }
        if (!active) return;
        if (dirty) continue;
        callback(module);
      } while (active && dirty);
    } catch (error) {
      try { dispose(); } catch { /* Preserve the callback/subscription failure. */ }
      throw error;
    } finally {
      reading = false;
    }
  };
  const onChange = (event: Event): void => {
    if (event.composedPath()[0] === target) read();
  };

  const bind = (next: Element | undefined): void => {
    if (!active) return;
    target?.removeEventListener(moduleEvent, onChange);
    target = next;
    target?.addEventListener(moduleEvent, onChange);
    read();
  };

  const refreshSelection = (): void => {
    if (!active) return;
    const root = host.getRootNode();
    if (root === selectionRoot) return;
    selectionRoot = root;
    observer?.disconnect();
    observer?.observe(root, {childList: true, subtree: true});
    if (root !== host.ownerDocument) observer?.observe(host.ownerDocument, {childList: true, subtree: true});
    const previous = stopElement;
    stopElement = undefined;
    try {
      previous?.();
      const stop = observeElementTarget(host, selector, bind);
      if (active && selectionRoot === root) stopElement = stop;
      else stop();
    } catch (error) {
      try { dispose(); } catch { /* Preserve the setup failure. */ }
      throw error;
    }
  };
  try { refreshSelection(); } catch (error) {
    try { dispose(); } catch { /* See above. */ }
    throw error;
  }
  return dispose;
}
