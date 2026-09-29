// ============================================================================
// AudioMeterController — DOM-free Web Audio metering.
//
// The controller either owns a transparent input -> analyser -> output tap, or
// borrows an analyser supplied by the caller. It performs no scheduling and
// creates no UI; a framework, canvas renderer or @webmusic/ui presenter decides
// when to read frames.
//
// The tap and the byte-domain arithmetic are the kernel's shared analyser
// meter. View owns Audio's PCM-sample level helper, the published frame
// shapes, and the bar aggregation re-exported under Audio's option names.
// ============================================================================

import {AnalyserMeter, aggregateSpectrumBars} from '@webmusic/kernel/meter';

export interface LevelMeterOptions {
  previousPeak?: number;
  /** Peak retained per calculation, in [0, 1]. Default 0.96. */
  peakDecay?: number;
}

export interface LevelMeterFrame {
  rms: number;
  peak: number;
  peakHold: number;
}

export interface SpectrumBarsOptions {
  bars?: number;
  /** Convert byte FFT input (0..255) to [0, 1]. Default true. */
  normalizeBytes?: boolean;
}

export interface AudioMeterControllerOptions {
  /** Build and own a transparent input -> analyser -> output tap. */
  context?: BaseAudioContext;
  /** Borrow an existing analyser. It is never connected or disconnected. */
  analyser?: AnalyserNode;
  /** FFT size assigned to an owned analyser. Default 1024. */
  fftSize?: number;
  /** Smoothing assigned to an owned analyser. Default 0.8. */
  smoothingTimeConstant?: number;
  /** RMS gain used for the display-level value. Default 1.8. */
  levelScale?: number;
  /** Absolute peak-hold decay applied on every read. Default 0.012. */
  peakDecay?: number;
}

/** Live tuning without replacing a controller's owned input/output graph. */
export type AudioMeterConfiguration = Omit<AudioMeterControllerOptions, 'context' | 'analyser'>;

/** Live peak is scaled; peakHold retains scaled RMS with an absolute per-read decay. */
export interface AudioMeterLevelFrame extends LevelMeterFrame {
  /** Scaled, clamped RMS value intended for a visual meter. */
  level: number;
}

/**
 * Calculate RMS, instantaneous peak and decaying peak hold from PCM samples.
 *
 * This is the offline/pull counterpart of {@link AudioMeterController}: it
 * reads a caller's sample buffer rather than an analyser, and its `peakDecay`
 * is a multiplicative retention factor, not the controller's absolute
 * per-read decay.
 */
export function calculateLevelMeter(
  samples: ArrayLike<number>,
  options: LevelMeterOptions = {},
): LevelMeterFrame {
  let sumSquares = 0;
  let peak = 0;
  for (let index = 0; index < samples.length; index += 1) {
    const sample = Number.isFinite(samples[index]) ? samples[index] : 0;
    sumSquares += sample * sample;
    const magnitude = Math.abs(sample);
    if (magnitude > peak) peak = magnitude;
  }
  const rms = samples.length > 0 ? Math.sqrt(sumSquares / samples.length) : 0;
  const decay = clamp(options.peakDecay ?? 0.96, 0, 1);
  const held = Math.max(0, options.previousPeak ?? 0) * decay;
  return {rms, peak, peakHold: Math.max(peak, held)};
}

/** Aggregate an FFT vector into a requested number of normalized bars. */
export function calculateSpectrumBars(
  spectrum: ArrayLike<number>,
  options: SpectrumBarsOptions = {},
): Float32Array {
  return aggregateSpectrumBars(spectrum, {
    ...(options.bars === undefined ? {} : {bars: options.bars}),
    ...(options.normalizeBytes === undefined ? {} : {normalizeBytes: options.normalizeBytes}),
  });
}

/**
 * DOM-free live meter source.
 *
 * Supplying `context` creates an owned pass-through tap. Supplying `analyser`
 * borrows that node. The two modes are intentionally mutually exclusive so
 * resource ownership is unambiguous.
 */
export class AudioMeterController {
  readonly #meter: AnalyserMeter;

  constructor(options: AudioMeterControllerOptions = {}) {
    if (options.context && options.analyser) {
      throw new TypeError('AudioMeterController accepts either context or analyser, not both');
    }
    this.#meter = new AnalyserMeter({
      ...(options.context ? {context: options.context} : {}),
      ...(options.analyser ? {analyser: options.analyser} : {}),
      ...(options.fftSize === undefined ? {} : {fftSize: options.fftSize}),
      ...(options.smoothingTimeConstant === undefined
        ? {}
        : {smoothingTimeConstant: options.smoothingTimeConstant}),
      ...(options.levelScale === undefined ? {} : {levelScale: options.levelScale}),
      ...(options.peakDecay === undefined ? {} : {peakDecay: options.peakDecay}),
    });
  }

  /** The owned or borrowed analyser currently read by this controller. */
  get analyser(): AnalyserNode | undefined {
    return this.#meter.analyser;
  }

  /** Input of an owned transparent tap; absent when borrowing an analyser. */
  get input(): AudioNode | undefined {
    return this.#meter.input;
  }

  /** Output of an owned transparent tap; absent when borrowing an analyser. */
  get output(): AudioNode | undefined {
    return this.#meter.output;
  }

  /** Whether this controller created and owns its tap graph. */
  get ownsGraph(): boolean {
    return this.#meter.ownsGraph;
  }

  /**
   * Update tuning in place. Omitted fields retain their values. Invalid owned
   * analyser settings leave the graph and previous tuning intact; fftSize and
   * smoothingTimeConstant are ignored when the analyser is borrowed.
   */
  configure(options: AudioMeterConfiguration = {}): void {
    this.#meter.configure(options);
  }

  /** Read one time-domain frame and calculate its current level. */
  readLevel(): AudioMeterLevelFrame {
    const {rms, level, peak, peakHold} = this.#meter.readLevel();
    return {rms, peak, peakHold, level};
  }

  /** Read and aggregate one frequency-domain frame. */
  readSpectrum(bars = 28): Float32Array {
    return this.#meter.readSpectrum(bars);
  }

  /**
   * Release an owned graph. Borrowed analysers are never disconnected.
   *
   * Every owned node is attempted even when an earlier disconnect throws; the
   * first error is rethrown only after the controller has reached a disposed
   * state. Repeated calls are safe.
   */
  dispose(): void {
    this.#meter.dispose();
  }
}

/** Build an {@link AudioMeterController} (the `createX` convention). */
export function createAudioMeterController(
  options?: AudioMeterControllerOptions,
): AudioMeterController {
  return new AudioMeterController(options);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
