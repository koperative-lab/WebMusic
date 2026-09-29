// @vitest-environment jsdom

import {afterEach, describe, expect, it, vi} from 'vitest';
import {renderLoudnessMeter} from '../../src/view/render/meter';

afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function analyser(): AnalyserNode {
  return {
    fftSize: 4,
    frequencyBinCount: 8,
    disconnect: vi.fn(),
    getByteTimeDomainData: vi.fn((buffer: Uint8Array) => buffer.fill(160)),
    getByteFrequencyData: vi.fn((buffer: Uint8Array) => buffer.fill(128)),
  } as unknown as AnalyserNode;
}

describe('renderLoudnessMeter', () => {
  it('keeps its public facade while reusing the presenter and borrowed controller', () => {
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 9));
    const cancel = vi.fn();
    vi.stubGlobal('cancelAnimationFrame', cancel);
    const source = analyser();
    const container = document.createElement('div');
    const existing = document.createElement('p');
    container.append(existing);

    const rendered = renderLoudnessMeter(container, source, {
      height: 72,
      color: 'lime',
      peakColor: 'red',
      backgroundColor: 'black',
    });
    rendered.redraw();

    const meter = container.querySelector<HTMLElement>('.wui-meter')!;
    expect(meter.getAttribute('role')).toBe('meter');
    expect(meter.style.getPropertyValue('--wui-meter-height')).toBe('72px');
    expect(meter.style.getPropertyValue('--wm-meter-surface-background')).toBe('black');
    expect(meter.style.getPropertyValue('--wm-meter-surface-border')).toBe('0');
    expect(meter.style.getPropertyValue('--wm-meter-surface-padding')).toBe('0');
    expect(meter.style.getPropertyValue('--wm-meter-surface-radius')).toBe('0');
    expect(meter.style.getPropertyValue('--wm-meter-padding')).toBe('0');
    expect(meter.style.getPropertyValue('--wm-meter-radius')).toBe('0');
    expect(meter.style.getPropertyValue('--wm-meter-track')).toBe('black');
    expect(source.getByteTimeDomainData).toHaveBeenCalledOnce();
    expect(rendered.hitTest(0, 0)).toEqual({seconds: 0});

    rendered.dispose();
    rendered.dispose();
    expect(container.firstElementChild).toBe(existing);
    expect(container.querySelector('.wui-meter')).toBeNull();
    expect(source.disconnect).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalledWith(9);
  });

  it('leaves unspecified palette options available to the inherited presenter theme', () => {
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 2));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    const container = document.createElement('div');
    container.style.setProperty('--wm-meter-fill', 'purple');
    container.style.setProperty('--wm-meter-track', 'ivory');
    const rendered = renderLoudnessMeter(container, analyser());
    const meter = container.querySelector<HTMLElement>('.wui-meter')!;
    expect(meter.style.getPropertyValue('--wui-meter-fill')).toBe('');
    expect(meter.style.getPropertyValue('--wui-meter-peak')).toBe('');
    expect(meter.style.getPropertyValue('--wm-meter-track')).toBe('');
    expect(meter.style.getPropertyValue('--wm-meter-surface-background')).toBe('transparent');
    rendered.dispose();
  });

  it('maps spectrum options to the presenter', () => {
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 2));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    const container = document.createElement('div');
    const rendered = renderLoudnessMeter(container, {analyser: analyser()}, {mode: 'spectrum', bars: 6});

    rendered.redraw();
    expect(container.querySelectorAll('.wui-meter__bar')).toHaveLength(6);
    expect(container.querySelector('.wui-meter')?.getAttribute('aria-label')).toBe('Spectrum');
    rendered.dispose();
  });

  it('keeps multiple renderer instances independent in one container', () => {
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 4));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    const container = document.createElement('div');
    const first = renderLoudnessMeter(container, analyser());
    const second = renderLoudnessMeter(container, analyser());

    expect(container.querySelectorAll('.wui-meter')).toHaveLength(2);
    first.dispose();
    expect(container.querySelectorAll('.wui-meter')).toHaveLength(1);
    second.dispose();
    expect(container.querySelectorAll('.wui-meter')).toHaveLength(0);
  });
});
