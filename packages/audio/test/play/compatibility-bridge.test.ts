// @vitest-environment jsdom

import {describe, expect, it} from 'vitest';
import {AudioMixerElement} from '../../src/play/element/audio-mixer';
import {AudioPlayerElement} from '../../src/play/element/audio-player';
import {AudioPlaylistElement} from '../../src/play/element/audio-playlist';
import {AudioRecorderElement} from '../../src/play/element/audio-recorder';
import {AudioMeterElement} from '../../src/analyze/element/audio-meter';

/**
 * An element's `--wa*-*` variables are a promise to the caller, and the kit
 * presenter they bridge onto paints its own nodes. A bridge that sets a
 * PROPERTY only reaches nodes the presenter left alone: the kit gives the clock,
 * the button glyph and every mixer label their own colour rule, and it paints
 * the seek fill from a token. So a bridge has to set the presenter's TOKENS.
 *
 * All three of these were verified dead in a browser before the fix — setting
 * the variable changed nothing on screen — and verified live after it.
 */
const MIXER_TAG = 'audio-mixer-bridge-test';
const PLAYER_TAG = 'audio-player-bridge-test';
const PLAYLIST_TAG = 'audio-playlist-surface-test';
const RECORDER_TAG = 'audio-recorder-surface-test';
const METER_TAG = 'audio-meter-surface-test';
customElements.define(MIXER_TAG, AudioMixerElement);
customElements.define(PLAYER_TAG, AudioPlayerElement);
customElements.define(PLAYLIST_TAG, AudioPlaylistElement);
customElements.define(RECORDER_TAG, AudioRecorderElement);
customElements.define(METER_TAG, AudioMeterElement);

function sheet(element: HTMLElement): string {
  return [...(element.shadowRoot?.querySelectorAll('style') ?? [])]
    .map((node) => node.textContent ?? '')
    .join('');
}

function parsedSurfaceRule(element: HTMLElement, purpose: string): CSSStyleDeclaration {
  const style = [...(element.shadowRoot?.querySelectorAll('style') ?? [])].find((candidate) =>
    candidate.textContent?.includes(`--wm-${purpose}-surface-background`),
  );
  const parser = document.createElement('style');
  parser.textContent = style?.textContent ?? '';
  document.head.append(parser);
  const rule = [...(parser.sheet?.cssRules ?? [])].find(
    (candidate) =>
      candidate.type === CSSRule.STYLE_RULE &&
      (candidate as CSSStyleRule).style.getPropertyValue('background') !== '',
  ) as CSSStyleRule | undefined;
  parser.remove();
  if (!rule) throw new Error(`surface rule for ${purpose} did not parse`);
  return rule.style;
}

describe('element CSS-variable bridges feed presenter tokens', () => {
  it('<audio-mixer> routes --wam-fg to the label token, not just the root colour', () => {
    const element = document.createElement(MIXER_TAG);
    document.body.append(element);

    // The presenter consumes its private bridge without redeclaring the public
    // token, so the caller can still theme --wm-mixer-text on an ancestor.
    expect(sheet(element)).toContain('--wui-mixer-text:var(--wam-fg');
    expect(sheet(element)).toContain('--wui-mixer-fill:var(--wam-accent');
    expect(sheet(element)).toContain(
      '--wui-mixer-track-border:var(--wam-track-border,var(--wm-mixer-track-border,var(--wm-control-border,var(--wm-border,#d8d8d8))))',
    );

    element.remove();
  });

  it('<audio-player> routes --wap-fg to text and glyph, and --wap-accent to the fill', () => {
    const element = document.createElement(PLAYER_TAG);
    document.body.append(element);
    const css = sheet(element);

    expect(css).toContain('--cp-text:var(--wap-fg');
    expect(css).toContain('--cp-button-color:var(--wap-fg');
    // `--wm-transport-accent` has no reader anywhere in @webmusic/ui; the fill
    // token is the one the seek gradient reads.
    expect(css).toContain('--cp-fill:var(--wap-accent');
    expect(css).not.toContain('--wm-transport-accent');

    element.remove();
  });

  it('gives every visible play element one light canonical presenter surface', () => {
    const cases = [
      [PLAYER_TAG, 'audio-player', 'transport'],
      [PLAYLIST_TAG, 'audio-playlist', 'playlist'],
      [MIXER_TAG, 'audio-mixer', 'mixer'],
      [RECORDER_TAG, 'audio-recorder', 'recorder'],
      [METER_TAG, 'audio-meter', 'meter'],
    ] as const;

    for (const [tag, purpose, presenter] of cases) {
      const element = document.createElement(tag);
      document.body.append(element);
      const css = sheet(element);

      expect(css).toContain(`--wm-${purpose}-surface-background`);
      expect(css).toContain(`--wm-${presenter}-surface-background`);
      expect(css).toContain('--wm-component-background');
      expect(css).toContain('var(--wm-surface,#fff)');
      expect(css).toContain(`--wm-${purpose}-surface-border`);
      expect(css).toContain('1px solid var(--wm-border,#d8d8d8)');
      expect(css).toContain(`--wm-${purpose}-surface-padding`);
      expect(css).toContain('--wm-component-padding,.6rem');
      expect(css).not.toContain('#15171c');
      expect(css).not.toContain('#2a2e37');
      const parsed = parsedSurfaceRule(element, purpose);
      expect(parsed.getPropertyValue('background')).toContain(`--wm-${purpose}-surface-background`);
      expect(parsed.getPropertyValue('border')).toContain(`--wm-${purpose}-surface-border`);
      expect(parsed.getPropertyValue('padding')).toContain(`--wm-${purpose}-surface-padding`);
      element.remove();
    }
  });

  it('keeps action and track styling separate from outer chrome', () => {
    const player = document.createElement(PLAYER_TAG);
    const recorder = document.createElement(RECORDER_TAG);
    const meter = document.createElement(METER_TAG);
    document.body.append(player, recorder, meter);

    expect(sheet(player)).toContain('min-height:var(--wap-height,44px);height:auto');
    expect(sheet(recorder)).toContain('--wui-recorder-track:var(--war-track');
    expect(sheet(recorder)).toContain(
      '--wui-recorder-button-border:var(--war-button-border,var(--wm-recorder-button-border,var(--wm-control-border,var(--wm-border,#d8d8d8))))',
    );
    expect(sheet(recorder)).not.toContain('--wm-recorder-border:var(--war-track');
    expect(sheet(recorder)).not.toContain('--wm-recorder-button:var(--war-track');
    expect(sheet(meter)).toContain('var(--wameter-track, var(--wm-meter-track,');
    expect(parsedSurfaceRule(meter, 'audio-meter').getPropertyValue('--wm-meter-track')).toBe('');

    const playlist = document.createElement(PLAYLIST_TAG);
    document.body.append(playlist);
    expect(sheet(playlist)).toContain('--wui-playlist-primary-background:var(--wapl-accent');
    expect(sheet(playlist)).toContain('--wui-playlist-primary-border:var(--wapl-accent');
    expect(sheet(playlist)).toContain('--wui-playlist-primary-foreground:var(--wapl-bg');
    expect(sheet(playlist)).not.toContain('--wm-playlist-button:var(--wapl-accent');
    expect(sheet(playlist)).not.toContain('--wm-playlist-button-border:var(--wapl-accent');
    expect(sheet(playlist)).not.toContain('--wm-playlist-button-text:var(--wapl-bg');

    player.remove();
    recorder.remove();
    meter.remove();
    playlist.remove();
  });
});
