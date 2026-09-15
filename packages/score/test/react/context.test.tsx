// @vitest-environment jsdom

import React from 'react';
import {act, cleanup, render, screen} from '@testing-library/react';
import type {Score} from '../../src/core';
import type {PlayerOptions} from '../../src/play/headless';
import {afterEach, describe, expect, it, vi} from 'vitest';

interface MockPlayerInstance {
  score: Score;
  options: unknown;
  currentTime: {seconds: number};
  stop: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
  emit(event: string, value?: unknown): void;
  listenerCount(event: string): number;
  listenersFor(event: string): Array<(value?: unknown) => void>;
}

const playerState = vi.hoisted(() => ({instances: [] as MockPlayerInstance[]}));

vi.mock('../../src/play/headless', () => {
  class Player {
    readonly score: Score;
    readonly options: unknown;
    readonly currentTime: {seconds: number};
    readonly stop = vi.fn();
    readonly dispose = vi.fn();
    readonly listeners = new Map<string, Set<(value?: unknown) => void>>();

    constructor(score: Score, options: unknown) {
      this.score = score;
      this.options = options;
      this.currentTime = {seconds: (score as Score & {initialSeconds?: number}).initialSeconds ?? 0};
      playerState.instances.push(this);
    }

    on(event: string, listener: (value?: unknown) => void) {
      const listeners = this.listeners.get(event) ?? new Set();
      listeners.add(listener);
      this.listeners.set(event, listeners);
      return () => listeners.delete(listener);
    }

    emit(event: string, value?: unknown) {
      for (const listener of this.listeners.get(event) ?? []) listener(value);
    }

    listenerCount(event: string) {
      return this.listeners.get(event)?.size ?? 0;
    }

    listenersFor(event: string) {
      return [...(this.listeners.get(event) ?? [])];
    }
  }

  return {Player};
});

import {ScoreProvider, useCursor, usePlayer, useScore} from '../../src/react/context';

afterEach(() => {
  cleanup();
  playerState.instances.length = 0;
});

describe('ScoreProvider', () => {
  it('keeps the player for stable scores and disposes it when the score changes or unmounts', () => {
    const firstScore = score('first');
    const secondScore = score('second');
    const {rerender, unmount} = render(
      <ScoreProvider score={firstScore} playerOptions={{volume: 0.5} as unknown as PlayerOptions}>
        <ContextProbe />
      </ScoreProvider>,
    );

    const firstPlayer = playerState.instances[0];
    expect(playerState.instances).toHaveLength(1);
    expect(screen.getByTestId('score-id').textContent).toBe('first');
    expect(firstPlayer.listenerCount('cursor')).toBe(1);

    rerender(
      <ScoreProvider score={firstScore} playerOptions={{volume: 0.9} as unknown as PlayerOptions}>
        <ContextProbe />
      </ScoreProvider>,
    );
    expect(playerState.instances).toHaveLength(1);
    expect(firstPlayer.options).toEqual({volume: 0.5});

    rerender(
      <ScoreProvider score={secondScore}>
        <ContextProbe />
      </ScoreProvider>,
    );
    const secondPlayer = playerState.instances[1];
    expect(playerState.instances).toHaveLength(2);
    expect(firstPlayer.stop).toHaveBeenCalledOnce();
    expect(firstPlayer.dispose).toHaveBeenCalledOnce();
    expect(firstPlayer.listenerCount('cursor')).toBe(0);

    unmount();
    expect(secondPlayer.stop).toHaveBeenCalledOnce();
    expect(secondPlayer.dispose).toHaveBeenCalledOnce();
    expect(secondPlayer.listenerCount('cursor')).toBe(0);
  });

  it('propagates cursor events through context', () => {
    render(
      <ScoreProvider score={score('cursor')}>
        <ContextProbe />
      </ScoreProvider>,
    );
    const player = playerState.instances[0];

    act(() => player.emit('cursor', {seconds: 2.5}));

    expect(screen.getByTestId('cursor').textContent).toBe('2.5');
  });

  it('publishes the replacement player cursor immediately and ignores callbacks from the old player', () => {
    const firstScore = score('first-cursor', 0.5);
    const secondScore = score('second-cursor', 1.25);
    const {rerender} = render(
      <ScoreProvider score={firstScore}>
        <ContextProbe />
      </ScoreProvider>,
    );
    const firstPlayer = playerState.instances[0];

    act(() => firstPlayer.emit('cursor', {seconds: 4}));
    expect(screen.getByTestId('cursor').textContent).toBe('4');
    const staleCursorCallback = firstPlayer.listenersFor('cursor')[0]!;

    rerender(
      <ScoreProvider score={secondScore}>
        <ContextProbe />
      </ScoreProvider>,
    );

    expect(screen.getByTestId('cursor').textContent).toBe('1.25');
    act(() => staleCursorCallback({seconds: 7}));
    expect(screen.getByTestId('cursor').textContent).toBe('1.25');
  });

  it('provides the replacement player on score change and disposes each player exactly once', () => {
    const {rerender, unmount} = render(
      <ScoreProvider score={score('one')}>
        <ContextProbe />
      </ScoreProvider>,
    );
    expect(providedInstance()).toBe(playerState.instances[0]);

    rerender(
      <ScoreProvider score={score('two')}>
        <ContextProbe />
      </ScoreProvider>,
    );

    expect(playerState.instances).toHaveLength(2);
    expect(providedInstance()).toBe(playerState.instances[1]);
    expect(screen.getByTestId('score-id').textContent).toBe('two');
    expect(playerState.instances[0]!.dispose).toHaveBeenCalledOnce();
    expect(playerState.instances[1]!.dispose).not.toHaveBeenCalled();

    unmount();
    for (const instance of playerState.instances) {
      expect(instance.stop).toHaveBeenCalledOnce();
      expect(instance.dispose).toHaveBeenCalledOnce();
      expect(instance.listenerCount('cursor')).toBe(0);
    }
  });
});

