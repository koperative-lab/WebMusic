// ============================================================================
// Compile-time assertion that the score-family players structurally satisfy
// the kernel PlayerLike playback control contract (@webmusic/kernel/player).
//
// Pure type-level module: it emits no runtime code and is imported from the
// headless entry solely so the architecture checker's reachability gate sees
// it. If ScorePlayer drifts from the contract, the `Satisfies`
// constraints below fail typecheck. InteractivePlayer is excluded by design:
// it owns no musical clock.
// ============================================================================

import type {
  DisposablePlayerLike,
  PlayerLike,
  RateControlledPlayerLike,
  TimedPlayerLike,
  VolumeControlledPlayerLike,
} from '@webmusic/kernel/player';
import type {ScorePlayer} from './score-player';

type Satisfies<T extends U, U> = T;

export type PlayerLikeKernelContract = [
  Satisfies<ScorePlayer, PlayerLike>,
  // Capability tiers each player advertises (non-optional members). A guard
  // like isTimedPlayer() must keep returning true for these players.
  Satisfies<ScorePlayer, TimedPlayerLike>,
  Satisfies<ScorePlayer, RateControlledPlayerLike>,
  Satisfies<ScorePlayer, DisposablePlayerLike>,
  // ScorePlayer advertises volume control with a non-optional setVolume, so
  // isVolumeControlledPlayer() must keep narrowing it.
  Satisfies<ScorePlayer, VolumeControlledPlayerLike>,
];
