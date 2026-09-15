// @vitest-environment jsdom

import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {
  mountCanvasStage,
  mountStage,
  mountSurfaceSlider,
  stageStyle,
  type CanvasStageFrame,
  type StatusState,
} from '../src';

const context = {
  setTransform: vi.fn(),
  clearRect: vi.fn(),
} as unknown as CanvasRenderingContext2D;

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context);
});

afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('mountCanvasStage', () => {
  it('owns a DPR-sized canvas and supplies a complete drawing frame', () => {
    const host = document.createElement('div');
    const draw = vi.fn<(frame: CanvasStageFrame) => void>();
    const handle = mountCanvasStage(host, {draw}, {
      label: 'Waveform',
      fallbackWidth: 240,
      fallbackHeight: 72,
    });

    expect(handle.element.getAttribute('role')).toBe('img');
    expect(handle.element.getAttribute('aria-label')).toBe('Waveform');
    expect(handle.canvas).toBe(host.querySelector('canvas'));
    expect(handle.canvas.width).toBe(240);
    expect(handle.canvas.height).toBe(72);
    expect(draw).toHaveBeenCalledOnce();
    expect(draw.mock.calls[0]![0]).toMatchObject({
      context,
      canvas: handle.canvas,
      width: 240,
      height: 72,
      pixelRatio: 1,
    });
    expect(context.setTransform).toHaveBeenCalledWith(1, 0, 0, 1, 0, 0);
    expect(context.clearRect).toHaveBeenCalledWith(0, 0, 240, 72);

    handle.redraw();
    expect(draw).toHaveBeenCalledTimes(2);
    handle.destroy();
    expect(host.childElementCount).toBe(0);
  });

  it('publishes binding status as an overlay and follows subscriptions', () => {
    const host = document.createElement('div');
    let state: StatusState = {kind: 'loading', message: 'Reading score'};
    let notify: (() => void) | undefined;
    const cleanup = vi.fn();
    const handle = mountCanvasStage(host, {
      draw: vi.fn(),
      status: () => state,
      subscribe: (next) => {
        notify = next;
        return cleanup;
      },
    });

    const layer = host.querySelector<HTMLElement>('.wui-stage__status')!;
    expect(layer.hidden).toBe(false);
    const status = layer.querySelector<HTMLElement>('[role="status"]')!;
    expect(status.textContent).toBe('Reading score');
    expect(status.classList.contains('wui-status--embedded')).toBe(true);

    state = {kind: 'empty', message: 'No notes'};
    notify?.();
    expect(layer.querySelector('[role="status"]')?.textContent).toBe('No notes');

    state = {kind: 'ready'};
    notify?.();
    expect(layer.hidden).toBe(true);

    handle.destroy();
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it('owns requestAnimationFrame and cancels it on destroy', () => {
    const callbacks: FrameRequestCallback[] = [];
    const request = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      callbacks.push(callback);
      return callbacks.length;
    });
    const cancel = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
    const draw = vi.fn();
    const handle = mountCanvasStage(document.createElement('div'), {draw}, {animate: true});

    expect(request).toHaveBeenCalledOnce();
    callbacks[0]?.(17);
    expect(draw).toHaveBeenLastCalledWith(expect.objectContaining({time: 17}));
    expect(request).toHaveBeenCalledTimes(2);

    handle.destroy();
    expect(cancel).toHaveBeenCalledWith(2);
  });

  it('redraws static canvases on owner-window resize and disconnects the observer', () => {
    let resize!: ResizeObserverCallback;
    const observe = vi.fn();
    const disconnect = vi.fn();
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: ResizeObserverCallback) {
        resize = callback;
      }
      observe = observe;
      disconnect = disconnect;
    });
    const draw = vi.fn();
    const handle = mountCanvasStage(
      document.createElement('div'),
      {draw},
      {
        fallbackWidth: 200,
        fallbackHeight: 40,
        classNames: {root: 'canvas-shell', canvas: 'canvas-node'},
        parts: {root: 'visual', canvas: 'drawing'},
      },
    );
    expect(observe).toHaveBeenCalledWith(handle.element);
    expect(handle.element.classList.contains('canvas-shell')).toBe(true);
    expect(handle.canvas.classList.contains('canvas-node')).toBe(true);
    expect(handle.element.getAttribute('part')).toContain('visual');
    expect(handle.canvas.getAttribute('part')).toContain('drawing');

    Object.defineProperty(handle.element, 'clientWidth', {configurable: true, value: 360});
    resize([], {} as ResizeObserver);
    expect(draw).toHaveBeenCalledTimes(2);
    expect(handle.canvas.width).toBe(360);

    handle.destroy();
    expect(disconnect).toHaveBeenCalledOnce();
  });

  it('is mutually exclusive with a generic stage and cleans render resources', () => {
    const host = document.createElement('div');
    const cleanup = vi.fn();
    const unsubscribe = vi.fn();
    mountStage(host, {
      render: (surface) => {
        surface.append(document.createElement('svg'));
        return cleanup;
      },
      subscribe: () => unsubscribe,
    });

    const canvas = mountCanvasStage(host, {draw: vi.fn()});
    expect(cleanup).toHaveBeenCalledOnce();
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(host.querySelector('.wui-stage__canvas-surface')).not.toBeNull();
    expect(canvas.canvas.parentElement).toBe(host.querySelector('.wui-stage__canvas-surface'));
    expect(host.querySelectorAll('.wui-stage')).toHaveLength(1);

    const generic = mountStage(host, {render: vi.fn()});
    expect(canvas.canvas.isConnected).toBe(false);
    expect(host.querySelector('canvas')).toBeNull();
    expect(host.querySelectorAll('.wui-stage')).toHaveLength(1);
    generic.destroy();
  });

  it('fills a definite-height host only when explicitly requested', () => {
    const defaultHost = document.createElement('div');
    const defaultStage = mountStage(defaultHost, {render: vi.fn()});
    expect(defaultStage.element.classList.contains('wui-stage--fill')).toBe(false);

    const fillHost = document.createElement('div');
    const fillStage = mountStage(fillHost, {render: vi.fn()}, {fill: true});
    expect(fillStage.element.classList.contains('wui-stage--fill')).toBe(true);
    expect(stageStyle).toContain('.wui-stage--fill { height: 100%; }');
    expect(stageStyle).toContain('.wui-stage--fill > .wui-stage__surface { height: 100%; }');
  });

  it('routes draw failures and exports canvas styles', () => {
    const failure = new Error('draw failed');
    const onError = vi.fn();
    mountCanvasStage(
      document.createElement('div'),
      {draw: () => {
        throw failure;
      }},
      {onError},
    );
    expect(onError).toHaveBeenCalledWith(failure);
    expect(stageStyle).toContain('.wui-stage__canvas');
    expect(stageStyle).toContain('.wui-stage__status');
    expect(stageStyle).toContain('.wui-stage--canvas { height: 100%; }');
    expect(stageStyle).not.toContain('.wui-stage { height: 100%; }');
  });
});

