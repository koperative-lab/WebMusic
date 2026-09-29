// ============================================================================
// Shared effect contract and graph insertion helper. This module contains no
// long-lived playback state: headless effect factories and API offline export
// both build on this reusable core seam.
// ============================================================================

import type {Effect, EffectNodes} from '@webmusic/kernel/effect';

export type {Effect, EffectNodes} from '@webmusic/kernel/effect';

/**
 * Wire `source` to `destination`, inserting `effect` when one is provided.
 * Returns the effective output node and an optional effect disposer.
 */
export function insertEffect(
  context: BaseAudioContext,
  source: AudioNode,
  destination: AudioNode,
  effect: Effect | undefined,
): {output: AudioNode; dispose?: () => void} {
  if (!effect) {
    source.connect(destination);
    return {output: source};
  }
  const nodes: EffectNodes = effect.createAudioNodes(context);
  source.connect(nodes.input);
  nodes.output.connect(destination);
  return {output: nodes.output, dispose: nodes.dispose?.bind(nodes)};
}
