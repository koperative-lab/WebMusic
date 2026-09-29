import {invariant} from '../utils/invariants';
import {BeatGrid} from '../time/BeatGrid';
import {AudioClip, createAudioClipFromOwnedChannels} from './AudioClip';
import {Region} from './Region';

/**
 * Serializable description of one edit. The ordered list is the input to
 * incremental re-analysis (@webmusic/audio/analyze) and to the worker sync protocol,
 * mirroring how WebScore's ScoreEditSession buffers operations.
 */
export type ClipEditDescriptor =
  | {op: 'cut'; startSeconds: number; endSeconds: number}
  | {op: 'gain'; factor: number; startSeconds?: number; endSeconds?: number}
  | {op: 'fade'; direction: 'in' | 'out'; seconds: number; curve?: 'linear' | 'exp'}
  | {op: 'normalize'; targetPeak: number}
  | {op: 'reverse'}
  | {op: 'insertSilence'; atSeconds: number; seconds: number};

/**
 * Buffer a chain of non-destructive edits on a clip, then `apply()` them in
 * order to produce a new immutable {@link AudioClip}. Chainable.
 *
 * ```ts
 * const out = createClipEditSession(clip)
 *   .cut(3, 5)
 *   .fadeOut(2)
 *   .normalize(0.98)
 *   .apply();
 * ```
 */
export class ClipEditSession {
  private readonly ops: ClipEditDescriptor[] = [];

  constructor(private readonly base: AudioClip) {
    invariant(base.hasSamples, 'ClipEditSession requires a clip with decoded samples');
  }

  /** The ops buffered so far (serializable). */
  get edits(): readonly ClipEditDescriptor[] {
    return this.ops;
  }

  cut(startSeconds: number, endSeconds: number): this {
    finite('cut startSeconds', startSeconds);
    finite('cut endSeconds', endSeconds);
    invariant(endSeconds >= startSeconds, 'cut endSeconds must be >= startSeconds');
    this.ops.push({op: 'cut', startSeconds, endSeconds});
    return this;
  }

  gain(factor: number, startSeconds?: number, endSeconds?: number): this {
    finite('gain factor', factor);
    if (startSeconds !== undefined) finite('gain startSeconds', startSeconds);
    if (endSeconds !== undefined) finite('gain endSeconds', endSeconds);
    if (startSeconds !== undefined && endSeconds !== undefined) {
      invariant(endSeconds >= startSeconds, 'gain endSeconds must be >= startSeconds');
    }
    this.ops.push({op: 'gain', factor, startSeconds, endSeconds});
    return this;
  }

  fadeIn(seconds: number, curve: 'linear' | 'exp' = 'linear'): this {
    finiteNonNegative('fadeIn seconds', seconds);
    this.ops.push({op: 'fade', direction: 'in', seconds, curve});
    return this;
  }

  fadeOut(seconds: number, curve: 'linear' | 'exp' = 'linear'): this {
    finiteNonNegative('fadeOut seconds', seconds);
    this.ops.push({op: 'fade', direction: 'out', seconds, curve});
    return this;
  }

  normalize(targetPeak = 1): this {
    finiteNonNegative('normalize targetPeak', targetPeak);
    this.ops.push({op: 'normalize', targetPeak});
    return this;
  }

  reverse(): this {
    this.ops.push({op: 'reverse'});
    return this;
  }

  insertSilence(atSeconds: number, seconds: number): this {
    finite('insertSilence atSeconds', atSeconds);
    finiteNonNegative('insertSilence seconds', seconds);
    this.ops.push({op: 'insertSilence', atSeconds, seconds});
    return this;
  }

  /** Execute the buffered ops; returns a new clip (the base is untouched). */
  apply(): AudioClip {
    const sr = this.base.sampleRate;
    let channels = this.base.channels();
    invariant(channels, 'unreachable: base has samples');

    let timeline: TimelineState = {
      duration: this.base.duration,
      regions: this.base.regions,
      beatGrid: this.base.beatGrid,
    };

    for (const op of this.ops) {
      const beforeLength = channels[0]?.length ?? 0;
      channels = applyOp(channels, sr, op);
      timeline = applyTimelineOp(timeline, sr, beforeLength, channels[0]?.length ?? 0, op);
    }

    return createAudioClipFromOwnedChannels({
      sampleRate: sr,
      channelData: channels,
      metadata: this.base.metadata,
      regions: timeline.regions,
      ...(timeline.beatGrid ? {beatGrid: timeline.beatGrid} : {}),
    });
  }
}

export function createClipEditSession(clip: AudioClip): ClipEditSession {
  return new ClipEditSession(clip);
}

// ---------------------------------------------------------------------------
// Pure per-op transforms over a channel set (exported for unit testing).
// ---------------------------------------------------------------------------

