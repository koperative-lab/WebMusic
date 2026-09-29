// ============================================================================
// Ambient module declarations for direct dependencies that ship no TypeScript
// types. `fft.js` ships a (loose) `.d.ts`; `music-tempo` ships none, so we
// declare a minimal surface for the bits we use. Optional peer deps are NOT
// declared here — they are reached only through `await import('pkg')` inside
// try/catch, typed locally as `any`, so the build never needs their types.
// ============================================================================

declare module 'music-tempo' {
  /**
   * Offline BPM + beat-time extractor. Construct with a single channel of
   * 32-bit float PCM (mono mix-down) in [-1, 1]; reads `tempo` (BPM) and
   * `beats` (beat times in seconds) off the instance.
   */
  export default class MusicTempo {
    constructor(audioData: ArrayLike<number>, params?: Record<string, unknown>);
    /** Estimated tempo in beats per minute. */
    tempo: number;
    /** Beat times in seconds, ascending. */
    beats: number[];
    /** Time between successive beats (seconds). */
    tempoIntervals?: number[];
  }
}
