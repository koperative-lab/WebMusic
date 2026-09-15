// ============================================================================
// @webmusic/score/play/element — Web Components: every custom element @webmusic/score/play
// ships, as ONE flat set. Imported via `@webmusic/score/play/element`, kept separate
// from the package's main entry so the data API tree-shakes free of any DOM /
// custom-element code for code-only consumers.
//
// Elements cover the capability, one per job:
//   <score-player>         play a Score back
//   <simple-score-player>  deprecated compatibility alias
//   <rack-control>         mix the members of a shared Rack
//   <rack-part>            declare one member of the desk it sits in
//   <note-input>           play notes by hand (piano / grid / chords / QWERTY)
//   <score-recorder>       capture a performance into a Score
//   <synth-panel>          shape the sound (sections sound / effects / …)
//
// `defineAllElements()` registers every element below; the drop-in
// `@webmusic/score/play/auto` entry just calls it for you.
// ============================================================================

export {
  ScoreRecorderElement,
  defineScoreRecorderElement,
  type ScoreRecorderErrorDetail,
  type ScoreRecorderRecordedDetail,
} from "./score-recorder";


export {
  NoteInputElement,
  defineNoteInputElement,
  qwertyMidi,
  qwertyOffsetIsBlack,
  gridCellMidi,
  gridPadIndex,
  gridPadMidi,
  gridRefToCoords,
  gridRefToIndex,
  gridIndexToRef,
  parseGridMap,
  GRID_ROW_LETTERS,
  DEFAULT_TR808_GRID_MAP,
  gridQwertyCellMidi,
  gridKeyboardMidi,
  DEFAULT_CHORDS,
  QWERTY_KEY_MAP,
  QWERTY_GRID_KEYS,
  QWERTY_GRID_ROWS,
  QWERTY_GRID_COLS,
  type NoteInputLayout,
  type NoteInputDetail,
  type NoteInputChord,
  type NoteInputPad,
} from "./note-input";


export {
  SynthPanelElement,
  defineSynthPanelElement,
  parseSections,
  lfoWave,
  type SynthPanelSection,
  type SoundParam,
  type Envelope,
  type EnvelopeRanges,
  type EqBand,
  type LfoShape,
  type LfoTarget,
  type MacroTarget,
  type SynthMacro,
  type MacroDetail,
  type SynthPanelEnvelopeErrorDetail,
  type SynthPanelLfoConfig,
  type SynthPanelLfoEventDetail,
  type SynthPanelLfoErrorDetail,
  type SynthPanelLfoState,
} from "./synth-panel";




// Players & transports
export {
  ScorePlayerElement,
  defineScorePlayerElement,
  SimpleScorePlayerElement,
  defineSimpleScorePlayerElement,
  type ScorePlayerPlaybackSnapshot,
  type ScorePlayerNoteEventDetail,
  type ScorePlayerTimeUpdateEventDetail,
} from "./score-player";
export {
  RackControlElement,
  defineRackControlElement,
  type RackControlErrorDetail,
} from "./rack-control";
export {
  RackPartElement,
  defineRackPartElement,
  type RackPartErrorDetail,
} from "./rack-part";

// Note input — `<note-input layout="…">` covers every discrete-note layout.

// ---- Imperative widget mounters (build a player UI without a custom element) ----
export {
  mountControllerPlayer,
  mountPresetPlayer,
  mountRackPlayer,
  createPlayerIcon,
  type ControllerPlayerOptions,
  type PresetPlayerHandle,
  type PresetPlayerOptions,
  type RackPlayerOptions,
} from "./internal/preset-player";

// ---- Pure helpers shared with custom UIs ----
export { pianoKeys, type PianoKey } from "../core/piano-keys";
export { formatTime } from "./internal/transport-format";

// ---- Registration ----
import { defineScoreRecorderElement } from "./score-recorder";
import { defineNoteInputElement } from "./note-input";
import { defineSynthPanelElement } from "./synth-panel";
import {
  defineScorePlayerElement,
  defineSimpleScorePlayerElement,
} from "./score-player";
import { defineRackControlElement } from "./rack-control";
import { defineRackPartElement } from "./rack-part";

/**
 * Register every `@webmusic/score/play` custom element at its default tag — the
 * one-call path behind the drop-in `@webmusic/score/play/auto` bundle. Call it once in
 * the browser, or import `@webmusic/score/play/auto` to have it called for you.
 * Idempotent: each `define*` skips a tag that is already defined.
 */
export function defineAllElements(): void {
  defineScoreRecorderElement();
  defineNoteInputElement();
  defineSynthPanelElement();
  defineScorePlayerElement();
  defineSimpleScorePlayerElement();
  defineRackControlElement();
  defineRackPartElement();
}
