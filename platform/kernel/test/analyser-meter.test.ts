import {describe, expect, it} from 'vitest';
import {AnalyserMeter, aggregateSpectrumBars, createAnalyserMeter} from '../src/meter';

/** Fake analyser serving fixed byte frames, recording graph wiring. */
function fakeContext(options: {time?: number[]; frequency?: number[]} = {}) {
  const disconnects: string[] = [];
  const connections: Array<[string, string]> = [];
  const gain = (label: string) => ({
    label,
    connect(target: {label: string}) {
      connections.push([label, target.label]);
      return target;
    },
    disconnect() {
      disconnects.push(label);
    },
  });
  const analyser = {
    label: 'analyser',
    fftSize: 0,
    smoothingTimeConstant: 0,
    get frequencyBinCount() {
      return options.frequency?.length ?? 8;
    },
    connect(target: {label: string}) {
      connections.push(['analyser', target.label]);
      return target;
    },
    disconnect() {
      disconnects.push('analyser');
    },
    getByteTimeDomainData(target: Uint8Array) {
      const frame = options.time ?? [];
      for (let index = 0; index < target.length; index += 1) target[index] = frame[index] ?? 128;
    },
    getByteFrequencyData(target: Uint8Array) {
      const frame = options.frequency ?? [];
      for (let index = 0; index < target.length; index += 1) target[index] = frame[index] ?? 0;
    },
  };
  let gains = 0;
  const context = {
    createGain: () => gain(gains++ === 0 ? 'input' : 'output'),
    createAnalyser: () => analyser,
  } as unknown as BaseAudioContext;
  return {context, analyser, connections, disconnects};
}

describe('AnalyserMeter', () => {
  it('builds a transparent tap and releases only what it owns', () => {
    const {context, connections, disconnects} = fakeContext();
    const meter = createAnalyserMeter({context, fftSize: 64, smoothingTimeConstant: 0.5});

    expect(connections).toEqual([
      ['input', 'analyser'],
      ['analyser', 'output'],
    ]);
    expect(meter.ownsGraph).toBe(true);
    expect(meter.analyser?.fftSize).toBe(64);
    expect(meter.analyser?.smoothingTimeConstant).toBe(0.5);

    meter.dispose();
    expect(disconnects).toEqual(['input', 'analyser', 'output']);
    meter.dispose(); // idempotent
    expect(disconnects).toHaveLength(3);
  });

  it('never disconnects a borrowed analyser', () => {
    const {analyser, disconnects} = fakeContext();
    const meter = new AnalyserMeter({analyser: analyser as unknown as AnalyserNode});

    expect(meter.ownsGraph).toBe(false);
    expect(meter.input).toBeUndefined();
    meter.dispose();
    expect(disconnects).toEqual([]);
  });

  it('rejects owning and borrowing at once', () => {
    const {context, analyser} = fakeContext();
    expect(
      () => new AnalyserMeter({context, analyser: analyser as unknown as AnalyserNode}),
    ).toThrow(TypeError);
  });

  it('scales the level and decays the peak hold on every read', () => {
    // Half-scale square wave: |sample| = 0.5 for every byte, so rms = 0.5.
    const {context} = fakeContext({time: Array.from({length: 8}, (_, i) => (i % 2 ? 192 : 64))});
    const meter = createAnalyserMeter({context, fftSize: 8, levelScale: 1, peakDecay: 0.1});

    const first = meter.readLevel();
    expect(first.rms).toBeCloseTo(0.5, 9);
    expect(first.level).toBeCloseTo(0.5, 9);
    expect(first.peak).toBeCloseTo(0.5, 9);
    expect(first.peakHold).toBeCloseTo(0.5, 9);

    // Silence: the hold decays by peakDecay per read rather than snapping down.
    const {context: quietContext} = fakeContext({time: [128, 128, 128, 128, 128, 128, 128, 128]});
    const quiet = createAnalyserMeter({context: quietContext, fftSize: 8, peakDecay: 0.1});
    quiet.readLevel();
    expect(quiet.readLevel().peakHold).toBe(0);
  });

  it('clamps the scaled level and peak to 1', () => {
    const {context} = fakeContext({time: [255, 1, 255, 1]});
    const meter = createAnalyserMeter({context, fftSize: 4, levelScale: 1.8});
    const frame = meter.readLevel();
    expect(frame.level).toBe(1);
    expect(frame.peak).toBe(1);
    expect(frame.rms).toBeGreaterThan(0.9); // unscaled, so not clamped
  });

  it('throws a clear error once disposed or when there is nothing to read', () => {
    const empty = new AnalyserMeter();
    expect(() => empty.readLevel()).toThrow('has no analyser');

    const {context} = fakeContext();
    const meter = createAnalyserMeter({context});
    meter.dispose();
    expect(() => meter.readSpectrum()).toThrow('has been disposed');
  });

  it('honours the family bar floor when reading a spectrum', () => {
    const frequency = Array.from({length: 16}, () => 255);
    const {context} = fakeContext({frequency});

    // Audio's floor is the default of 1; score asks for four.
    expect(createAnalyserMeter({context}).readSpectrum(2)).toHaveLength(2);
    expect(createAnalyserMeter({context, minimumBars: 4}).readSpectrum(2)).toHaveLength(4);
  });

  it('uses the default bar floor for non-finite minimumBars', () => {
    for (const minimumBars of [Number.NaN, Infinity, -Infinity]) {
      const {context} = fakeContext({frequency: [255, 255]});
      const meter = createAnalyserMeter({context, minimumBars});
      expect([...meter.readSpectrum(2)]).toEqual([1, 1]);
      meter.dispose();
    }
  });

  it('retains a measured level and decays it on subsequent quiet frames', () => {
    const time = [192, 192, 192, 192];
    const {context} = fakeContext({time});
    const meter = createAnalyserMeter({context, fftSize: 4, levelScale: 1, peakDecay: 0.1});
    expect(meter.readLevel().peakHold).toBe(0.5);
    time.fill(128);
    expect(meter.readLevel().peakHold).toBeCloseTo(0.4);
    expect(meter.readLevel().peakHold).toBeCloseTo(0.3);
    for (let frame = 0; frame < 5; frame += 1) meter.readLevel();
    expect(meter.readLevel().peakHold).toBe(0);
    meter.dispose();
  });

  it('does not configure, connect or disconnect a borrowed analyser', () => {
    const {analyser, connections, disconnects} = fakeContext({frequency: [255, 0]});
    analyser.fftSize = 64;
    analyser.smoothingTimeConstant = 0.25;
    const meter = createAnalyserMeter({
      analyser: analyser as unknown as AnalyserNode,
      fftSize: 128,
      smoothingTimeConstant: 0.75,
    });
    expect([...meter.readSpectrum(2)]).toEqual([1, 0]);
    expect(analyser.fftSize).toBe(64);
    expect(analyser.smoothingTimeConstant).toBe(0.25);
    expect(connections).toEqual([]);
    meter.dispose();
    expect(disconnects).toEqual([]);
  });

  it('rolls back every created node when graph wiring fails', () => {
    const {context, analyser, disconnects} = fakeContext();
    const failure = new Error('graph connection failed');
    analyser.connect = () => { throw failure; };
    expect(() => createAnalyserMeter({context})).toThrow(failure);
    expect(disconnects).toEqual(['input', 'analyser', 'output']);
  });

  it('finishes disposal and preserves the first failure, including nullish throws', () => {
    for (const failure of [new Error('disconnect failed'), null, undefined]) {
      const {context, analyser, disconnects} = fakeContext();
      const createGain = context.createGain.bind(context);
      let gainIndex = 0;
      context.createGain = () => {
        const node = createGain();
        const disconnect = node.disconnect.bind(node);
        const index = gainIndex++;
        node.disconnect = () => {
          disconnect();
          if (index === 0) throw failure;
        };
        return node;
      };
      analyser.disconnect = () => {
        disconnects.push('analyser');
        throw new Error('later disconnect failed');
      };
      const meter = createAnalyserMeter({context});
      const errors: unknown[] = [];
      try { meter.dispose(); } catch (error) { errors.push(error); }
      expect(errors).toEqual([failure]);
      expect(disconnects).toEqual(['input', 'analyser', 'output']);
      expect(meter.analyser).toBeUndefined();
      expect(meter.input).toBeUndefined();
      expect(meter.output).toBeUndefined();
      expect(meter.ownsGraph).toBe(false);
      expect(() => meter.readLevel()).toThrow('has been disposed');
      expect(() => meter.dispose()).not.toThrow();
      expect(disconnects).toHaveLength(3);
    }
  });
});