describe('mountSurfaceSlider', () => {
  it('owns slider ARIA, pointer capture, keyboard commits and cleanup', () => {
    const element = document.createElement('div');
    const surface = document.createElement('div');
    element.append(surface);
    document.body.append(element);
    vi.spyOn(surface, 'getBoundingClientRect').mockReturnValue({
      left: 10,
      top: 20,
      right: 110,
      bottom: 60,
      width: 100,
      height: 40,
      x: 10,
      y: 20,
      toJSON: () => ({}),
    } as DOMRect);
    const capture = vi.fn();
    const release = vi.fn();
    Object.defineProperty(surface, 'setPointerCapture', {configurable: true, value: capture});
    Object.defineProperty(surface, 'releasePointerCapture', {configurable: true, value: release});

    let state = {minimum: 0, maximum: 10, value: 2, disabled: false};
    let notify: (() => void) | undefined;
    const cleanup = vi.fn();
    const commits: number[] = [];
    const handle = mountSurfaceSlider(
      element,
      {
        snapshot: () => state,
        valueAt: (point) => point.x,
        commit: (value) => {
          commits.push(value);
          state = {...state, value};
        },
        subscribe: (next) => {
          notify = next;
          return cleanup;
        },
      },
      {
        label: 'Audio position',
        pointerTarget: surface,
        keyboardStep: 2,
        formatValue: (value) => `${value} seconds`,
      },
    );

    expect(handle.element).toBe(element);
    expect(handle.surface).toBe(surface);
    expect(element.getAttribute('role')).toBe('slider');
    expect(element.getAttribute('tabindex')).toBe('0');
    expect(element.getAttribute('aria-label')).toBe('Audio position');
    expect(element.getAttribute('aria-valuemin')).toBe('0');
    expect(element.getAttribute('aria-valuemax')).toBe('10');
    expect(element.getAttribute('aria-valuenow')).toBe('2');
    expect(element.getAttribute('aria-valuetext')).toBe('2 seconds');
    expect(surface.style.touchAction).toBe('none');

    surface.dispatchEvent(pointerEvent('pointerdown', 15, 30, 7));
    surface.dispatchEvent(pointerEvent('pointermove', 18, 32, 7));
    surface.dispatchEvent(pointerEvent('pointerup', 18, 32, 7));
    expect(commits).toEqual([5, 8]);
    expect(capture).toHaveBeenCalledWith(7);
    expect(release).toHaveBeenCalledWith(7);
    expect(element.getAttribute('aria-valuenow')).toBe('8');

    element.dispatchEvent(new KeyboardEvent('keydown', {key: 'ArrowRight', bubbles: true}));
    element.dispatchEvent(new KeyboardEvent('keydown', {key: 'Home', bubbles: true}));
    element.dispatchEvent(new KeyboardEvent('keydown', {key: 'End', bubbles: true}));
    expect(commits.slice(-3)).toEqual([10, 0, 10]);

    state = {...state, disabled: true};
    notify?.();
    expect(element.getAttribute('aria-disabled')).toBe('true');
    surface.dispatchEvent(pointerEvent('pointerdown', 12, 30, 8));
    element.dispatchEvent(new KeyboardEvent('keydown', {key: 'ArrowLeft', bubbles: true}));
    expect(commits).toHaveLength(5);

    handle.destroy();
    expect(cleanup).toHaveBeenCalledOnce();
    expect(element.hasAttribute('role')).toBe(false);
    expect(element.hasAttribute('tabindex')).toBe(false);
    expect(element.hasAttribute('aria-valuenow')).toBe(false);
    expect(surface.style.touchAction ?? '').toBe('');
    surface.dispatchEvent(pointerEvent('pointerdown', 14, 30, 9));
    expect(commits).toHaveLength(5);
  });

  it('preserves author-owned role, name and focus policy', () => {
    const element = document.createElement('div');
    element.setAttribute('role', 'scrollbar');
    element.setAttribute('aria-label', 'Author label');
    element.setAttribute('tabindex', '-1');
    const handle = mountSurfaceSlider(
      element,
      {snapshot: () => ({minimum: 0, maximum: 1, value: 0}), valueAt: () => 0, commit: vi.fn()},
      {label: 'Presenter label'},
    );

    expect(element.getAttribute('role')).toBe('scrollbar');
    expect(element.getAttribute('aria-label')).toBe('Author label');
    expect(element.getAttribute('tabindex')).toBe('-1');
    handle.destroy();
    expect(element.getAttribute('role')).toBe('scrollbar');
    expect(element.getAttribute('aria-label')).toBe('Author label');
    expect(element.getAttribute('tabindex')).toBe('-1');
  });
});

