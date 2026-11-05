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

function captureFrames(): FrameRequestCallback[] {
  const frames: FrameRequestCallback[] = [];
  vi.spyOn(document.defaultView!, 'requestAnimationFrame').mockImplementation((callback) => frames.push(callback));
  vi.spyOn(document.defaultView!, 'cancelAnimationFrame').mockImplementation(() => undefined);
  return frames;
}

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('mountOscilloscope', () => {
  it('uses shared waiting feedback without replacing plot controls or hiding unavailable status', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D);
    const host = document.createElement('div');
    const current = state();
    current.status = 'waiting';
    const handle = mountOscilloscope(host, {snapshot: () => current, setFrozen: vi.fn(), setTimebaseMs: vi.fn(), setTriggerLevel: vi.fn(), setTriggerEdge: vi.fn()});
    const indicator = host.querySelector<HTMLElement>('.wui-status')!;
    expect(indicator.dataset.kind).toBe('waiting');
    expect(indicator.textContent).toBe('Waiting for playback');
    const plot = host.querySelector('[part="plot"]');
    current.status = 'loading';
    handle.update();
    expect(indicator.dataset.kind).toBe('loading');
    expect(indicator.getAttribute('aria-busy')).toBe('true');
    current.status = 'unavailable';
    handle.update();
    expect(indicator.hidden).toBe(true);
    expect(indicator.hasAttribute('aria-busy')).toBe(false);
    expect(host.querySelector('[part="status"]')?.textContent).toBe('Analyser unavailable');
    expect(host.querySelector('[part="plot"]')).toBe(plot);
    handle.destroy();
    expect(host.children).toHaveLength(0);
  });

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
    expect(host.querySelector<HTMLElement>('[part="status"]')?.hidden).toBe(true);
    expect([...host.querySelectorAll('[part="readout"] dt')].map((node) => node.textContent)).toEqual(['Time', 'Amplitude']);
    expect([...host.querySelectorAll('[part="readout"] output')].map((node) => node.textContent)).toEqual(['0.00 ms', '+0.00']);
    expect(host.querySelector('.wui-oscilloscope__title')).toBeNull();
    expect(context.stroke).toHaveBeenCalled();

    plot.dispatchEvent(new KeyboardEvent('keydown', {key: 'ArrowRight', bubbles: true}));
    expect(probes[0]!.timeMs).toBeCloseTo(.1);
    plot.dispatchEvent(new KeyboardEvent('keydown', {key: 'End', bubbles: true}));
    expect(probes.at(-1)).toMatchObject({timeMs: 10, amplitude: 0});
    const frames = captureFrames();
    vi.spyOn(plot, 'getBoundingClientRect').mockReturnValue({left: 0, width: 360} as DOMRect);
    const probesBefore = probes.length;
    const strokes = context.stroke.mock.calls.length;
    plot.dispatchEvent(new PointerEvent('pointermove', {clientX: 120, bubbles: true}));
    plot.dispatchEvent(new PointerEvent('pointermove', {clientX: 160, bubbles: true}));
    plot.dispatchEvent(new PointerEvent('pointermove', {clientX: 199, bubbles: true}));
    // Hover is coalesced: nothing is drawn or reported until the frame runs, then only the latest position.
    expect(frames).toHaveLength(1);
    expect(probes).toHaveLength(probesBefore);
    expect(context.stroke.mock.calls.length).toBe(strokes);
    frames.shift()!(0);
    expect(probes).toHaveLength(probesBefore + 1);
    expect(handle.selectedTimeMs).toBeGreaterThan(4);
    expect(handle.selectedTimeMs).toBeLessThan(6);
    plot.dispatchEvent(new PointerEvent('pointermove', {clientX: 300, bubbles: true}));
    expect(frames).toHaveLength(1);
    handle.destroy();
    frames.shift()!(0);
    expect(probes).toHaveLength(probesBefore + 1);
  });

  it('reads canvas size and ink once per resize, not on every update or probe', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D);
    let resize: (() => void) | undefined;
    class TestResizeObserver {
      constructor(callback: () => void) { resize = callback; }
      observe = vi.fn();
      disconnect = vi.fn();
    }
    vi.stubGlobal('ResizeObserver', TestResizeObserver);
    const styles = vi.spyOn(document.defaultView!, 'getComputedStyle');
    const host = document.createElement('div'); document.body.append(host);
    const handle = mountOscilloscope(host, {snapshot: state, setFrozen: vi.fn(), setTimebaseMs: vi.fn(), setTriggerLevel: vi.fn(), setTriggerEdge: vi.fn()});
    const plot = host.querySelector<HTMLCanvasElement>('[part="plot"]')!;
    const reads = styles.mock.calls.length;
    expect(reads).toBeGreaterThan(0);
    handle.update();
    plot.dispatchEvent(new KeyboardEvent('keydown', {key: 'ArrowRight', bubbles: true}));
    expect(styles.mock.calls.length).toBe(reads);
    resize!();
    expect(styles.mock.calls.length).toBeGreaterThan(reads);
    handle.destroy();
  });

  it('routes shared faders in physical units and keeps only actionable signal status', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D);
    const host = document.createElement('div');
    const current = state();
    const setFrozen = vi.fn((value: boolean) => { current.frozen = value; });
    const setTimebaseMs = vi.fn((value: number) => { current.timebaseMs = value; current.trace!.timebaseMs = value; });
    const setTriggerLevel = vi.fn((value: number) => { current.triggerLevel = value; });
    const setTriggerEdge = vi.fn((value: OscilloscopeTriggerEdge) => { current.triggerEdge = value; });
    const handle = mountOscilloscope(host, {snapshot: () => current, setFrozen, setTimebaseMs, setTriggerLevel, setTriggerEdge});
    const freeze = host.querySelector<HTMLButtonElement>('[part="freeze"]')!;
    expect(freeze.getAttribute('aria-label')).toBe('Freeze');
    expect(freeze.title).toBe('Freeze');
    expect(freeze.querySelector('svg[data-icon]')?.getAttribute('aria-hidden')).toBe('true');
    expect(freeze.textContent).toBe('');
    freeze.click();
    expect(setFrozen).toHaveBeenCalledWith(true);
    expect(freeze.getAttribute('aria-pressed')).toBe('true');
    expect(host.querySelector('input[type="range"]')).toBeNull();
    const timebase = host.querySelector<HTMLDivElement>('[part~="timebase"]')!;
    expect(timebase.getAttribute('role')).toBe('slider');
    expect(timebase.getAttribute('aria-valuemin')).toBe('1');
    expect(timebase.getAttribute('aria-valuemax')).toBe('42.7');
    expect(timebase.getAttribute('aria-valuetext')).toBe('10.0 ms');
    timebase.dispatchEvent(new KeyboardEvent('keydown', {key: 'ArrowRight', bubbles: true}));
    expect(setTimebaseMs).toHaveBeenLastCalledWith(10.5);
    const threshold = host.querySelector<HTMLDivElement>('[part~="trigger-level"]')!;
    expect(threshold.getAttribute('aria-valuemin')).toBe('-1');
    expect(threshold.getAttribute('aria-valuemax')).toBe('1');
    for (let index = 0; index < 5; index++) threshold.dispatchEvent(new KeyboardEvent('keydown', {key: 'ArrowRight', bubbles: true}));
    expect(setTriggerLevel).toHaveBeenCalledWith(.25);
    expect(threshold.getAttribute('aria-valuetext')).toBe('0.25');
    expect(host.querySelector('select')).toBeNull();
    const edge = host.querySelector<HTMLElement>('[part="trigger-edge"]')!;
    expect(edge.getAttribute('role')).toBe('group');
    expect(edge.getAttribute('aria-label')).toBe('Trigger edge');
    const cells = [...edge.querySelectorAll<HTMLButtonElement>('button')];
    expect(cells.map((cell) => cell.dataset.value)).toEqual(['rising', 'falling', 'off']);
    expect(cells.map((cell) => cell.getAttribute('aria-label'))).toEqual(['Rising edge', 'Falling edge', 'Trigger off']);
    expect(cells.every((cell) => cell.title === cell.getAttribute('aria-label') && cell.querySelector('svg[data-icon]'))).toBe(true);
    expect(cells.map((cell) => cell.getAttribute('aria-pressed'))).toEqual(['true', 'false', 'false']);
    cells[1]!.click();
    expect(setTriggerEdge).toHaveBeenCalledWith('falling');
    expect(edge.dataset.value).toBe('falling');
    expect(cells.map((cell) => cell.getAttribute('aria-pressed'))).toEqual(['false', 'true', 'false']);
    edge.click();
    expect(setTriggerEdge).toHaveBeenCalledOnce();
    const status = host.querySelector<HTMLElement>('[part="status"]')!;
    current.trace!.triggered = false;
    current.status = 'live';
    handle.update();
    // Informational signal state is announced, not drawn.
    expect(status.textContent).toBe('No matching edge');
    expect(status.hidden).toBe(false);
    expect(status.hasAttribute('data-analysis-quiet')).toBe(true);
    current.trace!.silent = true;
    handle.update();
    expect(status.textContent).toBe('No signal');
    expect(status.hasAttribute('data-analysis-quiet')).toBe(true);
    current.trace!.silent = false;
    current.triggerEdge = 'off';
    handle.update();
    expect(host.querySelector<HTMLElement>('[part="status"]')?.hidden).toBe(true);
    current.trace = undefined;
    current.status = 'paused';
    handle.update();
    expect(host.querySelector<HTMLElement>('[part="status"]')?.hidden).toBe(true);
    expect(host.querySelectorAll('[part="readout"] output')[1]?.textContent).toBe('—');
    current.status = 'waiting'; handle.update();
    expect(host.querySelector('[part="status"]')?.textContent).toBe('Waiting for playback');
    current.status = 'unavailable'; handle.update();
    expect(host.querySelector('[part="status"]')?.textContent).toBe('Analyser unavailable');
    expect(status.hasAttribute('data-analysis-quiet')).toBe(false);
    expect(host.querySelector('[part="controls"]')?.classList.contains('wui-analysis-row')).toBe(true);
    handle.destroy();
  });

  it('updates fader limits silently, reaches an exact non-step endpoint, and cleans up detached controls', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D);
    const current = state();
    const setTimebaseMs = vi.fn((value: number) => { current.timebaseMs = value; current.trace!.timebaseMs = value; });
    const host = document.createElement('div');
    const handle = mountOscilloscope(host, {
      snapshot: () => current, setTimebaseMs, setFrozen: vi.fn(), setTriggerLevel: vi.fn(), setTriggerEdge: vi.fn(),
    });
    const timebase = host.querySelector<HTMLElement>('[part~="timebase"]')!;
    current.availableTimeMs = 16.3;
    handle.update();
    expect(setTimebaseMs).not.toHaveBeenCalled();
    expect(timebase.getAttribute('aria-valuemax')).toBe('16.3');
    timebase.dispatchEvent(new KeyboardEvent('keydown', {key: 'End', bubbles: true}));
    expect(setTimebaseMs).toHaveBeenLastCalledWith(16.3);
    handle.destroy();
    setTimebaseMs.mockClear();
    timebase.dispatchEvent(new KeyboardEvent('keydown', {key: 'Home', bubbles: true}));
    expect(setTimebaseMs).not.toHaveBeenCalled();
  });

  it('uses neutral resolved ink and leaves the public CSS plot background visible', () => {
    let resize: (() => void) | undefined;
    vi.stubGlobal('ResizeObserver', class { constructor(callback: () => void) { resize = callback; } observe() {} disconnect() {} });
    const painted: string[] = [];
    const drawing = {...context, strokeStyle: '', stroke: vi.fn(), fillRect: vi.fn()};
    drawing.stroke.mockImplementation(() => { painted.push(drawing.strokeStyle); });
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(drawing as unknown as CanvasRenderingContext2D);
    const host = document.createElement('div'); document.body.append(host);
    const handle = mountOscilloscope(host, {snapshot: state, setFrozen: vi.fn(), setTimebaseMs: vi.fn(), setTriggerLevel: vi.fn(), setTriggerEdge: vi.fn()});
    expect(new Set(painted)).toEqual(new Set(['#444', '#666']));
    expect(drawing.fillRect).not.toHaveBeenCalled();
    painted.length = 0;
    handle.element.style.color = 'rgb(22, 44, 66)';
    host.querySelector<HTMLElement>('[part="readout"]')!.style.color = 'rgb(77, 88, 99)';
    handle.update();
    // Ink is cached between resizes, so a per-frame update never forces style resolution.
    expect(new Set(painted)).toEqual(new Set(['#444', '#666']));
    painted.length = 0;
    resize!();
    expect(new Set(painted)).toEqual(new Set(['rgb(22, 44, 66)', 'rgb(77, 88, 99)']));
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
