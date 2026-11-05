// @vitest-environment jsdom

import React from 'react';
import {act, cleanup, fireEvent, render, screen} from '@testing-library/react';
import type {Score} from '../../src/core';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {
  bindPlayerToVisualizer,
  renderPianoRollVisualizer,
  renderStaffVisualizer,
} from '../../src/view/render';

interface MockPlayer {
  currentTime: {seconds: number};
  seconds: number;
  duration: number;
  progress: number;
  seek: ReturnType<typeof vi.fn>;
  seekFraction: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
  playing: boolean;
  playRequests: Array<Deferred<void>>;
  on(event: string, callback: (payload?: unknown) => void): () => void;
  emit(event: string, payload?: unknown): void;
}

const state = vi.hoisted(() => ({instances: [] as MockPlayer[]}));

vi.mock('../../src/play/headless', () => {
  class Player {
    // Deliberately use a nominal cursor that disagrees with the transport
    // position: this is exactly the rate != 1 condition controls must handle.
    readonly currentTime = {seconds: 3};
    readonly seconds = 0.5;
    readonly duration = 1;
    readonly progress = 0.5;
    readonly seek = vi.fn();
    readonly seekFraction = vi.fn();
    readonly stop = vi.fn();
    readonly dispose = vi.fn();
    playing = false;
    readonly playRequests: Array<Deferred<void>> = [];
    private readonly listeners = new Map<string, Set<(payload?: unknown) => void>>();

    constructor(_score: Score, _options: unknown) {
      state.instances.push(this);
    }

    on(event: string, callback: (payload?: unknown) => void): () => void {
      const listeners = this.listeners.get(event) ?? new Set();
      listeners.add(callback);
      this.listeners.set(event, listeners);
      return () => listeners.delete(callback);
    }

    isPlaying(): boolean {
      return this.playing;
    }

    play(): Promise<void> {
      const request = deferred<void>();
      this.playRequests.push(request);
      return request.promise;
    }

    pause(): void {
      this.playing = false;
    }

    emit(event: string, payload?: unknown): void {
      for (const listener of this.listeners.get(event) ?? []) listener(payload);
    }
  }
  return {Player};
});

vi.mock('../../src/view/render', () => ({
  bindPlayerToVisualizer: vi.fn(),
  renderPianoRollVisualizer: vi.fn(),
  renderStaffVisualizer: vi.fn(),
  renderWaterfallVisualizer: vi.fn(),
}));

import {ScoreProvider} from '../../src/react/context';
import {PianoRollView, PlayerControls, StaffView} from '../../src/react/views';

afterEach(() => {
  cleanup();
  state.instances.length = 0;
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe('PlayerControls transport coordinates', () => {
  it('uses transport duration/position and seekFraction instead of the nominal cursor', () => {
    render(
      <ScoreProvider score={{durationSeconds: 4} as Score}>
        <PlayerControls />
      </ScoreProvider>,
    );
    const player = state.instances[0]!;
    const slider = screen.getByRole('slider', {name: 'Playback position'});
    const controls = slider.parentElement!;

    expect(controls.style.padding).toContain('--wm-component-padding');
    expect(controls.style.border).toContain('--wm-component-border');
    expect(controls.style.background).toContain('--wm-component-background');

    expect(slider.getAttribute('aria-valuemax')).toBe('1');
    expect(slider.getAttribute('aria-valuenow')).toBe('0.5');
    expect(slider.querySelector('span')?.style.width).toBe('50%');
    expect(slider.style.border).toContain('--webscore-react-progress-border');
    expect(slider.style.border).toContain('--wm-control-border');
    expect(slider.style.border).toContain('#d8d8d8');
    expect(slider.style.border).not.toContain('#111');

    Object.defineProperty(slider, 'getBoundingClientRect', {
      value: () => ({left: 100, width: 200}),
    });
    // JSDOM's PointerEvent does not consistently retain clientX; a MouseEvent
    // with the matching pointer event type exercises React's handler instead.
    fireEvent(slider, new MouseEvent('pointerdown', {bubbles: true, clientX: 250}));
    expect(player.seekFraction).toHaveBeenCalledWith(0.75);
    expect(player.seek).not.toHaveBeenCalled();

    fireEvent.keyDown(slider, {key: 'ArrowRight'});
    expect(player.seek).toHaveBeenLastCalledWith(1);
    fireEvent.keyDown(slider, {key: 'End'});
    expect(player.seekFraction).toHaveBeenLastCalledWith(1);
  });

  it('ignores a rejected play request owned by a replaced player', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const firstScore = {id: 'first', durationSeconds: 4} as unknown as Score;
    const secondScore = {id: 'second', durationSeconds: 4} as unknown as Score;
    const {rerender} = render(
      <ScoreProvider score={firstScore}>
        <PlayerControls />
      </ScoreProvider>,
    );
    const firstPlayer = state.instances[0]!;

    fireEvent.click(screen.getByRole('button', {name: 'Play'}));
    expect(screen.getByRole('button', {name: 'Pause'})).toBeTruthy();

    rerender(
      <ScoreProvider score={secondScore}>
        <PlayerControls />
      </ScoreProvider>,
    );
    const secondPlayer = state.instances[1]!;
    act(() => {
      secondPlayer.playing = true;
      secondPlayer.emit('cursor', {seconds: 0.5});
    });
    expect(screen.getByRole('button', {name: 'Pause'})).toBeTruthy();

    await act(async () => firstPlayer.playRequests[0]!.reject(new Error('old autoplay failure')));

    expect(screen.getByRole('button', {name: 'Pause'})).toBeTruthy();
    expect(consoleError).not.toHaveBeenCalled();
  });

  it('ignores a superseded play rejection from the same player', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(
      <ScoreProvider score={{id: 'same-player', durationSeconds: 4} as unknown as Score}>
        <PlayerControls />
      </ScoreProvider>,
    );
    const player = state.instances[0]!;

    fireEvent.click(screen.getByRole('button', {name: 'Play'}));
    fireEvent.click(screen.getByRole('button', {name: 'Pause'}));
    fireEvent.click(screen.getByRole('button', {name: 'Play'}));
    expect(player.playRequests).toHaveLength(2);

    await act(async () => player.playRequests[0]!.reject(new Error('superseded failure')));

    expect(screen.getByRole('button', {name: 'Pause'})).toBeTruthy();
    expect(consoleError).not.toHaveBeenCalled();
    await act(async () => player.playRequests[1]!.resolve());
  });
});

