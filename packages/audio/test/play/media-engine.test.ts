import {createAudioClip} from '../../src/core';
import {describe, expect, it, vi} from 'vitest';
import {MediaEngine, type MediaPlaybackAdapter} from '../../src/play/headless/engines/media-engine';

function fakeContext(outputDisconnect = vi.fn()): BaseAudioContext {
  return {
    createGain: () => ({disconnect: outputDisconnect}),
  } as unknown as BaseAudioContext;
}

function streamingClip() {
  return createAudioClip({
    sampleRate: 44_100,
    length: 0,
    numberOfChannels: 2,
    sourceUrl: 'https://example.test/stream.mp3',
  });
}

describe('MediaEngine adapter ownership', () => {
  it('releases a partially initialized adapter when connect throws', async () => {
    const disconnect = vi.fn();
    const dispose = vi.fn();
    const connectError = new Error('graph connect failed');
    const adapter: MediaPlaybackAdapter = {
      duration: 10,
      paused: true,
      ended: false,
      currentTime: 0,
      playbackRate: 1,
      preservesPitch: true,
      loop: false,
      onended: null,
      play: vi.fn(),
      pause: vi.fn(),
      connect: vi.fn(() => {
        throw connectError;
      }),
      disconnect,
      dispose,
    };
    const engine = new MediaEngine(fakeContext(), streamingClip(), {adapterFactory: () => adapter});

    await expect(engine.play()).rejects.toBe(connectError);
    expect(adapter.onended).toBeNull();
    expect(disconnect).toHaveBeenCalledOnce();
    expect(dispose).toHaveBeenCalledOnce();
    engine.dispose();
    expect(disconnect).toHaveBeenCalledOnce();
    expect(dispose).toHaveBeenCalledOnce();
  });

  it('finishes every cleanup step when host adapter hooks throw', async () => {
    const outputDisconnect = vi.fn();
    const pause = vi.fn(() => {
      throw new Error('pause failed');
    });
    const disconnect = vi.fn(() => {
      throw new Error('disconnect failed');
    });
    const dispose = vi.fn(() => {
      throw new Error('dispose failed');
    });
    const adapter: MediaPlaybackAdapter = {
      duration: 10,
      paused: false,
      ended: false,
      currentTime: 0,
      playbackRate: 1,
      loop: false,
      onended: null,
      play: vi.fn(),
      pause,
      connect: vi.fn(),
      disconnect,
      dispose,
    };
    const engine = new MediaEngine(fakeContext(outputDisconnect), streamingClip(), {
      adapterFactory: () => adapter,
    });
    await engine.play();

    expect(() => engine.dispose()).not.toThrow();
    expect(pause).toHaveBeenCalledOnce();
    expect(disconnect).toHaveBeenCalledOnce();
    expect(dispose).toHaveBeenCalledOnce();
    expect(adapter.onended).toBeNull();
    expect(outputDisconnect).toHaveBeenCalledOnce();

    // Adapter ownership was cleared despite failures.
    engine.dispose();
    expect(pause).toHaveBeenCalledOnce();
    expect(disconnect).toHaveBeenCalledOnce();
    expect(dispose).toHaveBeenCalledOnce();
  });

  it('does not recreate a released adapter after disposal', async () => {
    const adapter = loopAdapter();
    const factory = vi.fn(() => adapter);
    const engine = new MediaEngine(fakeContext(), streamingClip(), {adapterFactory: factory});
    engine.prepare();
    engine.dispose();

    engine.prepare();
    engine.seek(2);
    await engine.play();

    expect(factory).toHaveBeenCalledOnce();
    expect(adapter.playCalls).toBe(0);
  });
});

/** Adapter whose position is settable and whose play/pause track paused state. */
function loopAdapter(duration = 10): MediaPlaybackAdapter & {playCalls: number; paused: boolean} {
  return {
    duration,
    paused: true,
    ended: false,
    currentTime: 0,
    playbackRate: 1,
    preservesPitch: true,
    loop: false,
    onended: null,
    playCalls: 0,
    play() {
      this.playCalls++;
      this.paused = false;
    },
    pause() {
      this.paused = true;
    },
    connect: vi.fn(),
    disconnect: vi.fn(),
    dispose: vi.fn(),
  };
}

