// @webmusic/score/view/element — composable view families.
// Importing this entry registers nothing. Each instance renders one type.

export {
  ScoreViewElement,
  defineScoreViewElement,
  parseColorAttr,
  type ScoreViewType,
  type ScoreViewElementType,
  type ScoreViewRenderOptions,
  type ScoreViewConfiguration,
  type ScoreViewOptionsByType,
  type ScoreViewDirection,
} from './score-view';
export {
  ScoreGridViewElement,
  defineScoreGridViewElement,
  type ScoreGridFeature,
  type ScoreGridSettings,
  type ScoreGridSettingsChangeDetail,
  type ScoreGridSnap,
  type ScoreGridTool,
} from './score-grid-view';
export {PitchViewElement, definePitchViewElement, type PitchViewType, type PitchViewDirection} from './score-pitch-view';
export {
  SheetViewElement,
  SHEET_VIEW_FEATURES,
  defineSheetViewElement,
  type ScoreSheetDuration,
  type ScoreSheetFeature,
  type ScoreSheetLayout,
  type ScoreSheetSettings,
  type ScoreSheetSettingsChangeDetail,
} from './score-sheet-view';

import {defineScoreViewElement} from './score-view';
import {defineScoreGridViewElement} from './score-grid-view';
import {definePitchViewElement} from './score-pitch-view';
import {defineSheetViewElement} from './score-sheet-view';

/** Register every score View Element. Idempotent and SSR-safe. */
export function defineAllViewElements(): void {
  defineScoreViewElement();
  defineScoreGridViewElement();
  definePitchViewElement();
  defineSheetViewElement();
}
