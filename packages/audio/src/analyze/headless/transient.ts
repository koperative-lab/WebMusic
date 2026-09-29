/** One approximate attack observation from successive analyser snapshots. */
export interface TransientObservation {
  strength: number;
  threshold: number;
  hit: boolean;
  intervalMs?: number;
}

export interface TransientInput {
  /** Monotonic sampling timestamp in milliseconds. */
  time: number;
  /** Linear RMS of the current time-domain window. */
  rms: number;
  /** Byte FFT bins from the same analyser. */
  frequencyData: Uint8Array;
}

export interface TransientDetector {
  observe(input: TransientInput, sensitivity?: number, minIntervalMs?: number): TransientObservation;
  reset(): void;
}

function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value));
}

/**
 * Streaming onset cue, not an offline beat detector. The borrowed analyser's
 * smoothing and polling interval limit how sharply an attack can be located.
 */
export function createTransientDetector(): TransientDetector {
  let previousBins: Uint8Array | undefined;
  let previousRms = 0;
  let previousStrength = 0;
  let lastHitAt: number | undefined;

  return {
    observe(input, sensitivity = 0.55, minIntervalMs = 160) {
      const bins = input.frequencyData;
      if (!Number.isFinite(input.time) || !Number.isFinite(input.rms) || input.rms < 0 || bins.length === 0) {
        throw new TypeError('Transient input needs a finite time, RMS and nonempty FFT frame');
      }
      if (!Number.isFinite(sensitivity) || !Number.isFinite(minIntervalMs)) {
        throw new TypeError('Transient sensitivity and minimum interval must be finite');
      }
      const threshold = 0.08 + (1 - clamp(sensitivity, 0, 1)) * 0.28;
      if (!previousBins || previousBins.length !== bins.length) {
        previousBins = bins.slice();
        previousRms = input.rms;
        previousStrength = 0;
        lastHitAt = undefined;
        return {strength: 0, threshold, hit: false};
      }

      let rise = 0;
      for (let index = 1; index < bins.length; index += 1) {
        rise += Math.max(0, bins[index]! - previousBins[index]!);
      }
      const flux = rise / ((bins.length - 1 || 1) * 255);
      const rmsRise = Math.max(0, input.rms - previousRms);
      const strength = input.rms < 0.005 ? 0 : clamp(flux * 7 + rmsRise * 3, 0, 1);
      const interval = lastHitAt === undefined ? undefined : input.time - lastHitAt;
      const hit = strength >= threshold && previousStrength < threshold &&
        (interval === undefined || interval >= clamp(minIntervalMs, 50, 1_000));

      previousBins = bins.slice();
      previousRms = input.rms;
      previousStrength = strength;
      if (hit) lastHitAt = input.time;
      return {strength, threshold, hit, ...(hit && interval !== undefined ? {intervalMs: interval} : {})};
    },
    reset() {
      previousBins = undefined;
      previousRms = 0;
      previousStrength = 0;
      lastHitAt = undefined;
    },
  };
}
