import {peakCount, peaksLevelForResolution, readPeak, type AudioPeaks, type Region} from '../../core';
import {AudioTimeline, type AudioTimelineOptions} from './timeline';
import {peaksDuration} from './peaks';
import type {AudioWaveformSource} from '../core/types';

export interface WaveformViewModelOptions
  extends Omit<AudioTimelineOptions, 'durationSeconds'> {
  durationSeconds?: number;
  /** Fold all channels into one column. Default false (one peak per channel). */
  mergeChannels?: boolean;
}

export interface WaveformChannelPeak {
  min: number;
  max: number;
}

export interface WaveformColumn {
  /** Absolute timeline pixel occupied by this column. */
  x: number;
  seconds: number;
  peaks: readonly WaveformChannelPeak[];
  region?: Region;
}

/** Calculates visible min/max columns without choosing a drawing technology. */
export class WaveformViewModel {
  readonly timeline: AudioTimeline;
  readonly #peaks: AudioPeaks | AudioWaveformSource;
  readonly #mergeChannels: boolean;

  constructor(peaks: AudioPeaks | AudioWaveformSource, options: WaveformViewModelOptions = {}) {
    this.#peaks = peaks;
    this.#mergeChannels = options.mergeChannels ?? false;
    this.timeline = new AudioTimeline({
      ...options,
      durationSeconds: options.durationSeconds ?? ('readPeaks' in peaks ? peaks.frameCount / peaks.sampleRate : peaksDuration(peaks)),
    });
  }

  /** Build one data column per visible timeline pixel. */
  columns(bufferScreens: number = 0): readonly WaveformColumn[] {
    const state = this.timeline.snapshot;
    const visible = this.timeline.visibleRange(bufferScreens);
    if (state.viewportWidth <= 0 || visible.endSeconds <= visible.startSeconds) return [];

    const samplesPerPixel = this.#peaks.sampleRate / state.pixelsPerSecond;
    const source = 'readPeaks' in this.#peaks ? this.#peaks : undefined;
    const level = 'levels' in this.#peaks ? peaksLevelForResolution(this.#peaks, samplesPerPixel) : undefined;
    const count = level ? peakCount(level, this.#peaks.channels) : source!.frameCount;
    const startX = Math.floor(visible.startSeconds * state.pixelsPerSecond);
    const endX = Math.ceil(visible.endSeconds * state.pixelsPerSecond);
    const result: WaveformColumn[] = [];

    for (let x = startX; x < endX; x += 1) {
      const seconds = x / state.pixelsPerSecond;
      const firstSample = x * samplesPerPixel;
      const lastSample = (x + 1) * samplesPerPixel;
      if (source) {
        const channelPeaks = source.readPeaks(Math.max(0, Math.floor(firstSample)), Math.min(source.frameCount, Math.ceil(lastSample)));
        const peaks = this.#mergeChannels ? [mergePeaks(channelPeaks)] : channelPeaks;
        const region = this.timeline.hitTest(x - state.offsetPixels).region;
        result.push(region ? {x, seconds, peaks, region} : {x, seconds, peaks});
        continue;
      }
      const firstPeak = Math.max(0, Math.floor(firstSample / level!.samplesPerPeak));
      const lastPeak = Math.min(count - 1, Math.max(firstPeak, Math.ceil(lastSample / level!.samplesPerPeak) - 1));
      if (firstPeak >= count || count === 0) continue;
      const channelPeaks: WaveformChannelPeak[] = [];
      for (let channel = 0; channel < this.#peaks.channels; channel += 1) {
        let min = Number.POSITIVE_INFINITY;
        let max = Number.NEGATIVE_INFINITY;
        for (let peakIndex = firstPeak; peakIndex <= lastPeak; peakIndex += 1) {
          const peak = readPeak(level!, this.#peaks.channels, channel, peakIndex);
          if (peak.min < min) min = peak.min;
          if (peak.max > max) max = peak.max;
        }
        channelPeaks.push({
          min: Number.isFinite(min) ? min : 0,
          max: Number.isFinite(max) ? max : 0,
        });
      }
      const peaks = this.#mergeChannels ? [mergePeaks(channelPeaks)] : channelPeaks;
      const region = this.timeline.hitTest(x - state.offsetPixels).region;
      result.push(region ? {x, seconds, peaks, region} : {x, seconds, peaks});
    }
    return result;
  }
}

export function createWaveformViewModel(
  peaks: AudioPeaks | AudioWaveformSource,
  options?: WaveformViewModelOptions,
): WaveformViewModel {
  return new WaveformViewModel(peaks, options);
}

/**
 * Resolve a whole peaks pyramid into one merged min/max column per CSS pixel.
 * This provides fit-to-box geometry for compact waveform previews.
 */
export function fitWaveformColumns(
  peaks: AudioPeaks,
  width: number,
): readonly WaveformColumn[] {
  const viewportWidth = Math.max(1, Math.round(Number.isFinite(width) ? width : 1));
  const durationSeconds = peaksDuration(peaks);
  if (!(durationSeconds > 0)) return [];
  return new WaveformViewModel(peaks, {
    durationSeconds,
    pixelsPerSecond: viewportWidth / durationSeconds,
    viewportWidth,
    mergeChannels: true,
  }).columns();
}

function mergePeaks(peaks: readonly WaveformChannelPeak[]): WaveformChannelPeak {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const peak of peaks) {
    if (peak.min < min) min = peak.min;
    if (peak.max > max) max = peak.max;
  }
  return {
    min: Number.isFinite(min) ? min : 0,
    max: Number.isFinite(max) ? max : 0,
  };
}
