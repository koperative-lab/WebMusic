import {AudioTimeline, type AudioTimelineOptions} from './timeline';
import type {SpectrogramData} from '../core/types';

export interface SpectrogramViewModelOptions
  extends Omit<AudioTimelineOptions, 'durationSeconds'> {
  durationSeconds?: number;
  minFrequency?: number;
  maxFrequency?: number;
}

export interface SpectrogramFrameView {
  frameIndex: number;
  seconds: number;
  frequencies: ArrayLike<number>;
  magnitudes: Float32Array;
}

/** Selects time/frequency data for the current viewport without painting it. */
export class SpectrogramViewModel {
  readonly timeline: AudioTimeline;
  readonly #data: SpectrogramData;
  readonly #firstBin: number;
  readonly #lastBin: number;

  constructor(data: SpectrogramData, options: SpectrogramViewModelOptions = {}) {
    this.#data = data;
    const duration = options.durationSeconds ?? inferredDuration(data.times);
    this.timeline = new AudioTimeline({...options, durationSeconds: duration});
    this.#firstBin = lowerBound(data.frequencies, options.minFrequency ?? Number.NEGATIVE_INFINITY);
    this.#lastBin = lowerBound(data.frequencies, options.maxFrequency ?? Number.POSITIVE_INFINITY, true);
  }

  frames(bufferScreens: number = 0): readonly SpectrogramFrameView[] {
    const {startSeconds, endSeconds} = this.timeline.visibleRange(bufferScreens);
    const firstFrame = lowerBound(this.#data.times, startSeconds);
    const lastFrame = lowerBound(this.#data.times, endSeconds, true);
    const frequencies = sliceArrayLike(this.#data.frequencies, this.#firstBin, this.#lastBin);
    const result: SpectrogramFrameView[] = [];
    for (let frameIndex = firstFrame; frameIndex < lastFrame; frameIndex += 1) {
      const base = frameIndex * this.#data.binsPerFrame;
      result.push({
        frameIndex,
        seconds: this.#data.times[frameIndex] ?? 0,
        frequencies,
        magnitudes: this.#data.magnitudes.subarray(base + this.#firstBin, base + this.#lastBin),
      });
    }
    return result;
  }
}

export function createSpectrogramViewModel(
  data: SpectrogramData,
  options?: SpectrogramViewModelOptions,
): SpectrogramViewModel {
  return new SpectrogramViewModel(data, options);
}

function inferredDuration(times: ArrayLike<number>): number {
  const count = times.length;
  if (count === 0) return 0;
  if (count === 1) return Math.max(0, times[0] ?? 0);
  const last = times[count - 1] ?? 0;
  const previous = times[count - 2] ?? last;
  return Math.max(0, last + Math.max(0, last - previous));
}

function lowerBound(values: ArrayLike<number>, target: number, upper = false): number {
  let lo = 0;
  let hi = values.length;
  while (lo < hi) {
    const mid = lo + Math.floor((hi - lo) / 2);
    const value = values[mid] ?? 0;
    if (value < target || (upper && value === target)) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function sliceArrayLike(values: ArrayLike<number>, start: number, end: number): ArrayLike<number> {
  if (values instanceof Float32Array) return values.subarray(start, end);
  return Array.prototype.slice.call(values, start, end) as number[];
}
