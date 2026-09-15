// @vitest-environment jsdom

import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {minimapStyle, mountMinimap, type MinimapState} from '../src/minimap';

const context = {
  setTransform: vi.fn(),
  clearRect: vi.fn(),
} as unknown as CanvasRenderingContext2D;

function pointer(type: string, clientX: number, pointerId = 1): Event {
  const event = new MouseEvent(type, {bubbles: true, button: 0, clientX});
  Object.defineProperty(event, 'pointerId', {value: pointerId});
  return event;
}

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context);
});

afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('mountMinimap', () => {
  it('draws its canvas and paints an accessible range brush', () => {
    const host = document.createElement('div');
    const state: MinimapState = {minimum: 0, maximum: 100, start: 20, end: 40};
    const draw = vi.fn();
    const handle = mountMinimap(
      host,
      {snapshot: () => state, draw},
      {
        label: 'Viewport',
        fallbackWidth: 200,
        fallbackHeight: 32,
        classNames: {root: 'legacy-map', brush: 'legacy-brush'},
        parts: {canvas: 'overview'},
      },
    );

    expect(handle.canvas.width).toBe(200);
    expect(handle.canvas.height).toBe(32);
    expect(draw).toHaveBeenCalledWith(expect.objectContaining({
      context,
      canvas: handle.canvas,
      width: 200,
      height: 32,
      pixelRatio: 1,
    }));
    expect(handle.element.classList.contains('legacy-map')).toBe(true);
    expect(handle.canvas.getAttribute('part')).toContain('overview');
    expect(handle.brush.getAttribute('role')).toBe('slider');
    expect(handle.brush.getAttribute('aria-label')).toBe('Viewport');
    expect(handle.brush.getAttribute('aria-valuemin')).toBe('0');
    expect(handle.brush.getAttribute('aria-valuemax')).toBe('100');
    expect(handle.brush.getAttribute('aria-valuenow')).toBe('20');
    expect(handle.brush.getAttribute('aria-valuetext')).toBe('20.00 to 40.00');
    expect(handle.brush.style.left).toBe('20%');
    expect(handle.brush.style.width).toBe('20%');
    expect(handle.brush.getAttribute('aria-disabled')).toBe('true');
    expect(minimapStyle).toContain('.wui-minimap__brush:focus-visible');
    expect(minimapStyle).toMatch(/\.wui-minimap\s*\{[\s\S]*height: 100%;/);
  });

  it('moves the brush with arrows, Home and End', () => {
    const state: MinimapState = {minimum: 0, maximum: 100, start: 20, end: 40};
    const setRange = vi.fn();
    const handle = mountMinimap(
      document.createElement('div'),
      {snapshot: () => state, draw: vi.fn(), setRange},
      {keyboardStep: .25},
    );

    handle.brush.dispatchEvent(new KeyboardEvent('keydown', {key: 'ArrowRight', bubbles: true}));
    expect(setRange).toHaveBeenLastCalledWith(25, 45);
    handle.brush.dispatchEvent(new KeyboardEvent('keydown', {key: 'Home', bubbles: true}));
    expect(setRange).toHaveBeenLastCalledWith(0, 20);
    handle.brush.dispatchEvent(new KeyboardEvent('keydown', {key: 'End', bubbles: true}));
    expect(setRange).toHaveBeenLastCalledWith(80, 100);
  });

  it('seeks and recenters from the canvas, then resizes a brush edge', async () => {
    const state: MinimapState = {minimum: 0, maximum: 100, start: 20, end: 40};
    const setRange = vi.fn();
    const seek = vi.fn();
    const handle = mountMinimap(document.createElement('div'), {
      snapshot: () => state,
      draw: vi.fn(),
      setRange,
      seek,
    });
    const viewport = handle.element.querySelector<HTMLElement>('.wui-minimap__viewport')!;
    vi.spyOn(viewport, 'getBoundingClientRect').mockReturnValue({
      left: 0, right: 200, top: 0, bottom: 40, width: 200, height: 40, x: 0, y: 0,
      toJSON: () => ({}),
    });
    vi.spyOn(handle.brush, 'getBoundingClientRect').mockReturnValue({
      left: 40, right: 80, top: 0, bottom: 40, width: 40, height: 40, x: 40, y: 0,
      toJSON: () => ({}),
    });

    handle.canvas.dispatchEvent(pointer('pointerdown', 160));
    expect(setRange).toHaveBeenLastCalledWith(70, 90);
    expect(seek).toHaveBeenLastCalledWith(80);
    await Promise.resolve();

    handle.brush.dispatchEvent(pointer('pointerdown', 79, 7));
    handle.element.dispatchEvent(pointer('pointermove', 120, 7));
    expect(setRange).toHaveBeenLastCalledWith(20, 60);
    handle.element.dispatchEvent(pointer('pointerup', 120, 7));
  });

  it('subscribes, remounts cleanly and reports draw failures', () => {
    const host = document.createElement('div');
    const callerNode = document.createElement('p');
    host.append(callerNode);
    const cleanup = vi.fn();
    const first = mountMinimap(host, {
      snapshot: () => ({minimum: 0, maximum: 1}),
      draw: vi.fn(),
      subscribe: () => cleanup,
    });
    const failure = new Error('draw failed');
    const onError = vi.fn();
    const second = mountMinimap(
      host,
      {snapshot: () => ({minimum: 0, maximum: 1}), draw: () => {
        throw failure;
      }},
      {onError},
    );

    expect(first.canvas.isConnected).toBe(false);
    expect(cleanup).toHaveBeenCalledOnce();
    expect(onError).toHaveBeenCalledWith(failure);
    expect(host.firstElementChild).toBe(callerNode);
    expect(host.querySelectorAll('.wui-minimap')).toHaveLength(1);

    second.destroy();
    second.destroy();
    expect(host.firstElementChild).toBe(callerNode);
    expect(host.querySelector('.wui-minimap')).toBeNull();
  });

  it('redraws after resize and disconnects its owner-window observer', () => {
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
    const handle = mountMinimap(
      document.createElement('div'),
      {snapshot: () => ({minimum: 0, maximum: 1}), draw},
      {fallbackWidth: 200, fallbackHeight: 30},
    );
    const viewport = handle.element.querySelector<HTMLElement>('.wui-minimap__viewport')!;
    expect(observe).toHaveBeenCalledWith(viewport);

    Object.defineProperty(viewport, 'clientWidth', {configurable: true, value: 400});
    resize([], {} as ResizeObserver);
    expect(draw).toHaveBeenCalledTimes(2);
    expect(handle.canvas.width).toBe(400);

    handle.destroy();
    expect(disconnect).toHaveBeenCalledOnce();
  });
});
