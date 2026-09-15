// @webmusic/score/play/api — public configuration and stateless data facade.
// Executable playback components/actions live in `@webmusic/score/play/headless`.
export {
  DEFAULT_SFZ_PARSE_LIMITS,
  parseSfz,
  parseSfzKey,
  resolveSfzZones,
  type SfzParseOptions,
  type SfzRegion,
  type SampleZone,
  notesToScore,
  type RecordedNote,
  type RecordToScoreOptions,
} from '../core';
export {
  renderScoreToBuffer,
  renderScoreToWav,
  bufferToWav,
  type RenderOptions,
} from '../headless/render';
export type {
  HeadlessSynth,
  OscillatorSynthOptions,
  PlayerEvents,
  PlayerOptions,
  PlayerTimeUpdate,
  ReverbOptions,
  ScorePlayerEvents,
  ScorePlayerOptions,
  SoundfontSynthOptions,
  SynthBackend,
  SynthOwnership,
} from '../headless/audio-contracts';
export type {
  InteractivePlayerEvents,
  InteractivePlayerOptions,
  AddSourceOptions,
  AddVoiceOptions,
  AdvanceOptions,
} from '../headless/interactive/contracts';
export type {RackAddOptions, RackEvents, RackOptions} from '../headless/rack/contracts';
export type {LoopPlayerOptions} from '../headless/loop-player';
export type {AbPlayerOptions} from '../headless/ab-player';

// Stateless note-surface mappings shared by Elements and custom renderers.
export {
  DEFAULT_CHORDS,
  DEFAULT_TR808_GRID_MAP,
  GRID_ROW_LETTERS,
  gridCellMidi,
  gridIndexToRef,
  gridKeyboardMidi,
  gridPadIndex,
  gridPadMidi,
  gridQwertyCellMidi,
  gridRefToCoords,
  gridRefToIndex,
  normalizeNoteInputLayout,
  parseGridMap,
  qwertyLabelMap,
  qwertyMidi,
  qwertyOffsetIsBlack,
  QWERTY_GRID_COLS,
  QWERTY_GRID_KEYS,
  QWERTY_GRID_ROWS,
  QWERTY_KEY_LABEL,
  QWERTY_KEY_MAP,
  QWERTY_SPAN,
  type NoteInputChord,
  type NoteInputDetail,
  type NoteInputLayout,
  type NoteInputPad,
} from '../core/note-input-model';
