// ============================================================================
// Playback control contract shared by both families. AudioClipPlayer
// satisfies it on the audio side; ScorePlayer and TonePlayer satisfy it
// structurally on the score side. Each family pins its players against the
// contract in its own src/play/headless/playerlike-contract.ts. For the pure
// clock/anchor math a player uses internally, see ./transport.
// ============================================================================

/**
 * Structural playback control contract.
 *
 * Members use method shorthand syntax DELIBERATELY: method bivariance is what
 * lets a typed-emitter `on<K extends keyof E>(...)` satisfy the loose
 * `on(event: string, ...)` here. Do not convert to arrow-property signatures —
 * under strictFunctionTypes that rejects every typed-emitter implementer.
 */
export interface PlayerLike {
  play(): Promise<void> | void;
  pause(): void;
  stop(): void;
  seek(seconds: number): void;
  setRate?(rate: number): void;
  setVolume?(volume: number): void;
  readonly seconds?: number;
  readonly duration?: number;
  readonly playing?: boolean;
  on(event: string, listener: (data: unknown) => void): () => void;
  dispose?(): void;
}

// ----------------------------------------------------------------------------
// Capability tiers. PlayerLike's optional members are deliberate: the base
// contract is the lowest common denominator both families can always promise.
// The interfaces below NAME each optional capability, and the guards are the
// supported feature-testing protocol — a generic consumer narrows with a
// guard once instead of poking optional members everywhere. Implementers
// advertise a capability by making its members non-optional; consumers must
// treat a failed guard as "capability absent", never as an error.
// ----------------------------------------------------------------------------

/** A player that reports timeline position and total duration in seconds. */
export interface TimedPlayerLike extends PlayerLike {
  readonly seconds: number;
  readonly duration: number;
}

/** A player whose playing state is readable synchronously. */
export interface StatefulPlayerLike extends PlayerLike {
  readonly playing: boolean;
}

/** A player with adjustable playback rate. */
export interface RateControlledPlayerLike extends PlayerLike {
  setRate(rate: number): void;
}

/** A player with adjustable output volume. */
export interface VolumeControlledPlayerLike extends PlayerLike {
  setVolume(volume: number): void;
}

/** A player owning resources that must be released when it is done. */
export interface DisposablePlayerLike extends PlayerLike {
  dispose(): void;
}

export function isTimedPlayer(player: PlayerLike): player is TimedPlayerLike {
  return typeof player.seconds === 'number' && typeof player.duration === 'number';
}

export function isStatefulPlayer(player: PlayerLike): player is StatefulPlayerLike {
  return typeof player.playing === 'boolean';
}

export function isRateControlledPlayer(player: PlayerLike): player is RateControlledPlayerLike {
  return typeof player.setRate === 'function';
}

export function isVolumeControlledPlayer(player: PlayerLike): player is VolumeControlledPlayerLike {
  return typeof player.setVolume === 'function';
}

export function isDisposablePlayer(player: PlayerLike): player is DisposablePlayerLike {
  return typeof player.dispose === 'function';
}
