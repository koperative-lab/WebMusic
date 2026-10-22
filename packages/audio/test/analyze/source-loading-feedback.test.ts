// @vitest-environment jsdom
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {defineAllAudioElements} from '../../src/analyze/element';

defineAllAudioElements();
beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});
afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe.each(['audio-level-analyzer', 'audio-spectrum-analyzer', 'audio-oscilloscope', 'audio-transient-analyzer'])('%s source feedback', (tag) => {
  it('follows pending and failed source work without calling a paused source loading', () => {
    const source = Object.assign(document.createElement('div'), {
      loading: true, playing: false, loadError: undefined as Error | undefined,
    });
    source.id = 'pending-source';
    const element = document.createElement(tag);
    element.setAttribute('player', '#pending-source');
    document.body.append(source, element);
    const feedback = () => element.querySelector<HTMLElement>('.wui-status')!;
    expect(feedback().dataset.kind).toBe('loading');
    expect(feedback().getAttribute('aria-busy')).toBe('true');

    source.loading = false;
    source.loadError = new Error('The audio file could not be decoded');
    source.dispatchEvent(new CustomEvent('webaudio:loadstatechange'));
    expect(feedback().hasAttribute('aria-busy')).toBe(false);
    expect(feedback().dataset.kind).not.toBe('waiting');
    expect(element.textContent).toMatch(/could not be decoded|unavailable/i);

    source.loadError = undefined;
    source.dispatchEvent(new CustomEvent('webaudio:loadstatechange'));
    expect(feedback().hidden).toBe(true);
    const diagnostic = element.querySelector<HTMLElement>('[role="status"]')!;
    expect(diagnostic.hidden).toBe(true);
    expect(diagnostic.textContent).toBe('');
    expect(element.querySelector('button')?.textContent).toBe('Freeze');

    Object.assign(source, {clip: undefined});
    source.dispatchEvent(new CustomEvent('webaudio:sourcechange'));
    expect(feedback().dataset.kind).toBe('waiting');

    element.removeAttribute('player');
    expect(feedback().dataset.kind).toBe('waiting');
    source.loading = true;
    source.dispatchEvent(new CustomEvent('webaudio:loadstatechange'));
    expect(feedback().dataset.kind).toBe('waiting');
  });
});
