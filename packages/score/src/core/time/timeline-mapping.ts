import type {TimelineMapping} from '@webmusic/kernel/transport';
import {Rational} from '../primitives/Rational';
import type {TimeMap} from './TimeMap';

/**
 * Adapt a {@link TimeMap} to the kernel's number-based `TimelineMapping`
 * contract (position axis: quarter notes). The float→Rational conversion
 * quantizes to 1/480 quarter — the same grid `secondsToQuarters` already
 * quantizes to — so round-trips are approximate by the map's own policy.
 */
export function timeMapMapping(map: TimeMap): TimelineMapping {
  return {
    positionToSeconds: (position) => map.quartersToSeconds(new Rational(Math.round(position * 480), 480)),
    secondsToPosition: (seconds) => map.secondsToQuarters(seconds).toFloat(),
  };
}

export type {TimelineMapping};
