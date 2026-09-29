// @vitest-environment jsdom

import {describe, expect, it, vi} from 'vitest';
import {AudioMixerElement} from '../../src/play/element/audio-mixer';
import {AudioRecorderElement} from '../../src/play/element/audio-recorder';

/**
 * The presenter handle's destroy() removes only the presenter's own nodes, so
 * the element-level compatibility <style> has to be created once and
 * re-appended. Creating a fresh one per render grew the shadow root without
 * bound: render() runs twice per connect and again on every property write, so
 * a reactive framework re-assigning props leaked one node per update.
 *
 * The presenter contributes styles of its own, so what matters is that the
 * total does not GROW across renders — not its absolute value.
 */
const MIXER_TAG = 'audio-mixer-style-test';
const RECORDER_TAG = 'audio-recorder-style-test';
customElements.define(MIXER_TAG, AudioMixerElement);
customElements.define(RECORDER_TAG, AudioRecorderElement);

function styleCount(element: HTMLElement): number {
  return element.shadowRoot?.querySelectorAll('style').length ?? 0;
}

describe('element compatibility style reuse', () => {
  it('does not accumulate style nodes in <audio-mixer> across property writes', () => {
    const element = document.createElement(MIXER_TAG) as AudioMixerElement;
    document.body.append(element);
    const baseline = styleCount(element);
    expect(baseline).toBeGreaterThan(0);

    for (let i = 0; i < 5; i++) element.members = undefined;

    expect(styleCount(element)).toBe(baseline);
    element.remove();
  });

  it('does not accumulate style nodes in <audio-recorder> across reconnects', () => {
    const element = document.createElement(RECORDER_TAG) as AudioRecorderElement;
    document.body.append(element);
    const baseline = styleCount(element);
    expect(baseline).toBeGreaterThan(0);

    for (let i = 0; i < 5; i++) {
      element.remove();
      document.body.append(element);
    }

    expect(styleCount(element)).toBe(baseline);
    element.remove();
  });

  it('drops per-member state when the membership is replaced', () => {
    const element = document.createElement(MIXER_TAG) as AudioMixerElement;
    document.body.append(element);

    // Exercise the public owner: reusing a member id must not inherit the
    // departed mixer's gain/mute/solo state in the newly selected membership.
    const player = {
      play: vi.fn(), pause: vi.fn(), stop: vi.fn(), seek: vi.fn(),
      setVolume: vi.fn(), on: () => () => {},
    };
    element.members = [{id: 'vocal', player}];
    const previous = element.mixer!;
    previous.setVolume('vocal', 0.2);
    previous.mute('vocal');
    previous.solo('vocal');

    element.members = undefined;
    expect(element.mixer).toBeUndefined();
    expect(previous.ids()).toEqual([]);
    element.members = [{id: 'vocal', player, volume: 0.7}];
    expect(element.mixer).not.toBe(previous);
    expect(element.mixer!.snapshot().members).toEqual([
      {id: 'vocal', volume: 0.7, muted: false, solo: false, effectiveVolume: 0.7},
    ]);

    element.remove();
  });
});
