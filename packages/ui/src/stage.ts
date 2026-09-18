import {installStyle} from './internal/style';
import {claimHost, createErrorSink} from './internal/lifecycle';
import {finitePositive, addClassNames, setParts} from './internal/dom';
import {mountStatus, type StatusHandle, type StatusState} from './status';
import {bindLocalization, formatNumber, message, type UILocalization} from './localization';
import {componentSurfaceCss} from './internal/surface';

export interface StageBinding {
  render(surface: HTMLElement): void | (() => void);
  subscribe?(notify: () => void): () => void;
}

export interface StageOptions {
  label?: string;
  /** Fill a host with a definite height; the default stage remains content-sized. */
  fill?: boolean;
  /** Minimum readable width of the inner surface, as a CSS length. Defaults to 0. */
  surfaceMinWidth?: string;
  /** CSS background color of the viewport; omitted values preserve the stage theme. */
  background?: string;
  /**
   * How the stage crops content that exceeds it. Defaults to `hidden`, the same
   * value `--wm-stage-overflow` resolves to.
   *
   * This exists because scrolling is a mounting decision, not a theme: an
   * element that needs a scrollable stage was writing the kit's own custom
   * property onto itself to get one, which coupled it to a token name it does
   * not own.
   */
  overflow?: 'hidden' | 'auto' | 'visible' | 'clip' | 'scroll';
  classNames?: StageClassNames;
  parts?: StageParts;
  onError?: (error: unknown) => void;
  /** Install the exported stylesheet into the host. Defaults to true. */
  stylesheet?: boolean;
}

export interface StageClassNames {
  root?: string;
  surface?: string;
}

export interface StageParts {
  root?: string;
  surface?: string;
}

export interface StageHandle {
  element: HTMLElement;
  surface: HTMLElement;
  update(): void;
  destroy(): void;
}

/** Numeric state exposed by a domain-neutral slider drawn on an arbitrary surface. */
export interface SurfaceSliderState {
  minimum: number;
  maximum: number;
  value: number;
  disabled?: boolean;
}

/** Pointer geometry supplied to a surface slider's domain hit-test. */
export interface SurfaceSliderPoint {
  clientX: number;
  clientY: number;
  /** CSS-pixel position relative to the configured pointer surface. */
  x: number;
  /** CSS-pixel position relative to the configured pointer surface. */
  y: number;
  pointerId?: number;
  rect: DOMRectReadOnly;
  surface: HTMLElement;
}

export interface SurfaceSliderBinding {
  snapshot(): SurfaceSliderState;
  /** Convert presenter-owned pointer geometry into a domain value. */
  valueAt(point: SurfaceSliderPoint): number;
  /** Commit one pointer or keyboard value back to the domain owner. */
  commit(value: number): void;
  /**
   * Paint an in-flight drag without committing it. Supplied together with
   * `commitOn: 'release'`, this is what lets a seek bar follow the pointer and
   * issue exactly one seek when the pointer is released.
   */
  preview?(value: number): void;
  subscribe?(notify: () => void): () => void;
}

export interface SurfaceSliderOptions {
  localization?: UILocalization;
  label?: string;
  orientation?: 'horizontal' | 'vertical';
  /**
   * Pointer listeners and capture live here while role, focus and ARIA live on
   * the mounted element. Defaults to the mounted element.
   */
  pointerTarget?: HTMLElement;
  /**
   * Arrow-key step. The callback receives the keyboard event as well as the
   * state, so a modifier can select a coarser step — `Shift` for a long seek,
   * for instance.
   */
  keyboardStep?: number | ((state: Readonly<SurfaceSliderState>, event: KeyboardEvent) => number);
  /**
   * When a pointer drag reaches the domain. `move` (the default) commits every
   * position; `release` previews the drag and commits once, on pointerup.
   */
  commitOn?: 'move' | 'release';
  formatValue?: (value: number, state: Readonly<SurfaceSliderState>) => string | undefined;
  onError?: (error: unknown) => void;
}

export interface SurfaceSliderHandle {
  element: HTMLElement;
  surface: HTMLElement;
  update(): void;
  /** Update the accessible name without replacing the surface or moving focus. */
  updateLabel(label?: string): void;
  destroy(): void;
}

