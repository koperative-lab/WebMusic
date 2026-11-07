import type {AudioClipPlayer} from '@webmusic/audio/play/headless';
import type {ModuleSession, SessionParticipantLease} from '@webmusic/kernel/session';

/** The engine surface a participant adapter needs; `AudioPlayer` and `AudioClipPlayer` both provide it. */
export type AudioParticipantPlayer = Pick<AudioClipPlayer,
  'play' | 'pause' | 'stop' | 'seek' | 'setRate' | 'seconds' | 'playing' | 'clock' | 'duration' |
  'activateScheduling' | 'attachScheduling' | 'timingCapabilities'>;

export interface AudioParticipantOptions {
  offsetSeconds?: number;
  positionScale?: number;
  /** Prepare and route the player's output before the Session anchors a start. */
  prepare: () => void | Promise<void>;
}

/**
 * Register a Headless Audio engine with a Session on the `clip-seconds` axis —
 * the same axis `<audio-player>` uses, so Score and Audio mappings agree
 * (DEC-068). Native buffer playback attaches the shared scheduling anchor.
 */
export function registerAudioParticipant(
  session: ModuleSession,
  player: AudioParticipantPlayer,
  options: AudioParticipantOptions,
): SessionParticipantLease {
  return session.register({
    play: (when) => player.play(when), pause: () => player.pause(), stop: () => player.stop(),
    seek: (seconds) => player.seek(seconds), setRate: (rate) => player.setRate(rate),
    get position() { return player.seconds; }, get running() { return player.playing; },
    get clock() { return player.clock; },
  }, {
    axis: 'clip-seconds', identity: player, durationSeconds: () => player.duration, endPolicy: 'position',
    offsetSeconds: options.offsetSeconds, positionScale: options.positionScale,
    prepare: options.prepare, activate: () => player.activateScheduling(),
    ...(player.timingCapabilities.sharedSessionClock && {attachScheduling: (binding) => player.attachScheduling(binding)}),
  });
}
