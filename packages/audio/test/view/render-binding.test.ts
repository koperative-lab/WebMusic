// @vitest-environment jsdom

import {afterEach, describe, expect, it, vi} from 'vitest';
import {bindPlayerToWaveform} from '../../src/view/render/binding';
import type {RenderedAudioVisualizer, ViewPlayerBinding} from '../../src/view/core/types';

afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function harness() {
  const surface = document.createElement('div');
  document.body.append(surface);
  const stops = [vi.fn(), vi.fn()];
  let next = 0;
  const player = {
    on: vi.fn(() => stops[next++]), seek: vi.fn(), seconds: 2, duration: 10,
  } satisfies ViewPlayerBinding;
  const visualizer = {
    redraw: vi.fn(), setZoom: vi.fn(), setRegions: vi.fn(), dispose: vi.fn(),
    hitTest: vi.fn((x: number) => ({seconds: x / 10})),
  } satisfies RenderedAudioVisualizer;
  const pointer = (type: string, x: number, id = 1, button = 0) => {
    const event = new MouseEvent(type, {clientX: x, button});
    Object.defineProperty(event, 'pointerId', {value: id});
    surface.dispatchEvent(event);
  };
  return {surface, stops, player, visualizer, pointer};
}

describe('bindPlayerToWaveform pointer ownership', () => {
  it('seeks once on a primary press and ignores release, right-click and detached gestures', () => {
    const h = harness();
    const binding = bindPlayerToWaveform(h.player, h.visualizer, {surface: h.surface});
    h.pointer('pointerdown', 30);
    h.pointer('pointerup', 30);
    expect(h.player.seek).toHaveBeenCalledOnce();
    expect(h.player.seek).toHaveBeenCalledWith(3);
    h.pointer('pointerdown', 80, 1, 2);
    h.pointer('pointerup', 80, 1, 2);
    binding.unsubscribe();
    binding.unsubscribe();
    h.pointer('pointerdown', 50);
    expect(h.player.seek).toHaveBeenCalledOnce();
    expect(h.stops.every((stop) => stop.mock.calls.length === 1)).toBe(true);
  });

  it('commits only its active annotation pointer and clears cancellation', () => {
    const h = harness();
    const changed = vi.fn();
    const binding = bindPlayerToWaveform(h.player, h.visualizer, {
      surface: h.surface, draggableRegions: true, onRegionChange: changed,
    });
    h.pointer('pointerdown', 10);
    h.pointer('pointerup', 50, 2);
    expect(changed).not.toHaveBeenCalled();
    h.pointer('pointercancel', 20);
    h.pointer('pointerup', 50);
    expect(changed).not.toHaveBeenCalled();
    expect(h.player.seek).not.toHaveBeenCalled();
    h.pointer('pointerdown', 20);
    h.pointer('pointerup', 60);
    expect(changed).toHaveBeenCalledOnce();
    expect(changed.mock.calls[0][0][0]).toMatchObject({startSeconds: 2, endSeconds: 6});
    expect(h.player.seek).not.toHaveBeenCalled();
    h.pointer('pointerdown', 30);
    h.pointer('pointerup', 30);
    expect(h.player.seek).toHaveBeenCalledOnce();
    expect(h.player.seek).toHaveBeenCalledWith(3);
    binding.unsubscribe();
  });

  it('releases earlier subscriptions if attaching a later one fails', () => {
    const h = harness();
    const failure = new Error('end subscription failed');
    h.player.on.mockImplementationOnce(() => h.stops[0]).mockImplementationOnce(() => { throw failure; });
    expect(() => bindPlayerToWaveform(h.player, h.visualizer)).toThrow(failure);
    expect(h.stops[0]).toHaveBeenCalledOnce();
  });

  it('detaches the remaining resources when one unsubscribe throws', () => {
    const h = harness();
    const failure = new Error('end cleanup failed');
    h.stops[1].mockImplementation(() => { throw failure; });
    const binding = bindPlayerToWaveform(h.player, h.visualizer, {surface: h.surface});
    expect(() => binding.unsubscribe()).toThrow(failure);
    expect(h.stops[0]).toHaveBeenCalledOnce();
    h.pointer('pointerdown', 30);
    expect(h.player.seek).not.toHaveBeenCalled();
    expect(() => binding.unsubscribe()).not.toThrow();
  });
});


