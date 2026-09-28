// ============================================================================
// Synthetic test signals: sine, click-train, white noise, silence, arpeggio.
// Used across the analyze tests so every assertion is over a known input.
// ============================================================================

/** Deterministic mulberry32 PRNG so noise-based failures are reproducible. */
export function rng(seed: number): () => number {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A pure sine wave. */
export function sine(freq: number, seconds: number, sampleRate = 44100, amplitude = 1): Float32Array {
  const n = Math.round(seconds * sampleRate);
  const out = new Float32Array(n);
  const w = (2 * Math.PI * freq) / sampleRate;
  for (let i = 0; i < n; i++) out[i] = amplitude * Math.sin(w * i);
  return out;
}

/** Digital silence. */
export function silence(seconds: number, sampleRate = 44100): Float32Array {
  return new Float32Array(Math.round(seconds * sampleRate));
}

/** White noise in [-amplitude, amplitude]. */
export function whiteNoise(seconds: number, sampleRate = 44100, amplitude = 1, seed = 1): Float32Array {
  const n = Math.round(seconds * sampleRate);
  const out = new Float32Array(n);
  const rand = rng(seed);
  for (let i = 0; i < n; i++) out[i] = (rand() * 2 - 1) * amplitude;
  return out;
}

/**
 * A click train at a given BPM: short decaying impulses spaced one beat apart.
 * The default 120 BPM = a click every 0.5 s.
 */
export function clickTrain(bpm: number, seconds: number, sampleRate = 44100): Float32Array {
  const n = Math.round(seconds * sampleRate);
  const out = new Float32Array(n);
  const beatSamples = Math.round((60 / bpm) * sampleRate);
  const clickLen = Math.round(0.005 * sampleRate); // 5 ms exponential click
  for (let start = 0; start < n; start += beatSamples) {
    for (let i = 0; i < clickLen && start + i < n; i++) {
      out[start + i] = Math.exp(-i / (clickLen / 4)) * (1 - (2 * i) / clickLen);
    }
  }
  return out;
}

/** Equal-temperament frequency of a MIDI note. */
export function midiToHz(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/**
 * A C-major arpeggio (C-E-G-C) of sustained sine tones, one tone per quarter of
 * the duration. Strongly biases the chromagram toward C major.
 */
export function cMajorArpeggio(seconds: number, sampleRate = 44100): Float32Array {
  // C4=60, E4=64, G4=67, C5=72.
  const midis = [60, 64, 67, 72];
  const n = Math.round(seconds * sampleRate);
  const out = new Float32Array(n);
  const per = Math.floor(n / midis.length);
  for (let k = 0; k < midis.length; k++) {
    const w = (2 * Math.PI * midiToHz(midis[k])) / sampleRate;
    const start = k * per;
    const end = k === midis.length - 1 ? n : start + per;
    for (let i = start; i < end; i++) out[i] = 0.8 * Math.sin(w * (i - start));
  }
  return out;
}
