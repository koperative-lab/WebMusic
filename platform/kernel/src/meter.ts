// ============================================================================
// Analyser metering shared by both families' level meters: a transparent
// `input -> analyser -> output` tap plus the byte-domain level and spectrum
// maths that read it. Numbers and Web Audio nodes only — no score, no clip,
// no presenter, and nothing here decides WHEN to read a frame (a framework,
// canvas renderer or presenter drives that).
//
// Extracted because both families had grown their own copy of the same tap
// and the same RMS / peak-hold / bar-aggregation arithmetic, and the copies
// had begun to drift. Per-family differences that are genuinely editorial —
// the minimum bar count, the frame shape each family publishes, whether a
// failing disconnect is swallowed — stay with the families; only the
// mechanism lives here.
// ============================================================================

/** One time-domain reading, before a family decides what to publish. */
export interface AnalyserMeterFrame {
  /** Raw root-mean-square of the frame, unscaled and unclamped. */
  rms: number;
  /** `rms` scaled by `levelScale` and clamped to [0, 1] — the display value. */
  level: number;
  /** Instantaneous sample peak, scaled and clamped the same way. */
  peak: number;
  /** Decaying peak hold: `max(level, previousHold - peakDecay)`. */
  peakHold: number;
}

export interface SpectrumBarOptions {
  /** Requested bar count, floored to a positive integer. Non-finite values use the default 28. */
  bars?: number;
  /** Floor applied to the requested count. Floored to an integer >= 1; non-finite values use 1. */
  minimumBars?: number;
  /** Treat the input as byte FFT data (0..255) and scale to [0, 1]. Default true. */
  normalizeBytes?: boolean;
}

export interface AnalyserMeterOptions {
  /** Build and own a transparent `input -> analyser -> output` tap. */
  context?: BaseAudioContext;
  /** Borrow an existing analyser. It is never connected or disconnected. */
  analyser?: AnalyserNode;
  /** FFT size assigned to an owned analyser. Default 1024. */
  fftSize?: number;
  /** Smoothing assigned to an owned analyser. Default 0.8. */
  smoothingTimeConstant?: number;
  /** Gain applied to RMS and peak for the display values. Default 1.8. */
  levelScale?: number;
  /** Absolute peak-hold decay applied on every read. Default 0.012. */
  peakDecay?: number;
  /** Floor applied to {@link AnalyserMeter.readSpectrum}'s bar count; non-finite values use 1. */
  minimumBars?: number;
}

/**
 * Aggregate an FFT vector into a fixed number of normalized bars. Each bar is
 * the mean of its contiguous slice. When there are at least as many bins as
 * bars, the slices tile the input exactly. When there are fewer bins than
 * bars, bins are repeated to fill the requested display width.
 */
export function aggregateSpectrumBars(
  spectrum: ArrayLike<number>,
  options: SpectrumBarOptions = {},
): Float32Array {
  const minimum = positiveBarCount(options.minimumBars, 1);
  const barCount = Math.max(minimum, positiveBarCount(options.bars, 28));
  const result = new Float32Array(barCount);
  if (spectrum.length === 0) return result;
  const byteScale = options.normalizeBytes ?? true;
  for (let bar = 0; bar < barCount; bar += 1) {
    const start = Math.floor((bar * spectrum.length) / barCount);
    const end = Math.max(start + 1, Math.floor(((bar + 1) * spectrum.length) / barCount));
    let sum = 0;
    let count = 0;
    for (let index = start; index < end && index < spectrum.length; index += 1) {
      const raw = spectrum[index];
      sum += (Number.isFinite(raw) ? raw : 0) / (byteScale ? 255 : 1);
      count += 1;
    }
    result[bar] = clamp(count > 0 ? sum / count : 0, 0, 1);
  }
  return result;
}

/**
 * Live analyser meter.
 *
 * Supplying `context` creates an owned pass-through tap; supplying `analyser`
 * borrows that node. The two modes are mutually exclusive so resource
 * ownership is never ambiguous.
 */
export class AnalyserMeter {
  readonly #levelScale: number;
  readonly #peakDecay: number;
  readonly #minimumBars: number;
  #analyser?: AnalyserNode;
  #input?: GainNode;
  #output?: GainNode;
  #ownsGraph = false;
  #disposed = false;
  #timeBuffer?: Uint8Array<ArrayBuffer>;
  #frequencyBuffer?: Uint8Array<ArrayBuffer>;
  #peakHold = 0;

  constructor(options: AnalyserMeterOptions = {}) {
    if (options.context && options.analyser) {
      throw new TypeError('AnalyserMeter accepts either context or analyser, not both');
    }
    this.#levelScale = finiteNonNegative(options.levelScale, 1.8);
    this.#peakDecay = finiteNonNegative(options.peakDecay, 0.012);
    this.#minimumBars = positiveBarCount(options.minimumBars, 1);

    if (options.analyser) this.#analyser = options.analyser;
    else if (options.context) this.#buildOwnedGraph(options.context, options);
  }