describe('MediaEngine range loop', () => {
  it('wraps instead of wedging when the media ends before the watcher fires', async () => {
    const adapter = loopAdapter(10);
    const engine = new MediaEngine(fakeContext(), streamingClip(), {
      adapterFactory: () => adapter,
      // End at the real duration: the element reaches its natural end first.
      loop: {start: 2, end: 10},
    });
    let ended = 0;
    engine.onEnded(() => ended++);
    await engine.play();
    adapter.playCalls = 0;

    adapter.currentTime = 10;
    adapter.paused = true;
    adapter.onended?.();

    // Wrapped back into the region and resumed, rather than parking paused
    // with the end callback suppressed by the active range loop.
    expect(adapter.currentTime).toBe(2);
    expect(adapter.playCalls).toBe(1);
    expect(ended).toBe(0);
    engine.dispose();
  });

  it('clamps the loop end to the real media duration', async () => {
    // The declared clip duration is metadata and may exceed the real stream.
    const adapter = loopAdapter(4);
    const engine = new MediaEngine(fakeContext(), streamingClip(), {
      adapterFactory: () => adapter,
      loop: {start: 1, end: 30},
    });
    await engine.play();

    adapter.currentTime = 4;
    adapter.onended?.();
    expect(adapter.currentTime).toBe(1);
    engine.dispose();
  });

  it('retracts a late automatic range-loop restart after pause', async () => {
    const adapter = loopAdapter(10);
    let finishRestart!: () => void;
    let calls = 0;
    adapter.play = vi.fn(() => {
      calls++;
      if (calls === 1) {
        adapter.paused = false;
        return;
      }
      return new Promise<void>((resolve) => {
        finishRestart = () => {
          adapter.paused = false;
          resolve();
        };
      });
    });
    const engine = new MediaEngine(fakeContext(), streamingClip(), {
      adapterFactory: () => adapter,
      loop: {start: 2, end: 10},
    });
    await engine.play();

    adapter.currentTime = 10;
    adapter.paused = true;
    adapter.onended?.();
    engine.pause();
    finishRestart();
    await Promise.resolve();
    await Promise.resolve();

    expect(engine.playing).toBe(false);
    engine.dispose();
  });

  it('still reports the natural end when no range loop is active', async () => {
    const adapter = loopAdapter(10);
    const engine = new MediaEngine(fakeContext(), streamingClip(), {
      adapterFactory: () => adapter,
    });
    let ended = 0;
    engine.onEnded(() => ended++);
    await engine.play();

    adapter.onended?.();
    expect(ended).toBe(1);
    engine.dispose();
  });
});

