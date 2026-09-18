import {bindLocalization, message as uiMessage, formatNumber, type UILocalization} from './localization';
import {installStyle} from './internal/style';
import {claimHost, createErrorSink} from './internal/lifecycle';
import {finitePositive, addClassNames, clamp, finite, setParts} from './internal/dom';
import type {CanvasStageFrame} from './stage';
import {componentSurfaceCss} from './internal/surface';

export interface MinimapState {
  minimum: number;
  maximum: number;
  start?: number;
  end?: number;
  disabled?: boolean;
}

export interface MinimapBinding {
  snapshot(): MinimapState;
  draw(frame: CanvasStageFrame): void;
  setRange?(start: number, end: number): Promise<void> | void;
  seek?(value: number): Promise<void> | void;
  subscribe?(notify: () => void): () => void;
}

export interface MinimapClassNames {
  root?: string;
  canvas?: string;
  brush?: string;
}

export interface MinimapParts {
  root?: string;
  canvas?: string;
  brush?: string;
}

export interface MinimapOptions {
  /** Borrowed live text and formatting; language updates preserve controls. */
  localization?: UILocalization;
  label?: string;
  fallbackWidth?: number;
  fallbackHeight?: number;
  /** Pointer distance from either brush edge that starts a resize. Defaults to 8 CSS px. */
  edgeSize?: number;
  /** Arrow-key movement as a fraction of the current range. Defaults to .25. */
  keyboardStep?: number;
  classNames?: MinimapClassNames;
  parts?: MinimapParts;
  onError?: (error: unknown) => void;
  /** Install the exported stylesheet into the host. Defaults to true. */
  stylesheet?: boolean;
}

export interface MinimapHandle {
  element: HTMLElement;
  canvas: HTMLCanvasElement;
  brush: HTMLDivElement;
  update(): void;
  destroy(): void;
}

type MinimapHost = HTMLElement | ShadowRoot;

interface NormalizedMinimapState {
  minimum: number;
  maximum: number;
  start?: number;
  end?: number;
  disabled: boolean;
}

interface DragState {
  mode: 'move' | 'start' | 'end';
  pointerId: number;
  grabValue: number;
}

const mounted = new WeakMap<MinimapHost, MinimapHandle>();

export const minimapStyle = String.raw`
.wui-minimap {
${componentSurfaceCss('minimap')}
  display: block;
  width: 100%;
  min-width: 0;
  height: 100%;
  color: var(--wm-minimap-foreground, var(--wm-waveform, var(--wm-foreground, #444)));
}
.wui-minimap__viewport {
  box-sizing: border-box;
  position: relative;
  display: block;
  width: 100%;
  min-width: 0;
  height: 100%;
  overflow: hidden;
  touch-action: none;
  background: var(--wm-minimap-background, transparent);
  border: var(--wm-minimap-border, 0);
  border-radius: var(--wm-minimap-radius, var(--wm-control-radius, 0));
}
.wui-minimap__canvas { display: block; width: 100%; height: 100%; }
.wui-minimap__brush {
  position: absolute;
  inset-block: 0;
  box-sizing: border-box;
  min-width: 1px;
  border: 1px solid var(--wm-minimap-brush-border, var(--wm-selection, #4869d8));
  background: var(--wm-minimap-brush, var(--wm-selection-fill, rgba(72,105,216,.18)));
  cursor: grab;
  touch-action: none;
}
.wui-minimap__brush[hidden] { display: none; }
.wui-minimap__brush:focus-visible {
  outline: 2px solid var(--wm-focus, currentColor);
  outline-offset: -2px;
}
.wui-minimap__brush[aria-disabled="true"] { cursor: default; opacity: .5; }
@media (forced-colors: active) {
  .wui-minimap__brush { border-color: Highlight; background: transparent; forced-color-adjust: none; }
}
`;


