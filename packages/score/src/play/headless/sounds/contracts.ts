import type {
  HeadlessSynth,
  OscillatorSynthOptions,
  SoundfontSample,
  SoundfontSynthOptions,
} from '../audio-contracts';
import type {SampleZone} from '../../core/sfz';

/** Internal backend shape accepted by the Sound lifecycle wrapper. */
export type SoundBackend = HeadlessSynth & {preload?: (...args: any[]) => Promise<void> | void};
export type SoundBackendFactory = (context: AudioContext) => SoundBackend;

/** Minimal Tone.js-style instrument shape supported by `Sound.from()`. */
export interface ToneInstrumentLike {
  triggerAttack?: (note: string, time?: number, velocity?: number) => unknown;
  triggerRelease?: (note: string, time?: number) => unknown;
  connect?: (destination: AudioNode) => unknown;
  disconnect?: () => unknown;
  dispose?: () => unknown;
}

export interface SoundOptions {
  /** Initial linear gain of this sound's bus, 0..1. Default 1. */
  gain?: number;
}

export interface Soundfont2Options extends SoundOptions {
  /** MIDI channel 0–15. Default 0. */
  channel?: number;
  /** SoundFont preset / program number 0–127. Default 0. */
  program?: number;
  /**
   * URL of spessasynth's AudioWorklet module. Supply this or `registerWorklet`
   * in every environment, including Vite (for example, a URL emitted by your
   * bundler's `?url` import or served from your app).
   */
  workletUrl?: string | URL;
  /**
   * Advanced escape hatch for applications that register the AudioWorklet
   * themselves. Called once per AudioContext instead of loading `workletUrl`.
   */
  registerWorklet?: (context: BaseAudioContext) => Promise<void> | void;
  /** Maximum SF2/SF3 source bytes accepted. Default 128 MiB. */
  maxSoundFontBytes?: number;
}

export interface SfzOptions extends SoundOptions {
  attackSeconds?: number;
  releaseSeconds?: number;
  /** Maximum bytes read for the `.sfz` definition itself. Default 1 MiB. */
  maxSfzBytes?: number;
  /** Maximum number of SFZ regions accepted for one sampler. Default 512. */
  maxZones?: number;
  /** Maximum simultaneous sample fetch/decode operations. Default 4. */
  maxConcurrentLoads?: number;
  /** Maximum compressed/source bytes accepted from one sample response. Default 32 MiB. */
  maxSampleBytes?: number;
  /** Maximum total compressed/source bytes retained across unique samples. Default 128 MiB. */
  maxTotalSampleBytes?: number;
  /** Maximum decoded PCM bytes retained for a single sample. Default 64 MiB. */
  maxDecodedSampleBytes?: number;
  /** Maximum decoded PCM bytes retained across unique samples. Default 256 MiB. */
  maxTotalDecodedSampleBytes?: number;
}

export interface FmOptions extends SoundOptions {
  /** Modulator:carrier frequency ratio. Default 2. */
  ratio?: number;
  /** Modulation index (carrier-frequency deviation in Hz). Default 200. */
  index?: number;
  carrierType?: OscillatorType;
  modulatorType?: OscillatorType;
  attackSeconds?: number;
  releaseSeconds?: number;
}

export interface WavetableOptions extends SoundOptions {
  /** Cosine partial amplitudes (PeriodicWave real terms). */
  real?: number[];
  /** Sine partial amplitudes (PeriodicWave imag terms). */
  imag?: number[];
  attackSeconds?: number;
  releaseSeconds?: number;
}

export interface NoiseOptions extends SoundOptions {
  /** Band-pass the noise at the played note's pitch. Default true. */
  pitched?: boolean;
  /** Band-pass resonance when `pitched`. Default 8. */
  Q?: number;
  attackSeconds?: number;
  releaseSeconds?: number;
}

/** Structural Web MIDI output shape, independent of lib.dom WebMIDI types. */
export interface MidiOutputLike {
  send(data: number[] | Uint8Array, timestamp?: number): void;
}

export interface MidiOutOptions extends SoundOptions {
  /** A specific MIDI output. If omitted, the first available output is requested. */
  output?: MidiOutputLike;
  /** MIDI channel 0–15. Default 0. */
  channel?: number;
}

export type {
  HeadlessSynth,
  OscillatorSynthOptions,
  SampleZone,
  SoundfontSample,
  SoundfontSynthOptions,
};
