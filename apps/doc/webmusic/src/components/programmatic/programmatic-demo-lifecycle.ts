import {mountDemos, type DemoScope} from '../demo-lifecycle';

type Cleanup = () => void | Promise<void>;
type Setup = (root: HTMLElement, scope: DemoScope) => void | Promise<void>;

export function programmaticFeedback(root: HTMLElement, message: string): void {
  const node = root.querySelector<HTMLElement>('[data-hl-feedback]');
  if (node) { node.textContent = message; node.hidden = !message; }
}

export function programmaticCode(root: HTMLElement, code: string): void {
  const node = root.querySelector<HTMLElement>('[data-hl-readout]');
  if (node) node.textContent = code;
}

/** Keep each custom demo's real controls while giving Reset its own resource scope. */
export function mountProgrammaticDemo(selector: string, setup: Setup): () => void {
  return mountDemos(selector, (root, outer) => {
    const stage = root.querySelector<HTMLElement>('[data-hl-stage]');
    const parameters = root.querySelector<HTMLElement>('.wm-pg__params');
    const initialStage = stage?.innerHTML;
    const initialParameters = parameters?.innerHTML;
    const initialCode = root.querySelector<HTMLElement>('[data-hl-readout]')?.textContent ?? '';
    let releaseCurrent: (() => void) | undefined;
    const start = (): void => {
      releaseCurrent?.();
      if (!outer.active) return;
      if (stage && initialStage !== undefined) stage.innerHTML = initialStage;
      if (parameters && initialParameters !== undefined) parameters.innerHTML = initialParameters;
      programmaticCode(root, initialCode);
      programmaticFeedback(root, '');
      const controller = new AbortController();
      const cleanups: Cleanup[] = [];
      const report = (error: unknown): void => {
        if (!controller.signal.aborted && outer.active) {
          programmaticFeedback(root, error instanceof Error ? error.message : String(error));
        }
        console.error('[WebMusic demo]', error);
      };
      const release = (cleanup: Cleanup): void => {
        try { void Promise.resolve(cleanup()).catch(report); } catch (error) { report(error); }
      };
      const dispose = (): void => {
        if (controller.signal.aborted) return;
        controller.abort();
        for (const cleanup of cleanups.splice(0).reverse()) release(cleanup);
      };
      releaseCurrent = dispose;
      const scope: DemoScope = {
        get active() { return outer.active && !controller.signal.aborted; },
        signal: controller.signal,
        add(cleanup) { if (controller.signal.aborted) release(cleanup); else cleanups.push(cleanup); },
        listen(target, event, listener) {
          const handler = (input: Event): void => {
            if (!scope.active) return;
            programmaticFeedback(root, '');
            try { void Promise.resolve(listener(input)).catch((error) => { if (scope.active) report(error); }); }
            catch (error) { report(error); }
          };
          target.addEventListener(event, handler);
          scope.add(() => target.removeEventListener(event, handler));
        },
        run(operation, onError) {
          void operation.catch((error) => {
            if (!scope.active) return;
            onError?.();
            report(error);
          });
        },
      };
      try { void Promise.resolve(setup(root, scope)).catch((error) => { if (scope.active) { report(error); dispose(); } }); }
      catch (error) { report(error); dispose(); }
    };
    outer.add(() => releaseCurrent?.());
    outer.listen(root, 'wm:headless-reset', (event) => { if (event.target === root) start(); });
    start();
  });
}
