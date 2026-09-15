import {mountDemos, type DemoScope} from '../components/demo-lifecycle';

// Real-object construction and commands; the shared frame owns the presentation.
export interface HeadlessDemoInstance {
  readonly object: Record<string, unknown>;
  /** Resolved public construction code when controls select fixture objects. */
  readonly construction?: string;
  /** Translate demonstration fixture/JSON inputs without wrapping the real object. */
  invoke?(name: string, args: unknown[]): unknown;
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
  construction: string;
  instance: HeadlessDemoInstance | null;
  unsubscribes: Array<() => void>;
  /** Bumped on every re-create so a slow factory cannot install a stale object. */
  generation: number;
  commandGeneration: number;
  feedbackRevision: number;
  scope: DemoScope;
};

function optionValue(control: HTMLInputElement | HTMLSelectElement): unknown {
  const kind = control.dataset.hlKind;
  const raw = control.value;
  if (kind === 'bool') {
    if (raw === 'unset') return undefined;
    return raw === 'on';
  }
  if (raw === '') return undefined;
  if (kind === 'number') {
    const value = Number(raw);
    return Number.isFinite(value) ? value : undefined;
  }
  return raw;
}

function readOptions(root: HTMLElement): Record<string, unknown> {
  const options: Record<string, unknown> = {};
  for (const control of root.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-hl-option]')) {
    const value = optionValue(control);
    if (value !== undefined) options[control.dataset.hlOption as string] = value;
  }
  return options;
}

/** The options literal as a reader would type it. */
function formatOptions(options: Record<string, unknown>): string {
  const entries = Object.entries(options);
  if (entries.length === 0) return '{}';
  const inline = `{${entries.map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join(', ')}}`;
  if (inline.length <= 60) return inline;
  return `{\n${entries.map(([k, v]) => `  ${k}: ${JSON.stringify(v)},`).join('\n')}\n}`;
}

function describe(value: unknown): string {
  if (value instanceof Error) return value.message;
  if (value === undefined || value === null) return '';
  if (typeof value !== 'object') return String(value);
  const result = value as Record<string, unknown>;
  if (result.error !== undefined) return `${typeof result.status === 'string' ? result.status + ': ' : ''}${describe(result.error)}`;
  if (typeof result.status === 'string') {
    const position = typeof result.quarters === 'number' ? ` · ${result.quarters} quarters`
      : typeof result.nominalSeconds === 'number' ? ` · ${result.nominalSeconds}s` : '';
    return result.status + position;
  }
  return '';
}

function feedback(panel: Panel, message: string): void {
  if (!panel.scope.active) return;
  ++panel.feedbackRevision;
  const node = panel.root.querySelector<HTMLElement>('[data-hl-feedback]');
  if (node) { node.hidden = !message; node.textContent = message; }
}

