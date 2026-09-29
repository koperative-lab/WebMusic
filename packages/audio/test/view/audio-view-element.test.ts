// @vitest-environment jsdom
//
// <audio-view> element behaviour: the empty states, the in-place option update,
// annotation, `peaks-src` hydration and the viewport surface a bound
// external controls drive. The renderers are stubbed (jsdom has no 2D context),
// but render/binding.ts is deliberately REAL — its drag-to-create path is what
// the `annotate` tests exercise.

import {afterEach, beforeAll, beforeEach, describe, expect, it, vi} from 'vitest';
import {createAudioClip, createRegion, type AudioClip, type AudioPeaks} from '../../src/core';
import type {AudioViewport, WaveformRenderOptions} from '../../src/view/core/types';

const mocks = vi.hoisted(() => ({
  waveform: vi.fn(),
  spectrogram: vi.fn(),
  meter: vi.fn(),
  loadClip: vi.fn(),
}));

vi.mock('../../src/view/render/waveform', () => ({renderWaveformVisualizer: mocks.waveform}));
vi.mock('../../src/view/render/spectrogram-view', () => ({
  renderSpectrogramVisualizer: mocks.spectrogram,
}));
vi.mock('../../src/view/render/meter', () => ({renderLoudnessMeter: mocks.meter}));
vi.mock('../../src/play/api', () => ({loadClipFromUrl: mocks.loadClip}));

import {AudioViewElement, defineAudioViewElement} from '../../src/view/element/audio-view';
import {computeClipPeaks} from '../../src/view/headless/peaks';

beforeAll(() => defineAudioViewElement('probe-audio-view'));

beforeEach(() => {
  mocks.waveform.mockImplementation((_host: HTMLElement, _peaks: AudioPeaks, options: WaveformRenderOptions) =>
    fakeVisualizer(options),
  );
  mocks.spectrogram.mockImplementation(() => fakeVisualizer({}));
  mocks.meter.mockImplementation(() => fakeVisualizer({}));
});

