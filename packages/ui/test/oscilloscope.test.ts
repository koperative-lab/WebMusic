// @vitest-environment jsdom
import {afterEach, describe, expect, it, vi} from 'vitest';
import {
  mountOscilloscope,
  type OscilloscopeState,
  type OscilloscopeTriggerEdge,
} from '../src/oscilloscope';

const context = {
  setTransform: vi.fn(), clearRect: vi.fn(), fillRect: vi.fn(), beginPath: vi.fn(),
  moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn(), fillText: vi.fn(), setLineDash: vi.fn(),
};

function state(): OscilloscopeState {
  return {
    trace: {samples: Float32Array.from([0, .5, 1, .5, 0, -.5, -1, -.5, 0]), timebaseMs: 10, triggered: true, silent: false},
    availableTimeMs: 42.7, timebaseMs: 10, triggerLevel: 0, triggerEdge: 'rising',
    frozen: false, status: 'live',
  };
}

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('mountOscilloscope', () => {
  it('draws a trigger-aligned trace with accessible pointer and keyboard time probing', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D);
    const host = document.createElement('div');
    document.body.append(host);
    const current = state();
    const probes: Array<{timeMs: number; amplitude?: number}> = [];
    const handle = mountOscilloscope(host, {
      snapshot: () => current,
      setFrozen: vi.fn(), setTimebaseMs: vi.fn(), setTriggerLevel: vi.fn(), setTriggerEdge: vi.fn(),
      probe: (timeMs, amplitude) => probes.push({timeMs, amplitude}),
    });
    const plot = host.querySelector<HTMLCanvasElement>('[part="plot"]')!;
    expect(plot.getAttribute('role')).toBe('slider');
    expect(plot.getAttribute('aria-valuemax')).toBe('10.00');
    expect(host.querySelector('[part="status"]')?.textContent).toBe('Live, triggered');
    expect(context.stroke).toHaveBeenCalled();

    plot.dispatchEvent(new KeyboardEvent('keydown', {key: 'ArrowRight', bubbles: true}));
    expect(probes[0]!.timeMs).toBeCloseTo(.1);
    plot.dispatchEvent(new KeyboardEvent('keydown', {key: 'End', bubbles: true}));
    expect(probes.at(-1)).toMatchObject({timeMs: 10, amplitude: 0});
    vi.spyOn(plot, 'getBoundingClientRect').mockReturnValue({left: 0, width: 360} as DOMRect);
    plot.dispatchEvent(new PointerEvent('pointermove', {clientX: 199, bubbles: true}));
    expect(handle.selectedTimeMs).toBeGreaterThan(4);
    expect(handle.selectedTimeMs).toBeLessThan(6);
    handle.destroy();
  });

  it('routes scope controls to the binding and names free run, missing trigger and pause', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D);
    const host = document.createElement('div');
    const current = state();
    const setFrozen = vi.fn((value: boolean) => { current.frozen = value; });
    const setTimebaseMs = vi.fn((value: number) => { current.timebaseMs = value; current.trace!.timebaseMs = value; });
    const setTriggerLevel = vi.fn((value: number) => { current.triggerLevel = value; });
    const setTriggerEdge = vi.fn((value: OscilloscopeTriggerEdge) => { current.triggerEdge = value; });
    const handle = mountOscilloscope(host, {snapshot: () => current, setFrozen, setTimebaseMs, setTriggerLevel, setTriggerEdge});
    const freeze = host.querySelector<HTMLButtonElement>('[part="freeze"]')!;
    freeze.click();
    expect(setFrozen).toHaveBeenCalledWith(true);
    expect(freeze.getAttribute('aria-pressed')).toBe('true');
    const timebase = host.querySelector<HTMLInputElement>('[part="timebase"]')!;
    timebase.value = '20';
    timebase.dispatchEvent(new Event('input', {bubbles: true}));
    expect(setTimebaseMs).toHaveBeenCalledWith(20);
    const threshold = host.querySelector<HTMLInputElement>('[part="trigger-level"]')!;
    threshold.value = '0.25';
    threshold.dispatchEvent(new Event('input', {bubbles: true}));
    expect(setTriggerLevel).toHaveBeenCalledWith(.25);
    const edge = host.querySelector<HTMLSelectElement>('[part="trigger-edge"]')!;
    edge.value = 'falling';
    edge.dispatchEvent(new Event('change', {bubbles: true}));
    expect(setTriggerEdge).toHaveBeenCalledWith('falling');
    current.trace!.triggered = false;
    current.status = 'live';
    handle.update();
    expect(host.querySelector('[part="status"]')?.textContent).toBe('Live, no matching edge');
    current.trace!.silent = true;
    handle.update();
    expect(host.querySelector('[part="status"]')?.textContent).toBe('No signal');
    current.trace!.silent = false;
    current.triggerEdge = 'off';
    handle.update();
    expect(host.querySelector('[part="status"]')?.textContent).toBe('Live, free run');
    current.trace = undefined;
    current.status = 'paused';
    handle.update();
    expect(host.querySelector('[part="status"]')?.textContent).toBe('Playback paused');
    handle.destroy();
  });

  it('preserves unrelated DOM, replaces earlier mounts and releases subscriptions', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D);
    const host = document.createElement('div');
    const existing = document.createElement('p');
    host.append(existing);
    const release = vi.fn();
    const binding = {
      snapshot: state,
      setFrozen: vi.fn(), setTimebaseMs: vi.fn(), setTriggerLevel: vi.fn(), setTriggerEdge: vi.fn(),
      subscribe: vi.fn(() => release),
    };
    mountOscilloscope(host, binding);
    const second = mountOscilloscope(host, binding);
    expect(host.firstElementChild).toBe(existing);
    expect(host.querySelectorAll('.wui-oscilloscope')).toHaveLength(1);
    expect(release).toHaveBeenCalledOnce();
    second.destroy();
    second.destroy();
    expect(release).toHaveBeenCalledTimes(2);
  });

  it('does not attach resources after the first snapshot synchronously replaces its mount', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D);
    const observers: Array<{observe: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn>}> = [];
    class TestResizeObserver {
      observe = vi.fn();
      disconnect = vi.fn();
      constructor() { observers.push(this); }
    }
    vi.stubGlobal('ResizeObserver', TestResizeObserver);
    const host = document.createElement('div');
    const release = vi.fn();
    const oldSubscribe = vi.fn(() => vi.fn());
    const newSubscribe = vi.fn(() => release);
    let replacement: ReturnType<typeof mountOscilloscope> | undefined;
    const old = mountOscilloscope(host, {
      snapshot: () => {
        replacement ??= mountOscilloscope(host, {
          snapshot: state, setFrozen: vi.fn(), setTimebaseMs: vi.fn(),
          setTriggerLevel: vi.fn(), setTriggerEdge: vi.fn(), subscribe: newSubscribe,
        });
        return state();
      },
      setFrozen: vi.fn(), setTimebaseMs: vi.fn(), setTriggerLevel: vi.fn(),
      setTriggerEdge: vi.fn(), subscribe: oldSubscribe,
    });

    expect(host.querySelectorAll('.wui-oscilloscope')).toHaveLength(1);
    expect(host.querySelector('.wui-oscilloscope')).toBe(replacement!.element);
    expect(oldSubscribe).not.toHaveBeenCalled();
    expect(newSubscribe).toHaveBeenCalledOnce();
    expect(observers).toHaveLength(1);
    expect(observers[0]!.observe).toHaveBeenCalledWith(replacement!.element);
    old.destroy();
    replacement!.destroy();
    expect(observers[0]!.disconnect).toHaveBeenCalledOnce();
    expect(release).toHaveBeenCalledOnce();
  });

  it('releases a subscription returned after synchronous replacement', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D);
    const host = document.createElement('div');
    const oldRelease = vi.fn();
    const newRelease = vi.fn();
    let replacement: ReturnType<typeof mountOscilloscope> | undefined;
    mountOscilloscope(host, {
      snapshot: state, setFrozen: vi.fn(), setTimebaseMs: vi.fn(),
      setTriggerLevel: vi.fn(), setTriggerEdge: vi.fn(),
      subscribe: () => {
        replacement = mountOscilloscope(host, {
          snapshot: state, setFrozen: vi.fn(), setTimebaseMs: vi.fn(),
          setTriggerLevel: vi.fn(), setTriggerEdge: vi.fn(), subscribe: () => newRelease,
        });
        return oldRelease;
      },
    });
    expect(oldRelease).toHaveBeenCalledOnce();
    expect(host.querySelectorAll('.wui-oscilloscope')).toHaveLength(1);
    replacement!.destroy();
    expect(newRelease).toHaveBeenCalledOnce();
  });

  it('reports pointer and keyboard probe snapshot failures without throwing from events', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D);
    const host = document.createElement('div');
    const failure = new Error('snapshot failed');
    const onError = vi.fn();
    const probe = vi.fn();
    let calls = 0;
    let failAt = -1;
    const handle = mountOscilloscope(host, {
      snapshot: () => { if (++calls === failAt) throw failure; return state(); },
      setFrozen: vi.fn(), setTimebaseMs: vi.fn(), setTriggerLevel: vi.fn(), setTriggerEdge: vi.fn(), probe,
    }, {onError});
    const plot = host.querySelector<HTMLCanvasElement>('[part="plot"]')!;
    vi.spyOn(plot, 'getBoundingClientRect').mockReturnValue({left: 0, width: 360} as DOMRect);
    const pointer = () => plot.dispatchEvent(new PointerEvent('pointerdown', {clientX: 199, bubbles: true}));

    failAt = calls + 1;
    expect(pointer).not.toThrow();
    failAt = calls + 2;
    expect(pointer).not.toThrow();
    failAt = calls + 1;
    expect(() => plot.dispatchEvent(new KeyboardEvent('keydown', {key: 'ArrowRight', bubbles: true}))).not.toThrow();
    expect(onError).toHaveBeenCalledTimes(3);
    expect(onError).toHaveBeenNthCalledWith(1, failure);
    expect(onError).toHaveBeenNthCalledWith(2, failure);
    expect(onError).toHaveBeenNthCalledWith(3, failure);
    expect(probe).not.toHaveBeenCalled();
    handle.destroy();
  });
});
