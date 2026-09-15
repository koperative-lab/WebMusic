// ============================================================================
// @webmusic/score/play/headless — code-only playback components and actions. This
// entry owns no UI: it does not create or mutate DOM, define Custom Elements,
// or install styles. Browser input binding lives in `@webmusic/score/play/drivers`.
//
// Pair with:
//   @webmusic/score/play/api      — public data/configuration facade
//   @webmusic/score/play/element  — styled Web Components built on these engines
// ============================================================================

// ---- Score Player (THE playback engine: scheduling + transport surface) ----
export type {PlaybackListenerError, PlaybackOperationError} from './playback-events';

export {
  ScorePlayer,
  createScorePlayer,
  createScorePlayerFromUrl,
  playScore,
  playScoreFromUrl,
  Player,
  type ScorePlayerOptions,
  type ScorePlayerEvents,
  type PlayerOptions,
  type PlayerEvents,
  type PlayerTimeUpdate,
} from './audio';

// ---- Sound: uniform timbre wrapper (samples / sfz / sf2 / synth / custom) ----
export {
  Sound,
  RangeSampler,
  chooseZone,
  playbackRateFor,
  type SoundOptions,
  type Soundfont2Options,
  type SfzOptions,
  type FmOptions,
  type WavetableOptions,
  type NoiseOptions,
  type MidiOutOptions,
  type MidiOutputLike,
  type SampleZone,
  type ToneInstrumentLike,
} from './sound';

// ---- Live input drivers for the pull engine (clock + Web MIDI) ----
export {
  Metronome,
  bindClock,
  bindMidiInput,
  type ClockOptions,
  type MidiInputOptions,
  type MidiInputLike,
} from './inputs';

// ---- Synths, reverb, and the synth contract ----
export {
  createOscillatorSynth,
  createSoundfontSynth,
  createReverbNode,
  OscillatorSynth,
  SoundfontSynth,
  type HeadlessSynth,
  type PreloadableHeadlessSynth,
  type SynthBackend,
  type SynthOwnership,
  type SynthRouteCleanup,
  type OscillatorSynthOptions,
  type SoundfontSynthOptions,
  type SoundfontSample,
  type ReverbOptions,
} from './audio';

// ---- `SpessaSynthSynth` adopts an *existing* spessasynth instance
// (`Sound.soundfont2` builds one from a source). ----
export {SpessaSynthSynth} from './synth';

// ---- Tone.js-backed player adapter ----
export {
  TonePlayer,
  type ToneLike,
  type ToneTransportLike,
  type ToneTransportOwnership,
  type TonePlayerEvents,
  type TonePlayerOptions,
} from './tone-player';

// ---- Transport controllers driven by external input ----
export {
  MidiPlayerController,
  PlayerController,
  type ControllerEvent,
  type ControllerEvents,
  type PlayerTransportState,
} from './controller';

// ---- Borrowed Rack transport state and clock ----
export {
  RackTransportController,
  createRackTransportController,
  type RackTransportEvents,
  type RackTransportOptions,
  type RackTransportState,
} from './rack-transport';

// ---- DOM-free tap tempo / conducted-play controller ----
export {
  TempoController,
  appendTap,
  tapBpm,
  TAP_RESET_GAP,
  TAP_WINDOW,
  type AdvanceTarget,
  type TempoConductMode,
  type TempoControllerConfig,
  type TempoControllerOptions,
  type TempoControllerState,
  type TempoMode,
  type TempoPressResult,
} from './tempo';

// ---- DOM-free low-frequency modulation controller ----
export {
  LfoController,
  createLfoController,
  lfoWave,
  LFO_SHAPES,
  type LfoCancelFrame,
  type LfoControllerConfig,
  type LfoControllerOptions,
  type LfoControllerState,
  type LfoFrameCallback,
  type LfoRequestFrame,
  type LfoShape,
  type LfoTarget,
} from './lfo';

// ---- Graphic equalizer graph and response controller ----
export {
  EqController,
  createEqController,
  eqFrequencyToX,
  eqGainToY,
  eqXToFrequency,
  eqYToGain,
  DEFAULT_EQ_BANDS,
  EQ_MAX_FREQUENCY,
  EQ_MAX_GAIN,
  EQ_MIN_FREQUENCY,
  EQ_RESPONSE_SAMPLES,
  type EqBand,
  type EqControllerOptions,
  type EqControllerState,
  type EqResponsePoint,
} from './eq';

export {
  LevelMeterController,
  createLevelMeterController,
  type LevelMeterControllerOptions,
  type LevelMeterFrame,
} from './meter';

// ---- Rack (compose single-instrument players into a synchronised group) ----
export {
  Rack,
  createRack,
  type RackOptions,
  type RackAddOptions,
  type RackMember,
  type RackMemberMode,
  type RackEvents,
} from './rack';

// ---- Effects (post-processing chain) ----
export {
  Effect,
  insertEffect,
  resolveEffect,
  type EffectNode,
  type DelayOptions,
  type FilterOptions,
  type DistortionOptions,
  type CompressorOptions,
  type LimiterOptions,
  type AnalyserOptions,
  type BitcrusherOptions,
  type TremoloOptions,
  type ChorusOptions,
} from './effects';

// ---- Interactive (event-driven, signal-input) player ----
export {
  InteractivePlayer,
  createInteractivePlayer,
  type InteractivePlayerOptions,
  type InteractivePlayerEvents,
  type BeatNote,
  type NoteInput,
  type VoiceResolver,
  type SourceRoute,
  type AddSourceOptions,
  type AddVoiceOptions,
  type AdvanceOptions,
} from './interactive-player';

// ---- DOM-free score recording take/session model ----
export {
  ScoreRecorderSession,
  recordedNotesToScore,
  recorderNow,
  SCORE_RECORDER_VOICE,
  type ScoreRecorderNotationOptions,
  type ScoreRecorderRecordedDetail,
} from './recorder';

// ---- Reusable Web Audio resource owner for composed synth panels ----
export {
  SynthPanelAudioGraph,
  type SynthPanelAudioOptions,
  type SynthPanelSection,
} from './synth-panel-audio';

// ---- Loop player (A–B loop region over a ScorePlayer) ----
export {LoopPlayer, createLoopPlayer, type LoopPlayerOptions} from './loop-player';

// ---- A/B player (live switching between named arrangements) ----
export {AbPlayer, createAbPlayer, type AbPlayerOptions} from './ab-player';

// ---- Offline code-only rendering / encoding actions -----------------------
export {
  renderScoreToBuffer,
  renderScoreToWav,
  bufferToWav,
  type RenderOptions,
} from './render';
import type {PlayerLikeKernelContract} from './playerlike-contract';

// Keep the compile-time kernel contract reachable without emitting a bare
// runtime import into otherwise side-effect-free bundles.
type _PlayerLikeKernelContractAnchor = PlayerLikeKernelContract;
