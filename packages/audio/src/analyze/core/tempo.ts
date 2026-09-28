// ============================================================================
// detectTempo — BPM + BeatGrid estimation.
//
// Default engine: `music-tempo` (offline; returns BPM and beat times), wrapped
// into a core `BeatGrid`. Advanced engines ('essentia' / 'aubio' / 'realtime')
// dynamically import their optional peer dependency, guarded so the build and
// typecheck pass without them installed (they fall back to the default engine
// with a console warning if the peer is missing).
// ============================================================================

import {BeatGrid} from '../../core';
import MusicTempo from 'music-tempo';
import type {TempoResult} from './types';

export type TempoEngine = 'music-tempo' | 'essentia' | 'aubio' | 'realtime';

export interface TempoOptions {
  engine?: TempoEngine;
  sampleRate?: number;
}

/** Accept a multi-channel clip, an array of channels, or one channel. */
type TempoInput = Float32Array | Float32Array[];

function monoMix(input: TempoInput): Float32Array {
  if (input instanceof Float32Array) return input;
  if (input.length === 1) return input[0];
  const length = input[0].length;
  const out = new Float32Array(length);
  for (let c = 0; c < input.length; c++) {
    const ch = input[c];
    for (let i = 0; i < length; i++) out[i] += ch[i];
  }
  const inv = 1 / input.length;
  for (let i = 0; i < length; i++) out[i] *= inv;
  return out;
}

/** Confidence from the regularity of the detected beat intervals (0..1). */
function beatRegularity(beats: number[]): number {
  if (beats.length < 3) return beats.length >= 2 ? 0.5 : 0;
  let mean = 0;
  for (let i = 1; i < beats.length; i++) mean += beats[i] - beats[i - 1];
  mean /= beats.length - 1;
  if (mean <= 0) return 0;
  let variance = 0;
  for (let i = 1; i < beats.length; i++) {
    const d = beats[i] - beats[i - 1] - mean;
    variance += d * d;
  }
  variance /= beats.length - 1;
  const cv = Math.sqrt(variance) / mean; // coefficient of variation
  return Math.max(0, Math.min(1, 1 - cv));
}

function gridFromBeats(bpm: number, beats: number[], durationSeconds: number): TempoResult {
  let grid: BeatGrid;
  if (beats.length > 0) {
    grid = new BeatGrid({bpm, beats});
  } else {
    grid = BeatGrid.fromTempo(bpm > 0 ? bpm : 120, durationSeconds);
  }
  return {bpm, confidence: beatRegularity(beats), grid};
}

/**
 * Estimate tempo + beat grid of audio.
 *
 * ```ts
 * const {bpm, confidence, grid} = detectTempo(clip.channels()!, clip.sampleRate);
 * ```
 */
export async function detectTempo(
  input: TempoInput,
  sampleRate: number,
  options: TempoOptions = {},
): Promise<TempoResult> {
  const engine = options.engine ?? 'music-tempo';
  const mono = monoMix(input);
  const durationSeconds = mono.length / sampleRate;

  if (engine !== 'music-tempo') {
    const advanced = await tryAdvancedEngine(engine, mono, sampleRate, durationSeconds);
    if (advanced) return advanced;
    // Peer missing → fall through to the default engine.
  }

  // music-tempo wants a plain array of mono float samples. It throws on signals
  // with no detectable onsets (e.g. pure silence: "Fail to find peaks"); in that
  // case fall back to a synthetic 120-BPM grid so the API never rejects.
  try {
    const mt = new MusicTempo(mono as unknown as ArrayLike<number>);
    const bpm = Number.isFinite(mt.tempo) ? mt.tempo : 120;
    const beats = Array.isArray(mt.beats) ? mt.beats : [];
    return gridFromBeats(bpm, beats, durationSeconds);
  } catch {
    return {bpm: 120, confidence: 0, grid: BeatGrid.fromTempo(120, durationSeconds)};
  }
}

/**
 * Best-effort advanced engine via an optional peer. Returns null when the peer
 * is not installed (or fails), so the caller can fall back. Typed loosely
 * (`any`) so the build never needs the peer's types.
 */
async function tryAdvancedEngine(
  engine: TempoEngine,
  mono: Float32Array,
  sampleRate: number,
  durationSeconds: number,
): Promise<TempoResult | null> {
  try {
    if (engine === 'essentia') {
      const mod: any = await import('essentia.js' as string);
      const EssentiaCtor = mod.Essentia ?? mod.default?.Essentia ?? mod.default;
      const wasm = mod.EssentiaWASM ?? mod.default?.EssentiaWASM;
      const essentia = new EssentiaCtor(wasm);
      const vector = essentia.arrayToVector(mono);
      const out = essentia.RhythmExtractor2013
        ? essentia.RhythmExtractor2013(vector)
        : essentia.PercivalBpmEstimator(vector);
      const bpm: number = out.bpm ?? out.value ?? 120;
      const beats: number[] = out.ticks ? essentia.vectorToArray(out.ticks) : [];
      return gridFromBeats(bpm, Array.from(beats), durationSeconds);
    }
    if (engine === 'aubio') {
      const mod: any = await import('aubiojs' as string);
      const aubio = await (mod.default ?? mod)();
      const bufSize = 1024;
      const hop = 512;
      const tempo = new aubio.Tempo(bufSize, hop, sampleRate);
      const beats: number[] = [];
      for (let i = 0; i + hop <= mono.length; i += hop) {
        const frame = mono.subarray(i, i + hop);
        if (tempo.do(frame)) beats.push(tempo.getLastMs() / 1000);
      }
      const bpm: number = tempo.getBpm ? tempo.getBpm() : 120;
      return gridFromBeats(bpm, beats, durationSeconds);
    }
    if (engine === 'realtime') {
      // realtime-bpm-analyzer is an AudioWorklet-based online analyzer; there
      // is no offline buffer API, so we cannot run it headless here. Signal a
      // graceful fallback to the offline default engine.
      return null;
    }
  } catch (error) {
    console.warn(`[WebAudio] tempo engine "${engine}" unavailable, falling back to music-tempo`, error);
  }
  return null;
}
