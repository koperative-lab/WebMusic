// @vitest-environment jsdom
//
// <audio-view> composition: what the element does when its player, its renderer
// and its stage push back — following a transport, ordering a seek against the
// player it drives, surviving a disconnect, and the two failure paths the stage
// boundary owns. The renderers are stubbed (jsdom has no 2D context); the stage
// and render/binding.ts are deliberately real, because the ordering these cases
// pin down only exists once those two run for real.

import {createAudioClip, type AudioClip} from '../../src/core';
import type {
  AudioViewport,
  SpectrogramData,
  WaveformRenderOptions,
} from '../../src/view/core/types';
import {afterEach, beforeAll, describe, expect, it, vi} from 'vitest';

const mocks = vi.hoisted(() => ({
  waveform: vi.fn(),
  spectrogram: vi.fn(),
  meter: vi.fn(),
}));

vi.mock('../../src/view/render/waveform', () => ({renderWaveformVisualizer: mocks.waveform}));
vi.mock('../../src/view/render/spectrogram-view', () => ({
  renderSpectrogramVisualizer: mocks.spectrogram,
}));
vi.mock('../../src/view/render/meter', () => ({renderLoudnessMeter: mocks.meter}));

import {
  AudioViewElement,
  defineAudioViewElement,
  type AudioViewOptions,
} from '../../src/view/element';

const TAG = 'composition-audio-view';

beforeAll(() => defineAudioViewElement(TAG));

afterEach(() => {
  document.body.replaceChildren();
  mocks.waveform.mockReset();
  mocks.spectrogram.mockReset();
  mocks.meter.mockReset();
});

describe('<audio-view> player composition', () => {
  it('draws one frame per transport tick and clears the surface when the player ends', () => {
    const visualizer = fakeVisualizer();
    mocks.waveform.mockReturnValue(visualizer);
    const player = playerElement('transport-player', {duration: 4, seconds: 1});
    document.body.append(player.element);

    const view = mount({
      clip: toneClip(4),
      attributes: {player: '#transport-player', interactive: ''},
    });

    const drawn = visualizer.redraw.mock.calls.length;
    player.element.dispatchEvent(timeupdate(2));

    // Every re-render rebinds the player. A tick that draws twice is the tell
    // that a previous binding was left subscribed.
    expect(visualizer.redraw.mock.calls.length).toBe(drawn + 1);
    expect(visualizer.redraw.mock.calls.at(-1)).toEqual([2, true]);
    expect(view.getAttribute('aria-valuenow')).toBe('2');
    expect(view.getAttribute('aria-valuemax')).toBe('4');

    player.element.dispatchEvent(new CustomEvent('webaudio:end'));
    expect(visualizer.redraw.mock.calls.at(-1)).toEqual([0, false]);
  });

  it('goes inert while disconnected and rebuilds a live surface on reconnect', () => {
    const visualizers: FakeVisualizer[] = [];
    mocks.waveform.mockImplementation(() => {
      const next = fakeVisualizer();
      visualizers.push(next);
      return next;
    });
    const player = playerElement('reconnect-player', {duration: 4, seconds: 0});
    document.body.append(player.element);

    const view = mount({
      clip: toneClip(4),
      attributes: {player: '#reconnect-player', interactive: ''},
    });
    player.element.dispatchEvent(timeupdate(1));
    expect(view.getAttribute('aria-valuenow')).toBe('1');

    view.remove();
    expect(visualizers[0].dispose).toHaveBeenCalledOnce();
    player.element.dispatchEvent(timeupdate(2));
    // A retired mount owns nothing: no ARIA, and no draw on the dead surface.
    expect(view.hasAttribute('aria-valuenow')).toBe(false);
    expect(visualizers[0].redraw.mock.calls.at(-1)).toEqual([1, true]);

    document.body.append(view);
    expect(visualizers).toHaveLength(2);
    player.element.dispatchEvent(timeupdate(3));
    expect(view.getAttribute('aria-valuenow')).toBe('3');
    expect(visualizers[1].redraw.mock.calls.at(-1)).toEqual([3, true]);
    expect(visualizers[0].redraw.mock.calls.at(-1)).toEqual([1, true]);
  });
});

