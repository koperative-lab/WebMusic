// @vitest-environment jsdom

import {afterEach, beforeAll, beforeEach, describe, expect, it, vi} from 'vitest';
import {createAudioClip, type AudioClip, type AudioPeaks} from '../../src/core';
import type {AudioViewport, WaveformRenderOptions} from '../../src/view/core/types';

const mocks = vi.hoisted(() => ({waveform: vi.fn(), spectrogram: vi.fn(), meter: vi.fn()}));
vi.mock('../../src/view/render/waveform', () => ({renderWaveformVisualizer: mocks.waveform}));
vi.mock('../../src/view/render/spectrogram-view', () => ({renderSpectrogramVisualizer: mocks.spectrogram}));
vi.mock('../../src/view/render/meter', () => ({renderLoudnessMeter: mocks.meter}));

import {AudioViewElement, defineAudioViewElement} from '../../src/view/element/audio-view';

const frames = new Map<number, FrameRequestCallback>();
let frameId = 0;
let fixtureId = 0;

beforeAll(() => defineAudioViewElement('drag-audio-view'));
beforeEach(() => {
  frames.clear();
  frameId = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    const id = ++frameId;
    frames.set(id, callback);
    return id;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  mocks.waveform.mockImplementation((_host: HTMLElement, _peaks: AudioPeaks, options: WaveformRenderOptions) =>
    fakeVisualizer(options),
  );
  mocks.spectrogram.mockImplementation((_host: HTMLElement, _data: unknown, options: WaveformRenderOptions) =>
    fakeVisualizer(options),
  );
  mocks.meter.mockImplementation(() => fakeVisualizer({}));
});
afterEach(() => {
  document.body.replaceChildren();
  mocks.waveform.mockReset();
  mocks.spectrogram.mockReset();
  mocks.meter.mockReset();
  vi.unstubAllGlobals();
});

