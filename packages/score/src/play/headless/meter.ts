// ============================================================================
// Score's level meter: a thin adapter over the kernel's shared analyser
// metering. The tap graph and the RMS / peak-hold / spectrum arithmetic used
// to live here as a second copy of audio's, and the two had drifted; the
// mechanism now lives in `@webmusic/kernel/meter` and this module keeps only
// what is Score's own editorial choice — the published frame shape, the
// four-bar spectrum floor, and a dispose that finishes silently.
// ============================================================================

import {AnalyserMeter} from '@webmusic/kernel/meter';

/** DOM-free meter frame consumed by any UI. */
export interface LevelMeterFrame {
  level: number;
  peak: number;
  peakHold: number;
}

export interface LevelMeterControllerOptions {
  context?: BaseAudioContext;
  analyser?: AnalyserNode;
  fftSize?: number;
  smoothingTimeConstant?: number;
}

/** Owns an optional pass-through analyser graph, but never owns the context. */
export class LevelMeterController {
  readonly #meter: AnalyserMeter;

  constructor(options: LevelMeterControllerOptions = {}) {
    if (options.context && options.analyser) throw new TypeError("Provide context or analyser, not both");
    this.#meter = new AnalyserMeter({
      ...(options.context ? {context: options.context} : {}),
      ...(options.analyser ? {analyser: options.analyser} : {}),
      ...(options.fftSize === undefined ? {} : {fftSize: options.fftSize}),
      ...(options.smoothingTimeConstant === undefined
        ? {}
        : {smoothingTimeConstant: options.smoothingTimeConstant}),
      // Score's meters have always rendered at least four bars.
      minimumBars: 4,
    });
  }

  get analyser(): AnalyserNode | undefined { return this.#meter.analyser; }
  get input(): AudioNode | undefined { return this.#meter.input; }
  get output(): AudioNode | undefined { return this.#meter.output; }

  readLevel(): LevelMeterFrame {
    const {level, peak, peakHold} = this.#meter.readLevel();
    return {level, peak, peakHold};
  }

  readSpectrum(bars = 28): Float32Array {
    return this.#meter.readSpectrum(bars);
  }

  dispose(): void {
    try {
      this.#meter.dispose();
    } catch {
      // Score's meter has always finished owned cleanup silently; a failing
      // disconnect must not escape an element's disconnect path.
    }
  }
}

export function createLevelMeterController(options: LevelMeterControllerOptions = {}): LevelMeterController {
  return new LevelMeterController(options);
}