describe('ScoreProvider under StrictMode', () => {
  it('survives the StrictMode mount -> cleanup -> remount cycle with a live player', () => {
    render(
      <React.StrictMode>
        <ScoreProvider score={score('strict')}>
          <ContextProbe />
        </ScoreProvider>
      </React.StrictMode>,
    );

    // StrictMode's simulated remount must construct a fresh player rather
    // than resubscribe to the instance its simulated unmount disposed.
    expect(playerState.instances.length).toBeGreaterThanOrEqual(2);
    const live = providedInstance();
    expect(live.dispose).not.toHaveBeenCalled();
    expect(live.listenerCount('cursor')).toBe(1);
    for (const instance of playerState.instances) {
      if (instance === live) continue;
      expect(instance.dispose).toHaveBeenCalledOnce();
      expect(instance.listenerCount('cursor')).toBe(0);
    }

    // The live player still drives the UI: playback events reach consumers.
    act(() => live.emit('cursor', {seconds: 3}));
    expect(screen.getByTestId('cursor').textContent).toBe('3');
  });

  it('disposes every constructed player exactly once across a StrictMode unmount', () => {
    const {unmount} = render(
      <React.StrictMode>
        <ScoreProvider score={score('strict-unmount')}>
          <ContextProbe />
        </ScoreProvider>
      </React.StrictMode>,
    );

    unmount();

    expect(playerState.instances.length).toBeGreaterThanOrEqual(2);
    for (const instance of playerState.instances) {
      expect(instance.dispose).toHaveBeenCalledOnce();
      expect(instance.listenerCount('cursor')).toBe(0);
    }
  });
});

function ContextProbe() {
  const currentScore = useScore() as Score & {id: string};
  const player = usePlayer();
  const cursor = useCursor();
  return (
    <>
      <output data-testid="score-id">{currentScore.id}</output>
      <output data-testid="player-ready">{String(Boolean(player))}</output>
      <output data-testid="player-index">
        {playerState.instances.indexOf(player as unknown as MockPlayerInstance)}
      </output>
      <output data-testid="cursor">{cursor.seconds}</output>
    </>
  );
}

/** The Player instance currently provided through context, per ContextProbe. */
function providedInstance(): MockPlayerInstance {
  const index = Number(screen.getByTestId('player-index').textContent);
  expect(index).toBeGreaterThanOrEqual(0);
  return playerState.instances[index]!;
}

function score(id: string, initialSeconds?: number): Score {
  return {id, durationSeconds: 8, initialSeconds} as unknown as Score;
}
