// @vitest-environment jsdom
import {afterEach, describe, expect, it, vi} from 'vitest';
import {mountTransientAnalyzer, type TransientAnalyzerState} from '../src/transient-analyzer';

const base: TransientAnalyzerState = {
  history: [], sensitivity: 0.55, threshold: 0.206, frozen: false,
  hitCount: 0, status: 'Waiting for playback',
};

afterEach(() => document.body.replaceChildren());

describe('mountTransientAnalyzer', () => {
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
    const originalText = status.firstChild;
    handle.update({...base, status: 'Live'});
    expect(status.firstChild).toBe(originalText);

    host.querySelector<HTMLButtonElement>('[part="freeze"]')!.click();
    host.querySelector<HTMLButtonElement>('[part="clear"]')!.click();
    const input = host.querySelector<HTMLInputElement>('[part="sensitivity"]')!;
    input.value = '80';
    input.dispatchEvent(new Event('input', {bubbles: true}));
    expect(onFreezeChange).toHaveBeenCalledWith(true);
    expect(onClear).toHaveBeenCalledOnce();
    expect(onSensitivityChange).toHaveBeenCalledWith(0.8);
    handle.destroy();
    expect(host.children).toHaveLength(0);
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
