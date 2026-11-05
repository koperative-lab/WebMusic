import type {Score} from '@webmusic/score';
import {arabesqueExcerpt} from './arabesque-score';

/** Two passages of one piece make source replacement and mismatch observable. */
export function followerDemoScore(source: Score, alternate = false): Score {
  return arabesqueExcerpt(source, alternate ? 24 : 16);
}
