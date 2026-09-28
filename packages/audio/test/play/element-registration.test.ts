// @vitest-environment jsdom

import {describe, expect, it} from 'vitest';
import * as play from '../../src/play/element/index';

// Exercise the same side effect and exports shipped by the auto/global entries.
import * as auto from '../../src/play/element/auto';

describe('Audio Play registration', () => {
  it('registers only the current Play family and remains idempotent', () => {
    expect(() => play.defineAllAudioElements()).not.toThrow();
    expect(customElements.get('audio-player')).toBe(play.AudioPlayerElement);
    expect(customElements.get('audio-playlist')).toBe(play.AudioPlaylistElement);
    expect(customElements.get('audio-mixer')).toBe(play.AudioMixerElement);
    expect(customElements.get('audio-recorder')).toBe(play.AudioRecorderElement);
    expect(customElements.get('audio-clip-player')).toBeUndefined();
    expect(customElements.get('audio-clip-recorder')).toBeUndefined();
    expect(customElements.get('audio-meter')).toBeUndefined();
  });

  it('does not expose retired Element aliases through either public entry', () => {
    for (const entry of [play, auto]) {
      for (const name of [
        'AudioClipPlayerElement', 'defineAudioClipPlayerElement',
        'AudioClipRecorderElement', 'defineAudioClipRecorderElement',
        'AudioMeterElement', 'defineAudioMeterElement',
      ]) expect(entry).not.toHaveProperty(name);
    }
  });
});
