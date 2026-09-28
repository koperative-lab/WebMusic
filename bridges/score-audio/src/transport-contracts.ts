// ============================================================================
// Compile-time assertion that the families' real players structurally
// satisfy the bridge's sync transport contracts. The sync's docs bless
// ScorePlayer (clock-anchored) and TonePlayer (clockless fallback) as
// master transports and AudioClipPlayer as the follower, but nothing
// pinned that conformance — a family could drift and the documented
// pairing would break with every gate green.
//
// Pure type-level module (the same pattern as the score family's
// playerlike-contract.ts): it emits no runtime code and is re-exported
// from the package entry solely so reachability tooling sees it. If a
// player drifts from its role contract, the `Satisfies` constraints
// below fail typecheck.
// ============================================================================

import type {ScorePlayer, TonePlayer} from '@webmusic/score/play/headless';
import type {AudioClipPlayer} from '@webmusic/audio/play/headless';
import type {SyncClipTransport, SyncScoreTransport} from './sync';

type Satisfies<T extends U, U> = T;

export type SyncTransportContract = [
  // Master role: ScorePlayer additionally exposes its kernel transport
  // clock (the skew-free anchoring path); TonePlayer is the documented
  // clockless fallback exercising the sampled mirror path.
  Satisfies<ScorePlayer, SyncScoreTransport>,
  Satisfies<TonePlayer, SyncScoreTransport>,
  // Follower role: scheduled sample-accurate start on the buffer engine.
  Satisfies<AudioClipPlayer, SyncClipTransport>,
];