function pointerEvent(
  type: string,
  clientX: number,
  clientY: number,
  pointerId: number,
): PointerEvent {
  const event = new MouseEvent(type, {bubbles: true, cancelable: true, clientX, clientY});
  Object.defineProperty(event, 'pointerId', {configurable: true, value: pointerId});
  return event as PointerEvent;
}

describe('mountSurfaceSlider drag and focus policy', () => {
  it('previews a drag and commits once, on release', () => {
    const element = document.createElement('div');
    element.getBoundingClientRect = () =>
      ({x: 0, y: 0, top: 0, left: 0, right: 100, bottom: 10, width: 100, height: 10, toJSON: () => ({})}) as DOMRect;
    const commit = vi.fn();
    const preview = vi.fn();
    const handle = mountSurfaceSlider(
      element,
      {snapshot: () => ({minimum: 0, maximum: 100, value: 0}), valueAt: (point) => point.x, commit, preview},
      {commitOn: 'release'},
    );

    element.dispatchEvent(pointerEvent('pointerdown', 20, 5, 1));
    element.dispatchEvent(pointerEvent('pointermove', 60, 5, 1));
    // A scrub paints as it goes; the domain has seen nothing yet.
    expect(preview.mock.calls.map(([value]) => value)).toEqual([20, 60]);
    expect(commit).not.toHaveBeenCalled();

    element.dispatchEvent(pointerEvent('pointerup', 60, 5, 1));
    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledWith(60);

    handle.destroy();
  });

  it('drops a cancelled drag without committing it', () => {
    const element = document.createElement('div');
    element.getBoundingClientRect = () =>
      ({x: 0, y: 0, top: 0, left: 0, right: 100, bottom: 10, width: 100, height: 10, toJSON: () => ({})}) as DOMRect;
    const commit = vi.fn();
    const handle = mountSurfaceSlider(
      element,
      {snapshot: () => ({minimum: 0, maximum: 100, value: 0}), valueAt: (point) => point.x, commit},
      {commitOn: 'release'},
    );

    element.dispatchEvent(pointerEvent('pointerdown', 30, 5, 2));
    element.dispatchEvent(pointerEvent('pointercancel', 30, 5, 2));
    expect(commit).not.toHaveBeenCalled();

    handle.destroy();
  });

  it('gives the keyboard step the event, and manages tabindex only when it owns it', () => {
    const element = document.createElement('div');
    const commit = vi.fn();
    let disabled = false;
    const handle = mountSurfaceSlider(
      element,
      {snapshot: () => ({minimum: 0, maximum: 100, value: 50, disabled}), valueAt: () => 0, commit},
      {keyboardStep: (_state, event) => (event.shiftKey ? 10 : 5)},
    );

    element.dispatchEvent(new KeyboardEvent('keydown', {key: 'ArrowRight', bubbles: true}));
    expect(commit).toHaveBeenLastCalledWith(55);
    // The slider keeps its own value responsive after a commit (stage.ts:367),
    // so the coarse step lands on 55 + 10.
    element.dispatchEvent(new KeyboardEvent('keydown', {key: 'ArrowRight', bubbles: true, shiftKey: true}));
    expect(commit).toHaveBeenLastCalledWith(65);
    // Stepped arithmetic carries float noise; a screen reader must not read it.
    expect(element.getAttribute('aria-valuenow')).toBe('65');

    // Presenter-assigned tabindex follows the disabled state.
    expect(element.getAttribute('tabindex')).toBe('0');
    disabled = true;
    handle.update();
    expect(element.getAttribute('tabindex')).toBe('-1');
    disabled = false;
    handle.update();
    expect(element.getAttribute('tabindex')).toBe('0');

    handle.destroy();
  });
});

