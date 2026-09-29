// @vitest-environment jsdom
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {
  defineAudioOscilloscopeElement,
  selectOscilloscopeTrace,
  type AudioOscilloscopeElement,
} from '../../src/analyze/element/audio-oscilloscope';

interface FakeRunner {
  source: AnalyserNode;
  options: Record<string, unknown>;
  running: boolean;
  start(onFrame: (frame: unknown) => void): void;
  stop: ReturnType<typeof vi.fn>;
  emit(samples?: Float32Array): void;
}
const realtime = vi.hoisted(() => ({runners: [] as FakeRunner[]}));
vi.mock('../../src/analyze/headless/realtime', () => ({
  createRealtimeAnalyzer: (source: AnalyserNode, options: Record<string, unknown>) => {
    let callback: ((frame: unknown) => void) | undefined;
    const runner: FakeRunner = {
      source, options, running: false,
      start(onFrame: (frame: unknown) => void) { callback = onFrame; runner.running = true; },
      stop: vi.fn(() => { runner.running = false; }),
      emit(samples = Float32Array.from([-1, -1, 1, 1, -1, 1, 1, 1])) {
        callback?.({timeDomainData: samples, rms: .5, peak: 1, centroid: 1_000, time: 0});
      },
    };
    realtime.runners.push(runner);
    return runner;
  },
}));

defineAudioOscilloscopeElement();

function analyser(sampleRate = 1_000): AnalyserNode {
  return {fftSize: 8, context: {sampleRate}} as AnalyserNode;
}

function player(node: AnalyserNode, playing = false) {
  const element = Object.assign(document.createElement('div'), {
    analyser: node, playing, currentTime: 0, duration: 2,
  });
  element.id = 'source';
  document.body.append(element);
  return element;
}

