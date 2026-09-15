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
const FUNCTION = {name: 'function', kind: 'enum', options: ['show', 'hide'], fallback: 'show', note: 'Show or hide the harmonic-function row in a Roman-numeral lane.'} as const;
const ALTERNATES = {name: 'alternates', kind: 'enum', options: ['show', 'hide'], fallback: 'show', note: 'Show or hide alternate readings on the live chord nameplate.'} as const;
const CORE: readonly ParamSpec[] = [SRC, FORMAT, PLAYER, DENSITY, SCHEME];
const LANE: readonly ParamSpec[] = [...CORE, MOTION, WINDOW];
const DISPLAY_PROPERTIES: readonly MemberSpec[] = [
  {name: 'density', note: 'Reflects density.'},
  {name: 'scheme', note: 'Reflects scheme; undefined removes the override.'},
  {name: 'spelling', note: 'Reflects pitch spelling.'},
];
const SCORE_PROPERTIES: readonly MemberSpec[] = [{name: 'score', note: 'Explicit Score overrides src and player data.'}, ...DISPLAY_PROPERTIES.filter((property) => property.name !== 'spelling')];
const LANE_PROPERTIES: readonly MemberSpec[] = [...SCORE_PROPERTIES, {name: 'motion', note: 'Reflects motion.'}, {name: 'window', note: 'Visible duration in seconds or auto.'}];
const SEEK: readonly MemberSpec[] = [{name: 'webscore:seek', note: '{quarters, seconds} on score navigation; seconds are nominal.'}];
const CHORD_CHANGE: MemberSpec = {name: 'webscore:chordchange', note: '{chord, midis} when the detected chord changes to a nonempty name; silence/reset clear the display without this event.'};
const CHORD_PICK: MemberSpec = {name: 'webscore:chordpick', note: '{symbol, kind, midis} when an alternate current-chord reading is selected.'};

export const SCORE_ANALYZE_PARAMS: ElementParamCatalog = {
  'key-analysis': {tag: 'key-analysis', entry: ENTRY, params: LANE, properties: LANE_PROPERTIES, events: SEEK},
  'chord-analysis': {tag: 'chord-analysis', entry: ENTRY, params: LANE, properties: LANE_PROPERTIES, events: SEEK},
  'voice-leading-analysis': {tag: 'voice-leading-analysis', entry: ENTRY, params: LANE, properties: LANE_PROPERTIES, events: SEEK},
  'roman-analysis': {tag: 'roman-analysis', entry: ENTRY, params: [...LANE, FUNCTION], properties: LANE_PROPERTIES, events: SEEK},
  'live-chord-analysis': {tag: 'live-chord-analysis', entry: ENTRY, params: [{...PLAYER, note: 'Borrow held notes, state and note events from one selected player; no score input is read.'}, DENSITY, SCHEME, SPELLING, ALTERNATES], properties: [...DISPLAY_PROPERTIES, {name: 'chord', note: 'Read-only current displayed chord symbol, or undefined for silence.'}], events: [CHORD_CHANGE, CHORD_PICK]},
};