export function applyOp(channels: Float32Array[], sr: number, op: ClipEditDescriptor): Float32Array[] {
  invariant(Number.isFinite(sr) && sr > 0, 'applyOp sampleRate must be finite and positive');
  validateDescriptor(op);
  switch (op.op) {
    case 'cut':
      return cut(channels, sr, op.startSeconds, op.endSeconds);
    case 'gain':
      return gain(channels, sr, op.factor, op.startSeconds, op.endSeconds);
    case 'fade':
      return fade(channels, sr, op.direction, op.seconds, op.curve ?? 'linear');
    case 'normalize':
      return normalize(channels, op.targetPeak);
    case 'reverse':
      return channels.map((ch) => Float32Array.from(ch).reverse());
    case 'insertSilence':
      return insertSilence(channels, sr, op.atSeconds, op.seconds);
  }
}

function validateDescriptor(op: ClipEditDescriptor): void {
  switch (op.op) {
    case 'cut':
      finite('cut startSeconds', op.startSeconds);
      finite('cut endSeconds', op.endSeconds);
      invariant(op.endSeconds >= op.startSeconds, 'cut endSeconds must be >= startSeconds');
      return;
    case 'gain':
      finite('gain factor', op.factor);
      if (op.startSeconds !== undefined) finite('gain startSeconds', op.startSeconds);
      if (op.endSeconds !== undefined) finite('gain endSeconds', op.endSeconds);
      if (op.startSeconds !== undefined && op.endSeconds !== undefined) {
        invariant(op.endSeconds >= op.startSeconds, 'gain endSeconds must be >= startSeconds');
      }
      return;
    case 'fade':
      finiteNonNegative('fade seconds', op.seconds);
      return;
    case 'normalize':
      finiteNonNegative('normalize targetPeak', op.targetPeak);
      return;
    case 'reverse':
      return;
    case 'insertSilence':
      finite('insertSilence atSeconds', op.atSeconds);
      finiteNonNegative('insertSilence seconds', op.seconds);
  }
}

function finite(label: string, value: number): void {
  invariant(Number.isFinite(value), `${label} must be finite`);
}

function finiteNonNegative(label: string, value: number): void {
  invariant(Number.isFinite(value) && value >= 0, `${label} must be finite and non-negative`);
}

interface TimelineState {
  readonly duration: number;
  readonly regions: readonly Region[];
  readonly beatGrid?: BeatGrid;
}

function applyTimelineOp(
  state: TimelineState,
  sampleRate: number,
  beforeLength: number,
  afterLength: number,
  op: ClipEditDescriptor,
): TimelineState {
  const duration = afterLength / sampleRate;
  if (op.op === 'cut') {
    const startFrame = Math.max(0, Math.min(beforeLength, Math.floor(op.startSeconds * sampleRate)));
    const endFrame = Math.max(startFrame, Math.min(beforeLength, Math.floor(op.endSeconds * sampleRate)));
    const start = startFrame / sampleRate;
    const end = endFrame / sampleRate;
    const removed = end - start;
    const map = (seconds: number): number | null => {
      if (seconds < start) return seconds;
      if (seconds >= end) return seconds - removed;
      return null;
    };
    return {
      duration,
      regions: cutRegions(state.regions, start, end),
      beatGrid: mapBeatGrid(state.beatGrid, map),
    };
  }

  if (op.op === 'insertSilence') {
    const atFrame = Math.max(0, Math.min(beforeLength, Math.floor(op.atSeconds * sampleRate)));
    const at = atFrame / sampleRate;
    const inserted = (afterLength - beforeLength) / sampleRate;
    const map = (seconds: number): number => seconds >= at ? seconds + inserted : seconds;
    return {
      duration,
      regions: insertIntoRegions(state.regions, at, inserted),
      beatGrid: mapBeatGrid(state.beatGrid, map),
    };
  }

  if (op.op === 'reverse') {
    const map = (seconds: number): number => Math.max(0, state.duration - seconds);
    return {
      duration,
      regions: reverseRegions(state.regions, state.duration),
      beatGrid: mapBeatGrid(state.beatGrid, map),
    };
  }

  return {...state, duration};
}

function cutRegions(regions: readonly Region[], start: number, end: number): Region[] {
  const removed = end - start;
  return regions.flatMap((region) => {
    if (region.isMarker) {
      if (region.startSeconds >= start && region.startSeconds < end) return [];
      const position = region.startSeconds >= end ? region.startSeconds - removed : region.startSeconds;
      return [new Region({...region.toJSON(), startSeconds: position})];
    }

    const mapBoundary = (seconds: number): number => {
      if (seconds <= start) return seconds;
      if (seconds >= end) return seconds - removed;
      return start;
    };
    const nextStart = mapBoundary(region.startSeconds);
    const nextEnd = mapBoundary(region.endSeconds as number);
    if (nextEnd <= nextStart) return [];
    return [new Region({...region.toJSON(), startSeconds: nextStart, endSeconds: nextEnd})];
  });
}

