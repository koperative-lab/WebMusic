import {BeatGrid, type BeatGridData} from '../time/BeatGrid';
import {AudioClipId, type RegionId} from '../types/ids';
import type {AudioClipMetadata} from '../types/audio';
import {makeId} from '../utils/id';
import {invariant} from '../utils/invariants';
import {Region, type RegionData} from './Region';

// ---------------------------------------------------------------------------
// Lazy AudioBuffer cache. AudioClip instances are frozen, so the realized
// AudioBuffer (browser-only, context-specific) is memoized in a module-level
// WeakMap keyed by the clip — recomputed only if a different context is passed.
// ---------------------------------------------------------------------------

const audioBufferCache = new WeakMap<AudioClip, {context: BaseAudioContext; buffer: AudioBuffer}>();
// CJS/IIFE entries may contain independent copies of this module. The private
// copy capability travels with its clip; Symbol.for gives every entry the same
// key without registering or exposing PCM in a process-global map.
const PCM_COPY = Symbol.for('@webmusic/audio/clip-copy-pcm-range');

// Public construction defensively copies PCM so callers cannot mutate an
// "immutable" clip through the arrays they passed in. Functional updates inside
// this module may safely retain/share already-owned channels (notably slice's
// zero-copy subarray views) through this private one-shot marker.
const ownedChannelInits = new WeakSet<AudioClipInit>();

/** @internal Construct from channels that the core package already exclusively owns. */
export function createAudioClipFromOwnedChannels(init: AudioClipInit): AudioClip {
  ownedChannelInits.add(init);
  return new AudioClip(init);
}

export interface AudioClipInit {
  id?: AudioClipId;
  sampleRate: number;
  /** Decoded per-channel samples. Omit for a streaming (URL-only) clip. */
  channelData?: Float32Array[];
  /** Required when `channelData` is omitted. */
  length?: number;
  /** Required when `channelData` is omitted. */
  numberOfChannels?: number;
  metadata?: AudioClipMetadata;
  regions?: readonly Region[];
  beatGrid?: BeatGrid;
  /** Original source URL — needed by the streaming (media) playback engine. */
  sourceUrl?: string;
  /** Absolute source-file start for a bounded streaming slice, in seconds. */
  sourceOffsetSeconds?: number;
}

/** Plain-JSON shape produced by {@link AudioClip#toJSON} — structured-clone safe, NO samples. */
export interface AudioClipJSON {
  $schema: string;
  id: AudioClipId;
  sampleRate: number;
  numberOfChannels: number;
  length: number;
  metadata: AudioClipMetadata;
  regions: RegionData[];
  beatGrid?: BeatGridData;
  sourceUrl?: string;
  sourceOffsetSeconds?: number;
}

/**
 * Immutable digital-audio clip: the digital-audio analogue of WebScore's `Score`.
 *
 * Holds per-channel `Float32Array` sample data (transferable across workers) —
 * never an `AudioBuffer`, which is neither serializable nor postMessage-able.
 * All "edits" return a new clip; `slice` shares the underlying buffers via
 * `subarray` (zero-copy). A streaming clip carries only `sourceUrl` and no
 * samples (`channelData(ch)` returns `null`).
 */
export class AudioClip {
  readonly id: AudioClipId;
  readonly sampleRate: number;
  readonly numberOfChannels: number;
  /** Samples per channel. */
  readonly length: number;
  /** Seconds: `length / sampleRate`. */
  readonly duration: number;
  readonly metadata: AudioClipMetadata;
  readonly regions: readonly Region[];
  readonly beatGrid?: BeatGrid;
  readonly sourceUrl?: string;
  /** Present for a streaming slice; its length bounds playback within the source. */
  readonly sourceOffsetSeconds?: number;

  private readonly _channels: readonly Float32Array[] | null;

