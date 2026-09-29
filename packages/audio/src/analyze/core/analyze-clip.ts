// ============================================================================
// One-shot clip analysis shared by the stateless API and stateful headless
// sessions. This module owns no cache or runtime resource: callers provide a
// clip and options and receive a newly computed result.
// ============================================================================

import type { AudioClip } from "../../core";
import { computePeaks, type ComputePeaksOptions } from "./peaks";
import { measureLoudness } from "./loudness";
import { detectTempo, type TempoOptions } from "./tempo";
import { detectAudioKey } from "./key";
import { detectOnsets, type OnsetOptions } from "./onsets";
import { trackPitch, type PitchOptions } from "./pitch";
import { computeSpectrogram } from "./spectrogram";
import { extractFeatures, type ExtractFeaturesOptions } from "./features";
import type { AudioAnalysisResult, AudioAnalysisTask } from "./types";

export interface AudioAnalysisOptions {
  /** Which tasks to run. Default: peaks + loudness. */
  tasks?: readonly AudioAnalysisTask[];
  /** STFT window size for spectrogram/onset/key. Default 2048. */
  fftSize?: number;
  /** STFT hop size. Default `fftSize / 4`. */
  hopSize?: number;
  /** Override base samples-per-peak for the peaks pyramid. */
  peaks?: ComputePeaksOptions;
  /**
   * Tempo detector overrides — notably `engine`, which selects an optional
   * peer with a guarded fall-back to the bundled default. Without this field
   * the choice was unreachable from every layer above core.
   */
  tempo?: TempoOptions;
  /** Onset detector overrides. */
  onsets?: OnsetOptions;
  /** Pitch tracker overrides. */
  pitch?: PitchOptions;
  /** Feature extractor overrides + names. */
  features?: ExtractFeaturesOptions & { names?: readonly string[] };
}

const DEFAULT_TASKS: readonly AudioAnalysisTask[] = ["peaks", "loudness"];

/** Compute a complete result without retaining clip or analysis state. */
export async function analyzeAudioClip(
  clip: AudioClip,
  options: AudioAnalysisOptions = {},
): Promise<AudioAnalysisResult> {
  const channels = clip.channels();
  if (!channels || channels.length === 0) {
    throw new Error(
      "AudioAnalysisSession: clip has no decoded samples to analyze",
    );
  }
  const tasks = new Set(options.tasks ?? DEFAULT_TASKS);
  const sampleRate = clip.sampleRate;
  const mono = channels[0];
  const fftSize = options.fftSize ?? 2048;
  const hopSize = options.hopSize ?? fftSize / 4;

  const result: AudioAnalysisResult = {
    peaks: computePeaks(channels, sampleRate, options.peaks),
    loudness: measureLoudness(channels, sampleRate),
  };

  if (tasks.has("tempo"))
    result.tempo = await detectTempo(channels, sampleRate, options.tempo);
  if (tasks.has("key"))
    result.key = detectAudioKey(channels, sampleRate, { fftSize, hopSize });
  if (tasks.has("onsets")) {
    const onsetChannel = channels.length === 1 ? mono : new Float32Array(mono.length);
    if (channels.length > 1) {
      const gain = 1 / channels.length;
      for (const channel of channels) {
        for (let index = 0; index < onsetChannel.length; index++) {
          onsetChannel[index] += channel[index] * gain;
        }
      }
    }
    result.onsets = detectOnsets(onsetChannel, sampleRate, {
      fftSize,
      hopSize,
      ...options.onsets,
    });
  }
  if (tasks.has("pitch"))
    result.pitchTrack = await trackPitch(mono, sampleRate, options.pitch);
  if (tasks.has("spectrogram")) {
    result.spectrogram = computeSpectrogram(mono, sampleRate, {
      fftSize,
      hopSize,
    });
  }
  if (tasks.has("features")) {
    result.features = extractFeatures(
      mono,
      sampleRate,
      options.features?.names,
      options.features,
    );
  }
  return result;
}
