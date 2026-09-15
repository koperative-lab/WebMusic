type Cleanup = () => void | Promise<void>;

export interface DemoScope {
  readonly active: boolean;
  readonly signal: AbortSignal;
  add(cleanup: Cleanup): void;
  listen(target: EventTarget, event: string, listener: (event: Event) => unknown): void;
  run(operation: Promise<unknown>, onError?: () => void): void;
}

type Setup = (root: HTMLElement, scope: DemoScope) => void | Promise<void>;
interface Registration {
  selector: string;
  setup: Setup;
  mounted: Map<HTMLElement, () => void>;
}

const registrations = new Set<Registration>();
let observer: MutationObserver | undefined;
let suspended = false;

function report(error: unknown): void {
  console.error('[WebMusic demo]', error);
}

function release(cleanup: Cleanup): void {
  try {
    void Promise.resolve(cleanup()).catch(report);
  } catch (error) {
    report(error);
  }
}

function mount(registration: Registration, root: HTMLElement): void {
  const controller = new AbortController();
  const cleanups: Cleanup[] = [];
  const dispose = (): void => {
    if (controller.signal.aborted) return;
    controller.abort();
    for (const cleanup of cleanups.splice(0).reverse()) release(cleanup);
  };
  const scope: DemoScope = {
    get active() { return !controller.signal.aborted && root.isConnected; },
    signal: controller.signal,
    run(operation, onError) {
      void operation.catch((error) => {
        if (!scope.active) return;
        onError?.();
        report(error);
      });
    },
    add(cleanup) {
      if (controller.signal.aborted) release(cleanup);
      else cleanups.push(cleanup);
    },
    listen(target, event, listener) {
      const handler = (input: Event): void => {
        if (!scope.active) return;
        try {
          void Promise.resolve(listener(input)).catch((error) => {
            if (scope.active) report(error);
          });
        } catch (error) {
          if (scope.active) report(error);
        }
      };
      target.addEventListener(event, handler);
      scope.add(() => target.removeEventListener(event, handler));
    },
  };
  registration.mounted.set(root, dispose);
  try {
    void Promise.resolve(registration.setup(root, scope)).catch((error) => {
      if (scope.active) report(error);
      dispose();
    });
  } catch (error) {
    report(error);
    dispose();
  }
}

function refresh(): void {
  for (const registration of registrations) {
    for (const [root, dispose] of registration.mounted) {
      if (!root.isConnected) {
        registration.mounted.delete(root);
        dispose();
      }
    }
    if (!suspended) {
      for (const root of document.querySelectorAll<HTMLElement>(registration.selector)) {
        if (!registration.mounted.has(root)) mount(registration, root);
      }
    }
  }
}

/** Synchronize registered demos after an explicit caller inserts new markup. */
export function refreshDemos(): void {
  refresh();
}

function pause(): void {
  suspended = true;
  for (const registration of registrations) {
    for (const dispose of registration.mounted.values()) dispose();
    registration.mounted.clear();
  }
}

function resume(): void {
  suspended = false;
  refresh();
}

/** Mount existing and newly inserted demo roots; release them on removal/navigation. */
export function mountDemos(selector: string, setup: Setup): () => void {
  const registration: Registration = {selector, setup, mounted: new Map()};
  registrations.add(registration);
  if (!observer) {
    observer = new MutationObserver(refresh);
    observer.observe(document.documentElement, {childList: true, subtree: true});
    document.addEventListener('astro:before-swap', pause);
    document.addEventListener('astro:page-load', resume);
    window.addEventListener('pagehide', pause);
    window.addEventListener('pageshow', resume);
  }
  refresh();
  return () => {
    registrations.delete(registration);
    for (const dispose of registration.mounted.values()) dispose();
    registration.mounted.clear();
    if (registrations.size === 0) {
      observer?.disconnect();
      observer = undefined;
      suspended = false;
      document.removeEventListener('astro:before-swap', pause);
      document.removeEventListener('astro:page-load', resume);
      window.removeEventListener('pagehide', pause);
      window.removeEventListener('pageshow', resume);
    }
  };
}
