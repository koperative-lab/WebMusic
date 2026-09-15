// @vitest-environment jsdom

import {afterEach, describe, expect, it, vi} from 'vitest';
import {Duration, Pitch, Rational, ScoreBuilder, VoiceId, type Score} from '../../src/core';
import {defineSimpleScorePlayerElement, type SimpleScorePlayerElement} from '../../src/play/element/score-player';
import {mountPresetPlayer, type PresetPlayerHandle} from '../../src/play/element/internal/preset-player';
import {defineChordAnalysisElement} from '../../src/analyze/element/chord-analysis';
import * as playbackEvents from '../../src/play/headless/playback-events';

defineSimpleScorePlayerElement();
defineChordAnalysisElement();
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const handles: PresetPlayerHandle[] = [];

function music(): Score {
  const builder = new ScoreBuilder();
  const part = builder.newPartId();
  builder.addPart({id: part, name: 'Piano'});
  ['C4', 'E4', 'G4', 'C5', 'C4', 'E4', 'G4', 'C5'].forEach((pitch, index) => {
    builder.addNote(part, {
      id: builder.newNoteId(), pitch: Pitch.parse(pitch), onsetQuarters: new Rational(index),
      duration: Duration.quarter(), voice: VoiceId('melody'),
    });
  });
  return builder.build();
}

async function nativePlayer() {
  const owner = document.createElement('simple-score-player') as SimpleScorePlayerElement;
  owner.id = 'native-seek-owner';
  owner.score = music();
  owner.rate = 2;
  document.body.append(owner);
  const follower = document.createElement('chord-analysis');
  follower.setAttribute('player', '#native-seek-owner');
  follower.setAttribute('motion', 'stepped');
  document.body.append(follower);
  await flush();
  const slider = owner.querySelector<HTMLElement>('[role="slider"]')!;
  expect(slider).not.toBeNull();
  return {owner, follower, slider};
}

const home = (slider: Element) => slider.dispatchEvent(new KeyboardEvent('keydown', {key: 'Home', bubbles: true}));

afterEach(() => {
  document.body.replaceChildren();
  for (const handle of handles.splice(0)) handle.destroy();
  vi.restoreAllMocks();
});

