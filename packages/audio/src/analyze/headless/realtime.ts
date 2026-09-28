// ============================================================================
// createRealtimeAnalyzer — a main-thread, live frame analyzer driven by a Web
// Audio `AnalyserNode`. Unlike the offline analyzers this is inherently a
// browser/audio-graph thing (it polls an AnalyserNode on a timer), so it stays
// on the main thread and never goes through the worker.
//
// It is SSR-safe: constructing the analyzer touches no audio globals until
// `start()` is called, and `start()` is what attaches the AnalyserNode. The
// per-frame loop computes lightweight features itself (RMS, peak, spectral
// centroid) and can optionally run `pitchy` for a live fundamental.
// ============================================================================

/** A source the realtime analyzer can read: an AnalyserNode, or anything that exposes one. */
export interface RealtimeSource {
  /** Either an `AnalyserNode` directly, or an object with `.analyser`. */
  analyser?: AnalyserNode;
}

/** One frame of realtime measurements. */
export interface RealtimeFrame {
  /** `performance.now()`-style timestamp (ms) when the frame was sampled. */
  time: number;
  /** Linear RMS over the time-domain window, in [0, 1]. */
  rms: number;
  /** Absolute peak sample in the window, in [0, 1]. */
  peak: number;
  /** Spectral centroid in Hz (brightness). */
  centroid: number;
  /** Live fundamental in Hz (only when `pitch: true` and pitchy is available). */
  pitch?: number;
  /** Pitch clarity in [0, 1] (paired with `pitch`). */
  clarity?: number;
  /** Raw byte frequency data (0..255 per bin), if `includeSpectrum`. */
  frequencyData?: Uint8Array;
  /** Independent float time-domain window, if `includeTimeDomain`. */
  timeDomainData?: Float32Array;
}

export interface RealtimeAnalyzerOptions {
  /** Poll interval in ms. Default 50. */
  intervalMs?: number;
  /** Compute a live fundamental via pitchy (dynamically imported). Default false. */
  pitch?: boolean;
  /** Include the raw byte frequency spectrum on each frame. Default false. */
  includeSpectrum?: boolean;
  /** Include a copy of the float time-domain window on each frame. Default false. */
  includeTimeDomain?: boolean;
  /** AnalyserNode FFT size when we create one. Default 2048. */
  fftSize?: number;
}

export interface RealtimeAnalyzer {
  /** Begin polling; the callback fires once per interval with a {@link RealtimeFrame}. */
  start(onFrame: (frame: RealtimeFrame) => void): void;
  /** Stop polling. Idempotent. */
  stop(): void;
  /** Whether polling is currently active. */
  readonly running: boolean;
}

/** Resolve an `AnalyserNode` from the supplied source. */
function resolveAnalyser(source: AnalyserNode | RealtimeSource): AnalyserNode | null {
  if (!source) return null;
  if (typeof (source as AnalyserNode).getFloatTimeDomainData === 'function') {
    return source as AnalyserNode;
  }
  const analyser = (source as RealtimeSource).analyser;
  return analyser ?? null;
}

/**
 * Create a live, main-thread analyzer over an `AnalyserNode` (or any source
 * exposing one, e.g. an `AudioClipPlayer`).
 *
 * ```ts
 * const live = createRealtimeAnalyzer(player, {intervalMs: 50, pitch: true});
 * live.start((frame) => meter.update(frame.rms));
 * // ...later
 * live.stop();
 * ```
 *
 * The returned object can be constructed during SSR (it does nothing until
 * `start()` runs), but `start()` requires a real browser audio graph.
 */
export function createRealtimeAnalyzer(
  source: AnalyserNode | RealtimeSource,
  options: RealtimeAnalyzerOptions = {},
): RealtimeAnalyzer {
  const intervalMs = Math.max(1, Math.floor(options.intervalMs ?? 50));
  const wantPitch = options.pitch ?? false;
  const includeSpectrum = options.includeSpectrum ?? false;
  const includeTimeDomain = options.includeTimeDomain ?? false;

  let timer: ReturnType<typeof setInterval> | null = null;
  let running = false;
  // Lazily-built buffers + optional pitch detector (sized to the analyser).
  // Typed over a concrete ArrayBuffer so they satisfy the Web Audio API's
  // `Float32Array<ArrayBuffer>` / `Uint8Array<ArrayBuffer>` signatures.
  let timeData: Float32Array<ArrayBuffer> | null = null;
  let freqData: Uint8Array<ArrayBuffer> | null = null;
  let pitchDetector: {findPitch(input: ArrayLike<number>, sr: number): [number, number]} | null = null;

  async function maybeLoadPitch(size: number): Promise<void> {
    if (!wantPitch || pitchDetector) return;
    try {
      const {PitchDetector} = await import('pitchy');
      pitchDetector = PitchDetector.forFloat32Array(size);
    } catch {
      pitchDetector = null; // pitchy unavailable — frames simply omit pitch
    }
  }

  function readFrame(analyser: AnalyserNode): RealtimeFrame {
    const size = analyser.fftSize;
    if (!timeData || timeData.length !== size) timeData = new Float32Array(size);
    analyser.getFloatTimeDomainData(timeData);

    let sumSquares = 0;
    let peak = 0;
    for (let i = 0; i < size; i++) {
      const s = timeData[i];
      sumSquares += s * s;
      const a = s < 0 ? -s : s;
      if (a > peak) peak = a;
    }
    const rms = Math.sqrt(sumSquares / size);

    const bins = analyser.frequencyBinCount;
    if (!freqData || freqData.length !== bins) freqData = new Uint8Array(bins);
    analyser.getByteFrequencyData(freqData);
    const sampleRate = analyser.context.sampleRate;
    const binHz = sampleRate / 2 / bins;
    let weighted = 0;
    let total = 0;
    for (let b = 0; b < bins; b++) {
      const mag = freqData[b];
      weighted += mag * b * binHz;
      total += mag;
    }
    const centroid = total > 0 ? weighted / total : 0;

    const frame: RealtimeFrame = {time: now(), rms, peak, centroid};
    if (pitchDetector) {
      const [pitch, clarity] = pitchDetector.findPitch(timeData, sampleRate);
      frame.pitch = pitch;
      frame.clarity = clarity;
    }
    if (includeSpectrum) frame.frequencyData = freqData.slice();
    if (includeTimeDomain) frame.timeDomainData = timeData.slice();
    return frame;
  }

  return {
    start(onFrame: (frame: RealtimeFrame) => void): void {
      if (running) return;
      const analyser = resolveAnalyser(source);
      if (!analyser) throw new Error('createRealtimeAnalyzer: no AnalyserNode available on the source');
      if (options.fftSize && analyser.fftSize !== options.fftSize) {
        analyser.fftSize = options.fftSize;
      }
      running = true;
      void maybeLoadPitch(analyser.fftSize);
      timer = setInterval(() => {
        try {
          onFrame(readFrame(analyser));
        } catch {
          // Swallow per-frame read errors (e.g. context closed mid-flight).
        }
      }, intervalMs);
    },
    stop(): void {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
      running = false;
    },
    get running(): boolean {
      return running;
    },
  };
}

/** Monotonic-ish timestamp, falling back to Date.now when performance is absent. */
function now(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}
