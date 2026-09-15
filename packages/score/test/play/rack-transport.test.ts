import {describe, expect, it, vi} from 'vitest';
import type {Rack} from '../../src/play/headless/rack';
import {RackTransportController} from '../../src/play/headless/rack-transport';

function rackFixture() {
  const listeners = new Map<string, Set<() => void>>();
  const long = {
    durationSeconds: 10,
    seconds: 2.5,
    progress: 0.25,
    seek: vi.fn(),
  };
  const short = {
    durationSeconds: 4,
    seconds: 2,
    progress: 0.5,
    seek: vi.fn(),
  };
  const rack = {
    list: () => [{player: short}, {player: long}],
    play: vi.fn<() => Promise<void>>(async () => undefined),
    pause: vi.fn(),
    stop: vi.fn(),
    on: vi.fn((event: string, listener: () => void) => {
      const group = listeners.get(event) ?? new Set<() => void>();
      group.add(listener);
      listeners.set(event, group);
      return vi.fn(() => group.delete(listener));
    }),
  };
  const emit = (event: string) => {
    for (const listener of listeners.get(event) ?? []) listener();
  };
  return {rack: rack as unknown as Rack, rawRack: rack, long, short, emit};
}

describe('RackTransportController', () => {
  it('owns longest-member progress and lockstep seek without owning the Rack', () => {
    const {rack, rawRack, long, short} = rackFixture();
    const controller = new RackTransportController(rack, {
      requestFrame: vi.fn(() => 1),
      cancelFrame: vi.fn(),
    });

    expect(controller.snapshot).toEqual({
      playing: false,
      progress: 0.25,
      currentTime: 2.5,
      duration: 10,
    });

    controller.seekFraction(0.75);
    expect(short.seek).toHaveBeenCalledWith(4);
    expect(long.seek).toHaveBeenCalledWith(7.5);

    controller.destroy();
    controller.destroy();
    expect(rawRack.stop).not.toHaveBeenCalled();
    expect(rawRack).not.toHaveProperty('dispose', expect.anything());
  });

  it('publishes transport/time/end state from the headless clock', async () => {
    const {rack, rawRack, emit} = rackFixture();
    let frame: ((timestamp: number) => void) | undefined;
    const states: string[] = [];
    const controller = new RackTransportController(rack, {
      requestFrame: (callback) => {
        frame = callback;
        return 1;
      },
      cancelFrame: vi.fn(),
    });
    controller.on('transportchange', ({playing}) => states.push(`transport:${playing}`));
    controller.on('timeupdate', ({progress}) => states.push(`time:${progress}`));
    controller.on('end', ({playing}) => states.push(`end:${playing}`));

    await controller.play();
    frame?.(0);
    emit('end');

    expect(states).toEqual(['transport:true', 'time:0.25', 'transport:false', 'time:0.25', 'end:false']);
    expect(controller.playing).toBe(false);
    expect(rawRack.pause).not.toHaveBeenCalled();
    controller.destroy();
  });

  it('does not restart the ticker after a time listener pauses it', async () => {
    const {rack} = rackFixture();
    const frames: Array<(timestamp: number) => void> = [];
    const requestFrame = vi.fn((callback: (timestamp: number) => void) => {
      frames.push(callback);
      return frames.length;
    });
    const controller = new RackTransportController(rack, {
      requestFrame,
      cancelFrame: vi.fn(),
    });
    controller.on('timeupdate', () => controller.pause());

    await controller.play();
    expect(requestFrame).toHaveBeenCalledOnce();
    frames[0]?.(0);

    expect(controller.playing).toBe(false);
    expect(requestFrame).toHaveBeenCalledOnce();
    controller.destroy();
  });

  it('invalidates a pending start when paused and rolls back the stale backend', async () => {
    const {rack, rawRack} = rackFixture();
    let resolvePlay!: () => void;
    rawRack.play.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolvePlay = resolve;
        }),
    );
    const controller = new RackTransportController(rack, {
      requestFrame: vi.fn(() => 1),
      cancelFrame: vi.fn(),
    });

    const pending = controller.play();
    controller.pause();
    resolvePlay();
    await pending;

    expect(controller.playing).toBe(false);
    // Immediate pause plus stale-start rollback after the backend settles.
    expect(rawRack.pause).toHaveBeenCalledTimes(2);
    controller.destroy();
  });

  it('lets a synchronous pause subscriber cancel play before it reaches the Rack', async () => {
    const {rack, rawRack} = rackFixture();
    const controller = new RackTransportController(rack);
    controller.on('transportchange', ({playing}) => {
      if (playing) controller.pause();
    });

    await controller.play();

    expect(controller.playing).toBe(false);
    expect(rawRack.play).not.toHaveBeenCalled();
    expect(rawRack.pause).toHaveBeenCalledOnce();
    controller.destroy();
  });

  it('stops a pending start on destroy and pauses it if it settles later', async () => {
    const {rack, rawRack} = rackFixture();
    let resolvePlay!: () => void;
    rawRack.play.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolvePlay = resolve;
        }),
    );
    const controller = new RackTransportController(rack);

    const pending = controller.play();
    controller.destroy();
    resolvePlay();
    await pending;

    expect(rawRack.stop).toHaveBeenCalledOnce();
    expect(rawRack.pause).toHaveBeenCalledOnce();
  });

  it('finishes backend and subscription cleanup when the injected frame canceller throws', async () => {
    const pauseFixture = rackFixture();
    const cancelFailure = new Error('cancel failed');
    const pauseController = new RackTransportController(pauseFixture.rack, {
      requestFrame: () => 1,
      cancelFrame: () => {
        throw cancelFailure;
      },
    });
    await pauseController.play();

    expect(() => pauseController.pause()).toThrow(cancelFailure);
    expect(pauseFixture.rawRack.pause).toHaveBeenCalledOnce();
    expect(pauseController.playing).toBe(false);
    pauseController.destroy();

    const destroyFixture = rackFixture();
    const destroyController = new RackTransportController(destroyFixture.rack, {
      requestFrame: () => 2,
      cancelFrame: () => {
        throw cancelFailure;
      },
    });
    const unsubscribe = destroyFixture.rawRack.on.mock.results[0]?.value as ReturnType<typeof vi.fn>;
    await destroyController.play();

    expect(() => destroyController.destroy()).toThrow(cancelFailure);
    expect(destroyFixture.rawRack.stop).toHaveBeenCalledOnce();
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(destroyController.playing).toBe(false);
  });
});