describe('MediaEngine play/seek contract', () => {
  it('plays a streaming slice in clip seconds and ends at its source boundary', async () => {
    vi.useFakeTimers();
    try {
      const adapter = loopAdapter(10);
      const source = createAudioClip({sampleRate: 10, length: 100, numberOfChannels: 2,
        sourceUrl: 'https://example.test/stream.mp3'});
      const engine = new MediaEngine(fakeContext(), source.slice(5, 8), {adapterFactory: () => adapter});
      const ended = vi.fn();
      engine.onEnded(ended);

      await engine.play();
      expect(adapter.currentTime).toBe(5);
      expect(engine.currentTime).toBe(0);
      expect(engine.duration).toBe(3);
      engine.seek(2);
      expect(adapter.currentTime).toBe(7);
      expect(engine.currentTime).toBe(2);
      adapter.currentTime = 8;
      vi.advanceTimersByTime(35);
      expect(adapter.paused).toBe(true);
      expect(ended).toHaveBeenCalledOnce();
      expect(engine.currentTime).toBe(3);
      engine.stop();
      expect(adapter.currentTime).toBe(5);
      engine.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it('loops only inside a bounded streaming slice', async () => {
    vi.useFakeTimers();
    try {
      const adapter = loopAdapter(10);
      const source = createAudioClip({sampleRate: 10, length: 100, numberOfChannels: 2,
        sourceUrl: 'https://example.test/stream.mp3'});
      const engine = new MediaEngine(fakeContext(), source.slice(5, 8), {
        adapterFactory: () => adapter, loop: true,
      });
      await engine.play();
      expect(adapter.loop).toBe(false);
      adapter.currentTime = 8;
      vi.advanceTimersByTime(35);
      expect(adapter.currentTime).toBe(5);
      expect(adapter.paused).toBe(false);
      engine.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it('treats play(offset) on a running engine as a no-op, like the buffer engine', async () => {
    const adapter = loopAdapter(10);
    const engine = new MediaEngine(fakeContext(), streamingClip(), {
      adapterFactory: () => adapter,
    });

    await engine.play(2);
    expect(adapter.currentTime).toBe(2);
    adapter.playCalls = 0;

    // Already running: the offset positions a START, so it must not relocate
    // the playhead — that is seek()'s job, and both engines honour it.
    await engine.play(8);
    expect(adapter.currentTime).toBe(2);
    expect(adapter.playCalls).toBe(0);

    engine.seek(8);
    expect(adapter.currentTime).toBe(8);
    engine.dispose();
  });

  it('still applies the offset when starting from a paused state', async () => {
    const adapter = loopAdapter(10);
    const engine = new MediaEngine(fakeContext(), streamingClip(), {
      adapterFactory: () => adapter,
    });

    await engine.play(3);
    expect(adapter.currentTime).toBe(3);
    engine.pause();
    await engine.play(6);
    expect(adapter.currentTime).toBe(6);
    engine.dispose();
  });

  it('retracts a late adapter start after pause', async () => {
    let finishPlay!: () => void;
    const adapter = loopAdapter();
    adapter.play = vi.fn(() => new Promise<void>((resolve) => {
      finishPlay = () => {
        adapter.paused = false;
        resolve();
      };
    }));
    const engine = new MediaEngine(fakeContext(), streamingClip(), {
      adapterFactory: () => adapter,
    });

    const start = engine.play();
    engine.pause();
    finishPlay();
    await start;

    expect(engine.playing).toBe(false);
    engine.dispose();
  });

  it('does not start range-loop work during preload or while paused', async () => {
    vi.useFakeTimers();
    try {
      const adapter = loopAdapter();
      const engine = new MediaEngine(fakeContext(), streamingClip(), {
        adapterFactory: () => adapter,
        loop: {start: 1, end: 8},
      });

      engine.prepare();
      expect(vi.getTimerCount()).toBe(0);
      await engine.play();
      expect(vi.getTimerCount()).toBe(1);
      engine.pause();
      expect(vi.getTimerCount()).toBe(0);
      engine.dispose();
    } finally {
      vi.useRealTimers();
    }
  });
});


describe('MediaEngine unusable loop ranges', () => {
  it.each([
    {start: 8, end: 2},
    {start: 2, end: 2},
    {start: 0, end: NaN},
    {start: -Infinity, end: 2},
    {start: 0, end: Infinity},
  ])('rejects malformed bounds before allocating an adapter: %o', (loop) => {
    const factory = vi.fn(() => loopAdapter());
    expect(() => new MediaEngine(fakeContext(), streamingClip(), {
      adapterFactory: factory,
      loop,
    })).toThrow(RangeError);
    expect(factory).not.toHaveBeenCalled();
  });

  it('leaves an accepted loop intact when a later option is rejected', async () => {
    const adapter = loopAdapter();
    const range = {start: 1, end: 8};
    const engine = new MediaEngine(fakeContext(), streamingClip(), {
      adapterFactory: () => adapter,
      loop: range,
    });
    await engine.play();
    range.start = 20;

    expect(() => engine.setLoop({start: 8, end: 2})).toThrow(RangeError);
    adapter.currentTime = 10;
    adapter.paused = true;
    adapter.onended?.();

    expect(adapter.currentTime).toBe(1);
    expect(adapter.playCalls).toBe(2);
    engine.dispose();
  });

  it('ends normally when real metadata leaves no playable span', async () => {
    vi.useFakeTimers();
    try {
      const adapter = loopAdapter(10);
      const engine = new MediaEngine(fakeContext(), streamingClip(), {
        adapterFactory: () => adapter,
        loop: {start: 8, end: 10},
      });
      const ended = vi.fn();
      engine.onEnded(ended);
      await engine.play();
      expect(vi.getTimerCount()).toBe(1);
      Object.defineProperty(adapter, 'duration', {value: 5});

      await vi.advanceTimersByTimeAsync(30);
      expect(vi.getTimerCount()).toBe(0);
      adapter.currentTime = 5;
      adapter.paused = true;
      adapter.onended?.();
      adapter.onended?.();

      expect(ended).toHaveBeenCalledOnce();
      expect(adapter.playCalls).toBe(1);
      expect(engine.playing).toBe(false);
      expect(vi.getTimerCount()).toBe(0);
      engine.dispose();
    } finally {
      vi.useRealTimers();
    }
  });
});
