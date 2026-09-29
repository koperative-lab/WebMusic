// @vitest-environment jsdom
import {afterEach, describe, expect, it, vi} from 'vitest';
import {defineAudioTransientAnalyzerElement, type AudioTransientAnalyzerElement} from '../../src/analyze/element/audio-transient-analyzer';

interface FakeRunner {
  source: AnalyserNode;
  options: Record<string, unknown>;
  running: boolean;
  start(onFrame: (frame: unknown) => void): void;
  stop: ReturnType<typeof vi.fn>;
  emit(time: number, value: number, rms?: number): void;
}

const realtime = vi.hoisted(() => ({runners: [] as FakeRunner[]}));
vi.mock('../../src/analyze/headless/realtime', () => ({
  createRealtimeAnalyzer: (source: AnalyserNode, options: Record<string, unknown>) => {
    let callback: ((frame: unknown) => void) | undefined;
    const runner: FakeRunner = {
      source, options, running: false,
      start(onFrame: (frame: unknown) => void) { callback = onFrame; runner.running = true; },
      stop: vi.fn(() => { runner.running = false; }),
      emit(time, value, rms = .2) {
        callback?.({time, rms, peak: rms, centroid: 1_000, frequencyData: new Uint8Array(16).fill(value)});
      },
    };
    realtime.runners.push(runner);
    return runner;
  },
}));

defineAudioTransientAnalyzerElement();

function analyser(): AnalyserNode {
  return {fftSize: 32, context: {sampleRate: 48_000}} as AnalyserNode;
}

function player(node: AnalyserNode, playing = true) {
  const element = Object.assign(document.createElement('div'), {
    analyser: node, playing, currentTime: 0, duration: 2,
  });
  element.id = 'source';
  document.body.append(element);
  return element;
}

afterEach(() => {
  document.body.replaceChildren();
  realtime.runners.length = 0;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('<audio-transient-analyzer>', () => {
  it('borrows the playing graph, emits approximate attack cues and supports live inspection controls', () => {
    const tap = analyser();
    const owner = player(tap);
    const element = document.createElement('audio-transient-analyzer') as AudioTransientAnalyzerElement;
    element.setAttribute('player', '#source');
    document.body.append(element);
    expect(realtime.runners).toHaveLength(1);
    expect(realtime.runners[0]!.source).toBe(tap);
    expect(realtime.runners[0]!.options).toMatchObject({includeSpectrum: true, intervalMs: 50});
    expect(realtime.runners[0]!.options).not.toHaveProperty('fftSize');
    const hits: Array<{timeMs: number; strength: number; intervalMs?: number}> = [];
    element.addEventListener('webaudio:transient', (event) => hits.push((event as CustomEvent).detail));
    realtime.runners[0]!.emit(0, 10);
    realtime.runners[0]!.emit(50, 150);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.timeMs).toBe(50);
    expect(hits[0]!.strength).toBeGreaterThan(0);
    expect(element.hitCount).toBe(1);
    expect(element.querySelector('.wui-transient-analyzer__column[data-hit="true"]')).not.toBeNull();
    const freeze = element.querySelector<HTMLButtonElement>('[part="freeze"]')!;
    freeze.click();
    expect(element.frozen).toBe(true);
    expect(realtime.runners[0]!.stop).toHaveBeenCalledOnce();
    realtime.runners[0]!.emit(100, 255);
    expect(element.hitCount).toBe(1);
    freeze.click();
    expect(element.frozen).toBe(false);
    expect(realtime.runners).toHaveLength(2);
    const sensitivity = element.querySelector<HTMLInputElement>('[part="sensitivity"]')!;
    sensitivity.value = '80';
    sensitivity.dispatchEvent(new Event('input', {bubbles: true}));
    expect(element.sensitivity).toBe(.8);
    element.querySelector<HTMLButtonElement>('[part="clear"]')!.click();
    expect(element.hitCount).toBe(0);
    expect(element.sample).toBeUndefined();
    owner.playing = false;
    owner.dispatchEvent(new CustomEvent('webaudio:statechange', {detail: {playing: false}}));
    expect(realtime.runners[1]!.stop).toHaveBeenCalledOnce();
    expect(element.textContent).toContain('Paused');
    expect(tap.fftSize).toBe(32);
  });

  it('invalidates stale source frames and keeps explicit input independent of player pauses', () => {
    const owner = player(analyser());
    const element = document.createElement('audio-transient-analyzer') as AudioTransientAnalyzerElement;
    element.setAttribute('player', '#source');
    document.body.append(element);
    realtime.runners[0]!.emit(0, 10);
    realtime.runners[0]!.emit(50, 150);
    expect(element.hitCount).toBe(1);
    owner.analyser = analyser();
    owner.dispatchEvent(new CustomEvent('webaudio:sourcechange'));
    expect(element.hitCount).toBe(0);
    expect(realtime.runners[1]!.source).toBe(owner.analyser);
    realtime.runners[0]!.emit(100, 255);
    expect(element.hitCount).toBe(0);
    const direct = analyser();
    element.analyser = direct;
    expect(realtime.runners[2]!.source).toBe(direct);
    owner.playing = false;
    owner.dispatchEvent(new CustomEvent('webaudio:statechange', {detail: {playing: false}}));
    expect(realtime.runners[2]!.running).toBe(true);
    element.remove();
    expect(realtime.runners[2]!.stop).toHaveBeenCalledOnce();
  });

  it('clears stale evidence on a frame stall and retries while connected', () => {
    vi.useFakeTimers();
    const element = document.createElement('audio-transient-analyzer') as AudioTransientAnalyzerElement;
    element.analyser = analyser();
    document.body.append(element);
    realtime.runners[0]!.emit(0, 10);
    realtime.runners[0]!.emit(50, 150);
    const errors: Error[] = [];
    element.addEventListener('webaudio:error', (event) => errors.push((event as CustomEvent).detail.error));
    vi.advanceTimersByTime(501);
    expect(element.hitCount).toBe(0);
    expect(element.sample).toBeUndefined();
    expect(element.textContent).toContain('Live audio unavailable');
    expect(errors.map((error) => error.message)).toEqual(['Live transient frames stopped arriving.']);
    vi.advanceTimersByTime(500);
    expect(realtime.runners).toHaveLength(2);
    element.remove();
    vi.advanceTimersByTime(1_000);
    expect(realtime.runners).toHaveLength(2);
  });

  it('does not let a stall error listener leave an old watchdog on a replacement graph', () => {
    vi.useFakeTimers();
    const element = document.createElement('audio-transient-analyzer') as AudioTransientAnalyzerElement;
    element.analyser = analyser();
    document.body.append(element);
    let errors = 0;
    element.addEventListener('webaudio:error', () => {
      errors += 1;
      element.analyser = analyser();
    });
    vi.advanceTimersByTime(501);
    expect(errors).toBe(1);
    expect(realtime.runners).toHaveLength(2);
    vi.advanceTimersByTime(250);
    realtime.runners[1]!.emit(750, 10);
    vi.advanceTimersByTime(251);
    expect(errors).toBe(1);
    expect(realtime.runners).toHaveLength(2);
    expect(realtime.runners[1]!.running).toBe(true);
    element.remove();
  });
});
