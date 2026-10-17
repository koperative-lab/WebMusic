import {AudioClip, copyClipPcmRange, retainedClipPcmBytes} from './model/AudioClip';
import {makeId} from './utils/id';

/** Frame addressing is one-to-one: no implicit resampling or channel mixing. */
export interface AudioSequenceFormat {
  readonly sampleRate: number;
  readonly channelLayout: readonly string[];
}
export interface AudioAssetDescriptor extends AudioSequenceFormat {
  readonly id: string;
  readonly length: number;
  /** Whole backing buffers retained by this asset, counted once per buffer within the asset. */
  readonly byteLength: number;
}
export interface AudioAssetLease {
  readonly assetIds: readonly string[];
  readonly released: boolean;
  release(): void;
}
/** Reads copy into caller-owned channels. Retained assets survive their owner's disposal. */
export interface AudioAssetReader {
  getDescriptor(assetId: string): AudioAssetDescriptor | undefined;
  getReferenceCount(assetId: string): number;
  read(assetId: string, startFrame: number, destinations: readonly Float32Array[]): void;
  retain(assetIds: readonly string[]): AudioAssetLease;
}
export interface AudioAssetStore extends AudioAssetReader {
  /** Returns an initial lease; the caller releases it after another owner retains it. */
  registerClip(clip: AudioClip, options?: {readonly id?: string; readonly channelLayout?: readonly string[]}): AudioAssetLease;
  getStats(): {readonly assets: number; readonly bytes: number; readonly leases: number};
  dispose(): void;
}
export interface AudioEnvelopePoint {readonly frame: number; readonly gain: number}
export interface AudioAssetSegment {
  readonly kind: 'asset';
  readonly id: string;
  readonly assetId: string;
  readonly sourceStart: number;
  readonly sourceEnd: number;
  readonly gain: number;
  readonly envelope: readonly AudioEnvelopePoint[];
}
export interface AudioSilenceSegment {readonly kind: 'silence'; readonly id: string; readonly length: number}
export type AudioSequenceSegment = AudioAssetSegment | AudioSilenceSegment;
export type AudioSequenceSegmentInput = (Omit<AudioAssetSegment, 'gain' | 'envelope'> & {
  readonly gain?: number; readonly envelope?: readonly AudioEnvelopePoint[];
}) | AudioSilenceSegment;
export interface AudioSequenceAnnotation {
  readonly id: string;
  readonly startFrame: number;
  /** Absent for a point; otherwise a nonempty half-open span. */
  readonly endFrame?: number;
  readonly anchoring: 'content' | 'fixed';
  readonly label?: string;
}
export interface AudioSequence extends AudioSequenceFormat {
  readonly length: number;
  readonly segments: readonly AudioSequenceSegment[];
  readonly annotations: readonly AudioSequenceAnnotation[];
}
export interface AudioSequenceInit extends AudioSequenceFormat {
  readonly segments?: readonly AudioSequenceSegmentInput[];
  readonly annotations?: readonly AudioSequenceAnnotation[];
}

