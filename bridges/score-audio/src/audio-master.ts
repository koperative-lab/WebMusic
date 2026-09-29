// ============================================================================
// Audio as master: drive playback from a real recording and have the score
// follow it — the reverse of the score-mastered pairing in sync.ts.
//
// No new transport machinery. ScoreAudioSync is already role-based (its first
// participant drives, its second follows) and both families now hold both
// primitives: AudioClipPlayer exposes the buffer engine's clock and arms it on
// `play(when)`, and ScorePlayer accepts scheduled starts and re-anchors. What
// the reversal needs is an AXIS translation, which is what the two adapters
// below are:
//
//   - The sync's position axis is always the MASTER's axis. With a clip
//     master that axis is clip seconds.
//   - `ScorePlayer.seek()` is in RATE-SCALED seconds, so a score follower
//     cannot be handed to the sync directly: at any rate but 1 the positions
//     would silently diverge. `seekNominal`/`nominalSeconds` are the
//     rate-invariant members, and the follower adapter routes through them.
//   - `clipOffsetSeconds` (clip time at score-zero) flips direction: the
//     follower's position is `masterPosition - offset`, so the adapter
//     absorbs the offset rather than the sync applying it.
// ============================================================================

import {createWebAudioContext} from '@webmusic/kernel/audio-context';
import type {AudioClip} from '@webmusic/audio';
import {AudioClipPlayer} from '@webmusic/audio/play/headless';
import type {Score} from '@webmusic/score';
import {ScorePlayer} from '@webmusic/score/play/headless';
import {closeContext, ownContext} from './owned-context';
import {
  assertFactoryClipOptions,
  validatedClipOffsetSeconds,
  type FactoryClipOptions,
} from './factory-clip-options';
import {assertRenderedClipAlignment} from './render-provenance';
import {
  ScoreAudioSync,
  type ScoreAudioSyncOptions,
  type SyncFollowerTransport,
  type SyncMasterTransport,
  type SyncTransportClockView,
} from './sync';

/**
 * Shift a read-only clock onto another axis by a constant offset. The sync
 * reads the follower's clock to measure drift, so a follower whose own axis
 * is displaced from the master's must present a shifted view or every drift
 * check would report the offset itself as drift.
 */
function offsetClockView(clock: SyncTransportClockView, offset: number): SyncTransportClockView {
  if (offset === 0) return clock;
  return {
    get state() {
      const state = clock.state;
      return {...state, originPosition: state.originPosition + offset};
    },
    get rate() {
      return clock.rate;
    },
    get paused() {
      return clock.paused;
    },
    get holding() {
      return clock.holding;
    },
    positionAt: (t: number) => clock.positionAt(t) + offset,
    timeAt: (position: number) => clock.timeAt(position - offset),
  };
}

/** Options shared by the reverse-role adapters. */
export interface AudioMasterAdapterOptions {
  /** Finite, non-negative clip seconds corresponding to score-seconds zero. Default 0. */
  clipOffsetSeconds?: number;
}

/**
 * Present an {@link AudioClipPlayer} as the sync's MASTER transport.
 *
 * A scheduled re-anchor (`seekNominal(position, when)`) is expressed as
 * pause → seek → `play(when)`: the engine's own `seek` restarts immediately
 * while playing, and its `play` is a no-op unless paused, so this is the
 * sequence that actually arms the clock at `when` rather than starting at
 * once. That is what lets a follower join the reversed pairing on a shared
 * origin, exactly as the clip does in the forward one.
 */
export function clipAsMaster(clip: AudioClipPlayer): SyncMasterTransport {
  return {
    play: (when?: number) => clip.play(when),
    pause: () => clip.pause(),
    stop: () => clip.stop(),
    seekNominal: (seconds: number, when?: number) => {
      if (when === undefined || !clip.playing) {
        clip.seek(seconds);
        return;
      }
      clip.pause();
      clip.seek(seconds);
      return clip.play(when);
    },
    setRate: (rate: number) => clip.setRate(rate),
    get nominalSeconds() {
      return clip.seconds;
    },
    get clock() {
      return clip.clock;
    },
    dispose: () => clip.dispose(),
  };
}

/**
 * Present a {@link ScorePlayer} as the sync's FOLLOWER transport, on the
 * master clip's seconds axis.
 *
 * Three translations happen here.
 *
 * 1. Rate-invariant positions: `seekNominal`/`nominalSeconds`, never
 *    `seek`/`seconds`, which are rate-scaled and would desync the pairing at
 *    any rate but 1.
 * 2. The clip-offset shift, so the sync itself needs no offset here.
 * 3. The LEAD-IN region. A recording may hold material before score-zero — a
 *    count-in, an anacrusis, room tone — and there the score has no position
 *    at all: the requested one is negative and `seekNominal` clamps it to the
 *    start. Starting the score anyway would have it run the whole recording
 *    that much early, so a scheduled start is deferred by exactly the
 *    remaining lead-in, and the score enters when the recording actually
 *    reaches score-zero.
 */
