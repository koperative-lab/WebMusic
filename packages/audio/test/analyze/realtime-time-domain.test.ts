import {afterEach, describe, expect, it, vi} from 'vitest';
import {createRealtimeAnalyzer, type RealtimeFrame} from '../../src/analyze/headless/realtime';

afterEach(() => {
  vi.useRealTimers();
});

function analyser() {
  let value = 0.25;
  const node = {
    fftSize: 8,
    frequencyBinCount: 4,
    context: {sampleRate: 8_000},
    getFloatTimeDomainData: vi.fn((target: Float32Array) => target.fill(value)),
    getByteFrequencyData: vi.fn((target: Uint8Array) => target.fill(128)),
  } as unknown as AnalyserNode;
  return {node, setValue(next: number) { value = next; }};
}

describe('createRealtimeAnalyzer time-domain frames', () => {
  it('copies opt-in sample windows without modifying the borrowed analyser', () => {
    vi.useFakeTimers();
    const source = analyser();
    const frames: RealtimeFrame[] = [];
    const runner = createRealtimeAnalyzer(source.node, {intervalMs: 50, includeTimeDomain: true});
    runner.start((frame) => frames.push(frame));
    vi.advanceTimersByTime(50);
    const first = frames[0]!.timeDomainData;
    expect(first).toEqual(new Float32Array(8).fill(0.25));
    source.setValue(-0.5);
    vi.advanceTimersByTime(50);
    expect(frames[1]!.timeDomainData).toEqual(new Float32Array(8).fill(-0.5));
    expect(first).toEqual(new Float32Array(8).fill(0.25));
    expect(frames[0]!.timeDomainData).not.toBe(frames[1]!.timeDomainData);
    expect(source.node.fftSize).toBe(8);
    runner.stop();
    vi.advanceTimersByTime(100);
    expect(frames).toHaveLength(2);
  });

  it('does not expose the reusable time buffer by default', () => {
    vi.useFakeTimers();
    const source = analyser();
    const frames: RealtimeFrame[] = [];
    const runner = createRealtimeAnalyzer(source.node, {intervalMs: 50});
    runner.start((frame) => frames.push(frame));
    vi.advanceTimersByTime(50);
    expect(frames[0]!.timeDomainData).toBeUndefined();
    runner.stop();
  });
});
