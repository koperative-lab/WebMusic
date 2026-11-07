import {createCapabilityKey} from '@webmusic/kernel/module';

/** The owner of an Audio playback (in a browser, the `<audio-player>` element). */
export interface AudioPlayerOwner {
  readonly player?: unknown;
}

/**
 * Lent by an `<audio-player>` scope (DEC-068): nested companions — playlist
 * queue, recorder audition, views — find the enclosing player through the
 * module context instead of a tag lookup or a `player=` selector.
 */
export const AUDIO_PLAYER_OWNER = createCapabilityKey<AudioPlayerOwner>('audio.player-owner');
