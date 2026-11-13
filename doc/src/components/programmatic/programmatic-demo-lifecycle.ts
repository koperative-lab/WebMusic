import {mountDemos, type DemoScope} from '../demo-lifecycle';

type Setup = (root: HTMLElement, scope: DemoScope) => void | Promise<void>;

/** Show one failure line under the demo, or hide it for an empty message. */
export function programmaticFeedback(root: HTMLElement, message: string): void {
  const node = root.querySelector<HTMLElement>('[data-hl-feedback]');
  if (node) { node.textContent = message; node.hidden = !message; }
}

/**
 * Mount a Headless demo that drives its object from its own stage controls.
 * A control's action clears the previous failure; a failure from setup, a
 * listener or a tracked operation is shown in the frame's one feedback line.
 */
export function mountProgrammaticDemo(selector: string, setup: Setup): () => void {
  return mountDemos(selector, (root, outer) => {
    const report = (error: unknown): void => {
      if (outer.active) programmaticFeedback(root, error instanceof Error ? error.message : String(error));
      console.error('[WebMusic demo]', error);
    };
    const scope: DemoScope = {
      get active() { return outer.active; },
      signal: outer.signal,
      add: (cleanup) => outer.add(cleanup),
      listen(target, event, listener) {
        outer.listen(target, event, (input) => {
          programmaticFeedback(root, '');
          try { return Promise.resolve(listener(input)).catch(report); } catch (error) { report(error); }
        });
      },
      run(operation, onError) {
        void operation.catch((error) => {
          if (!outer.active) return;
          onError?.();
          report(error);
        });
      },
    };
    return Promise.resolve(setup(root, scope)).catch(report);
  });
}
