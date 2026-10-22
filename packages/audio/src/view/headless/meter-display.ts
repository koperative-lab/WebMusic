// ============================================================================
// AudioMeterDisplay — the DOM-free half of `<audio-meter type="…">`.
//
// Seven display types read the same borrowed or owned analyser and reduce
// its windows into one small snapshot per animation frame: a VU reading with
// ballistics, a windowed loudness estimate, a scrolling waveform or
// spectrogram history, a trigger-aligned oscilloscope trace, a projected
// spectrum, or a goniometer point cloud with a correlation reading. A painter
// decides what the snapshot looks like; this class never schedules a frame,
// creates DOM or touches the audio graph.
//
// Measurement honesty: everything here is derived from AnalyserNode windows
// polled from the main thread. Windows overlap or skip according to frame
// cadence, so the VU, loudness and peak values are meter-grade readings, not
// gapless, sample-accurate or certified measurements.
// ============================================================================

import {kWeightingBinWeights} from '../../core';
import {LiveScrollBuffer} from './live';
import type {AudioMeterFrequencyInfo, AudioMeterStereoFrame} from './meter';

export type AudioMeterDisplayType =
  | 'vu'
  | 'loudness'
  | 'waveform'
  | 'oscilloscope'
  | 'spectrum'
  | 'spectrogram'
  | 'stereometer';

/** Display types in catalog order. */
export const AUDIO_METER_DISPLAY_TYPES: readonly AudioMeterDisplayType[] = [
  'vu',
  'loudness',
  'waveform',
  'oscilloscope',
  'spectrum',
  'spectrogram',
  'stereometer',
];

export type AudioMeterFrequencyScale = 'log' | 'mel' | 'linear';
export type AudioMeterLoudnessMode = 'momentary' | 'short-term' | 'rms-fast' | 'rms-slow';
export type AudioMeterTrigger = 'rising' | 'off';

export interface AudioMeterDisplayOptions {
  /** Which reduction to run. Default `vu`. */
  type?: AudioMeterDisplayType;
  /** Frequency axis for `spectrum` and `spectrogram`. Default `log`. */
  scale?: AudioMeterFrequencyScale;
  /** History kept by `waveform` and `spectrogram`, in seconds. Default 4, minimum 0.5. */
  windowSeconds?: number;
  /** Expected capture rate used to size the history ring. Default 60. */
  columnsPerSecond?: number;
  /** Visible `oscilloscope` span in milliseconds; capped by the analyser window. Default 20. */
  timebaseMs?: number;
  /** `oscilloscope` alignment. Default `rising` (latest rising zero crossing). */
  trigger?: AudioMeterTrigger;
  /** `loudness` integration. Default `momentary` (K-weighted, 400 ms). */
  loudnessMode?: AudioMeterLoudnessMode;
  /** Sine level, in dBFS, that reads 0 VU. Default -18. */
  referenceDbfs?: number;
  /** `spectrum` bar count; 0 draws a continuous curve. Default 0, minimum 4 otherwise. */
  bars?: number;
  /** Visual gain applied to `waveform` columns and `stereometer` points. Default 1.8. */
  gain?: number;
  /** Absolute per-capture decrement of held markers, in normalized scale units. Default 0.012. */
  peakDecay?: number;
  /** Projected rows kept per `spectrogram` column. Default 96. */
  spectrogramRows?: number;
}

/** What a display reads from; `AudioMeterController` satisfies this structurally. */
export interface AudioMeterDisplaySource {
  readonly frequencyInfo: AudioMeterFrequencyInfo | undefined;
  readTimeDomain(): Float32Array;
  readFrequency(): Float32Array;
  readFrequencyDecibels(): Float32Array;
  readStereo(): AudioMeterStereoFrame | undefined;
}

interface SnapshotBase {
  /** Capture timestamp in milliseconds, as supplied by the caller. */
  time: number;
  /** Whether the read window carried no signal above the silence floor. */
  silent: boolean;
}

export interface AudioMeterVuSnapshot extends SnapshotBase {
  type: 'vu';
  /** Smoothed reading in VU; `-Infinity` for silence. */
  vu: number;
  /** Needle deflection, 0 at rest to 1 at +3 VU. */
  deflection: number;
  /** Held maximum deflection, decayed per capture. */
  hold: number;
  referenceDbfs: number;
  /** Window sample peak in dBFS; `-Infinity` for silence. */
  peakDbfs: number;
  peakLit: boolean;
  clipLit: boolean;
}

export interface AudioMeterLoudnessSnapshot extends SnapshotBase {
  type: 'loudness';
  mode: AudioMeterLoudnessMode;
  /** Windowed reading: LUFS for K-weighted modes, dBFS RMS otherwise. `-Infinity` for silence. */
  value: number;
  unit: 'LUFS' | 'dB';
  /** Window sample peak in dBFS; `-Infinity` for silence. */
  peakDbfs: number;
  /** Held sample peak in dBFS, decayed per capture; `-Infinity` for silence. */
  peakHoldDbfs: number;
  /** Whether left and right were summed separately (stereo branch attached). */
  stereo: boolean;
}

