// @vitest-environment jsdom
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {
  defineAudioSpectrumAnalyzerElement,
  type AudioSpectrumAnalyzerElement,
} from '../../src/analyze/element/audio-spectrum-analyzer';

interface FakeRunner {
  source: AnalyserNode;
  options: Record<string, unknown>;
  running: boolean;
  start(onFrame: (frame: unknown) => void): void;
  stop: ReturnType<typeof vi.fn>;
  emit(bytes?: Uint8Array): void;
}
const realtime = vi.hoisted(() => ({runners: [] as FakeRunner[]}));
vi.mock('../../src/analyze/headless/realtime', () => ({
  createRealtimeAnalyzer: (source: AnalyserNode, options: Record<string, unknown>) => {
    let callback: ((frame: unknown) => void) | undefined;
    const runner: FakeRunner = {
      source, options, running: false,
      start(onFrame: (frame: unknown) => void) { callback = onFrame; runner.running = true; },
      stop: vi.fn(() => { runner.running = false; }),
      emit(bytes = new Uint8Array(1024).fill(0)) {
        callback?.({frequencyData: bytes, rms: .2, peak: .4, centroid: 1_000, time: 0});
      },
    };
    realtime.runners.push(runner);
    return runner;
  },
}));

defineAudioSpectrumAnalyzerElement();

function analyser(): AnalyserNode {
  return {
    fftSize: 2048,
    minDecibels: -100,
    maxDecibels: -30,
    context: {sampleRate: 48_000},
  } as AnalyserNode;
}

function player(node: AnalyserNode, playing = false) {
  const element = Object.assign(document.createElement('div'), {
    analyser: node, playing, currentTime: 0, duration: 2,
  });
  element.id = 'source';
  document.body.append(element);
  return element;
}

function panel(selector = '#source'): AudioSpectrumAnalyzerElement {
  const element = document.createElement('audio-spectrum-analyzer') as AudioSpectrumAnalyzerElement;
  element.setAttribute('player', selector);
  document.body.append(element);
  return element;
}

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    setTransform() {}, clearRect() {}, fillRect() {}, beginPath() {}, moveTo() {},
    lineTo() {}, stroke() {}, fillText() {}, setLineDash() {},
  } as unknown as CanvasRenderingContext2D);
});