export interface CanvasStageFrame {
  context: CanvasRenderingContext2D;
  canvas: HTMLCanvasElement;
  /** Canvas width in CSS pixels. */
  width: number;
  /** Canvas height in CSS pixels. */
  height: number;
  pixelRatio: number;
  /** Frame time in milliseconds, using the owning window's clock when available. */
  time: number;
}

export interface CanvasStageBinding {
  draw(frame: CanvasStageFrame): void;
  status?(): StatusState;
  subscribe?(notify: () => void): () => void;
}

export interface CanvasStageOptions {
  localization?: UILocalization;
  label?: string;
  /** Continuously redraw with requestAnimationFrame. Defaults to false. */
  animate?: boolean;
  fallbackWidth?: number;
  fallbackHeight?: number;
  classNames?: CanvasStageClassNames;
  parts?: CanvasStageParts;
  onError?: (error: unknown) => void;
  /** Install the exported stylesheet into the host. Defaults to true. */
  stylesheet?: boolean;
}

export interface CanvasStageClassNames {
  root?: string;
  canvas?: string;
  status?: string;
}

export interface CanvasStageParts {
  root?: string;
  canvas?: string;
  status?: string;
}

export interface CanvasStageHandle {
  element: HTMLElement;
  canvas: HTMLCanvasElement;
  update(): void;
  redraw(): void;
  destroy(): void;
}

type StageHost = HTMLElement | ShadowRoot;

const mountedStages = new WeakMap<StageHost, StageHandle>();
const mountedCanvasStages = new WeakMap<StageHost, CanvasStageHandle>();
const mountedSurfaceSliders = new WeakMap<HTMLElement, SurfaceSliderHandle>();

export const stageStyle = String.raw`
.wui-stage {
${componentSurfaceCss('stage')}
  position: relative;
  display: block;
  width: 100%;
  min-width: 0;
  color: var(--wm-stage-foreground, var(--wm-foreground, #444));
}
.wui-stage__surface {
  box-sizing: border-box;
  position: relative;
  width: 100%;
  min-width: var(--wm-stage-surface-min-width, 0);
  background: var(--wm-stage-background, transparent);
  border: var(--wm-stage-border, 0);
  border-radius: var(--wm-stage-radius, var(--wm-control-radius, 0));
  overflow: var(--wm-stage-overflow, hidden);
}
/* Retained renderers expose the root as their scroll viewport. The drawing
   can be wider than it (for example a readable sheet on a narrow host). */
.wui-stage:not(.wui-stage--canvas) {
  overflow: var(--wm-stage-overflow, hidden);
  background: var(--wm-stage-background, var(--wm-stage-surface-background, var(--wm-component-background, var(--wm-surface, #fff))));
}
.wui-stage:not(.wui-stage--canvas) > .wui-stage__surface { overflow: visible; }
.wui-stage--fill { height: 100%; }
.wui-stage--fill > .wui-stage__surface { height: 100%; }
.wui-stage--canvas { height: 100%; }
.wui-stage--canvas > .wui-stage__surface { height: 100%; }
.wui-stage__canvas { display: block; width: 100%; height: 100%; }
.wui-stage__status { position: absolute; inset: 0; display: flex; }
.wui-stage__status[hidden] { display: none; }
.wui-stage__status > .wui-status-host { width: 100%; display: flex; }
`;

