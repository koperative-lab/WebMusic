// @vitest-environment jsdom

import {createAudioClip, type AudioClip} from '../../src/core';
import {afterEach, beforeAll, describe, expect, it, vi} from 'vitest';

const mocks = vi.hoisted(() => ({
  waveform: vi.fn(),
  spectrogram: vi.fn(),
  meter: vi.fn(),
  bind: vi.fn(),
  loadClip: vi.fn(),
}));

vi.mock('../../src/view/render/waveform', () => ({renderWaveformVisualizer: mocks.waveform}));
vi.mock('../../src/view/render/spectrogram-view', () => ({renderSpectrogramVisualizer: mocks.spectrogram}));
vi.mock('../../src/view/render/meter', () => ({renderLoudnessMeter: mocks.meter}));
vi.mock('../../src/view/render/binding', () => ({bindPlayerToWaveform: mocks.bind}));
vi.mock('../../src/play/api', () => ({loadClipFromUrl: mocks.loadClip}));

import {AudioViewElement, defineAudioViewElement} from '../../src/view/element/audio-view';
import {computeClipPeaks} from '../../src/view/headless/peaks';
import * as peakHelpers from '../../src/view/headless/peaks';
import {AudioPlayer} from '../../src/play/headless/audio-player';
import {AudioPlayerElement, defineAudioPlayerElement} from '../../src/play/element/audio-player';

beforeAll(() => {
  defineAudioViewElement('test-audio-view');
  defineAudioPlayerElement('test-audio-player');
});

afterEach(() => {
  document.body.replaceChildren();
  mocks.waveform.mockReset();
  mocks.spectrogram.mockReset();
  mocks.meter.mockReset();
  mocks.bind.mockReset();
  mocks.loadClip.mockReset();
  vi.restoreAllMocks();
});

describe('computeClipPeaks', () => {
  it('builds a complete min/max pyramid from an assigned clip', () => {
    const clip = createAudioClip({
      sampleRate: 8,
      channelData: [new Float32Array([-1, -0.5, 0.25, 1, -0.25, 0.5, 0, 0.75])],
    });

    const peaks = computeClipPeaks(clip, 2)!;
    expect(peaks.sampleRate).toBe(8);
    expect(peaks.channels).toBe(1);
    expect(peaks.levels.map((level) => level.data.length)).toEqual([8, 4, 2]);
    expect(Array.from(peaks.levels[0].data)).toEqual([-128, -64, 32, 127, -32, 64, 0, 96]);
    expect(Array.from(peaks.levels[2].data)).toEqual([-128, 127]);
  });

  it('returns undefined for a streaming-only clip', () => {
    const clip = createAudioClip({sampleRate: 44100, length: 0, numberOfChannels: 2, sourceUrl: '/song.mp3'});
    expect(computeClipPeaks(clip)).toBeUndefined();
  });
});

