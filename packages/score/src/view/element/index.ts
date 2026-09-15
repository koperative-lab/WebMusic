// @webmusic/score/view/element — three composable view families.
// Importing this entry registers nothing. Each instance renders one type.

export {
  ScoreViewElement,
  defineScoreViewElement,
  parseColorAttr,
  type ScoreViewType,
  type ScoreViewElementType,
  type ScoreViewRenderOptions,
  type ScoreViewSeekDetail,
  type ScoreViewConfiguration,
  type ScoreViewOptionsByType,
} from './score-view';
export {PitchViewElement, definePitchViewElement, type PitchViewType} from './pitch-view';
export {SheetViewElement, defineSheetViewElement} from './sheet-view';

import {defineScoreViewElement} from './score-view';
import {definePitchViewElement} from './pitch-view';
import {defineSheetViewElement} from './sheet-view';

/** Register the three view families. Idempotent and SSR-safe. */
export function defineAllViewElements(): void {
  defineScoreViewElement();
  definePitchViewElement();
  defineSheetViewElement();
}
