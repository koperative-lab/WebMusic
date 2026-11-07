import {observeElementTarget, observeModuleContext, type ElementTargetState} from '@webmusic/kernel/element';
import {AUDIO_PLAYER_OWNER} from '../../../core/player-owner';

/**
 * Resolve the element a View companion follows (DEC-068): the first present
 * selector attribute (for example `player`, `input`, `source`), or — with
 * none — the enclosing `<audio-player>` scope by containment.
 */
export function observeCompanionTarget(
  host: Element,
  attributes: readonly string[],
  callback: (target: Element | undefined, state: ElementTargetState) => void,
): () => void {
  const attribute = attributes.find((name) => host.getAttribute(name) !== null);
  const selector = attribute ? host.getAttribute(attribute) : null;
  if (selector) return observeElementTarget(host, selector, callback);
  return observeModuleContext(host, (context) => {
    const owner = context?.capabilities.get(AUDIO_PLAYER_OWNER) as Element | undefined;
    callback(owner, owner ? 'ready' : 'missing');
  });
}