describe('mountStage re-entrant ownership', () => {
  it('releases a render cleanup returned after a same-host replacement and never subscribes the outgoing stage', () => {
    const host = document.createElement('div');
    const renderCleanup = vi.fn();
    const subscribe = vi.fn(() => vi.fn());
    let replacement: ReturnType<typeof mountStage> | undefined;
    const outgoing = mountStage(host, {
      render: () => {
        replacement = mountStage(host, {render: (surface) => {surface.textContent = 'Replacement';}});
        return renderCleanup;
      },
      subscribe,
    });

    expect(renderCleanup).toHaveBeenCalledOnce();
    expect(subscribe).not.toHaveBeenCalled();
    expect(host.querySelectorAll('.wui-stage')).toHaveLength(1);
    expect(host.querySelector('.wui-stage')).toBe(replacement?.element);
    outgoing.update();
    outgoing.destroy();
    expect(renderCleanup).toHaveBeenCalledOnce();
    replacement?.destroy();
  });

  it('stops repainting when the prior render cleanup mounts a replacement', () => {
    const host = document.createElement('div');
    const unsubscribe = vi.fn();
    let replacement: ReturnType<typeof mountStage> | undefined;
    const render = vi.fn(() => () => {
      replacement = mountStage(host, {render: (surface) => {surface.textContent = 'Replacement';}});
    });
    const outgoing = mountStage(host, {render, subscribe: () => unsubscribe});

    outgoing.update();
    expect(render).toHaveBeenCalledOnce();
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(host.querySelector('.wui-stage')).toBe(replacement?.element);
    outgoing.destroy();
    expect(unsubscribe).toHaveBeenCalledOnce();
    replacement?.destroy();
  });

  it('releases a subscription returned after its synchronous notification replaces the stage', () => {
    const host = document.createElement('div');
    const unsubscribe = vi.fn();
    const renderCleanup = vi.fn();
    let replacement: ReturnType<typeof mountStage> | undefined;
    let renders = 0;
    const outgoing = mountStage(host, {
      render: () => {
        if (++renders === 2) replacement = mountStage(host, {render: vi.fn()});
        return renderCleanup;
      },
      subscribe: (notify) => {
        notify();
        return unsubscribe;
      },
    });

    expect(renders).toBe(2);
    expect(renderCleanup).toHaveBeenCalledTimes(2);
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(host.querySelector('.wui-stage')).toBe(replacement?.element);
    outgoing.destroy();
    expect(unsubscribe).toHaveBeenCalledOnce();
    replacement?.destroy();
  });
});

