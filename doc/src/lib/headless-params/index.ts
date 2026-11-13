// The catalog for every documented headless object, grouped the way the
// packages are: family × capability. <HeadlessPlayground> looks an object up
// here and renders its construction and live command controls.

import type {HeadlessObjectCatalog} from './types';
import {SCORE_PLAY_HEADLESS} from './score-play';
import {SCORE_ANALYZE_HEADLESS} from './score-analyze';
import {SCORE_VIEW_HEADLESS} from './score-view';

export type {
  HeadlessControlKind,
  HeadlessControlSpec,
  HeadlessObjectSpec,
  HeadlessObjectCatalog,
} from './types';

export const HEADLESS_OBJECTS: HeadlessObjectCatalog = {
  ...SCORE_PLAY_HEADLESS,
  ...SCORE_ANALYZE_HEADLESS,
  ...SCORE_VIEW_HEADLESS,
};
