// @vitest-environment jsdom

import {act, cleanup, fireEvent, render, renderHook} from '@testing-library/react';
import type {AudioClip} from '../../src/core';
import {afterEach, describe, expect, it, vi} from 'vitest';

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(reason: unknown): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return {promise, resolve, reject};
}

const mocks = vi.hoisted(() => ({
  loadRequests: [] as Array<{src: string; signal?: AbortSignal; request: Deferred<unknown>}>,
  players: [] as Array<any>,
  recorders: [] as Array<any>,
  analysisRequests: [] as Array<Deferred<unknown>>,
  renderWaveform: vi.fn(),
  bindWaveform: vi.fn(),
  computePeaks: vi.fn(() => ({levels: []})),
}));

vi.mock('../../src/play/api', () => ({
  loadClipFromUrl: vi.fn((src: string, options?: {signal?: AbortSignal}) => {
    const request = deferred<unknown>();
    mocks.loadRequests.push({src, signal: options?.signal, request});
    return request.promise;
  }),
}));

vi.mock('../../src/play/headless', () => {
  class AudioClipPlayer {
    readonly listeners = new Map<string, Set<(value: any) => void>>();
    readonly dispose = vi.fn();
    readonly pause = vi.fn(() => {
      this.playing = false;
    });
    readonly stop = vi.fn(() => {
      this.playing = false;
      this.seconds = 0;
    });
    readonly seek = vi.fn((seconds: number) => {
      this.seconds = seconds;
    });
    readonly setRate = vi.fn();
    readonly setVolume = vi.fn();
    readonly duration: number;
    seconds = 0;
    playing = false;
    playRequest: Deferred<void> | undefined;

    constructor(readonly clip: AudioClip) {
      this.duration = clip.duration;
      mocks.players.push(this);
    }

    on(event: string, listener: (value: any) => void): () => void {
      const listeners = this.listeners.get(event) ?? new Set();
      listeners.add(listener);
      this.listeners.set(event, listeners);
      return () => listeners.delete(listener);
    }

    emit(event: string, value: unknown): void {
      for (const listener of this.listeners.get(event) ?? []) listener(value);
    }

    async play(): Promise<void> {
      if (this.playRequest) await this.playRequest.promise;
      this.playing = true;
    }
  }

  class AudioRecorder {
    readonly listeners = new Map<string, Set<(value: any) => void>>();
    readonly dispose = vi.fn();
    startRequest: Deferred<void> | undefined;
    stopRequest: Deferred<AudioClip> | undefined;
    isRecording = false;

    constructor() {
      mocks.recorders.push(this);
    }

    on(event: string, listener: (value: any) => void): () => void {
      const listeners = this.listeners.get(event) ?? new Set();
      listeners.add(listener);
      this.listeners.set(event, listeners);
      return () => listeners.delete(listener);
    }

    async start(): Promise<void> {
      if (this.startRequest) await this.startRequest.promise;
      this.isRecording = true;
    }

    async stop(): Promise<AudioClip> {
      if (!this.stopRequest) throw new Error('No stop result configured');
      this.isRecording = false;
      return this.stopRequest.promise;
    }
  }

  return {AudioClipPlayer, AudioRecorder};
});

vi.mock('../../src/analyze/api', () => ({
  computePeaks: mocks.computePeaks,
}));

vi.mock('../../src/analyze/headless', () => ({
  createAudioAnalysisSession: vi.fn(() => ({
    analyze: () => {
      const request = deferred<unknown>();
      mocks.analysisRequests.push(request);
      return request.promise;
    },
  })),
}));

vi.mock('../../src/view/render', () => ({
  renderWaveformVisualizer: mocks.renderWaveform,
  bindPlayerToWaveform: mocks.bindWaveform,
}));

import {
  WaveformView,
  useAudioAnalysis,
  useAudioClip,
  useAudioClipPlayer,
  useAudioRecorder,
} from '../../src/react/index';

afterEach(() => {
  cleanup();
  mocks.loadRequests.length = 0;
  mocks.players.length = 0;
  mocks.recorders.length = 0;
  mocks.analysisRequests.length = 0;
  mocks.renderWaveform.mockReset();
  mocks.bindWaveform.mockReset();
  mocks.computePeaks.mockClear();
});

describe('useAudioClip', () => {
  it('publishes only the latest URL result and clears state for a null source', async () => {
    const first = clip('first', 1);
    const second = clip('second', 2);
    const {result, rerender} = renderHook(({src}) => useAudioClip(src), {
      initialProps: {src: '/first.wav' as string | null},
    });

    rerender({src: '/second.wav'});
    expect(mocks.loadRequests[0].signal?.aborted).toBe(true);
    await act(async () => mocks.loadRequests[0].request.resolve(first));
    expect(result.current).toEqual({clip: null, loading: true, error: null});

    await act(async () => mocks.loadRequests[1].request.resolve(second));
    expect(result.current).toEqual({clip: second, loading: false, error: null});

    rerender({src: '/broken.wav'});
    const failure = new Error('decode failed');
    await act(async () => mocks.loadRequests[2].request.reject(failure));
    expect(result.current).toEqual({clip: null, loading: false, error: failure});

    rerender({src: null});
    expect(result.current).toEqual({clip: null, loading: false, error: null});
  });
});

