import type {Effect} from '../effects';
import type {HeadlessSynth, ReverbOptions, SynthOwnership} from '../audio-contracts';
import type {PlaybackListenerError, PlaybackOperationError} from '../playback-events';

/** One playable note in a beat-indexed score source. */
export interface BeatNote {
  midi: number;
  velocity: number;
  /** Written/tied duration measured on the source's notated beat grid. */
  durationBeats: number;
  /**
   * Effective sounding duration in source seconds. It preserves performed
   * timing overrides and the furthest endpoint of a merged tie chain. The pull
   * engine still places attacks on its caller-owned written beat grid; the
   * source retains trailing empty beats through a performed tail before wrap.
   */
  durationSeconds: number;
  /** Fractional *written* onset inside the caller-driven containing beat. */
  onsetInBeat: number;
  part: string;
  voice?: string;
}

/** A note supplied directly by a host without a Score. */
export interface NoteInput {
  midi: number;
  velocity?: number;
  durationSeconds?: number;
  voice?: string;
  timeOffsetSeconds?: number;
}

export type VoiceResolver = (note: BeatNote, sourceId: string) => string | undefined;
export type SourceRoute = Record<string, string> | ((part: string) => string | undefined);

export interface AddSourceOptions {
  beatUnitQuarters?: number;
  route?: SourceRoute;
}

export interface AddVoiceOptions {
  volume?: number;
  muted?: boolean;
  effect?: Effect;
  /** Whether InteractivePlayer disposal owns a supplied synth (default: borrowed). */
  synthOwnership?: SynthOwnership;
}

export interface AdvanceOptions {
  /** Override the duration of one beat with a host-measured interval. */
  secondsPerBeat?: number;
}

export interface InteractivePlayerOptions {
  /** Borrow this context. When destination is also supplied, both identities must match. */
  audioContext?: AudioContext;
  /** Borrow this route target; without audioContext, its destination.context is the graph context. */
  destination?: AudioNode;
  reverb?: false | ReverbOptions;
  effect?: Effect;
  lookaheadSeconds?: number;
  masterVolume?: number;
  resolveVoice?: VoiceResolver;
  defaultVoice?: string;
}

export interface InteractivePlayerEvents {
  beat: {source: string; beat: number; total: number; notes: BeatNote[]};
  noteOn: {voice: string; midi: number; velocity: number; time: number};
  noteOff: {voice: string; midi: number; time: number};
  sourceChange: {source: string; beat: number; total: number};
  wrap: {source: string};
  operationError: PlaybackOperationError;
  listenerError: PlaybackListenerError;
}

export type {HeadlessSynth};