afterEach(() => {
  document.body.replaceChildren();
  mocks.waveform.mockReset();
  mocks.spectrogram.mockReset();
  mocks.meter.mockReset();
  mocks.loadClip.mockReset();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('<audio-view> empty states', () => {
  it('keeps the host transparent and applies its tokens to the single stage frame', () => {
    const view = mount();
    const stage = view.querySelector<HTMLElement>('.wui-stage')!;

    expect(view.style.background).toBe('');
    expect(view.style.border).toBe('');
    expect(view.style.padding).toBe('');
    expect(stage.style.background).toContain('--wm-audio-view-surface-background');
    expect(stage.style.background).toContain('--wm-stage-surface-background');
    expect(stage.style.border).toContain('1px solid var(--wm-border, #d8d8d8)');
    expect(stage.style.padding).toContain('--wm-component-padding, .6rem');
  });

  it('says what a waveform is missing and still renders once it arrives', () => {
    const view = mount();

    const empty = view.querySelector<HTMLElement>('[role="status"]');
    expect(empty?.textContent).toContain('assign .clip or .peaks');
    expect(empty?.classList.contains('wui-status--embedded')).toBe(true);
    expect(mocks.waveform).not.toHaveBeenCalled();

    view.clip = toneClip(4);
    expect(mocks.waveform).toHaveBeenCalledOnce();
    expect(view.querySelector('[role="status"]')).toBeNull();
  });

  it('says a spectrogram needs data and still renders once it arrives', () => {
    const view = mount({type: 'spectrogram', attributes: {interactive: ''}});

    expect(view.querySelector('[role="status"]')?.textContent).toContain('assign .spectrogram');
    expect(mocks.spectrogram).not.toHaveBeenCalled();

    view.spectrogram = {
      times: [0, 0.1],
      frequencies: [100, 200],
      magnitudes: new Float32Array([0.1, 0.2, 0.3, 0.4]),
      binsPerFrame: 2,
    };
    expect(mocks.spectrogram).toHaveBeenCalledOnce();
    expect(view.querySelector('[role="status"]')).toBeNull();
    expect(view.getAttribute('role')).toBe('slider');
    expect(view.getAttribute('aria-valuemax')).toBe('0.1');
  });

  it('says a meter needs an analyser, and labels the meter it does get', () => {
    const view = mount({type: 'meter'});
    expect(view.querySelector('[role="status"]')?.textContent).toContain(
      'bind a player with an analyser',
    );
    expect(mocks.meter).not.toHaveBeenCalled();

    // A meter is not seekable, but it is still a named thing on the page.
    const player = playerStub('meter-player', {analyser: {} as AnalyserNode});
    view.setAttribute('player', '#meter-player');
    expect(mocks.meter).toHaveBeenCalledOnce();
    expect(view.getAttribute('role')).toBe('group');
    expect(view.getAttribute('aria-label')).toBe('Audio level meter');
    expect(view.hasAttribute('tabindex')).toBe(false);
    player.remove();
  });
});

describe('<audio-view> attribute updates', () => {
  it('repaints a colour change in place, keeping the surface and the window', () => {
    const view = mount({clip: toneClip(10)});
    const surface = view.querySelector<HTMLElement>('.wui-stage__surface');
    expect(surface).not.toBeNull();
    // Anything mounted beside the visualizer is the canary: a full refresh
    // replaces the surface's children, an in-place update does not.
    const canary = document.createElement('span');
    surface?.append(canary);
    view.panTo(4);

    const events: AudioViewport[] = [];
    view.addEventListener('webaudio:viewportchange', (event) => {
      events.push((event as CustomEvent<AudioViewport>).detail);
    });

    view.setAttribute('wave-color', '#00ff00');

    expect(view.querySelector('.wui-stage__surface')).toBe(surface);
    expect(canary.isConnected).toBe(true);
    expect(mocks.waveform).toHaveBeenCalledTimes(2);
    expect(mocks.waveform.mock.calls[1][2].waveColor).toBe('#00ff00');
    // The window came back exactly where it was, so nothing was announced.
    expect(view.visibleRange()).toEqual({startSeconds: 4, endSeconds: 6});
    expect(events).toEqual([]);

    // Contrast: a DATA change is a real rebuild and takes the canary with it.
    view.peaks = computeClipPeaks(toneClip(2));
    expect(canary.isConnected).toBe(false);
  });

  it('bounds reentrant colour repaints without removing sibling content', () => {
    class ReentrantColorView extends AudioViewElement {
      reenter = false;

      protected override renderStage(host: HTMLElement): void {
        super.renderStage(host);
        if (this.reenter) {
          this.setAttribute('wave-color', `#${String(mocks.waveform.mock.calls.length).padStart(6, '0')}`);
        }
      }
    }
    const tag = 'reentrant-color-audio-view';
    customElements.define(tag, ReentrantColorView);
    const view = document.createElement(tag) as ReentrantColorView;
    view.clip = toneClip(10);
    document.body.append(view);
    const surface = view.querySelector<HTMLElement>('.wui-stage__surface')!;
    const canary = document.createElement('span');
    surface.append(canary);
    const errors: unknown[] = [];
    view.addEventListener('webaudio:error', (event) => {
      errors.push((event as CustomEvent<{error: unknown}>).detail.error);
    });

    view.reenter = true;
    view.setAttribute('wave-color', '#000001');

    expect(mocks.waveform).toHaveBeenCalledTimes(33);
    expect(errors).toHaveLength(1);
    expect(String(errors[0])).toContain('did not stabilize after 32 passes');
    expect(canary.isConnected).toBe(true);
    expect(view.querySelector('.wui-stage__surface')).toBe(surface);

    view.reenter = false;
    view.setAttribute('wave-color', '#abcdef');
    expect(mocks.waveform).toHaveBeenCalledTimes(34);
    expect(canary.isConnected).toBe(true);
  });

  it('reports a failed in-place repaint without throwing from the attribute change', () => {
    const view = mount({clip: toneClip(10)});
    const surface = view.querySelector<HTMLElement>('.wui-stage__surface')!;
    const canary = document.createElement('span');
    surface.append(canary);
    const failure = new Error('waveform renderer failed');
    const errors: unknown[] = [];
    view.addEventListener('webaudio:error', (event) => {
      errors.push((event as CustomEvent<{error: unknown}>).detail.error);
    });
    mocks.waveform.mockImplementationOnce(() => {
      throw failure;
    });

    expect(() => view.setAttribute('wave-color', '#00ff00')).not.toThrow();

    expect(errors).toEqual([failure]);
    expect(canary.isConnected).toBe(true);
    expect(view.querySelector('.wui-stage__surface')).toBe(surface);
  });

  it('ignores an attribute write that changes nothing', () => {
    const view = mount({clip: toneClip(10)});
    view.setAttribute('wave-color', '#00ff00');
    expect(mocks.waveform).toHaveBeenCalledTimes(2);

    view.setAttribute('wave-color', '#00ff00');
    expect(mocks.waveform).toHaveBeenCalledTimes(2);
  });
});

describe('<audio-view> annotate', () => {
  it('emits regionchange for a drag and keeps the regions the clip already had', () => {
    const existing = createRegion({label: 'verse', startSeconds: 0, endSeconds: 1});
    const clip = toneClip(10).withRegions([existing]);
    const view = mount({clip, attributes: {annotate: ''}});
    const visualizer = lastVisualizer();
    visualizer.hitTest.mockReturnValueOnce({seconds: 2}).mockReturnValueOnce({seconds: 5});

    const changes: Array<{regions: readonly {startSeconds: number}[]}> = [];
    view.addEventListener('webaudio:regionchange', (event) => {
      changes.push((event as CustomEvent<{regions: readonly {startSeconds: number}[]}>).detail);
    });

    drag(view);

    expect(changes).toHaveLength(1);
    const regions = changes[0].regions;
    expect(regions).toHaveLength(2);
    expect(regions[0]).toBe(existing);
    expect(regions[1]).toMatchObject({startSeconds: 2, endSeconds: 5});
    // The surface was told about BOTH, not just the one the drag created.
    expect(visualizer.setRegions.mock.calls.at(-1)?.[0]).toHaveLength(2);
  });

  it('gives one gesture one owner when interactive and annotate are both on', () => {
    // The kit's SurfaceSlider is mounted on this very node when `interactive`,
    // and it captures the pointer. With the render binding ALSO listening on
    // that node, a drag meant to draw a region scrubbed the playhead across it.
    const view = mount({clip: toneClip(10), attributes: {annotate: '', interactive: ''}});
    lastVisualizer().hitTest.mockReturnValue({seconds: 2});

    const seeks: Event[] = [];
    const changes: Array<{regions: readonly unknown[]}> = [];
    view.addEventListener('webaudio:seek', (event) => seeks.push(event));
    view.addEventListener('webaudio:regionchange', (event) => {
      changes.push((event as CustomEvent<{regions: readonly unknown[]}>).detail);
    });

    // A drag: down at 2s, up at 5s. The slider listens on the stage surface,
    // which is the node the render binding used to listen on too.
    lastVisualizer().hitTest.mockReturnValue({seconds: 5}).mockReturnValueOnce({seconds: 2});
    pointerDrag(view, 10, 60);

    // The drag drew a region and did NOT scrub.
    expect(changes).toHaveLength(1);
    expect(seeks).toHaveLength(0);
  });

  it('still seeks on a click while annotating, because a click is not a drag', () => {
    const view = mount({clip: toneClip(10), attributes: {annotate: '', interactive: ''}});
    const seeks: Array<{seconds: number}> = [];
    const changes: Event[] = [];
    view.addEventListener('webaudio:seek', (event) => {
      seeks.push((event as CustomEvent<{seconds: number}>).detail);
    });
    view.addEventListener('webaudio:regionchange', (event) => changes.push(event));

    // Down and up at the same instant: no travel, so it means seek.
    lastVisualizer().hitTest.mockReturnValue({seconds: 4});
    pointerDrag(view, 30, 30);

    expect(changes).toHaveLength(0);
    expect(seeks).toHaveLength(1);
    expect(seeks[0]?.seconds).toBeCloseTo(4);
  });

  it('does not bind the drag path when annotate is off', () => {
    const view = mount({clip: toneClip(10)});
    lastVisualizer().hitTest.mockReturnValueOnce({seconds: 2}).mockReturnValueOnce({seconds: 5});
    const changes: Event[] = [];
    view.addEventListener('webaudio:regionchange', (event) => changes.push(event));

    drag(view);

    expect(changes).toEqual([]);
  });
});

describe('<audio-view> peaks-src', () => {
  it('hydrates BBC audiowaveform JSON without decoding any audio', async () => {
    const json = {
      version: 2,
      channels: 1,
      sample_rate: 44100,
      samples_per_pixel: 1024,
      bits: 8,
      length: 3,
      data: [-32, 40, -60, 70, -10, 12],
    };
    const fetchMock = vi.fn(async () => ({ok: true, json: async () => json}));
    vi.stubGlobal('fetch', fetchMock);

    const view = mount({attributes: {'peaks-src': '/song.json'}});
    await vi.waitFor(() => expect(mocks.waveform).toHaveBeenCalledOnce());

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(mocks.loadClip).not.toHaveBeenCalled();
    const peaks = mocks.waveform.mock.calls[0][1] as AudioPeaks;
    expect(peaks.sampleRate).toBe(44100);
    expect(peaks.baseSamplesPerPeak).toBe(1024);
    expect(Array.from(peaks.levels[0].data)).toEqual(json.data);
    expect(view.peaks).toBe(peaks);
    expect(view.hasAttribute('aria-busy')).toBe(false);
  });

  it('reports a failed peaks request through webaudio:error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ok: false, status: 404, json: async () => ({})})),
    );
    const view = mount();
    const errors: Array<{error: Error}> = [];
    view.addEventListener('webaudio:error', (event) => {
      errors.push((event as CustomEvent<{error: Error}>).detail);
    });

    view.setAttribute('peaks-src', '/missing.json');
    await vi.waitFor(() => expect(errors).toHaveLength(1));
    expect(errors[0].error.message).toContain('404');
  });
});