describe('<audio-view> drag modes', () => {
  it('defaults to legacy absolute seek and reflects a selected mode', () => {
    const {view, player, surface} = mount();
    expect(view.dragMode).toBe('seek');
    pointer(surface, 'pointerdown', 50);
    expect(player.seek).toHaveBeenLastCalledWith(0.5);
    pointer(surface, 'pointermove', 100);
    expect(player.seek).toHaveBeenLastCalledWith(1);
    pointer(surface, 'pointerup', 100);

    view.dragMode = 'scrub';
    expect(view.getAttribute('drag-mode')).toBe('scrub');
    expect(view.dragMode).toBe('scrub');
    view.setAttribute('drag-mode', 'unknown');
    expect(view.dragMode).toBe('seek');
  });

  it('scrubs relatively from the initial position, coalescing motion and flushing release', () => {
    const {player, source, surface} = mount({'drag-mode': 'scrub'});
    pointer(surface, 'pointerdown', 100);
    expect(player.seek).not.toHaveBeenCalled();
    pointer(surface, 'pointermove', 120);
    pointer(surface, 'pointermove', 150);
    expect(player.seek).not.toHaveBeenCalled();

    // Playback advances while the pointer is held. The gesture keeps its own
    // initial position; it must not compound against each new player sample.
    player.seconds = 12;
    source.dispatchEvent(new CustomEvent('webaudio:timeupdate', {detail: {seconds: 12, duration: 20}}));
    flushFrame();
    expect(player.seek).toHaveBeenCalledTimes(1);
    expect(player.seek).toHaveBeenLastCalledWith(7.5);

    pointer(surface, 'pointermove', 180);
    pointer(surface, 'pointerup', 200);
    expect(player.seek).toHaveBeenCalledTimes(2);
    expect(player.seek).toHaveBeenLastCalledWith(7);
    flushFrame();
    expect(player.seek).toHaveBeenCalledTimes(2);
    expect(player.play).not.toHaveBeenCalled();
    expect(player.pause).not.toHaveBeenCalled();
  });

  it('uses an absolute click below the scrub drag threshold', () => {
    const {player, surface} = mount({'drag-mode': 'scrub'});
    pointer(surface, 'pointerdown', 100);
    pointer(surface, 'pointermove', 103);
    flushFrame();
    expect(player.seek).not.toHaveBeenCalled();
    pointer(surface, 'pointerup', 103);
    expect(player.seek).toHaveBeenCalledOnce();
    expect(player.seek).toHaveBeenCalledWith(1.03);
  });

  it('starts relative scrub only after meaningful horizontal movement', () => {
    const {player, surface} = mount({'drag-mode': 'scrub'});
    pointer(surface, 'pointerdown', 100);
    pointer(surface, 'pointermove', 103);
    flushFrame();
    expect(player.seek).not.toHaveBeenCalled();
    pointer(surface, 'pointermove', 105);
    flushFrame();
    expect(player.seek).toHaveBeenCalledOnce();
    expect(player.seek).toHaveBeenCalledWith(7.95);
  });

  it('pans only the viewport, without interactive or transport commands', () => {
    const {view, player, surface} = mount({'drag-mode': 'pan', interactive: 'false'});
    view.panTo(4);
    pointer(surface, 'pointerdown', 100);
    pointer(surface, 'pointermove', 125);
    pointer(surface, 'pointermove', 150);
    expect(view.visibleRange()?.startSeconds).toBe(4);
    flushFrame();
    expect(view.visibleRange()?.startSeconds).toBe(3.5);
    pointer(surface, 'pointerup', 200);
    expect(view.visibleRange()?.startSeconds).toBe(3);
    flushFrame();
    expect(player.seek).not.toHaveBeenCalled();
    expect(player.play).not.toHaveBeenCalled();
    expect(player.pause).not.toHaveBeenCalled();
  });

  it('does not pan when scrolling is disabled', () => {
    const {view, player, surface} = mount({'drag-mode': 'pan', scrollable: 'false'});
    view.panTo(4);
    pointer(surface, 'pointerdown', 100);
    pointer(surface, 'pointermove', 150);
    pointer(surface, 'pointerup', 150);
    flushFrame();
    expect(view.visibleRange()?.startSeconds).toBe(4);
    expect(player.seek).not.toHaveBeenCalled();
  });

  it.each(['seek', 'scrub', 'none'])('requires interactive for %s commands', (mode) => {
    const {player, surface} = mount({'drag-mode': mode, interactive: 'false'});
    pointer(surface, 'pointerdown', 50);
    pointer(surface, 'pointermove', 100);
    pointer(surface, 'pointerup', 100);
    flushFrame();
    expect(player.seek).not.toHaveBeenCalled();
  });

  it('keeps none mode click-only, with no command from a drag', () => {
    const {player, surface} = mount({'drag-mode': 'none'});
    pointer(surface, 'pointerdown', 50);
    expect(player.seek).not.toHaveBeenCalled();
    pointer(surface, 'pointerup', 50);
    expect(player.seek).toHaveBeenCalledOnce();
    expect(player.seek).toHaveBeenLastCalledWith(0.5);
    player.seek.mockClear();
    pointer(surface, 'pointerdown', 50);
    pointer(surface, 'pointermove', 100);
    pointer(surface, 'pointerup', 100);
    flushFrame();
    expect(player.seek).not.toHaveBeenCalled();
  });

  it('disables follow in pan mode and suppresses it only during a scrub gesture', () => {
    const {view, player, source, surface} = mount({'drag-mode': 'pan', follow: ''});
    const visualizer = lastVisualizer();
    const tick = (seconds: number): void => {
      player.seconds = seconds;
      source.dispatchEvent(new CustomEvent('webaudio:timeupdate', {detail: {seconds, duration: 20}}));
    };
    tick(9);
    expect(visualizer.redraw).toHaveBeenLastCalledWith(9, false);

    view.dragMode = 'scrub';
    tick(10);
    expect(lastVisualizer().redraw).toHaveBeenLastCalledWith(10, true);
    pointer(surface, 'pointerdown', 100);
    pointer(surface, 'pointermove', 150);
    tick(11);
    expect(lastVisualizer().redraw).toHaveBeenLastCalledWith(11, false);
    pointer(surface, 'pointerup', 150);
    tick(12);
    expect(lastVisualizer().redraw).toHaveBeenLastCalledWith(12, true);
  });

  it.each(['scrub', 'pan', 'none'])('gives annotation priority over %s mode', (mode) => {
    const {view, player, surface} = mount({'drag-mode': mode, annotate: ''});
    const changes: Array<{regions: readonly {startSeconds: number; endSeconds?: number}[]}> = [];
    view.addEventListener('webaudio:regionchange', (event) => {
      changes.push((event as CustomEvent<typeof changes[number]>).detail);
    });
    pointer(surface, 'pointerdown', 50);
    pointer(surface, 'pointermove', 150);
    pointer(surface, 'pointerup', 150);
    flushFrame();
    expect(player.seek).not.toHaveBeenCalled();
    expect(changes).toHaveLength(1);
    expect(changes[0].regions).toEqual([expect.objectContaining({startSeconds: 0.5, endSeconds: 1.5})]);
  });

  it('ignores drag modes on a meter', () => {
    const {player, surface} = mount({'drag-mode': 'scrub', type: 'meter'});
    pointer(surface, 'pointerdown', 50);
    pointer(surface, 'pointermove', 150);
    pointer(surface, 'pointerup', 150);
    flushFrame();
    expect(player.seek).not.toHaveBeenCalled();
  });

  it('keeps keyboard Right moving playback forward in scrub mode', () => {
    const {view, player} = mount({'drag-mode': 'scrub'});
    view.dispatchEvent(new KeyboardEvent('keydown', {key: 'ArrowRight', bubbles: true, cancelable: true}));
    expect(player.seek).toHaveBeenCalledOnce();
    expect(player.seek.mock.calls[0][0]).toBeGreaterThan(8);
  });

  it('uses keyboard Right to pan forward without seeking in pan mode', () => {
    const {view, player} = mount({'drag-mode': 'pan', interactive: 'false'});
    view.panTo(4);
    view.dispatchEvent(new KeyboardEvent('keydown', {key: 'ArrowRight', bubbles: true, cancelable: true}));
    expect(view.visibleRange()!.startSeconds).toBeGreaterThan(4);
    expect(player.seek).not.toHaveBeenCalled();
  });

  it('retains the owner position and reports a failed scrub command', () => {
    const {view, player, surface} = mount({'drag-mode': 'scrub'});
    const failure = new Error('Seek was rejected');
    player.seek.mockImplementation(() => {throw failure;});
    const errors: unknown[] = [];
    const seeks: Event[] = [];
    view.addEventListener('webaudio:error', (event) => {
      errors.push((event as CustomEvent<{error: unknown}>).detail.error);
    });
    view.addEventListener('webaudio:seek', (event) => seeks.push(event));
    pointer(surface, 'pointerdown', 100);
    pointer(surface, 'pointermove', 150);
    flushFrame();
    expect(view.getAttribute('aria-valuenow')).toBe('8'); // The pointer is still held.
    pointer(surface, 'pointercancel', 150);
    expect(errors).toEqual([failure]);
    expect(seeks).toEqual([]);
    expect(player.seconds).toBe(8);
    expect(view.getAttribute('aria-valuenow')).toBe('8');
  });

  it('does not pan from a retired drag anchor when a release seek changes zoom', () => {
    const {view, player, surface} = mount({'drag-mode': 'scrub'});
    view.panTo(4);
    player.seek.mockImplementation((seconds: number) => {
      player.seconds = seconds;
      view.setZoom(200);
    });
    pointer(surface, 'pointerdown', 100);
    pointer(surface, 'pointermove', 150);
    pointer(surface, 'pointerup', 150);
    expect(player.seek).toHaveBeenCalledOnce();
    expect(view.zoom).toBe(200);
    expect(view.visibleRange()).toEqual({startSeconds: 0, endSeconds: 1});
    flushFrame();
    expect(view.visibleRange()).toEqual({startSeconds: 0, endSeconds: 1});
  });

  it('preserves a replacement gesture started by the previous release seek callback', () => {
    const {player, surface} = mount({'drag-mode': 'scrub'});
    let replaced = false;
    player.seek.mockImplementation((seconds: number) => {
      player.seconds = seconds;
      if (replaced) return;
      replaced = true;
      pointer(surface, 'pointerdown', 100);
      pointer(surface, 'pointermove', 150);
    });
    pointer(surface, 'pointerdown', 100);
    pointer(surface, 'pointermove', 150);
    pointer(surface, 'pointerup', 150);
    expect(player.seek).toHaveBeenCalledTimes(1);
    expect(player.seek).toHaveBeenLastCalledWith(7.5);
    flushFrame();
    expect(player.seek).toHaveBeenCalledTimes(2);
    expect(player.seek).toHaveBeenLastCalledWith(7);
    pointer(surface, 'pointerup', 150);
    flushFrame();
    expect(player.seek).toHaveBeenCalledTimes(2);
  });

  it('keeps normalized loop feedback when release repeats a clamped drag request', () => {
    const {view, player, surface} = mount({'drag-mode': 'scrub'});
    player.seek.mockImplementation((seconds: number) => {
      player.seconds = 2 + (((seconds - 2) % 2) + 2) % 2;
    });
    pointer(surface, 'pointerdown', 100);
    pointer(surface, 'pointermove', -1400); // Beyond the clip end: clamped to 20.
    flushFrame();
    expect(player.seek).toHaveBeenCalledOnce();
    expect(player.seek).toHaveBeenLastCalledWith(20);
    expect(view.getAttribute('aria-valuenow')).toBe('2');

    // A different pointerup coordinate still requests the same clamped 20.
    // The command is deduplicated, but the control must retain accepted 2.
    pointer(surface, 'pointerup', -1500);
    flushFrame();
    expect(player.seek).toHaveBeenCalledOnce();
    expect(player.seconds).toBe(2);
    expect(view.getAttribute('aria-valuenow')).toBe('2');
  });

  it('shows the player-accepted loop position after scrubbing without changing playback state', () => {
    const {view, player, surface} = mount({'drag-mode': 'scrub'});
    player.seek.mockImplementation((seconds: number) => {
      // A player with a 2..4 second loop accepts 7.5 as 3.5.
      player.seconds = 2 + (((seconds - 2) % 2) + 2) % 2;
    });
    const seeks: number[] = [];
    view.addEventListener('webaudio:seek', (event) => {
      seeks.push((event as CustomEvent<{seconds: number}>).detail.seconds);
    });
    pointer(surface, 'pointerdown', 100);
    pointer(surface, 'pointermove', 150);
    pointer(surface, 'pointerup', 150);
    expect(player.seek).toHaveBeenCalledWith(7.5);
    expect(player.seconds).toBe(3.5);
    expect(view.getAttribute('aria-valuenow')).toBe('3.5');
    expect(lastVisualizer().redraw).toHaveBeenLastCalledWith(3.5, false);
    expect(seeks).toEqual([3.5]);
    expect(player.play).not.toHaveBeenCalled();
    expect(player.pause).not.toHaveBeenCalled();
  });
});

