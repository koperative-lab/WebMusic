// Complete observed-attribute catalogs for atomic Score Analyze components.
import type {ElementParamCatalog, ParamSpec, MemberSpec} from './types';
const ENTRY = '@webmusic/score/analyze/element';
const SRC = {name: 'src', kind: 'text', placeholder: 'song.mid', fallback: 'borrow player data, else await .score', note: 'Explicit score URL; overrides the selected player’s resolved score.'} as const;
const FORMAT = {name: 'format', kind: 'enum', options: ['midi', 'mxl', 'musicxml', 'abc'], fallback: 'extension, else byte detection', note: 'Parser override for an explicit source URL.'} as const;
const PLAYER = {name: 'player', kind: 'text', placeholder: '#my-player', fallback: 'standalone data or waiting for notes', note: 'Unique player selector in the current Document or ShadowRoot; borrow available data and state.'} as const;
const DENSITY = {name: 'density', kind: 'enum', options: ['comfortable', 'compact'], fallback: 'comfortable', note: 'Type and spacing defaults for this single surface.'} as const;
const SCHEME = {name: 'scheme', kind: 'enum', options: ['light', 'dark'], fallback: 'inherit the page', note: 'Explicit palette for this surface.'} as const;
const SPELLING = {name: 'spelling', kind: 'enum', options: ['auto', 'sharp', 'flat'], fallback: 'auto', note: 'Pitch-name spelling; automatic uses the available key context.'} as const;
const MOTION = {name: 'motion', kind: 'enum', options: ['auto', 'continuous', 'stepped', 'none'], fallback: 'auto', note: 'Lane motion; auto follows a data-motion ancestor and reduced-motion preference.'} as const;
const WINDOW = {name: 'window', kind: 'text', placeholder: '8', fallback: 'auto', note: 'Visible duration across the available width, 0.5–600 seconds; auto uses score context.'} as const;
const KEY = {name: 'key', kind: 'text', placeholder: 'C major', fallback: 'estimated score key', note: 'Local tonic and mode for the selected chord degree; does not edit the Score.'} as const;
const ALTERNATES = {name: 'alternates', kind: 'enum', options: ['show', 'hide'], fallback: 'show', note: 'Show or hide static alternate readings below the live chord symbol.'} as const;
const STABILITY = {name: 'stability-ms', kind: 'number', min: 0, max: 1000, step: 10, fallback: '80', note: 'Delay the chord-change event until a displayed name remains stable; 0 emits immediately.'} as const;
const CORE: readonly ParamSpec[] = [SRC, FORMAT, PLAYER, DENSITY, SCHEME];
const LANE: readonly ParamSpec[] = [...CORE, MOTION, WINDOW];
const DISPLAY_PROPERTIES: readonly MemberSpec[] = [{name: 'density', note: 'Reflects density.'}, {name: 'scheme', note: 'Reflects scheme; undefined removes the override.'}];
const LANE_PROPERTIES: readonly MemberSpec[] = [
  {name: 'score', note: 'Explicit Score overrides src and player data.'},
  ...DISPLAY_PROPERTIES,
  {name: 'motion', note: 'Reflects motion.'},
  {name: 'window', note: 'Visible duration in seconds or auto.'},
  {name: 'selection', note: 'Read-only selected quarter-note region.'},
  {name: 'analysis', note: 'Read-only evidence for the current local selection.'},
  {name: 'selectRegion', note: 'Inspect a quarter-note region without commanding playback.'},
  {name: 'clearSelection', note: 'Clear the local region selection.'},
];
const SEEK: readonly MemberSpec[] = [{name: 'webscore:seek', note: '{quarters, seconds} on score navigation; seconds are nominal.'}];
const SELECT: MemberSpec = {name: 'webscore:analysisselect', note: '{kind, id, startQuarters, endQuarters} when local evidence is selected.'};
const CHORD_CHANGE: MemberSpec = {name: 'webscore:chordchange', note: '{chord, midis} after a nonempty displayed chord remains stable; silence/reset cancel it.'};

export const SCORE_ANALYZE_PARAMS: ElementParamCatalog = {
  'score-live-chord-analysis': {tag: 'score-live-chord-analysis', entry: ENTRY, params: [{...PLAYER, note: 'Borrow held notes, state and note events from one selected player; no score input is read.'}, DENSITY, SCHEME, SPELLING, ALTERNATES, STABILITY], properties: [...DISPLAY_PROPERTIES, {name: 'spelling', note: 'Reflects pitch spelling.'}, {name: 'stabilityMs', note: 'Reflected chord-change event delay in milliseconds.'}, {name: 'chord', note: 'Read-only current displayed chord symbol, or undefined for silence.'}], events: [CHORD_CHANGE]},
  'score-chord-analysis': {tag: 'score-chord-analysis', entry: ENTRY, params: [...LANE, SPELLING, KEY], properties: [...LANE_PROPERTIES, {name: 'spelling', note: 'Reflects pitch spelling.'}, {name: 'key', note: 'Local tonic/mode interpretation, if assigned.'}], events: [...SEEK, SELECT]},
};
