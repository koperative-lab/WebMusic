import type {Score} from '../../../core';
import type {Effect} from '../effects';
import type {HeadlessSynth, SynthOwnership} from '../audio-contracts';
import type {ScorePlayer} from '../score-player';
import type {InteractivePlayer} from '../interactive-player';
import type {PlaybackListenerError, PlaybackOperationError} from '../playback-events';

export type RackMemberMode = 'timeline' | 'interactive';

export interface RackOptions {
  /** Borrow this context. When destination is also supplied, both identities must match. */
  audioContext?: AudioContext;
  /** Borrow this route target; without audioContext, its destination.context is the graph context. */
  destination?: AudioNode;
  /** Rack-level effect applied to the summed output. */
  effect?: Effect;
  /** Master linear volume from 0 to 1. */
  masterVolume?: number;
}

export interface RackAddOptions {
  id?: string;
  score: Score;
  sound?: HeadlessSynth;
  /** Whether Rack/player disposal owns a supplied sound (default: borrowed). */
  soundOwnership?: SynthOwnership;
  effect?: Effect;
  volume?: number;
  mode?: RackMemberMode;
  tempo?: number;
  beatUnitQuarters?: number;
}

export interface RackMember {
  readonly id: string;
  readonly mode: RackMemberMode;
  readonly player: ScorePlayer | InteractivePlayer | undefined;
  /**
   * The member's own level, `0…1`, as `setVolume` last left it.
   *
   * Readable because a mixing surface has to render FROM the rack rather than
   * from a copy it keeps beside it: `<rack-control>` used to mirror every level
   * in a private Map, which is a second source of truth that drifts the moment
   * anything else calls `setVolume`.
   */
  readonly volume: number;
  readonly muted: boolean;
  readonly solo: boolean;
}

export interface RackEvents {
  end: void;
  memberEnd: {id: string};
  memberschange: void;
  /**
   * A level, mute, solo or the master moved.
   *
   * Separate from `memberschange` because the two mean different things to a
   * listener: membership changing is a reason to rebuild a surface, a level
   * changing is a reason to repaint one. Without this, anything driving the
   * rack from outside a mixer left that mixer showing the old position.
   */
  mixchange: void;
  operationError: PlaybackOperationError;
  listenerError: PlaybackListenerError;
}

export interface InternalRackMember {
  id: string;
  mode: RackMemberMode;
  score: Score;
  sound?: HeadlessSynth;
  soundOwnership?: SynthOwnership;
  effect?: Effect;
  tempo?: number;
  beatUnitQuarters?: number;
  volume: number;
  muted: boolean;
  solo: boolean;
  gain?: GainNode;
  player?: ScorePlayer | InteractivePlayer;
  timelineEndUnsubscribe?: () => void;
  operationErrorUnsubscribe?: () => void;
  ended: boolean;
}