function panel(selector = '#source'): AudioOscilloscopeElement {
  const element = document.createElement('audio-oscilloscope') as AudioOscilloscopeElement;
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

describe('selectOscilloscopeTrace', () => {
  it('uses the latest complete rising or falling triggered window and caps the timebase', () => {
    const samples = Float32Array.from([-1, -1, 1, 1, -1, 1, 1, 1]);
    const rising = selectOscilloscopeTrace(samples, 1_000, 2, 0, 'rising');
    expect(rising.triggered).toBe(true);
    expect(Array.from(rising.samples)).toEqual([1, 1, 1]);
    const falling = selectOscilloscopeTrace(samples, 1_000, 2, 0, 'falling');
    expect(falling.triggered).toBe(true);
    expect(Array.from(falling.samples)).toEqual([-1, 1, 1]);
    const free = selectOscilloscopeTrace(samples, 1_000, 100, 0, 'rising');
    expect(free.timebaseMs).toBe(7);
    expect(free.triggered).toBe(false);
    expect(Array.from(free.samples)).toEqual(Array.from(samples));
  });

  it('shows a truthful untriggered free-running window when no edge matches', () => {
    const samples = new Float32Array(8).fill(.5);
    const trace = selectOscilloscopeTrace(samples, 1_000, 3, 0, 'rising');
    expect(trace.triggered).toBe(false);
    expect(trace.samples.length).toBe(4);
    expect(selectOscilloscopeTrace(new Float32Array(8), 1_000, 3, 0, 'rising').silent).toBe(true);
    expect(() => selectOscilloscopeTrace(new Float32Array(1), 1_000, 3, 0, 'off')).toThrow();
    expect(() => selectOscilloscopeTrace(samples, 1_000, 0, 0, 'off')).toThrow('timebaseMs');
    expect(() => selectOscilloscopeTrace(samples, 1_000, 3, 2, 'off')).toThrow('triggerLevel');
  });
});

describe('<audio-oscilloscope>', () => {
  it('borrows the playing graph, probes a triggered window, edits controls and freezes without changing FFT size', () => {
    const tap = analyser();
    const owner = player(tap);
    const scope = panel();
    expect(realtime.runners).toHaveLength(0);
    expect(scope.querySelectorAll('[part~="surface"]')).toHaveLength(1);
    owner.playing = true;
    owner.dispatchEvent(new CustomEvent('webaudio:statechange', {detail: {playing: true}}));
    expect(realtime.runners).toHaveLength(1);
    expect(realtime.runners[0]!.source).toBe(tap);
    expect(realtime.runners[0]!.options).toMatchObject({includeTimeDomain: true, intervalMs: 50});
    expect(realtime.runners[0]!.options).not.toHaveProperty('fftSize');
    realtime.runners[0]!.emit();
    expect(scope.timebaseMs).toBe(7);
    expect(scope.trace?.timebaseMs).toBe(7);
    expect(scope.trace?.triggered).toBe(false);
    scope.timebaseMs = 2;
    expect(scope.trace?.triggered).toBe(true);
    expect(scope.textContent).toContain('Live, triggered');
    const probes: Array<{timeMs: number; amplitude?: number}> = [];
    scope.addEventListener('webaudio:oscilloscopeprobe', (event) => probes.push((event as CustomEvent).detail));
    scope.querySelector<HTMLCanvasElement>('[part="plot"]')!
      .dispatchEvent(new KeyboardEvent('keydown', {key: 'End', bubbles: true}));
    expect(probes.at(-1)?.timeMs).toBe(scope.trace?.timebaseMs);
    expect(probes.at(-1)?.amplitude).toBe(1);
    const edge = scope.querySelector<HTMLSelectElement>('[part="trigger-edge"]')!;
    edge.value = 'off';
    edge.dispatchEvent(new Event('change', {bubbles: true}));
    expect(scope.triggerEdge).toBe('off');
    expect(scope.trace?.triggered).toBe(false);
    const freeze = scope.querySelector<HTMLButtonElement>('[part="freeze"]')!;
    freeze.click();
    expect(scope.frozen).toBe(true);
    expect(realtime.runners[0]!.stop).toHaveBeenCalledOnce();
    const frozenTrace = scope.trace;
    realtime.runners[0]!.emit();
    expect(scope.trace).toBe(frozenTrace);
    freeze.click();
    expect(scope.frozen).toBe(false);
    expect(realtime.runners).toHaveLength(2);
    owner.playing = false;
    owner.dispatchEvent(new CustomEvent('webaudio:statechange', {detail: {playing: false}}));
    expect(realtime.runners[1]!.stop).toHaveBeenCalledOnce();
    expect(scope.trace).toBeUndefined();
    expect(scope.textContent).toContain('Playback paused');
    expect(tap.fftSize).toBe(8);
  });

  it('treats explicit false-valued demo attributes as off and constrains scope controls', () => {
    player(analyser(), true);
    const scope = document.createElement('audio-oscilloscope') as AudioOscilloscopeElement;
    scope.setAttribute('player', '#source');
    scope.setAttribute('frozen', 'false');
    scope.setAttribute('timebase-ms', '999');
    scope.setAttribute('trigger-level', '5');
    scope.setAttribute('trigger-edge', 'unknown');
    document.body.append(scope);
    expect(scope.frozen).toBe(false);
    expect(scope.triggerLevel).toBe(1);
    expect(scope.triggerEdge).toBe('rising');
    realtime.runners[0]!.emit();
    expect(scope.timebaseMs).toBe(7);
    expect(scope.trace?.timebaseMs).toBe(7);
    scope.remove();
  });

  it('invalidates replaced sources, stale frames and direct seek jumps; explicit input takes precedence', () => {
    const owner = player(analyser(), true);
    const scope = panel();
    realtime.runners[0]!.emit();
    scope.frozen = true;
    owner.analyser = analyser(2_000);
    owner.dispatchEvent(new CustomEvent('webaudio:sourcechange'));
    expect(scope.frozen).toBe(false);
    expect(scope.trace).toBeUndefined();
    expect(realtime.runners[1]!.source).toBe(owner.analyser);
    realtime.runners[0]!.emit();
    expect(scope.trace).toBeUndefined();
    realtime.runners[1]!.emit();
    expect(scope.trace).toBeDefined();
    owner.dispatchEvent(new CustomEvent('webaudio:timeupdate', {detail: {seconds: .1}}));
    owner.dispatchEvent(new CustomEvent('webaudio:timeupdate', {detail: {seconds: 8}}));
    expect(realtime.runners[2]!.source).toBe(owner.analyser);
    expect(scope.trace).toBeUndefined();

    const direct = analyser();
    scope.analyser = direct;
    expect(realtime.runners[3]!.source).toBe(direct);
    owner.playing = false;
    owner.dispatchEvent(new CustomEvent('webaudio:statechange', {detail: {playing: false}}));
    expect(realtime.runners[3]!.running).toBe(true);
    scope.remove();
    expect(realtime.runners[3]!.stop).toHaveBeenCalledOnce();
  });

  it('clears stalled or hidden frames and retries only while connected and visible', () => {
    vi.useFakeTimers();
    const scope = document.createElement('audio-oscilloscope') as AudioOscilloscopeElement;
    scope.analyser = analyser();
    document.body.append(scope);
    realtime.runners[0]!.emit();
    const errors: Error[] = [];
    scope.addEventListener('webaudio:error', (event) => errors.push((event as CustomEvent).detail.error));
    vi.advanceTimersByTime(501);
    expect(scope.trace).toBeUndefined();
    expect(scope.textContent).toContain('Analyser unavailable');
    expect(errors.map((error) => error.message)).toEqual(['Oscilloscope stopped producing frames']);
    vi.advanceTimersByTime(500);
    expect(realtime.runners).toHaveLength(2);
    realtime.runners[1]!.emit();
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    document.dispatchEvent(new Event('visibilitychange'));
    expect(scope.trace).toBeUndefined();
    expect(realtime.runners[1]!.stop).toHaveBeenCalledOnce();
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
    document.dispatchEvent(new Event('visibilitychange'));
    expect(realtime.runners).toHaveLength(3);
    scope.remove();
    vi.advanceTimersByTime(1_000);
    expect(realtime.runners).toHaveLength(3);
  });
});
