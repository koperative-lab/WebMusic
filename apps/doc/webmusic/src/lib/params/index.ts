// The parameter catalog for Score web components, grouped the
// way the packages are: family × capability. <ElementPlayground> looks a tag up
// here and renders one live control per observed attribute.

import type {ElementParamCatalog} from './types';
import {SCORE_PLAY_PARAMS} from './score-play';
import {SCORE_VIEW_PARAMS} from './score-view';
import {SCORE_ANALYZE_PARAMS} from './score-analyze';

export type {ParamKind, ParamSpec, MemberSpec, ElementParamSpec, ElementParamCatalog} from './types';

export const ELEMENT_PARAMS: ElementParamCatalog = {
  ...SCORE_PLAY_PARAMS,
  ...SCORE_VIEW_PARAMS,
  ...SCORE_ANALYZE_PARAMS,
};
