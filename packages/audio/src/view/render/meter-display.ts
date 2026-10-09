// ============================================================================
// Painters for the seven `<audio-meter>` display types.
//
// Each painter draws one headless snapshot into a presenter-owned canvas
// frame using a resolved palette. The palette is data (RGB triples and a font
// family) rather than CSS tokens, because a canvas cannot read `var(--x)`:
// the Element resolves its tokens once and hands the colours down, which
// also keeps every painter a pure function of its inputs.
//
// Two themes share the same geometry. `mono` encodes intensity as a ramp
// between the surface and ink colours, so it follows any light or dark page
// palette without a second skin. `color` adds hue for frequency position and
// a perceptual colormap for intensity, the way hardware-style meters do.
// Square cells, square dots, square indicator lamps: nothing here is rounded.
// ============================================================================

import {magma, type RGB} from '../core/colormaps';
import {
  fractionOf,
  projectSpectrum,
  type AudioMeterDisplaySnapshot,
  type AudioMeterLoudnessSnapshot,
  type AudioMeterOscilloscopeSnapshot,
  type AudioMeterSpectrogramSnapshot,
  type AudioMeterSpectrumSnapshot,
  type AudioMeterStereometerSnapshot,
  type AudioMeterVuSnapshot,
  type AudioMeterWaveformSnapshot,
} from '../headless/meter-display';
import type {AudioCanvasFrame} from './overview';

export type AudioMeterTheme = 'mono' | 'color';

/** Resolved colours a painter draws with. Each channel is an integer in 0..255. */
export interface AudioMeterPalette {
  theme: AudioMeterTheme;
  /** Surface behind the drawing; the low end of the intensity ramp. */
  background: RGB;
  /** Primary data ink; the high end of the intensity ramp. */
  ink: RGB;
  /** Labels and secondary readouts. */
  muted: RGB;
  /** Scale lines, frames and off indicators. */
  grid: RGB;
  /** Over-reference zone, clip lamp and anti-phase correlation in `color`. */
  danger: RGB;
  /** Peak lamp in `color`. */
  warning: RGB;
  fontFamily: string;
}

/**
 * Parse a computed CSS colour (`rgb()`, `rgba()`, modern space-separated
 * syntax or a hex literal) into channels and alpha. Anything else, including
 * an unresolved `var()`, is `undefined` so the caller keeps its default.
 */
export function parseCssColor(value: string | null | undefined): {rgb: RGB; alpha: number} | undefined {
  if (!value) return undefined;
  const text = value.trim();
  const hex = /^#([0-9a-f]{3,8})$/i.exec(text);
  if (hex) {
    const digits = hex[1]!;
    const expand = digits.length === 3 || digits.length === 4;
    const channel = (index: number): number => {
      const slice = expand ? digits[index]! + digits[index]! : digits.slice(index * 2, index * 2 + 2);
      return Number.parseInt(slice, 16);
    };
    const hasAlpha = digits.length === 4 || digits.length === 8;
    return {rgb: [channel(0), channel(1), channel(2)], alpha: hasAlpha ? channel(3) / 255 : 1};
  }
  const functional = /^rgba?\(\s*([^)]+)\)$/i.exec(text);
  if (!functional) return undefined;
  const parts = functional[1]!.split(/[\s,/]+/).filter(Boolean);
  if (parts.length < 3) return undefined;
  const numbers = parts.map((part) => (part.endsWith('%') ? Number.parseFloat(part) * 2.55 : Number.parseFloat(part)));
  if (numbers.slice(0, 3).some((number) => !Number.isFinite(number))) return undefined;
  const alphaText = parts[3];
  const alpha = alphaText === undefined
    ? 1
    : alphaText.endsWith('%') ? Number.parseFloat(alphaText) / 100 : Number.parseFloat(alphaText);
  return {
    rgb: [clampChannel(numbers[0]!), clampChannel(numbers[1]!), clampChannel(numbers[2]!)],
    alpha: Number.isFinite(alpha) ? Math.max(0, Math.min(1, alpha)) : 1,
  };
}

