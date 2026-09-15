// The custom element remains SSR-safe, so this test uses a tiny host graft
// rather than a browser DOM. It verifies the event seam consumed by optional
// view/analyze packages without making either package a runtime dependency.
import {afterEach, describe, expect, it, vi} from 'vitest';
import type {Score, TimePosition} from '../../src/core';

interface LoadRequest {
  url: string;
  signal: AbortSignal;
  resolve(score: Score): void;
}

const state = vi.hoisted(() => ({
  scores: [] as Score[],
  loadRequests: [] as LoadRequest[],
  options: [] as Array<{
    onCursor?: (position: TimePosition) => void;
    onPause?: () => void;
    onEnd?: () => void;
    audioContext?: AudioContext;
    synth?: unknown;
    timeControl?: string;
    volumeControl?: string;
    volume?: number;
    effect?: unknown;
    onVolumeChange?: (volume: number) => void;
  }>,
  soundfontContexts: [] as AudioContext[],
  player: {
    seconds: 0.75,
    durationSeconds: 1,
    progress: 0.75,
    setRate: vi.fn(),
    setVolume: vi.fn(),
    setPan: vi.fn(),
    setLoop: vi.fn(),
    clearLoop: vi.fn(),
  },
  destroy: vi.fn(),
  controllerDestroy: vi.fn(),
  setChrome: vi.fn(),
}));

vi.mock('../../src/io/load', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../src/io/load')>();
  return {
    ...original,
    loadScoreFromUrl: vi.fn((url: string, options: {signal?: AbortSignal} = {}) => {
      const signal = options.signal;
      if (!signal) throw new Error('<score-player> did not pass an AbortSignal');
      let resolvePromise!: (score: Score) => void;
      let rejectPromise!: (reason: unknown) => void;
      const promise = new Promise<Score>((resolve, reject) => {
        resolvePromise = resolve;
        rejectPromise = reject;
      });
      const abort = () => rejectPromise(new Error('aborted'));
      if (signal.aborted) abort();
      else signal.addEventListener('abort', abort, {once: true});
      state.loadRequests.push({url, signal, resolve: resolvePromise});
      return promise;
    }),
  };
});

vi.mock('../../src/play/headless/soundfont-synth', () => ({
  createSoundfontSynth: vi.fn((context: AudioContext) => {
    state.soundfontContexts.push(context);
    return {connect: vi.fn(() => vi.fn()), noteOn: vi.fn(), dispose: vi.fn()};
  }),
}));

vi.mock('../../src/play/element/internal/preset-player', () => ({
  mountPresetPlayer: vi.fn(
    (score: Score, _container: HTMLElement, options: {onCursor?: (position: TimePosition) => void}) => {
      state.scores.push(score);
      state.options.push(options);
      return {
        player: state.player,
        destroy: state.destroy,
        play: () => Promise.resolve(),
        pause: vi.fn(),
        stop: vi.fn(),
        isPlaying: () => false,
        setChrome: state.setChrome,
      };
    },
  ),
  mountRackPlayer: vi.fn(),
  mountControllerPlayer: vi.fn(() => ({
    destroy: state.controllerDestroy,
    play: () => Promise.resolve(),
    pause: vi.fn(),
    stop: vi.fn(),
    isPlaying: () => false,
    setChrome: state.setChrome,
  })),
}));

import {
  ScorePlayerElement,
  SimpleScorePlayerElement,
  type ScorePlayerTimeUpdateEventDetail,
} from '../../src/play/element/score-player';
import {WebMusicElement} from '../../src/play/element/internal/base';
import {
  mountControllerPlayer,
  mountPresetPlayer,
  mountRackPlayer,
  type PresetPlayerHandle,
  type PresetPlayerOptions,
  type RackPlayerOptions,
} from '../../src/play/element/internal/preset-player';
import type {PlayerController} from '../../src/play/headless/controller';
import type {Rack} from '../../src/play/headless/rack';
import {Effect} from '../../src/play/headless/effects';