  /** The owned or borrowed analyser currently read. */
  get analyser(): AnalyserNode | undefined {
    return this.#analyser;
  }

  /** Input of an owned tap; absent when borrowing an analyser. */
  get input(): AudioNode | undefined {
    return this.#input;
  }

  /** Output of an owned tap; absent when borrowing an analyser. */
  get output(): AudioNode | undefined {
    return this.#output;
  }

  /** Whether this meter created and owns its tap graph. */
  get ownsGraph(): boolean {
    return this.#ownsGraph;
  }

  /** Read one time-domain frame and derive its level, peak and peak hold. */
  readLevel(): AnalyserMeterFrame {
    const analyser = this.#assertReadable();
    const length = Math.max(1, analyser.fftSize);
    if (!this.#timeBuffer || this.#timeBuffer.length !== length) {
      this.#timeBuffer = new Uint8Array(new ArrayBuffer(length));
    }
    analyser.getByteTimeDomainData(this.#timeBuffer);

    let sumSquares = 0;
    let samplePeak = 0;
    for (let index = 0; index < length; index += 1) {
      const sample = ((this.#timeBuffer[index] ?? 128) - 128) / 128;
      sumSquares += sample * sample;
      samplePeak = Math.max(samplePeak, Math.abs(sample));
    }
    const rms = Math.sqrt(sumSquares / length);
    const level = clamp(rms * this.#levelScale, 0, 1);
    const peak = clamp(samplePeak * this.#levelScale, 0, 1);
    this.#peakHold = Math.max(level, this.#peakHold - this.#peakDecay);
    return {rms, level, peak, peakHold: this.#peakHold};
  }

  /** Read one frequency-domain frame, aggregated into normalized bars. */
  readSpectrum(bars = 28): Float32Array {
    const analyser = this.#assertReadable();
    const length = Math.max(1, analyser.frequencyBinCount);
    if (!this.#frequencyBuffer || this.#frequencyBuffer.length !== length) {
      this.#frequencyBuffer = new Uint8Array(new ArrayBuffer(length));
    }
    analyser.getByteFrequencyData(this.#frequencyBuffer);
    return aggregateSpectrumBars(this.#frequencyBuffer, {
      bars,
      minimumBars: this.#minimumBars,
      normalizeBytes: true,
    });
  }

  /**
   * Release an owned graph; a borrowed analyser is never disconnected. Every
   * owned node is attempted even when an earlier disconnect throws, and the
   * meter has reached its disposed state before the first error is rethrown.
   * Repeated calls are safe.
   */
  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    const analyser = this.#analyser;
    const input = this.#input;
    const output = this.#output;
    const ownsGraph = this.#ownsGraph;

    this.#analyser = undefined;
    this.#input = undefined;
    this.#output = undefined;
    this.#ownsGraph = false;
    this.#timeBuffer = undefined;
    this.#frequencyBuffer = undefined;
    this.#peakHold = 0;

    if (!ownsGraph) return;
    let failed = false;
    let firstError: unknown;
    for (const node of [input, analyser, output]) {
      try {
        node?.disconnect();
      } catch (error) {
        if (!failed) firstError = error;
        failed = true;
      }
    }
    if (failed) throw firstError;
  }

  #buildOwnedGraph(context: BaseAudioContext, options: AnalyserMeterOptions): void {
    let input: GainNode | undefined;
    let output: GainNode | undefined;
    let analyser: AnalyserNode | undefined;
    try {
      input = context.createGain();
      output = context.createGain();
      analyser = context.createAnalyser();
      analyser.fftSize = options.fftSize ?? 1024;
      analyser.smoothingTimeConstant = options.smoothingTimeConstant ?? 0.8;
      input.connect(analyser);
      analyser.connect(output);
    } catch (error) {
      for (const node of [input, analyser, output]) {
        try {
          node?.disconnect();
        } catch {
          // Preserve the construction failure after a best-effort rollback.
        }
      }
      throw error;
    }
    this.#input = input;
    this.#output = output;
    this.#analyser = analyser;
    this.#ownsGraph = true;
  }

  #assertReadable(): AnalyserNode {
    if (this.#disposed) throw new Error('AnalyserMeter has been disposed');
    if (!this.#analyser) throw new Error('AnalyserMeter has no analyser');
    return this.#analyser;
  }
}

/** Build an {@link AnalyserMeter} (the `createX` convention). */
export function createAnalyserMeter(options?: AnalyserMeterOptions): AnalyserMeter {
  return new AnalyserMeter(options);
}

function finiteNonNegative(value: number | undefined, fallback: number): number {
  return value === undefined || !Number.isFinite(value) ? fallback : Math.max(0, value);
}

function positiveBarCount(value: number | undefined, fallback: number): number {
  return Math.max(1, Math.floor(finiteNonNegative(value, fallback)));
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
