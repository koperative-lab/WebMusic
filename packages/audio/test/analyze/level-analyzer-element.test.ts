// @vitest-environment jsdom
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {defineAudioLevelAnalyzerElement, type AudioLevelAnalyzerElement} from '../../src/analyze/element/audio-level-analyzer';
import {defineAllAudioElements} from '../../src/analyze/element';

defineAudioLevelAnalyzerElement();
defineAllAudioElements();

function analyser() {
  let amplitude = 0.2;
  const node = {
    fftSize: 16,
    frequencyBinCount: 8,
    context: {sampleRate: 48_000},
    getFloatTimeDomainData: vi.fn((samples: Float32Array) => samples.fill(amplitude)),
    getByteFrequencyData: vi.fn((bins: Uint8Array) => bins.fill(0)),
  };
  return {
    node: node as unknown as AnalyserNode,
    setAmplitude(value: number) { amplitude = value; },
    reads: node.getFloatTimeDomainData,
  };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  document.body.replaceChildren();
  vi.useRealTimers();
});

describe('audio-level-analyzer', () => {
  it('registers live tools without retired result-follower tags', () => {
    for (const tag of ['audio-level-analyzer', 'audio-meter', 'audio-oscilloscope', 'audio-spectrum-analyzer', 'audio-transient-analyzer']) {
      expect(customElements.get(tag)).toBeDefined();
    }
    for (const tag of ['audio-onset-analysis', 'audio-beat-analysis', 'audio-pitch-analysis', 'audio-tuner']) {
      expect(customElements.get(tag)).toBeUndefined();
    }
  });

  it('samples a caller-owned graph, keeps a peak hold, and exposes adjustable inspection controls', () => {
    const source = analyser();
    const element = document.createElement('audio-level-analyzer') as AudioLevelAnalyzerElement;
    element.analyser = source.node;
    const readings: Array<{rmsDbfs: number; crestDb: number; thresholdDbfs: number}> = [];
    element.addEventListener('webaudio:levelchange', (event) => readings.push((event as CustomEvent).detail));
    document.body.append(element);

    vi.advanceTimersByTime(50);
    expect(readings).toHaveLength(1);
    expect(readings[0]!.rmsDbfs).toBeCloseTo(20 * Math.log10(0.2));
    expect(readings[0]!.crestDb).toBeCloseTo(0);
    expect(element.heldPeakDbfs).toBeCloseTo(readings[0]!.rmsDbfs);
    expect(element.querySelectorAll('.wui-level-analyzer__column')).toHaveLength(64);

    source.setAmplitude(0.1);
    vi.advanceTimersByTime(50);
    expect(element.sample!.peakDbfs).toBeCloseTo(-20);
    expect(element.heldPeakDbfs).toBeCloseTo(20 * Math.log10(0.2));

    const threshold = element.querySelector<HTMLInputElement>('input[type="range"]')!;
    threshold.value = '-24';
    threshold.dispatchEvent(new Event('input', {bubbles: true}));
    expect(element.thresholdDbfs).toBe(-24);
    expect(element.querySelector<HTMLElement>('.wui-level-analyzer__plot')!.dataset.over).toBe('true');

    element.querySelector<HTMLButtonElement>('button')!.click();
    expect(element.frozen).toBe(true);
    const count = readings.length;
    source.setAmplitude(0.8);
    vi.advanceTimersByTime(50);
    expect(readings).toHaveLength(count);
    expect(element.sample!.peakDbfs).toBeCloseTo(-20);
    element.querySelector<HTMLButtonElement>('button')!.click();
    vi.advanceTimersByTime(50);
    expect(element.sample!.peakDbfs).toBeCloseTo(20 * Math.log10(0.8));

    source.setAmplitude(0.05);
    vi.advanceTimersByTime(50);
    element.querySelectorAll<HTMLButtonElement>('button')[1]!.click();
    expect(element.heldPeakDbfs).toBeCloseTo(20 * Math.log10(0.05));
    element.remove();
    const reads = source.reads.mock.calls.length;
    vi.advanceTimersByTime(100);
    expect(source.reads.mock.calls.length).toBe(reads);
  });

  it('borrows player analyser only while playing and clears old readings on source changes', () => {
    const first = analyser();
    const second = analyser();
    second.setAmplitude(0.4);
    const player = Object.assign(document.createElement('div'), {playing: false, analyser: first.node});
    player.id = 'deck';
    document.body.append(player);
    const element = document.createElement('audio-level-analyzer') as AudioLevelAnalyzerElement;
    element.setAttribute('player', '#deck');
    document.body.append(element);
    vi.advanceTimersByTime(100);
    expect(first.reads).not.toHaveBeenCalled();

    player.playing = true;
    player.dispatchEvent(new CustomEvent('webaudio:statechange', {detail: {playing: true}}));
    vi.advanceTimersByTime(50);
    expect(element.sample?.peakDbfs).toBeCloseTo(20 * Math.log10(0.2));
    element.querySelector<HTMLButtonElement>('button')!.click();
    expect(element.frozen).toBe(true);
    player.analyser = second.node;
    player.dispatchEvent(new CustomEvent('webaudio:sourcechange'));
    expect(element.sample).toBeUndefined();
    expect(element.frozen).toBe(false);
    vi.advanceTimersByTime(50);
    expect(element.sample?.peakDbfs).toBeCloseTo(20 * Math.log10(0.4));
    player.dispatchEvent(new CustomEvent('webaudio:timeupdate', {detail: {seconds: 0}}));
    player.dispatchEvent(new CustomEvent('webaudio:timeupdate', {detail: {seconds: 8}}));
    expect(element.sample).toBeUndefined();
    vi.advanceTimersByTime(50);
    expect(element.sample).toBeDefined();
    player.playing = false;
    player.dispatchEvent(new CustomEvent('webaudio:statechange', {detail: {playing: false}}));
    const readCount = second.reads.mock.calls.length;
    vi.advanceTimersByTime(100);
    expect(second.reads.mock.calls.length).toBe(readCount);
    expect(element.sample).toBeUndefined();
    expect(element.textContent).toContain('Paused');
  });
});