describe('<audio-view> playback-owned scratch sessions', () => {
  it('borrows a session on press, moves it audibly and restores on release', () => {
    const fixture = mount({'drag-mode': 'scrub'});
    const scratch = enableScratch(fixture);
    pointer(fixture.surface, 'pointerdown', 100);
    expect(fixture.player.beginScratch).toHaveBeenCalledOnce();
    pointer(fixture.surface, 'pointermove', 150);
    flushFrame();
    expect(scratch.moveToSeconds).toHaveBeenLastCalledWith(7.5, true);
    pointer(fixture.surface, 'pointerup', 200);
    expect(scratch.moveToSeconds).toHaveBeenLastCalledWith(7, true);
    expect(scratch.end).toHaveBeenCalledOnce();
    expect(scratch.end).toHaveBeenCalledWith(true);
    expect(fixture.player.seek).not.toHaveBeenCalled();
    expect(fixture.view.getAttribute('aria-valuenow')).toBe('7');
  });

  it('seeks a stationary click silently within the held session', () => {
    const fixture = mount({'drag-mode': 'scrub'});
    const scratch = enableScratch(fixture);
    const observed: number[] = [];
    fixture.view.addEventListener('webaudio:seek', () => observed.push(fixture.player.seconds));
    pointer(fixture.surface, 'pointerdown', 100);
    pointer(fixture.surface, 'pointerup', 100);
    expect(observed).toEqual([1]);
    expect(scratch.moveToSeconds).toHaveBeenCalledOnce();
    expect(scratch.moveToSeconds).toHaveBeenCalledWith(1, false);
    expect(scratch.end).toHaveBeenCalledOnce();
    expect(scratch.end).toHaveBeenCalledWith(true);
    expect(fixture.player.seek).not.toHaveBeenCalled();
  });

  it.each(['pointercancel', 'mode', 'zoom', 'source', 'disconnect'])(
    'stops the borrowed scratch without restoring playback on %s', (reason) => {
      const fixture = mount({'drag-mode': 'scrub'});
      const scratch = enableScratch(fixture);
      pointer(fixture.surface, 'pointerdown', 100);
      pointer(fixture.surface, 'pointermove', 150);
      if (reason === 'pointercancel') pointer(fixture.surface, 'pointercancel', 150);
      else if (reason === 'mode') fixture.view.dragMode = 'pan';
      else if (reason === 'zoom') fixture.view.setZoom(200);
      else if (reason === 'source') {
        fixture.player.clip = makeClip();
        fixture.source.dispatchEvent(new CustomEvent('webaudio:sourcechange'));
      } else fixture.view.remove();
      flushFrame();
      expect(scratch.moveToSeconds).not.toHaveBeenCalled();
      expect(scratch.end).toHaveBeenCalledOnce();
      expect(scratch.end).toHaveBeenCalledWith(false);
    },
  );

  it('retains the first gesture through same-clip graph readiness', () => {
    const fixture = mount({'drag-mode': 'scrub'});
    const scratch = enableScratch(fixture);
    fixture.player.beginScratch = vi.fn(() => {
      fixture.source.dispatchEvent(new CustomEvent('webaudio:loaded'));
      return scratch;
    });
    pointer(fixture.surface, 'pointerdown', 100);
    pointer(fixture.surface, 'pointermove', 150);
    pointer(fixture.surface, 'pointerup', 150);
    expect(scratch.moveToSeconds).toHaveBeenCalledWith(7.5, true);
    expect(scratch.end).toHaveBeenCalledOnce();
    expect(scratch.end).toHaveBeenCalledWith(true);
  });

  it('cancels a session returned after reentrant source replacement', () => {
    const fixture = mount({'drag-mode': 'scrub'});
    const scratch = enableScratch(fixture);
    fixture.player.beginScratch = vi.fn(() => {
      fixture.player.clip = makeClip();
      fixture.source.dispatchEvent(new CustomEvent('webaudio:sourcechange'));
      return scratch;
    });
    pointer(fixture.surface, 'pointerdown', 100);
    pointer(fixture.surface, 'pointermove', 150);
    flushFrame();
    expect(scratch.end).toHaveBeenCalledOnce();
    expect(scratch.end).toHaveBeenCalledWith(false);
    expect(scratch.moveToSeconds).not.toHaveBeenCalled();
  });

  it('does not replace an externally invalidated session with ordinary seeks', () => {
    const fixture = mount({'drag-mode': 'scrub'});
    const scratch = enableScratch(fixture);
    pointer(fixture.surface, 'pointerdown', 100);
    scratch.active = false; // An external transport command now owns intent.
    pointer(fixture.surface, 'pointermove', 150);
    pointer(fixture.surface, 'pointerup', 150);
    flushFrame();
    expect(scratch.moveToSeconds).not.toHaveBeenCalled();
    expect(fixture.player.seek).not.toHaveBeenCalled();
    expect(scratch.end).toHaveBeenCalledOnce();
    expect(scratch.end).toHaveBeenCalledWith(false);
  });

  it('contains begin failure and does not fall back to a running seek mid-gesture', () => {
    const fixture = mount({'drag-mode': 'scrub'});
    const failure = new Error('Scratch unavailable');
    fixture.player.beginScratch = vi.fn(() => {throw failure;});
    const errors: unknown[] = [];
    fixture.view.addEventListener('webaudio:error', (event) => {
      errors.push((event as CustomEvent<{error: unknown}>).detail.error);
    });
    pointer(fixture.surface, 'pointerdown', 100);
    pointer(fixture.surface, 'pointermove', 150);
    pointer(fixture.surface, 'pointerup', 150);
    flushFrame();
    expect(errors).toEqual([failure]);
    expect(fixture.player.seek).not.toHaveBeenCalled();
  });

  it.each(['mode', 'zoom', 'source', 'src', 'peaks-src', 'disconnect', 'blur', 'window-blur', 'keyboard'])(
    'cancels playback-owned inertia on %s after pointer release', (reason) => {
      const fixture = mount({'drag-mode': 'scrub'});
      const {scratch} = enableCoastingScratch(fixture);
      pointer(fixture.surface, 'pointerdown', 100);
      pointer(fixture.surface, 'pointermove', 50);
      pointer(fixture.surface, 'pointerup', 50);
      expect(scratch.end).toHaveBeenCalledOnce();
      expect(scratch.end).toHaveBeenLastCalledWith(true);
      expect(scratch.active).toBe(true);
      if (reason === 'mode') fixture.view.dragMode = 'pan';
      else if (reason === 'zoom') fixture.view.setZoom(200);
      else if (reason === 'source') {
        fixture.player.clip = makeClip();
        fixture.source.dispatchEvent(new CustomEvent('webaudio:sourcechange'));
      } else if (reason === 'src' || reason === 'peaks-src') {
        vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
        fixture.view.setAttribute(reason, '/pending-replacement');
      } else if (reason === 'disconnect') fixture.view.remove();
      else if (reason === 'blur') fixture.view.dispatchEvent(new FocusEvent('blur'));
      else if (reason === 'window-blur') window.dispatchEvent(new Event('blur'));
      else fixture.view.dispatchEvent(new KeyboardEvent('keydown', {key: 'ArrowRight', bubbles: true}));
      expect(scratch.end).toHaveBeenCalledTimes(2);
      expect(scratch.end).toHaveBeenLastCalledWith(false);
      expect(scratch.active).toBe(false);
    },
  );

  it('follows player time observations during inertia without issuing more gesture seeks', () => {
    const fixture = mount({'drag-mode': 'scrub', follow: 'false'});
    const {scratch} = enableCoastingScratch(fixture);
    pointer(fixture.surface, 'pointerdown', 100);
    pointer(fixture.surface, 'pointermove', 50);
    pointer(fixture.surface, 'pointerup', 50);
    fixture.player.seconds = 9;
    fixture.source.dispatchEvent(new CustomEvent('webaudio:timeupdate', {detail: {seconds: 9, duration: 20}}));
    expect(fixture.view.getAttribute('aria-valuenow')).toBe('9');
    expect(lastVisualizer().redraw).toHaveBeenLastCalledWith(9, false);
    expect(scratch.moveToSeconds).toHaveBeenCalledOnce();
    expect(fixture.player.seek).not.toHaveBeenCalled();
  });

  it('lets a re-grab transfer prior play intent before releasing the old coast handle', () => {
    const fixture = mount({'drag-mode': 'scrub'});
    const first = enableCoastingScratch(fixture);
    pointer(fixture.surface, 'pointerdown', 100);
    pointer(fixture.surface, 'pointermove', 50);
    pointer(fixture.surface, 'pointerup', 50);
    const second = enableCoastingScratch(fixture);
    const begin = vi.fn(() => {
      expect(first.scratch.active).toBe(true);
      first.settle(); // Native player atomically transfers intent and retires it.
      return second.scratch;
    });
    fixture.player.beginScratch = begin;
    pointer(fixture.surface, 'pointerdown', 100);
    expect(begin).toHaveBeenCalledOnce();
    expect(first.scratch.end).toHaveBeenCalledOnce();
    pointer(fixture.surface, 'pointercancel', 100);
    expect(second.scratch.end).toHaveBeenLastCalledWith(false);
  });

  it('does not let a completed older release detach a newer coast owner', async () => {
    const fixture = mount({'drag-mode': 'scrub'});
    const first = enableCoastingScratch(fixture);
    pointer(fixture.surface, 'pointerdown', 100);
    pointer(fixture.surface, 'pointermove', 50);
    pointer(fixture.surface, 'pointerup', 50);
    const second = enableCoastingScratch(fixture);
    pointer(fixture.surface, 'pointerdown', 100);
    pointer(fixture.surface, 'pointermove', 50);
    pointer(fixture.surface, 'pointerup', 50);
    await Promise.resolve();
    fixture.view.dragMode = 'pan';
    expect(first.scratch.end).toHaveBeenLastCalledWith(false);
    expect(second.scratch.end).toHaveBeenLastCalledWith(false);
  });

  it.each([false, true])('reports release failure only while its owner is current (superseded=%s)', async (superseded) => {
    const fixture = mount({'drag-mode': 'scrub'});
    const {scratch} = enableCoastingScratch(fixture);
    let reject!: (error: Error) => void;
    const pending = new Promise<void>((_resolve, fail) => {reject = fail;});
    scratch.end.mockImplementation((resume = true) => {
      if (resume) return pending;
      scratch.active = false;
      return Promise.resolve();
    });
    const errors = vi.fn();
    fixture.view.addEventListener('webaudio:error', errors);
    pointer(fixture.surface, 'pointerdown', 100);
    pointer(fixture.surface, 'pointermove', 50);
    pointer(fixture.surface, 'pointerup', 50);
    if (superseded) fixture.view.dragMode = 'pan';
    reject(new Error('Late audio failure'));
    await Promise.resolve();
    expect(errors).toHaveBeenCalledTimes(superseded ? 0 : 1);
  });

  it('centers scrub independently of follow and restores position mode for annotation', () => {
    const {view} = mount({'drag-mode': 'scrub', follow: 'false'});
    const renderer = lastVisualizer();
    expect(renderer.setPlayheadMode).toHaveBeenLastCalledWith('center');
    expect(renderer.redraw).toHaveBeenCalledWith(8, false);
    const range = view.visibleRange();
    const viewportChanges = vi.fn();
    view.addEventListener('webaudio:viewportchange', viewportChanges);
    view.panTo(12);
    expect(view.visibleRange()).toEqual(range);
    expect(viewportChanges).not.toHaveBeenCalled();
    expect(renderer.setOffset).not.toHaveBeenCalled();
    view.annotate = true;
    expect(renderer.setPlayheadMode).toHaveBeenLastCalledWith('position');
    expect(lastVisualizer()).toBe(renderer);
    view.annotate = false;
    view.dragMode = 'pan';
    expect(renderer.setPlayheadMode).toHaveBeenLastCalledWith('position');
  });
});

