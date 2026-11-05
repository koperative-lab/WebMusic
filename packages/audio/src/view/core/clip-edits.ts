import {AudioEditError, type AudioEditOperation, type AudioFrameRange} from '../../core/editing';
import {audioEnvelopeGain, audioSegmentLength, readAudioSequenceRange,
  type AudioAssetReader, type AudioEnvelopePoint, type AudioSequence, type AudioSequenceSegment} from '../../core/sequence';
import {cropAudioSegment} from './edit-operations';

/*
 * Stateless builders for waveform-editor commands. Each returns ordinary
 * operations for one atomic editor command and never touches PCM: range gain
 * and fades split the affected segments at the range edges and then set gain
 * or envelope on the pieces inside it.
 */

/** Fade shapes: `linear` amplitude ramp, `logarithmic` (even in perceived loudness) and `cosine` (S-curve). */
export type AudioFadeCurve = 'linear' | 'logarithmic' | 'cosine';
export const AUDIO_FADE_CURVES: readonly AudioFadeCurve[] = Object.freeze(['linear', 'logarithmic', 'cosine']);

/** Fresh segment IDs for split pieces; a caller passes its own generator for deterministic tests. */
export type AudioSegmentIdFactory = () => string;

export interface AudioSegmentSpan {
  readonly segment: AudioSequenceSegment;
  readonly start: number;
  readonly end: number;
}

/** Segments with their output frame spans, in order. */
export function audioSegmentSpans(sequence: AudioSequence): AudioSegmentSpan[] {
  let offset = 0;
  return sequence.segments.map((segment) => {
    const start = offset;
    offset += audioSegmentLength(segment);
    return {segment, start, end: offset};
  });
}

/** Gain factor of a decibel value and back. */
export function decibelsToGain(decibels: number): number { return decibels <= -144 ? 0 : 10 ** (decibels / 20); }
export function gainToDecibels(gain: number): number { return gain <= 0 ? -Infinity : 20 * Math.log10(gain); }

/** Fade-in gain at normalized position `t` (0–1) for a curve; a fade-out uses `1 - t`. */
export function audioFadeGain(curve: AudioFadeCurve, t: number): number {
  const x = Math.min(1, Math.max(0, t));
  if (curve === 'logarithmic') return x * x;
  if (curve === 'cosine') return (1 - Math.cos(Math.PI * x)) / 2;
  return x;
}

function validRange(sequence: AudioSequence, range: AudioFrameRange): void {
  if (!Number.isSafeInteger(range.startFrame) || !Number.isSafeInteger(range.endFrame) ||
      range.startFrame < 0 || range.endFrame > sequence.length || range.endFrame <= range.startFrame) {
    throw new AudioEditError('invalid-range', 'Select a nonempty range inside the audio first');
  }
}

/**
 * Split the segments at the given output frames. Returns the split operations
 * and the resulting segment spans, so further operations can address the
 * pieces by their new IDs.
 */
export function audioSplitOperations(sequence: AudioSequence, frames: readonly number[], nextId: AudioSegmentIdFactory):
  {operations: AudioEditOperation[]; spans: AudioSegmentSpan[]} {
  const operations: AudioEditOperation[] = [];
  let spans = audioSegmentSpans(sequence);
  for (const frame of [...new Set(frames)].sort((a, b) => a - b)) {
    const index = spans.findIndex((span) => span.start < frame && frame < span.end);
    if (index < 0) continue;
    const span = spans[index];
    const local = frame - span.start;
    const leftId = nextId(), rightId = nextId();
    operations.push({type: 'split', segmentId: span.segment.id, frame: local, leftId, rightId});
    const length = span.end - span.start;
    spans = [...spans.slice(0, index),
      {segment: cropAudioSegment(span.segment, 0, local, leftId), start: span.start, end: frame},
      {segment: cropAudioSegment(span.segment, local, length, rightId), start: frame, end: span.end},
      ...spans.slice(index + 1)];
  }
  return {operations, spans};
}

