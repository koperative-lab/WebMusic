// Bind the shared HeadlessTransport row to the object an Audio Headless demo
// drives. The row reads position by polling at 10 Hz rather than through an
// object-specific event, so every transport-shaped object paints the same way;
// the demo still subscribes to the object's own events for anything else.
import type {DemoScope} from '../demo-lifecycle';

export interface TransportLike {
  play(): void | Promise<void>;
  pause(): void;
  readonly seconds: number;
  readonly duration: number;
  readonly playing: boolean;
}

export interface BoundTransport {
  /** Repaint now, after a seek or a source change. */
  paint(): void;
}

/**
 * Wire the row inside `root` to `current()`, which may change (a demo that
 * rebuilds its object returns the new one). The button is enabled once
 * `current()` returns an object; a failed play is reported through the scope.
 */
export function bindTransport(root: HTMLElement, scope: DemoScope, current: () => TransportLike | undefined): BoundTransport {
  const button = root.querySelector<HTMLButtonElement>('[data-hl-play]');
  const fill = root.querySelector<HTMLElement>('[data-hl-fill]');
  const time = root.querySelector<HTMLElement>('[data-hl-time]');
  const paint = (): void => {
    const target = current();
    if (button) {
      button.disabled = !target;
      button.textContent = target?.playing ? '⏸ Pause' : '▶ Play';
    }
    if (!target) return;
    const duration = target.duration || 0;
    if (fill) fill.style.width = `${duration ? Math.min(100, (target.seconds / duration) * 100) : 0}%`;
    if (time) time.textContent = `${target.seconds.toFixed(1)} / ${duration.toFixed(1)} s`;
  };
  if (button) {
    scope.listen(button, 'click', () => {
      const target = current();
      if (!target) return;
      if (target.playing) target.pause();
      else scope.run(Promise.resolve(target.play()), paint);
      paint();
    });
  }
  const timer = window.setInterval(paint, 100);
  scope.add(() => window.clearInterval(timer));
  paint();
  return {paint};
}
