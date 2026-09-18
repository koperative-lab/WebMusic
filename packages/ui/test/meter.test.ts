// @vitest-environment jsdom

import {createUILocalization, type UILocalization} from '../src/localization';

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

describe('meter capabilities and localization', () => {
  it('requires only the selected pull port', () => {
    const host = document.createElement('div');
    const level = mountMeter(host, {readLevel: () => ({level: .25})}, {animate: false});
    expect(level.element.getAttribute('aria-valuetext')).toBe('25% level');
    const spectrum = mountMeter(host, {readSpectrum: () => [.2, .7]}, {mode: 'spectrum', animate: false});
    expect(spectrum.element.getAttribute('aria-valuetext')).toBe('70% spectrum peak');
    spectrum.destroy();
  });

  it.each(['level', 'spectrum'] as const)('updates %s name and value without replacing the root or bars', (mode) => {
    const host = document.createElement('div');
    const localization = createUILocalization();
    const handle = mountMeter(host, {readLevel: () => ({level: .3}), readSpectrum: () => [.2, .3]}, {
      mode, animate: false, localization,
    });
    const child = handle.element.firstElementChild;
    localization.update({
      messages: {'meter.level': '电平', 'meter.spectrum': '频谱', 'meter.levelValue': '电平 {value}', 'meter.spectrumValue': '峰值 {value}'},
      formatters: {percent: (value) => `百分之${value * 100}`},
    });
    expect(handle.element.firstElementChild).toBe(child);
    expect(handle.element.getAttribute('aria-label')).toBe(mode === 'level' ? '电平' : '频谱');
    expect(handle.element.getAttribute('aria-valuetext')).toBe(mode === 'level' ? '电平 百分之30' : '峰值 百分之30');
    expect(handle.element.getAttribute('aria-valuenow')).toBe('30');
    handle.updateLabel('Bus A');
    localization.update({messages: {'meter.level': 'Level B', 'meter.spectrum': 'Spectrum B'}});
    expect(handle.element.getAttribute('aria-label')).toBe('Bus A');
    handle.updateLabel();
    expect(handle.element.getAttribute('aria-label')).toBe(mode === 'level' ? 'Level B' : 'Spectrum B');
    handle.destroy();
  });

  it('reports wrong JavaScript binding modes without calling the other port', () => {
    const onError = vi.fn();
    const readLevel = vi.fn(() => ({level: .4}));
    const handle = mountMeter(document.createElement('div'), {readLevel} as unknown as MeterBinding, {mode: 'spectrum', animate: false, onError});
    expect(readLevel).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({message: 'Spectrum meter requires readSpectrum(bars)'}));
    handle.destroy();
  });

  it('lets a translation callback replace the mounting meter without a leaked frame', () => {
    const request = vi.fn(() => 1);
    vi.stubGlobal('requestAnimationFrame', request);
    const host = document.createElement('div');
    let replacement: ReturnType<typeof mountMeter> | undefined;
    const localization = createUILocalization({messages: {'meter.level': () => {
      replacement ??= mountMeter(host, {readLevel: () => ({level: .2})}, {animate: false});
      return 'Stale';
    }}});
    const stale = mountMeter(host, {readLevel: () => ({level: .9})}, {localization});
    expect(request).not.toHaveBeenCalled();
    expect(host.querySelectorAll('.wui-meter')).toHaveLength(1);
    expect(host.querySelector('.wui-meter')).toBe(replacement?.element);
    stale.destroy();
    replacement?.destroy();
  });

  it('drops a locale subscription returned after reentrant replacement', () => {
    const host = document.createElement('div');
    const release = vi.fn();
    const localization: UILocalization = {
      ...createUILocalization(),
      subscribe() {
        mountMeter(host, {readLevel: () => ({level: .2})}, {animate: false});
        return release;
      },
    };
    const stale = mountMeter(host, {readLevel: () => ({level: .5})}, {localization, animate: false});
    expect(release).toHaveBeenCalledOnce();
    expect(host.querySelector('.wui-meter')?.getAttribute('aria-valuenow')).toBe('20');
    stale.destroy();
    expect(release).toHaveBeenCalledOnce();
  });
});