export interface AudioMeterWaveformSnapshot extends SnapshotBase {
  type: 'waveform';
  /** Rows: `[min, max, hue]`, `hue` the log-frequency position of the window's spectral centroid in 0..1. */
  history: LiveScrollBuffer;
  /** Visual gain to apply to the stored samples when painting. */
  gain: number;
}

export interface AudioMeterOscilloscopeSnapshot extends SnapshotBase {
  type: 'oscilloscope';
  /** Visible samples, valid until the next capture. */
  samples: Float32Array;
  timebaseMs: number;
  triggered: boolean;
}

export interface AudioMeterSpectrumPeak {
  hz: number;
  /** Normalized 0..1 magnitude. */
  value: number;
  decibels: number;
  /** Nearest equal-tempered note name, such as `F1`. */
  note: string;
  /** Deviation from that note in cents, -50..50. */
  cents: number;
}

export interface AudioMeterSpectrumSnapshot extends SnapshotBase {
  type: 'spectrum';
  /** Normalized 0..1 bins, valid until the next capture. */
  bins: Float32Array;
  sampleRate: number;
  minDecibels: number;
  maxDecibels: number;
  scale: AudioMeterFrequencyScale;
  minHz: number;
  maxHz: number;
  /** 0 for a continuous curve. */
  bars: number;
  peak: AudioMeterSpectrumPeak | undefined;
}

export interface AudioMeterSpectrogramSnapshot extends SnapshotBase {
  type: 'spectrogram';
  /** One projected 0..1 column per capture, oldest first. */
  history: LiveScrollBuffer;
  scale: AudioMeterFrequencyScale;
  minHz: number;
  maxHz: number;
}

export interface AudioMeterStereometerSnapshot extends SnapshotBase {
  type: 'stereometer';
  /** Left and right windows, valid until the next capture. Equal for a mono-only source. */
  left: Float32Array;
  right: Float32Array;
  /** Whether the stereo branch supplied separate channels. */
  stereo: boolean;
  /** Smoothed Pearson correlation of the two channels, -1..1; 0 for silence. */
  correlation: number;
  gain: number;
  /** Log-frequency position of the window's spectral centroid in 0..1. */
  hue: number;
}

export type AudioMeterDisplaySnapshot =
  | AudioMeterVuSnapshot
  | AudioMeterLoudnessSnapshot
  | AudioMeterWaveformSnapshot
  | AudioMeterOscilloscopeSnapshot
  | AudioMeterSpectrumSnapshot
  | AudioMeterSpectrogramSnapshot
  | AudioMeterStereometerSnapshot;

