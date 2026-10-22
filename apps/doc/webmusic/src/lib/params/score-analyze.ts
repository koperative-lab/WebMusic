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
const KEY = {name: 'key', kind: 'text', placeholder: 'C major', fallback: 'no key-relative degree', note: 'Explicit tonic and mode for chord interpretation; never guesses a key.'} as const;
const ALTERNATES = {name: 'alternates', kind: 'enum', options: ['show', 'hide'], fallback: 'show', note: 'Show or hide static alternate readings below the live chord symbol.'} as const;
const STABILITY = {name: 'stability-ms', kind: 'number', min: 0, max: 1000, step: 10, fallback: '80', note: 'Delay the chord-change event until a displayed name remains stable; 0 emits immediately.'} as const;
const MODE = {name: 'mode', kind: 'enum', options: ['score', 'live'], fallback: 'score', note: 'Inspect a score passage or display the player’s currently sounding chord.'} as const;
const GROUPING = {name: 'grouping', kind: 'enum', options: ['beat', 'simultaneous'], fallback: 'beat', note: 'Score mode: collect pitches within each metrical beat, or inspect only simultaneous notes. Independent of the visible window.'} as const;
const PITCH_MODE = {name: 'pitch-mode', kind: 'enum', options: ['written', 'sounding'], fallback: 'written', note: 'Use written pitches or apply each part’s declared transposition.'} as const;
const PART = {name: 'part', kind: 'text', placeholder: 'P1', fallback: 'all parts', note: 'Inspect only the part with this exact ID.'} as const;
const VOICE = {name: 'voice', kind: 'text', placeholder: '1', fallback: 'all voices', note: 'Inspect only this voice ID within the selected parts.'} as const;
const KIND = {name: 'kind', kind: 'enum', options: ['melodic', 'harmonic', 'both'], fallback: 'melodic', note: 'Consecutive notes within a voice, simultaneous notes, or both.'} as const;
const TONIC = {name: 'tonic', kind: 'text', placeholder: 'C', fallback: 'choose a tonic', note: 'Explicit spelled tonic, such as C, F# or Bb; never estimated.'} as const;
const SCALE = {name: 'scale', kind: 'enum', options: ['major', 'natural-minor', 'harmonic-minor', 'melodic-minor-ascending', 'melodic-minor-descending'], fallback: 'major', note: 'Textbook scale form used to spell degrees and check selected notes.'} as const;
const BEAT_GROUPS = {name: 'beat-groups', kind: 'text', placeholder: '2+3', fallback: 'conventional simple/compound grouping', note: 'Positive denominator-unit groups such as 2+3; each grouping applies to the numerator it sums to, and several groupings are separated by spaces or commas.'} as const;
const SUBDIVISION = {name: 'subdivision', kind: 'enum', options: ['1', '2', '3', '4'], fallback: '2', note: 'Equal subdivisions of each metrical beat.'} as const;
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
  'score-chord-analysis': {tag: 'score-chord-analysis', entry: ENTRY, params: [...LANE, MODE, GROUPING, BEAT_GROUPS, SPELLING, KEY, PITCH_MODE, ALTERNATES, STABILITY], properties: [...LANE_PROPERTIES, {name: 'mode', note: 'Reflected score/live mode.'}, {name: 'grouping', note: 'Reflected score collection scope; beat by default.'}, {name: 'spelling', note: 'Reflects pitch spelling.'}, {name: 'key', note: 'Explicit tonic/mode interpretation, if assigned.'}, {name: 'pitchMode', note: 'Written or sounding score pitches.'}, {name: 'stabilityMs', note: 'Reflected live chord-change delay in milliseconds.'}, {name: 'chord', note: 'Read-only current live chord symbol, or undefined.'}], events: [...SEEK, SELECT, CHORD_CHANGE]},
  'score-interval-analysis': {tag: 'score-interval-analysis', entry: ENTRY, params: [...LANE, PART, VOICE, KIND, PITCH_MODE], properties: [...LANE_PROPERTIES, {name: 'pitchMode', note: 'Written or sounding pitch comparison.'}, {name: 'selectNotes', note: 'Inspect exact note IDs without seeking playback.'}], events: [...SEEK, SELECT]},
  'score-scale-analysis': {tag: 'score-scale-analysis', entry: ENTRY, params: [...LANE, PART, VOICE, TONIC, SCALE, PITCH_MODE], properties: [...LANE_PROPERTIES, {name: 'tonic', note: 'Explicit spelled tonic or undefined.'}, {name: 'scale', note: 'Reflected textbook scale form.'}, {name: 'pitchMode', note: 'Written or sounding pitch comparison.'}, {name: 'selectNotes', note: 'Inspect exact note IDs without seeking playback.'}], events: [...SEEK, SELECT]},
  'score-rhythm-analysis': {tag: 'score-rhythm-analysis', entry: ENTRY, params: [...LANE, PART, BEAT_GROUPS, SUBDIVISION], properties: LANE_PROPERTIES, events: [...SEEK, SELECT]},
};