export class AudioSequenceError extends Error {
  constructor(readonly code: 'invalid-sequence' | 'unknown-asset' | 'incompatible-audio-format' | 'invalid-range' | 'disposed', message: string) {
    super(message); this.name = 'AudioSequenceError';
  }
}
export function audioChannelLayout(channels: number): readonly string[] {
  frameInteger(channels, 'channel count');
  if (!channels) throw new AudioSequenceError('invalid-sequence', 'Channel count must be positive');
  return Object.freeze(channels === 1 ? ['mono'] : channels === 2 ? ['left', 'right'] :
    Array.from({length: channels}, (_, index) => `channel-${index + 1}`));
}
export function audioSegmentLength(segment: AudioSequenceSegment): number {
  return segment.kind === 'silence' ? segment.length : segment.sourceEnd - segment.sourceStart;
}
export function audioEnvelopeGain(points: readonly AudioEnvelopePoint[], frame: number): number {
  if (!points.length) return 1;
  if (frame <= points[0].frame) return points[0].gain;
  for (let index = 1; index < points.length; index++) {
    const end = points[index];
    if (frame <= end.frame) {
      const start = points[index - 1];
      return start.gain + (end.gain - start.gain) * (frame - start.frame) / (end.frame - start.frame);
    }
  }
  return points[points.length - 1].gain;
}
export function createAudioSequence(init: AudioSequenceInit, assets?: AudioAssetReader): AudioSequence {
  validateFormat(init);
  if (init.segments !== undefined && !Array.isArray(init.segments)) invalid('Segments must be an array');
  if (init.annotations !== undefined && !Array.isArray(init.annotations)) invalid('Annotations must be an array');
  const ids = new Set<string>();
  let length = 0;
  const segments = (init.segments ?? []).flatMap((segment): AudioSequenceSegment[] => {
    if (!segment || (segment.kind !== 'asset' && segment.kind !== 'silence')) invalid('Unknown segment kind');
    validId(segment.id); if (ids.has(segment.id)) invalid('Duplicate segment ID'); ids.add(segment.id);
    let result: AudioSequenceSegment;
    if (segment.kind === 'silence') {
      frameInteger(segment.length, 'silence length');
      result = Object.freeze({kind: 'silence', id: segment.id, length: segment.length});
    } else {
      validId(segment.assetId); frameInteger(segment.sourceStart, 'source start'); frameInteger(segment.sourceEnd, 'source end');
      if (segment.sourceEnd < segment.sourceStart) invalid('Source end precedes source start');
      const gain = segment.gain === undefined ? 1 : segment.gain;
      const points = segment.envelope === undefined ? [] : segment.envelope;
      gainValue(gain);
      if (!Array.isArray(points)) invalid('Envelope must be an array');
      const extent = segment.sourceEnd - segment.sourceStart;
      let previous = -1;
      const envelope = Object.freeze(points.map((point: AudioEnvelopePoint) => {
        frameInteger(point.frame, 'envelope frame'); gainValue(point.gain);
        if (point.frame <= previous || point.frame > extent) invalid('Envelope points must be ordered inside the segment');
        previous = point.frame;
        return Object.freeze({frame: point.frame, gain: point.gain});
      }));
      if (assets) {
        const descriptor = assets.getDescriptor(segment.assetId);
        if (!descriptor) throw new AudioSequenceError('unknown-asset', `Unknown asset: ${segment.assetId}`);
        if (!sameAudioFormat(init, descriptor)) throw new AudioSequenceError('incompatible-audio-format', 'Asset format must match the sequence');
        if (segment.sourceEnd > descriptor.length) invalid('Segment exceeds source bounds');
      }
      result = Object.freeze({kind: 'asset', id: segment.id, assetId: segment.assetId,
        sourceStart: segment.sourceStart, sourceEnd: segment.sourceEnd, gain, envelope});
    }
    const size = audioSegmentLength(result);
    length += size; frameInteger(length, 'sequence length');
    return size ? [result] : [];
  });
  const annotationIds = new Set<string>();
  const annotations = Object.freeze((init.annotations ?? []).map((annotation) => {
    validId(annotation.id); frameInteger(annotation.startFrame, 'annotation start');
    if (annotationIds.has(annotation.id)) invalid('Duplicate annotation ID'); annotationIds.add(annotation.id);
    if (!['content', 'fixed'].includes(annotation.anchoring) || annotation.startFrame > length ||
        (annotation.label !== undefined && typeof annotation.label !== 'string')) invalid('Invalid annotation');
    if (annotation.endFrame !== undefined) {
      frameInteger(annotation.endFrame, 'annotation end');
      if (annotation.endFrame <= annotation.startFrame || annotation.endFrame > length) invalid('Invalid annotation span');
    }
    return Object.freeze({id: annotation.id, startFrame: annotation.startFrame, anchoring: annotation.anchoring,
      ...(annotation.endFrame !== undefined ? {endFrame: annotation.endFrame} : {}),
      ...(annotation.label !== undefined ? {label: annotation.label} : {})});
  }));
  return Object.freeze({sampleRate: init.sampleRate, channelLayout: Object.freeze([...init.channelLayout]),
    length, segments: Object.freeze(segments), annotations});
}
/** Explicit seconds-to-frames adapter. Rounds to the nearest frame and rejects out-of-clip cues. */
export function audioClipRegionsToFrameAnnotations(clip: AudioClip, anchoring: 'content' | 'fixed'): readonly AudioSequenceAnnotation[] {
  if (anchoring !== 'content' && anchoring !== 'fixed') invalid('Annotation anchoring must be explicit');
  return Object.freeze(clip.regions.map((region) => {
    const startFrame = Math.round(region.startSeconds * clip.sampleRate);
    const endFrame = region.endSeconds === undefined ? undefined : Math.round(region.endSeconds * clip.sampleRate);
    frameRange(startFrame, endFrame === undefined ? 0 : endFrame - startFrame, clip.length);
    return Object.freeze({id: region.id, label: region.label, startFrame, anchoring,
      ...(endFrame !== undefined && endFrame > startFrame ? {endFrame} : {})});
  }));
}
export function sameAudioFormat(a: AudioSequenceFormat, b: AudioSequenceFormat): boolean {
  return a.sampleRate === b.sampleRate && a.channelLayout.length === b.channelLayout.length &&
    a.channelLayout.every((label, index) => label === b.channelLayout[index]);
}
export function audioSequenceAssetIds(sequence: AudioSequence): readonly string[] {
  return Object.freeze([...new Set(sequence.segments.flatMap((segment) => segment.kind === 'asset' ? [segment.assetId] : []))]);
}
export function retainAudioSequence(sequence: AudioSequence, assets: AudioAssetReader): AudioAssetLease {
  return assets.retain(audioSequenceAssetIds(sequence));
}
/** Read exactly destination[0].length output frames, including gain and cropped envelopes. */
export function readAudioSequenceRange(sequence: AudioSequence, assets: AudioAssetReader, startFrame: number,
  destinations: readonly Float32Array[]): void {
  const length = validateDestinations(destinations, sequence.channelLayout.length);
  frameRange(startFrame, length, sequence.length);
  for (const destination of destinations) destination.fill(0);
  let offset = 0;
  for (const segment of sequence.segments) {
    const size = audioSegmentLength(segment);
    const start = Math.max(startFrame, offset), end = Math.min(startFrame + length, offset + size);
    if (end > start && segment.kind === 'asset') {
      const views = destinations.map((channel) => channel.subarray(start - startFrame, end - startFrame));
      assets.read(segment.assetId, segment.sourceStart + start - offset, views);
      for (let index = 0; index < end - start; index++) {
        const gain = segment.gain * audioEnvelopeGain(segment.envelope, start - offset + index);
        for (const channel of views) channel[index] *= gain;
      }
    }
    offset += size;
    if (offset >= startFrame + length) break;
  }
}

