// The parameter catalog for Score / Audio web components, grouped the
// way the packages are: family × capability. <ElementDemo> takes each tag's
// entry from here; the site checks and other tools read the whole catalog.

import type {ElementParamCatalog} from './types';
import {SCORE_PLAY_PARAMS} from './score-play';
import {SCORE_VIEW_PARAMS} from './score-view';
import {SCORE_ANALYZE_PARAMS} from './score-analyze';
import {AUDIO_PLAY_PARAMS} from './audio-play';
import {AUDIO_VIEW_PARAMS} from './audio-view';
import {AUDIO_ANALYZE_PARAMS} from './audio-analyze';

export type {ParamGroup, ParamKind, ParamSpec, MemberSpec, ElementParamSpec, ElementParamCatalog} from './types';
export {paramGroup} from './group';

export const ELEMENT_PARAMS: ElementParamCatalog = {
  ...SCORE_PLAY_PARAMS,
  ...SCORE_VIEW_PARAMS,
  ...SCORE_ANALYZE_PARAMS,
  ...AUDIO_PLAY_PARAMS,
  ...AUDIO_VIEW_PARAMS,
  ...AUDIO_ANALYZE_PARAMS,
};
