import {audioEnvelopeGain, audioSegmentLength, retainAudioSequence, sameAudioFormat, audioSequenceAssetIds,
  type AudioAssetLease, type AudioAssetReader, type AudioSequence, type AudioSequenceSegment} from '../../core/sequence';
import type {AudioWaveformSource} from '../core/types';

export interface AudioSequenceWaveformOptions {
  /** Bounded extrema cache, shared across revisions. Default 16384 entries. */
  cacheEntries?: number;
  /** Bounded `readPeaks` results for the current root; one entry per painted column. Default 8192 entries. */
  rangeCacheEntries?: number;
}
export interface AudioSequenceWaveform extends AudioWaveformSource {
  readonly sequence: AudioSequence;
  /** Retain the new root before releasing the previous root; PCM is not copied. */
  setSequence(sequence: AudioSequence): void;
  dispose(): void;
}
type Peak = {min: number; max: number};
type Span = {start: number; end: number; segment: AudioSequenceSegment};

/**
 * Lazy dyadic extrema over immutable assets. Reads at most 256 source frames per
 * allocation; coarse bins reuse fine bins and retained coarse results. Editing
 * rebuilds only segment coordinates, not PCM or a full output peaks pyramid.
 * Envelopes conservatively bound extrema within each visible column. A zoomed-out
 * viewport can need more asset bins than the extrema cache holds, so repeated
 * paints of one root reuse frozen per-range results instead of rereading PCM.
 */
export function createAudioSequenceWaveform(initial: AudioSequence, assets: AudioAssetReader,
  options: AudioSequenceWaveformOptions = {}): AudioSequenceWaveform {
  const limit = options.cacheEntries ?? 16384, rangeLimit = options.rangeCacheEntries ?? 8192;
  if (!Number.isSafeInteger(limit) || limit < 1) throw new RangeError('cacheEntries must be a positive safe integer');
  if (!Number.isSafeInteger(rangeLimit) || rangeLimit < 1) throw new RangeError('rangeCacheEntries must be a positive safe integer');
  const cache = new Map<string, {asset: string; values: readonly Peak[]}>();
  const ranges = new Map<string, readonly Peak[]>();
  let sequence = initial;
  let lease: AudioAssetLease = retainAudioSequence(initial, assets);
  let spans = index(initial);
  let disposed = false;
  const zeros = (): Peak[] => Array.from({length: sequence.channelLayout.length}, () => ({min: 0, max: 0}));
  const blank = (): Peak[] => Array.from({length: sequence.channelLayout.length}, () => ({min: Infinity, max: -Infinity}));
  function merge(target: Peak[], values: readonly Peak[]): void {
    values.forEach((value, channel) => { target[channel].min = Math.min(target[channel].min, value.min); target[channel].max = Math.max(target[channel].max, value.max); });
  }
  function bin(asset: string, start: number, size: number): readonly Peak[] {
    const key = `${asset}:${start}:${size}`;
    const known = cache.get(key);
    if (known) { cache.delete(key); cache.set(key, known); return known.values; }
    const result = blank();
    if (size > 256) {
      merge(result, bin(asset, start, size / 2));
      merge(result, bin(asset, start + size / 2, size / 2));
    } else {
      const buffers = result.map(() => new Float32Array(size));
      assets.read(asset, start, buffers);
      buffers.forEach((buffer, channel) => {
        for (const value of buffer) {
          result[channel].min = Math.min(result[channel].min, value);
          result[channel].max = Math.max(result[channel].max, value);
        }
      });
    }
    cache.set(key, {asset, values: result});
    while (cache.size > limit) cache.delete(cache.keys().next().value!);
    return result;
  }
  function range(asset: string, start: number, end: number): readonly Peak[] {
    const result = blank();
    while (start < end) {
      let size = 1;
      while (size * 2 <= end - start && start % (size * 2) === 0) size *= 2;
      merge(result, bin(asset, start, size));
      start += size;
    }
    return result;
  }
  return {
    get sequence() { return sequence; },
    get sampleRate() { return sequence.sampleRate; },
    get channels() { return sequence.channelLayout.length; },
    get frameCount() { return sequence.length; },
    setSequence(next) {
      if (disposed) throw new Error('Waveform source is disposed');
      if (next === sequence) return;
      if (!sameAudioFormat(next, sequence)) throw new RangeError('Waveform format cannot change');
      const nextLease = retainAudioSequence(next, assets);
      const previous = lease;
      sequence = next; spans = index(next); lease = nextLease; ranges.clear();
      // A store may permit the same ID to be registered after all leases expire.
      // Never carry a cache entry beyond this source's lease for that asset.
      const retained = new Set(audioSequenceAssetIds(next));
      for (const [key, entry] of cache) if (!retained.has(entry.asset)) cache.delete(key);
      previous.release();
    },
    readPeaks(start, end) {
      if (disposed) throw new Error('Waveform source is disposed');
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || end > sequence.length) throw new RangeError('Invalid waveform frame range');
      if (start === end) return zeros();
      const key = `${start}:${end}`, known = ranges.get(key);
      if (known) { ranges.delete(key); ranges.set(key, known); return known; }
      const result = blank();
      let lo = 0, hi = spans.length;
      while (lo < hi) { const middle = Math.floor((lo + hi) / 2); if (spans[middle].end <= start) lo = middle + 1; else hi = middle; }
      for (let i = lo; i < spans.length && spans[i].start < end; i++) {
        const span = spans[i], segment = span.segment;
        if (segment.kind === 'silence') { merge(result, zeros()); continue; }
        const a = Math.max(start, span.start) - span.start, b = Math.min(end, span.end) - span.start;
        const values = range(segment.assetId, segment.sourceStart + a, segment.sourceStart + b);
        // Linear envelope gain is bounded by its endpoints and interior points;
        // find the interior run by binary search instead of scanning all points.
        const points = segment.envelope, first = audioEnvelopeGain(points, a), last = audioEnvelopeGain(points, b - 1);
        let low = Math.min(first, last), high = Math.max(first, last), p = 0, q = points.length;
        while (p < q) { const middle = (p + q) >>> 1; if (points[middle].frame <= a) p = middle + 1; else q = middle; }
        for (; p < points.length && points[p].frame < b; p++) { low = Math.min(low, points[p].gain); high = Math.max(high, points[p].gain); }
        const minGain = low * segment.gain, maxGain = high * segment.gain;
        merge(result, values.map((value) => ({min: Math.min(value.min * minGain, value.min * maxGain), max: Math.max(value.max * minGain, value.max * maxGain)})));
      }
      // Cached results are shared with every caller, so they are frozen.
      const frozen = Object.freeze(result.map((peak) => Object.freeze(peak)));
      ranges.set(key, frozen);
      while (ranges.size > rangeLimit) ranges.delete(ranges.keys().next().value!);
      return frozen;
    },
    dispose() { if (disposed) return; disposed = true; lease.release(); cache.clear(); ranges.clear(); spans = []; },
  };
}
function index(sequence: AudioSequence): Span[] {
  let offset = 0;
  return sequence.segments.map((segment) => { const start = offset; offset += audioSegmentLength(segment); return {start, end: offset, segment}; });
}