describe('PianoRollView surface ownership', () => {
  it('keeps the outer frame on the stable wrapper after the renderer reparents the SVG', () => {
    const dispose = vi.fn();
    vi.mocked(bindPlayerToVisualizer).mockReturnValue(() => undefined);
    vi.mocked(renderPianoRollVisualizer).mockImplementation((_score, svg) => {
      const viewport = svg.ownerDocument.createElement('div');
      viewport.dataset.webscoreScrollViewport = 'webscore-piano-roll-viewport';
      svg.parentElement!.append(viewport);
      viewport.append(svg);
      return {dispose} as never;
    });

    render(
      <ScoreProvider score={{id: 'piano-roll', durationSeconds: 4} as unknown as Score}>
        <PianoRollView className="piano-roll" />
      </ScoreProvider>,
    );

    const frame = screen.getByRole('img', {name: 'Piano roll'});
    const svg = frame.querySelector('svg')!;

    expect(frame.className).toBe('piano-roll');
    expect(svg.parentElement).not.toBe(frame);
    expect(frame.contains(svg)).toBe(true);
    expect(frame.style.padding).toContain('--wm-component-padding');
    expect(frame.style.border).toContain('--wm-component-border');
    expect(frame.style.background).toContain('--wm-component-background');
    expect(svg.style.padding).toBe('');
    expect(svg.style.border).toBe('');
    expect(svg.style.background).toBe('');
  });
});

describe('StaffView', () => {
  it('is responsive, has an accessible name and releases its staff on unmount', () => {
    const dispose = vi.fn();
    const unbind = vi.fn();
    vi.mocked(renderStaffVisualizer).mockReturnValueOnce({dispose} as never);
    vi.mocked(bindPlayerToVisualizer).mockReturnValueOnce(unbind);
    const score = {id: 'responsive', durationSeconds: 4} as unknown as Score;
    const {unmount} = render(
      <ScoreProvider score={score}>
        <StaffView />
      </ScoreProvider>,
    );

    const view = screen.getByRole('img', {name: 'Musical staff'});
    expect(view.style.width).toBe('100%');
    expect(view.style.height).toBe('220px');
    expect(view.style.padding).toContain('--wm-component-padding');
    expect(view.style.border).toContain('--wm-component-border');
    expect(view.style.background).toContain('--wm-component-background');
    unmount();
    expect(unbind).toHaveBeenCalledOnce();
    expect(dispose).toHaveBeenCalledOnce();
  });

});

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(reason: unknown): void;
}

function deferred<T>(): Deferred<T> {
  let resolvePromise!: (value: T) => void;
  let rejectPromise!: (reason: unknown) => void;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return {promise, resolve: resolvePromise, reject: rejectPromise};
}