/** Mount a generic retained stage whose caller renders into a supplied surface. */
export function mountStage(
  host: StageHost,
  binding: StageBinding,
  options: StageOptions = {},
): StageHandle {
  const document = host.ownerDocument;
  const style = installStyle(document, 'stage', stageStyle, options.stylesheet);
  const root = document.createElement('div');
  root.className = 'wui-stage';
  if (options.fill === true) root.classList.add('wui-stage--fill');
  if (options.overflow) root.style.setProperty('--wm-stage-overflow', options.overflow);
  if (options.surfaceMinWidth) root.style.setProperty('--wm-stage-surface-min-width', options.surfaceMinWidth);
  if (options.background) root.style.setProperty('--wm-stage-background', options.background);
  addClassNames(root, options.classNames?.root);
  setParts(root, 'root', options.parts?.root);
  if (options.label) {
    root.setAttribute('role', 'region');
    root.setAttribute('aria-label', options.label);
  }
  const surface = document.createElement('div');
  surface.className = 'wui-stage__surface';
  addClassNames(surface, options.classNames?.surface);
  setParts(surface, 'surface', options.parts?.surface);
  root.append(surface);

  let destroyed = false;
  let unsubscribe: (() => void) | undefined;
  let renderCleanup: (() => void) | undefined;

  const report = createErrorSink(options.onError);

  const releaseRender = (): void => {
    const cleanup = renderCleanup;
    renderCleanup = undefined;
    if (!cleanup) return;
    try {
      cleanup();
    } catch (error) {
      report(error);
    }
  };

  const update = (): void => {
    if (destroyed || !claim.isCurrent()) return;
    releaseRender();
    if (destroyed || !claim.isCurrent()) return;
    surface.replaceChildren();
    try {
      const cleanup = binding.render(surface);
      if (typeof cleanup === 'function') {
        // Rendering can mount a same-host replacement. Its teardown already
        // ran, so release the outgoing render's late cleanup immediately.
        if (destroyed || !claim.isCurrent()) cleanup();
        else renderCleanup = cleanup;
      }
    } catch (error) {
      report(error);
    }
  };

  const handle: StageHandle = {
    element: root,
    surface,
    update,
    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      releaseRender();
      try {
        unsubscribe?.();
      } catch (error) {
        report(error);
      }
      claim.release();
      root.remove();
      style?.remove();
    },
  };
  // Claim the host before destroying whoever had it: a previous stage's
  // cleanup may mount a replacement, and that replacement must win. The other
  // stage kind shares this host, so it is torn down here too.
  const claim = claimHost(mountedStages, host, handle);
  mountedCanvasStages.get(host)?.destroy();
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
  update();
  if (destroyed || !claim.isCurrent()) return handle;
  if (binding.subscribe) {
    try {
      const cleanup = binding.subscribe(update);
      // A synchronous notification can replace this stage before subscribe
      // returns its disposer, just as rendering can return a late cleanup.
      if (destroyed || !claim.isCurrent()) cleanup();
      else unsubscribe = cleanup;
    } catch (error) {
      report(error);
    }
  }
  return handle;
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function normalizeSurfaceSliderState(state: SurfaceSliderState): SurfaceSliderState {
  const minimum = finiteNumber(state.minimum, 0);
  const maximum = Math.max(minimum, finiteNumber(state.maximum, minimum));
  const value = Math.max(minimum, Math.min(maximum, finiteNumber(state.value, minimum)));
  return {minimum, maximum, value, disabled: state.disabled === true};
}

/**
 * Add slider semantics and reusable pointer/keyboard lifecycle to an existing
 * render surface. The presenter creates no domain pixels: `valueAt` remains the
 * caller's hit-test and `commit` remains its only write port.
 */