describe('aggregateSpectrumBars', () => {
  it('tiles the input so no bin is counted twice or dropped', () => {
    // Two bars over four bins: [0, 255] and [255, 0] both average to 0.5.
    expect([...aggregateSpectrumBars([0, 255, 255, 0], {bars: 2})]).toEqual([0.5, 0.5]);
  });

  it('normalizes byte input by default and passes raw values through when asked', () => {
    expect(aggregateSpectrumBars([255, 255], {bars: 1})[0]).toBe(1);
    expect(aggregateSpectrumBars([0.25, 0.25], {bars: 1, normalizeBytes: false})[0]).toBeCloseTo(0.25, 9);
  });

  it('returns a zeroed band for an empty spectrum', () => {
    expect([...aggregateSpectrumBars([], {bars: 3})]).toEqual([0, 0, 0]);
  });

  it('treats non-finite bins as silence and clamps the result', () => {
    expect(aggregateSpectrumBars([Number.NaN, 255], {bars: 1})[0]).toBeCloseTo(0.5, 9);
    expect(aggregateSpectrumBars([2, 2], {bars: 1, normalizeBytes: false})[0]).toBe(1);
  });

  it('uses the documented default counts for non-finite bar options', () => {
    for (const invalid of [Number.NaN, Infinity, -Infinity]) {
      expect(aggregateSpectrumBars([255], {bars: invalid})).toEqual(new Float32Array(28).fill(1));
      expect([...aggregateSpectrumBars([255], {bars: 2, minimumBars: invalid})]).toEqual([1, 1]);
    }
  });

  it('keeps finite bar requests floored and respects the positive minimum', () => {
    expect(aggregateSpectrumBars([255], {bars: 2.9})).toHaveLength(2);
    expect(aggregateSpectrumBars([255], {bars: -3, minimumBars: 0})).toHaveLength(1);
    expect(aggregateSpectrumBars([255], {bars: 2, minimumBars: 4.9})).toHaveLength(4);
  });

  it('repeats bins when the requested display has more bars than FFT bins', () => {
    expect([...aggregateSpectrumBars([0, 255], {bars: 5})]).toEqual([0, 0, 0, 1, 1]);
  });
});
