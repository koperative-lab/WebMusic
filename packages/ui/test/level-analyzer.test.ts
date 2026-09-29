// @vitest-environment jsdom
import {afterEach, describe, expect, it, vi} from 'vitest';
import {mountLevelAnalyzer} from '../src/level-analyzer';

afterEach(() => document.body.replaceChildren());

describe('level analyzer presenter', () => {
  it('shows sampled dynamics and delegates threshold, freeze and hold commands', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const actions = {
      onThresholdChange: vi.fn(),
      onFreezeChange: vi.fn(),
      onResetHold: vi.fn(),
    };
    const handle = mountLevelAnalyzer(host, actions);
    const sample = {rmsDbfs: -18, peakDbfs: -9};
    handle.update({sample, heldPeakDbfs: -6, history: [sample], thresholdDbfs: -12, frozen: false, status: 'Live'});
    expect(handle.element.textContent).toContain('Level analyzer');
    expect(handle.element.textContent).toContain('-18.0');
    expect(handle.element.textContent).toContain('-6.0');
    expect(handle.element.textContent).toContain('9.0');
    expect(handle.element.querySelector('.wui-level-analyzer__plot')?.getAttribute('data-over')).toBe('true');
    expect(handle.element.querySelectorAll('.wui-level-analyzer__column')).toHaveLength(64);

    const threshold = host.querySelector<HTMLInputElement>('input[type="range"]')!;
    threshold.value = '-20';
    threshold.dispatchEvent(new Event('input'));
    expect(actions.onThresholdChange).toHaveBeenCalledWith(-20);
    host.querySelectorAll<HTMLButtonElement>('button')[0]!.click();
    expect(actions.onFreezeChange).toHaveBeenCalledWith(true);
    host.querySelectorAll<HTMLButtonElement>('button')[1]!.click();
    expect(actions.onResetHold).toHaveBeenCalledOnce();
    handle.update({sample, heldPeakDbfs: -6, history: [sample], thresholdDbfs: -20, frozen: true, status: 'Live'});
    expect(host.querySelector('button')?.getAttribute('aria-pressed')).toBe('true');
    handle.destroy();
    expect(host.childElementCount).toBe(0);
  });

  it('replaces a previous mount and makes its handle inert', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const actions = {onThresholdChange: vi.fn(), onFreezeChange: vi.fn(), onResetHold: vi.fn()};
    const first = mountLevelAnalyzer(host, actions);
    const second = mountLevelAnalyzer(host, actions);
    expect(host.querySelectorAll('.wui-level-analyzer')).toHaveLength(1);
    first.destroy();
    expect(host.querySelectorAll('.wui-level-analyzer')).toHaveLength(1);
    second.destroy();
    expect(host.querySelectorAll('.wui-level-analyzer')).toHaveLength(0);
  });
});