describe('<audio-view> player integration', () => {
  it('derives peaks from the player clip, delegates transport, and exposes keyboard seeking', () => {
    const visualizer = visualizerHarness(2);
    const unsubscribe = vi.fn();
    mocks.waveform.mockReturnValue(visualizer);
    mocks.bind.mockReturnValue({unsubscribe});

    const playerElement = document.createElement('div') as HTMLDivElement & {
      clip: AudioClip;
      player: {
        seconds: number;
        duration: number;
        seek: ReturnType<typeof vi.fn>;
      };
    };
    playerElement.id = 'player';
    playerElement.clip = toneClip(4);
    playerElement.player = {seconds: 1, duration: 4, seek: vi.fn()};
    document.body.appendChild(playerElement);

    const view = document.createElement('test-audio-view') as AudioViewElement;
    view.setAttribute('player', '#player');
    view.setAttribute('interactive', '');
    view.setAttribute('aria-label', 'Waveform seek position');
    document.body.appendChild(view);

    expect(mocks.waveform).toHaveBeenCalledOnce();
    const peaks = mocks.waveform.mock.calls[0][1];
    expect(peaks.levels[0].data.length).toBeGreaterThan(0);
    expect(view.getAttribute('role')).toBe('slider');
    expect(view.getAttribute('tabindex')).toBe('0');
    expect(view.getAttribute('aria-label')).toBe('Waveform seek position');
    expect(view.getAttribute('aria-valuemax')).toBe('4');

    const adapter = mocks.bind.mock.calls[0][0];
    adapter.seek(3);
    expect(playerElement.player.seek).toHaveBeenCalledWith(3);

    let seekDetail: {seconds: number} | undefined;
    view.addEventListener('webaudio:seek', (event) => {
      seekDetail = (event as CustomEvent<{seconds: number}>).detail;
    });
    view.dispatchEvent(new KeyboardEvent('keydown', {key: 'ArrowRight', bubbles: true}));
    expect(playerElement.player.seek).toHaveBeenLastCalledWith(2);
    expect(seekDetail?.seconds).toBe(2);
    expect(view.getAttribute('aria-valuenow')).toBe('2');

    view.remove();
    expect(view.getAttribute('aria-label')).toBe('Waveform seek position');
    expect(unsubscribe).toHaveBeenCalled();
    expect(visualizer.dispose).toHaveBeenCalledOnce();
  });

  it('maps presenter-owned pointer drag lifecycle through the renderer hit-test', () => {
    const visualizer = visualizerHarness(0);
    visualizer.hitTest.mockImplementation((x: number) => ({seconds: x / 10}));
    mocks.waveform.mockReturnValue(visualizer);
    mocks.bind.mockReturnValue({unsubscribe: vi.fn()});

    const playerElement = document.createElement('div') as HTMLDivElement & {
      clip: AudioClip;
      player: {seconds: number; duration: number; seek: ReturnType<typeof vi.fn>};
    };
    playerElement.id = 'pointer-player';
    playerElement.clip = toneClip(4);
    playerElement.player = {seconds: 0, duration: 4, seek: vi.fn()};
    document.body.append(playerElement);

    const view = document.createElement('test-audio-view') as AudioViewElement;
    view.setAttribute('player', '#pointer-player');
    view.setAttribute('interactive', '');
    document.body.append(view);
    const surface = view.querySelector<HTMLElement>('.wui-stage__surface')!;

    surface.dispatchEvent(new MouseEvent('pointerdown', {bubbles: true, clientX: 10}));
    surface.dispatchEvent(new MouseEvent('pointermove', {bubbles: true, clientX: 20}));
    surface.dispatchEvent(new MouseEvent('pointerup', {bubbles: true, clientX: 20}));

    expect(visualizer.hitTest).toHaveBeenNthCalledWith(1, 10, 0);
    expect(visualizer.hitTest).toHaveBeenNthCalledWith(2, 20, 0);
    expect(playerElement.player.seek.mock.calls.map(([seconds]) => seconds)).toEqual([1, 2]);
    expect(view.getAttribute('aria-valuenow')).toBe('2');

    view.interactive = false;
    surface.dispatchEvent(new MouseEvent('pointerdown', {bubbles: true, clientX: 30}));
    expect(playerElement.player.seek).toHaveBeenCalledTimes(2);
    expect(view.getAttribute('role')).toBe('img');
  });

  it('follows borrowed player data and commands through replacement and clearing', () => {
    mocks.waveform.mockImplementation(() => visualizerHarness(0));
    mocks.bind.mockReturnValue({unsubscribe: vi.fn()});
    const first = new AudioPlayer(toneClip(2));
    const second = new AudioPlayer(toneClip(6));
    const seek = vi.spyOn(second, 'seek').mockImplementation(() => {});
    const firstDispose = vi.spyOn(first, 'dispose');
    const secondDispose = vi.spyOn(second, 'dispose');
    const player = document.createElement('test-audio-player') as AudioPlayerElement;
    player.id = 'borrowed-player';
    player.player = first;
    document.body.append(player);
    const view = document.createElement('test-audio-view') as AudioViewElement;
    view.setAttribute('player', '#borrowed-player');
    document.body.append(view);
    const firstPeaks = mocks.waveform.mock.calls.at(-1)![1];

    player.player = second;
    const secondPeaks = mocks.waveform.mock.calls.at(-1)![1];
    expect(secondPeaks.levels[0].data.length).toBeGreaterThan(firstPeaks.levels[0].data.length);
    mocks.bind.mock.calls.at(-1)![0].seek(3);
    expect(seek).toHaveBeenCalledWith(3);
    expect(first.clock).toBeUndefined();
    expect(second.clock).toBeUndefined();

    player.player = undefined;
    expect(view.querySelector('[role="status"]')?.textContent).toContain('No audio to draw');
    view.remove();
    player.remove();
    expect(firstDispose).not.toHaveBeenCalled();
    expect(secondDispose).not.toHaveBeenCalled();
    first.dispose();
    second.dispose();
  });

  it('releases an owned player binding when only the source Element disconnects', () => {
    mocks.waveform.mockImplementation(() => visualizerHarness(0));
    const unsubscribe = vi.fn();
    mocks.bind.mockReturnValue({unsubscribe});
    const player = document.createElement('test-audio-player') as AudioPlayerElement;
    player.id = 'removed-player';
    const source = toneClip(2);
    player.clip = source;
    document.body.append(player);
    const owned = player.player!;
    const seek = vi.spyOn(owned, 'seek').mockImplementation(() => {});
    const view = document.createElement('test-audio-view') as AudioViewElement;
    view.setAttribute('player', '#removed-player');
    document.body.append(view);
    unsubscribe.mockClear();
    player.remove();
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(player.player).toBeUndefined();
    expect(player.clip).toBe(source);
    mocks.bind.mock.calls.at(-1)![0].seek(1);
    expect(seek).not.toHaveBeenCalled();
    expect(view.isConnected).toBe(true);
  });

  it('keeps explicit View data when a borrowed source changes', () => {
    mocks.waveform.mockImplementation(() => visualizerHarness(0));
    mocks.bind.mockReturnValue({unsubscribe: vi.fn()});
    const player = document.createElement('test-audio-player') as AudioPlayerElement;
    player.id = 'explicit-view-player';
    document.body.append(player);
    const view = document.createElement('test-audio-view') as AudioViewElement;
    view.clip = toneClip(1);
    view.setAttribute('player', '#explicit-view-player');
    document.body.append(view);
    const peaks = mocks.waveform.mock.calls.at(-1)![1];
    const external = new AudioPlayer(toneClip(6));
    player.player = external;
    expect(mocks.waveform.mock.calls.at(-1)![1]).toEqual(peaks);
    external.dispose();
  });

  it('reuses immutable peaks and the painted surface on graph readiness', () => {
    mocks.waveform.mockImplementation(() => visualizerHarness(0));
    mocks.bind.mockReturnValue({unsubscribe: vi.fn()});
    const compute = vi.spyOn(peakHelpers, 'computeClipPeaks');
    const source = document.createElement('div') as HTMLDivElement & {clip: AudioClip; currentTime: number};
    source.id = 'ready-source';
    source.currentTime = 0;
    source.clip = toneClip(3);
    document.body.append(source);
    const view = document.createElement('test-audio-view') as AudioViewElement;
    view.setAttribute('player', '#ready-source');
    document.body.append(view);
    expect(compute).toHaveBeenCalledOnce();
    expect(mocks.waveform).toHaveBeenCalledOnce();
    source.currentTime = 2;
    source.dispatchEvent(new CustomEvent('webaudio:loaded'));
    source.dispatchEvent(new CustomEvent('webaudio:loaded'));
    expect(mocks.waveform.mock.results.at(-1)!.value.redraw).toHaveBeenLastCalledWith(2, false);
    expect(compute).toHaveBeenCalledOnce();
    expect(mocks.waveform).toHaveBeenCalledOnce();
    source.dispatchEvent(new CustomEvent('webaudio:sourcechange'));
    expect(compute).toHaveBeenCalledOnce();
    source.clip = toneClip(4);
    source.dispatchEvent(new CustomEvent('webaudio:sourcechange'));
    expect(compute).toHaveBeenCalledTimes(2);
  });

  it('does not rebuild when the same immutable explicit clip is reapplied', () => {
    mocks.waveform.mockImplementation(() => visualizerHarness(0));
    mocks.bind.mockReturnValue({unsubscribe: vi.fn()});
    const compute = vi.spyOn(peakHelpers, 'computeClipPeaks');
    const view = document.createElement('test-audio-view') as AudioViewElement;
    const source = toneClip(2);
    view.clip = source;
    document.body.append(view);
    view.clip = source;
    view.clip = source;
    expect(compute).toHaveBeenCalledOnce();
    expect(mocks.waveform).toHaveBeenCalledOnce();
  });

  it('refreshes after the player announces a newly loaded clip', () => {
    mocks.waveform.mockImplementation(() => visualizerHarness(0));
    mocks.bind.mockReturnValue({unsubscribe: vi.fn()});
    const playerElement = document.createElement('div') as HTMLDivElement & {clip: AudioClip};
    playerElement.id = 'late-player';
    playerElement.clip = toneClip(1);
    document.body.appendChild(playerElement);

    const view = document.createElement('test-audio-view') as AudioViewElement;
    view.setAttribute('player', '#late-player');
    document.body.appendChild(view);
    const firstPeaks = mocks.waveform.mock.calls.at(-1)?.[1];

    playerElement.clip = toneClip(3);
    playerElement.dispatchEvent(new CustomEvent('webaudio:loaded'));
    const nextPeaks = mocks.waveform.mock.calls.at(-1)?.[1];
    expect(mocks.waveform).toHaveBeenCalledTimes(2);
    expect(nextPeaks.levels[0].data.length).toBeGreaterThan(firstPeaks.levels[0].data.length);
  });

  it('uses the nested player analyser for meter views', () => {
    const analyser = {} as AnalyserNode;
    mocks.meter.mockReturnValue(visualizerHarness(0));
    const playerElement = document.createElement('div') as HTMLDivElement & {
      player: {analyser: AnalyserNode};
    };
    playerElement.id = 'meter-player';
    playerElement.player = {analyser};
    document.body.appendChild(playerElement);

    const view = document.createElement('test-audio-view') as AudioViewElement;
    view.setAttribute('type', 'meter');
    view.setAttribute('player', '#meter-player');
    document.body.appendChild(view);

    expect(mocks.meter).toHaveBeenCalledWith(expect.any(HTMLElement), analyser, expect.any(Object));
  });
});

