import type {Score} from '@webmusic/score';
import {studyExcerpt} from './study-score';

/** Two passages of one piece make source replacement and mismatch observable. */
export function followerDemoScore(source: Score, alternate = false): Score {
  return studyExcerpt(source, alternate ? 24 : 16);
}