export function scoreAsFollower(
  score: ScorePlayer,
  options: AudioMasterAdapterOptions = {},
): SyncFollowerTransport {
  const offset = validatedClipOffsetSeconds(options.clipOffsetSeconds);
  // Last position requested on the score's axis, BEFORE seekNominal's clamp.
  // Negative means the transport currently sits in the recording's lead-in.
  let requested = 0;
  return {
    play: (when?: number) => {
      if (when !== undefined && requested < 0) {
        // `requested` is (master position − offset), so the recording reaches
        // score-zero exactly `-requested` nominal seconds after `when`.
        return score.play(when + -requested / score.rate);
      }
      return score.play(when);
    },
    pause: () => score.pause(),
    stop: () => {
      requested = 0;
      score.stop();
    },
    // The sync only ever seeks a follower it has just paused, and a paused
    // seekNominal applies its re-anchor synchronously before resolving.
    seek: (seconds: number) => {
      requested = seconds - offset;
      void score.seekNominal(requested);
    },
    setRate: (rate: number) => score.setRate(rate),
    get seconds() {
      return score.nominalSeconds + offset;
    },
    get playing() {
      return score.isPlaying();
    },
    get clock() {
      return offsetClockView(score.clock, offset);
    },
    dispose: () => score.dispose(),
  };
}

export interface CreateAudioMasteredPlaybackOptions extends ScoreAudioSyncOptions {
  /** Shared AudioContext. If omitted, the factory creates one and sync.dispose() closes it. */
  context?: AudioContext;
  /** ScorePlayer options; tempo is group-owned and must be set with `sync.setRate()`. */
  scoreOptions?: ConstructorParameters<typeof ScorePlayer>[1];
  /**
   * Options forwarded to the AudioClipPlayer constructor. As in the forward
   * pairing the engine is not selectable: only the buffer engine holds a
   * sample-accurate clock, and here it is the MASTER's clock, so nothing
   * downstream could be accurate without it. The media adapter and clip-side
   * loop/rate overrides are rejected; use the sync's setLoop()/setRate().
   */
  clipOptions?: FactoryClipOptions;
}

/**
 * Construct an audio-mastered pairing: the CLIP drives the transport and the
 * score follows it, on one shared AudioContext. This is the configuration for
 * following a real recording — a performance, a rehearsal take — with the
 * notation tracking it, rather than the score-mastered
 * `createSyncedPlayback`, where the clip is typically a backing track
 * rendered from the score itself.
 *
 * Positions are on the CLIP's seconds axis (the master's axis). Pass
 * `clipOffsetSeconds` when the recording does not begin at score-seconds
 * zero. The score player is returned so callers can silence it
 * (`setVolume(0)`) when the recording is meant to be the only sounding
 * source, which is the usual case here.
 */
export function createAudioMasteredPlayback(
  score: Score,
  clip: AudioClip,
  options: CreateAudioMasteredPlaybackOptions = {},
): {sync: ScoreAudioSync; scorePlayer: ScorePlayer; clipPlayer: AudioClipPlayer} {
  const clipOptions = options.clipOptions;
  assertFactoryClipOptions('createAudioMasteredPlayback', clip, clipOptions);
  const clipOffsetSeconds = validatedClipOffsetSeconds(options.clipOffsetSeconds);
  const scoreOptions = options.scoreOptions;
  assertRenderedClipAlignment('createAudioMasteredPlayback', score, clip, scoreOptions?.expandRepeats);
  if (scoreOptions?.tempo !== undefined) {
    throw new RangeError(
      'createAudioMasteredPlayback does not accept scoreOptions.tempo: the audio master owns ' +
        'the shared rate. Change both players with sync.setRate().',
    );
  }
  const context = options.context ??
    createWebAudioContext('Web Audio is not available. Pass an existing AudioContext in options.context.');
  let scorePlayer: ScorePlayer | undefined;
  let clipPlayer: AudioClipPlayer | undefined;
  try {
    scorePlayer = new ScorePlayer(score, {...scoreOptions, audioContext: context});
    clipPlayer = new AudioClipPlayer(clip, {
      ...clipOptions,
      audioContext: context,
      engine: 'buffer',
    });
    const sync = new ScoreAudioSync(
      clipAsMaster(clipPlayer),
      scoreAsFollower(scorePlayer, {clipOffsetSeconds}),
      context,
      // The follower adapter already translates the offset onto the clip axis.
      {...options, clipOffsetSeconds: 0},
    );
    if (!options.context) ownContext(sync, context, options.onOperationError);
    return {sync, scorePlayer, clipPlayer};
  } catch (error) {
    for (const player of [clipPlayer, scorePlayer]) {
      try { player?.dispose(); } catch { /* Preserve the construction failure. */ }
    }
    if (!options.context) closeContext(context, options.onOperationError);
    throw error;
  }
}
