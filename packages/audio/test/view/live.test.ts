import {describe, expect, it} from 'vitest';
import {
  LiveScrollBuffer,
  LiveViewController,
  frequencyColumn,
  timeDomainColumn,
} from '../../src/view/headless/live';

describe('LiveScrollBuffer', () => {
  it('sizes its ring from the window and column rate, and never grows', () => {
    const buffer = new LiveScrollBuffer({rows: 2, windowSeconds: 2, columnsPerSecond: 10});
    expect(buffer.capacity).toBe(20);

    for (let index = 0; index < 100; index += 1) buffer.push(index / 10, [0, index / 100]);

    // A live view runs for as long as the page is open, so the history is
    // bounded by construction rather than by anyone remembering to trim it.
    expect(buffer.length).toBe(20);
    expect(buffer.capacity).toBe(20);
  });

  it('keeps the newest columns and drops the oldest', () => {
    const buffer = new LiveScrollBuffer({rows: 1, windowSeconds: 1, columnsPerSecond: 4});
    for (let index = 0; index < 10; index += 1) buffer.push(index, [index]);

    expect(buffer.length).toBe(4);
    expect(buffer.at(0)?.values[0]).toBe(6);
    expect(buffer.at(3)?.values[0]).toBe(9);
    expect(buffer.latestSeconds).toBe(9);
  });

  it('copies the pushed values so a reused scratch frame cannot rewrite history', () => {
    const buffer = new LiveScrollBuffer({rows: 2, windowSeconds: 1, columnsPerSecond: 4});
    const scratch = new Float32Array([0.5, 0.9]);
    buffer.push(0, scratch);
    scratch[0] = -1;
    scratch[1] = -1;
    buffer.push(0.25, scratch);

    // Float32 storage, so compare with tolerance rather than exactly.
    expect(buffer.at(0)!.values[0]).toBeCloseTo(0.5, 6);
    expect(buffer.at(0)!.values[1]).toBeCloseTo(0.9, 6);
    expect(Array.from(buffer.at(1)!.values)).toEqual([-1, -1]);
  });

  it('pads a short frame and truncates a long one', () => {
    const buffer = new LiveScrollBuffer({rows: 3, windowSeconds: 1, columnsPerSecond: 4});
    buffer.push(0, [1]);
    buffer.push(0.25, [1, 2, 3, 4, 5]);

    expect(Array.from(buffer.at(0)!.values)).toEqual([1, 0, 0]);
    expect(Array.from(buffer.at(1)!.values)).toEqual([1, 2, 3]);
  });

  it('walks oldest first without allocating a column array per entry', () => {
    const buffer = new LiveScrollBuffer({rows: 1, windowSeconds: 1, columnsPerSecond: 4});
    buffer.push(0, [1]);
    buffer.push(0.5, [2]);

    const seen: number[] = [];
    buffer.forEach((column, index) => seen.push(column.values[0]! + index * 10));
    expect(seen).toEqual([1, 12]);
  });

  it('clears when the source changes', () => {
    const buffer = new LiveScrollBuffer({rows: 1, windowSeconds: 1, columnsPerSecond: 4});
    buffer.push(0, [1]);
    buffer.clear();

    expect(buffer.length).toBe(0);
    expect(buffer.latestSeconds).toBe(0);
    expect(buffer.at(0)).toBeUndefined();
  });
});

describe('frame reducers', () => {
  it('centres a time-domain frame at 128 and returns its min/max band', () => {
    const [min, max] = timeDomainColumn(new Uint8Array([128, 255, 0, 128]));
    expect(max).toBeCloseTo(0.9921875, 5);
    expect(min).toBeCloseTo(-1, 5);
  });

  it('reports a silent time-domain frame as a flat line', () => {
    expect(timeDomainColumn(new Uint8Array([128, 128, 128]))).toEqual([0, 0]);
  });

  it('normalizes a frequency frame to 0..1 and pads the rest', () => {
    const out = new Float32Array(4);
    frequencyColumn(new Uint8Array([0, 255]), out);
    expect(Array.from(out)).toEqual([0, 1, 0, 0]);
  });
});

describe('LiveViewController', () => {
  it('owns analyser sampling and resets its history when the projection changes', () => {
    const analyser = {
      fftSize: 4,
      frequencyBinCount: 2,
      getByteTimeDomainData: (frame: Uint8Array) => frame.set([0, 128, 255, 128]),
      getByteFrequencyData: (frame: Uint8Array) => frame.set([0, 255]),
    } as unknown as AnalyserNode;
    const controller = new LiveViewController({analyser, columnsPerSecond: 4});

    const waveform = controller.capture(1_000)!;
    expect(waveform.rows).toBe(2);
    expect(waveform.length).toBe(1);

    controller.setType('spectrogram');
    expect(controller.buffer).toBeUndefined();
    const spectrum = controller.capture(2_000)!;
    expect(spectrum.rows).toBe(2);
    expect(Array.from(spectrum.at(0)!.values)).toEqual([0, 1]);
  });

  it('borrows rather than mutating or disposing the analyser', () => {
    const analyser = {
      fftSize: 2,
      frequencyBinCount: 1,
      getByteTimeDomainData: (frame: Uint8Array) => frame.fill(128),
    } as unknown as AnalyserNode;
    const controller = new LiveViewController({analyser});

    controller.capture(0);
    controller.clear();
    expect(controller.analyser).toBe(analyser);
  });
});
