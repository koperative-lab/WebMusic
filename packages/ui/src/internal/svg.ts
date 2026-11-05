import {createErrorSink} from './lifecycle';

/**
 * Lifecycle for SVG geometry that has to follow its rendered viewport.
 *
 * The chart presenters deliberately stretch a square viewBox across a wide
 * surface. Lines and areas should stretch with that surface, but a control
 * point should remain round in screen space. This helper counter-scales only
 * presenter-owned circles while leaving the chart coordinate system intact.
 *
 * Reading the screen matrix forces layout, so it is read when the SVG resizes
 * (or once, on first use, where no `ResizeObserver` exists) and cached; an
 * `update()` after a circle moves only writes attributes. A drag that moves a
 * point every frame therefore never interleaves a layout read with its writes.
 */
export interface RoundSvgCirclesHandle {
  /** Re-apply the cached compensation after circle positions change. Writes only. */
  update(): void;
  /** Re-read the SVG's screen matrix, then apply it. Forces layout. */
  measure(): void;
  /** Stop observing the SVG. Safe to call more than once. */
  destroy(): void;
}

export interface RoundSvgCirclesOptions {
  onError?: (error: unknown) => void;
}

/**
 * Keep circles round inside an SVG whose viewBox is scaled non-uniformly.
 *
 * `circles` is a getter because some presenters rebuild their points as their
 * binding changes. The circles keep their native tag, classes, parts and
 * pointer hit target; only a presenter-owned transform attribute is applied.
 */
export function keepSvgCirclesRound(
  svg: SVGSVGElement,
  circles: () => Iterable<SVGCircleElement>,
  options: RoundSvgCirclesOptions = {},
): RoundSvgCirclesHandle {
  const report = createErrorSink(options.onError);
  let destroyed = false;
  let resizeObserver: ResizeObserver | undefined;
  /** Horizontal compensation from the last good matrix, if one was read. */
  let compensation: number | undefined;

  const read = (): void => {
    const matrix = svg.getScreenCTM?.();
    if (!matrix) return;
    const scaleX = Math.hypot(matrix.a, matrix.b);
    const scaleY = Math.hypot(matrix.c, matrix.d);
    if (
      !Number.isFinite(scaleX) ||
      !Number.isFinite(scaleY) ||
      scaleX <= 0 ||
      scaleY <= 0
    ) return;
    compensation = scaleY / scaleX;
  };

  const apply = (): void => {
    if (compensation === undefined) return;
    for (const circle of circles()) {
      const cx = Number(circle.getAttribute('cx'));
      const cy = Number(circle.getAttribute('cy'));
      if (!Number.isFinite(cx) || !Number.isFinite(cy)) continue;
      const inverseCx = cx === 0 ? 0 : -cx;
      const inverseCy = cy === 0 ? 0 : -cy;
      circle.setAttribute(
        'transform',
        `translate(${cx} ${cy}) scale(${compensation} 1) translate(${inverseCx} ${inverseCy})`,
      );
    }
  };

  const measure = (): void => {
    if (destroyed) return;
    try {
      read();
      apply();
    } catch (error) {
      report(error);
    }
  };

  const update = (): void => {
    if (destroyed) return;
    try {
      // Without an observer nothing else will ever take the reading.
      if (compensation === undefined && !resizeObserver) read();
      apply();
    } catch (error) {
      report(error);
    }
  };

  const ResizeObserverClass = svg.ownerDocument.defaultView?.ResizeObserver;
  if (ResizeObserverClass) {
    try {
      resizeObserver = new ResizeObserverClass(measure);
      resizeObserver.observe(svg);
    } catch (error) {
      resizeObserver = undefined;
      report(error);
    }
  }

  return {
    update,
    measure,
    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      try {
        resizeObserver?.disconnect();
      } catch (error) {
        report(error);
      }
      resizeObserver = undefined;
    },
  };
}

/**
 * At most one drag application per animation frame.
 *
 * Pointer events arrive faster than the display refreshes, and each applied
 * position repaints a curve and may run a command. `schedule` keeps only the
 * latest position and applies it on the next frame; `flush` applies a pending
 * position immediately (a release commits exactly where the pointer stopped);
 * `cancel` drops it. A view without `requestAnimationFrame` applies at once.
 */
export interface DragFrame<T> {
  schedule(value: T): void;
  /** Apply the pending value now. Returns whether there was one. */
  flush(): boolean;
  /** Drop the pending value and its frame. Safe to call more than once. */
  cancel(): void;
}

type FrameView = Pick<Window, 'requestAnimationFrame' | 'cancelAnimationFrame'>;

export function createDragFrame<T>(
  view: Partial<FrameView> | null | undefined,
  apply: (value: T) => void,
  onError?: (error: unknown) => void,
): DragFrame<T> {
  const report = createErrorSink(onError);
  let pending: {value: T} | undefined;
  let frame: number | undefined;

  const stopFrame = (): void => {
    if (frame === undefined) return;
    const id = frame;
    frame = undefined;
    try {
      view?.cancelAnimationFrame?.(id);
    } catch (error) {
      report(error);
    }
  };

  const flush = (): boolean => {
    stopFrame();
    if (!pending) return false;
    const {value} = pending;
    pending = undefined;
    try {
      apply(value);
    } catch (error) {
      report(error);
    }
    return true;
  };

  return {
    schedule(value: T): void {
      pending = {value};
      if (frame !== undefined) return;
      if (!view?.requestAnimationFrame) {
        flush();
        return;
      }
      try {
        let ran = false;
        const id = view.requestAnimationFrame(() => {
          ran = true;
          if (frame !== id && frame !== undefined) return;
          frame = undefined;
          flush();
        });
        // A synchronous scheduler has already run the callback.
        if (!ran) frame = id;
      } catch (error) {
        report(error);
        flush();
      }
    },
    flush,
    cancel(): void {
      stopFrame();
      pending = undefined;
    },
  };
}
