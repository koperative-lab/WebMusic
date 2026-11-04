import {AudioEditError, type AudioEditOperation, type AudioPositionStep} from '../../core/editing';
import {createAudioPositionMap, mapAudioPosition} from '../../core/audio-position-map';
import {audioEnvelopeGain, audioSegmentLength, createAudioSequence, frameRange,
  type AudioAssetReader, type AudioSequence, type AudioSequenceSegment, type AudioSequenceSegmentInput, type AudioSequenceAnnotation} from '../../core/sequence';

export interface AppliedAudioOperations {
  readonly content: AudioSequence;
  readonly operations: readonly AudioEditOperation[];
  readonly steps: readonly AudioPositionStep[];
}
/** Defensively snapshots plain JSON data; accessors, unknown fields and functions fail. */
export function snapshotAudioOperations(operations: readonly AudioEditOperation[]): readonly AudioEditOperation[] {
  if (!Array.isArray(operations)) invalid('Operations must be an array');
  const copy = snapshotAudioJson(operations) as unknown as AudioEditOperation[];
  const fields: Record<AudioEditOperation['type'], readonly string[]> = {
    splice: ['type', 'startFrame', 'deleteCount', 'segments', 'annotations', 'rightId'],
    split: ['type', 'segmentId', 'frame', 'leftId', 'rightId'], trim: ['type', 'startFrame', 'endFrame'],
    'insert-silence': ['type', 'frame', 'length', 'id', 'rightId'],
    'set-gain': ['type', 'segmentIds', 'gain'], 'set-envelope': ['type', 'segmentId', 'points'],
  };
  for (const operation of copy) {
    if (!operation || !Object.prototype.hasOwnProperty.call(fields, operation.type) || Object.keys(operation).some((key) => !fields[operation.type].includes(key))) {
      invalid('Unknown operation or fields');
    }
    if (operation.type === 'splice' && (!Array.isArray(operation.segments) || (operation.annotations !== undefined && !Array.isArray(operation.annotations)))) invalid('Splice requires segments and optional annotations arrays');
    if (operation.type === 'set-envelope' && !Array.isArray(operation.points)) invalid('Set envelope requires points');
    if (operation.type === 'splice' && Array.isArray(operation.segments)) {
      for (const segment of operation.segments) {
        const allowed = segment?.kind === 'asset' ? ['kind', 'id', 'assetId', 'sourceStart', 'sourceEnd', 'gain', 'envelope'] : ['kind', 'id', 'length'];
        if (!segment || Object.keys(segment).some((key) => !allowed.includes(key))) invalid('Unknown segment fields');
        if (segment.kind === 'asset' && Array.isArray(segment.envelope)) validatePointFields(segment.envelope);
      }
      for (const annotation of operation.annotations ?? []) {
        if (!annotation || Object.keys(annotation).some((key) => !['id', 'startFrame', 'endFrame', 'anchoring', 'label'].includes(key))) invalid('Unknown annotation fields');
      }
    }
    if (operation.type === 'set-envelope' && Array.isArray(operation.points)) validatePointFields(operation.points);
  }
  return Object.freeze(copy);
}
function validatePointFields(points: readonly object[]): void {
  for (const point of points) if (!point || Object.keys(point).some((key) => !['frame', 'gain'].includes(key))) invalid('Unknown envelope fields');
}
export function snapshotAudioJson(value: unknown): unknown {
  const ancestors = new Set<object>();
  function copy(input: unknown): unknown {
    if (input === null || typeof input === 'string' || typeof input === 'boolean') return input;
    if (typeof input === 'number' && Number.isFinite(input)) return input;
    if (!input || typeof input !== 'object' || ancestors.has(input)) invalid('Expected finite, acyclic JSON data');
    const array = Array.isArray(input);
    if (!array && ![Object.prototype, null].includes(Object.getPrototypeOf(input))) invalid('Expected plain JSON data');
    ancestors.add(input);
    const output: unknown[] | Record<string, unknown> = array ? [] : {};
    for (const key of Reflect.ownKeys(input)) {
      if (array && key === 'length') continue;
      const descriptor = Object.getOwnPropertyDescriptor(input, key)!;
      if (typeof key !== 'string' || !descriptor.enumerable || !('value' in descriptor) ||
          (array && !/^(0|[1-9]\d*)$/.test(key))) invalid('JSON data cannot contain accessors or symbol fields');
      Object.defineProperty(output, key, {value: copy(descriptor.value), enumerable: true});
    }
    if (array && Object.keys(input).length !== input.length) invalid('Sparse arrays are unsupported');
    ancestors.delete(input);
    return Object.freeze(output);
  }
  return copy(value);
}
export function applyAudioOperations(content: AudioSequence, assets: AudioAssetReader,
  input: readonly AudioEditOperation[]): AppliedAudioOperations {
  const operations = snapshotAudioOperations(input);
  let candidate = createAudioSequence(content, assets);
  const steps: AudioPositionStep[] = [];
  for (const operation of operations) {
    let segments = [...candidate.segments];
    const operationSteps: AudioPositionStep[] = [];
    let insertedAnnotations: readonly AudioSequenceAnnotation[] = [];
    if (operation.type === 'splice' || operation.type === 'insert-silence') {
      const start = operation.type === 'splice' ? operation.startFrame : operation.frame;
      const remove = operation.type === 'splice' ? operation.deleteCount : 0;
      const inserted: readonly AudioSequenceSegmentInput[] = operation.type === 'splice' ? operation.segments :
        [{kind: 'silence', id: operation.id, length: operation.length}];
      frameRange(start, remove, candidate.length);
      const validated = createAudioSequence({...candidate, segments: inserted, annotations: operation.type === 'splice' ? operation.annotations ?? [] : []}, assets);
      insertedAnnotations = validated.annotations.map((annotation) => ({...annotation, startFrame: annotation.startFrame + start,
        ...(annotation.endFrame !== undefined ? {endFrame: annotation.endFrame + start} : {})}));
      if (!remove && !validated.length) {
        if (insertedAnnotations.length) candidate = createAudioSequence({...candidate, annotations: [...candidate.annotations, ...insertedAnnotations]}, assets);
        continue;
      }
      const left = sliceAudioSegments(candidate, 0, start);
      const right = sliceAudioSegments(candidate, start + remove, candidate.length);
      if (left.length && right.length && left[left.length - 1].id === right[0].id) {
        if (typeof operation.rightId !== 'string' || !operation.rightId) invalid('Splicing inside one segment requires a rightId');
        right[0] = Object.freeze({...right[0], id: operation.rightId});
      }
      segments = [...left, ...validated.segments, ...right];
      operationSteps.push({type: 'splice', startFrame: start, deleteCount: remove, insertCount: validated.length,
        length: candidate.length - remove + validated.length});
    } else if (operation.type === 'trim') {
      frameRange(operation.startFrame, operation.endFrame - operation.startFrame, candidate.length);
      segments = sliceAudioSegments(candidate, operation.startFrame, operation.endFrame);
      if (operation.endFrame < candidate.length) operationSteps.push({type: 'splice', startFrame: operation.endFrame,
        deleteCount: candidate.length - operation.endFrame, insertCount: 0, length: operation.endFrame});
      if (operation.startFrame) operationSteps.push({type: 'splice', startFrame: 0,
        deleteCount: operation.startFrame, insertCount: 0, length: operation.endFrame - operation.startFrame});
    } else if (operation.type === 'split') {
      const index = segments.findIndex((segment) => segment.id === operation.segmentId);
      if (index < 0) unknownSegment(operation.segmentId);
      const segment = segments[index], length = audioSegmentLength(segment);
      frameRange(operation.frame, 0, length);
      if (!operation.frame || operation.frame === length) invalid('Split must be strictly inside a segment');
      segments.splice(index, 1, cropAudioSegment(segment, 0, operation.frame, operation.leftId),
        cropAudioSegment(segment, operation.frame, length, operation.rightId));
    } else if (operation.type === 'set-gain') {
      if (!Array.isArray(operation.segmentIds) || new Set(operation.segmentIds).size !== operation.segmentIds.length) invalid('Segment IDs must be unique');
      for (const id of operation.segmentIds) if (!segments.some((segment) => segment.id === id && segment.kind === 'asset')) unknownSegment(id);
      if (!Number.isFinite(operation.gain) || operation.gain < 0) invalid('Gain must be finite and nonnegative');
      segments = segments.map((segment) => segment.kind === 'asset' && operation.segmentIds.includes(segment.id) ? {...segment, gain: operation.gain} : segment);
    } else if (operation.type === 'set-envelope') {
      const index = segments.findIndex((segment) => segment.id === operation.segmentId && segment.kind === 'asset');
      if (index < 0) unknownSegment(operation.segmentId);
      segments[index] = {...segments[index], envelope: operation.points} as AudioSequenceSegment;
    }
    candidate = createAudioSequence({...candidate, segments,
      annotations: [...mapAudioAnnotations(candidate.annotations, operationSteps), ...insertedAnnotations]}, assets);
    steps.push(...operationSteps);
  }
  return Object.freeze({content: candidate, operations, steps: Object.freeze(steps.map((step) => Object.freeze(step)))});
}
/** Cropping preserves envelope values at both boundaries instead of restarting fades. */
export function cropAudioSegment(segment: AudioSequenceSegment, start: number, end: number, id = segment.id): AudioSequenceSegment {
  frameRange(start, end - start, audioSegmentLength(segment));
  if (segment.kind === 'silence') return Object.freeze({kind: 'silence', id, length: end - start});
  const envelope = segment.envelope.length ? Object.freeze([
    Object.freeze({frame: 0, gain: audioEnvelopeGain(segment.envelope, start)}),
    ...segment.envelope.filter((point) => point.frame > start && point.frame < end)
      .map((point) => Object.freeze({frame: point.frame - start, gain: point.gain})),
    ...(end > start ? [Object.freeze({frame: end - start, gain: audioEnvelopeGain(segment.envelope, end)})] : []),
  ]) : segment.envelope;
  return Object.freeze({...segment, id, sourceStart: segment.sourceStart + start, sourceEnd: segment.sourceStart + end, envelope});
}
export function sliceAudioSegments(sequence: AudioSequence, start: number, end: number): AudioSequenceSegment[] {
  frameRange(start, end - start, sequence.length);
  const result: AudioSequenceSegment[] = [];
  let offset = 0;
  for (const segment of sequence.segments) {
    const length = audioSegmentLength(segment), a = Math.max(start, offset), b = Math.min(end, offset + length);
    if (a < b) result.push(a === offset && b === offset + length ? segment : cropAudioSegment(segment, a - offset, b - offset));
    offset += length;
  }
  return result;
}
export function inverseAudioSteps(steps: readonly AudioPositionStep[]): readonly AudioPositionStep[] {
  return Object.freeze([...steps].reverse().map((step): AudioPositionStep => {
    if (step.type === 'reset') return step;
    return Object.freeze({type: 'splice', startFrame: step.startFrame, deleteCount: step.insertCount,
      insertCount: step.deleteCount, length: step.length - step.insertCount + step.deleteCount});
  }));
}
export function sameAudioSequence(a: AudioSequence, b: AudioSequence): boolean {return JSON.stringify(a) === JSON.stringify(b);}
function mapAudioAnnotations(annotations: readonly AudioSequenceAnnotation[], steps: readonly AudioPositionStep[]): readonly AudioSequenceAnnotation[] {
  if (!steps.length) return annotations;
  const map = createAudioPositionMap('annotations', 0, 1, steps);
  const length = steps[steps.length - 1].length;
  return annotations.flatMap((annotation): AudioSequenceAnnotation[] => {
    if (annotation.anchoring === 'fixed') {
      const startFrame = Math.min(annotation.startFrame, length);
      const endFrame = annotation.endFrame === undefined ? undefined : Math.min(annotation.endFrame, length);
      return [{...annotation, startFrame, ...(endFrame !== undefined && endFrame > startFrame ? {endFrame} : {endFrame: undefined})}];
    }
    const start = mapAudioPosition(map, annotation.startFrame, 'right');
    if (annotation.endFrame === undefined) return start.deleted ? [] : [{...annotation, startFrame: start.frame}];
    const end = mapAudioPosition(map, annotation.endFrame, 'left');
    return end.frame <= start.frame ? [] : [{...annotation, startFrame: start.frame, endFrame: end.frame}];
  });
}
function invalid(message: string): never {throw new AudioEditError('invalid-command', message);}
function unknownSegment(id: string): never {throw new AudioEditError('unknown-segment', `Unknown asset segment: ${id}`);}
