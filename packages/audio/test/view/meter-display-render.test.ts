// @vitest-environment jsdom
import {afterEach, describe, expect, it, vi} from 'vitest';
import {LiveScrollBuffer} from '../../src/view/headless/live';
import type {
  AudioMeterDisplaySnapshot,
  AudioMeterLoudnessSnapshot,
  AudioMeterSpectrogramSnapshot,
  AudioMeterSpectrumSnapshot,
  AudioMeterStereometerSnapshot,
  AudioMeterVuSnapshot,
} from '../../src/view/headless/meter-display';
import {
  createAudioMeterPainter,
  defaultAudioMeterPalette,
  meterHueColor,
  meterRampColor,
  paintAudioMeterDisplay,
  parseCssColor,
  type AudioMeterPalette,
} from '../../src/view/render/meter-display';

interface Call {
  name: string;
  args: unknown[];
}

interface FakeContext extends CanvasRenderingContext2D {
  calls: Call[];
}

/** A 2D context that records every call and property write. */
function fakeContext(canvas?: unknown, extra: Record<string, unknown> = {}): FakeContext {
  const calls: Call[] = [];
  const state: Record<string, unknown> = {canvas, ...extra};
  return new Proxy(state, {
    get(target, key) {
      if (key === 'calls') return calls;
      if (key === 'then') return undefined;
      if (key in target) return target[key as string];
      return (...args: unknown[]) => {
        calls.push({name: String(key), args});
        return undefined;
      };
    },
    set(target, key, value) {
      target[key as string] = value;
      calls.push({name: `set:${String(key)}`, args: [value]});
      return true;
    },
  }) as unknown as FakeContext;
}

function styles(context: FakeContext): string[] {
  return context.calls
    .filter((call) => call.name === 'set:fillStyle' || call.name === 'set:strokeStyle')
    .map((call) => String(call.args[0]));
}

function names(context: FakeContext): string[] {
  return context.calls.map((call) => call.name);
}

const mono = defaultAudioMeterPalette('mono');
const color = defaultAudioMeterPalette('color');
const ink = 'rgb(17,17,17)';

function vu(overrides: Partial<AudioMeterVuSnapshot> = {}): AudioMeterVuSnapshot {
  return {
    type: 'vu', time: 0, silent: false, vu: -3, deflection: 0.5, hold: 0.6,
    referenceDbfs: -18, peakDbfs: -8, peakLit: false, clipLit: false, ...overrides,
  };
}

function loudness(overrides: Partial<AudioMeterLoudnessSnapshot> = {}): AudioMeterLoudnessSnapshot {
  return {
    type: 'loudness', time: 0, silent: false, mode: 'momentary', value: -19.9, unit: 'LUFS',
    peakDbfs: -6, peakHoldDbfs: -3, stereo: true, ...overrides,
  };
}

function history(rows: number, columns: number, fill: (row: number, column: number) => number): LiveScrollBuffer {
  const buffer = new LiveScrollBuffer({rows, windowSeconds: 1, columnsPerSecond: columns});
  for (let column = 0; column < columns; column += 1) {
    buffer.push(column / columns, Float32Array.from({length: rows}, (_, row) => fill(row, column)));
  }
  return buffer;
}

function spectrum(overrides: Partial<AudioMeterSpectrumSnapshot> = {}): AudioMeterSpectrumSnapshot {
  return {
    type: 'spectrum', time: 0, silent: false,
    bins: Float32Array.from({length: 64}, (_, bin) => (bin === 8 ? 1 : bin % 5 === 0 ? 0.3 : 0.05)),
    sampleRate: 48_000, minDecibels: -100, maxDecibels: -30, scale: 'log', minHz: 20, maxHz: 20_000,
    bars: 0, peak: {hz: 3_000, value: 1, decibels: -30, note: 'F♯7', cents: 12}, ...overrides,
  };
}

function spectrogram(overrides: Partial<AudioMeterSpectrogramSnapshot> = {}): AudioMeterSpectrogramSnapshot {
  return {
    type: 'spectrogram', time: 0, silent: false, scale: 'log', minHz: 20, maxHz: 20_000,
    history: history(8, 6, (row, column) => (row === column ? 1 : 0)), ...overrides,
  };
}

