import {RegionId} from '../types/ids';
import {makeId} from '../utils/id';
import {invariant} from '../utils/invariants';

export interface RegionData {
  id: RegionId;
  label: string;
  startSeconds: number;
  /** Omit for a point marker (zero-length cue). */
  endSeconds?: number;
  color?: string;
  loop?: boolean;
}

/** A labelled point (marker) or span (region/loop) within an {@link AudioClip}. Immutable. */
export class Region implements Readonly<RegionData> {
  readonly id: RegionId;
  readonly label: string;
  readonly startSeconds: number;
  readonly endSeconds?: number;
  readonly color?: string;
  readonly loop?: boolean;

  constructor(data: RegionData) {
    invariant(Number.isFinite(data.startSeconds), 'Region startSeconds must be finite');
    invariant(data.startSeconds >= 0, 'Region startSeconds must be non-negative');
    if (data.endSeconds !== undefined) {
      invariant(Number.isFinite(data.endSeconds), 'Region endSeconds must be finite');
      invariant(data.endSeconds >= data.startSeconds, 'Region endSeconds must be >= startSeconds');
    }
    this.id = data.id;
    this.label = data.label;
    this.startSeconds = data.startSeconds;
    if (data.endSeconds !== undefined) this.endSeconds = data.endSeconds;
    if (data.color !== undefined) this.color = data.color;
    if (data.loop !== undefined) this.loop = data.loop;
    Object.freeze(this);
  }

  /** A region with no end is a point marker. */
  get isMarker(): boolean {
    return this.endSeconds === undefined;
  }

  get durationSeconds(): number {
    return this.endSeconds === undefined ? 0 : this.endSeconds - this.startSeconds;
  }

  /** Shift both ends by `deltaSeconds` (clamped at 0). */
  shifted(deltaSeconds: number): Region {
    return new Region({
      ...this.toJSON(),
      startSeconds: Math.max(0, this.startSeconds + deltaSeconds),
      ...(this.endSeconds !== undefined ? {endSeconds: Math.max(0, this.endSeconds + deltaSeconds)} : {}),
    });
  }

  toJSON(): RegionData {
    return {
      id: this.id,
      label: this.label,
      startSeconds: this.startSeconds,
      ...(this.endSeconds !== undefined ? {endSeconds: this.endSeconds} : {}),
      ...(this.color !== undefined ? {color: this.color} : {}),
      ...(this.loop !== undefined ? {loop: this.loop} : {}),
    };
  }

  static fromJSON(json: RegionData): Region {
    return new Region(json);
  }
}

/** Convenience factory that mints a fresh RegionId. */
export function createRegion(init: Omit<RegionData, 'id'> & {id?: RegionId}): Region {
  return new Region({id: init.id ?? RegionId(makeId('region')), ...init});
}
