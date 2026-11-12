import {mountDemos, type DemoScope} from '../components/demo-lifecycle';

// Real-object construction in its default configuration; the shared frame owns
// the presentation. The page's own stage carries the controls that operate it.
export interface HeadlessDemoInstance {
  readonly object: Record<string, unknown>;
  on?(event: string, handler: (payload: unknown) => void): () => void;
  dispose(): void;
}

export type HeadlessDemoFactory = (
  options: Record<string, unknown>,
  stage: HTMLElement,
) => HeadlessDemoInstance | Promise<HeadlessDemoInstance>;

type Panel = {
  root: HTMLElement;
  stage: HTMLElement;
  factory: HeadlessDemoFactory;
  instance: HeadlessDemoInstance | null;
  unsubscribes: Array<() => void>;
  scope: DemoScope;
};

function describe(value: unknown): string {
  if (value instanceof Error) return value.message;
  if (value === undefined || value === null) return '';
  if (typeof value !== 'object') return String(value);
  const result = value as Record<string, unknown>;
  if (result.error !== undefined) return `${typeof result.status === 'string' ? result.status + ': ' : ''}${describe(result.error)}`;
  return typeof result.status === 'string' ? result.status : '';
}

function feedback(panel: Panel, message: string): void {
  if (!panel.scope.active) return;
  const node = panel.root.querySelector<HTMLElement>('[data-hl-feedback]');
  if (node) { node.hidden = !message; node.textContent = message; }
}

function clearInstance(panel: Panel): void {
  const instance = panel.instance;
  panel.instance = null;
  const cleanups = [...panel.unsubscribes.splice(0), () => instance?.dispose()];
  const errors: unknown[] = [];
  for (const cleanup of cleanups) {
    try { cleanup(); } catch (error) { errors.push(error); }
  }
  if (errors.length) throw new AggregateError(errors, 'Headless demo cleanup failed');
}

/** Build the object once, in its default configuration, and report its errors. */
async function build(panel: Panel): Promise<void> {
  let instance: HeadlessDemoInstance;
  try {
    instance = await panel.factory({}, panel.stage);
  } catch (error) {
    feedback(panel, `Construction failed: ${describe(error)}`);
    return;
  }
  // The panel was removed while the factory was awaiting.
  if (!panel.scope.active) {
    instance.dispose();
    return;
  }
  panel.instance = instance;
  try {
    const errors = JSON.parse(panel.root.dataset.hlErrors ?? '[]') as string[];
    for (const name of errors) {
      const off = instance.on?.(name, (error) => {
        if (panel.instance === instance) feedback(panel, `${name}: ${describe(error)}`);
      });
      if (off) panel.unsubscribes.push(off);
    }
  } catch (error) {
    try { clearInstance(panel); } finally { feedback(panel, `Demo setup failed: ${describe(error)}`); }
  }
}

function setup(root: HTMLElement, scope: DemoScope): void {
  const stage = root.querySelector<HTMLElement>('[data-hl-stage]');
  const key = root.dataset.hlFactory;
  if (!stage || !key) return;
  let started = false;
  const start = (): void => {
    const factory = (window as unknown as Record<string, HeadlessDemoFactory | undefined>)[key];
    if (typeof factory !== 'function' || started || !scope.active) return;
    started = true;
    const panel: Panel = {root, stage, factory, instance: null, unsubscribes: [], scope};
    scope.add(() => clearInstance(panel));
    scope.run(build(panel));
  };
  // A factory script may run after this shared module during page navigation.
  scope.listen(window, 'wm:headless-factory-ready', start);
  start();
}

mountDemos('[data-wm-hl]', setup);