function stereometer(overrides: Partial<AudioMeterStereometerSnapshot> = {}): AudioMeterStereometerSnapshot {
  const left = Float32Array.from({length: 64}, (_, index) => Math.sin(index / 4));
  return {
    type: 'stereometer', time: 0, silent: false, left, right: Float32Array.from(left, (value) => value * 0.5),
    stereo: true, correlation: 0.6, gain: 1.8, hue: 0.4, ...overrides,
  };
}

const everyType: AudioMeterDisplaySnapshot[] = [
  vu(),
  loudness(),
  {type: 'waveform', time: 0, silent: false, gain: 1, history: history(3, 10, (row, column) => (row === 0 ? -0.4 : row === 1 ? 0.6 : column / 10))},
  {type: 'oscilloscope', time: 0, silent: false, samples: Float32Array.from({length: 200}, (_, index) => Math.sin(index / 8)), timebaseMs: 4.1, triggered: true},
  spectrum(),
  spectrogram(),
  stereometer(),
];

afterEach(() => {
  vi.restoreAllMocks();
});

describe('palette helpers', () => {
  it('parses the computed colour syntaxes a browser returns and rejects unresolved tokens', () => {
    expect(parseCssColor('rgb(17, 17, 17)')).toEqual({rgb: [17, 17, 17], alpha: 1});
    expect(parseCssColor('rgba(0, 0, 0, 0)')).toEqual({rgb: [0, 0, 0], alpha: 0});
    expect(parseCssColor('rgb(10 20 30 / 0.5)')).toEqual({rgb: [10, 20, 30], alpha: 0.5});
    expect(parseCssColor('#fff')).toEqual({rgb: [255, 255, 255], alpha: 1});
    expect(parseCssColor('#11223380')).toEqual({rgb: [17, 34, 51], alpha: 128 / 255});
    expect(parseCssColor('var(--wm-foreground)')).toBeUndefined();
    expect(parseCssColor('')).toBeUndefined();
    expect(parseCssColor('transparent')).toBeUndefined();
  });

  it('ramps intensity between surface and ink in mono and through magma in color', () => {
    expect(meterRampColor(mono, 0)).toEqual(mono.background);
    expect(meterRampColor(mono, 1)).toEqual(mono.ink);
    expect(meterRampColor(mono, 0.5)).toEqual([136, 136, 136]);
    expect(meterRampColor(color, 0)).toEqual(color.background);
    expect(meterRampColor(color, 1)).toEqual([252, 253, 191]);
    expect(meterHueColor(mono, 0.3)).toBe(ink);
    expect(meterHueColor(color, 0)).toBe('hsl(0 80% 52%)');
    expect(meterHueColor(color, 1)).toBe('hsl(270 80% 52%)');
    expect(defaultAudioMeterPalette('bogus' as never).theme).toBe('mono');
  });
});

