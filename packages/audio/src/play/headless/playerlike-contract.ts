// ============================================================================
// Compile-time assertion that the audio-family player structurally satisfies
// the kernel PlayerLike playback control contract (@webmusic/kernel/player),
// mirroring packages/score/src/play/headless/playerlike-contract.ts.
//
// Pure type-level module: it emits no runtime code and is imported from the
// headless entry solely so the architecture checker's reachability gate sees
// it. If AudioClipPlayer drifts from the contract or from a capability tier
// it advertises, the `Satisfies` constraints below fail typecheck.
// ============================================================================

import type {
  DisposablePlayerLike,
  PlayerLike,
  RateControlledPlayerLike,
  StatefulPlayerLike,
  TimedPlayerLike,
  VolumeControlledPlayerLike,
} from '@webmusic/kernel/player';
import type {AudioClipPlayer} from './player';

type Satisfies<T extends U, U> = T;

export type PlayerLikeKernelContract = [
  Satisfies<AudioClipPlayer, PlayerLike>,
  // Capability tiers the player advertises (non-optional members). A guard
  // like isTimedPlayer() must keep returning true for this player.
  Satisfies<AudioClipPlayer, TimedPlayerLike>,
  Satisfies<AudioClipPlayer, StatefulPlayerLike>,
  Satisfies<AudioClipPlayer, RateControlledPlayerLike>,
  Satisfies<AudioClipPlayer, VolumeControlledPlayerLike>,
  Satisfies<AudioClipPlayer, DisposablePlayerLike>,
];