describe('<audio-view> seek', () => {
  it('announces a pointer seek before driving the bound player, and seeks it once', () => {
    const visualizer = fakeVisualizer({hitSeconds: 3});
    mocks.waveform.mockReturnValue(visualizer);
    const order: string[] = [];
    const player = playerElement('seek-player', {duration: 4, seconds: 1});
    player.player.seek.mockImplementation(() => order.push('player'));
    document.body.append(player.element);

    const view = mount({
      clip: toneClip(4),
      attributes: {player: '#seek-player', interactive: ''},
    });
    const seeks: Array<{seconds: number}> = [];
    view.addEventListener('webaudio:seek', (event) => {
      order.push('event');
      seeks.push((event as CustomEvent<{seconds: number}>).detail);
    });

    surfaceOf(view).dispatchEvent(new MouseEvent('pointerdown', {clientX: 30, bubbles: true}));

    // A player announces its own seeks, so the element seeking it directly is
    // the only call there may be — a second one would double-seek the transport.
    expect(player.player.seek).toHaveBeenCalledTimes(1);
    expect(player.player.seek).toHaveBeenCalledWith(3);
    expect(seeks).toEqual([{seconds: 3, region: undefined}]);
    expect(order).toEqual(['event', 'player']);
    expect(view.getAttribute('aria-valuenow')).toBe('3');
  });
});

describe('<audio-view> type switching', () => {
  it('disposes the previous drawing on every type change', () => {
    const waveform = fakeVisualizer();
    const spectrogram = fakeVisualizer();
    const meter = fakeVisualizer();
    mocks.waveform.mockReturnValue(waveform);
    mocks.spectrogram.mockReturnValue(spectrogram);
    mocks.meter.mockReturnValue(meter);
    const player = playerElement('mode-player', {
      duration: 4,
      seconds: 0,
      analyser: {} as AnalyserNode,
    });
    document.body.append(player.element);

    const view = mount({
      clip: toneClip(4),
      spectrogram: spectrogramData(),
      attributes: {player: '#mode-player'},
    });
    expect(mocks.waveform).toHaveBeenCalledOnce();

    view.type = 'spectrogram';
    expect(waveform.dispose).toHaveBeenCalledOnce();
    expect(mocks.spectrogram).toHaveBeenCalledOnce();

    view.type = 'meter';
    expect(spectrogram.dispose).toHaveBeenCalledOnce();
    expect(mocks.meter).toHaveBeenCalledOnce();
    // A meter has no time axis, so it has no window to report and no slider.
    expect(view.visibleRange()).toBeUndefined();
    expect(view.getAttribute('role')).toBe('group');

    view.remove();
    expect(meter.dispose).toHaveBeenCalledOnce();
  });
});

describe('<audio-view> upgrade', () => {
  it('routes properties assigned before the definition through the accessors', () => {
    const tag = 'pre-upgrade-audio-view';
    mocks.waveform.mockImplementation(
      (_host: HTMLElement, _peaks: unknown, options: WaveformRenderOptions) =>
        fakeVisualizer({options}),
    );
    const options: AudioViewOptions = {pixelsPerSecond: 140, waveColor: '#fff'};
    const view = document.createElement(tag) as AudioViewElement;
    Object.assign(view, {clip: toneClip(4), options, interactive: true});
    document.body.append(view);

    class PreUpgradeAudioView extends AudioViewElement {}
    customElements.define(tag, PreUpgradeAudioView);

    expect(view.options).toBe(options);
    expect(view.clip?.duration).toBeCloseTo(4, 5);
    expect(view.interactive).toBe(true);
    expect(view.zoom).toBe(140);
    // Assigned before the upgrade, the bag would otherwise shadow the accessor
    // and never reach the renderer at all.
    expect(mocks.waveform.mock.calls.at(-1)?.[2].waveColor).toBe('#fff');
    expect(view.visibleRange()).toEqual({startSeconds: 0, endSeconds: 200 / 140});
  });
});

