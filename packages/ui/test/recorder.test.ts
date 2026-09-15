// @vitest-environment jsdom

import {describe, expect, it, vi} from 'vitest';
import {mountRecorder, type RecorderBinding} from '../src/recorder';

/**
 * The recorder was the one published presenter with no unit coverage, which is
 * how a NaN level reached a published custom property as the string "NaN".
 */
function binding(overrides: Partial<RecorderBinding> = {}): RecorderBinding {
  return {
    snapshot: () => ({recording: false, playing: false, takeCount: 1, level: 0.5}),
    toggleRecording: vi.fn(),
    ...overrides,
  } as RecorderBinding;
}

describe('mountRecorder', () => {
  it('keeps export actions named and operable through narrow-host and state changes', () => {
    const host = document.createElement('div');
    const exportTake = vi.fn();
    let hasLevel = false;
    const longStatus = 'Captured_take_with_a_long_unbroken_name_and_128_notes';
    const handle = mountRecorder(host, binding({
      snapshot: () => ({recording: false, takeCount: 128, level: hasLevel ? 0.4 : undefined, status: longStatus}),
      export: exportTake,
    }), {exportFormats: [{id: 'mid', label: 'MIDI'}, {id: 'xml', label: 'MusicXML'}]});
    const group = host.querySelector<HTMLElement>('[part="exports"]')!;
    expect(group.getAttribute('role')).toBe('group');
    expect(group.getAttribute('aria-label')).toBe('Export take');
    const buttons = [...group.querySelectorAll('button')];
    expect(buttons.map((button) => button.getAttribute('aria-label'))).toEqual(['Download MIDI', 'Download MusicXML']);
    expect(host.querySelector<HTMLElement>('[part="meter"]')!.hidden).toBe(true);
    host.style.width = '180px';
    hasLevel = true;
    handle.update();
    expect([...group.querySelectorAll('button')]).toEqual(buttons);
    expect(host.querySelector<HTMLElement>('[part="meter"]')!.hidden).toBe(false);
    expect(host.querySelector('[part="status"]')?.textContent).toBe(longStatus);
    buttons.forEach((button) => button.click());
    expect(exportTake.mock.calls).toEqual([['mid'], ['xml']]);
    handle.destroy();
  });

  it('paints the level as a fraction of the meter', () => {
    const host = document.createElement('div');
    const handle = mountRecorder(host, binding());
    const level = host.querySelector<HTMLElement>('.wui-recorder__level')!;

    expect(level.style.getPropertyValue('--wui-recorder-level')).toBe('0.5');
    handle.destroy();
  });

  it('never writes a non-numeric level into the published custom property', () => {
    const host = document.createElement('div');
    // `??` catches null and undefined; `Math.min(1, NaN)` is NaN, so the old
    // inline clamp wrote the literal string "NaN" into a property its own
    // stylesheet reads through `scaleX(var(--wui-recorder-level, 0))`.
    const handle = mountRecorder(host, binding({
      snapshot: () => ({recording: false, playing: false, takeCount: 1, level: Number.NaN}),
    }));
    const level = host.querySelector<HTMLElement>('.wui-recorder__level')!;

    expect(level.style.getPropertyValue('--wui-recorder-level')).toBe('0');
    handle.destroy();
  });

  it('clamps a level from outside 0…1', () => {
    const host = document.createElement('div');
    const handle = mountRecorder(host, binding({
      snapshot: () => ({recording: false, playing: false, takeCount: 1, level: 4}),
    }));
    expect(
      host.querySelector<HTMLElement>('.wui-recorder__level')!.style.getPropertyValue('--wui-recorder-level'),
    ).toBe('1');
    handle.destroy();
  });

  it('routes a command through the binding and repaints', async () => {
    const host = document.createElement('div');
    const toggleRecording = vi.fn();
    const handle = mountRecorder(host, binding({toggleRecording}));

    host.querySelector<HTMLButtonElement>('.wui-recorder__record')!.click();
    expect(toggleRecording).toHaveBeenCalledTimes(1);

    handle.destroy();
    expect(host.querySelector('.wui-recorder')).toBeNull();
  });

  it('installs its stylesheet, and skips it for a light-DOM host', () => {
    const withSheet = document.createElement('div');
    mountRecorder(withSheet, binding()).destroy();

    const without = document.createElement('div');
    const handle = mountRecorder(without, binding(), {stylesheet: false});
    expect(without.querySelector('style')).toBeNull();
    expect(without.querySelector('.wui-recorder')).not.toBeNull();
    handle.destroy();
  });
});