function insertIntoRegions(regions: readonly Region[], at: number, inserted: number): Region[] {
  if (inserted === 0) return [...regions];
  return regions.map((region) => {
    if (region.isMarker) {
      return new Region({
        ...region.toJSON(),
        startSeconds: region.startSeconds >= at ? region.startSeconds + inserted : region.startSeconds,
      });
    }
    if (region.startSeconds >= at) {
      return new Region({
        ...region.toJSON(),
        startSeconds: region.startSeconds + inserted,
        endSeconds: (region.endSeconds as number) + inserted,
      });
    }
    return new Region({
      ...region.toJSON(),
      endSeconds: (region.endSeconds as number) > at ? (region.endSeconds as number) + inserted : region.endSeconds,
    });
  });
}

function reverseRegions(regions: readonly Region[], duration: number): Region[] {
  return regions
    .flatMap((region) => {
      if (region.isMarker) {
        return [new Region({...region.toJSON(), startSeconds: Math.max(0, duration - region.startSeconds)})];
      }
      const start = Math.max(0, duration - (region.endSeconds as number));
      const end = Math.max(0, duration - region.startSeconds);
      if (end <= start) return [];
      return [new Region({...region.toJSON(), startSeconds: start, endSeconds: end})];
    })
    .sort((left, right) => left.startSeconds - right.startSeconds);
}

function mapBeatGrid(
  grid: BeatGrid | undefined,
  map: (seconds: number) => number | null,
): BeatGrid | undefined {
  if (!grid) return undefined;
  const downbeats = new Set(grid.downbeats ?? []);
  const mapped = grid.beats
    .map((beat) => ({beat, mapped: map(beat)}))
    .filter((entry): entry is {beat: number; mapped: number} => entry.mapped !== null && Number.isFinite(entry.mapped))
    .sort((left, right) => left.mapped - right.mapped);

  const beats: number[] = [];
  const mappedDownbeats: number[] = [];
  for (const entry of mapped) {
    const previous = beats[beats.length - 1];
    if (previous !== undefined && entry.mapped <= previous) continue;
    beats.push(entry.mapped);
    if (downbeats.has(entry.beat)) mappedDownbeats.push(entry.mapped);
  }
  if (beats.length === 0) return undefined;
  return new BeatGrid({
    bpm: grid.bpm,
    beats,
    ...(mappedDownbeats.length > 0 ? {downbeats: mappedDownbeats} : {}),
  });
}

function cut(channels: Float32Array[], sr: number, start: number, end: number): Float32Array[] {
  const a = Math.max(0, Math.floor(start * sr));
  const b = Math.min(channels[0].length, Math.floor(end * sr));
  return channels.map((ch) => {
    const out = new Float32Array(ch.length - (b - a));
    out.set(ch.subarray(0, a), 0);
    out.set(ch.subarray(b), a);
    return out;
  });
}

function gain(channels: Float32Array[], sr: number, factor: number, start?: number, end?: number): Float32Array[] {
  const a = start === undefined ? 0 : Math.max(0, Math.floor(start * sr));
  const b = end === undefined ? channels[0].length : Math.min(channels[0].length, Math.floor(end * sr));
  return channels.map((ch) => {
    const out = Float32Array.from(ch);
    for (let i = a; i < b; i++) out[i] *= factor;
    return out;
  });
}

function fade(
  channels: Float32Array[],
  sr: number,
  direction: 'in' | 'out',
  seconds: number,
  curve: 'linear' | 'exp',
): Float32Array[] {
  const n = Math.min(channels[0].length, Math.floor(seconds * sr));
  const total = channels[0].length;
  return channels.map((ch) => {
    const out = Float32Array.from(ch);
    for (let i = 0; i < n; i++) {
      let g = i / n; // 0→1 ramp
      if (direction === 'out') g = 1 - g;
      if (curve === 'exp') g = g * g;
      const idx = direction === 'in' ? i : total - n + i;
      out[idx] *= g;
    }
    return out;
  });
}

function normalize(channels: Float32Array[], targetPeak: number): Float32Array[] {
  let peak = 0;
  for (const ch of channels) for (let i = 0; i < ch.length; i++) peak = Math.max(peak, Math.abs(ch[i]));
  if (peak === 0) return channels.map((ch) => Float32Array.from(ch));
  const factor = targetPeak / peak;
  return channels.map((ch) => {
    const out = Float32Array.from(ch);
    for (let i = 0; i < out.length; i++) out[i] *= factor;
    return out;
  });
}

function insertSilence(channels: Float32Array[], sr: number, at: number, seconds: number): Float32Array[] {
  const pos = Math.max(0, Math.min(channels[0].length, Math.floor(at * sr)));
  const pad = Math.max(0, Math.floor(seconds * sr));
  return channels.map((ch) => {
    const out = new Float32Array(ch.length + pad);
    out.set(ch.subarray(0, pos), 0);
    out.set(ch.subarray(pos), pos + pad);
    return out;
  });
}