  constructor(init: AudioClipInit) {
    const takeOwnership = ownedChannelInits.delete(init);
    invariant(
      Number.isFinite(init.sampleRate) && init.sampleRate > 0,
      'AudioClip requires a finite positive sampleRate',
    );

    if (init.channelData !== undefined) {
      invariant(init.channelData.length > 0, 'AudioClip requires at least one decoded channel');
      const channels = takeOwnership
        ? init.channelData
        : init.channelData.map((channel) => Float32Array.from(channel));
      const length = channels[0].length;
      for (const ch of channels) {
        invariant(ch instanceof Float32Array, 'AudioClip channelData must contain Float32Array values');
        invariant(ch.length === length, 'All channels must have equal length');
      }
      this._channels = Object.freeze([...channels]);
      this.numberOfChannels = channels.length;
      this.length = length;
    } else {
      invariant(
        init.length !== undefined && init.numberOfChannels !== undefined,
        'A streaming AudioClip (no channelData) requires length and numberOfChannels',
      );
      invariant(
        Number.isSafeInteger(init.length) && init.length >= 0,
        'A streaming AudioClip requires a non-negative safe-integer length',
      );
      invariant(
        Number.isSafeInteger(init.numberOfChannels) && init.numberOfChannels > 0,
        'A streaming AudioClip requires a positive safe-integer numberOfChannels',
      );
      this._channels = null;
      this.numberOfChannels = init.numberOfChannels;
      this.length = init.length;
    }

    this.id = init.id ?? AudioClipId(makeId('clip'));
    this.sampleRate = init.sampleRate;
    this.duration = this.length / this.sampleRate;
    this.metadata = Object.freeze({...(init.metadata ?? {})});
    this.regions = Object.freeze([...(init.regions ?? [])]);
    if (init.beatGrid) this.beatGrid = init.beatGrid;
    if (init.sourceUrl !== undefined) this.sourceUrl = init.sourceUrl;
    if (init.sourceOffsetSeconds !== undefined) {
      invariant(!this._channels, 'sourceOffsetSeconds requires a streaming clip');
      invariant(Number.isFinite(init.sourceOffsetSeconds) && init.sourceOffsetSeconds >= 0,
        'sourceOffsetSeconds must be finite and non-negative');
      this.sourceOffsetSeconds = init.sourceOffsetSeconds;
    }

    Object.freeze(this);
  }

  /** True when this clip carries decoded samples (vs. streaming-only). */
  get hasSamples(): boolean {
    return this._channels !== null;
  }

  /**
   * A defensive copy of one channel, or `null` for a streaming/missing channel.
   * Mutating the returned array never changes this clip.
   */
  channelData(channel: number): Float32Array | null {
    if (!this._channels) return null;
    const data = this._channels[channel];
    return data ? Float32Array.from(data) : null;
  }

  private [PCM_COPY](channel: number, startFrame: number, destination: Float32Array, reverse: boolean): void {
    const source = this._channels?.[channel];
    invariant(source !== undefined, 'Cannot copy an unavailable PCM channel');
    invariant(Number.isSafeInteger(startFrame) && startFrame >= 0 && startFrame + destination.length <= source.length,
      'PCM copy range must be within the clip');
    if (reverse) {
      for (let index = 0; index < destination.length; index++) {
        destination[index] = source[startFrame + destination.length - 1 - index];
      }
    } else destination.set(source.subarray(startFrame, startFrame + destination.length));
  }

  /** Defensive copies of all channels, or `null` when streaming-only. */
  channels(): Float32Array[] | null {
    return this._channels ? this._channels.map((channel) => Float32Array.from(channel)) : null;
  }

  /**
   * Realize an `AudioBuffer` for main-thread playback. Browser-only (needs a
   * `BaseAudioContext`). Result is memoized per clip+context.
   */
  toAudioBuffer(context: BaseAudioContext): AudioBuffer {
    invariant(this._channels !== null, 'Cannot build an AudioBuffer from a streaming clip with no samples');
    const cached = audioBufferCache.get(this);
    if (cached && cached.context === context) return cached.buffer;
    const buffer = context.createBuffer(this.numberOfChannels, this.length, this.sampleRate);
    // `.set()` accepts ArrayLike<number>, sidestepping the Float32Array<ArrayBuffer>
    // vs Float32Array<ArrayBufferLike> generic mismatch that `copyToChannel` enforces.
    for (let c = 0; c < this.numberOfChannels; c++) buffer.getChannelData(c).set(this._channels[c]);
    audioBufferCache.set(this, {context, buffer});
    return buffer;
  }

  // --- Functional updates (return a new clip) ---

