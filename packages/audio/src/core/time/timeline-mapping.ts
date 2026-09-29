import type {TimelineMapping} from '@webmusic/kernel/transport';
import type {BeatGrid} from './BeatGrid';

/**
 * Adapt a {@link BeatGrid} to the kernel's `TimelineMapping` contract
 * (position axis: beats). Pure delegation — BeatGrid is already number-based
 * and extrapolates past its ends.
 */
export function beatGridMapping(grid: BeatGrid): TimelineMapping {
  return {
    positionToSeconds: (position) => grid.beatToSeconds(position),
    secondsToPosition: (seconds) => grid.secondsToBeat(seconds),
  };
}

export type {TimelineMapping};
