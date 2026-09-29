// @vitest-environment jsdom

import {describe, expect, it} from 'vitest';
import {
  AudioLiveViewElement,
  AudioMeterElement,
  AudioViewElement,
  defineAllAudioElements,
} from '../../src/view/element/index';

describe('Audio View element registration', () => {
  it('registers the retained View tags and leaves retired tags undefined', () => {
    const retained = [
      ['audio-view', AudioViewElement],
      ['audio-live-view', AudioLiveViewElement],
      ['audio-meter', AudioMeterElement], // Legacy View entry for the Analyze meter.
    ] as const;
    const retired = ['audio-clip-thumbnail', 'audio-minimap', 'audio-region-list'] as const;

    for (const [tag] of retained) expect(customElements.get(tag)).toBeUndefined();
    for (const tag of retired) expect(customElements.get(tag)).toBeUndefined();

    defineAllAudioElements();

    for (const [tag, element] of retained) expect(customElements.get(tag)).toBe(element);
    for (const tag of retired) expect(customElements.get(tag)).toBeUndefined();

    // Importers may call the explicit registration path more than once.
    expect(() => defineAllAudioElements()).not.toThrow();
    for (const [tag, element] of retained) expect(customElements.get(tag)).toBe(element);
  });
});
