import {AudioEditError, type AudioPositionMap, type AudioPositionStep, type AudioMappedPosition} from './editing';
import {frameInteger} from './sequence';

export function createAudioPositionMap(documentId: string, fromRevision: number, toRevision: number,
  steps: readonly AudioPositionStep[]): AudioPositionMap {
  if (!documentId || !Number.isSafeInteger(fromRevision) || fromRevision < 0 || !Number.isSafeInteger(toRevision) ||
      toRevision <= fromRevision || !Array.isArray(steps)) throw new AudioEditError('invalid-command', 'Invalid position map');
  for (const step of steps) {
    if (!step || !['splice', 'reset'].includes(step.type)) throw new AudioEditError('invalid-command', 'Invalid position map step');
    frameInteger(step.length);
    if (step.type === 'splice') {
      frameInteger(step.startFrame); frameInteger(step.deleteCount); frameInteger(step.insertCount);
      if (step.startFrame + step.insertCount > step.length || !Number.isSafeInteger(step.startFrame + step.deleteCount)) {
        throw new AudioEditError('invalid-command', 'Invalid splice map bounds');
      }
    }
  }
  return Object.freeze({documentId, fromRevision, toRevision, steps: Object.freeze(steps.map((step) => Object.freeze({...step})))});
}
export function composeAudioPositionMaps(...maps: readonly AudioPositionMap[]): AudioPositionMap {
  if (!maps.length) throw new AudioEditError('invalid-command', 'Position map chain is empty');
  for (let index = 0; index < maps.length; index++) {
    const map = maps[index]; createAudioPositionMap(map.documentId, map.fromRevision, map.toRevision, map.steps);
    if (map.documentId !== maps[0].documentId || (index > 0 && maps[index - 1].toRevision !== map.fromRevision)) {
      throw new AudioEditError('revision-conflict', 'Position maps need a continuous revision chain');
    }
  }
  const steps = maps.flatMap((map) => map.steps);
  let lastReset = -1;
  for (let index = 0; index < steps.length; index++) if (steps[index].type === 'reset') lastReset = index;
  return createAudioPositionMap(maps[0].documentId, maps[0].fromRevision, maps[maps.length - 1].toRevision,
    lastReset < 0 ? steps : steps.slice(lastReset));
}
export function mapAudioPosition(map: AudioPositionMap, position: number, affinity: 'left' | 'right' = 'right'): AudioMappedPosition {
  createAudioPositionMap(map.documentId, map.fromRevision, map.toRevision, map.steps);
  frameInteger(position);
  if (affinity !== 'left' && affinity !== 'right') throw new AudioEditError('invalid-command', 'Invalid position affinity');
  let frame = position, deleted = false;
  let positionPolicy: AudioMappedPosition['positionPolicy'] = 'preserve-frame';
  for (const step of map.steps) {
    if (step.type === 'reset') {frame = 0; deleted = false; positionPolicy = 'reset-origin'; continue;}
    const end = step.startFrame + step.deleteCount;
    if (step.deleteCount && frame >= step.startFrame && frame < end) {
      frame = step.startFrame; deleted = true; affinity = 'left';
    } else if (frame > end || (step.deleteCount > 0 && frame === end) ||
        (step.deleteCount === 0 && frame === step.startFrame && affinity === 'right')) {
      frame += step.insertCount - step.deleteCount;
    }
    frame = Math.min(frame, step.length);
  }
  return Object.freeze({frame, deleted, positionPolicy});
}
