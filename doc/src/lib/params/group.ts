import type {ParamGroup, ParamSpec} from './types';

// The name rule behind `paramGroup`. An attribute it would file wrongly sets
// `group` in its catalog entry instead of adding an exception here.

/** Where material comes from and what the element is connected to. */
const DATA = new Set(['src', 'format', 'peaks-src', 'input', 'port', 'target', 'session', 'slot', 'id', 'sound-font', 'device-id']);

/** Appearance only: never what the element plays, edits or measures. */
const STYLE = new Set(['width', 'height', 'size', 'theme', 'density', 'scheme', 'amplitude', 'color', 'color-map', 'color-mode', 'device-pixel-ratio']);
const STYLE_SUFFIX = /-(?:color|width|height|spacing)$/;

/** Which of param, style and data an attribute is (see `ParamGroup`). */
export function paramGroup(param: ParamSpec): ParamGroup {
  if (param.group) return param.group;
  if (DATA.has(param.name)) return 'data';
  if (STYLE.has(param.name) || STYLE_SUFFIX.test(param.name)) return 'style';
  return 'param';
}