/** Lowest sample magnitude treated as signal. */
const SILENCE_FLOOR = 1e-5;
const DEFAULT_MIN_HZ = 20;
const DEFAULT_MAX_HZ = 20_000;
/** First-order VU integration: 99 % of a tone burst after ~300 ms. */
const VU_TIME_CONSTANT_MS = 65;
const PEAK_INDICATOR_DBFS = -6;
const CLIP_INDICATOR_LINEAR = 0.9999;
const PEAK_INDICATOR_HOLD_MS = 250;
const CLIP_INDICATOR_HOLD_MS = 1_000;
const CORRELATION_TIME_CONSTANT_MS = 250;
/** Loudness windows in milliseconds per mode. */
const LOUDNESS_WINDOW_MS: Record<AudioMeterLoudnessMode, number> = {
  momentary: 400,
  'short-term': 3_000,
  'rms-fast': 300,
  'rms-slow': 1_000,
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function finiteOr(value: number | undefined, fallback: number): number {
  return value === undefined || !Number.isFinite(value) ? fallback : value;
}

export function decibelsFromLinear(value: number): number {
  return value > 0 ? 20 * Math.log10(value) : -Infinity;
}

// --- frequency axis -----------------------------------------------------------

function melOf(hz: number): number {
  return 2595 * Math.log10(1 + hz / 700);
}

function hzOfMel(mel: number): number {
  return 700 * (Math.pow(10, mel / 2595) - 1);
}

/** Frequency at a fraction of the axis for the given scale. */
export function frequencyAt(
  fraction: number,
  scale: AudioMeterFrequencyScale,
  minHz = DEFAULT_MIN_HZ,
  maxHz = DEFAULT_MAX_HZ,
): number {
  const u = clamp(Number.isFinite(fraction) ? fraction : 0, 0, 1);
  if (scale === 'linear') return minHz + u * (maxHz - minHz);
  if (scale === 'mel') return hzOfMel(melOf(minHz) + u * (melOf(maxHz) - melOf(minHz)));
  return minHz * Math.pow(maxHz / minHz, u);
}

/** Axis fraction of a frequency for the given scale, clamped to 0..1. */
export function fractionOf(
  hz: number,
  scale: AudioMeterFrequencyScale,
  minHz = DEFAULT_MIN_HZ,
  maxHz = DEFAULT_MAX_HZ,
): number {
  if (!Number.isFinite(hz) || hz <= 0) return 0;
  let u: number;
  if (scale === 'linear') u = (hz - minHz) / (maxHz - minHz);
  else if (scale === 'mel') u = (melOf(hz) - melOf(minHz)) / (melOf(maxHz) - melOf(minHz));
  else u = Math.log(hz / minHz) / Math.log(maxHz / minHz);
  return clamp(u, 0, 1);
}

/**
 * Project FFT bins onto `columns` axis cells. A cell narrower than one bin
 * interpolates between its two neighbours; a wider cell takes the maximum of
 * the bins it spans, so a narrow peak is never averaged away.
 */
export function projectSpectrum(
  bins: ArrayLike<number>,
  sampleRate: number,
  columns: number,
  scale: AudioMeterFrequencyScale,
  minHz = DEFAULT_MIN_HZ,
  maxHz = DEFAULT_MAX_HZ,
  out?: Float32Array,
): Float32Array {
  const count = Math.max(1, Math.floor(columns));
  const result = out && out.length === count ? out : new Float32Array(count);
  const binCount = bins.length;
  if (binCount === 0 || !(sampleRate > 0)) {
    result.fill(0);
    return result;
  }
  const binHz = sampleRate / 2 / binCount;
  const top = Math.min(maxHz, sampleRate / 2);
  for (let column = 0; column < count; column += 1) {
    const start = frequencyAt(column / count, scale, minHz, top) / binHz;
    const end = frequencyAt((column + 1) / count, scale, minHz, top) / binHz;
    if (end - start < 1) {
      const position = clamp((start + end) / 2, 0, binCount - 1);
      const low = Math.floor(position);
      const high = Math.min(binCount - 1, low + 1);
      const mix = position - low;
      result[column] = clamp((bins[low] ?? 0) * (1 - mix) + (bins[high] ?? 0) * mix, 0, 1);
      continue;
    }
    let maximum = 0;
    for (let bin = Math.max(0, Math.floor(start)); bin < Math.min(binCount, Math.ceil(end)); bin += 1) {
      const value = bins[bin] ?? 0;
      if (value > maximum) maximum = value;
    }
    result[column] = clamp(maximum, 0, 1);
  }
  return result;
}

const NOTE_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];

/** Nearest equal-tempered note (A4 = 440 Hz) and the deviation in cents. */
export function describeFrequency(hz: number): {note: string; cents: number; midi: number} {
  if (!Number.isFinite(hz) || hz <= 0) return {note: '', cents: 0, midi: Number.NaN};
  const exact = 69 + 12 * Math.log2(hz / 440);
  const midi = Math.round(exact);
  const cents = Math.round((exact - midi) * 100);
  const name = NOTE_NAMES[((midi % 12) + 12) % 12]!;
  return {note: `${name}${Math.floor(midi / 12) - 1}`, cents, midi};
}

/**
 * The loudest bin above `minHz`, refined by parabolic interpolation of its
 * neighbours. `undefined` when the frame carries no energy.
 */
export function peakFrequency(
  bins: ArrayLike<number>,
  sampleRate: number,
  minHz = DEFAULT_MIN_HZ,
): {hz: number; value: number; bin: number} | undefined {
  const binCount = bins.length;
  if (binCount < 2 || !(sampleRate > 0)) return undefined;
  const binHz = sampleRate / 2 / binCount;
  let best = -1;
  let bestValue = 0;
  for (let bin = Math.max(1, Math.ceil(minHz / binHz)); bin < binCount; bin += 1) {
    const value = bins[bin] ?? 0;
    if (value > bestValue) {
      bestValue = value;
      best = bin;
    }
  }
  if (best < 0 || bestValue <= 0) return undefined;
  const left = bins[best - 1] ?? 0;
  const right = bins[best + 1] ?? 0;
  const denominator = left - 2 * bestValue + right;
  const offset = denominator !== 0 ? clamp((0.5 * (left - right)) / denominator, -0.5, 0.5) : 0;
  return {hz: (best + offset) * binHz, value: bestValue, bin: best};
}

/** Spectral centroid in hertz of a normalized magnitude frame; 0 for silence. */
export function spectralCentroid(bins: ArrayLike<number>, sampleRate: number): number {
  const binCount = bins.length;
  if (binCount === 0 || !(sampleRate > 0)) return 0;
  const binHz = sampleRate / 2 / binCount;
  let weighted = 0;
  let total = 0;
  for (let bin = 0; bin < binCount; bin += 1) {
    const value = bins[bin] ?? 0;
    weighted += value * bin * binHz;
    total += value;
  }
  return total > 0 ? weighted / total : 0;
}