describe('<audio-view> failure handling', () => {
  it('rolls the mount back when binding the player throws, and reports it', () => {
    const visualizer = fakeVisualizer();
    mocks.waveform.mockReturnValue(visualizer);
    const failure = new Error('loaded listener failed');
    const player = playerElement('hostile-player', {duration: 4, seconds: 0});
    const nativeAdd = player.element.addEventListener.bind(player.element);
    player.element.addEventListener = ((
      type: string,
      listener: EventListenerOrEventListenerObject,
      options?: boolean | AddEventListenerOptions,
    ): void => {
      nativeAdd(type, listener, options);
      if (type === 'webaudio:loaded') throw failure;
    }) as typeof player.element.addEventListener;
    document.body.append(player.element);

    const errors: unknown[] = [];
    const view = document.createElement(TAG) as AudioViewElement;
    view.clip = toneClip(4);
    view.setAttribute('player', '#hostile-player');
    view.setAttribute('interactive', '');
    view.addEventListener('webaudio:error', (event) => {
      errors.push((event as CustomEvent<{error: unknown}>).detail.error);
    });
    document.body.append(view);

    expect(errors).toEqual([failure]);
    // Rollback is the whole point: no stage, no drawing, and none of the ARIA
    // contract the element can no longer honour.
    expect(mocks.waveform).not.toHaveBeenCalled();
    expect(view.querySelector('.wui-stage__surface')).toBeNull();
    expect(view.getAttribute('role')).toBeNull();
    expect(view.visibleRange()).toBeUndefined();

    // The failure belonged to that player, not to the element.
    player.element.remove();
    view.remove();
    document.body.append(view);
    expect(mocks.waveform).toHaveBeenCalledOnce();
    expect(view.getAttribute('role')).toBe('slider');
  });

  it('fuses a render that re-enters refresh instead of looping forever', () => {
    const visualizers: FakeVisualizer[] = [];
    mocks.waveform.mockImplementation(() => {
      const next = fakeVisualizer();
      visualizers.push(next);
      return next;
    });
    const errors: unknown[] = [];

    class ReentrantAudioView extends AudioViewElement {
      reenter = false;

      protected override renderStage(host: HTMLElement): void {
        super.renderStage(host);
        if (this.reenter) this.options = {pixelsPerSecond: 100 + visualizers.length};
      }
    }

    const tag = 'reentrant-audio-view';
    customElements.define(tag, ReentrantAudioView);
    const view = document.createElement(tag) as ReentrantAudioView;
    view.clip = toneClip(4);
    view.addEventListener('webaudio:error', (event) => {
      errors.push((event as CustomEvent<{error: unknown}>).detail.error);
    });
    document.body.append(view);
    expect(visualizers).toHaveLength(1);

    view.reenter = true;
    view.clip = toneClip(2);

    // A render that dirties its own input would spin forever; the stage stops
    // it, reports it once, and keeps the last pass it managed to draw.
    expect(visualizers).toHaveLength(33);
    expect(errors).toHaveLength(1);
    expect(String(errors[0])).toContain('did not stabilize after 32 passes');
    expect(visualizers.slice(0, -1).every(({dispose}) => dispose.mock.calls.length === 1)).toBe(
      true,
    );
    expect(visualizers.at(-1)?.dispose).not.toHaveBeenCalled();
    expect(view.querySelector('.wui-stage__surface')).not.toBeNull();

    // Nothing latched: the next clean pass draws again, and the fuse is not
    // re-reported.
    view.reenter = false;
    view.clip = toneClip(3);
    expect(visualizers).toHaveLength(34);
    expect(errors).toHaveLength(1);
    expect(visualizers[32]?.dispose).toHaveBeenCalledOnce();

    view.remove();
    expect(visualizers.at(-1)?.dispose).toHaveBeenCalledOnce();
  });
});