function updateReadout(panel: Panel, options: Record<string, unknown>): void {
  const readout = panel.root.querySelector<HTMLElement>('[data-hl-readout]');
  if (readout) readout.textContent = panel.construction.replace('{options}', formatOptions(options));
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

async function rebuild(panel: Panel): Promise<void> {
  const generation = ++panel.generation;
  try { clearInstance(panel); } catch (error) {
    feedback(panel, `Cleanup failed: ${describe(error)}`);
    return;
  }
  feedback(panel, 'Preparing demo…');

  const options = readOptions(panel.root);
  updateReadout(panel, options);

  let instance: HeadlessDemoInstance;
  try {
    instance = await panel.factory(options, panel.stage);
  } catch (error) {
    if (!panel.scope.active || generation !== panel.generation) return;
    feedback(panel, `Construction failed: ${describe(error)}`);
    return;
  }
  // A newer option change won the race while this factory was awaiting.
  if (!panel.scope.active || generation !== panel.generation) {
    instance.dispose();
    return;
  }

  panel.instance = instance;
  if (instance.construction !== undefined) {
    const readout = panel.root.querySelector<HTMLElement>('[data-hl-readout]');
    if (readout) readout.textContent = instance.construction;
  }
  try {
    const errors = JSON.parse(panel.root.dataset.hlErrors ?? '[]') as string[];
    const revision = panel.feedbackRevision;
    for (const name of errors) {
      const off = instance.on?.(name, (error) => {
        if (panel.instance === instance && generation === panel.generation) {
          feedback(panel, `${name}: ${describe(error)}`);
        }
      });
      if (off) panel.unsubscribes.push(off);
    }
    if (panel.feedbackRevision === revision) feedback(panel, '');
  } catch (error) {
    try { clearInstance(panel); } finally { feedback(panel, `Demo setup failed: ${describe(error)}`); }
  }
}

function callCommand(panel: Panel, control: HTMLElement): void {
  const object = panel.instance?.object;
  if (!object) return;
  const name = control.dataset.hlCommand as string;
  const method = object[name];
  if (typeof method !== 'function') {
    feedback(panel, `${name}() is unavailable.`);
    return;
  }
  const kind = control.dataset.hlKind;
  let args: unknown[] = [];
  if (kind !== 'action') {
    const raw = (control as HTMLInputElement | HTMLSelectElement).value;
    if (raw === '') return;
    args = [kind === 'number' ? Number(raw) : raw];
  }
  const instance = panel.instance;
  const generation = panel.generation;
  const command = ++panel.commandGeneration;
  let revision = panel.feedbackRevision;
  const report = (message: string): void => {
    if (!panel.scope.active || panel.instance !== instance || panel.generation !== generation
      || command !== panel.commandGeneration || revision !== panel.feedbackRevision) return;
    feedback(panel, message);
    revision = panel.feedbackRevision;
  };
  try {
    const result = instance?.invoke
      ? instance.invoke(name, args)
      : (method as (...a: unknown[]) => unknown).apply(object, args);
    if (result instanceof Promise) {
      report(`${name}() pending…`);
      void result.then((value: unknown) => {
        report(`${name}(): ${describe(value) || 'completed'}.`);
      }, (error: unknown) => {
        report(`${name}() failed: ${describe(error)}`);
      });
    } else report(`${name}(): ${describe(result) || 'completed'}.`);
  } catch (error) {
    report(`${name}() failed: ${describe(error)}`);
  }
}

function setup(root: HTMLElement, scope: DemoScope): void {
  const stage = root.querySelector<HTMLElement>('[data-hl-stage]');
  const key = root.dataset.hlFactory;
  if (!stage || !key) return;
  const start = (): void => {
    const factory = (window as unknown as Record<string, HeadlessDemoFactory | undefined>)[key];
    if (typeof factory !== 'function' || started || !scope.active) return;
    started = true;

    const panel: Panel = {
      root,
      stage,
      factory,
      construction: root.dataset.hlConstruction ?? '{options}',
      instance: null,
      unsubscribes: [],
      generation: 0,
      commandGeneration: 0,
      feedbackRevision: 0,
      scope,
    };
    scope.add(() => {
      ++panel.generation;
      clearInstance(panel);
    });

    for (const control of root.querySelectorAll<HTMLElement>('[data-hl-option]')) {
      scope.listen(control, 'change', () => rebuild(panel));
    }
    for (const control of root.querySelectorAll<HTMLElement>('[data-hl-command]')) {
      const event = control.dataset.hlKind === 'action' ? 'click' : 'change';
      let enteredValue: string | undefined;
      scope.listen(control, event, () => {
        if (control instanceof HTMLInputElement && enteredValue === control.value) {
          enteredValue = undefined;
          return;
        }
        callCommand(panel, control);
      });
      if (control instanceof HTMLInputElement) {
        scope.listen(control, 'input', () => { enteredValue = undefined; });
        scope.listen(control, 'keydown', (input) => {
          if (!(input instanceof KeyboardEvent) || input.key !== 'Enter') return;
          input.preventDefault();
          enteredValue = control.value;
          callCommand(panel, control);
        });
      }
    }
    const reset = root.querySelector('[data-hl-reset]');
    if (reset) scope.listen(reset, 'click', () => {
      for (const control of root.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-hl-option], [data-hl-command]')) {
        if (control instanceof HTMLSelectElement) {
          control.selectedIndex = Array.from(control.options).findIndex((option) => option.defaultSelected);
          if (control.selectedIndex < 0) control.selectedIndex = 0;
        } else if (control instanceof HTMLInputElement) control.value = control.defaultValue;
      }
      return rebuild(panel);
    });
    const copy = root.querySelector('[data-hl-copy]');
    let copyGeneration = 0;
    scope.listen(root, 'input', () => { ++copyGeneration; });
    if (copy) scope.listen(copy, 'click', async () => {
      const attempt = ++copyGeneration;
      const generation = panel.generation;
      const command = panel.commandGeneration;
      const revision = panel.feedbackRevision;
      const current = (): boolean => scope.active && attempt === copyGeneration
        && generation === panel.generation && command === panel.commandGeneration
        && revision === panel.feedbackRevision;
      try {
        if (!navigator.clipboard) throw new Error('Clipboard is unavailable in this browser.');
        const text = root.querySelector('[data-hl-readout]')?.textContent ?? '';
        await navigator.clipboard.writeText(text);
        if (current()) feedback(panel, 'Code copied.');
      } catch (error) { if (current()) feedback(panel, describe(error)); }
    });

    scope.run(rebuild(panel));
  };
  let started = false;
  // A factory script may run after this shared module during page navigation.
  scope.listen(window, 'wm:headless-factory-ready', start);
  start();
}

mountDemos('[data-wm-hl]', setup);