describe('native preset seek controls', () => {
  it('keeps shared state styling through control swaps and removes it with the facade', () => {
    const container = document.createElement('div');
    document.body.append(container);
    const handle = mountPresetPlayer(music(), container, {volumeControl: 'fader'});
    handles.push(handle);
    const style = container.querySelector<HTMLStyleElement>('style[data-webmusic-ui="transport-state"]')!;
    expect(style).not.toBeNull();
    expect(style.textContent).toContain(':focus-visible');
    expect(style.textContent).not.toContain(':host');
    const play = handle.button;
    handle.setChrome({volume: 'knob', time: 'full'});
    expect(container.querySelector('style[data-webmusic-ui="transport-state"]')).toBe(style);
    expect(handle.button).toBe(play);
    handle.destroy();
    expect(style.isConnected).toBe(false);
  });

  it('restores the UIKit clock layout when optional time controls change in place', async () => {
    const {owner} = await nativePlayer();
    const time = owner.querySelector<HTMLElement>('.wui-transport__time')!;
    expect(time.style.display).toBe('none');
    for (const mode of ['full', 'off', 'simple', 'full']) {
      owner.setAttribute('time-control', mode);
      expect(owner.querySelector('.wui-transport__time')).toBe(time);
      expect(time.style.display).toBe(mode === 'off' ? 'none' : 'flex');
    }
  });

  it('publishes one seek and a fresh state when keyboard Home resets the chord cursor', async () => {
    const {owner, follower, slider} = await nativePlayer();
    await owner.seekNominal(1);
    expect(follower.querySelector('[role="slider"]')?.getAttribute('aria-valuenow')).toBe('1');
    const seeks = vi.fn();
    const states = vi.fn();
    owner.addEventListener('webscore:seek', seeks);
    owner.addEventListener('webscore:statechange', states);

    home(slider);

    expect(seeks).toHaveBeenCalledOnce();
    expect(states).toHaveBeenCalledOnce();
    expect((states.mock.calls[0]![0] as CustomEvent).detail).toMatchObject({nominalSeconds: 0, rate: 2, playing: false});
    expect(follower.querySelector('[role="slider"]')?.getAttribute('aria-valuenow')).toBe('0');
    expect(owner.getPlaybackSnapshot()?.nominalSeconds).toBe(0);
    await flush();
    expect(seeks).toHaveBeenCalledOnce();
  });

  it('commits a pointer scrub once on release and reports the rate-correct snapshot', async () => {
    const {owner, follower, slider} = await nativePlayer();
    vi.spyOn(slider, 'getBoundingClientRect').mockReturnValue({left: 0, top: 0, width: 100, height: 20} as DOMRect);
    const seeks = vi.fn();
    owner.addEventListener('webscore:seek', seeks);
    slider.dispatchEvent(new MouseEvent('pointerdown', {clientX: 25, button: 0, bubbles: true}));
    slider.dispatchEvent(new MouseEvent('pointermove', {clientX: 75, button: 0, bubbles: true}));
    expect(seeks).not.toHaveBeenCalled();
    expect(follower.querySelector('[role="slider"]')?.getAttribute('aria-valuenow')).toBe('0');
    slider.dispatchEvent(new MouseEvent('pointerup', {clientX: 75, button: 0, bubbles: true}));
    await flush();
    expect(seeks).toHaveBeenCalledOnce();
    expect(owner.getPlaybackSnapshot()).toMatchObject({nominalSeconds: 3, transportSeconds: 1.5, progress: 0.75, rate: 2, playing: false});
    expect(follower.querySelector('[role="slider"]')?.getAttribute('aria-valuenow')).toBe('3');
  });

  it('keeps public seek methods at one event each', async () => {
    const {owner} = await nativePlayer();
    const seeks = vi.fn();
    owner.addEventListener('webscore:seek', seeks);
    owner.seek(0.25);
    expect(seeks).toHaveBeenCalledTimes(1);
    owner.seekFraction(0.5);
    expect(seeks).toHaveBeenCalledTimes(2);
    await owner.seekNominal(1);
    expect(seeks).toHaveBeenCalledTimes(3);
  });

  it.each(['replace', 'detach'] as const)('does not publish old state after a seek listener causes %s', async (action) => {
    const {owner, slider} = await nativePlayer();
    const states = vi.fn();
    owner.addEventListener('webscore:statechange', states);
    owner.addEventListener('webscore:seek', () => {
      if (action === 'replace') owner.score = music();
      else owner.remove();
    }, {once: true});
    home(slider);
    expect(states).not.toHaveBeenCalled();
    await flush();
    if (action === 'detach') expect(states).not.toHaveBeenCalled();
    else expect(owner.resolvedScore).toBe(owner.score);
  });

  it('skips notification when a synchronous cursor callback destroys the facade', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const onSeek = vi.fn();
    const handle: PresetPlayerHandle = mountPresetPlayer(music(), container, {onSeek, onCursor: () => handle.destroy()});
    handles.push(handle);
    home(handle.progress);
    await flush();
    expect(onSeek).not.toHaveBeenCalled();
  });

  it('contains an async seek rejection even when its notification callback also throws', async () => {
    const reported = vi.spyOn(playbackEvents, 'reportPlaybackOperationFailure').mockImplementation(() => {});
    const container = document.createElement('div');
    document.body.append(container);
    const callbackFailure = new Error('seek notification failed');
    const operationFailure = new Error('seek restart failed');
    const onSeek = vi.fn(() => { throw callbackFailure; });
    const handle = mountPresetPlayer(music(), container, {onSeek});
    handles.push(handle);
    vi.spyOn(handle.player!, 'seekFraction').mockRejectedValueOnce(operationFailure);
    home(handle.progress);
    await flush();
    expect(onSeek).toHaveBeenCalledOnce();
    expect(reported).toHaveBeenCalledWith('PresetPlayer', 'onSeek callback', callbackFailure);
    expect(reported).toHaveBeenCalledWith('PresetPlayer', 'transport presenter', operationFailure);
  });
});
