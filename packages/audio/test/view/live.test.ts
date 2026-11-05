import {describe, expect, it, vi} from 'vitest';
import {paintLiveProjection} from '../../src/view/render/live';
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

describe('paintLiveProjection spectrogram history', () => {
  function harness() {
    const puts: number[] = [];
    const draws: number[][] = [];
    const ringContext = {
      createImageData: (width: number, height: number) => ({width, height, data: new Uint8ClampedArray(width * height * 4)}),
      putImageData: (_image: unknown, dx: number) => { puts.push(dx); },
      clearRect: vi.fn(),
    };
    const ring = {width: 0, height: 0, getContext: () => ringContext};
    const context = {
      canvas: {ownerDocument: {createElement: vi.fn(() => ring)}},
      clearRect: vi.fn(),
      fillRect: vi.fn(),
      drawImage: (_source: unknown, ...args: number[]) => { draws.push(args); },
      imageSmoothingEnabled: true,
      fillStyle: '',
    } as unknown as CanvasRenderingContext2D;
    return {context, puts, draws, ring, createElement: (context.canvas as unknown as {ownerDocument: {createElement: ReturnType<typeof vi.fn>}}).ownerDocument.createElement};
  }

  it('writes only the new column each frame and composites the ring', () => {
    const {context, puts, draws, createElement} = harness();
    const buffer = new LiveScrollBuffer({rows: 4, windowSeconds: 1, columnsPerSecond: 4});
    const frame = {context, width: 40, height: 20};
    buffer.push(0, [1, 0.5, 0, 0.25]);
    buffer.push(0.25, [1, 1, 1, 1]);
    paintLiveProjection(frame, buffer, 'spectrogram');
    expect(puts).toEqual([0, 1]);
    expect(createElement).toHaveBeenCalledOnce();
    expect(context.fillRect).not.toHaveBeenCalled();
    expect(draws.at(-1)).toEqual([0, 0, 2, 4, 20, 0, 20, 20]);

    // Unchanged history paints no column; one push writes exactly one.
    puts.length = 0;
    paintLiveProjection(frame, buffer, 'spectrogram');
    expect(puts).toEqual([]);
    for (let index = 2; index < 7; index += 1) {
      buffer.push(index / 4, [index / 10, 0, 0, 0]);
      paintLiveProjection(frame, buffer, 'spectrogram');
    }
    expect(puts).toEqual([2, 3, 0, 1, 2]);
    // Full ring: oldest slot 3, newest slot 2 — two segments, oldest first.
    expect(draws.at(-2)).toEqual([3, 0, 1, 4, 0, 0, 10, 20]);
    expect(draws.at(-1)).toEqual([0, 0, 3, 4, 10, 0, 30, 20]);
    expect(context.imageSmoothingEnabled).toBe(true);
    expect(createElement).toHaveBeenCalledOnce();
  });

  it('rebuilds the ring for a new buffer and falls back to cells without bitmap support', () => {
    const {context, puts} = harness();
    const first = new LiveScrollBuffer({rows: 2, windowSeconds: 1, columnsPerSecond: 4});
    first.push(0, [1, 1]);
    paintLiveProjection({context, width: 8, height: 8}, first, 'spectrogram');
    const second = new LiveScrollBuffer({rows: 2, windowSeconds: 1, columnsPerSecond: 4});
    second.push(0, [1, 1]);
    second.push(0.25, [1, 1]);
    puts.length = 0;
    paintLiveProjection({context, width: 8, height: 8}, second, 'spectrogram');
    expect(puts).toEqual([0, 1]);

    const fillRect = vi.fn();
    const plain = {clearRect: vi.fn(), fillRect, fillStyle: ''} as unknown as CanvasRenderingContext2D;
    paintLiveProjection({context: plain, width: 8, height: 8}, second, 'spectrogram');
    expect(fillRect).toHaveBeenCalledTimes(4);
  });
});