export function mountSurfaceSlider(
  element: HTMLElement,
  binding: SurfaceSliderBinding,
  options: SurfaceSliderOptions = {},
): SurfaceSliderHandle {

  const surface = options.pointerTarget ?? element;
  const orientation = options.orientation === 'vertical' ? 'vertical' : 'horizontal';
  let destroyed = false;
  let unsubscribe: (() => void) | undefined;
  let unlocalize: (() => void) | undefined;
  let activePointer: number | 'fallback' | undefined;
  let state: SurfaceSliderState = {minimum: 0, maximum: 0, value: 0, disabled: true};

  const report = createErrorSink(options.onError);

  const originals = new Map<string, string | null>();
  const assigned = new Map<string, string>();
  const assign = (name: string, value: string): void => {
    if (!originals.has(name)) originals.set(name, element.getAttribute(name));
    element.setAttribute(name, value);
    assigned.set(name, value);
  };
  const releaseAssigned = (name: string): void => {
    const last = assigned.get(name);
    if (last === undefined || element.getAttribute(name) !== last) return;
    const original = originals.get(name);
    if (original === null || original === undefined) element.removeAttribute(name);
    else element.setAttribute(name, original);
    assigned.delete(name);
  };

  /**
   * A slider's value is arithmetic — a step added to a fraction — so it arrives
   * carrying float noise like `64.99999999999999`. That noise is read aloud, so
   * it is trimmed before it reaches the attribute; an exact value is unchanged.
   */
  const ariaNumber = (value: number): string => String(Number(value.toFixed(6)));

  const applyState = (): void => {
    assign('aria-valuemin', ariaNumber(state.minimum));
    assign('aria-valuemax', ariaNumber(state.maximum));
    assign('aria-valuenow', ariaNumber(state.value));
    assign('aria-disabled', String(state.disabled === true));
    // A disabled slider leaves the tab order and rejoins it when re-enabled,
    // rather than being stamped tabbable once at mount — but only when the
    // presenter owns the attribute. An author-supplied tabindex is their focus
    // policy and stays untouched, as stage.test.ts pins.
    if (ownsTabIndex) assign('tabindex', state.disabled === true ? '-1' : '0');
    if (!options.formatValue && !options.localization) return;
    try {
      const text = options.formatValue ? options.formatValue(state.value, state) : formatNumber(options.localization, state.value);
      if (destroyed || !claim.isCurrent()) return;
      if (text === undefined) releaseAssigned('aria-valuetext');
      else assign('aria-valuetext', text);
    } catch (error) {
      report(error);
    }
  };

  const update = (): void => {
    if (destroyed) return;
    try {
      state = normalizeSurfaceSliderState(binding.snapshot());
      if (destroyed || !claim.isCurrent()) return;
      applyState();
    } catch (error) {
      if (destroyed || !claim.isCurrent()) return;
      state = {minimum: 0, maximum: 0, value: 0, disabled: true};
      applyState();
      report(error);
    }
  };

  const commit = (value: number): void => {
    if (destroyed || state.disabled) return;
    const next = Math.max(state.minimum, Math.min(state.maximum, finiteNumber(value, state.value)));
    try {
      binding.commit(next);
      // Keep the slider responsive even when its domain source publishes on a
      // later transport tick. The next update remains authoritative.
      state = {...state, value: next};
      applyState();
    } catch (error) {
      report(error);
    }
  };

  const pointFor = (event: PointerEvent): SurfaceSliderPoint => {
    const rect = surface.getBoundingClientRect();
    const pointerId = Number.isFinite(event.pointerId) ? event.pointerId : undefined;
    return {
      clientX: event.clientX,
      clientY: event.clientY,
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
      ...(pointerId === undefined ? {} : {pointerId}),
      rect,
      surface,
    };
  };

  const commitOnRelease = options.commitOn === 'release';
  let dragValue: number | undefined;

  const commitPointer = (event: PointerEvent, final = false): void => {
    try {
      const value = binding.valueAt(pointFor(event));
      if (commitOnRelease && !final) {
        // A scrub paints as it moves and reaches the domain once, on release.
        dragValue = value;
        binding.preview?.(value);
        return;
      }
      commit(value);
    } catch (error) {
      report(error);
    }
  };

  const pointerKey = (event: PointerEvent): number | 'fallback' =>
    Number.isFinite(event.pointerId) ? event.pointerId : 'fallback';
  const matchesPointer = (event: PointerEvent): boolean =>
    activePointer !== undefined && activePointer === pointerKey(event);
  const releasePointer = (event: PointerEvent, commitDrag = false): void => {
    if (!matchesPointer(event)) return;
    const pointerId = activePointer;
    activePointer = undefined;
    if (commitOnRelease) {
      const pending = dragValue;
      dragValue = undefined;
      if (commitDrag) {
        try {
          commit(pending ?? binding.valueAt(pointFor(event)));
        } catch (error) {
          report(error);
        }
      } else {
        // Cancelled: drop the preview and repaint from the owner's state.
        update();
      }
    }
    if (typeof pointerId !== 'number') return;
    try {
      surface.releasePointerCapture?.(pointerId);
    } catch (error) {
      report(error);
    }
  };

  const onPointerDown = (event: PointerEvent): void => {
    if (state.disabled || (event.button !== undefined && event.button !== 0)) return;
    activePointer = pointerKey(event);
    if (typeof activePointer === 'number') {
      try {
        surface.setPointerCapture?.(activePointer);
      } catch (error) {
        report(error);
      }
    }
    try {
      element.focus({preventScroll: true});
    } catch {
      element.focus();
    }
    commitPointer(event);
    event.preventDefault();
  };
  const onPointerMove = (event: PointerEvent): void => {
    if (!matchesPointer(event)) return;
    commitPointer(event);
    event.preventDefault();
  };
  const onPointerUp = (event: PointerEvent): void => releasePointer(event, true);
  const onPointerCancel = (event: PointerEvent): void => releasePointer(event);

  const keyboardStep = (event: KeyboardEvent): number => {
    const configured =
      typeof options.keyboardStep === 'function'
        ? options.keyboardStep(state, event)
        : options.keyboardStep;
    const span = state.maximum - state.minimum;
    return Math.max(0, finiteNumber(configured, span > 0 ? span / 100 : 1));
  };
  const onKeyDown = (event: KeyboardEvent): void => {
    if (state.disabled) return;
    let next: number | undefined;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
      next = state.value - keyboardStep(event);
    } else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
      next = state.value + keyboardStep(event);
    } else if (event.key === 'Home') next = state.minimum;
    else if (event.key === 'End') next = state.maximum;
    if (next === undefined) return;
    event.preventDefault();
    commit(next);
  };

  let originalTouchAction = '';
  let ownsTabIndex = false;
  let ownsLabel = false;
  let labelOverride: string | undefined;
  const updateLabel = (label?: string): void => {
    if (destroyed) return;
    labelOverride = label;
    ownsLabel = true;
    const text = label ?? options.label ?? message(options.localization, 'stage.value', 'Value');
    if (destroyed || !claim.isCurrent()) return;
    assign('aria-label', text);
  };

  const handle: SurfaceSliderHandle = {
    element,
    surface,
    update,
    updateLabel,
    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      const releaseText = unlocalize;
      unlocalize = undefined;
      releaseText?.();
      surface.removeEventListener('pointerdown', onPointerDown);
      surface.removeEventListener('pointermove', onPointerMove);
      surface.removeEventListener('pointerup', onPointerUp);
      surface.removeEventListener('pointercancel', onPointerCancel);
      element.removeEventListener('keydown', onKeyDown);
      if (typeof activePointer === 'number') {
        try {
          surface.releasePointerCapture?.(activePointer);
        } catch (error) {
          report(error);
        }
      }
      activePointer = undefined;
      try {
        unsubscribe?.();
      } catch (error) {
        report(error);
      }
      if (surface.style.touchAction === 'none') surface.style.touchAction = originalTouchAction;
      for (const name of [...assigned.keys()]) releaseAssigned(name);
      claim.release();
    },
  };

  const claim = claimHost(mountedSurfaceSliders, element, handle);
  claim.destroyPrevious();
  if (!claim.isCurrent()) return handle;

  // Borrow the caller's element only after the previous slider has given it
  // back: it restores the role, tabindex, aria-* and touch-action it took, and
  // doing that after this mount had written its own would strip them.
  if (!element.hasAttribute('role')) assign('role', 'slider');
  if (!element.hasAttribute('tabindex')) {
    assign('tabindex', '0');
    ownsTabIndex = true;
  }
  if (!element.hasAttribute('aria-label') && !element.hasAttribute('aria-labelledby')) {
    updateLabel();
  }
  if (destroyed || !claim.isCurrent()) return handle;
  assign('aria-orientation', orientation);
  originalTouchAction = surface.style.touchAction;
  surface.style.touchAction = 'none';
  surface.addEventListener('pointerdown', onPointerDown);
  surface.addEventListener('pointermove', onPointerMove);
  surface.addEventListener('pointerup', onPointerUp);
  surface.addEventListener('pointercancel', onPointerCancel);
  element.addEventListener('keydown', onKeyDown);

  update();
  if (destroyed || !claim.isCurrent()) return handle;
  if (binding.subscribe) {
    try {
      const cleanup = binding.subscribe(update);
      if (destroyed || !claim.isCurrent()) cleanup();
      else unsubscribe = cleanup;
    } catch (error) {
      report(error);
    }
  }
  unlocalize = bindLocalization(options.localization, () => {
    if (ownsLabel) updateLabel(labelOverride);
    update();
  }, () => !destroyed && claim.isCurrent(), options.onError);
  return handle;
}