/** Multiply the gain of everything inside a range (Audition's Amplify), keeping audio outside it. */
export function audioRangeGainOperations(sequence: AudioSequence, range: AudioFrameRange, factor: number,
  nextId: AudioSegmentIdFactory): AudioEditOperation[] {
  validRange(sequence, range);
  if (!Number.isFinite(factor) || factor < 0) throw new AudioEditError('invalid-command', 'Gain must be finite and nonnegative');
  const {operations, spans} = audioSplitOperations(sequence, [range.startFrame, range.endFrame], nextId);
  for (const span of spans) {
    if (span.segment.kind !== 'asset' || span.start < range.startFrame || span.end > range.endFrame) continue;
    operations.push({type: 'set-gain', segmentIds: [span.segment.id], gain: span.segment.gain * factor});
  }
  return operations;
}

/** Points per segment used to approximate a curved fade with the linear envelope. */
const CURVE_POINTS = 24;

/**
 * Fade a range in or out with a curve. Each segment inside the range keeps its
 * own envelope, multiplied by the fade, so earlier gain shaping survives.
 */
export function audioRangeFadeOperations(sequence: AudioSequence, range: AudioFrameRange, direction: 'in' | 'out',
  curve: AudioFadeCurve, nextId: AudioSegmentIdFactory): AudioEditOperation[] {
  validRange(sequence, range);
  if (!AUDIO_FADE_CURVES.includes(curve)) throw new AudioEditError('invalid-command', `Unknown fade curve: ${String(curve)}`);
  const {operations, spans} = audioSplitOperations(sequence, [range.startFrame, range.endFrame], nextId);
  const length = range.endFrame - range.startFrame;
  const fade = (frame: number) => {
    const t = (frame - range.startFrame) / length;
    return audioFadeGain(curve, direction === 'in' ? t : 1 - t);
  };
  for (const span of spans) {
    const segment = span.segment;
    if (segment.kind !== 'asset' || span.start < range.startFrame || span.end > range.endFrame) continue;
    const size = span.end - span.start;
    const frames = new Set<number>([0, size]);
    for (let index = 1; index < CURVE_POINTS; index += 1) frames.add(Math.round(size * index / CURVE_POINTS));
    for (const point of segment.envelope) frames.add(point.frame);
    const points = [...frames].filter((frame) => frame >= 0 && frame <= size).sort((a, b) => a - b)
      .map((frame) => ({frame, gain: audioEnvelopeGain(segment.envelope, frame) * fade(span.start + frame)}));
    operations.push({type: 'set-envelope', segmentId: segment.id, points});
  }
  return operations;
}

/** Replace a range with silence of the same length (Audition's Silence). */
export function audioRangeSilenceOperations(sequence: AudioSequence, range: AudioFrameRange, nextId: AudioSegmentIdFactory): AudioEditOperation[] {
  validRange(sequence, range);
  return [{type: 'splice', startFrame: range.startFrame, deleteCount: range.endFrame - range.startFrame,
    segments: [{kind: 'silence', id: nextId(), length: range.endFrame - range.startFrame}], rightId: nextId()}];
}

/** Envelope points with one added, moved or removed; frames are segment-local and strictly increasing. */
export function editAudioEnvelope(points: readonly AudioEnvelopePoint[], edit:
  {readonly add: AudioEnvelopePoint} | {readonly move: number; readonly to: AudioEnvelopePoint} | {readonly remove: number}): AudioEnvelopePoint[] {
  const next = [...points];
  if ('remove' in edit) next.splice(edit.remove, 1);
  else if ('move' in edit) next.splice(edit.move, 1, edit.to);
  else next.push(edit.add);
  const byFrame = new Map<number, AudioEnvelopePoint>();
  for (const point of next) {
    if (!Number.isSafeInteger(point.frame) || point.frame < 0 || !Number.isFinite(point.gain) || point.gain < 0) {
      throw new AudioEditError('invalid-command', 'Envelope points need nonnegative integer frames and gains');
    }
    byFrame.set(point.frame, {frame: point.frame, gain: point.gain});
  }
  return [...byFrame.values()].sort((a, b) => a.frame - b.frame);
}