function frameHarness() {
  const h = harness();
  const frames = new Map<number, FrameRequestCallback>();
  let nextFrame = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    const id = ++nextFrame;
    frames.set(id, callback);
    return id;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  let hidden = false;
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => hidden ? 'hidden' : 'visible');
  const listeners = new Map<string, (payload: unknown) => void>();
  const player = {...h.player, playing: true, scratching: false,
    on: vi.fn((name: string, callback: (payload: unknown) => void) => {
      listeners.set(name, callback);
      return () => listeners.delete(name);
    }),
  };
  const visualizer = {...h.visualizer, redrawFrame: vi.fn()};
  const emit = (name: string, payload?: unknown) => listeners.get(name)?.(payload);
  const flush = (timestamp = 0): void => {
    const ready = [...frames.values()];
    frames.clear();
    for (const callback of ready) callback(timestamp);
  };
  const visibility = (value: boolean): void => {
    hidden = value;
    document.dispatchEvent(new Event('visibilitychange'));
  };
  return {...h, frames, player, visualizer, emit, flush, visibility, listeners};
}

describe('bindPlayerToWaveform live frame observation', () => {
  it('reads the authority on every changed display frame between low-rate cursor events', () => {
    const h = frameHarness();
    const binding = bindPlayerToWaveform(h.player, h.visualizer, {surface: h.surface, followPlayhead: true});
    expect(h.visualizer.redrawFrame).toHaveBeenLastCalledWith(2, true);
    h.visualizer.redrawFrame.mockClear();
    for (let index = 1; index <= 6; index++) {
      h.player.seconds = 2 + index / 120;
      h.flush(index * 1000 / 120);
    }
    expect(h.visualizer.redrawFrame).toHaveBeenCalledTimes(6);
    expect(h.visualizer.redrawFrame).toHaveBeenLastCalledWith(2.05, true);
    expect(h.visualizer.redraw).not.toHaveBeenCalled();
    expect(h.frames.size).toBe(1);
    expect(h.player.seek).not.toHaveBeenCalled();
    binding.unsubscribe();
    expect(h.frames.size).toBe(0);
  });

  it('does not paint unchanged seconds or add event paints alongside the active frame', () => {
    const h = frameHarness();
    const binding = bindPlayerToWaveform(h.player, h.visualizer, {surface: h.surface});
    h.visualizer.redrawFrame.mockClear();
    h.flush(999999); // A huge wall-clock jump is not musical progress.
    expect(h.visualizer.redrawFrame).not.toHaveBeenCalled();
    h.player.seconds = 4;
    for (let i = 0; i < 10; i++) h.emit('timeupdate', {seconds: 1});
    expect(h.frames.size).toBe(1);
    expect(h.visualizer.redraw).not.toHaveBeenCalled();
    h.flush();
    expect(h.visualizer.redrawFrame).toHaveBeenCalledOnce();
    expect(h.visualizer.redrawFrame).toHaveBeenLastCalledWith(4, false);
    binding.unsubscribe();
  });

  it('samples the final paused position then stops and restarts on the next active cursor event', () => {
    const h = frameHarness();
    const binding = bindPlayerToWaveform(h.player, h.visualizer, {surface: h.surface});
    h.player.seconds = 2.125;
    h.player.playing = false;
    h.flush();
    expect(h.visualizer.redrawFrame).toHaveBeenLastCalledWith(2.125, false);
    expect(h.frames.size).toBe(0);
    h.player.seconds = 5;
    h.emit('timeupdate', {seconds: 3});
    expect(h.visualizer.redraw).toHaveBeenLastCalledWith(5, false);
    expect(h.frames.size).toBe(0);
    h.player.playing = true;
    h.emit('timeupdate');
    expect(h.frames.size).toBe(1);
    binding.unsubscribe();
  });

  it('observes scratch/coast activity while normal playback is paused', () => {
    const h = frameHarness();
    h.player.playing = false;
    h.player.scratching = true;
    const binding = bindPlayerToWaveform(h.player, h.visualizer, {surface: h.surface});
    h.player.seconds = 1.875;
    h.flush();
    expect(h.visualizer.redrawFrame).toHaveBeenLastCalledWith(1.875, false);
    h.player.scratching = false;
    h.flush();
    expect(h.frames.size).toBe(0);
    binding.unsubscribe();
  });

  it('cancels hidden work and stale callbacks, then reads the current authority when visible again', () => {
    const h = frameHarness();
    const binding = bindPlayerToWaveform(h.player, h.visualizer, {surface: h.surface});
    const stale = [...h.frames.values()][0];
    h.visibility(true);
    expect(h.frames.size).toBe(0);
    h.player.seconds = 7;
    h.emit('timeupdate');
    stale(100);
    expect(h.visualizer.redrawFrame).toHaveBeenCalledTimes(1);
    h.visibility(false);
    expect(h.visualizer.redrawFrame).toHaveBeenLastCalledWith(7, false);
    expect(h.frames.size).toBe(1);
    const removed = [...h.frames.values()][0];
    binding.unsubscribe();
    h.player.seconds = 8;
    removed(200);
    h.visibility(false);
    expect(h.visualizer.redrawFrame).toHaveBeenCalledTimes(2);
    expect(h.listeners.size).toBe(0);
  });

  it('preserves the end reset and prevents a stale active frame from replacing it', () => {
    const h = frameHarness();
    const binding = bindPlayerToWaveform(h.player, h.visualizer, {surface: h.surface});
    const stale = [...h.frames.values()][0];
    h.emit('end');
    expect(h.visualizer.redraw).toHaveBeenLastCalledWith(0, false);
    stale(100);
    h.player.seconds = h.player.duration;
    h.visibility(true);
    h.visibility(false);
    expect(h.frames.size).toBe(0);
    expect(h.visualizer.redrawFrame).toHaveBeenCalledTimes(1);
    expect(h.visualizer.redraw).toHaveBeenCalledTimes(1);
    h.emit('timeupdate'); // A new transport update releases the terminal reset.
    expect(h.frames.size).toBe(1);
    binding.unsubscribe();
  });

  it('does not re-arm after disposal or end re-enters a frame paint', () => {
    const h = frameHarness();
    const binding = bindPlayerToWaveform(h.player, h.visualizer, {surface: h.surface});
    h.visualizer.redrawFrame.mockImplementation(() => h.emit('end'));
    h.player.seconds = 3;
    h.flush();
    expect(h.frames.size).toBe(0);
    h.visualizer.redrawFrame.mockImplementation(() => binding.unsubscribe());
    h.emit('timeupdate');
    h.player.seconds = 4;
    h.flush();
    expect(h.frames.size).toBe(0);
    expect(h.listeners.size).toBe(0);
  });

  it('retains legacy event-only payloads and supports visualizers without a frame method', () => {
    const h = frameHarness();
    const legacy = {...h.player, playing: undefined, scratching: undefined};
    const first = bindPlayerToWaveform(legacy, h.visualizer, {surface: h.surface});
    h.emit('timeupdate', {seconds: 6});
    expect(h.visualizer.redraw).toHaveBeenLastCalledWith(6, false);
    expect(h.visualizer.redrawFrame).not.toHaveBeenCalled();
    expect(h.frames.size).toBe(0);
    first.unsubscribe();
    const fallback = {...h.visualizer, redrawFrame: undefined};
    const second = bindPlayerToWaveform(h.player, fallback, {surface: h.surface});
    h.player.seconds = 3;
    h.flush();
    expect(fallback.redraw).toHaveBeenLastCalledWith(3, false);
    second.unsubscribe();
  });
});
