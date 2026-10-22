// @vitest-environment jsdom
import {afterEach, describe, expect, it, vi} from 'vitest';
import {mountLevelAnalyzer} from '../src/level-analyzer';

afterEach(() => document.body.replaceChildren());

describe('level analyzer presenter', () => {
  it('uses shared pending feedback while retaining quiet routine states and actionable messages', () => {
    const host = document.createElement('div');
    const handle = mountLevelAnalyzer(host, {onThresholdChange: vi.fn(), onFreezeChange: vi.fn(), onResetHold: vi.fn()});
    const current = {history: [], thresholdDbfs: -12, frozen: false, status: 'Waiting for playback', waiting: true};
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
    const status = host.querySelector<HTMLElement>('.wui-level-analyzer__status')!;
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
    expect(handle.element.getAttribute('aria-label')).toBe('Level analyzer');
    expect(handle.element.querySelector('header')).toBeNull();
    expect(handle.element.querySelector<HTMLElement>('[role="status"]')!.hidden).toBe(true);
    expect(handle.element.textContent).toContain('-18.0');
    expect(handle.element.textContent).toContain('-6.0');
    expect(handle.element.textContent).toContain('9.0');
    expect(handle.element.querySelector('.wui-level-analyzer__plot')?.getAttribute('data-over')).toBe('true');
    expect(handle.element.querySelectorAll('.wui-level-analyzer__column')).toHaveLength(64);

    expect(host.querySelector('input[type="range"]')).toBeNull();
    const threshold = host.querySelector<HTMLDivElement>('[role="slider"][part~="threshold"]')!;
    expect(threshold.getAttribute('aria-label')).toBe('Peak threshold');
    expect(threshold.getAttribute('aria-orientation')).toBe('horizontal');
    expect(threshold.getAttribute('aria-valuemin')).toBe('-60');
    expect(threshold.getAttribute('aria-valuemax')).toBe('0');
    expect(threshold.getAttribute('aria-valuenow')).toBe('-12');
    expect(threshold.getAttribute('aria-valuetext')).toBe('-12 dBFS');
    threshold.dispatchEvent(new KeyboardEvent('keydown', {key: 'ArrowLeft', bubbles: true}));
    expect(actions.onThresholdChange).toHaveBeenCalledExactlyOnceWith(-13);
    host.querySelectorAll<HTMLButtonElement>('button')[0]!.click();
    expect(actions.onFreezeChange).toHaveBeenCalledWith(true);
    host.querySelectorAll<HTMLButtonElement>('button')[1]!.click();
    expect(actions.onResetHold).toHaveBeenCalledOnce();
    handle.update({sample, heldPeakDbfs: -6, history: [sample], thresholdDbfs: -20, frozen: true, status: 'Live'});
    expect(host.querySelector('button')?.getAttribute('aria-pressed')).toBe('true');
    expect(host.querySelector('button')?.textContent).toBe('Freeze');
    expect(threshold.getAttribute('aria-valuenow')).toBe('-20');
    expect(actions.onThresholdChange).toHaveBeenCalledOnce();
    handle.destroy();
    expect(host.childElementCount).toBe(0);
    threshold.dispatchEvent(new KeyboardEvent('keydown', {key: 'ArrowLeft', bubbles: true}));
    expect(actions.onThresholdChange).toHaveBeenCalledOnce();
  });

  it('keeps readout nodes and ordinary state quiet while preserving missing-input messages', () => {
    const host = document.createElement('div'); document.body.append(host);
    const handle = mountLevelAnalyzer(host, {onThresholdChange: vi.fn(), onFreezeChange: vi.fn(), onResetHold: vi.fn()});
    const state = {history: [], thresholdDbfs: -12, frozen: false, status: 'Waiting for playback'};
    const readouts = [...host.querySelectorAll('dd')];
    const status = host.querySelector<HTMLElement>('[role="status"]')!;
    for (const message of ['Waiting for playback', 'No signal', 'Live analyser unavailable', 'Error: missing source']) {
      handle.update({...state, status: message});
      expect(status.hidden).toBe(false); expect(status.textContent).toBe(message);
    }
    for (const message of ['Live', 'Paused', 'Frozen']) {
      handle.update({...state, status: message, frozen: message === 'Frozen'});
      expect(status.hidden).toBe(true); expect(status.textContent).toBe('');
      expect([...host.querySelectorAll('dd')]).toEqual(readouts);
      expect(host.querySelector('button')?.textContent).toBe('Freeze');
    }
    expect(host.querySelector<HTMLButtonElement>('[part="reset"]')?.getAttribute('aria-label')).toBe('Reset hold');
    handle.destroy();
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