describe('meter painters', () => {
  it('paints every type in both themes without throwing and stays grey in mono', () => {
    for (const snapshot of everyType) {
      for (const palette of [mono, color]) {
        const context = fakeContext();
        expect(() => paintAudioMeterDisplay({context, width: 320, height: 120}, snapshot, palette)).not.toThrow();
        expect(names(context).length).toBeGreaterThan(0);
        if (palette === mono) expect(styles(context).some((style) => style.startsWith('hsl('))).toBe(false);
      }
      const empty = fakeContext();
      paintAudioMeterDisplay({context: empty, width: 0, height: 0}, snapshot, mono);
      expect(names(empty)).toEqual([]);
    }
  });

  it('encodes frequency as hue only in the color theme', () => {
    for (const snapshot of [everyType[2]!, spectrum({bars: 8}), stereometer()]) {
      const context = fakeContext();
      paintAudioMeterDisplay({context, width: 320, height: 120}, snapshot, color);
      expect(styles(context).some((style) => style.startsWith('hsl('))).toBe(true);
    }
  });

  it('lights VU lamps with the theme colour and marks the over-zone', () => {
    const off = fakeContext();
    paintAudioMeterDisplay({context: off, width: 320, height: 120}, vu(), mono);
    expect(names(off)).toContain('strokeRect');
    expect(names(off).filter((name) => name === 'fillRect')).toHaveLength(0);

    const lit = fakeContext();
    paintAudioMeterDisplay({context: lit, width: 320, height: 120}, vu({peakLit: true, clipLit: true, vu: 1}), color);
    const fills = lit.calls.filter((call) => call.name === 'fillRect');
    expect(fills).toHaveLength(2);
    expect(styles(lit)).toContain('rgb(222,160,40)');
    expect(styles(lit)).toContain('rgb(224,68,91)');
    const needle = lit.calls.findIndex((call) => call.name === 'moveTo' && call.args[0] === 160);
    expect(needle).toBeGreaterThan(0);
  });

  it('writes the loudness readout and its mode, and marks a missing value', () => {
    const context = fakeContext();
    paintAudioMeterDisplay({context, width: 320, height: 120}, loudness(), mono);
    const texts = context.calls.filter((call) => call.name === 'fillText').map((call) => String(call.args[0]));
    expect(texts).toContain('-19.9 LUFS');
    expect(texts).toContain('M · 400 ms');
    const silent = fakeContext();
    paintAudioMeterDisplay({context: silent, width: 320, height: 120}, loudness({value: -Infinity, unit: 'dB', mode: 'rms-fast', stereo: false, peakDbfs: -Infinity, peakHoldDbfs: -Infinity}), color);
    const silentTexts = silent.calls.filter((call) => call.name === 'fillText').map((call) => String(call.args[0]));
    expect(silentTexts).toContain('— dB');
    expect(silentTexts).toContain('RMS · 300 ms · mono');
    expect(silent.calls.filter((call) => call.name === 'fillRect')).toHaveLength(0);
  });

  it('draws spectrum bars, the continuous curve and the named peak', () => {
    const curve = fakeContext();
    paintAudioMeterDisplay({context: curve, width: 100, height: 60}, spectrum(), mono);
    expect(names(curve)).toContain('fill');
    const texts = curve.calls.filter((call) => call.name === 'fillText').map((call) => String(call.args[0]));
    expect(texts.some((text) => text.includes('3000.0 Hz') && text.includes('F♯7 +12¢'))).toBe(true);
    expect(texts).toContain('100');
    expect(texts).toContain('1.0k');
    expect(texts).toContain('10k');

    const bars = fakeContext();
    paintAudioMeterDisplay({context: bars, width: 100, height: 60}, spectrum({bars: 8, peak: undefined}), mono);
    expect(bars.calls.filter((call) => call.name === 'fillRect').length).toBeGreaterThan(0);
    expect(bars.calls.filter((call) => call.name === 'fill')).toHaveLength(0);
  });

  it('paints spectrogram cells individually without an image path and as one image with it', () => {
    const cells = fakeContext();
    paintAudioMeterDisplay({context: cells, width: 60, height: 40}, spectrogram(), mono);
    expect(cells.calls.filter((call) => call.name === 'fillRect')).toHaveLength(6);
    expect(names(cells)).not.toContain('drawImage');

    // The history ring holds 6 columns of 8 rows, so the image is 6 x 8 cells.
    const image = {data: new Uint8ClampedArray(6 * 8 * 4), width: 6, height: 8};
    const offscreen = fakeContext(undefined, {createImageData: vi.fn(() => image), putImageData: vi.fn()});
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(offscreen as unknown as CanvasRenderingContext2D);
    const canvas = document.createElement('canvas');
    const painter = createAudioMeterPainter();
    const context = fakeContext(canvas);
    painter.paint({context, width: 60, height: 40}, spectrogram(), color);
    expect(names(context)).toContain('drawImage');
    expect(context.calls.filter((call) => call.name === 'fillRect')).toHaveLength(0);
    expect((offscreen as unknown as {putImageData: ReturnType<typeof vi.fn>}).putImageData).toHaveBeenCalledOnce();
    expect((offscreen as unknown as {createImageData: ReturnType<typeof vi.fn>}).createImageData).toHaveBeenCalledWith(6, 8);
    // Newest column at the right edge, lowest row at the bottom: the diagonal
    // cell of the last column sits at row 5, every other cell is background.
    const cell = (column: number, row: number): number[] => {
      const pixel = ((8 - 1 - row) * 6 + column) * 4;
      return [image.data[pixel]!, image.data[pixel + 1]!, image.data[pixel + 2]!];
    };
    expect(cell(5, 5)).not.toEqual(color.background);
    expect(cell(0, 5)).toEqual(color.background);
    expect(cell(0, 0)).not.toEqual(color.background);
    expect(cell(5, 0)).toEqual(color.background);
    // A second frame reuses the same image rather than allocating another.
    painter.paint({context, width: 60, height: 40}, spectrogram(), color);
    expect((offscreen as unknown as {createImageData: ReturnType<typeof vi.fn>}).createImageData).toHaveBeenCalledOnce();
  });

  it('draws goniometer points inside the diamond and a signed correlation bar', () => {
    const context = fakeContext();
    paintAudioMeterDisplay({context, width: 200, height: 100}, stereometer(), mono);
    const dots = context.calls.filter((call) => call.name === 'fillRect' && call.args[2] === 2 && call.args[3] === 2);
    expect(dots.length).toBeGreaterThan(10);
    for (const dot of dots) {
      expect(dot.args[0] as number).toBeGreaterThanOrEqual(0);
      expect(dot.args[0] as number).toBeLessThanOrEqual(200 - 34);
    }
    const anti = fakeContext();
    paintAudioMeterDisplay({context: anti, width: 200, height: 100}, stereometer({correlation: -0.8, silent: true}), color);
    expect(styles(anti)).toContain('rgb(224,68,91)');
    expect(anti.calls.filter((call) => call.name === 'fillRect' && call.args[2] === 2)).toHaveLength(0);
  });
});

