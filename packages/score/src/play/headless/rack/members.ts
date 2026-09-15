import {OscillatorSynth} from '../oscillator-synth';
import {ScorePlayer} from '../score-player';
import {InteractivePlayer} from '../interactive-player';
import {reportPlaybackOperationFailure} from '../playback-events';
import type {InternalRackMember, RackAddOptions, RackMember} from './contracts';

export function createRackMember(id: string, options: RackAddOptions): InternalRackMember {
  return {
    id,
    mode: options.mode ?? 'timeline',
    score: options.score,
    sound: options.sound,
    soundOwnership: options.soundOwnership,
    effect: options.effect,
    tempo: options.tempo,
    beatUnitQuarters: options.beatUnitQuarters,
    volume: options.volume ?? 1,
    muted: false,
    solo: false,
    ended: false,
  };
}

/** Realise one lazy member against the rack's shared context and master bus. */
export function buildRackMember(
  context: AudioContext,
  master: GainNode,
  member: InternalRackMember,
  onTimelineEnd: (id: string) => void,
  onOperationError?: (operation: string, error: unknown) => void,
): void {
  if (member.player) return;
  const gain = context.createGain();
  let player: ScorePlayer | InteractivePlayer | undefined;
  let timelineEndUnsubscribe: (() => void) | undefined;
  let operationErrorUnsubscribe: (() => void) | undefined;
  try {
    gain.connect(master);
    if (member.mode === 'interactive') {
      const interactive = new InteractivePlayer({audioContext: context, destination: gain, effect: member.effect});
      player = interactive;
      const sound = member.sound ?? new OscillatorSynth(context);
      interactive.addVoice('main', sound, {
        synthOwnership: member.sound ? member.soundOwnership : 'owned',
      });
      interactive.addSource('main', member.score, {beatUnitQuarters: member.beatUnitQuarters});
      operationErrorUnsubscribe = interactive.on('operationError', ({operation, error}) => {
        reportRackOperationError(onOperationError, `member ${member.id} ${operation}`, error);
      });
      // Commit the member's synth/effect/route graph while Rack still owns the
      // surrounding construction transaction. Async sample preparation stays
      // behind Rack.preload().
      void interactive.context;
    } else {
      const timeline = new ScorePlayer(member.score, {
        audioContext: context,
        destination: gain,
        synth: member.sound,
        synthOwnership: member.soundOwnership,
        effect: member.effect,
        tempo: member.tempo,
      });
      player = timeline;
      timelineEndUnsubscribe = timeline.on('end', () => onTimelineEnd(member.id));
      operationErrorUnsubscribe = timeline.on('operationError', ({operation, error}) => {
        reportRackOperationError(onOperationError, `member ${member.id} ${operation}`, error);
      });
      void timeline.context;
    }
  } catch (error) {
    try {
      player?.dispose();
    } catch (cleanupError) {
      reportRackOperationError(
        onOperationError,
        `member ${member.id} failed player dispose`,
        cleanupError,
      );
    }
    timelineEndUnsubscribe?.();
    operationErrorUnsubscribe?.();
    try {
      gain.disconnect();
    } catch (cleanupError) {
      reportRackOperationError(
        onOperationError,
        `member ${member.id} failed gain disconnect`,
        cleanupError,
      );
    }
    throw error;
  }

  member.gain = gain;
  member.player = player;
  member.timelineEndUnsubscribe = timelineEndUnsubscribe;
  member.operationErrorUnsubscribe = operationErrorUnsubscribe;
}

export function disposeRackMember(
  member: InternalRackMember,
  onOperationError?: (operation: string, error: unknown) => void,
): void {
  const player = member.player;
  const gain = member.gain;
  const timelineEndUnsubscribe = member.timelineEndUnsubscribe;
  const operationErrorUnsubscribe = member.operationErrorUnsubscribe;
  member.player = undefined;
  member.gain = undefined;
  member.timelineEndUnsubscribe = undefined;
  member.operationErrorUnsubscribe = undefined;
  timelineEndUnsubscribe?.();
  if (player) {
    try {
      player.dispose();
    } catch (error) {
      reportRackOperationError(onOperationError, `member ${member.id} dispose`, error);
    }
  }
  operationErrorUnsubscribe?.();
  if (gain) {
    try {
      gain.disconnect();
    } catch (error) {
      reportRackOperationError(onOperationError, `member ${member.id} disconnect`, error);
    }
  }
}

function reportRackOperationError(
  callback: ((operation: string, error: unknown) => void) | undefined,
  operation: string,
  error: unknown,
): void {
  if (callback) callback(operation, error);
  else reportPlaybackOperationFailure('Rack', operation, error);
}

export function rackMemberHandle(member: InternalRackMember): RackMember {
  return {
    id: member.id,
    mode: member.mode,
    player: member.player,
    volume: member.volume,
    muted: member.muted,
    solo: member.solo,
  };
}

export function timelineRackPlayers(members: Iterable<InternalRackMember>): ScorePlayer[] {
  const players: ScorePlayer[] = [];
  for (const member of members) {
    if (member.mode === 'timeline' && member.player instanceof ScorePlayer) players.push(member.player);
  }
  return players;
}