// --- time-domain reductions -----------------------------------------------------

/** Mean square and absolute peak of a window. */
export function windowLevel(samples: ArrayLike<number>): {meanSquare: number; peak: number} {
  let sum = 0;
  let peak = 0;
  const length = samples.length;
  for (let index = 0; index < length; index += 1) {
    const sample = samples[index] ?? 0;
    if (!Number.isFinite(sample)) continue;
    sum += sample * sample;
    const magnitude = sample < 0 ? -sample : sample;
    if (magnitude > peak) peak = magnitude;
  }
  return {meanSquare: length > 0 ? sum / length : 0, peak};
}

/**
 * Start index of the latest window of `count` samples that begins at a rising
 * zero crossing, or the latest window when the trigger is off or no crossing
 * fits. `triggered` reports which it was.
 */
export function alignTrigger(
  samples: ArrayLike<number>,
  count: number,
  trigger: AudioMeterTrigger,
): {start: number; triggered: boolean} {
  const visible = clamp(Math.floor(count), 1, Math.max(1, samples.length));
  const latest = samples.length - visible;
  if (trigger === 'off') return {start: Math.max(0, latest), triggered: false};
  for (let index = latest; index >= 1; index -= 1) {
    const previous = samples[index - 1] ?? 0;
    const current = samples[index] ?? 0;
    if (previous < 0 && current >= 0) return {start: index, triggered: true};
  }
  return {start: Math.max(0, latest), triggered: false};
}

/** Pearson correlation of two windows, -1..1; 0 when either is silent. */
export function stereoCorrelation(left: ArrayLike<number>, right: ArrayLike<number>): number {
  const length = Math.min(left.length, right.length);
  let cross = 0;
  let leftPower = 0;
  let rightPower = 0;
  for (let index = 0; index < length; index += 1) {
    const l = left[index] ?? 0;
    const r = right[index] ?? 0;
    cross += l * r;
    leftPower += l * l;
    rightPower += r * r;
  }
  const scale = Math.sqrt(leftPower * rightPower);
  return scale > 0 ? clamp(cross / scale, -1, 1) : 0;
}

/** VU reading of a smoothed RMS: a sine at `referenceDbfs` (peak) reads 0 VU. */
export function vuFromRms(rms: number, referenceDbfs: number): number {
  return rms > 0 ? 20 * Math.log10(rms * Math.SQRT2) - referenceDbfs : -Infinity;
}

/** Needle deflection for a VU reading: linear in amplitude, +3 VU at full scale. */
export function vuDeflection(vu: number): number {
  if (!Number.isFinite(vu)) return 0;
  return clamp(Math.pow(10, (vu - 3) / 20), 0, 1);
}

/**
 * K-weighting as a power ratio of a window's own magnitude spectrum: the
 * K-weighted energy divided by the unweighted energy. Multiplying a window's
 * time-domain mean square by it reproduces the two-stage filter's effect on
 * that window without the filter-state transient a restarted IIR would add
 * at the start of every polled window. Returns 1 for an empty spectrum.
 */
export function kWeightingRatio(spectrumDecibels: ArrayLike<number>, weights: ArrayLike<number>): number {
  let weighted = 0;
  let total = 0;
  const bins = Math.min(spectrumDecibels.length, weights.length);
  for (let bin = 0; bin < bins; bin += 1) {
    const decibels = spectrumDecibels[bin];
    if (decibels === undefined || !Number.isFinite(decibels)) continue;
    const power = Math.pow(10, decibels / 10);
    weighted += power * (weights[bin] ?? 0);
    total += power;
  }
  return total > 0 ? weighted / total : 1;
}

/** Windowed mean-square history that answers "the loudness over the last N ms". */
export class LoudnessEstimator {
  #times: number[] = [];
  #weighted: number[] = [];
  #plain: number[] = [];
  readonly #maxWindowMs: number;

  constructor(maxWindowMs = 3_000) {
    this.#maxWindowMs = Math.max(1, maxWindowMs);
  }

