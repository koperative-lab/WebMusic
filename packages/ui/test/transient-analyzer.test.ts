// @vitest-environment jsdom
import {afterEach, describe, expect, it, vi} from 'vitest';
import {mountTransientAnalyzer, type TransientAnalyzerState} from '../src/transient-analyzer';

const base: TransientAnalyzerState = {
  history: [], sensitivity: 0.55, threshold: 0.206, frozen: false,
  hitCount: 0, status: 'Waiting for playback',
};

afterEach(() => document.body.replaceChildren());

describe('mountTransientAnalyzer', () => {
  it('uses shared pending feedback while retaining quiet routine states and actionable messages', () => {
    const host = document.createElement('div');
    const handle = mountTransientAnalyzer(host, {onSensitivityChange: vi.fn(), onFreezeChange: vi.fn(), onClear: vi.fn()});
    const current = {...base, waiting: true};
    handle.update(current);
    const indicator = host.querySelector<HTMLElement>('.wui-status')!;
    expect(indicator.dataset.kind).toBe('waiting');
    expect(indicator.getAttribute('role')).toBe('status');
    expect(indicator.textContent).toBe('Waiting for playback');
    expect(indicator.querySelector('.wui-status__indicator')?.getAttribute('aria-hidden')).toBe('true');
    const controls = [...host.querySelectorAll('button, [role="slider"]')];
    handle.update({...current, loading: true, status: 'Loading audio'});
    expect(indicator.dataset.kind).toBe('loading');
    expect(indicator.getAttribute('aria-busy')).toBe('true');
    handle.update({...current, waiting: false, status: 'Paused'});
    expect(indicator.hidden).toBe(true);
    expect(indicator.hasAttribute('aria-busy')).toBe(false);
    const status = host.querySelector<HTMLElement>('.wui-transient-analyzer__status')!;
    expect(status.hidden).toBe(true);
    expect(status.textContent).toBe('');
    handle.update({...current, waiting: false, status: 'Analyser unavailable'});
    expect(status.hidden).toBe(false);
    expect(status.textContent).toBe('Analyser unavailable');
    handle.update(current);
    expect(status.hidden).toBe(false);
    expect(host.querySelector('.wui-status')).toBe(indicator);
    expect(indicator.dataset.kind).toBe('waiting');
    expect([...host.querySelectorAll('button, [role="slider"]')]).toEqual(controls);
    handle.destroy();
    expect(host.children).toHaveLength(0);
  });

  it('shows live attack evidence and forwards its three inspection controls', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const onSensitivityChange = vi.fn();
    const onFreezeChange = vi.fn();
    const onClear = vi.fn();
    const handle = mountTransientAnalyzer(host, {onSensitivityChange, onFreezeChange, onClear});
    handle.update({...base, sample: {strength: 0.7, hit: true}, history: [{strength: 0.7, hit: true}],
      hitCount: 1, lastIntervalMs: 180, status: 'Live'});
    expect(host.textContent).toContain('70%');
    expect(host.textContent).toContain('180');
    expect(host.querySelectorAll('.wui-transient-analyzer__column')).toHaveLength(64);
    expect(host.querySelector('.wui-transient-analyzer__column[data-hit="true"]')).not.toBeNull();
    expect([...host.querySelectorAll('.wui-transient-analyzer__column')].at(-1)?.getAttribute('data-hit')).toBe('true');
    expect(host.querySelector('[part="plot"]')?.getAttribute('aria-label')).toContain('1 hits');
    const status = host.querySelector('[role="status"]')!;
    expect((status as HTMLElement).hidden).toBe(true);
    expect(handle.element.getAttribute('aria-label')).toBe('Transient analyzer');
    expect(handle.element.querySelector('header')).toBeNull();
    const originalText = status.firstChild;
    handle.update({...base, status: 'Live'});
    expect(status.firstChild).toBe(originalText);

    host.querySelector<HTMLButtonElement>('[part="freeze"]')!.click();
    host.querySelector<HTMLButtonElement>('[part="clear"]')!.click();
    expect(host.querySelector('input[type="range"]')).toBeNull();
    const input = host.querySelector<HTMLDivElement>('[role="slider"][part~="sensitivity"]')!;
    expect(input.getAttribute('aria-label')).toBe('Sensitivity');
    expect(input.getAttribute('aria-orientation')).toBe('horizontal');
    expect(input.getAttribute('aria-valuemin')).toBe('0');
    expect(input.getAttribute('aria-valuemax')).toBe('100');
    expect(input.getAttribute('aria-valuenow')).toBe('55');
    expect(input.getAttribute('aria-valuetext')).toBe('55%');
    input.dispatchEvent(new KeyboardEvent('keydown', {key: 'ArrowRight', bubbles: true}));
    expect(onFreezeChange).toHaveBeenCalledWith(true);
    expect(onClear).toHaveBeenCalledOnce();
    expect(onSensitivityChange).toHaveBeenCalledExactlyOnceWith(0.56);
    handle.update({...base, sensitivity: 0.8, frozen: true, status: 'Frozen'});
    expect(input.getAttribute('aria-valuenow')).toBe('80');
    expect(onSensitivityChange).toHaveBeenCalledOnce();
    expect(host.querySelector('[part="freeze"]')?.getAttribute('aria-pressed')).toBe('true');
    expect(host.querySelector('[part="freeze"]')?.textContent).toBe('Freeze');
    handle.destroy();
    expect(host.children).toHaveLength(0);
    input.dispatchEvent(new KeyboardEvent('keydown', {key: 'ArrowRight', bubbles: true}));
    expect(onSensitivityChange).toHaveBeenCalledOnce();
  });

  it('keeps fixed readouts quiet during playback and exposes only meaningful status messages', () => {
    const host = document.createElement('div'); document.body.append(host);
    const handle = mountTransientAnalyzer(host, {onSensitivityChange: vi.fn(), onFreezeChange: vi.fn(), onClear: vi.fn()});
    const status = host.querySelector<HTMLElement>('[role="status"]')!;
    const readouts = [...host.querySelectorAll('dd')];
    for (const message of ['Waiting for playback', 'No signal', 'Live audio unavailable', 'Error: input failed']) {
      handle.update({...base, status: message});
      expect(status.hidden).toBe(false); expect(status.textContent).toBe(message);
    }
    for (const message of ['Live', 'Paused', 'Frozen']) {
      handle.update({...base, status: message, frozen: message === 'Frozen'});
      expect(status.hidden).toBe(true); expect(status.textContent).toBe('');
      expect([...host.querySelectorAll('dd')]).toEqual(readouts);
      expect(host.querySelector('[part="freeze"]')?.textContent).toBe('Freeze');
    }
    handle.destroy();
  });

  it('replaces a previous mount on the same host and keeps destroy idempotent', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const actions = {onSensitivityChange: vi.fn(), onFreezeChange: vi.fn(), onClear: vi.fn()};
    const first = mountTransientAnalyzer(host, actions);
    const second = mountTransientAnalyzer(host, actions);
    first.update(base);
    second.update(base);
    expect(host.querySelectorAll('.wui-transient-analyzer')).toHaveLength(1);
    second.destroy();
    second.destroy();
    expect(host.children).toHaveLength(0);
  });
});
