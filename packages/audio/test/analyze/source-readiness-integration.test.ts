// @vitest-environment jsdom

import {afterEach, beforeAll, beforeEach, describe, expect, it, vi} from 'vitest';
import {createAudioClip} from '../../src/core';
import {defineAllAudioElements as defineAnalyze} from '../../src/analyze/element';
import {defineAllAudioElements as defineViews} from '../../src/view/element';
import {AudioPlayerElement, defineAudioPlayerElement} from '../../src/play/element/audio-player';

const tags = ['audio-meter', 'audio-level-analyzer', 'audio-spectrum-analyzer',
  'audio-oscilloscope', 'audio-transient-analyzer', 'audio-view', 'audio-live-view'] as const;

beforeAll(() => { defineAnalyze(); defineViews(); defineAudioPlayerElement(); });
beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(1);
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
});
afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); });

describe.each(tags)('%s native player readiness', (tag) => {
  it('follows a late owner through external preparation, empty source and a loaded source without Web Audio support', async () => {
    const follower = document.createElement(tag);
    const attribute = 'input';
    follower.setAttribute(attribute, '#native-readiness-owner');
    document.body.append(follower);
    const status = (): HTMLElement | null => (follower.shadowRoot ?? follower).querySelector('.wui-status');
    expect(status()?.dataset.kind).toBe('waiting');

    const owner = document.createElement('audio-player') as AudioPlayerElement;
    owner.id = 'native-readiness-owner';
    owner.loading = true;
    document.body.append(owner);
    await Promise.resolve();
    expect(status()?.dataset.kind).toBe('loading');
    expect(status()?.getAttribute('aria-busy')).toBe('true');
    owner.loading = false;
    expect(status()?.dataset.kind).toBe('waiting');
    expect(status()?.hasAttribute('aria-busy')).toBe(false);

    owner.loading = true;
    owner.clip = createAudioClip({sampleRate: 100, channelData: [new Float32Array(100)]});
    expect(status()?.dataset.kind).toBe('loading');
    owner.loading = false;
    expect(status()?.dataset.kind).not.toBe('loading');
    expect(status()?.hasAttribute('aria-busy')).not.toBe(true);
    // Data-only views can draw now. The live projection requests the player's
    // analyser; without Web Audio it must expose failure, never stay loading.
    // The meter taps a module port and never prepares the source (DEC-068), so
    // it waits for playback. Detailed inspectors remain paused until then.
    if (tag === 'audio-view') expect(status()).toBeNull();
    else if (tag === 'audio-live-view') expect(status()?.dataset.kind).toBe('error');
    else if (tag === 'audio-meter') expect(status()?.dataset.kind).toBe('waiting');
    else expect(status()?.hidden).toBe(true);
    expect(owner.player?.clock).toBeUndefined();

    owner.clip = undefined;
    expect(status()?.dataset.kind).toBe('waiting');
    follower.removeAttribute(attribute);
    owner.loading = true;
    expect(status()?.dataset.kind).toBe('waiting');
    follower.remove();
    owner.loading = false;
    expect((follower.shadowRoot ?? follower).querySelector('.wui-status')).toBeNull();
  });
});