describe('useAudioClipPlayer', () => {
  it('does not let an old play completion mutate a replacement player', async () => {
    const first = clip('first', 4);
    const second = clip('second', 8);
    const {result, rerender} = renderHook(({current}) => useAudioClipPlayer(current), {
      initialProps: {current: first as AudioClip | null},
    });
    const firstPlayer = mocks.players[0];
    firstPlayer.playRequest = deferred<void>();

    let playPromise!: Promise<void>;
    act(() => {
      playPromise = result.current.play();
    });
    rerender({current: second});
    expect(firstPlayer.dispose).toHaveBeenCalledOnce();
    expect(result.current.playing).toBe(false);
    expect(result.current.duration).toBe(8);

    await act(async () => firstPlayer.playRequest.resolve());
    await playPromise;
    expect(result.current.playing).toBe(false);

    rerender({current: null});
    expect(result.current).toMatchObject({
      player: null,
      playing: false,
      seconds: 0,
      duration: 0,
      progress: 0,
      error: null,
    });
  });

  it('surfaces a current playback rejection without claiming to be playing', async () => {
    const currentClip = clip('failure', 3);
    const {result} = renderHook(() => useAudioClipPlayer(currentClip));
    const player = mocks.players[0];
    player.playRequest = deferred<void>();
    const failure = new Error('context resume failed');

    let request!: Promise<void>;
    act(() => {
      request = result.current.play();
    });
    const rejection = expect(request).rejects.toBe(failure);
    await act(async () => {
      player.playRequest.reject(failure);
      await rejection;
    });
    expect(result.current.playing).toBe(false);
    expect(result.current.error).toBe(failure);
  });
});

describe('useAudioAnalysis', () => {
  it('clears pending/error state when its clip is removed and ignores the stale request', async () => {
    const {result, rerender} = renderHook(({current}) => useAudioAnalysis(current), {
      initialProps: {current: clip('first', 1) as AudioClip | null},
    });
    expect(result.current).toEqual({result: null, analyzing: true, error: null});

    rerender({current: null});
    expect(result.current).toEqual({result: null, analyzing: false, error: null});
    await act(async () => mocks.analysisRequests[0].reject(new Error('stale failure')));
    expect(result.current).toEqual({result: null, analyzing: false, error: null});

    rerender({current: clip('second', 2)});
    const currentFailure = new Error('analysis failed');
    await act(async () => mocks.analysisRequests[1].reject(currentFailure));
    expect(result.current).toEqual({result: null, analyzing: false, error: currentFailure});
  });
});

describe('useAudioRecorder', () => {
  it('disposes the recorder on unmount and ignores a pending start completion', async () => {
    const {result, unmount} = renderHook(() => useAudioRecorder());
    const recorder = mocks.recorders[0];
    recorder.startRequest = deferred<void>();

    let request!: Promise<void>;
    act(() => {
      request = result.current.start();
    });
    unmount();
    expect(recorder.dispose).toHaveBeenCalledOnce();

    recorder.startRequest.resolve();
    await request;
  });
});

describe('WaveformView', () => {
  it('passes the rendered surface to the binding and supports keyboard seeking', () => {
    const visualizer = {dispose: vi.fn()};
    const unsubscribe = vi.fn();
    mocks.renderWaveform.mockReturnValue(visualizer);
    mocks.bindWaveform.mockReturnValue({unsubscribe});
    const player = {
      duration: 100,
      seconds: 25,
      seek: vi.fn(),
      on: vi.fn(() => vi.fn()),
    } as any;

    const {container, unmount} = render(
      <WaveformView clip={clip('wave', 100)} player={player} seekOnClick />,
    );
    const surface = container.firstElementChild as HTMLDivElement;
    const renderSurface = surface.firstElementChild as HTMLDivElement;
    expect(surface.style.padding).toContain('--wm-component-padding');
    expect(surface.style.border).toContain('--wm-component-border');
    expect(surface.style.background).toContain('--wm-component-background');
    expect(mocks.bindWaveform).toHaveBeenCalledWith(
      player,
      visualizer,
      expect.objectContaining({surface: renderSurface, seekOnClick: true}),
    );
    expect(surface.getAttribute('role')).toBe('slider');

    fireEvent.keyDown(surface, {key: 'ArrowRight'});
    expect(player.seek).toHaveBeenCalledWith(26);

    unmount();
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(visualizer.dispose).toHaveBeenCalledOnce();
  });
});

function clip(id: string, duration: number): AudioClip {
  return {
    id,
    duration,
    sampleRate: 100,
    channels: () => [new Float32Array(Math.max(1, duration * 100))],
  } as unknown as AudioClip;
}