function normalize(raw: MinimapState): NormalizedMinimapState {
  const a = finite(raw.minimum, 0);
  const b = finite(raw.maximum, a);
  const minimum = Math.min(a, b);
  const maximum = Math.max(a, b);
  const hasRange =
    typeof raw.start === 'number' &&
    Number.isFinite(raw.start) &&
    typeof raw.end === 'number' &&
    Number.isFinite(raw.end) &&
    maximum > minimum;
  if (!hasRange) return {minimum, maximum, disabled: raw.disabled === true};
  const start = clamp(Math.min(raw.start!, raw.end!), minimum, maximum);
  const end = clamp(Math.max(raw.start!, raw.end!), start, maximum);
  return {minimum, maximum, start, end, disabled: raw.disabled === true};
}

/** Mount a generic overview canvas with an accessible, draggable range brush. */
export function mountMinimap(
  host: MinimapHost,
  binding: MinimapBinding,
  options: MinimapOptions = {},
): MinimapHandle {

  const document = host.ownerDocument;
  const view = document.defaultView;
  const style = installStyle(document, 'minimap', minimapStyle, options.stylesheet);

  const root = document.createElement('div');
  root.className = 'wui-minimap';
  addClassNames(root, options.classNames?.root);
  setParts(root, 'root', options.parts?.root);

  const viewport = document.createElement('div');
  viewport.className = 'wui-minimap__viewport';

  const canvas = document.createElement('canvas');
  canvas.className = 'wui-minimap__canvas';
  canvas.setAttribute('aria-hidden', 'true');
  addClassNames(canvas, options.classNames?.canvas);
  setParts(canvas, 'canvas', options.parts?.canvas);

  const brush = document.createElement('div');
  brush.className = 'wui-minimap__brush';
  brush.setAttribute('role', 'slider');
  brush.setAttribute('aria-label', options.label ?? 'Visible range');
  brush.tabIndex = 0;
  addClassNames(brush, options.classNames?.brush);
  setParts(brush, 'brush', options.parts?.brush);

  viewport.append(canvas, brush);
  root.append(viewport);

  const fallbackWidth = finitePositive(options.fallbackWidth, 320);
  const fallbackHeight = finitePositive(options.fallbackHeight, 40);
  const edgeSize = finitePositive(options.edgeSize, 8);
  const keyboardStep = clamp(finite(options.keyboardStep, .25), .001, 1);
  let state = normalize({minimum: 0, maximum: 0});
  let optimisticRange: {start: number; end: number; revision: number} | undefined;
  let commandRevision = 0;
  let destroyed = false;
  let unsubscribe: (() => void) | undefined;
  let releaseLocalization = (): void => {};
  let drag: DragState | undefined;
  let resizeObserver: ResizeObserver | undefined;

  const report = createErrorSink(options.onError);

  const frameSize = (): {width: number; height: number; pixelRatio: number} => {
    const width = finitePositive(viewport.clientWidth || canvas.clientWidth, fallbackWidth);
    const height = finitePositive(viewport.clientHeight || canvas.clientHeight, fallbackHeight);
    const pixelRatio = finitePositive(view?.devicePixelRatio, 1);
    const pixelWidth = Math.max(1, Math.round(width * pixelRatio));
    const pixelHeight = Math.max(1, Math.round(height * pixelRatio));
    if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
    if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
    return {width, height, pixelRatio};
  };

  const paintCanvas = (): void => {
    const context = canvas.getContext('2d');
    if (!context) return;
    const {width, height, pixelRatio} = frameSize();
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    context.clearRect(0, 0, width, height);
    try {
      binding.draw({
        context,
        canvas,
        width,
        height,
        pixelRatio,
        time: view?.performance?.now?.() ?? Date.now(),
      });
    } catch (error) {
      report(error);
    }
  };

  const effectiveRange = (): {start: number; end: number} | undefined => {
    if (optimisticRange) return optimisticRange;
    return state.start === undefined || state.end === undefined
      ? undefined
      : {start: state.start, end: state.end};
  };

  const paintBrush = (): void => {
    brush.setAttribute('aria-label', options.label ?? uiMessage(options.localization, 'minimap.label', 'Visible range'));
    const range = effectiveRange();
    const span = state.maximum - state.minimum;
    const hidden = !range || !(span > 0);
    brush.hidden = hidden;
    brush.setAttribute('aria-disabled', String(state.disabled || !binding.setRange));
    brush.tabIndex = hidden || state.disabled || !binding.setRange ? -1 : 0;
    brush.setAttribute('aria-valuemin', String(state.minimum));
    brush.setAttribute('aria-valuemax', String(state.maximum));
    if (hidden) {
      brush.removeAttribute('aria-valuenow');
      brush.removeAttribute('aria-valuetext');
      return;
    }
    const startFraction = (range.start - state.minimum) / span;
    const endFraction = (range.end - state.minimum) / span;
    brush.style.left = `${clamp(startFraction, 0, 1) * 100}%`;
    brush.style.width = `${Math.max(.5, clamp(endFraction - startFraction, 0, 1) * 100)}%`;
    brush.setAttribute('aria-valuenow', String(range.start));
    brush.setAttribute('aria-valuetext', uiMessage(options.localization, 'minimap.range', '{start} to {end}', {
      start: formatNumber(options.localization, range.start, range.start.toFixed(2)),
      end: formatNumber(options.localization, range.end, range.end.toFixed(2)),
    }));
  };

  const readSnapshot = (): void => {
    try {
      state = normalize(binding.snapshot());
    } catch (error) {
      report(error);
    }
  };

  const update = (): void => {
    if (destroyed) return;
    readSnapshot();
    paintCanvas();
    paintBrush();
  };

  const settleRange = (revision: number, error?: unknown): void => {
    if (destroyed || revision !== commandRevision) return;
    optimisticRange = undefined;
    if (error !== undefined) report(error);
    update();
  };

  const commitRange = (start: number, end: number): void => {
    if (state.disabled || !binding.setRange) return;
    const span = state.maximum - state.minimum;
    if (!(span > 0)) return;
    const width = clamp(Math.abs(end - start), 0, span);
    const nextStart = clamp(Math.min(start, end), state.minimum, state.maximum - width);
    const nextEnd = nextStart + width;
    const revision = ++commandRevision;
    optimisticRange = {start: nextStart, end: nextEnd, revision};
    paintBrush();
    try {
      void Promise.resolve(binding.setRange(nextStart, nextEnd)).then(
        () => settleRange(revision),
        (error) => settleRange(revision, error),
      );
    } catch (error) {
      settleRange(revision, error);
    }
  };

  const invokeSeek = (value: number): void => {
    if (state.disabled || !binding.seek) return;
    try {
      void Promise.resolve(binding.seek(value)).catch(report);
    } catch (error) {
      report(error);
    }
  };

  const valueAt = (clientX: number): number => {
    const bounds = viewport.getBoundingClientRect();
    const width = bounds.width || viewport.clientWidth || fallbackWidth;
    const fraction = clamp((clientX - bounds.left) / Math.max(1, width), 0, 1);
    return state.minimum + fraction * (state.maximum - state.minimum);
  };

  const onCanvasPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0 || state.disabled) return;
    event.preventDefault();
    const value = valueAt(event.clientX);
    const range = effectiveRange();
    if (range && binding.setRange) {
      const span = range.end - range.start;
      commitRange(value - span / 2, value + span / 2);
    }
    invokeSeek(value);
  };

  const onBrushPointerDown = (event: PointerEvent): void => {
    const range = effectiveRange();
    if (event.button !== 0 || state.disabled || !binding.setRange || !range) return;
    event.preventDefault();
    event.stopPropagation();
    const bounds = brush.getBoundingClientRect();
    const mode: DragState['mode'] =
      event.clientX - bounds.left <= edgeSize
        ? 'start'
        : bounds.right - event.clientX <= edgeSize
          ? 'end'
          : 'move';
    drag = {mode, pointerId: event.pointerId, grabValue: valueAt(event.clientX)};
    brush.style.cursor = 'grabbing';
    try {
      viewport.setPointerCapture?.(event.pointerId);
    } catch {
      // Synthetic pointer events need not support pointer capture.
    }
  };

  const onPointerMove = (event: PointerEvent): void => {
    const current = drag;
    const range = effectiveRange();
    if (!current || current.pointerId !== event.pointerId || !range) return;
    const value = valueAt(event.clientX);
    if (current.mode === 'move') {
      const delta = value - current.grabValue;
      drag = {...current, grabValue: value};
      commitRange(range.start + delta, range.end + delta);
    } else if (current.mode === 'start') {
      commitRange(value, range.end);
    } else {
      commitRange(range.start, value);
    }
  };

  const onPointerUp = (event: PointerEvent): void => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    drag = undefined;
    brush.style.cursor = '';
    try {
      viewport.releasePointerCapture?.(event.pointerId);
    } catch {
      // Synthetic pointer events need not support pointer capture.
    }
  };

  const onBrushKeyDown = (event: KeyboardEvent): void => {
    const range = effectiveRange();
    if (state.disabled || !binding.setRange || !range) return;
    const width = range.end - range.start;
    const step = width * (event.shiftKey ? 1 : keyboardStep);
    if (event.key === 'ArrowLeft') commitRange(range.start - step, range.end - step);
    else if (event.key === 'ArrowRight') commitRange(range.start + step, range.end + step);
    else if (event.key === 'Home') commitRange(state.minimum, state.minimum + width);
    else if (event.key === 'End') commitRange(state.maximum - width, state.maximum);
    else return;
    event.preventDefault();
  };

  canvas.addEventListener('pointerdown', onCanvasPointerDown);
  brush.addEventListener('pointerdown', onBrushPointerDown);
  brush.addEventListener('keydown', onBrushKeyDown);
  root.addEventListener('pointermove', onPointerMove);
  root.addEventListener('pointerup', onPointerUp);
  root.addEventListener('pointercancel', onPointerUp);

  const handle: MinimapHandle = {
    element: root,
    canvas,
    brush,
    update,
    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      releaseLocalization();
      commandRevision += 1;
      optimisticRange = undefined;
      try {
        unsubscribe?.();
      } catch (error) {
        report(error);
      }
      try {
        resizeObserver?.disconnect();
      } catch (error) {
        report(error);
      }
      resizeObserver = undefined;
      canvas.removeEventListener('pointerdown', onCanvasPointerDown);
      brush.removeEventListener('pointerdown', onBrushPointerDown);
      brush.removeEventListener('keydown', onBrushKeyDown);
      root.removeEventListener('pointermove', onPointerMove);
      root.removeEventListener('pointerup', onPointerUp);
      root.removeEventListener('pointercancel', onPointerUp);
      claim.release();
      root.remove();
      style?.remove();
    },
  };

  // Claim the host before destroying the previous mount: its cleanup may mount
  // a replacement, and that replacement must win.
  const claim = claimHost(mounted, host, handle);
  claim.destroyPrevious();
  if (!claim.isCurrent()) return handle;

  host.append(...(style ? [style] : []), root);
  if (!claim.isCurrent()) {
    // A re-entrant mount took the host while this one was appending; leave it
    // exactly as that mount left it.
    root.remove();
    style?.remove();
    return handle;
  }
  const ResizeObserverClass = view?.ResizeObserver;
  if (ResizeObserverClass) {
    try {
      resizeObserver = new ResizeObserverClass(update);
      resizeObserver.observe(viewport);
    } catch (error) {
      report(error);
    }
  }
  update();
  if (binding.subscribe) {
    try {
      unsubscribe = binding.subscribe(update);
    } catch (error) {
      report(error);
    }
  }
  releaseLocalization = bindLocalization(options.localization, update, () => !destroyed && claim.isCurrent(), options.onError);
  return handle;
}