describe('<audio-view> viewport', () => {
  it('round-trips visibleRange / panTo / setZoom and announces every move', () => {
    const view = mount({clip: toneClip(10)});
    const events: AudioViewport[] = [];
    view.addEventListener('webaudio:viewportchange', (event) => {
      events.push((event as CustomEvent<AudioViewport>).detail);
    });

    // 200 px of surface at the default 100 px/s = a two-second window.
    expect(view.visibleRange()).toEqual({startSeconds: 0, endSeconds: 2});
    expect(events).toEqual([]); // the first paint is not a pan

    view.panTo(4);
    expect(view.visibleRange()).toEqual({startSeconds: 4, endSeconds: 6});
    expect(events).toEqual([{startSeconds: 4, endSeconds: 6}]);

    // A user scroll reaches the element the same way: through the renderer.
    lastVisualizer().scrollTo(7);
    expect(view.visibleRange()).toEqual({startSeconds: 7, endSeconds: 9});
    expect(events).toHaveLength(2);

    // Zooming in halves the window and is announced too.
    view.setZoom(200);
    expect(view.zoom).toBe(200);
    expect(view.visibleRange()).toEqual({startSeconds: 7, endSeconds: 8});
    expect(events.at(-1)).toEqual({startSeconds: 7, endSeconds: 8});
  });

  it('has no window to report before anything is drawn', () => {
    const view = mount({type: 'meter'});
    expect(view.visibleRange()).toBeUndefined();
    view.panTo(3); // must not throw with nothing rendered
  });
});