// --- helpers ---------------------------------------------------------------

interface MountOptions {
  clip?: AudioClip;
  spectrogram?: SpectrogramData;
  attributes?: Record<string, string>;
}

function mount(options: MountOptions = {}): AudioViewElement {
  const view = document.createElement(TAG) as AudioViewElement;
  for (const [name, value] of Object.entries(options.attributes ?? {})) {
    view.setAttribute(name, value);
  }
  if (options.clip) view.clip = options.clip;
  if (options.spectrogram) view.spectrogram = options.spectrogram;
  document.body.append(view);
  return view;
}

function surfaceOf(view: AudioViewElement): HTMLElement {
  const surface = view.querySelector<HTMLElement>('.wui-stage__surface');
  if (!surface) throw new Error('no surface mounted');
  return surface;
}

function timeupdate(seconds: number): CustomEvent {
  return new CustomEvent('webaudio:timeupdate', {detail: {seconds, duration: 4}});
}

function toneClip(seconds: number): AudioClip {
  const sampleRate = 100;
  const samples = new Float32Array(seconds * sampleRate);
  for (let index = 0; index < samples.length; index++) samples[index] = Math.sin(index / 5);
  return createAudioClip({sampleRate, channelData: [samples]});
}

function spectrogramData(): SpectrogramData {
  return {
    times: [0, 4],
    frequencies: [100],
    magnitudes: new Float32Array([0, 0]),
    binsPerFrame: 1,
  };
}

interface PlayerFacade {
  duration: number;
  seconds: number;
  analyser?: AnalyserNode;
  seek: ReturnType<typeof vi.fn>;
}

function playerElement(id: string, facade: Omit<PlayerFacade, 'seek'>) {
  const player: PlayerFacade = {...facade, seek: vi.fn()};
  const element = document.createElement('div') as HTMLDivElement & {player: PlayerFacade};
  element.id = id;
  element.player = player;
  return {element, player};
}

type FakeVisualizer = ReturnType<typeof fakeVisualizer>;

/**
 * A renderer stub with real viewport bookkeeping: a fixed 200 px surface that
 * clamps, reports and notifies through the same viewport surface render/waveform
 * exposes, so the element's timeline is driven by numbers it did not invent.
 */
function fakeVisualizer(setup: {options?: WaveformRenderOptions; hitSeconds?: number} = {}) {
  const VIEWPORT_PIXELS = 200;
  const duration = setup.options?.durationSeconds ?? 4;
  let pixelsPerSecond = setup.options?.pixelsPerSecond ?? 100;
  let startSeconds = 0;
  const listeners = new Set<(viewport: AudioViewport) => void>();

  const windowSeconds = (): number => VIEWPORT_PIXELS / pixelsPerSecond;
  const viewport = (): AudioViewport => ({
    startSeconds,
    endSeconds: Math.min(duration, startSeconds + windowSeconds()),
  });
  const moveTo = (seconds: number): void => {
    startSeconds = Math.max(0, Math.min(Math.max(0, duration - windowSeconds()), seconds));
    for (const listener of [...listeners]) listener(viewport());
  };

  return {
    redraw: vi.fn(),
    setZoom: vi.fn((next: number) => {
      pixelsPerSecond = next;
      moveTo(startSeconds);
    }),
    setRegions: vi.fn(),
    hitTest: vi.fn(() => ({seconds: setup.hitSeconds ?? 0})),
    setOffset: vi.fn((seconds: number) => moveTo(seconds)),
    viewport: vi.fn(viewport),
    onViewportChange: vi.fn((listener: (next: AudioViewport) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }),
    dispose: vi.fn(() => listeners.clear()),
  };
}
