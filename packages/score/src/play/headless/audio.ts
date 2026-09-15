// Stable compatibility facade for the headless audio engine. Implementations
// are split by responsibility; existing imports keep the same surface.
export {
  ScorePlayer,
  ScorePlayer as Player,
  createScorePlayer,
  createScorePlayerFromUrl,
  playScore,
  playScoreFromUrl,
} from './score-player';
export {OscillatorSynth, createOscillatorSynth} from './oscillator-synth';
export {SoundfontSynth, createSoundfontSynth} from './soundfont-synth';
export {createReverbNode} from './audio-utils';
export type {
  HeadlessSynth,
  OscillatorSynthOptions,
  PlayerEvents,
  PlayerOptions,
  PlayerTimeUpdate,
  ReverbOptions,
  ScorePlayerEvents,
  ScorePlayerOptions,
  PreloadableHeadlessSynth,
  SoundfontSample,
  SoundfontSynthOptions,
  SynthOwnership,
  SynthBackend,
  SynthRouteCleanup,
} from './audio-contracts';
