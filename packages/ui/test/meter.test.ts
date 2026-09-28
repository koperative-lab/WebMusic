// @vitest-environment jsdom

import {afterEach, describe, expect, it, vi} from 'vitest';
import {
  meterStyle,
  mountMeter,
  type MeterBinding,
} from '../src/meter';

afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('mountMeter', () => {
  it('renders and redraws an accessible level meter', () => {
    const host = document.createElement('div');
    const binding: MeterBinding = {
      readLevel: vi.fn(() => ({level: 0.25, peak: 0.5, peakHold: 0.75})),
      readSpectrum: vi.fn(() => []),
    };
    const handle = mountMeter(host, binding, {
      animate: false,
      label: 'Master output',
      classNames: {root: 'wrap', track: 'track', fill: 'fill', peak: 'pk'},
      parts: {root: 'wrap'},
    });
    const root = host.querySelector<HTMLElement>('.wui-meter')!;

    expect(root.getAttribute('role')).toBe('meter');
    expect(root.getAttribute('aria-label')).toBe('Master output');
    expect(root.getAttribute('aria-valuenow')).toBe('25');
    expect(root.getAttribute('aria-valuetext')).toBe('25% level');
    expect(root.classList.contains('wrap')).toBe(true);
    expect(root.getAttribute('part')).toContain('wrap');
    expect(host.querySelector<HTMLElement>('.fill')?.style.width).toBe('25%');
    expect(host.querySelector<HTMLElement>('.pk')?.style.left).toBe('75%');

    handle.redraw();
    expect(binding.readLevel).toHaveBeenCalledTimes(2);

    handle.updateLabel('Bus A');
    expect(root.getAttribute('aria-label')).toBe('Bus A');
    handle.updateLabel();
    expect(root.getAttribute('aria-label')).toBe('Audio level');
  });

  it('renders normalized spectrum values and enforces the four-bar minimum', () => {
    const host = document.createElement('div');
    const readSpectrum = vi.fn(() => [0, 0.25, 0.5, 2]);
    mountMeter(
      host,
      {readLevel: () => ({level: 0}), readSpectrum},
      {mode: 'spectrum', bars: 2, animate: false, classNames: {bar: 'fbar'}},
    );

    const bars = [...host.querySelectorAll<HTMLElement>('.fbar')];
    expect(bars).toHaveLength(4);
    expect(readSpectrum).toHaveBeenCalledWith(4);
    expect(bars.map((bar) => bar.style.height)).toEqual(['1%', '25%', '50%', '100%']);
    expect(host.querySelector('.wui-meter')?.getAttribute('aria-valuenow')).toBe('100');
  });

  it('preserves unrelated host DOM and disposes the previous mount', () => {
    const host = document.createElement('div');
    const existing = document.createElement('p');
    host.append(existing);
    const binding: MeterBinding = {
      readLevel: () => ({level: 0}),
      readSpectrum: () => [],
    };

    mountMeter(host, binding, {animate: false});
    const second = mountMeter(host, binding, {animate: false});

    expect(host.firstElementChild).toBe(existing);
    expect(host.querySelectorAll('.wui-meter')).toHaveLength(1);
    second.destroy();
    second.destroy();
    expect(host.firstElementChild).toBe(existing);
    expect(host.querySelector('.wui-meter')).toBeNull();
  });

  it('owns frame scheduling, isolates read failures and cancels on destroy', () => {
    const request = vi.fn(() => 17);
    const cancel = vi.fn();
    vi.stubGlobal('requestAnimationFrame', request);
    vi.stubGlobal('cancelAnimationFrame', cancel);
    const failure = new Error('meter read failed');
    const onError = vi.fn();
    const host = document.createElement('div');
    const handle = mountMeter(
      host,
      {
        readLevel: () => {
          throw failure;
        },
        readSpectrum: () => [],
      },
      {onError},
    );

    expect(request).toHaveBeenCalledOnce();
    handle.redraw();
    expect(onError).toHaveBeenCalledWith(failure);
    handle.destroy();
    expect(cancel).toHaveBeenCalledWith(17);
    expect(host.childElementCount).toBe(0);
  });

  it('does not schedule a new frame when redraw destroys the presenter', () => {
    const frames: Array<() => void> = [];
    const request = vi.fn((callback: () => void) => {
      frames.push(callback);
      return frames.length;
    });
    vi.stubGlobal('requestAnimationFrame', request);
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    const host = document.createElement('div');
    const mounted: {handle?: ReturnType<typeof mountMeter>} = {};
    const handle = mountMeter(host, {
      readLevel: () => {
        mounted.handle?.destroy();
        return {level: 0};
      },
      readSpectrum: () => [],
    });
    mounted.handle = handle;

    frames[0]?.();

    expect(request).toHaveBeenCalledOnce();
    expect(host.querySelector('.wui-meter')).toBeNull();
  });

  it('publishes semantic tokens with legacy variable fallbacks', () => {
    expect(meterStyle).toContain('--wm-meter-background');
    expect(meterStyle).toContain('--wm-meter-fill');
    expect(meterStyle).toContain('--wameter-bg');
    expect(meterStyle).toContain('--wameter-fill');
  });
});