describe('<audio-view> src loading', () => {
  it('follows bound player loading and errors while preserving independent explicit data', () => {
    const clip = createAudioClip({sampleRate: 8, channelData: [new Float32Array(8)]});
    const player = Object.assign(document.createElement('div'), {
      loading: true, loadError: undefined as Error | undefined, clip,
    });
    player.id = 'loading-owner';
    const view = document.createElement('test-audio-view') as AudioViewElement;
    view.setAttribute('player', '#loading-owner');
    document.body.append(player, view);
    expect(view.querySelector('[data-kind="loading"]')).not.toBeNull();
    player.loading = false;
    player.loadError = new Error('Decode unavailable');
    player.dispatchEvent(new CustomEvent('webaudio:loadstatechange'));
    expect(view.querySelector('[data-kind="error"]')?.textContent).toBe('Decode unavailable');
    mocks.waveform.mockReturnValue(visualizerHarness(1));
    view.clip = clip;
    expect(view.querySelector('.wui-status')).toBeNull();
    player.loading = true;
    player.loadError = undefined;
    player.dispatchEvent(new CustomEvent('webaudio:loadstatechange'));
    expect(view.querySelector('.wui-status')).toBeNull();
  });

  it('distinguishes waiting, active loading and rendered audio', async () => {
    const view = document.createElement('test-audio-view') as AudioViewElement;
    document.body.appendChild(view);
    expect(view.querySelector('.wui-status')?.getAttribute('data-kind')).toBe('waiting');
    const request = deferred<AudioClip>();
    mocks.loadClip.mockReturnValue(request.promise);
    mocks.waveform.mockReturnValue(visualizerHarness(0));
    view.setAttribute('src', '/slow.wav');
    expect(view.querySelector('.wui-status')?.getAttribute('data-kind')).toBe('loading');
    expect(view.getAttribute('aria-busy')).toBe('true');
    await vi.waitFor(() => expect(mocks.loadClip).toHaveBeenCalledOnce());
    request.resolve(toneClip(1));
    await vi.waitFor(() => expect(mocks.waveform).toHaveBeenCalledOnce());
    expect(view.querySelector('.wui-status')).toBeNull();
    expect(view.hasAttribute('aria-busy')).toBe(false);
  });

  it('stops showing loading when its source is removed before a late load settles', async () => {
    const request = deferred<AudioClip>();
    mocks.loadClip.mockReturnValue(request.promise);
    const view = document.createElement('test-audio-view') as AudioViewElement;
    view.setAttribute('src', '/slow.wav');
    document.body.appendChild(view);
    await vi.waitFor(() => expect(mocks.loadClip).toHaveBeenCalledOnce());
    view.removeAttribute('src');
    expect(view.hasAttribute('aria-busy')).toBe(false);
    expect(view.querySelector('.wui-status')?.getAttribute('data-kind')).toBe('waiting');
    request.resolve(toneClip(1));
    await vi.waitFor(() => expect(view.hasAttribute('aria-busy')).toBe(false));
    expect(view.querySelector('.wui-status')?.getAttribute('data-kind')).toBe('waiting');
    expect(mocks.waveform).not.toHaveBeenCalled();
  });

  it.each(['src', 'peaks-src'] as const)('shows a failed %s load and recovers through removal and retry', async (attribute) => {
    const first = deferred<AudioClip & Response>();
    const second = deferred<AudioClip & Response>();
    const loader = attribute === 'src'
      ? mocks.loadClip.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
      : vi.spyOn(globalThis, 'fetch').mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    mocks.waveform.mockReturnValue(visualizerHarness(0));
    const view = document.createElement('test-audio-view') as AudioViewElement;
    const errors: unknown[] = [];
    view.addEventListener('webaudio:error', (event) => errors.push((event as CustomEvent).detail));
    document.body.append(view);
    view.setAttribute(attribute, '/missing');
    await vi.waitFor(() => expect(loader).toHaveBeenCalledOnce());
    first.reject(new Error('Source unavailable'));
    await vi.waitFor(() => expect(view.querySelector('[role="alert"]')?.textContent).toBe('Source unavailable'));
    expect(errors).toHaveLength(1);
    expect(view.hasAttribute('aria-busy')).toBe(false);
    view.removeAttribute(attribute);
    expect(view.querySelector('.wui-status')?.getAttribute('data-kind')).toBe('waiting');
    view.setAttribute(attribute, '/retry');
    expect(view.querySelector('.wui-status')?.getAttribute('data-kind')).toBe('loading');
    await vi.waitFor(() => expect(loader).toHaveBeenCalledTimes(2));
    const result = attribute === 'src' ? toneClip(1) : new Response(JSON.stringify({
      version: 2, channels: 1, sample_rate: 100, samples_per_pixel: 10,
      bits: 8, length: 2, data: [-10, 10, -20, 20],
    }));
    second.resolve(result as AudioClip & Response);
    await vi.waitFor(() => expect(mocks.waveform).toHaveBeenCalledOnce());
    expect(view.querySelector('.wui-status')).toBeNull();
    expect(view.hasAttribute('aria-busy')).toBe(false);
  });

  it.each(['src', 'peaks-src'] as const)('ignores a stale %s failure while the replacement remains pending', async (attribute) => {
    const first = deferred<AudioClip & Response>();
    const second = deferred<AudioClip & Response>();
    const loader = attribute === 'src'
      ? mocks.loadClip.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
      : vi.spyOn(globalThis, 'fetch').mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const view = document.createElement('test-audio-view') as AudioViewElement;
    const errors: unknown[] = [];
    view.addEventListener('webaudio:error', (event) => errors.push((event as CustomEvent).detail));
    document.body.append(view);
    view.setAttribute(attribute, '/old');
    await vi.waitFor(() => expect(loader).toHaveBeenCalledOnce());
    view.setAttribute(attribute, '/new');
    await vi.waitFor(() => expect(loader).toHaveBeenCalledTimes(2));
    first.reject(new Error('Stale failure'));
    await first.promise.catch(() => {});
    await Promise.resolve();
    expect(errors).toHaveLength(0);
    expect(view.querySelector('.wui-status')?.getAttribute('data-kind')).toBe('loading');
    second.reject(new Error('Current failure'));
    await vi.waitFor(() => expect(view.querySelector('[role="alert"]')?.textContent).toBe('Current failure'));
    expect(errors).toHaveLength(1);
  });

  it('keeps the other source failure when cancelling a pending alternative, then accepts explicit peaks', async () => {
    const pendingClip = deferred<AudioClip>();
    mocks.loadClip.mockReturnValue(pendingClip.promise);
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Peaks unavailable'));
    mocks.waveform.mockReturnValue(visualizerHarness(0));
    const view = document.createElement('test-audio-view') as AudioViewElement;
    const errors: unknown[] = [];
    view.addEventListener('webaudio:error', (event) => errors.push((event as CustomEvent).detail));
    view.setAttribute('src', '/audio');
    view.setAttribute('peaks-src', '/peaks');
    document.body.append(view);
    await vi.waitFor(() => expect(errors).toHaveLength(1));
    expect(view.querySelector('.wui-status')?.getAttribute('data-kind')).toBe('loading');
    view.removeAttribute('src');
    expect(view.querySelector('[role="alert"]')?.textContent).toBe('Peaks unavailable');
    view.peaks = computeClipPeaks(toneClip(1))!;
    expect(view.querySelector('.wui-status')).toBeNull();
    expect(mocks.waveform).toHaveBeenCalledOnce();
    pendingClip.reject(new Error('Obsolete audio failure'));
    await pendingClip.promise.catch(() => {});
    expect(errors).toHaveLength(1);
  });

  it('aborts its current load when disconnected', async () => {
    const request = deferred<AudioClip>();
    mocks.loadClip.mockReturnValue(request.promise);
    const view = document.createElement('test-audio-view') as AudioViewElement;
    view.setAttribute('src', '/slow.wav');
    document.body.appendChild(view);
    await vi.waitFor(() => expect(mocks.loadClip).toHaveBeenCalledOnce());
    const options = mocks.loadClip.mock.calls[0][1] as {signal: AbortSignal};

    view.remove();
    expect(options.signal.aborted).toBe(true);
    request.resolve(toneClip(1));
  });
});

function toneClip(seconds: number): AudioClip {
  const sampleRate = 100;
  const samples = new Float32Array(seconds * sampleRate);
  for (let index = 0; index < samples.length; index++) samples[index] = Math.sin(index / 5);
  return createAudioClip({sampleRate, channelData: [samples]});
}

function visualizerHarness(hitSeconds: number) {
  return {
    redraw: vi.fn(),
    setZoom: vi.fn(),
    setRegions: vi.fn(),
    hitTest: vi.fn((_x: number, _y: number) => ({seconds: hitSeconds})),
    dispose: vi.fn(),
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return {promise, resolve, reject};
}
