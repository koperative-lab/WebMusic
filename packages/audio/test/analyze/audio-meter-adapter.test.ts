// @vitest-environment jsdom
import {describe, expect, it} from 'vitest';
import {
  AudioMeterElement as AnalyzeAudioMeterElement,
  defineAudioMeterElement as defineAnalyzeAudioMeterElement,
} from '../../src/analyze/element/audio-meter';
import {
  AudioMeterElement as ViewAudioMeterElement,
  defineAudioMeterElement as defineViewAudioMeterElement,
} from '../../src/view/element/audio-meter';

describe('audio-meter Analyze compatibility entry', () => {
  it('uses one Element class and idempotent registration across both entries', () => {
    expect(AnalyzeAudioMeterElement).toBe(ViewAudioMeterElement);
    expect(defineAnalyzeAudioMeterElement).toBe(defineViewAudioMeterElement);

    defineAnalyzeAudioMeterElement();
    expect(customElements.get('audio-meter')).toBe(ViewAudioMeterElement);
    expect(() => defineViewAudioMeterElement()).not.toThrow();
    expect(document.createElement('audio-meter')).toBeInstanceOf(AnalyzeAudioMeterElement);
  });
});
