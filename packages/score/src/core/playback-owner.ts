import {createCapabilityKey} from '@webmusic/kernel/module';
import type {ScorePlaybackSource} from './playback';

/** The owner (in a browser, the player or part element) of a Score playback source that companions borrow. */
export interface ScorePlaybackOwner {
  readonly playback?: ScorePlaybackSource;
}

/**
 * Lent by a Score player or Rack part scope (DEC-068): views and analysis
 * nested inside it borrow its playback source by containment instead of a
 * `player=` selector. In a browser the value is the owning element.
 */
export const SCORE_PLAYBACK_OWNER = createCapabilityKey<ScorePlaybackOwner>('score.playback-owner');