describe('<audio-view> properties', () => {
  it('reports the scale the surface is actually drawn at', () => {
    const view = mount({clip: toneClip(10)});
    expect(view.zoom).toBe(100); // the renderers' own default, never 0

    view.setAttribute('pixels-per-second', '250');
    expect(view.zoom).toBe(250);

    view.removeAttribute('pixels-per-second');
    view.options = {pixelsPerSecond: 300};
    expect(view.zoom).toBe(300);
  });

  it('round-trips interactive as a tri-state property', () => {
    const view = document.createElement('probe-audio-view') as AudioViewElement;
    view.clip = toneClip(4);
    view.interactive = true; // assigned before the element is ever connected
    document.body.append(view);

    expect(view.interactive).toBe(true);
    expect(view.getAttribute('role')).toBe('slider');
    expect(view.getAttribute('tabindex')).toBe('0');

    view.interactive = false;
    expect(view.interactive).toBe(false);
    expect(view.getAttribute('interactive')).toBe('false');
    expect(view.getAttribute('role')).toBe('img');

    view.setAttribute('interactive', 'off');
    expect(view.interactive).toBe(false);
  });
});

describe('<audio-view> live player frame projection', () => {
  function installFrames() {
    const frames = new Map<number, FrameRequestCallback>();
    let next = 0;
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      const id = ++next;
      frames.set(id, callback);
      return id;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    const flush = () => {
      const ready = [...frames.values()];
      frames.clear();
      for (const callback of ready) callback(0);
    };
    return {frames, flush};
  }

  it('updates rendering, accessible position and followed viewport at display cadence', () => {
    const {frames, flush} = installFrames();
    const player = {clip: toneClip(10), seconds: 2, duration: 10, playing: true, scratching: false};
    const source = playerStub('live-clock', player);
    const view = mount({attributes: {player: '#live-clock', interactive: '', follow: ''}});
    const renderer = lastVisualizer();
    renderer.redrawFrame.mockImplementation((seconds?: number, follow?: boolean) => {
      if (follow && seconds !== undefined) renderer.setOffset(seconds - 1);
    });
    expect(view.getAttribute('aria-valuenow')).toBe('2');
    player.seconds = 2.125;
    flush();
    expect(renderer.redrawFrame).toHaveBeenLastCalledWith(2.125, true);
    expect(view.getAttribute('aria-valuenow')).toBe('2.125');
    expect(view.visibleRange()).toEqual({startSeconds: 1.125, endSeconds: 3.125});
    expect(frames.size).toBe(1);
    source.dispatchEvent(new CustomEvent('webaudio:end'));
    expect(view.getAttribute('aria-valuenow')).toBe('0');
    expect(renderer.redraw).toHaveBeenLastCalledWith(0, false);
    expect(frames.size).toBe(0);
  });

  it('retires the old clock when rebinding and cancels display work on disconnect', () => {
    const {frames, flush} = installFrames();
    const first = {clip: toneClip(10), seconds: 2, duration: 10, playing: true};
    const second = {...first, seconds: 7};
    const oldSource = playerStub('old-clock', first);
    playerStub('new-clock', second);
    const view = mount({attributes: {player: '#old-clock', interactive: ''}});
    const stale = [...frames.values()];
    view.setAttribute('player', '#new-clock');
    first.seconds = 4;
    oldSource.dispatchEvent(new CustomEvent('webaudio:timeupdate', {detail: {seconds: 4}}));
    for (const callback of stale) callback(0);
    second.seconds = 7.25;
    flush();
    expect(view.getAttribute('aria-valuenow')).toBe('7.25');
    expect(frames.size).toBe(1);
    view.remove();
    expect(frames.size).toBe(0);
  });

  it('does not retain an attachment replaced reentrantly during its initial frame projection', () => {
    const {frames, flush} = installFrames();
    const first = {clip: toneClip(10), seconds: 2, duration: 10, playing: true};
    const second = {...first, seconds: 7};
    playerStub('initial-clock', first);
    playerStub('replacement-clock', second);
    let replaced = false;
    mocks.waveform.mockImplementation((_host: HTMLElement, _peaks: AudioPeaks, options: WaveformRenderOptions) => {
      const renderer = fakeVisualizer(options);
      renderer.redrawFrame.mockImplementation(() => {
        if (replaced) return;
        replaced = true;
        document.querySelector('probe-audio-view')!.setAttribute('player', '#replacement-clock');
      });
      return renderer;
    });
    const view = mount({attributes: {player: '#initial-clock', interactive: ''}});
    expect(view.getAttribute('aria-valuenow')).toBe('7');
    expect(frames.size).toBe(1);
    second.seconds = 7.5;
    flush();
    expect(view.getAttribute('aria-valuenow')).toBe('7.5');
    view.remove();
    expect(frames.size).toBe(0);
  });

  it('keeps event-only targets event-driven even if they expose activity without a live position', () => {
    const {frames, flush} = installFrames();
    const source = playerStub('legacy-clock', {clip: toneClip(10), playing: true} as {clip: AudioClip});
    const view = mount({attributes: {player: '#legacy-clock', interactive: ''}});
    source.dispatchEvent(new CustomEvent('webaudio:timeupdate', {detail: {seconds: 3.5}}));
    flush();
    expect(view.getAttribute('aria-valuenow')).toBe('3.5');
    expect(lastVisualizer().redraw).toHaveBeenLastCalledWith(3.5, true);
    expect(frames.size).toBe(0);
  });
});

