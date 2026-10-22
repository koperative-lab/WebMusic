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
// shapes, the bar aggregation re-exported under Audio's option names, the
// float-precision window reads the display types need, and the optional
// stereo side-branch (`analyser -> fan-out -> splitter -> two analysers`)
// that a stereometer or channel-summed loudness reading requires. That branch
// only ever ADDS an output edge to the analyser it reads from; it never
// disconnects a borrowed node's existing connections.
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

/** One left/right pair of float time-domain windows from the stereo branch. */
export interface AudioMeterStereoFrame {
  left: Float32Array;
  right: Float32Array;
}

/** Analyser frequency-grid facts a display needs to label its axis. */
export interface AudioMeterFrequencyInfo {
  sampleRate: number;
  frequencyBinCount: number;
  minDecibels: number;
  maxDecibels: number;
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
  #timeDomain?: Float32Array<ArrayBuffer>;
  #frequency?: Float32Array;
  #frequencyBytes?: Uint8Array<ArrayBuffer>;
  #frequencyDecibels?: Float32Array<ArrayBuffer>;
  #stereo?: {
    fanOut: GainNode;
    splitter: ChannelSplitterNode;
    left: AnalyserNode;
    right: AnalyserNode;
    leftFrame: Float32Array<ArrayBuffer>;
    rightFrame: Float32Array<ArrayBuffer>;
  };

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

  /** Sample rate of the active analyser's context, or `undefined` without one. */
  get sampleRate(): number | undefined {
    const rate = this.#meter.analyser?.context?.sampleRate;
    return typeof rate === 'number' && Number.isFinite(rate) && rate > 0 ? rate : undefined;
  }

  /** Axis facts of the active analyser, or `undefined` without one. */
  get frequencyInfo(): AudioMeterFrequencyInfo | undefined {
    const analyser = this.#meter.analyser;
    const sampleRate = this.sampleRate;
    if (!analyser || sampleRate === undefined) return undefined;
    return {
      sampleRate,
      frequencyBinCount: Math.max(1, analyser.frequencyBinCount),
      minDecibels: finiteOr(analyser.minDecibels, -100),
      maxDecibels: finiteOr(analyser.maxDecibels, -30),
    };
  }

  /** Whether the stereo side-branch is attached and readable. */
  get stereo(): boolean {
    return this.#stereo !== undefined;
  }

  /**
   * Update tuning in place. Omitted fields retain their values. Invalid owned
   * analyser settings leave the graph and previous tuning intact; fftSize and
   * smoothingTimeConstant are ignored when the analyser is borrowed.
   */
  configure(options: AudioMeterConfiguration = {}): void {
    this.#meter.configure(options);
    const stereo = this.#stereo;
    const analyser = this.#meter.analyser;
    if (stereo && analyser) {
      // Keep both channel windows the length of the summed window so a
      // left/right pair describes the same slice of time.
      for (const node of [stereo.left, stereo.right]) {
        if (node.fftSize !== analyser.fftSize) node.fftSize = analyser.fftSize;
      }
    }
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
   * Read the current float time-domain window (fftSize samples, -1..1). The
   * returned array is a scratch buffer reused by the next read; copy it to
   * retain it.
   */
  readTimeDomain(): Float32Array {
    const analyser = this.#assertAnalyser();
    const length = Math.max(1, analyser.fftSize);
    if (!this.#timeDomain || this.#timeDomain.length !== length) {
      this.#timeDomain = new Float32Array(new ArrayBuffer(length * 4));
    }
    analyser.getFloatTimeDomainData(this.#timeDomain);
    return this.#timeDomain;
  }

  /**
   * Read the current frequency frame normalized to 0..1 per bin, using the
   * analyser's own `minDecibels..maxDecibels` window exactly as its byte data
   * does. Scratch buffer; copy to retain.
   */
  readFrequency(): Float32Array {
    const analyser = this.#assertAnalyser();
    const bins = Math.max(1, analyser.frequencyBinCount);
    if (!this.#frequencyBytes || this.#frequencyBytes.length !== bins) {
      this.#frequencyBytes = new Uint8Array(new ArrayBuffer(bins));
    }
    if (!this.#frequency || this.#frequency.length !== bins) this.#frequency = new Float32Array(bins);
    analyser.getByteFrequencyData(this.#frequencyBytes);
    for (let index = 0; index < bins; index += 1) this.#frequency[index] = this.#frequencyBytes[index]! / 255;
    return this.#frequency;
  }

  /** Read the current frequency frame in decibels per bin. Scratch buffer; copy to retain. */
  readFrequencyDecibels(): Float32Array {
    const analyser = this.#assertAnalyser();
    const bins = Math.max(1, analyser.frequencyBinCount);
    if (!this.#frequencyDecibels || this.#frequencyDecibels.length !== bins) {
      this.#frequencyDecibels = new Float32Array(new ArrayBuffer(bins * 4));
    }
    analyser.getFloatFrequencyData(this.#frequencyDecibels);
    return this.#frequencyDecibels;
  }

  /**
   * Attach the stereo side-branch so {@link readStereo} can return separate
   * left/right windows. The branch is owned here even when the analyser is
   * borrowed: it adds one output edge (`analyser -> fan-out`) and is removed
   * with `analyser.disconnect(fanOut)`, which leaves every other connection
   * of a borrowed node untouched. A mono input is up-mixed to both channels
   * by the fan-out's speaker interpretation, so a mono source reads as a
   * centered signal rather than a hard-left one. Idempotent; returns whether
   * the branch exists afterwards.
   */
  attachStereo(): boolean {
    if (this.#stereo) return true;
    const analyser = this.#meter.analyser;
    const context = analyser?.context;
    if (!analyser || !context) return false;
    let fanOut: GainNode | undefined;
    let splitter: ChannelSplitterNode | undefined;
    let left: AnalyserNode | undefined;
    let right: AnalyserNode | undefined;
    try {
      fanOut = context.createGain();
      fanOut.channelCount = 2;
      fanOut.channelCountMode = 'explicit';
      fanOut.channelInterpretation = 'speakers';
      splitter = context.createChannelSplitter(2);
      left = context.createAnalyser();
      right = context.createAnalyser();
      for (const node of [left, right]) {
        node.fftSize = analyser.fftSize;
        node.smoothingTimeConstant = 0;
      }
      analyser.connect(fanOut);
      fanOut.connect(splitter);
      splitter.connect(left, 0);
      splitter.connect(right, 1);
    } catch (error) {
      try { if (fanOut) analyser.disconnect(fanOut); } catch { /* preserve the construction failure */ }
      for (const node of [fanOut, splitter, left, right]) {
        try { node?.disconnect(); } catch { /* preserve the construction failure */ }
      }
      throw error;
    }
    const length = Math.max(1, analyser.fftSize);
    this.#stereo = {
      fanOut, splitter, left, right,
      leftFrame: new Float32Array(new ArrayBuffer(length * 4)),
      rightFrame: new Float32Array(new ArrayBuffer(length * 4)),
    };
    return true;
  }

  /** Remove the stereo side-branch. The read analyser keeps every other connection. */
  releaseStereo(): void {
    const stereo = this.#stereo;
    if (!stereo) return;
    this.#stereo = undefined;
    let firstError: unknown;
    let failed = false;
    try {
      this.#meter.analyser?.disconnect(stereo.fanOut);
    } catch {
      // The edge is already gone (the caller detached its node first). The
      // branch is released either way; only failures on owned nodes surface.
    }
    for (const node of [stereo.fanOut, stereo.splitter, stereo.left, stereo.right]) {
      try {
        node.disconnect();
      } catch (error) {
        if (!failed) firstError = error;
        failed = true;
      }
    }
    if (failed) throw firstError;
  }

  /**
   * Read left and right float windows from the stereo branch, or `undefined`
   * when it is not attached. Scratch buffers; copy to retain.
   */
  readStereo(): AudioMeterStereoFrame | undefined {
    const stereo = this.#stereo;
    if (!stereo) return undefined;
    this.#assertAnalyser();
    const length = Math.max(1, stereo.left.fftSize);
    if (stereo.leftFrame.length !== length) {
      stereo.leftFrame = new Float32Array(new ArrayBuffer(length * 4));
      stereo.rightFrame = new Float32Array(new ArrayBuffer(length * 4));
    }
    stereo.left.getFloatTimeDomainData(stereo.leftFrame);
    stereo.right.getFloatTimeDomainData(stereo.rightFrame);
    return {left: stereo.leftFrame, right: stereo.rightFrame};
  }

  /**
   * Release an owned graph. Borrowed analysers are never disconnected.
   *
   * Every owned node is attempted even when an earlier disconnect throws; the
   * first error is rethrown only after the controller has reached a disposed
   * state. Repeated calls are safe.
   */
  dispose(): void {
    let firstError: unknown;
    let failed = false;
    try {
      this.releaseStereo();
    } catch (error) {
      firstError = error;
      failed = true;
    }
    this.#timeDomain = undefined;
    this.#frequency = undefined;
    this.#frequencyBytes = undefined;
    this.#frequencyDecibels = undefined;
    try {
      this.#meter.dispose();
    } catch (error) {
      if (!failed) firstError = error;
      failed = true;
    }
    if (failed) throw firstError;
  }

  #assertAnalyser(): AnalyserNode {
    const analyser = this.#meter.analyser;
    if (!analyser) throw new Error('AudioMeterController has no analyser');
    return analyser;
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

function finiteOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}