describe('<audio-view> drag cancellation', () => {
  it.each(['pointercancel', 'lostpointercapture'])('drops an uncommitted scrub on %s', (event) => {
    const {player, surface} = mount({'drag-mode': 'scrub'});
    pointer(surface, 'pointerdown', 100);
    pointer(surface, 'pointermove', 150);
    pointer(surface, event, 150);
    pointer(surface, 'pointerup', 150);
    flushFrame();
    expect(player.seek).not.toHaveBeenCalled();
  });

  it.each(['mode', 'zoom', 'source', 'disconnect'])(
    'drops pending work when %s changes during a scrub',
    (change) => {
      const {view, player, source, surface} = mount({'drag-mode': 'scrub'});
      pointer(surface, 'pointerdown', 100);
      pointer(surface, 'pointermove', 150);
      if (change === 'mode') view.dragMode = 'pan';
      else if (change === 'zoom') view.setZoom(200);
      else if (change === 'source') {
        player.clip = makeClip();
        source.dispatchEvent(new CustomEvent('webaudio:sourcechange'));
      } else view.remove();
      flushFrame();
      pointer(surface, 'pointerup', 150);
      flushFrame();
      expect(player.seek).not.toHaveBeenCalled();
    },
  );
});

function flushFrame(): void {
  const pending = [...frames.values()];
  frames.clear();
  for (const callback of pending) callback(1000 / 60);
}

