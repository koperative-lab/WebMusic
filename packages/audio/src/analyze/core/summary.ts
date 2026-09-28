// ============================================================================
// summarizeClip — a cheap, headless overview of an AudioClip (the digital-audio
// counterpart to WebScore's summarizeScore). Duration / sample rate / channels
// are read straight off the clip; integrated LUFS is computed only when the
// clip actually carries decoded samples (a streaming-only clip has none).
// ============================================================================

import type {AudioClip} from '../../core';
import {measureLoudness} from './loudness';

export interface ClipSummary {
  /** Length in seconds. */
  durationSeconds: number;
  /** Sample rate in Hz. */
  sampleRate: number;
  /** Channel count. */
  channels: number;
  /** Samples per channel. */
  length: number;
  /** File-tag title, if any. */
  title?: string;
  /** File-tag artist, if any. */
  artist?: string;
  /**
   * Integrated loudness in LUFS — present only when the clip carries decoded
   * samples (streaming-only clips return no samples to measure).
   */
  integratedLufs?: number;
}

/**
 * Summarize an {@link AudioClip}: duration, sample rate, channel count, file
 * metadata, and (when samples are present) integrated loudness.
 *
 * ```ts
 * const {durationSeconds, integratedLufs} = summarizeClip(clip);
 * ```
 */
export function summarizeClip(clip: AudioClip): ClipSummary {
  const summary: ClipSummary = {
    durationSeconds: clip.duration,
    sampleRate: clip.sampleRate,
    channels: clip.numberOfChannels,
    length: clip.length,
    title: clip.metadata.title,
    artist: clip.metadata.artist,
  };

  const channels = clip.channels();
  if (channels && channels.length > 0 && channels[0].length > 0) {
    summary.integratedLufs = measureLoudness(channels, clip.sampleRate).integratedLufs;
  }

  return summary;
}