// --- helpers ---------------------------------------------------------------

interface MountOptions {
  type?: string;
  clip?: AudioClip;
  attributes?: Record<string, string>;
}

function mount(options: MountOptions = {}): AudioViewElement {
  const view = document.createElement('probe-audio-view') as AudioViewElement;
  if (options.type) view.setAttribute('type', options.type);
  for (const [name, value] of Object.entries(options.attributes ?? {})) {
    view.setAttribute(name, value);
  }
  if (options.clip) view.clip = options.clip;
  document.body.append(view);
  return view;
}

function playerStub(id: string, player: {analyser?: AnalyserNode; clip?: AudioClip}): HTMLElement {
  const element = document.createElement('div') as HTMLDivElement & {player: typeof player};
  element.id = id;
  element.player = player;
  document.body.append(element);
  return element;
}

/** Press, move and release across the surface — one drag-to-create gesture. */
/** A pointer gesture on the surface the kit's SurfaceSlider listens on. */
function pointerDrag(view: AudioViewElement, fromX: number, toX: number): void {
  const surface = view.querySelector<HTMLElement>('.wui-stage__surface');
  if (!surface) throw new Error('no surface mounted');
  const send = (type: string, clientX: number): void => {
    const event = new MouseEvent(type, {bubbles: true, cancelable: true, clientX, button: 0});
    Object.defineProperty(event, 'pointerId', {configurable: true, value: 7});
    surface.dispatchEvent(event);
  };
  send('pointerdown', fromX);
  if (toX !== fromX) send('pointermove', toX);
  send('pointerup', toX);
}