describe('mountStage overflow', () => {
  it('keeps the configured background on the viewport behind long scrolling content', () => {
    const host = document.createElement('div');
    const stage = mountStage(host, {render(surface) {
      const content = document.createElement('div');
      content.style.height = '1200px';
      surface.append(content);
    }}, {fill: true, overflow: 'auto', background: 'var(--paper, #fff)'});
    expect(stage.element.style.getPropertyValue('--wm-stage-background')).toBe('var(--paper, #fff)');
    expect(stage.surface.style.getPropertyValue('--wm-stage-background')).toBe('');
    expect(host.style.getPropertyValue('--wm-stage-background')).toBe('');
    stage.destroy();
    const themed = mountStage(host, {render: () => undefined});
    expect(themed.element.style.getPropertyValue('--wm-stage-background')).toBe('');
    themed.destroy();
  });

  it('gives the inner drawing a minimum width without changing its host size', () => {
    const host = document.createElement('div');
    host.style.width = '240px';
    const stage = mountStage(host, {render: () => undefined}, {
      overflow: 'auto', surfaceMinWidth: 'var(--sheet-width, 32rem)',
    });
    expect(stage.element.style.getPropertyValue('--wm-stage-surface-min-width')).toBe('var(--sheet-width, 32rem)');
    expect(host.style.width).toBe('240px');
    expect(stageStyle).toContain('min-width: var(--wm-stage-surface-min-width, 0)');
    // The root remains the scroll target used by retained renderers. Giving
    // overflow only to the already-wide drawing would leak beyond this host.
    document.body.append(host);
    expect(getComputedStyle(stage.element).overflow).toBe('var(--wm-stage-overflow, hidden)');
    expect(getComputedStyle(stage.surface).overflow).toBe('visible');
    stage.element.scrollLeft = 96;
    stage.update();
    expect(stage.element.scrollLeft).toBe(96);
    expect(stage.surface.scrollLeft).toBe(0);
    stage.destroy();
    const fresh = mountStage(host, {render: () => undefined});
    expect(fresh.element.style.getPropertyValue('--wm-stage-surface-min-width')).toBe('');
    expect(host.style.width).toBe('240px');
    fresh.destroy();
  });

  it('takes cropping as an option instead of a token the caller has to know', () => {
    const host = document.createElement('div');
    const scrolling = mountStage(host, {render: () => undefined}, {overflow: 'auto'});
    expect(scrolling.element.style.getPropertyValue('--wm-stage-overflow')).toBe('auto');
    scrolling.destroy();

    const cropped = mountStage(host, {render: () => undefined});
    // Unset stays unset, so the stylesheet's own `hidden` default applies.
    expect(cropped.element.style.getPropertyValue('--wm-stage-overflow')).toBe('');
    cropped.destroy();
  });
});