function pointer(surface: HTMLElement, type: string, clientX: number): void {
  const event = new MouseEvent(type, {bubbles: true, cancelable: true, clientX, button: 0});
  Object.defineProperties(event, {
    pointerId: {value: 7},
    isPrimary: {value: true},
    pointerType: {value: 'mouse'},
  });
  surface.dispatchEvent(event);
}

function makeClip(): AudioClip {
  return createAudioClip({sampleRate: 100, channelData: [new Float32Array(2000)]});
}

function mount(attributes: Record<string, string> = {}) {
  const player = {
    clip: makeClip(),
    analyser: {} as AnalyserNode,
    duration: 20,
    seconds: 8,
    seek: vi.fn((seconds: number) => {player.seconds = Math.max(0, Math.min(20, seconds));}),
    play: vi.fn(),
    pause: vi.fn(),
    beginScratch: undefined as (() => {
      readonly active: boolean;
      moveToSeconds(seconds: number, audible?: boolean): void;
      end(resume?: boolean): void | Promise<void>;
    } | undefined) | undefined,
  };
  const source = document.createElement('div') as HTMLDivElement & {player: typeof player};
  source.id = `drag-player-${++fixtureId}`;
  source.player = player;
  document.body.append(source);
  const view = document.createElement('drag-audio-view') as AudioViewElement;
  view.setAttribute('player', `#${source.id}`);
  view.setAttribute('interactive', '');
  for (const [name, value] of Object.entries(attributes)) view.setAttribute(name, value);
  document.body.append(view);
  const surface = view.querySelector<HTMLElement>('.wui-stage__surface')!;
  if (!surface) throw new Error('Expected a drawing surface');
  return {view, player, source, surface};
}

