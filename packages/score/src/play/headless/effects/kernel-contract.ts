// ============================================================================
// Compile-time assertion that the score-family Effect satisfies the kernel
// Effect contract (@webmusic/kernel/effect) and that EffectNode remains
// mutually assignable with the kernel's EffectNodes.
//
// Pure type-level module: it emits no runtime code and is imported from
// effects.ts solely so the architecture checker's reachability gate sees it.
// ============================================================================

import type {Effect as KernelEffect, EffectNodes} from '@webmusic/kernel/effect';
import type {Effect} from '../effects';
import type {EffectNode} from './contracts';

type Satisfies<T extends U, U> = T;

export type EffectKernelContract = [
  Satisfies<Effect, KernelEffect>,
  Satisfies<EffectNode, EffectNodes>,
  Satisfies<EffectNodes, EffectNode>,
];