  /** Record one window's summed channel energies at `nowMs`. */
  push(nowMs: number, kWeightedMeanSquare: number, meanSquare: number): void {
    this.#times.push(nowMs);
    this.#weighted.push(Math.max(0, kWeightedMeanSquare));
    this.#plain.push(Math.max(0, meanSquare));
    const cutoff = nowMs - this.#maxWindowMs;
    let drop = 0;
    while (drop < this.#times.length && this.#times[drop]! < cutoff) drop += 1;
    if (drop > 0) {
      this.#times.splice(0, drop);
      this.#weighted.splice(0, drop);
      this.#plain.splice(0, drop);
    }
  }

  /**
   * LUFS (`weighting: 'k'`, -0.691 + 10·log10 of the mean K-weighted energy)
   * or dBFS RMS of the windows inside the last `windowMs`. `-Infinity` when
   * nothing was recorded or the window is silent.
   */
  read(nowMs: number, windowMs: number, weighting: 'k' | 'none'): number {
    const cutoff = nowMs - Math.max(1, windowMs);
    const series = weighting === 'k' ? this.#weighted : this.#plain;
    let sum = 0;
    let count = 0;
    for (let index = this.#times.length - 1; index >= 0; index -= 1) {
      if (this.#times[index]! < cutoff) break;
      sum += series[index]!;
      count += 1;
    }
    if (count === 0) return -Infinity;
    const mean = sum / count;
    if (mean <= 0) return -Infinity;
    return weighting === 'k' ? -0.691 + 10 * Math.log10(mean) : 10 * Math.log10(mean);
  }

  get length(): number {
    return this.#times.length;
  }

  clear(): void {
    this.#times = [];
    this.#weighted = [];
    this.#plain = [];
  }
}

/** Decayed hold of a normalized marker. */
class HeldMarker {
  #value = 0;
  update(value: number, decay: number): number {
    this.#value = Math.max(value, this.#value - Math.max(0, decay));
    return this.#value;
  }
  clear(): void {
    this.#value = 0;
  }
}

/** Indicator that stays lit for a hold time after its condition last held. */
class HeldIndicator {
  #until = -Infinity;
  update(lit: boolean, nowMs: number, holdMs: number): boolean {
    if (lit) this.#until = nowMs + holdMs;
    return nowMs < this.#until;
  }
  clear(): void {
    this.#until = -Infinity;
  }
}

/**
 * Owns the per-type reduction state behind one meter display. `capture()`
 * reads the source once and returns a snapshot whose typed arrays stay valid
 * until the next capture; the caller paints it immediately.
 */
export class AudioMeterDisplay {
  #type: AudioMeterDisplayType;
  #scale: AudioMeterFrequencyScale;
  #windowSeconds: number;
  #columnsPerSecond: number;
  #timebaseMs: number;
  #trigger: AudioMeterTrigger;
  #loudnessMode: AudioMeterLoudnessMode;
  #referenceDbfs: number;
  #bars: number;
  #gain: number;
  #peakDecay: number;
  #spectrogramRows: number;

  #history?: LiveScrollBuffer;
  #column?: Float32Array;
  #startedAt?: number;
  #vuRms = 0;
  #vuAt?: number;
  #vuHold = new HeldMarker();
  #peakLit = new HeldIndicator();
  #clipLit = new HeldIndicator();
  #loudness = new LoudnessEstimator();
  #peakHoldDbfs = -Infinity;
  #kWeights?: {bins: number; sampleRate: number; weights: Float32Array};
  #correlation = 0;
  #correlationAt?: number;
  #monoRight?: Float32Array;

  constructor(options: AudioMeterDisplayOptions = {}) {
    this.#type = AUDIO_METER_DISPLAY_TYPES.includes(options.type as AudioMeterDisplayType)
      ? (options.type as AudioMeterDisplayType)
      : 'vu';
    this.#scale = normalizeScale(options.scale);
    this.#windowSeconds = Math.max(0.5, finiteOr(options.windowSeconds, 4));
    this.#columnsPerSecond = Math.max(1, finiteOr(options.columnsPerSecond, 60));
    this.#timebaseMs = Math.max(0.1, finiteOr(options.timebaseMs, 20));
    this.#trigger = options.trigger === 'off' ? 'off' : 'rising';
    this.#loudnessMode = normalizeLoudnessMode(options.loudnessMode);
    this.#referenceDbfs = finiteOr(options.referenceDbfs, -18);
    this.#bars = normalizeBars(options.bars);
    this.#gain = Math.max(0, finiteOr(options.gain, 1.8));
    this.#peakDecay = Math.max(0, finiteOr(options.peakDecay, 0.012));
    this.#spectrogramRows = Math.max(8, Math.floor(finiteOr(options.spectrogramRows, 96)));
  }

  get type(): AudioMeterDisplayType {
    return this.#type;
  }

  get scale(): AudioMeterFrequencyScale {
    return this.#scale;
  }

  get windowSeconds(): number {
    return this.#windowSeconds;
  }

  get timebaseMs(): number {
    return this.#timebaseMs;
  }

  get trigger(): AudioMeterTrigger {
    return this.#trigger;
  }

  get loudnessMode(): AudioMeterLoudnessMode {
    return this.#loudnessMode;
  }

  get referenceDbfs(): number {
    return this.#referenceDbfs;
  }

  get bars(): number {
    return this.#bars;
  }

  get gain(): number {
    return this.#gain;
  }

  get peakDecay(): number {
    return this.#peakDecay;
  }

  /** Whether the current type reads the stereo branch when one is attached. */
  get wantsStereo(): boolean {
    return this.#type === 'stereometer' || this.#type === 'loudness';
  }

  /** The current history ring, when the type keeps one. */
  get history(): LiveScrollBuffer | undefined {
    return this.#history;
  }

  /**
   * Change options in place. Omitted fields keep their values. Changing the
   * type, axis or history length clears accumulated state; tuning a trigger,
   * reference or gain does not.
   */
  configure(options: AudioMeterDisplayOptions): void {
    let reset = false;
    if (options.type !== undefined && options.type !== this.#type) {
      this.#type = AUDIO_METER_DISPLAY_TYPES.includes(options.type) ? options.type : 'vu';
      reset = true;
    }
    if (options.scale !== undefined && normalizeScale(options.scale) !== this.#scale) {
      this.#scale = normalizeScale(options.scale);
      reset = true;
    }
    if (options.windowSeconds !== undefined) {
      const next = Math.max(0.5, finiteOr(options.windowSeconds, 4));
      if (next !== this.#windowSeconds) {
        this.#windowSeconds = next;
        reset = true;
      }
    }
    if (options.spectrogramRows !== undefined) {
      const next = Math.max(8, Math.floor(finiteOr(options.spectrogramRows, 96)));
      if (next !== this.#spectrogramRows) {
        this.#spectrogramRows = next;
        reset = true;
      }
    }
    if (options.loudnessMode !== undefined) this.#loudnessMode = normalizeLoudnessMode(options.loudnessMode);
    if (options.timebaseMs !== undefined) this.#timebaseMs = Math.max(0.1, finiteOr(options.timebaseMs, 20));
    if (options.trigger !== undefined) this.#trigger = options.trigger === 'off' ? 'off' : 'rising';
    if (options.referenceDbfs !== undefined) this.#referenceDbfs = finiteOr(options.referenceDbfs, -18);
    if (options.bars !== undefined) this.#bars = normalizeBars(options.bars);
    if (options.gain !== undefined) this.#gain = Math.max(0, finiteOr(options.gain, 1.8));
    if (options.peakDecay !== undefined) this.#peakDecay = Math.max(0, finiteOr(options.peakDecay, 0.012));
    if (reset) this.clear();
  }

  /** Drop accumulated history, holds and smoothing, e.g. on source replacement. */
  clear(): void {
    this.#history = undefined;
    this.#column = undefined;
    this.#startedAt = undefined;
    this.#vuRms = 0;
    this.#vuAt = undefined;
    this.#vuHold.clear();
    this.#peakLit.clear();
    this.#clipLit.clear();
    this.#loudness.clear();
    this.#peakHoldDbfs = -Infinity;
    this.#correlation = 0;
    this.#correlationAt = undefined;
  }

  /** Read the source once and reduce it for the current type. */
  capture(source: AudioMeterDisplaySource, nowMs: number): AudioMeterDisplaySnapshot {
    const time = Number.isFinite(nowMs) ? nowMs : 0;
    switch (this.#type) {
      case 'loudness': return this.#captureLoudness(source, time);
      case 'waveform': return this.#captureWaveform(source, time);
      case 'oscilloscope': return this.#captureOscilloscope(source, time);
      case 'spectrum': return this.#captureSpectrum(source, time);
      case 'spectrogram': return this.#captureSpectrogram(source, time);
      case 'stereometer': return this.#captureStereometer(source, time);
      default: return this.#captureVu(source, time);
    }
  }

  #captureVu(source: AudioMeterDisplaySource, time: number): AudioMeterVuSnapshot {
    const {meanSquare, peak} = windowLevel(source.readTimeDomain());
    const rms = Math.sqrt(meanSquare);
    const previousAt = this.#vuAt;
    const elapsed = previousAt === undefined ? Infinity : Math.max(0, time - previousAt);
    const alpha = elapsed === Infinity ? 1 : 1 - Math.exp(-elapsed / VU_TIME_CONSTANT_MS);
    this.#vuRms += (rms - this.#vuRms) * alpha;
    this.#vuAt = time;
    const vu = vuFromRms(this.#vuRms, this.#referenceDbfs);
    const deflection = vuDeflection(vu);
    const peakDbfs = decibelsFromLinear(peak);
    return {
      type: 'vu',
      time,
      silent: peak < SILENCE_FLOOR,
      vu,
      deflection,
      hold: this.#vuHold.update(deflection, this.#peakDecay),
      referenceDbfs: this.#referenceDbfs,
      peakDbfs,
      peakLit: this.#peakLit.update(peakDbfs >= PEAK_INDICATOR_DBFS, time, PEAK_INDICATOR_HOLD_MS),
      clipLit: this.#clipLit.update(peak >= CLIP_INDICATOR_LINEAR, time, CLIP_INDICATOR_HOLD_MS),
    };
  }

  #captureLoudness(source: AudioMeterDisplaySource, time: number): AudioMeterLoudnessSnapshot {
    const info = source.frequencyInfo;
    const stereo = source.readStereo();
    const weighted = this.#loudnessMode === 'momentary' || this.#loudnessMode === 'short-term';
    let weights: Float32Array | undefined;
    if (weighted && info) {
      const cached = this.#kWeights;
      if (!cached || cached.bins !== info.frequencyBinCount || cached.sampleRate !== info.sampleRate) {
        this.#kWeights = {
          bins: info.frequencyBinCount,
          sampleRate: info.sampleRate,
          weights: kWeightingBinWeights(info.frequencyBinCount, info.sampleRate),
        };
      }
      weights = this.#kWeights!.weights;
    }
    // The spectrum describes the summed window; its K-weighting ratio is
    // applied to each channel's own energy. Separate channel spectra would
    // cost two more FFT reads for a difference far below meter resolution.
    const spectrum = weights ? source.readFrequencyDecibels() : undefined;
    let meanSquare = 0;
    let peak = 0;
    if (stereo) {
      for (const channel of [stereo.left, stereo.right]) {
        const level = windowLevel(channel);
        meanSquare += level.meanSquare;
        if (level.peak > peak) peak = level.peak;
      }
    } else {
      // A summed mono window stands in for two equal channels: exact for a
      // mono source, up to 3 dB low for wide stereo material.
      const level = windowLevel(source.readTimeDomain());
      meanSquare = level.meanSquare * 2;
      peak = level.peak;
    }
    const kWeighted = spectrum && weights ? meanSquare * kWeightingRatio(spectrum, weights) : meanSquare;
    // K-weighted modes sum the channels (BS.1770); RMS modes report the mean
    // channel energy so a mono source reads the same in both branches.
    this.#loudness.push(time, kWeighted, meanSquare / 2);
    const peakDbfs = decibelsFromLinear(peak);
    // The hold decays in normalized units of the painted 50 dB scale.
    this.#peakHoldDbfs = Math.max(peakDbfs, this.#peakHoldDbfs - this.#peakDecay * 50);
    return {
      type: 'loudness',
      time,
      silent: peak < SILENCE_FLOOR,
      mode: this.#loudnessMode,
      value: this.#loudness.read(time, LOUDNESS_WINDOW_MS[this.#loudnessMode], weighted ? 'k' : 'none'),
      unit: weighted ? 'LUFS' : 'dB',
      peakDbfs,
      peakHoldDbfs: this.#peakHoldDbfs,
      stereo: stereo !== undefined,
    };
  }