describe('waveform gain', () => {
  it('scales stored columns by the snapshot gain and clamps them to the lane', () => {
    const base = {type: 'waveform' as const, time: 0, silent: false, history: history(3, 1, (row) => (row === 0 ? -0.25 : row === 1 ? 0.25 : 0))};
    const unity = fakeContext();
    paintAudioMeterDisplay({context: unity, width: 100, height: 102}, {...base, gain: 1}, mono);
    const plain = unity.calls.find((call) => call.name === 'fillRect')!;
    expect(plain.args[3]).toBeCloseTo(25, 5);
    const doubled = fakeContext();
    paintAudioMeterDisplay({context: doubled, width: 100, height: 102}, {...base, gain: 2}, mono);
    expect(doubled.calls.find((call) => call.name === 'fillRect')!.args[3]).toBeCloseTo(50, 5);
    const clamped = fakeContext();
    paintAudioMeterDisplay({context: clamped, width: 100, height: 102}, {...base, gain: 10}, mono);
    expect(clamped.calls.find((call) => call.name === 'fillRect')!.args[3]).toBeCloseTo(100, 5);
  });
});

describe('compact VU dial', () => {
  it('keeps every tick but labels only the non-colliding marks below 110px', () => {
    const labelsAt = (height: number): string[] => {
      const context = fakeContext();
      paintAudioMeterDisplay({context, width: 320, height}, vu(), mono);
      return context.calls
        .filter((call) => call.name === 'fillText')
        .map((call) => String(call.args[0]))
        .filter((text) => /^\d+$/.test(text));
    };
    const full = labelsAt(144);
    const compact = labelsAt(72);
    // Twelve dial marks plus six percentage marks, then seven plus six.
    expect(full).toHaveLength(18);
    expect(compact).toHaveLength(13);
    expect(compact).toContain('20');
    expect(compact).toContain('3');
    expect(compact.filter((text) => text === '4')).toHaveLength(0);
    const ticks = (height: number): number => {
      const context = fakeContext();
      paintAudioMeterDisplay({context, width: 320, height}, vu(), mono);
      return context.calls.filter((call) => call.name === 'moveTo').length;
    };
    expect(ticks(72)).toBe(ticks(144));
  });
});

describe('label scaling', () => {
  it('scales label fonts with the frame height within a legible band', () => {
    const fontsAt = (height: number): number[] => {
      const context = fakeContext();
      paintAudioMeterDisplay({context, width: 320, height}, loudness(), mono);
      return context.calls
        .filter((call) => call.name === 'set:font')
        .map((call) => Number.parseInt(String(call.args[0]), 10));
    };
    const small = fontsAt(72);
    const medium = fontsAt(144);
    const large = fontsAt(216);
    expect(medium).toContain(11);
    expect(Math.max(...small)).toBeLessThan(Math.max(...medium));
    expect(Math.max(...large)).toBeGreaterThan(Math.max(...medium));
    expect(Math.min(...small)).toBeGreaterThanOrEqual(7);
    expect(Math.max(...fontsAt(1_000))).toBe(Math.max(...large));
  });
});

describe('painter palette contract', () => {
  it('uses the supplied ink for mono data rather than a built-in colour', () => {
    const custom: AudioMeterPalette = {...mono, ink: [1, 2, 3], background: [250, 250, 250]};
    const context = fakeContext();
    paintAudioMeterDisplay({context, width: 320, height: 120}, everyType[3]!, custom);
    expect(styles(context)).toContain('rgb(1,2,3)');
    expect(styles(context)).not.toContain(ink);
  });
});