/**
 * Mount a domain-neutral canvas stage. The presenter owns canvas sizing,
 * device-pixel-ratio transforms, animation scheduling and teardown; callers
 * only draw a frame and optionally publish a passive status overlay.
 */
export function mountCanvasStage(
  host: StageHost,
  binding: CanvasStageBinding,
  options: CanvasStageOptions = {},
): CanvasStageHandle {

  const document = host.ownerDocument;
  const style = installStyle(document, 'stage', stageStyle, options.stylesheet);
  const root = document.createElement('div');
  root.className = 'wui-stage wui-stage--canvas';
  addClassNames(root, options.classNames?.root);
  setParts(root, 'root', options.parts?.root);
  if (options.label) {
    root.setAttribute('role', 'img');
    root.setAttribute('aria-label', options.label);
  }

  const surface = document.createElement('div');
  surface.className = 'wui-stage__surface wui-stage__canvas-surface';

  const canvas = document.createElement('canvas');
  canvas.className = 'wui-stage__canvas';
  addClassNames(canvas, options.classNames?.canvas);
  setParts(canvas, 'canvas surface', options.parts?.canvas);
  canvas.setAttribute('aria-hidden', 'true');
  surface.append(canvas);
  root.append(surface);

  let currentStatus: StatusState = {kind: 'ready'};
  let statusHandle: StatusHandle | undefined;
  let statusLayer: HTMLDivElement | undefined;
  if (binding.status) {
    statusLayer = document.createElement('div');
    statusLayer.className = 'wui-stage__status';
    addClassNames(statusLayer, options.classNames?.status);
    setParts(statusLayer, 'status', options.parts?.status);
    const statusHost = document.createElement('div');
    statusHost.className = 'wui-status-host';
    statusLayer.append(statusHost);
    surface.append(statusLayer);
    statusHandle = mountStatus(
      statusHost,
      {snapshot: () => currentStatus},
      {
        classNames: {root: 'wui-status--embedded'},
        onError: options.onError,
        stylesheet: options.stylesheet,
        localization: options.localization,
      },
    );
  }


  const view = document.defaultView;
  const fallbackWidth = finitePositive(options.fallbackWidth, 300);
  const fallbackHeight = finitePositive(options.fallbackHeight, 150);
  let destroyed = false;
  let unsubscribe: (() => void) | undefined;
  let frameId: number | undefined;
  let resizeObserver: ResizeObserver | undefined;

  const report = createErrorSink(options.onError);

  const readStatus = (): void => {
    if (!binding.status) return;
    try {
      currentStatus = binding.status();
    } catch (error) {
      currentStatus = {kind: 'error', message: error instanceof Error ? error.message : String(error)};
      report(error);
    }
    statusLayer!.hidden = currentStatus.kind === 'ready';
    statusHandle?.update();
  };

  const frameSize = (): {width: number; height: number; pixelRatio: number} => {
    const width = finitePositive(canvas.clientWidth || surface.clientWidth || root.clientWidth, fallbackWidth);
    const height = finitePositive(canvas.clientHeight || surface.clientHeight || root.clientHeight, fallbackHeight);
    const pixelRatio = finitePositive(view?.devicePixelRatio, 1);
    const pixelWidth = Math.max(1, Math.round(width * pixelRatio));
    const pixelHeight = Math.max(1, Math.round(height * pixelRatio));
    if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
    if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
    return {width, height, pixelRatio};
  };

  const redrawAt = (time: number): void => {
    if (destroyed) return;
    readStatus();
    const context = canvas.getContext('2d');
    if (!context) return;
    const {width, height, pixelRatio} = frameSize();
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    context.clearRect(0, 0, width, height);
    try {
      binding.draw({context, canvas, width, height, pixelRatio, time});
    } catch (error) {
      report(error);
    }
  };

  const now = (): number => view?.performance?.now?.() ?? Date.now();
  const redraw = (): void => redrawAt(now());

  const animate = (): void => {
    if (destroyed || options.animate !== true || !view?.requestAnimationFrame) return;
    frameId = view.requestAnimationFrame((time) => {
      frameId = undefined;
      redrawAt(time);
      animate();
    });
  };

  const update = (): void => {
    redraw();
    if (options.animate === true && frameId === undefined) animate();
  };

  const handle: CanvasStageHandle = {
    element: root,
    canvas,
    update,
    redraw,
    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      if (frameId !== undefined) view?.cancelAnimationFrame?.(frameId);
      frameId = undefined;
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
      statusHandle?.destroy();
      statusHandle = undefined;
      claim.release();
      root.remove();
      style?.remove();
    },
  };

  const claim = claimHost(mountedCanvasStages, host, handle);
  mountedStages.get(host)?.destroy();
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
      resizeObserver.observe(root);
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
  return handle;
}
