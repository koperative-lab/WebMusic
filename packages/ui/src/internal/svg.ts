import {createErrorSink} from './lifecycle';

/**
 * Lifecycle for SVG geometry that has to follow its rendered viewport.
 *
 * The chart presenters deliberately stretch a square viewBox across a wide
 * surface. Lines and areas should stretch with that surface, but a control
 * point should remain round in screen space. This helper counter-scales only
 * presenter-owned circles while leaving the chart coordinate system intact.
 */
export interface RoundSvgCirclesHandle {
  /** Recalculate transforms after circle positions or the SVG matrix change. */
  update(): void;
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

  const update = (): void => {
    if (destroyed) return;
    try {
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

      const xCompensation = scaleY / scaleX;
      for (const circle of circles()) {
        const cx = Number(circle.getAttribute('cx'));
        const cy = Number(circle.getAttribute('cy'));
        if (!Number.isFinite(cx) || !Number.isFinite(cy)) continue;
        const inverseCx = cx === 0 ? 0 : -cx;
        const inverseCy = cy === 0 ? 0 : -cy;
        circle.setAttribute(
          'transform',
          `translate(${cx} ${cy}) scale(${xCompensation} 1) translate(${inverseCx} ${inverseCy})`,
        );
      }
    } catch (error) {
      report(error);
    }
  };

  const ResizeObserverClass = svg.ownerDocument.defaultView?.ResizeObserver;
  if (ResizeObserverClass) {
    try {
      resizeObserver = new ResizeObserverClass(update);
      resizeObserver.observe(svg);
    } catch (error) {
      report(error);
    }
  }

  return {
    update,
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
