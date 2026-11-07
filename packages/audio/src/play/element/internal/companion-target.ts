import {observeCompanionInput, type ElementTargetState} from '@webmusic/kernel/element';
import {AUDIO_PLAYER_OWNER} from '../../../core/player-owner';

/**
 * Resolve the element an Audio companion (view or analyser) follows (DEC-068):
 * the `input` selector's target or, with none, the enclosing `<audio-player>`
 * scope by containment. Discovery is Kernel's shared companion resolution; an
 * Audio `port` attribute names an audio tap, so it never selects a source port.
 */
export function observeCompanionTarget(
  host: Element,
  callback: (target: Element | undefined, state: ElementTargetState) => void,
): () => void {
  return observeCompanionInput(host, {capability: AUDIO_PLAYER_OWNER, portAttribute: false},
    (input) => callback(input.element, input.state === 'pending' ? 'missing' : input.state));
}
