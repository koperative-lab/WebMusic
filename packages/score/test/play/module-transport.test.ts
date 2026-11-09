// @vitest-environment jsdom
import {afterEach, describe, expect, it, vi} from 'vitest';
import {SessionTransport} from '@webmusic/kernel/session';
import {mountModuleTransport, setModuleTransportVisibility} from '../../src/play/element/internal/module-transport';

describe('Session transport control', () => {
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it('redraws its clock frame by frame while the Session runs', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('requestAnimationFrame', undefined);
    let now = 0;
    const session = new SessionTransport(() => now);
    const container = document.createElement('div');
    document.body.append(container);
    const handle = mountModuleTransport(container, session, undefined, {
      visible: true, time: 'simple', volume: 'off', getVolume: () => 1, onVolumeChange: () => {}, onError: (error) => { throw error; },
    });
    const elapsed = () => container.querySelector('.wui-transport__time-elapsed')?.textContent;
    await session.play();
    vi.advanceTimersByTime(20);
    expect(elapsed()).toBe('0:00');
    // The Session publishes state changes only; the readout must follow the
    // clock frame by frame between them.
    for (const [seconds, label] of [[3.2, '0:03'], [5.4, '0:05'], [7.6, '0:07']] as const) {
      now = seconds;
      vi.advanceTimersByTime(20);
      expect(elapsed()).toBe(label);
    }
    await session.pause();
    const paused = elapsed();
    now = 9;
    vi.advanceTimersByTime(100);
    expect(elapsed()).toBe(paused);
    handle.destroy();
    session.dispose();
    container.remove();
  });

  it('restores an inline display when a hidden transport is shown again', () => {
    const element = document.createElement('div');
    element.style.display = 'flex';
    setModuleTransportVisibility(element, false);
    expect(element.hidden).toBe(true);
    expect(element.style.display).toBe('none');
    setModuleTransportVisibility(element, true);
    expect(element.hidden).toBe(false);
    expect(element.style.display).toBe('flex');
  });
});