function clampChannel(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

/** Light neutral defaults matching the UI kit's surface and ink. */
export function defaultAudioMeterPalette(theme: AudioMeterTheme = 'mono'): AudioMeterPalette {
  return {
    theme: theme === 'color' ? 'color' : 'mono',
    background: [255, 255, 255],
    ink: [17, 17, 17],
    muted: [119, 119, 119],
    grid: [216, 216, 216],
    danger: [224, 68, 91],
    warning: [222, 160, 40],
    fontFamily: 'ui-monospace, monospace',
  };
}

function clamp01(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}

function css(color: RGB, alpha = 1): string {
  return alpha >= 1
    ? `rgb(${color[0]},${color[1]},${color[2]})`
    : `rgba(${color[0]},${color[1]},${color[2]},${alpha})`;
}

function mix(from: RGB, to: RGB, t: number): RGB {
  const u = clamp01(t);
  return [
    Math.round(from[0] + (to[0] - from[0]) * u),
    Math.round(from[1] + (to[1] - from[1]) * u),
    Math.round(from[2] + (to[2] - from[2]) * u),
  ];
}

/** Intensity 0..1 to a colour: a surface-to-ink ramp in `mono`, magma faded into the surface in `color`. */
export function meterRampColor(palette: AudioMeterPalette, t: number): RGB {
  const u = clamp01(t);
  if (palette.theme !== 'color') return mix(palette.background, palette.ink, u);
  const fade = clamp01(u / 0.12);
  return mix(palette.background, magma(u), fade * fade * (3 - 2 * fade));
}

/** Frequency position 0..1 (low to high) to a hue in `color`; ink in `mono`. */
export function meterHueColor(palette: AudioMeterPalette, position: number): string {
  if (palette.theme !== 'color') return css(palette.ink);
  return `hsl(${Math.round(clamp01(position) * 270)} 80% 52%)`;
}

/**
 * Label font for a frame: `size` is the pixel size at the kit's medium surface
 * tier (144 px); smaller and larger frames scale it within 0.85..1.25 so a
 * compact meter stays legible and a large one does not shout.
 */
function font(palette: AudioMeterPalette, size: number, height = 144): string {
  const factor = Math.max(0.85, Math.min(1.25, (Number.isFinite(height) && height > 0 ? height : 144) / 144));
  return `${Math.round(size * factor)}px ${palette.fontFamily}`;
}

/** Marks on a VU scale, in VU, and the deflection each sits at. */
export const VU_SCALE_MARKS: readonly number[] = [-20, -10, -7, -5, -4, -3, -2, -1, 0, 1, 2, 3];

/** The marks that keep a label on a compact dial, where every label would collide. */
const VU_COMPACT_LABELS: ReadonlySet<number> = new Set([-20, -10, -7, -5, -3, 0, 3]);

function vuMarkDeflection(vu: number): number {
  return Math.pow(10, (vu - 3) / 20);
}

function formatHz(hz: number): string {
  return hz >= 1_000 ? `${(hz / 1_000).toFixed(hz >= 10_000 ? 0 : 1)}k` : `${Math.round(hz)}`;
}

/** Paint a needle VU dial with peak and clip lamps. */
export function paintVuMeter(frame: AudioCanvasFrame, snapshot: AudioMeterVuSnapshot, palette: AudioMeterPalette): void {
  const {context, width, height} = frame;
  if (!(width > 0) || !(height > 0)) return;
  const lampSpace = 40;
  const radius = Math.max(8, Math.min(height * 1.55, (width / 2 - lampSpace) / Math.SQRT1_2));
  const pivotX = width / 2;
  const pivotY = height * 0.92 + radius * Math.SQRT1_2 + 2;
  const angleOf = (deflection: number): number => (-0.25 + clamp01(deflection) * 0.5) * Math.PI;
  const pointAt = (deflection: number, distance: number): [number, number] => {
    const angle = angleOf(deflection);
    return [pivotX + distance * Math.sin(angle), pivotY - distance * Math.cos(angle)];
  };
  const arc = (from: number, to: number, distance: number): void => {
    context.beginPath();
    context.arc(pivotX, pivotY, distance, angleOf(from) - Math.PI / 2, angleOf(to) - Math.PI / 2);
    context.stroke();
  };
  const zero = vuMarkDeflection(0);

  // Main arc: quiet span in grid, over-zero span emphasised.
  context.lineWidth = 1;
  context.strokeStyle = css(palette.grid);
  arc(0, zero, radius);
  context.lineWidth = 2.5;
  context.strokeStyle = css(palette.theme === 'color' ? palette.danger : palette.ink);
  arc(zero, 1, radius);

  // Marks and labels. A compact dial keeps every tick but labels only the
  // marks that do not collide at its scale.
  context.font = font(palette, 9, height);
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  const compact = height < 110;
  for (const mark of VU_SCALE_MARKS) {
    const deflection = vuMarkDeflection(mark);
    const over = mark > 0;
    const [x0, y0] = pointAt(deflection, radius);
    const [x1, y1] = pointAt(deflection, radius + (mark % 10 === 0 || mark === -7 || mark === -3 ? 7 : 4));
    context.lineWidth = 1;
    context.strokeStyle = css(over && palette.theme === 'color' ? palette.danger : palette.ink);
    context.beginPath();
    context.moveTo(x0, y0);
    context.lineTo(x1, y1);
    context.stroke();
    if (compact && !VU_COMPACT_LABELS.has(mark)) continue;
    const [lx, ly] = pointAt(deflection, radius + 15);
    context.fillStyle = css(over && palette.theme === 'color' ? palette.danger : palette.muted);
    context.fillText(String(Math.abs(mark)), lx, ly);
  }

  // Percentage scale inside the arc.
  context.strokeStyle = css(palette.grid);
  context.lineWidth = 1;
  arc(0, zero, radius - 14);
  context.fillStyle = css(palette.muted);
  context.font = font(palette, 8, height);
  for (const percent of [0, 20, 40, 60, 80, 100]) {
    const deflection = (percent / 100) * zero;
    const [x0, y0] = pointAt(deflection, radius - 14);
    const [x1, y1] = pointAt(deflection, radius - 18);
    context.beginPath();
    context.moveTo(x0, y0);
    context.lineTo(x1, y1);
    context.stroke();
    const [lx, ly] = pointAt(deflection, radius - 25);
    context.fillText(String(percent), lx, ly);
  }

  // Held maximum.
  if (snapshot.hold > 0) {
    const [hx0, hy0] = pointAt(snapshot.hold, radius - 6);
    const [hx1, hy1] = pointAt(snapshot.hold, radius + 1);
    context.strokeStyle = css(palette.ink);
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(hx0, hy0);
    context.lineTo(hx1, hy1);
    context.stroke();
  }

  // Needle.
  const [nx, ny] = pointAt(snapshot.deflection, radius + 3);
  context.strokeStyle = css(palette.theme === 'color' && snapshot.vu > 0 ? palette.danger : palette.ink);
  context.lineWidth = 1.5;
  context.beginPath();
  context.moveTo(pivotX, pivotY);
  context.lineTo(nx, ny);
  context.stroke();

  // Lamps: square, outlined when off and filled when lit.
  const lamp = (x: number, lit: boolean, on: RGB, label: string): void => {
    const size = 8;
    const y = 6;
    context.lineWidth = 1;
    context.strokeStyle = css(palette.grid);
    context.fillStyle = css(on);
    if (lit) context.fillRect(x, y, size, size);
    else context.strokeRect(x + 0.5, y + 0.5, size - 1, size - 1);
    context.fillStyle = css(palette.muted);
    context.font = font(palette, 8, height);
    context.textAlign = 'center';
    context.textBaseline = 'top';
    context.fillText(label, x + size / 2, y + size + 3);
  };
  lamp(width - 30, snapshot.peakLit, palette.theme === 'color' ? palette.warning : palette.ink, 'PK');
  lamp(width - 14, snapshot.clipLit, palette.theme === 'color' ? palette.danger : palette.ink, 'CL');
}

/** Paint a sample-peak bar beside a windowed loudness bar, 0 to -50 on a vertical scale. */
export function paintLoudnessMeter(
  frame: AudioCanvasFrame,
  snapshot: AudioMeterLoudnessSnapshot,
  palette: AudioMeterPalette,
): void {
  const {context, width, height} = frame;
  if (!(width > 0) || !(height > 0)) return;
  const pad = 8;
  const top = pad;
  const bottom = height - pad;
  const span = Math.max(1, bottom - top);
  const labelWidth = 26;
  const barWidth = Math.max(6, Math.min(22, Math.round(height * 0.16)));
  const gap = 4;
  const left = labelWidth + 6;
  const yOf = (decibels: number): number => top + clamp01(-decibels / 50) * span;

  context.font = font(palette, 9, height);
  context.textAlign = 'right';
  context.textBaseline = 'middle';
  for (const mark of [0, -6, -12, -18, -24, -36, -50]) {
    const y = Math.round(yOf(mark)) + 0.5;
    context.strokeStyle = css(palette.grid);
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(left - 4, y);
    context.lineTo(left + barWidth * 2 + gap, y);
    context.stroke();
    context.fillStyle = css(palette.muted);
    context.fillText(String(Math.abs(mark)), labelWidth, y);
  }

  const bar = (x: number, decibels: number, color: string): void => {
    if (!Number.isFinite(decibels)) return;
    const y = yOf(decibels);
    context.fillStyle = color;
    context.fillRect(x, y, barWidth, Math.max(1, bottom - y));
  };
  const peakX = left;
  const valueX = left + barWidth + gap;
  bar(peakX, snapshot.peakDbfs, css(palette.muted));
  if (Number.isFinite(snapshot.peakHoldDbfs)) {
    const y = Math.round(yOf(snapshot.peakHoldDbfs));
    context.fillStyle = css(palette.ink);
    context.fillRect(peakX, y, barWidth, 2);
  }
  let valueColor = css(palette.ink);
  if (palette.theme === 'color' && Number.isFinite(snapshot.value)) {
    const heat = clamp01(1 + snapshot.value / 50);
    valueColor = `hsl(${Math.round(120 * (1 - heat))} 75% 48%)`;
  }
  bar(valueX, snapshot.value, valueColor);

  context.textAlign = 'left';
  context.textBaseline = 'middle';
  context.font = font(palette, 11, height);
  context.fillStyle = css(palette.ink);
  const readout = Number.isFinite(snapshot.value) ? `${snapshot.value.toFixed(1)} ${snapshot.unit}` : `— ${snapshot.unit}`;
  const readoutY = Number.isFinite(snapshot.value) ? Math.max(top + 6, Math.min(bottom - 6, yOf(snapshot.value))) : bottom - 6;
  context.fillText(readout, valueX + barWidth + 10, readoutY);
  context.font = font(palette, 8, height);
  context.fillStyle = css(palette.muted);
  context.textBaseline = 'top';
  const mode = {momentary: 'M · 400 ms', 'short-term': 'S · 3 s', 'rms-fast': 'RMS · 300 ms', 'rms-slow': 'RMS · 1 s'}[snapshot.mode];
  context.fillText(`${mode}${snapshot.stereo ? '' : ' · mono'}`, valueX + barWidth + 10, top);
}

/** Paint a scrolling min/max waveform history, newest column at the right. */
export function paintWaveformHistory(
  frame: AudioCanvasFrame,
  snapshot: AudioMeterWaveformSnapshot,
  palette: AudioMeterPalette,
): void {
  const {context, width, height} = frame;
  if (!(width > 0) || !(height > 0)) return;
  const middle = height / 2;
  context.strokeStyle = css(palette.grid);
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(0, Math.round(middle) + 0.5);
  context.lineTo(width, Math.round(middle) + 0.5);
  context.stroke();
  const {history} = snapshot;
  if (history.length === 0) return;
  const columnWidth = width / history.capacity;
  const originX = width - history.length * columnWidth;
  const amplitude = height / 2 - 1;
  const gain = Number.isFinite(snapshot.gain) && snapshot.gain > 0 ? snapshot.gain : 1;
  let currentColor = '';
  history.forEach((column, index) => {
    const min = clamp11((column.values[0] ?? 0) * gain);
    const max = clamp11((column.values[1] ?? 0) * gain);
    const color = meterHueColor(palette, column.values[2] ?? 0);
    if (color !== currentColor) {
      context.fillStyle = color;
      currentColor = color;
    }
    const top = middle - max * amplitude;
    const bottom = middle - min * amplitude;
    context.fillRect(originX + index * columnWidth, top, Math.max(1, columnWidth), Math.max(1, bottom - top));
  });
}

/** Paint a trigger-aligned time-domain trace. */
export function paintOscilloscopeTrace(
  frame: AudioCanvasFrame,
  snapshot: AudioMeterOscilloscopeSnapshot,
  palette: AudioMeterPalette,
): void {
  const {context, width, height} = frame;
  if (!(width > 0) || !(height > 0)) return;
  const middle = height / 2;
  context.strokeStyle = css(palette.grid);
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(0, Math.round(middle) + 0.5);
  context.lineTo(width, Math.round(middle) + 0.5);
  for (let division = 1; division < 4; division += 1) {
    const x = Math.round((width * division) / 4) + 0.5;
    context.moveTo(x, 0);
    context.lineTo(x, height);
  }
  context.stroke();
  const {samples} = snapshot;
  if (samples.length === 0) return;
  const amplitude = height / 2 - 1;
  context.strokeStyle = css(palette.ink);
  context.lineWidth = 1.5;
  context.beginPath();
  const step = Math.max(1, samples.length / Math.max(1, width * 2));
  for (let index = 0; index < samples.length; index += step) {
    const sampleIndex = Math.min(samples.length - 1, Math.floor(index));
    const x = (sampleIndex / Math.max(1, samples.length - 1)) * width;
    const y = middle - clamp11(samples[sampleIndex] ?? 0) * amplitude;
    if (index === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  }
  context.stroke();
  if (snapshot.triggered) {
    context.fillStyle = css(palette.ink);
    context.fillRect(0, Math.round(middle) - 2, 4, 4);
  }
  context.font = font(palette, 8, height);
  context.fillStyle = css(palette.muted);
  context.textAlign = 'right';
  context.textBaseline = 'bottom';
  context.fillText(`${snapshot.timebaseMs.toFixed(1)} ms`, width - 3, height - 2);
}

function clamp11(value: number): number {
  return Number.isFinite(value) ? Math.max(-1, Math.min(1, value)) : 0;
}

const FREQUENCY_GRID = [50, 100, 200, 500, 1_000, 2_000, 5_000, 10_000];

function paintFrequencyAxis(
  frame: AudioCanvasFrame,
  palette: AudioMeterPalette,
  scale: AudioMeterSpectrumSnapshot['scale'],
  minHz: number,
  maxHz: number,
  labels: boolean,
): void {
  const {context, width, height} = frame;
  context.strokeStyle = css(palette.grid);
  context.lineWidth = 1;
  context.beginPath();
  for (const hz of FREQUENCY_GRID) {
    if (hz <= minHz || hz >= maxHz) continue;
    const x = Math.round(fractionOf(hz, scale, minHz, maxHz) * width) + 0.5;
    context.moveTo(x, 0);
    context.lineTo(x, height);
  }
  context.stroke();
  if (!labels) return;
  context.font = font(palette, 8, height);
  context.fillStyle = css(palette.muted);
  context.textAlign = 'left';
  context.textBaseline = 'bottom';
  for (const hz of [100, 1_000, 10_000]) {
    if (hz <= minHz || hz >= maxHz) continue;
    const x = fractionOf(hz, scale, minHz, maxHz) * width;
    context.fillText(formatHz(hz), x + 2, height - 2);
  }
}

/** Paint the current spectrum as a filled curve or as bars, with the loudest peak named. */
export function paintSpectrumFrame(
  frame: AudioCanvasFrame,
  snapshot: AudioMeterSpectrumSnapshot,
  palette: AudioMeterPalette,
  scratch?: {columns?: Float32Array},
): void {
  const {context, width, height} = frame;
  if (!(width > 0) || !(height > 0)) return;
  const {scale, minHz, maxHz} = snapshot;
  paintFrequencyAxis(frame, palette, scale, minHz, maxHz, true);
  const top = 14;
  const plotHeight = Math.max(1, height - top);
  if (snapshot.bars > 0) {
    const columns = projectSpectrum(snapshot.bins, snapshot.sampleRate, snapshot.bars, scale, minHz, maxHz);
    const barWidth = width / snapshot.bars;
    for (let bar = 0; bar < snapshot.bars; bar += 1) {
      const value = columns[bar] ?? 0;
      if (value <= 0) continue;
      context.fillStyle = meterHueColor(palette, (bar + 0.5) / snapshot.bars);
      const barHeight = value * plotHeight;
      context.fillRect(bar * barWidth + 0.5, height - barHeight, Math.max(1, barWidth - 1), barHeight);
    }
  } else {
    const columnCount = Math.max(1, Math.round(width));
    const columns = projectSpectrum(
      snapshot.bins, snapshot.sampleRate, columnCount, scale, minHz, maxHz,
      scratch?.columns && scratch.columns.length === columnCount ? scratch.columns : undefined,
    );
    if (scratch) scratch.columns = columns;
    if (palette.theme === 'color') {
      for (let column = 0; column < columnCount; column += 1) {
        const value = columns[column] ?? 0;
        if (value <= 0) continue;
        context.fillStyle = meterHueColor(palette, (column + 0.5) / columnCount);
        const barHeight = value * plotHeight;
        context.fillRect((column * width) / columnCount, height - barHeight, width / columnCount + 0.5, barHeight);
      }
    } else {
      context.fillStyle = css(palette.ink, 0.85);
      context.beginPath();
      context.moveTo(0, height);
      for (let column = 0; column < columnCount; column += 1) {
        context.lineTo(((column + 0.5) * width) / columnCount, height - (columns[column] ?? 0) * plotHeight);
      }
      context.lineTo(width, height);
      context.closePath();
      context.fill();
    }
    context.strokeStyle = css(palette.ink);
    context.lineWidth = 1;
    context.beginPath();
    for (let column = 0; column < columnCount; column += 1) {
      const x = ((column + 0.5) * width) / columnCount;
      const y = height - (columns[column] ?? 0) * plotHeight;
      if (column === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    }
    context.stroke();
  }
  const {peak} = snapshot;
  if (peak && peak.value > 0.02) {
    const x = Math.round(fractionOf(peak.hz, scale, minHz, maxHz) * width) + 0.5;
    context.strokeStyle = css(palette.theme === 'color' ? palette.danger : palette.ink);
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(x, top);
    context.lineTo(x, height);
    context.stroke();
    context.font = font(palette, 9, height);
    context.fillStyle = css(palette.muted);
    context.textAlign = 'left';
    context.textBaseline = 'top';
    const cents = `${peak.cents >= 0 ? '+' : ''}${peak.cents}`;
    context.fillText(`${peak.decibels.toFixed(1)} dB · ${peak.hz.toFixed(1)} Hz · ${peak.note} ${cents}¢`, 3, 2);
  }
}

/** A painter that retains the spectrogram's offscreen image between frames. */
export interface AudioMeterPainter {
  paint(frame: AudioCanvasFrame, snapshot: AudioMeterDisplaySnapshot, palette: AudioMeterPalette): void;
}

interface SpectrogramImageCache {
  canvas: HTMLCanvasElement;
  context: CanvasRenderingContext2D;
  image: ImageData;
  width: number;
  height: number;
}

/**
 * Paint a scrolling spectrogram history, newest column at the right and the
 * lowest frequency at the bottom. With a cache the cells are written as one
 * image and scaled up without smoothing, so a 60 Hz repaint stays one draw
 * call; without one, each cell is a rectangle.
 */
export function paintSpectrogramHistory(
  frame: AudioCanvasFrame,
  snapshot: AudioMeterSpectrogramSnapshot,
  palette: AudioMeterPalette,
  cache?: {image?: SpectrogramImageCache},
): void {
  const {context, width, height} = frame;
  if (!(width > 0) || !(height > 0)) return;
  const {history} = snapshot;
  const columns = history.capacity;
  const rows = history.rows;
  const imageCache = cache ? ensureSpectrogramImage(cache, context, columns, rows) : undefined;
  if (imageCache) {
    const {data} = imageCache.image;
    const background = palette.background;
    for (let index = 0; index < data.length; index += 4) {
      data[index] = background[0];
      data[index + 1] = background[1];
      data[index + 2] = background[2];
      data[index + 3] = 255;
    }
    const offset = columns - history.length;
    history.forEach((column, index) => {
      const x = offset + index;
      for (let row = 0; row < rows; row += 1) {
        const value = column.values[row] ?? 0;
        if (value <= 0.002) continue;
        const [red, green, blue] = meterRampColor(palette, value);
        const pixel = ((rows - 1 - row) * columns + x) * 4;
        data[pixel] = red;
        data[pixel + 1] = green;
        data[pixel + 2] = blue;
      }
    });
    imageCache.context.putImageData(imageCache.image, 0, 0);
    context.imageSmoothingEnabled = false;
    context.drawImage(imageCache.canvas, 0, 0, columns, rows, 0, 0, width, height);
  } else {
    const columnWidth = width / columns;
    const rowHeight = height / rows;
    const originX = width - history.length * columnWidth;
    history.forEach((column, index) => {
      const x = originX + index * columnWidth;
      for (let row = 0; row < rows; row += 1) {
        const value = column.values[row] ?? 0;
        if (value <= 0.002) continue;
        context.fillStyle = css(meterRampColor(palette, value));
        context.fillRect(x, height - (row + 1) * rowHeight, Math.max(1, columnWidth), rowHeight + 0.5);
      }
    });
  }
  context.font = font(palette, 8, height);
  context.fillStyle = css(palette.muted);
  context.textAlign = 'left';
  context.textBaseline = 'middle';
  for (const hz of [100, 1_000, 10_000]) {
    if (hz <= snapshot.minHz || hz >= snapshot.maxHz) continue;
    const y = height - fractionOf(hz, snapshot.scale, snapshot.minHz, snapshot.maxHz) * height;
    context.fillText(formatHz(hz), 3, y);
  }
}

function ensureSpectrogramImage(
  cache: {image?: SpectrogramImageCache},
  target: CanvasRenderingContext2D,
  columns: number,
  rows: number,
): SpectrogramImageCache | undefined {
  const existing = cache.image;
  if (existing && existing.width === columns && existing.height === rows) return existing;
  const document = target.canvas?.ownerDocument;
  if (!document || typeof target.drawImage !== 'function') return undefined;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = columns;
    canvas.height = rows;
    const context = canvas.getContext('2d');
    if (!context || typeof context.createImageData !== 'function' || typeof context.putImageData !== 'function') {
      return undefined;
    }
    const image = context.createImageData(columns, rows);
    cache.image = {canvas, context, image, width: columns, height: rows};
    return cache.image;
  } catch {
    return undefined;
  }
}

/** Paint a goniometer point cloud inside a diamond frame with a correlation bar at the right. */
export function paintStereometer(
  frame: AudioCanvasFrame,
  snapshot: AudioMeterStereometerSnapshot,
  palette: AudioMeterPalette,
): void {
  const {context, width, height} = frame;
  if (!(width > 0) || !(height > 0)) return;
  const pad = 10;
  const barSpace = 34;
  const side = Math.max(8, Math.min(width - barSpace - pad * 2, height - pad * 2));
  const half = side / 2;
  const centerX = (width - barSpace) / 2;
  const centerY = height / 2;

  // Frame: outer diamond and centre cross.
  context.strokeStyle = css(palette.grid);
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(centerX, centerY - half);
  context.lineTo(centerX + half, centerY);
  context.lineTo(centerX, centerY + half);
  context.lineTo(centerX - half, centerY);
  context.closePath();
  context.moveTo(centerX, centerY - half);
  context.lineTo(centerX, centerY + half);
  context.moveTo(centerX - half, centerY);
  context.lineTo(centerX + half, centerY);
  context.stroke();
  context.font = font(palette, 8, height);
  context.fillStyle = css(palette.muted);
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText('L', centerX - half * 0.5 - 8, centerY - half * 0.5 - 8);
  context.fillText('R', centerX + half * 0.5 + 8, centerY - half * 0.5 - 8);

  // Points: one square per sample, left/right rotated so mono rises along the vertical axis.
  const {left, right, gain} = snapshot;
  const count = Math.min(left.length, right.length);
  if (count > 0 && !snapshot.silent) {
    const stride = Math.max(1, Math.floor(count / 1_024));
    context.fillStyle = meterHueColor(palette, snapshot.hue);
    context.globalAlpha = 0.55;
    for (let index = 0; index < count; index += stride) {
      const l = (left[index] ?? 0) * gain;
      const r = (right[index] ?? 0) * gain;
      const x = clamp11((l - r) * Math.SQRT1_2);
      const y = clamp11((l + r) * Math.SQRT1_2);
      context.fillRect(centerX + x * half - 1, centerY - y * half - 1, 2, 2);
    }
    context.globalAlpha = 1;
  }

  // Correlation bar: +1 at the top, -1 at the bottom.
  const barX = width - barSpace + 6;
  const barWidth = 8;
  const barTop = pad;
  const barBottom = height - pad;
  const barMiddle = (barTop + barBottom) / 2;
  context.strokeStyle = css(palette.grid);
  context.strokeRect(barX + 0.5, barTop + 0.5, barWidth - 1, barBottom - barTop - 1);
  const value = clamp11(snapshot.correlation);
  const valueY = barMiddle - value * (barBottom - barTop) / 2;
  context.fillStyle = css(palette.theme === 'color' && value < 0 ? palette.danger : palette.ink);
  context.fillRect(barX, Math.min(barMiddle, valueY), barWidth, Math.max(1, Math.abs(valueY - barMiddle)));
  context.fillStyle = css(palette.muted);
  context.textAlign = 'left';
  for (const [mark, label] of [[1, '+1'], [0, '0'], [-1, '-1']] as const) {
    const y = barMiddle - mark * (barBottom - barTop) / 2;
    context.fillText(label, barX + barWidth + 3, Math.max(barTop + 4, Math.min(barBottom - 4, y)));
  }
}

/**
 * Create a painter for every display type. It owns only the spectrogram's
 * offscreen image and the spectrum's projection scratch, both reused across
 * frames; nothing audio-related is held.
 */
export function createAudioMeterPainter(): AudioMeterPainter {
  const spectrogram: {image?: SpectrogramImageCache} = {};
  const spectrum: {columns?: Float32Array} = {};
  return {
    paint(frame, snapshot, palette): void {
      switch (snapshot.type) {
        case 'vu': return paintVuMeter(frame, snapshot, palette);
        case 'loudness': return paintLoudnessMeter(frame, snapshot, palette);
        case 'waveform': return paintWaveformHistory(frame, snapshot, palette);
        case 'oscilloscope': return paintOscilloscopeTrace(frame, snapshot, palette);
        case 'spectrum': return paintSpectrumFrame(frame, snapshot, palette, spectrum);
        case 'spectrogram': return paintSpectrogramHistory(frame, snapshot, palette, spectrogram);
        case 'stereometer': return paintStereometer(frame, snapshot, palette);
        default: return undefined;
      }
    },
  };
}

/** Paint one snapshot without retaining anything between frames. */
export function paintAudioMeterDisplay(
  frame: AudioCanvasFrame,
  snapshot: AudioMeterDisplaySnapshot,
  palette: AudioMeterPalette,
): void {
  createAudioMeterPainter().paint(frame, snapshot, palette);
}
