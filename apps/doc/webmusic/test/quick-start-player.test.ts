// @vitest-environment jsdom
import {readFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {defineScorePlayerElement, type ScorePlayerElement} from '@webmusic/score/play/element';
import {definePitchViewElement, defineScoreViewElement, type ScoreViewElement} from '@webmusic/score/view/element';
import {mountQuickStartStatus} from '../src/components/quick-start-player-client';

defineScorePlayerElement();
defineScoreViewElement();
definePitchViewElement();

const fixture = new Uint8Array(readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../public/mxl/demo.mxl')));
const cleanups: Array<() => void> = [];

function mount() {
  document.body.innerHTML = `
    <score-player id="piece"></score-player>
    <p role="status"></p>
    <score-view player="#piece" type="staff"></score-view>
    <pitch-view player="#piece" type="keyboard" low="48" high="84" fit-to-width="true" white-key-height="128" black-key-height="80"></pitch-view>`;
  const player = document.querySelector<ScorePlayerElement>('score-player')!;
  const status = document.querySelector<HTMLElement>('[role="status"]')!;
  const detach = mountQuickStartStatus(player, status);
  cleanups.push(detach);
  return {player, status, detach};
}

beforeEach(() => {
  // jsdom has no SVG text metrics; the MXL contains text and dynamic marks.
  const previous = Object.getOwnPropertyDescriptor(SVGElement.prototype, 'getBBox');
  Object.defineProperty(SVGElement.prototype, 'getBBox', {configurable: true, value(this: SVGElement) {
    if (this.tagName.toLowerCase() !== 'text') throw new Error('jsdom does not measure SVG geometry');
    return new DOMRect(0, 0, (this.textContent?.length ?? 0) * 8, 16);
  }});
  cleanups.push(() => {
    if (previous) Object.defineProperty(SVGElement.prototype, 'getBBox', previous);
    else Reflect.deleteProperty(SVGElement.prototype, 'getBBox');
  });
});

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Quick Start with native public elements', () => {
  it('shows a failed file load and recovers when its source is replaced', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response('Missing', {status: 404, statusText: 'Not Found'}))
      .mockResolvedValueOnce(new Response(fixture));
    vi.stubGlobal('fetch', fetch);
    const {player, status} = mount();
    player.setAttribute('src', '/missing.musicxml');
    expect(status.textContent).toBe('Loading score…');
    expect(status.hidden).toBe(false);
    await vi.waitFor(() => expect(status.textContent).toContain('404 Not Found'));
    expect(status.hidden).toBe(false);

    player.setAttribute('src', '/demo.mxl');
    await vi.waitFor(() => expect(player.playback.snapshot().readiness).toBe('ready'));
    expect(status.hidden).toBe(true);
    expect(status.textContent).toBe('');
    const score = player.playback.snapshot().score!;
    expect([...score.allNotes()]).toHaveLength(384);
    expect(score.durationSeconds).toBeCloseTo(32);
    const view = document.querySelector<ScoreViewElement>('score-view')!;
    await vi.waitFor(() => expect(view.score).toBe(score));
    await vi.waitFor(() => expect(view.querySelector('svg')).not.toBeNull());
    expect(document.querySelector('pitch-view [data-midi="48"]')).not.toBeNull();
    expect(document.querySelector('pitch-view [data-midi="84"]')).not.toBeNull();
    expect(document.querySelectorAll('pitch-view [data-midi]')).toHaveLength(37);
    expect(document.querySelector<HTMLElement>('pitch-view [part~="board"]')!.style.height).toBe('128px');
    expect(document.querySelector<HTMLElement>('pitch-view [data-midi="49"]')!.style.height).toBe('80px');
    await player.seekNominal(2.4);
    expect(view.currentTime).toBeCloseTo(2.4);
    expect(fetch).toHaveBeenCalledTimes(2); // Views reuse the player's parsed file.
  });

  it('keeps playback errors visible across position updates and detaches cleanly', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(fixture)));
    const {player, status, detach} = mount();
    player.setAttribute('src', '/demo.mxl');
    await vi.waitFor(() => expect(player.playback.snapshot().readiness).toBe('ready'));
    player.dispatchEvent(new CustomEvent('webscore:error', {detail: {error: new Error('Audio unavailable')}}));
    await player.seekNominal(2.4);
    expect(status.textContent).toBe('Playback failed: Audio unavailable');
    expect(status.hidden).toBe(false);

    detach();
    player.dispatchEvent(new CustomEvent('webscore:error', {detail: {error: new Error('Late failure')}}));
    player.removeAttribute('src');
    expect(status.textContent).toBe('Playback failed: Audio unavailable');
  });
});
