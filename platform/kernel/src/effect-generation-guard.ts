import type {EffectNodes, InsertChain} from './effect-chain';

/** Internal ownership fence for chains temporarily sharing a transition rack. */
export const effectGenerationGuards = new WeakMap<InsertChain, (nodes: EffectNodes) => boolean>();