function drag(view: AudioViewElement): void {
  const surface = view.querySelector<HTMLElement>('.wui-stage__surface');
  if (!surface) throw new Error('no surface mounted');
  surface.dispatchEvent(new MouseEvent('pointerdown', {bubbles: true, clientX: 10}));
  surface.dispatchEvent(new MouseEvent('pointerup', {bubbles: true, clientX: 60}));
}

type FakeVisualizer = ReturnType<typeof fakeVisualizer>;

function lastVisualizer(): FakeVisualizer {
  const result = mocks.waveform.mock.results.at(-1);
  if (!result || result.type !== 'return') throw new Error('nothing rendered');
  return result.value as FakeVisualizer;
}

/**
 * A renderer stub with real viewport bookkeeping: a fixed 200 px surface that
 * clamps, reports and notifies exactly like render/waveform does.
 */
function fakeVisualizer(options: WaveformRenderOptions) {
  const VIEWPORT_PIXELS = 200;
  const duration = options.durationSeconds ?? 0;
  let pixelsPerSecond = options.pixelsPerSecond ?? 100;
  let startSeconds = 0;
  const listeners = new Set<(viewport: AudioViewport) => void>();

  const windowSeconds = (): number => VIEWPORT_PIXELS / pixelsPerSecond;
  const viewport = (): AudioViewport => ({
    startSeconds,
    endSeconds: Math.min(duration, startSeconds + windowSeconds()),
  });
  const moveTo = (seconds: number): void => {
    startSeconds = Math.max(0, Math.min(Math.max(0, duration - windowSeconds()), seconds));
    for (const listener of listeners) listener(viewport());
  };

  return {
    redraw: vi.fn(),
    redrawFrame: vi.fn(),
    setZoom: vi.fn((next: number) => {
      pixelsPerSecond = next;
      moveTo(startSeconds);
    }),
    setRegions: vi.fn(),
    hitTest: vi.fn(() => ({seconds: 0})),
    setOffset: vi.fn((seconds: number) => moveTo(seconds)),
    viewport: vi.fn(viewport),
    onViewportChange: vi.fn((listener: (next: AudioViewport) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }),
    dispose: vi.fn(() => listeners.clear()),
    /** Test-only: what a user dragging the scrollbar looks like from here. */
    scrollTo: (seconds: number): void => moveTo(seconds),
  };
}

function toneClip(seconds: number): AudioClip {
  const sampleRate = 100;
  const samples = new Float32Array(seconds * sampleRate);
  for (let index = 0; index < samples.length; index++) samples[index] = Math.sin(index / 5);
  return createAudioClip({sampleRate, channelData: [samples]});
}
