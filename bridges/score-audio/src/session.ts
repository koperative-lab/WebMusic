import type {AudioClip} from '@webmusic/audio';
import {AudioPlayer} from '@webmusic/audio/play/headless';
import {ModuleAudioEnvironment, ModuleContext, routeModuleOutput, type ConnectionLease} from '@webmusic/kernel/module';
import {SessionTransport, type SessionParticipantLease} from '@webmusic/kernel/session';
import type {Score} from '@webmusic/score';
import {ScorePlayerModule, type HeadlessSynth} from '@webmusic/score/play/headless';
import {registerAudioParticipant} from './audio-participant';

export interface CreateScoreAudioSessionOptions {
  /** Borrowed context; without one the composition creates and owns a lazy one. */
  context?: AudioContext;
  /** Score synth; defaults to the oscillator. */
  synth?: HeadlessSynth;
  /** Session seconds → nominal Score seconds: `score = session * scale + offset`. */
  scoreOffsetSeconds?: number;
  scorePositionScale?: number;
  /** Session seconds → clip seconds: `clip = session * scale + offset`. */
  clipOffsetSeconds?: number;
  clipPositionScale?: number;
  /** Lead-in before a shared start, in seconds. */
  leadInSeconds?: number;
  onOperationError?: (operation: string, error: unknown) => void;
}

/** One Session conducting a Score engine and an Audio player (DEC-068). */
export interface ScoreAudioSession {
  /** The only command authority: play, pause, stop, seek, rate and loop go here. */
  readonly session: SessionTransport;
  readonly context: ModuleContext;
  readonly scoreModule: ScorePlayerModule;
  readonly clipPlayer: AudioPlayer;
  /** Release both participants, their routes, the Session and an owned context. */
  dispose(): void;
}

/**
 * Compose a Score and an Audio clip under one Session — Bridge's replacement
 * for the former master/follower sync family. Each engine is a Session
 * participant with an explicit mapping from Session seconds into its own axis
 * (`score-nominal-seconds`, `clip-seconds`); use `beatGridFromTimeMap` and
 * `timeMapFromBeatGrid` to derive mappings between musical and audio time.
 * Nothing is allocated until the Session prepares or plays.
 */
export function createScoreAudioSession(score: Score, clip: AudioClip, options: CreateScoreAudioSessionOptions = {}): ScoreAudioSession {
  const audio = new ModuleAudioEnvironment(options.context ? {context: options.context} : {});
  const session = new SessionTransport(() => audio.peek()?.currentTime ?? 0, {
    ...(options.leadInSeconds !== undefined ? {leadInSeconds: options.leadInSeconds} : {}),
    onOperationError: options.onOperationError,
  });
  const context = new ModuleContext({id: 'score-audio-session', audio, session});
  let scoreModule: ScorePlayerModule | undefined;
  let clipPlayer: AudioPlayer | undefined;
  let participant: SessionParticipantLease | undefined;
  let route: ConnectionLease | undefined;
  let disposed = false;
  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    let failure: unknown;
    for (const release of [() => participant?.release(), () => route?.release(), () => clipPlayer?.dispose(),
      () => scoreModule?.dispose(), () => session.dispose(), () => audio.dispose()]) {
      try { release(); } catch (error) { failure ??= error; }
    }
    if (failure !== undefined) throw failure;
  };
  try {
    scoreModule = new ScorePlayerModule(score, {
      id: 'score', context, synth: options.synth,
      offsetSeconds: options.scoreOffsetSeconds, positionScale: options.scorePositionScale,
      onError: (error) => options.onOperationError?.('score', error),
    });
    const player = new AudioPlayer(clip, {moduleContext: context});
    clipPlayer = player;
    participant = registerAudioParticipant(session, player, {
      offsetSeconds: options.clipOffsetSeconds, positionScale: options.clipPositionScale,
      prepare: async () => {
        await player.preload();
        if (disposed) throw new Error('Score/Audio Session was disposed during preparation.');
        if (!route) route = routeModuleOutput(context, {id: 'clip', getPort: () => player.outputPort}, player.outputPort!);
      },
    });
  } catch (error) {
    try { dispose(); } catch { /* Preserve the construction failure. */ }
    throw error;
  }
  return Object.freeze({session, context, scoreModule, clipPlayer, dispose});
}
