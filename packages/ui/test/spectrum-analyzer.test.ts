// @vitest-environment jsdom
import {afterEach, describe, expect, it, vi} from 'vitest';
import {
  mountSpectrumAnalyzer,
  type SpectrumAnalyzerFrame,
  type SpectrumAnalyzerState,
} from '../src/spectrum-analyzer';

const context = {
  setTransform: vi.fn(), clearRect: vi.fn(), fillRect: vi.fn(), beginPath: vi.fn(),
  moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn(), fillText: vi.fn(), setLineDash: vi.fn(),
};

function frame(): SpectrumAnalyzerFrame {
  const bins = new Float32Array(1024).fill(-100);
  bins[Math.round(1_000 * 2048 / 48_000)] = -36;
  return {bins, sampleRate: 48_000, fftSize: 2048, minDb: -100, maxDb: -30};
}

function state(): SpectrumAnalyzerState {
  return {
    frame: frame(), sourceRevision: 1, frozen: false, peakHold: false,
    minFrequency: 20, maxFrequency: 20_000, status: 'live',
  };
}

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('mountSpectrumAnalyzer', () => {
  it('uses shared waiting feedback without replacing plot controls or hiding unavailable status', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D);
    const host = document.createElement('div');
    const current = state();
    current.status = 'waiting';
    const handle = mountSpectrumAnalyzer(host, {snapshot: () => current, setFrozen: vi.fn(), setPeakHold: vi.fn()});
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

  it('shows an accessible log-frequency probe with analyser-bin dB, and pointer/keyboard inspection', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D);
    const host = document.createElement('div');
    document.body.append(host);
    const current = state();
    const probes: Array<{frequency: number; db?: number}> = [];
    const handle = mountSpectrumAnalyzer(host, {
      snapshot: () => current,
      setFrozen: vi.fn(), setPeakHold: vi.fn(),
      probe: (frequency, db) => probes.push({frequency, db}),
    });
    const plot = host.querySelector<HTMLCanvasElement>('[part="plot"]')!;
    expect(plot.getAttribute('role')).toBe('slider');
    expect(plot.getAttribute('aria-valuetext')).toContain('-36.0 dB');
    expect(host.querySelector('output')?.textContent).toContain('1.0 kHz');
    expect([...host.querySelectorAll('[part="readout"] dt')].map((node) => node.textContent)).toEqual(['Frequency', 'Level']);
    expect([...host.querySelectorAll('[part="readout"] output')].map((node) => node.textContent)).toEqual(['1.0 kHz', '-36.0 dB']);
    expect(host.querySelector<HTMLElement>('[part="status"]')?.hidden).toBe(true);
    expect(context.stroke).toHaveBeenCalled();

    plot.dispatchEvent(new KeyboardEvent('keydown', {key: 'ArrowRight', bubbles: true}));
    expect(probes).toHaveLength(1);
    expect(probes[0]!.frequency).toBeGreaterThan(1_000);
    current.maxFrequency = 500;
    handle.update();
    expect(handle.selectedFrequency).toBe(500);
    current.maxFrequency = 20_000;
    handle.update();
    plot.dispatchEvent(new KeyboardEvent('keydown', {key: 'Home', bubbles: true}));
    expect(probes.at(-1)?.frequency).toBe(20);
    vi.spyOn(plot, 'getBoundingClientRect').mockReturnValue({left: 0, width: 360} as DOMRect);
    plot.dispatchEvent(new PointerEvent('pointermove', {clientX: 350, bubbles: true}));
    expect(probes.at(-1)?.frequency).toBeGreaterThan(10_000);

    handle.destroy();
    expect(host.querySelector('.wui-spectrum-analyzer')).toBeNull();
  });

  it('routes freeze, peak hold and reset through the presenter and updates their state', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D);
    const host = document.createElement('div');
    const current = state();
    const setFrozen = vi.fn((value: boolean) => { current.frozen = value; });
    const setPeakHold = vi.fn((value: boolean) => { current.peakHold = value; });
    const handle = mountSpectrumAnalyzer(host, {snapshot: () => current, setFrozen, setPeakHold});
    const freeze = host.querySelector<HTMLButtonElement>('[part="freeze"]')!;
    const hold = host.querySelector<HTMLButtonElement>('[part="peak-hold"]')!;
    const reset = host.querySelector<HTMLButtonElement>('[part="reset-peaks"]')!;
    expect(freeze.disabled).toBe(false);
    expect(reset.disabled).toBe(true);
    freeze.click();
    hold.click();
    expect(setFrozen).toHaveBeenCalledWith(true);
    expect(setPeakHold).toHaveBeenCalledWith(true);
    expect(freeze.getAttribute('aria-pressed')).toBe('true');
    expect(hold.getAttribute('aria-pressed')).toBe('true');
    expect(reset.disabled).toBe(false);
    reset.click();
    expect(reset.disabled).toBe(false);
    current.frame = undefined;
    current.status = 'paused';
    handle.update();
    expect(host.querySelector<HTMLElement>('[part="status"]')?.hidden).toBe(true);
    expect(host.querySelectorAll('[part="readout"] output')[1]?.textContent).toBe('—');
    current.sourceRevision += 1;
    handle.update();
    expect(reset.disabled).toBe(true);
    handle.destroy();
  });

  it('paints solid signal and dashed held peaks with neutral or caller-resolved ink', () => {
    const painted: string[] = [];
    const drawing = {...context, strokeStyle: '', stroke: vi.fn(), fillRect: vi.fn(), setLineDash: vi.fn()};
    drawing.stroke.mockImplementation(() => { painted.push(drawing.strokeStyle); });
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(drawing as unknown as CanvasRenderingContext2D);
    const host = document.createElement('div'); document.body.append(host);
    const current = state(); current.peakHold = true;
    const handle = mountSpectrumAnalyzer(host, {snapshot: () => current, setFrozen: vi.fn(), setPeakHold: vi.fn()});
    expect(new Set(painted)).toEqual(new Set(['#444', '#666']));
    expect(drawing.fillRect).not.toHaveBeenCalled();
    expect(drawing.setLineDash).toHaveBeenCalledWith([4, 3]);
    painted.length = 0;
    handle.element.style.color = 'rgb(22, 44, 66)';
    host.querySelector<HTMLElement>('[part="readout"]')!.style.color = 'rgb(77, 88, 99)';
    handle.update();
    expect(new Set(painted)).toEqual(new Set(['rgb(22, 44, 66)', 'rgb(77, 88, 99)']));
    for (const status of ['live', 'paused', 'frozen'] as const) {
      current.status = status; handle.update();
      expect(host.querySelector<HTMLElement>('[part="status"]')?.hidden).toBe(true);
    }
    current.status = 'waiting'; handle.update();
    expect(host.querySelector('[part="status"]')?.textContent).toBe('Waiting for playback');
    current.status = 'unavailable'; handle.update();
    expect(host.querySelector('[part="status"]')?.textContent).toBe('Analyser unavailable');
    expect(host.querySelector<HTMLElement>('[part="status"]')?.hidden).toBe(false);
    handle.destroy();
  });

  it('preserves unrelated DOM, replaces prior mounts and releases subscriptions', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D);
    const host = document.createElement('div');
    const existing = document.createElement('p');
    host.append(existing);
    const release = vi.fn();
    const binding = {
      snapshot: state,
      setFrozen: vi.fn(), setPeakHold: vi.fn(),
      subscribe: vi.fn(() => release),
    };
    mountSpectrumAnalyzer(host, binding);
    const second = mountSpectrumAnalyzer(host, binding);
    expect(host.firstElementChild).toBe(existing);
    expect(host.querySelectorAll('.wui-spectrum-analyzer')).toHaveLength(1);
    expect(release).toHaveBeenCalledOnce();
    second.destroy();
    second.destroy();
    expect(release).toHaveBeenCalledTimes(2);
    expect(host.firstElementChild).toBe(existing);
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
    let replacement: ReturnType<typeof mountSpectrumAnalyzer> | undefined;
    const old = mountSpectrumAnalyzer(host, {
      snapshot: () => {
        replacement ??= mountSpectrumAnalyzer(host, {
          snapshot: state, setFrozen: vi.fn(), setPeakHold: vi.fn(), subscribe: newSubscribe,
        });
        return state();
      },
      setFrozen: vi.fn(), setPeakHold: vi.fn(), subscribe: oldSubscribe,
    });

    expect(host.querySelectorAll('.wui-spectrum-analyzer')).toHaveLength(1);
    expect(host.querySelector('.wui-spectrum-analyzer')).toBe(replacement!.element);
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
    let replacement: ReturnType<typeof mountSpectrumAnalyzer> | undefined;
    mountSpectrumAnalyzer(host, {
      snapshot: state, setFrozen: vi.fn(), setPeakHold: vi.fn(),
      subscribe: () => {
        replacement = mountSpectrumAnalyzer(host, {
          snapshot: state, setFrozen: vi.fn(), setPeakHold: vi.fn(), subscribe: () => newRelease,
        });
        return oldRelease;
      },
    });
    expect(oldRelease).toHaveBeenCalledOnce();
    expect(host.querySelectorAll('.wui-spectrum-analyzer')).toHaveLength(1);
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
    const handle = mountSpectrumAnalyzer(host, {
      snapshot: () => { if (++calls === failAt) throw failure; return state(); },
      setFrozen: vi.fn(), setPeakHold: vi.fn(), probe,
    }, {onError});
    const plot = host.querySelector<HTMLCanvasElement>('[part="plot"]')!;
    vi.spyOn(plot, 'getBoundingClientRect').mockReturnValue({left: 0, width: 360} as DOMRect);
    const pointer = () => plot.dispatchEvent(new PointerEvent('pointerdown', {clientX: 350, bubbles: true}));

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