/** Retains immutable AudioClip backing storage without copying whole PCM. */
export function createMemoryAudioAssetStore(): AudioAssetStore {
  const entries = new Map<string, {descriptor: AudioAssetDescriptor; clip: AudioClip; references: number}>();
  const clipIds = new WeakMap<AudioClip, string>();
  const retiredIds = new Set<string>();
  let disposed = false;
  const retain = (assetIds: readonly string[]): AudioAssetLease => {
    const ids = Object.freeze([...new Set(assetIds)]);
    for (const id of ids) if (!entries.has(id)) throw new AudioSequenceError('unknown-asset', `Unknown asset: ${id}`);
    for (const id of ids) entries.get(id)!.references++;
    let released = false;
    return Object.freeze({assetIds: ids, get released() { return released; }, release() {
      if (released) return; released = true;
      for (const id of ids) {
        const entry = entries.get(id)!;
        if (--entry.references === 0) entries.delete(id);
      }
    }});
  };
  return Object.freeze({
    getDescriptor: (id: string) => entries.get(id)?.descriptor,
    getReferenceCount: (id: string) => entries.get(id)?.references ?? 0,
    read(id: string, startFrame: number, destinations: readonly Float32Array[]) {
      const entry = entries.get(id);
      if (!entry) throw new AudioSequenceError('unknown-asset', `Unknown asset: ${id}`);
      const length = validateDestinations(destinations, entry.descriptor.channelLayout.length);
      frameRange(startFrame, length, entry.descriptor.length);
      for (let channel = 0; channel < destinations.length; channel++) copyClipPcmRange(entry.clip, channel, startFrame, destinations[channel]);
    },
    retain,
    registerClip(clip: AudioClip, options: {readonly id?: string; readonly channelLayout?: readonly string[]} = {}) {
      if (disposed) throw new AudioSequenceError('disposed', 'Asset store is disposed');
      if (!clip?.hasSamples) invalid('An asset requires decoded PCM');
      const layout = options.channelLayout ?? audioChannelLayout(clip.numberOfChannels);
      validateFormat({sampleRate: clip.sampleRate, channelLayout: layout});
      if (layout.length !== clip.numberOfChannels) invalid('Channel layout does not match PCM');
      const id = options.id ?? clipIds.get(clip) ?? makeId('asset'); validId(id);
      const existing = entries.get(id);
      if (existing) {
        if (existing.clip !== clip || !sameAudioFormat(existing.descriptor, {sampleRate: clip.sampleRate, channelLayout: layout})) invalid('Asset IDs cannot be replaced');
      } else {
        const byteLength = retainedClipPcmBytes(clip); frameInteger(byteLength, 'asset byte length');
        if (retiredIds.has(id) && clipIds.get(clip) !== id) invalid('Asset IDs cannot be reused for different PCM');
        retiredIds.add(id);
        entries.set(id, {descriptor: Object.freeze({id, sampleRate: clip.sampleRate, channelLayout: Object.freeze([...layout]),
          length: clip.length, byteLength}), clip, references: 0});
        clipIds.set(clip, id);
      }
      return retain([id]);
    },
    getStats() { return Object.freeze({assets: entries.size, bytes: [...entries.values()].reduce((sum, entry) => sum + entry.descriptor.byteLength, 0),
      leases: [...entries.values()].reduce((sum, entry) => sum + entry.references, 0)}); },
    // A store never invalidates a caller-held lease. Once disposed it accepts no new assets.
    dispose() { disposed = true; },
  });
}
export function frameInteger(value: number, name = 'frame'): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new AudioSequenceError('invalid-range', `${name} must be a nonnegative safe integer`);
}
export function frameRange(start: number, length: number, extent: number): void {
  frameInteger(start, 'range start'); frameInteger(length, 'range length');
  if (!Number.isSafeInteger(start + length) || start + length > extent) throw new AudioSequenceError('invalid-range', 'Range exceeds content bounds');
}
function validateFormat(format: AudioSequenceFormat): void {
  if (!format || !Number.isFinite(format.sampleRate) || format.sampleRate <= 0 || !Array.isArray(format.channelLayout) ||
      !format.channelLayout.length || format.channelLayout.some((label) => typeof label !== 'string' || !label) ||
      new Set(format.channelLayout).size !== format.channelLayout.length) invalid('Invalid sample rate or channel layout');
}
function validateDestinations(destinations: readonly Float32Array[], channels: number): number {
  if (!Array.isArray(destinations) || destinations.length !== channels || !destinations.length ||
      destinations.some((value) => !(value instanceof Float32Array) || value.length !== destinations[0].length)) {
    throw new AudioSequenceError('invalid-range', 'Destination channels must have equal lengths and match the layout');
  }
  return destinations[0].length;
}
function validId(value: string): void { if (typeof value !== 'string' || !value) invalid('IDs must be nonempty strings'); }
function gainValue(value: number): void { if (!Number.isFinite(value) || value < 0) invalid('Gain must be finite and nonnegative'); }
function invalid(message: string): never { throw new AudioSequenceError('invalid-sequence', message); }