afterEach(() => {
  document.body.replaceChildren();
  realtime.runners.length = 0;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('<audio-spectrum-analyzer>', () => {
  it('treats explicit false-valued playground attributes as off and can enable them', () => {
    player(analyser(), true);
    const spectrum = document.createElement('audio-spectrum-analyzer') as AudioSpectrumAnalyzerElement;
    spectrum.setAttribute('player', '#source');
    spectrum.setAttribute('frozen', 'false');
    spectrum.setAttribute('peak-hold', 'false');
    document.body.append(spectrum);
    expect(spectrum.frozen).toBe(false);
    expect(spectrum.peakHold).toBe(false);
    expect(realtime.runners).toHaveLength(1);
    realtime.runners[0]!.emit();
    const freeze = spectrum.querySelector<HTMLButtonElement>('[part="freeze"]')!;
    const hold = spectrum.querySelector<HTMLButtonElement>('[part="peak-hold"]')!;
    expect(freeze.getAttribute('aria-pressed')).toBe('false');
    expect(hold.getAttribute('aria-pressed')).toBe('false');
    hold.click();
    expect(spectrum.peakHold).toBe(true);
    expect(spectrum.getAttribute('peak-hold')).toBe('');
    freeze.click();
    expect(spectrum.frozen).toBe(true);
    expect(spectrum.getAttribute('frozen')).toBe('');
    expect(realtime.runners[0]!.stop).toHaveBeenCalledOnce();
  });

  it('borrows one player analyser, converts its byte bins to the configured dB range, freezes and resumes', () => {
    const tap = analyser();
    const owner = player(tap);
    const spectrum = panel();
    expect(realtime.runners).toHaveLength(0);
    expect(spectrum.querySelectorAll('[part~="surface"]')).toHaveLength(1);
    owner.playing = true;
    owner.dispatchEvent(new CustomEvent('webaudio:statechange', {detail: {playing: true}}));
    expect(realtime.runners).toHaveLength(1);
    expect(realtime.runners[0]!.source).toBe(tap);
    expect(realtime.runners[0]!.options).toMatchObject({includeSpectrum: true, intervalMs: 50});
    expect(realtime.runners[0]!.options).not.toHaveProperty('fftSize');
    const bytes = new Uint8Array(1024).fill(0);
    bytes[Math.round(1_000 * 2048 / 48_000)] = 255;
    realtime.runners[0]!.emit(bytes);
    expect(spectrum.frame?.bins[Math.round(1_000 * 2048 / 48_000)]).toBe(-30);
    expect(spectrum.textContent).toContain('-30.0 dB');
    const freeze = spectrum.querySelector<HTMLButtonElement>('[part="freeze"]')!;
    freeze.click();
    expect(spectrum.frozen).toBe(true);
    expect(realtime.runners[0]!.stop).toHaveBeenCalledOnce();
    const frozenFrame = spectrum.frame;
    realtime.runners[0]!.emit();
    expect(spectrum.frame).toBe(frozenFrame);
    freeze.click();
    expect(spectrum.frozen).toBe(false);
    expect(realtime.runners).toHaveLength(2);
    owner.playing = false;
    owner.dispatchEvent(new CustomEvent('webaudio:statechange', {detail: {playing: false}}));
    expect(realtime.runners[1]!.stop).toHaveBeenCalledOnce();
    expect(spectrum.frame).toBeUndefined();
    expect(spectrum.textContent).toContain('Playback paused');
  });

  it('invalidates replaced sources and stale callbacks, and supports an explicit analyser', () => {
    const first = analyser();
    const owner = player(first, true);
    const spectrum = panel();
    expect(realtime.runners).toHaveLength(1);
    realtime.runners[0]!.emit();
    const second = analyser();
    owner.analyser = second;
    owner.dispatchEvent(new CustomEvent('webaudio:sourcechange', {detail: {revision: 2}}));
    expect(realtime.runners[0]!.stop).toHaveBeenCalledOnce();
    expect(spectrum.frame).toBeUndefined();
    expect(realtime.runners[1]!.source).toBe(second);
    realtime.runners[0]!.emit();
    expect(spectrum.frame).toBeUndefined();
    realtime.runners[1]!.emit();
    expect(spectrum.frame).toBeDefined();

    const direct = analyser();
    spectrum.analyser = direct;
    expect(realtime.runners[1]!.stop).toHaveBeenCalledOnce();
    expect(realtime.runners[2]!.source).toBe(direct);
    owner.playing = false;
    owner.dispatchEvent(new CustomEvent('webaudio:statechange', {detail: {playing: false}}));
    expect(realtime.runners[2]!.running).toBe(true);
    spectrum.remove();
    expect(realtime.runners[2]!.stop).toHaveBeenCalledOnce();
  });

  it('unfreezes on source replacement and invalidates frames after a direct time jump', () => {
    const owner = player(analyser(), true);
    const spectrum = panel();
    realtime.runners[0]!.emit();
    spectrum.frozen = true;
    expect(spectrum.frame).toBeDefined();

    owner.analyser = analyser();
    owner.dispatchEvent(new CustomEvent('webaudio:sourcechange'));
    expect(spectrum.frozen).toBe(false);
    expect(spectrum.frame).toBeUndefined();
    expect(realtime.runners[1]!.source).toBe(owner.analyser);
    realtime.runners[1]!.emit();
    expect(spectrum.frame).toBeDefined();

    owner.dispatchEvent(new CustomEvent('webaudio:timeupdate', {detail: {seconds: 0.1}}));
    owner.dispatchEvent(new CustomEvent('webaudio:timeupdate', {detail: {seconds: 8}}));
    expect(realtime.runners[1]!.stop).toHaveBeenCalledOnce();
    expect(spectrum.frame).toBeUndefined();
    expect(realtime.runners[2]!.source).toBe(owner.analyser);
    realtime.runners[2]!.emit();
    expect(spectrum.frame).toBeDefined();
  });

  it('provides keyboard frequency probing and clears a stalled frame with an observable error', () => {
    vi.useFakeTimers();
    const spectrum = document.createElement('audio-spectrum-analyzer') as AudioSpectrumAnalyzerElement;
    spectrum.analyser = analyser();
    document.body.append(spectrum);
    realtime.runners[0]!.emit();
    const probes: Array<{frequency: number; decibels?: number}> = [];
    const errors: Error[] = [];
    spectrum.addEventListener('webaudio:spectrumprobe', (event) => probes.push((event as CustomEvent).detail));
    spectrum.addEventListener('webaudio:error', (event) => errors.push((event as CustomEvent).detail.error));
    const plot = spectrum.querySelector<HTMLCanvasElement>('[part="plot"]')!;
    plot.dispatchEvent(new KeyboardEvent('keydown', {key: 'ArrowRight', bubbles: true}));
    expect(probes).toHaveLength(1);
    expect(spectrum.selectedFrequency).toBeGreaterThan(1_000);
    spectrum.maxFrequency = 500;
    expect(spectrum.selectedFrequency).toBe(500);
    vi.advanceTimersByTime(501);
    expect(spectrum.frame).toBeUndefined();
    expect(spectrum.textContent).toContain('Analyser unavailable');
    expect(realtime.runners[0]!.stop).toHaveBeenCalledOnce();
    expect(errors.map((error) => error.message)).toEqual(['Spectrum analyser stopped producing frames']);
    realtime.runners[0]!.emit();
    expect(spectrum.frame).toBeUndefined();
    vi.advanceTimersByTime(500);
    expect(realtime.runners).toHaveLength(2);
    realtime.runners[1]!.emit();
    expect(spectrum.frame).toBeDefined();
    spectrum.remove();
    expect(realtime.runners[1]!.stop).toHaveBeenCalledOnce();
  });
});
