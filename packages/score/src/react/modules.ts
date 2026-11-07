import {useCallback, useRef, useSyncExternalStore} from 'react';
import type {ModuleHandle, ModulePort} from '@webmusic/kernel/module';
import type {ModuleSession, SessionTransportSnapshot} from '@webmusic/kernel/session';

/**
 * Read a Session's committed snapshot in React (DEC-068). The hook borrows the
 * Session: it subscribes while mounted and never commands or disposes it.
 */
export function useSessionSnapshot(session: ModuleSession | undefined): SessionTransportSnapshot | undefined {
  // `snapshot` is a fresh frozen value per read; cache the committed one per
  // Session so React sees a stable value between notifications.
  const cache = useRef<{session?: ModuleSession; value?: SessionTransportSnapshot}>({});
  const read = () => {
    if (cache.current.session !== session) cache.current = {session, value: session?.snapshot};
    return cache.current.value;
  };
  const subscribe = useCallback((notify: () => void) => session?.subscribe((event) => {
    cache.current = {session, value: event.snapshot};
    notify();
  }) ?? (() => {}), [session]);
  return useSyncExternalStore(subscribe, read, read);
}

/**
 * Read a module's current ports in React, refreshed on the module's change
 * notifications. The module stays borrowed.
 */
export function useModulePorts(module: ModuleHandle | undefined): readonly ModulePort[] {
  const empty = useRef<readonly ModulePort[]>(Object.freeze([]));
  const subscribe = useCallback((notify: () => void) => module?.subscribe?.(() => notify()) ?? (() => {}), [module]);
  const read = () => module?.ports?.() ?? empty.current;
  return useSyncExternalStore(subscribe, read, read);
}