/**
 * The frame nearest `frame` where the summed channels change sign, searched
 * within `radius` frames; `frame` itself when there is none.
 */
export function nearestAudioZeroCrossing(sequence: AudioSequence, assets: AudioAssetReader, frame: number, radius = 2048): number {
  const start = Math.max(0, frame - radius);
  const end = Math.min(sequence.length, frame + radius);
  if (end - start < 2) return frame;
  const channels = sequence.channelLayout.map(() => new Float32Array(end - start));
  readAudioSequenceRange(sequence, assets, start, channels);
  const sum = (index: number) => channels.reduce((total, channel) => total + channel[index], 0);
  let best = frame;
  let distance = Infinity;
  let previous = sum(0);
  for (let index = 1; index < end - start; index += 1) {
    const value = sum(index);
    if ((previous <= 0 && value > 0) || (previous >= 0 && value < 0)) {
      const at = start + index;
      if (Math.abs(at - frame) < distance) { distance = Math.abs(at - frame); best = at; }
    }
    previous = value;
  }
  return best;
}

/** Length in frames of the fade at one end of a segment's envelope: the run that starts at zero gain and only rises. */
export function audioFadeLength(points: readonly AudioEnvelopePoint[], size: number, side: 'in' | 'out'): number {
  if (!points.length) return 0;
  const ordered = side === 'in' ? points : [...points].reverse().map((point) => ({frame: size - point.frame, gain: point.gain}));
  if (ordered[0].frame !== 0 || ordered[0].gain > 1e-6) return 0;
  let index = 0;
  while (index + 1 < ordered.length && ordered[index + 1].gain > ordered[index].gain) index += 1;
  return index === 0 ? 0 : ordered[index].frame;
}

/**
 * A segment envelope whose fade at one end is replaced by `length` frames of
 * `curve`, scaled to the gain the envelope reaches after the old and new fades.
 * Points beyond both fades are kept; `length` 0 removes the fade.
 */
export function audioSegmentFadeEnvelope(points: readonly AudioEnvelopePoint[], size: number, side: 'in' | 'out',
  length: number, curve: AudioFadeCurve): AudioEnvelopePoint[] {
  if (!Number.isSafeInteger(size) || size < 1) throw new AudioEditError('invalid-command', 'Segment length must be positive');
  const fade = Math.max(0, Math.min(size, Math.round(length)));
  // Work as a fade-in on the mirrored envelope for a fade-out.
  const mirror = (list: readonly AudioEnvelopePoint[]) => [...list].reverse().map((point) => ({frame: size - point.frame, gain: point.gain}));
  const local = side === 'in' ? [...points] : mirror(points);
  const edge = Math.max(fade, audioFadeLength(local, size, 'in'));
  const plateau = local.length ? audioEnvelopeGain(local, edge) : 1;
  const tail = local.filter((point) => point.frame > edge);
  const head: AudioEnvelopePoint[] = [];
  if (fade > 0) {
    for (let index = 0; index <= CURVE_POINTS; index += 1) {
      const frame = Math.round(fade * index / CURVE_POINTS);
      if (head.length && head[head.length - 1].frame === frame) continue;
      head.push({frame, gain: plateau * audioFadeGain(curve, index / CURVE_POINTS)});
    }
    if (edge > fade) head.push({frame: edge, gain: plateau});
  } else if (local.length || plateau !== 1) {
    head.push({frame: 0, gain: plateau});
    if (edge > 0) head.push({frame: edge, gain: plateau});
  }
  const result = [...head, ...tail];
  // A plain unit envelope is the same as none.
  if (result.every((point) => point.gain === 1)) return [];
  return side === 'in' ? result : mirror(result);
}