  /** Non-destructive sub-range. Internally shares PCM buffers; regions are intersected and shifted. */
  slice(startSeconds: number, endSeconds: number): AudioClip {
    invariant(Number.isFinite(startSeconds), 'slice start must be finite');
    invariant(Number.isFinite(endSeconds), 'slice end must be finite');
    const start = Math.max(0, Math.floor(startSeconds * this.sampleRate));
    const end = Math.min(this.length, Math.floor(endSeconds * this.sampleRate));
    invariant(end >= start, 'slice end must be >= start');

    const sliceStart = start / this.sampleRate;
    const sliceEnd = end / this.sampleRate;
    const beatGrid = sliceBeatGrid(this.beatGrid, sliceStart, sliceEnd);
    const regions = this.regions.flatMap((region) => {
      if (region.isMarker) {
        if (region.startSeconds < sliceStart || region.startSeconds > sliceEnd) return [];
        return [new Region({...region.toJSON(), startSeconds: region.startSeconds - sliceStart})];
      }

      const clippedStart = Math.max(region.startSeconds, sliceStart);
      const clippedEnd = Math.min(region.endSeconds as number, sliceEnd);
      if (clippedEnd <= clippedStart) return [];
      return [
        new Region({
          ...region.toJSON(),
          startSeconds: clippedStart - sliceStart,
          endSeconds: clippedEnd - sliceStart,
        }),
      ];
    });

    if (!this._channels) {
      return new AudioClip({
        sampleRate: this.sampleRate,
        length: end - start,
        numberOfChannels: this.numberOfChannels,
        metadata: this.metadata,
        regions,
        ...(beatGrid ? {beatGrid} : {}),
        sourceUrl: this.sourceUrl,
        sourceOffsetSeconds: (this.sourceOffsetSeconds ?? 0) + sliceStart,
      });
    }
    return createAudioClipFromOwnedChannels({
      sampleRate: this.sampleRate,
      channelData: this._channels.map((ch) => ch.subarray(start, end)),
      metadata: this.metadata,
      regions,
      ...(beatGrid ? {beatGrid} : {}),
    });
  }

  withRegions(regions: readonly Region[]): AudioClip {
    return this.derive({regions});
  }

  withBeatGrid(beatGrid: BeatGrid): AudioClip {
    return this.derive({beatGrid});
  }

  withMetadata(metadata: AudioClipMetadata): AudioClip {
    return this.derive({metadata: {...this.metadata, ...metadata}});
  }

  private derive(overrides: Partial<AudioClipInit>): AudioClip {
    return createAudioClipFromOwnedChannels({
      id: this.id,
      sampleRate: this.sampleRate,
      ...(this._channels
        ? {channelData: [...this._channels]}
        : {length: this.length, numberOfChannels: this.numberOfChannels}),
      metadata: this.metadata,
      regions: this.regions,
      beatGrid: this.beatGrid,
      sourceUrl: this.sourceUrl,
      sourceOffsetSeconds: this.sourceOffsetSeconds,
      ...overrides,
    });
  }

  toJSON(): AudioClipJSON {
    return {
      $schema: 'https://webaudio.dev/schema/clip/v0.1',
      id: this.id,
      sampleRate: this.sampleRate,
      numberOfChannels: this.numberOfChannels,
      length: this.length,
      metadata: this.metadata,
      regions: this.regions.map((r) => r.toJSON()),
      ...(this.beatGrid ? {beatGrid: this.beatGrid.toJSON()} : {}),
      ...(this.sourceUrl !== undefined ? {sourceUrl: this.sourceUrl} : {}),
      ...(this.sourceOffsetSeconds !== undefined ? {sourceOffsetSeconds: this.sourceOffsetSeconds} : {}),
    };
  }
}

/**
 * @internal Copy only the requested frames into an owned output buffer. This
 * module-private PCM seam avoids whole-channel copies and annotation slicing;
 * it is deliberately absent from the public core barrel.
 */
export function copyClipPcmRange(
  clip: AudioClip,
  channel: number,
  startFrame: number,
  destination: Float32Array,
  reverse = false,
): void {
  const copy: unknown = Reflect.get(clip, PCM_COPY);
  invariant(typeof copy === 'function', 'Clip does not provide an internal PCM copy capability');
  copy.call(clip, channel, startFrame, destination, reverse);
}

/** Build an {@link AudioClip} (alias of the constructor for the `createX` convention). */
export function createAudioClip(init: AudioClipInit): AudioClip {
  return new AudioClip(init);
}

function sliceBeatGrid(grid: BeatGrid | undefined, start: number, end: number): BeatGrid | undefined {
  if (!grid) return undefined;
  const downbeats = new Set(grid.downbeats ?? []);
  const selected = grid.beats.filter((beat) => beat >= start && beat <= end);
  if (selected.length === 0) return undefined;
  const beats = selected.map((beat) => beat - start);
  const shiftedDownbeats = selected
    .filter((beat) => downbeats.has(beat))
    .map((beat) => beat - start);
  return new BeatGrid({
    bpm: grid.bpm,
    beats,
    ...(shiftedDownbeats.length > 0 ? {downbeats: shiftedDownbeats} : {}),
  });
}

export type {RegionId};