function lastVisualizer(): ReturnType<typeof fakeVisualizer> {
  return mocks.waveform.mock.results.at(-1)!.value as ReturnType<typeof fakeVisualizer>;
}

function fakeVisualizer(options: WaveformRenderOptions) {
  const duration = options.durationSeconds ?? 20;
  let pixelsPerSecond = options.pixelsPerSecond ?? 100;
  let startSeconds = 0;
  const listeners = new Set<(viewport: AudioViewport) => void>();
  const viewport = (): AudioViewport => ({
    startSeconds,
    endSeconds: Math.min(duration, startSeconds + 200 / pixelsPerSecond),
  });
  const setOffset = (seconds: number): void => {
    startSeconds = Math.max(0, Math.min(Math.max(0, duration - 200 / pixelsPerSecond), seconds));
    for (const listener of listeners) listener(viewport());
  };
  return {
    redraw: vi.fn(),
    setPlayheadMode: vi.fn(),
    setZoom: vi.fn((next: number) => {pixelsPerSecond = next; setOffset(startSeconds);}),
    setRegions: vi.fn(),
    hitTest: vi.fn((x: number) => ({seconds: startSeconds + x / pixelsPerSecond})),
    setOffset: vi.fn(setOffset),
    viewport: vi.fn(viewport),
    onViewportChange: vi.fn((listener: (range: AudioViewport) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }),
    dispose: vi.fn(() => listeners.clear()),
  };
}

function enableScratch(fixture: ReturnType<typeof mount>) {
  const scratch = {
    active: true,
    moveToSeconds: vi.fn((seconds: number, _audible = true) => {fixture.player.seconds = seconds;}),
    end: vi.fn((_resume = true) => {scratch.active = false;}),
  };
  fixture.player.beginScratch = vi.fn(() => scratch);
  return scratch;
}

function enableCoastingScratch(fixture: ReturnType<typeof mount>) {
  let resolve!: () => void;
  const ended = new Promise<void>((done) => {resolve = done;});
  const settle = (): void => {scratch.active = false; resolve();};
  const scratch = {
    active: true,
    moveToSeconds: vi.fn((seconds: number, _audible = true) => {fixture.player.seconds = seconds;}),
    end: vi.fn((resume = true) => {
      if (!resume) settle();
      return ended;
    }),
  };
  fixture.player.beginScratch = vi.fn(() => scratch);
  return {scratch, settle};
}
