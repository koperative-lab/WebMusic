import type {AudioClip, AudioPeaks, PeaksLevel} from '../../core';

/** Total clip seconds represented by the finest level of a peaks pyramid. */
export function peaksDuration(peaks: AudioPeaks): number {
  const level = peaks.levels[0];
  if (!level || !(peaks.sampleRate > 0)) return 0;
  return (peakCount(level, peaks.channels) * level.samplesPerPeak) / peaks.sampleRate;
}

/**
 * Build the compact min/max pyramid consumed by audio view models.
 *
 * This lives in Headless rather than the Element layer so every surface that
 * accepts an `AudioClip` shares one domain implementation without acquiring a
 * DOM or depending on the Analyze capability.
 */
export function computeClipPeaks(
  clip: AudioClip,
  samplesPerPeak = 256,
): AudioPeaks | undefined {
  const channels = clip.channels();
  if (!channels || channels.length === 0) return undefined;

  const baseSamplesPerPeak = Math.max(1, Math.floor(samplesPerPeak));
  const levels: PeaksLevel[] = [buildBaseLevel(channels, baseSamplesPerPeak)];
  while (peakCount(levels[levels.length - 1]!, channels.length) > 1) {
    levels.push(reduceLevel(levels[levels.length - 1]!, channels.length));
  }

  return {
    sampleRate: clip.sampleRate,
    channels: channels.length,
    baseSamplesPerPeak,
    levels,
  };
}

function buildBaseLevel(channels: Float32Array[], samplesPerPeak: number): PeaksLevel {
  const channelCount = channels.length;
  const length = channels[0]?.length ?? 0;
  const count = Math.ceil(length / samplesPerPeak);
  const data = new Int8Array(count * channelCount * 2);

  for (let peak = 0; peak < count; peak += 1) {
    const start = peak * samplesPerPeak;
    const end = Math.min(length, start + samplesPerPeak);
    for (let channel = 0; channel < channelCount; channel += 1) {
      let min = Infinity;
      let max = -Infinity;
      const samples = channels[channel]!;
      for (let index = start; index < end; index += 1) {
        const sample = samples[index]!;
        if (sample < min) min = sample;
        if (sample > max) max = sample;
      }
      const offset = (peak * channelCount + channel) * 2;
      data[offset] = quantize(min === Infinity ? 0 : min);
      data[offset + 1] = quantize(max === -Infinity ? 0 : max);
    }
  }

  return {samplesPerPeak, data};
}

function reduceLevel(level: PeaksLevel, channelCount: number): PeaksLevel {
  const inputCount = peakCount(level, channelCount);
  const outputCount = Math.ceil(inputCount / 2);
  const data = new Int8Array(outputCount * channelCount * 2);

  for (let peak = 0; peak < outputCount; peak += 1) {
    const first = peak * 2;
    const second = first + 1;
    for (let channel = 0; channel < channelCount; channel += 1) {
      const firstOffset = (first * channelCount + channel) * 2;
      let min = level.data[firstOffset]!;
      let max = level.data[firstOffset + 1]!;
      if (second < inputCount) {
        const secondOffset = (second * channelCount + channel) * 2;
        min = Math.min(min, level.data[secondOffset]!);
        max = Math.max(max, level.data[secondOffset + 1]!);
      }
      const outputOffset = (peak * channelCount + channel) * 2;
      data[outputOffset] = min;
      data[outputOffset + 1] = max;
    }
  }

  return {samplesPerPeak: level.samplesPerPeak * 2, data};
}

function peakCount(level: PeaksLevel, channelCount: number): number {
  return Math.floor(level.data.length / Math.max(1, channelCount * 2));
}

function quantize(sample: number): number {
  const value = Math.round(sample * 128);
  return Math.max(-128, Math.min(127, value));
}