  #captureWaveform(source: AudioMeterDisplaySource, time: number): AudioMeterWaveformSnapshot {
    const samples = source.readTimeDomain();
    let min = 1;
    let max = -1;
    let peak = 0;
    for (let index = 0; index < samples.length; index += 1) {
      const sample = samples[index]!;
      if (sample < min) min = sample;
      if (sample > max) max = sample;
      const magnitude = sample < 0 ? -sample : sample;
      if (magnitude > peak) peak = magnitude;
    }
    if (min > max) { min = 0; max = 0; }
    const hue = this.#hueOf(source);
    const history = this.#ensureHistory(3);
    history.push(this.#seconds(time), [min, max, hue]);
    return {type: 'waveform', time, silent: peak < SILENCE_FLOOR, history, gain: this.#gain};
  }

  #captureOscilloscope(source: AudioMeterDisplaySource, time: number): AudioMeterOscilloscopeSnapshot {
    const samples = source.readTimeDomain();
    const sampleRate = source.frequencyInfo?.sampleRate ?? 0;
    const requested = sampleRate > 0 ? Math.round((this.#timebaseMs * sampleRate) / 1_000) + 1 : samples.length;
    const count = clamp(requested, 2, Math.max(2, samples.length));
    const {start, triggered} = alignTrigger(samples, count, this.#trigger);
    const visible = samples.subarray(start, start + count);
    const {peak} = windowLevel(visible);
    return {
      type: 'oscilloscope',
      time,
      silent: peak < SILENCE_FLOOR,
      samples: visible,
      timebaseMs: sampleRate > 0 ? ((visible.length - 1) / sampleRate) * 1_000 : this.#timebaseMs,
      triggered,
    };
  }

  #captureSpectrum(source: AudioMeterDisplaySource, time: number): AudioMeterSpectrumSnapshot {
    const info = source.frequencyInfo;
    const bins = source.readFrequency();
    const sampleRate = info?.sampleRate ?? 0;
    const minDecibels = info?.minDecibels ?? -100;
    const maxDecibels = info?.maxDecibels ?? -30;
    const found = peakFrequency(bins, sampleRate);
    let peak: AudioMeterSpectrumPeak | undefined;
    if (found) {
      const {note, cents} = describeFrequency(found.hz);
      peak = {
        hz: found.hz,
        value: found.value,
        decibels: minDecibels + found.value * (maxDecibels - minDecibels),
        note,
        cents,
      };
    }
    let maximum = 0;
    for (let index = 0; index < bins.length; index += 1) if (bins[index]! > maximum) maximum = bins[index]!;
    return {
      type: 'spectrum',
      time,
      silent: maximum <= 0,
      bins,
      sampleRate,
      minDecibels,
      maxDecibels,
      scale: this.#scale,
      minHz: DEFAULT_MIN_HZ,
      maxHz: Math.min(DEFAULT_MAX_HZ, sampleRate > 0 ? sampleRate / 2 : DEFAULT_MAX_HZ),
      bars: this.#bars,
      peak,
    };
  }

  #captureSpectrogram(source: AudioMeterDisplaySource, time: number): AudioMeterSpectrogramSnapshot {
    const info = source.frequencyInfo;
    const bins = source.readFrequency();
    const sampleRate = info?.sampleRate ?? 0;
    const maxHz = Math.min(DEFAULT_MAX_HZ, sampleRate > 0 ? sampleRate / 2 : DEFAULT_MAX_HZ);
    const rows = this.#spectrogramRows;
    if (!this.#column || this.#column.length !== rows) this.#column = new Float32Array(rows);
    projectSpectrum(bins, sampleRate, rows, this.#scale, DEFAULT_MIN_HZ, maxHz, this.#column);
    let maximum = 0;
    for (let index = 0; index < rows; index += 1) if (this.#column[index]! > maximum) maximum = this.#column[index]!;
    const history = this.#ensureHistory(rows);
    history.push(this.#seconds(time), this.#column);
    return {
      type: 'spectrogram',
      time,
      silent: maximum <= 0,
      history,
      scale: this.#scale,
      minHz: DEFAULT_MIN_HZ,
      maxHz,
    };
  }

  #captureStereometer(source: AudioMeterDisplaySource, time: number): AudioMeterStereometerSnapshot {
    const stereo = source.readStereo();
    let left: Float32Array;
    let right: Float32Array;
    if (stereo) {
      left = stereo.left;
      right = stereo.right;
    } else {
      left = source.readTimeDomain();
      if (!this.#monoRight || this.#monoRight.length !== left.length) this.#monoRight = new Float32Array(left.length);
      this.#monoRight.set(left);
      right = this.#monoRight;
    }
    const previousAt = this.#correlationAt;
    const elapsed = previousAt === undefined ? Infinity : Math.max(0, time - previousAt);
    const alpha = elapsed === Infinity ? 1 : 1 - Math.exp(-elapsed / CORRELATION_TIME_CONSTANT_MS);
    const instant = stereoCorrelation(left, right);
    this.#correlation += (instant - this.#correlation) * alpha;
    this.#correlationAt = time;
    const peak = Math.max(windowLevel(left).peak, windowLevel(right).peak);
    return {
      type: 'stereometer',
      time,
      silent: peak < SILENCE_FLOOR,
      left,
      right,
      stereo: stereo !== undefined,
      correlation: peak < SILENCE_FLOOR ? 0 : this.#correlation,
      gain: this.#gain,
      hue: this.#hueOf(source),
    };
  }

  #hueOf(source: AudioMeterDisplaySource): number {
    const info = source.frequencyInfo;
    if (!info) return 0;
    const centroid = spectralCentroid(source.readFrequency(), info.sampleRate);
    return centroid > 0 ? fractionOf(centroid, 'log') : 0;
  }

  #seconds(time: number): number {
    this.#startedAt ??= time;
    return Math.max(0, (time - this.#startedAt) / 1_000);
  }

  #ensureHistory(rows: number): LiveScrollBuffer {
    const current = this.#history;
    if (current && current.rows === rows && current.windowSeconds === this.#windowSeconds) return current;
    this.#history = new LiveScrollBuffer({
      rows,
      windowSeconds: this.#windowSeconds,
      columnsPerSecond: this.#columnsPerSecond,
    });
    return this.#history;
  }
}

/** Build an {@link AudioMeterDisplay} (the `createX` convention). */
export function createAudioMeterDisplay(options?: AudioMeterDisplayOptions): AudioMeterDisplay {
  return new AudioMeterDisplay(options);
}

function normalizeScale(value: unknown): AudioMeterFrequencyScale {
  return value === 'mel' || value === 'linear' ? value : 'log';
}

function normalizeLoudnessMode(value: unknown): AudioMeterLoudnessMode {
  return value === 'short-term' || value === 'rms-fast' || value === 'rms-slow' ? value : 'momentary';
}

function normalizeBars(value: number | undefined): number {
  const bars = Math.floor(finiteOr(value, 0));
  return bars <= 0 ? 0 : Math.max(4, bars);
}