if (typeof (globalThis as Record<string, unknown>).CustomEvent === 'undefined') {
  class NodeCustomEvent<T = unknown> extends Event {
    detail: T;
    constructor(type: string, init: {detail?: T; bubbles?: boolean} = {}) {
      super(type, {bubbles: init.bubbles ?? false});
      this.detail = init.detail as T;
    }
  }
  (globalThis as Record<string, unknown>).CustomEvent = NodeCustomEvent;
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function mount(
  score: Score | null = {} as Score,
  options: {
    attributes?: Record<string, string>;
    audioContext?: AudioContext;
    /** A `<rack-control>` above this element, which makes it a part. */
    desk?: unknown;
    /** A `<rack-control>` written inside it, which makes it the master. */
    nestedDesk?: unknown;
  } = {},
  ElementCtor: typeof ScorePlayerElement = ScorePlayerElement,
) {
  const element = new ElementCtor() as ScorePlayerElement & Record<string, unknown>;
  // The DOM lib declares isConnected readonly; the test drives it directly.
  const connectable = element as {isConnected: boolean};
  const events: Event[] = [];
  const attributes = {...options.attributes};
  connectable.isConnected = false;
  element.getAttribute = (name: string) => attributes[name] ?? null;
  element.setAttribute = (name: string, value: string) => {
    attributes[name] = value;
    if (element.isConnected) element.attributeChangedCallback(name);
  };
  element.removeAttribute = (name: string) => {
    delete attributes[name];
    if (element.isConnected) element.attributeChangedCallback(name);
  };
  element.replaceChildren = vi.fn();
  element.dispatchEvent = (event: Event) => {
    events.push(event);
    return true;
  };
  // The element now reads the tree around it — a desk above makes it a part, a
  // desk below makes it the master — and mounts a rack transport into a host of
  // its own rather than over its children. None of that existed when this
  // harness was written, so the surface it grafts on has to grow with it.
  element.addEventListener = vi.fn();
  element.removeEventListener = vi.fn();
  element.closest = (selector: string) => (options.desk && selector === 'rack-control' ? options.desk : null);
  element.querySelector = () => options.nestedDesk ?? null;
  element.insertBefore = vi.fn(<T>(node: T) => node) as unknown as typeof element.insertBefore;
  Object.defineProperty(element, 'firstChild', {configurable: true, value: null});
  Object.defineProperty(element, 'ownerDocument', {
    configurable: true,
    value: {createElement: () => ({dataset: {}, remove: vi.fn(), parentElement: element})},
  });
  element.score = score ?? undefined;
  if (options.audioContext) element.audioContext = options.audioContext;
  connectable.isConnected = true;
  element.connectedCallback();
  return {element, events};
}

afterEach(() => {
  state.scores.length = 0;
  state.loadRequests.length = 0;
  state.options.length = 0;
  state.soundfontContexts.length = 0;
  state.destroy.mockClear();
  state.controllerDestroy.mockClear();
  state.player.seconds = 0.75;
  state.player.durationSeconds = 1;
  state.player.progress = 0.75;
  state.player.setRate.mockClear();
  state.player.setVolume.mockClear();
  state.player.setPan.mockClear();
  state.player.setLoop.mockClear();
  state.player.clearLoop.mockClear();
  state.setChrome.mockClear();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe('score player element compatibility', () => {
  it('keeps the deprecated element as a distinct constructor', () => {
    expect(SimpleScorePlayerElement).not.toBe(ScorePlayerElement);
    expect(new SimpleScorePlayerElement()).toBeInstanceOf(ScorePlayerElement);
  });
});

describe('<score-player> transport events', () => {
  it('keeps rack > score > src precedence at the light-DOM composition boundary', async () => {
    const directScore = {id: 'direct'} as unknown as Score;
    const rack = {id: 'rack'};
    const {element} = mount(directScore, {attributes: {src: 'ignored.mid'}});
    element.rack = rack as never;
    await flush();

    // Into a host of the element's own, never the element: the facade calls
    // `replaceChildren()` on its container, and a master's children are the
    // desk and the parts it is the transport for.
    const [rackArg, hostArg, optionsArg] = vi.mocked(mountRackPlayer).mock.calls.at(-1)!;
    expect(rackArg).toBe(rack);
    expect(hostArg).not.toBe(element);
    expect(optionsArg).toMatchObject({timeControl: 'off', onError: expect.any(Function)});
    expect(element.insertBefore).toHaveBeenCalled();
    expect(mountPresetPlayer).not.toHaveBeenCalled();
    expect(state.loadRequests).toHaveLength(0);

    element.rack = undefined;
    await flush();
    expect(mountPresetPlayer).toHaveBeenCalledWith(directScore, expect.objectContaining({parentElement: element}), expect.any(Object));
    element.disconnectedCallback();
  });

  it('puts a borrowed controller ahead of rack, score and src, and loads nothing for it', async () => {
    const controller = {id: 'borrowed'} as unknown as PlayerController;
    const {element} = mount({id: 'direct'} as unknown as Score, {attributes: {src: 'ignored.mid'}});
    element.controller = controller;
    await flush();

    expect(vi.mocked(mountControllerPlayer)).toHaveBeenCalledWith(controller, expect.objectContaining({parentElement: element}), {timeControl: 'off', onError: expect.any(Function)});
    expect(mountPresetPlayer).not.toHaveBeenCalled();
    expect(state.loadRequests).toHaveLength(0);
    expect(element.controller).toBe(controller);

    // A rack assigned while the controller is borrowed never takes the mount.
    element.rack = {id: 'rack'} as never;
    await flush();
    expect(mountRackPlayer).not.toHaveBeenCalled();
    expect(vi.mocked(mountControllerPlayer)).toHaveBeenCalledTimes(2);

    element.disconnectedCallback();
  });

  it('unmounts a borrowed controller without adopting it, then falls back to the score', async () => {
    const controller = {
      setRate: vi.fn(),
      destroy: vi.fn(),
    } as unknown as PlayerController;
    const directScore = {id: 'after-controller'} as unknown as Score;
    const {element} = mount(directScore);
    element.controller = controller;
    await flush();

    // Transport writes reach the borrowed controller; the element owns no engine.
    element.rate = 1.5;
    expect(controller.setRate).toHaveBeenCalledWith(1.5);
    expect(state.player.setRate).not.toHaveBeenCalled();

    element.controller = undefined;
    await flush();

    // Only the element's own UI facade is torn down — never the caller's controller.
    expect(state.controllerDestroy).toHaveBeenCalledTimes(1);
    expect(controller.destroy).not.toHaveBeenCalled();
    expect(mountPresetPlayer).toHaveBeenCalledWith(directScore, expect.objectContaining({parentElement: element}), expect.any(Object));

    element.disconnectedCallback();
  });

  it('uses the shared element lifetime and exposes score resolution/mount inheritance seams', async () => {
    const resolvedScore = {id: 'resolved-by-subclass'} as unknown as Score;
    const resolveScore = vi.fn(async (_signal: AbortSignal) => resolvedScore);
    const mountScore = vi.fn();

    class CustomScorePlayerElement extends ScorePlayerElement {
      protected override resolveScore(signal: AbortSignal): Promise<Score | undefined> {
        return resolveScore(signal);
      }

      protected override mountScore(score: Score, options: PresetPlayerOptions): PresetPlayerHandle {
        mountScore(score, options);
        return super.mountScore(score, options);
      }
    }

    const {element} = mount(null, {attributes: {src: 'custom.score'}}, CustomScorePlayerElement);
    expect(element).toBeInstanceOf(WebMusicElement);
    await flush();

    expect(resolveScore).toHaveBeenCalledTimes(1);
    expect(mountScore).toHaveBeenCalledWith(resolvedScore, expect.any(Object));
    element.disconnectedCallback();
    expect(state.destroy).toHaveBeenCalledTimes(1);
  });

  it('labels nominal score and rate-scaled transport coordinates separately', async () => {
    const {element, events} = mount();
    await flush();

    state.player.seconds = 0.5;
    state.player.durationSeconds = 1;
    state.player.progress = 0.5;
    state.options[0]?.onCursor?.({seconds: 1} as TimePosition);

    const event = events.find((candidate) => candidate.type === 'webscore:timeupdate') as
      CustomEvent<ScorePlayerTimeUpdateEventDetail> | undefined;
    expect(event?.detail).toEqual({
      nominalSeconds: 1,
      rate: 1,
      playing: false,
      transportSeconds: 0.5,
      transportDurationSeconds: 1,
      progress: 0.5,
      // Existing score-timeline consumers retain their nominal coordinate.
      seconds: 1,
      // Existing progress consumers retain their transport duration.
      duration: 1,
    });

    element.disconnectedCallback();
  });

  it('does not publish an old score when a mount setter replaces its owner reentrantly', async () => {
    const first = {id: 'old'} as unknown as Score;
    const next = {id: 'new'} as unknown as Score;
    const {element, events} = mount(first);
    state.player.setRate.mockImplementationOnce(() => { element.score = next; });
    await flush();
    await flush();
    expect(element.resolvedScore).toBe(next);
    const resolved = events.filter((event) => event.type === 'webscore:scorechange')
      .map((event) => (event as CustomEvent).detail.score);
    expect(resolved).not.toContain(first);
    expect(resolved).toContain(next);
    // The replaced pass never reaches the setters after its reentrant rate callback.
    expect(state.player.setVolume).toHaveBeenCalledTimes(1);
    expect(state.player.setPan).toHaveBeenCalledTimes(1);
    expect(state.destroy).toHaveBeenCalledTimes(1);
    element.disconnectedCallback();
  });

  it('exposes the resolved src once and invalidates it before a replacement finishes', async () => {
    const {element, events} = mount(null, {attributes: {src: 'first.mid'}});
    expect(element.resolvedScore).toBeUndefined();
    await vi.waitFor(() => expect(state.loadRequests).toHaveLength(1));
    const first = {id: 'loaded'} as unknown as Score;
    state.loadRequests[0]!.resolve(first);
    await flush();
    expect(element.score).toBeUndefined();
    expect(element.resolvedScore).toBe(first);
    expect((events.find((event) => event.type === 'webscore:scorechange') as CustomEvent).detail.score).toBe(first);

    element.setAttribute('src', 'replacement.mid');
    expect(element.resolvedScore).toBeUndefined();
    expect(element.getPlaybackSnapshot()).toBeUndefined();
    await vi.waitFor(() => expect(state.loadRequests).toHaveLength(2));
    const second = {id: 'newest'} as unknown as Score;
    state.loadRequests[1]!.resolve(second);
    await flush();
    expect(element.resolvedScore).toBe(second);
    element.disconnectedCallback();
    expect(element.resolvedScore).toBeUndefined();
  });

  it('publishes a paused snapshot with nominal seconds and updates it on a paused rate change', async () => {
    const {element, events} = mount({} as Score, {attributes: {rate: '2'}});
    await flush();
    expect(element.getPlaybackSnapshot()).toMatchObject({
      nominalSeconds: 1.5, transportSeconds: 0.75,
      transportDurationSeconds: 1, rate: 2, playing: false, activeNotes: [],
    });
    events.length = 0;
    element.rate = 0.5;
    expect((events.at(-1) as CustomEvent).detail).toMatchObject({rate: 0.5, playing: false});
    events.length = 0;
    state.options[0]?.onPause?.();
    expect(events.at(-1)?.type).toBe('webscore:statechange');
    element.disconnectedCallback();
  });

  it('builds a sound-font synth on the explicit player context', async () => {
    const context = {state: 'running'} as AudioContext;
    const {element} = mount({} as Score, {
      attributes: {'sound-font': 'https://cdn.example/{midi}.mp3'},
      audioContext: context,
    });
    await flush();

    expect(state.soundfontContexts).toEqual([context]);
    expect(state.options[0]?.audioContext).toBe(context);
    expect(state.options[0]?.synth).toBeDefined();
    element.disconnectedCallback();
  });

  it('passes an assigned effect chain to the mounted ScorePlayer', async () => {
    const effect = Effect.chain(Effect.reverb({wet: 0.3}), Effect.gain(0.8));
    const {element} = mount({id: 'effect-chain'} as unknown as Score);
    await flush();

    element.effect = effect;
    await flush();

    expect(element).toBeInstanceOf(ScorePlayerElement);
    expect(state.options.at(-1)?.effect).toBe(effect);
    element.disconnectedCallback();
  });

  it('rolls back a partially mounted score and reports the latest async lifecycle failure', async () => {
    const failure = new Error('rate application failed');
    const lifecycleErrors: unknown[] = [];
    state.player.setRate.mockImplementationOnce(() => {
      throw failure;
    });

    class FailingScorePlayerElement extends ScorePlayerElement {
      protected override onLifecycleError(error: unknown): void {
        lifecycleErrors.push(error);
      }
    }

    const {element} = mount({} as Score, {}, FailingScorePlayerElement);
    await vi.waitFor(() => expect(lifecycleErrors).toEqual([failure]));

    expect(state.destroy).toHaveBeenCalledTimes(1);
    element.disconnectedCallback();
    expect(state.destroy).toHaveBeenCalledTimes(1);
  });

  it('contains a synchronous Rack mount throw converted by async render and releases the old handle', async () => {
    const failure = new Error('rack UI failed');
    const lifecycleErrors: unknown[] = [];

    class FailingRackPlayerElement extends ScorePlayerElement {
      protected override mountRack(_rack: Rack, _options: RackPlayerOptions = {}): PresetPlayerHandle {
        throw failure;
      }

      protected override onLifecycleError(error: unknown): void {
        lifecycleErrors.push(error);
      }
    }

    const {element} = mount({} as Score, {}, FailingRackPlayerElement);
    await vi.waitFor(() => expect(state.scores).toHaveLength(1));

    element.rack = {} as Rack;
    await vi.waitFor(() => expect(lifecycleErrors).toEqual([failure]));

    expect(state.destroy).toHaveBeenCalledTimes(1);
    element.disconnectedCallback();
    expect(state.destroy).toHaveBeenCalledTimes(1);
  });
});

describe('<score-player> URL cancellation', () => {
  it('aborts a superseded src and mounts only the newest score without logging cancellation', async () => {
    const reported = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const {element} = mount(null, {attributes: {src: 'first.mid'}});
    await vi.waitFor(() => expect(state.loadRequests).toHaveLength(1));

    element.setAttribute('format', 'midi');
    await vi.waitFor(() => expect(state.loadRequests).toHaveLength(2));
    expect(state.loadRequests[0]!.signal.aborted).toBe(true);

    element.setAttribute('src', 'second.mid');
    await vi.waitFor(() => expect(state.loadRequests).toHaveLength(3));
    expect(state.loadRequests[1]!.signal.aborted).toBe(true);

    const newestScore = {id: 'newest'} as unknown as Score;
    state.loadRequests[2]!.resolve(newestScore);
    await flush();

    expect(state.scores).toEqual([newestScore]);
    expect(reported).not.toHaveBeenCalled();
    element.disconnectedCallback();
  });

  it('aborts an in-flight src load on disconnect without mounting or reporting an error', async () => {
    const reported = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const {element} = mount(null, {attributes: {src: 'pending.mid'}});
    await vi.waitFor(() => expect(state.loadRequests).toHaveLength(1));

    element.disconnectedCallback();
    expect(state.loadRequests[0]!.signal.aborted).toBe(true);
    await flush();

    expect(state.scores).toEqual([]);
    expect(reported).not.toHaveBeenCalled();
  });
});

describe('<score-player> live knob attributes', () => {
  it('seeds volume / rate / pan / loop from markup and applies a change without remounting', async () => {
    const {element} = mount({id: 'knobs'} as unknown as Score, {
      attributes: {volume: '0.25', rate: '0.5', pan: '-1', loop: ''},
    });
    await flush();

    expect(state.player.setVolume).toHaveBeenCalledWith(0.25);
    expect(state.player.setRate).toHaveBeenCalledWith(0.5);
    expect(state.player.setPan).toHaveBeenCalledWith(-1);
    expect(state.player.setLoop).toHaveBeenCalled();
    expect(element.volume).toBe(0.25);

    const mounts = vi.mocked(mountPresetPlayer).mock.calls.length;
    element.setAttribute('volume', '2');
    await flush();

    expect(state.player.setVolume).toHaveBeenLastCalledWith(2);
    // A knob applies in place: rebuilding the player would restart the piece.
    expect(vi.mocked(mountPresetPlayer).mock.calls).toHaveLength(mounts);

    element.removeAttribute('loop');
    expect(state.player.clearLoop).toHaveBeenCalled();

    element.disconnectedCallback();
  });

  it('pins a knob to the assigned property, so a later attribute write is ignored', async () => {
    const {element} = mount({id: 'pinned'} as unknown as Score, {attributes: {volume: '0.25'}});
    await flush();

    element.volume = 0.5;
    element.setAttribute('volume', '0.9');

    expect(element.volume).toBe(0.5);
    expect(state.player.setVolume).toHaveBeenLastCalledWith(0.5);

    element.disconnectedCallback();
  });

  it('falls back for an unparsable knob instead of poisoning the player with NaN', async () => {
    const {element} = mount({id: 'garbage'} as unknown as Score, {
      attributes: {volume: 'loud', rate: '0', pan: '9'},
    });
    await flush();

    expect(state.player.setVolume).toHaveBeenCalledWith(1);
    // `rate` is clamped by the same guard the property setter uses.
    expect(state.player.setRate).toHaveBeenCalledWith(1);
    expect(state.player.setPan).toHaveBeenCalledWith(1);

    element.disconnectedCallback();
  });
});

describe('<score-player> chrome flags', () => {
  it('passes the mounted chrome through and changes it in place afterwards', async () => {
    const {element} = mount({id: 'chrome'} as unknown as Score, {
      attributes: {'time-control': 'full', 'volume-control': 'fader'},
    });
    await flush();

    const options = state.options.at(-1);
    expect(options?.timeControl).toBe('full');
    expect(options?.volumeControl).toBe('fader');
    // The engine has no volume read-back, so the mount seeds the control.
    expect(options?.volume).toBe(1);

    const mounts = vi.mocked(mountPresetPlayer).mock.calls.length;
    element.setAttribute('time-control', 'simple');
    expect(state.setChrome).toHaveBeenLastCalledWith({time: 'simple'});
    element.setAttribute('volume-control', 'knob');
    expect(state.setChrome).toHaveBeenLastCalledWith({volume: 'knob'});
    // A word the element does not know reads as off rather than throwing.
    element.setAttribute('time-control', 'nonsense');
    expect(state.setChrome).toHaveBeenLastCalledWith({time: 'off'});
    element.removeAttribute('volume-control');
    expect(state.setChrome).toHaveBeenLastCalledWith({volume: 'off'});
    await flush();

    // Visibility must never cost a remount — that would reload the source.
    expect(vi.mocked(mountPresetPlayer).mock.calls).toHaveLength(mounts);

    element.disconnectedCallback();
  });

  it('keeps the element volume in step with the slider without pinning the knob', async () => {
    const {element} = mount({id: 'slider'} as unknown as Score, {
      attributes: {'volume-control': 'fader', volume: '0.4'},
    });
    await flush();

    state.options.at(-1)?.onVolumeChange?.(0.8);
    expect(element.volume).toBe(0.8);

    // A drag is the reader moving the same knob, not an imperative assignment,
    // so markup still wins the next change.
    element.setAttribute('volume', '0.2');
    expect(element.volume).toBe(0.2);

    element.disconnectedCallback();
  });

  it('forwards the readout flag to the rack and controller chrome', async () => {
    const {element} = mount({id: 'rack-chrome'} as unknown as Score, {
      attributes: {'time-control': 'full'},
    });
    element.rack = {id: 'rack'} as never;
    await flush();

    const rackCall = vi.mocked(mountRackPlayer).mock.calls.at(-1)!;
    expect(rackCall[0]).toBe(element.rack);
    expect(rackCall[1]).not.toBe(element);
    expect(rackCall[2]).toEqual({timeControl: 'full', onError: expect.any(Function)});

    element.disconnectedCallback();
  });
});
